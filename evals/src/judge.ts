import { z } from "zod";
import { emptyUsage, type AgentResult, type ModelClient, type Usage } from "@proptech/core";
import type { EvalCase } from "./cases.js";

export const JudgeReport = z.object({
  must: z.array(z.object({ fact: z.string(), met: z.boolean(), note: z.string().optional() })),
  mustNot: z.array(z.object({ statement: z.string(), violated: z.boolean(), note: z.string().optional() })),
  unsupported: z.array(z.string()),
  languageMatches: z.boolean(),
  reasoning: z.string(),
});
export type JudgeReport = z.infer<typeof JudgeReport>;

export interface JudgeVerdict extends JudgeReport {
  /** Computed from the parts, not taken from the judge: all must met, no must-not violated, nothing unsupported, right language. */
  correct: boolean;
  usage: Usage;
}

export interface Judge {
  readonly id: string;
  judge(c: EvalCase, result: AgentResult): Promise<JudgeVerdict>;
}

export function verdictOf(report: JudgeReport, c: EvalCase): boolean {
  return (
    report.must.length === c.must.length &&
    report.must.every((m) => m.met) &&
    report.mustNot.every((m) => !m.violated) &&
    report.unsupported.length === 0 &&
    report.languageMatches
  );
}

const MAX_RESULT_CHARS = 4_000;
const clip = (s: string) => (s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS)} [...]` : s);

/** The judge's input: everything it needs to grade against the record, and nothing from the agent's prompt. */
export function judgePrompt(c: EvalCase, result: AgentResult): string {
  const calls = result.trace.map((t, i) => {
    const out = typeof t.result === "string" ? t.result : JSON.stringify(t.result);
    return `${i + 1}. ${t.tool}${t.forced ? " (created by the system, not the assistant)" : ""} ${JSON.stringify(t.arguments)}\n${t.isError ? "ERROR: " : ""}${clip(out)}`;
  });
  return [
    `<language>${c.lang}</language>`,
    c.history.length
      ? `<earlier_turns>\n${c.history.map((t) => `Inquirer: ${t.inquiry}\nAssistant: ${t.reply}`).join("\n\n")}\n</earlier_turns>`
      : "",
    `<inquiry>\n${c.inquiry}\n</inquiry>`,
    `<tool_calls>\n${calls.join("\n\n") || "(none)"}\n</tool_calls>`,
    `<handoff_tickets>\n${result.handoffs.map((h) => `${h.reason}${h.listingId ? ` (${h.listingId})` : ""}: ${h.summary}`).join("\n") || "(none)"}\n</handoff_tickets>`,
    `<reply>\n${result.reply}\n</reply>`,
    `<must>\n${c.must.map((m, i) => `${i + 1}. ${m}`).join("\n") || "(none)"}\n</must>`,
    `<must_not>\n${c.mustNot.map((m, i) => `${i + 1}. ${m}`).join("\n") || "(none)"}\n</must_not>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const OUTPUT_FORMAT = `Answer with one JSON object and nothing else, in this shape:
{"must": [{"fact": "<must item, verbatim>", "met": true, "note": "<optional, short>"}],
 "mustNot": [{"statement": "<must_not item, verbatim>", "violated": false, "note": "<optional, short>"}],
 "unsupported": ["<short quote of each unsupported claim>"],
 "languageMatches": true,
 "reasoning": "<two sentences at most>"}
List every must and must_not item, in the order given.`;

/** Takes the first JSON object in the text; models sometimes wrap it in a code fence. */
export function parseJudgeReport(text: string): JudgeReport {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`judge returned no JSON object: ${text.slice(0, 200)}`);
  return JudgeReport.parse(JSON.parse(text.slice(start, end + 1)));
}

/** A model reading the written rubric. One retry when the output does not parse. */
export class ModelJudge implements Judge {
  readonly id: string;
  constructor(
    private readonly model: ModelClient,
    private readonly rubric: string,
  ) {
    this.id = model.id;
  }

  async judge(c: EvalCase, result: AgentResult): Promise<JudgeVerdict> {
    const usage = emptyUsage();
    const prompt = judgePrompt(c, result);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.model.complete({
        system: `${this.rubric}\n\n${OUTPUT_FORMAT}`,
        tools: [],
        messages: [{ role: "user", content: prompt }],
        maxTokens: 4_000,
        signal: AbortSignal.timeout(120_000),
      });
      usage.inputTokens += res.usage.inputTokens;
      usage.outputTokens += res.usage.outputTokens;
      usage.cacheReadTokens += res.usage.cacheReadTokens;
      usage.cacheWriteTokens += res.usage.cacheWriteTokens;
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
      try {
        const report = parseJudgeReport(text);
        return { ...report, correct: verdictOf(report, c), usage };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }
}
