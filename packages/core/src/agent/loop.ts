import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { HandoffTicket } from "../domain/handoff.js";
import { HISTORY_LIMIT, type Turn } from "./conversation.js";
import { checkReply, extractCitations, type Citation, type Evidence, type Violation } from "./guards.js";
import { emptyUsage, type Block, type Message, type ModelClient, type ToolDef, type Usage } from "./model.js";
import { SYSTEM_PROMPT } from "./prompt.js";

export interface AgentLimits {
  /** Model calls per inquiry, including the repair turn. */
  maxTurns: number;
  /** Input, cache and output tokens summed over the run. */
  tokenBudget: number;
  modelTimeoutMs: number;
  toolTimeoutMs: number;
  /** Output cap per model call. */
  maxTokens: number;
}

export const defaultLimits: AgentLimits = {
  maxTurns: 8,
  tokenBudget: 80_000,
  modelTimeoutMs: 60_000,
  toolTimeoutMs: 30_000,
  maxTokens: 8_000, // thinking tokens count against this too
};

export interface TraceEntry {
  turn: number;
  tool: string;
  arguments: Record<string, unknown>;
  /** One line describing the result, for the trace pane and logs. */
  summary: string;
  /** The full result: the tool's structured content, or its text when it has none (errors, for instance). */
  result: unknown;
  isError: boolean;
  durationMs: number;
  /** True for the hand-off the code created after the run failed or hit a limit. */
  forced?: boolean;
}

export type ForcedCause = "guard_failed" | "turn_limit" | "token_budget" | "model_timeout" | "truncated" | "refused";

export type Outcome = { status: "answered" } | { status: "forced_handoff"; cause: ForcedCause; detail?: string };

export interface AgentResult {
  reply: string;
  citations: Citation[];
  handoffs: HandoffTicket[];
  trace: TraceEntry[];
  usage: Usage;
  outcome: Outcome;
}

export type AgentEvent =
  | { type: "trace"; entry: TraceEntry }
  | { type: "guard"; violations: Violation[]; repairing: boolean };

export interface AgentDeps {
  model: ModelClient;
  /** The agent is a client of the MCP server; it has no other way to reach listings or tickets. */
  mcp: Client;
  limits?: Partial<AgentLimits>;
  onEvent?: (event: AgentEvent) => void;
}

/** Sent when the code, not the model, ends a run. Both languages, because the inquirer's is not known here. */
export const FORCED_HANDOFF_REPLY =
  "Ich kann diese Anfrage nicht abschließend beantworten und habe sie an einen Kollegen weitergegeben, der sich bei Ihnen meldet. / " +
  "I could not fully answer this inquiry, so I have passed it to a colleague who will get back to you.";

const REPAIRS_ALLOWED = 1;
const LISTING_ID = /^[A-Z]{1,3}-\d{3,5}$/;

const total = (u: Usage) => u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function walk(value: unknown, visit: (key: string, v: unknown) => void): void {
  if (Array.isArray(value)) return value.forEach((v) => walk(v, visit));
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      visit(k, v);
      walk(v, visit);
    }
  }
}

function summarise(tool: string, structured: any, text: string, isError: boolean): string {
  if (isError) return short(text, 200);
  switch (tool) {
    case "search_knowledge":
      return structured?.found
        ? `found ${structured.results.length}: ${structured.results.map((r: any) => r.chunkId).join(", ")}`
        : "found: false";
    case "search_listings":
      return `${structured?.total ?? 0} listings: ${(structured?.results ?? []).map((r: any) => r.id).join(", ")}`;
    case "get_listing":
      return `${structured?.id}: ${structured?.title}`;
    case "hand_off_to_human":
      return `ticket ${structured?.ticketId} (${structured?.reason})`;
    default:
      return short(text, 200);
  }
}

/**
 * The plain tool-use loop: call the model, run its tool calls over MCP, repeat until it answers.
 *
 * `history` is the conversation so far, as the client shows it (DECISIONS.md 31). The model reads it as context,
 * but it is not evidence: a citation or figure from an earlier reply must be looked up again in this run.
 * Figures the inquirer stated in earlier turns still count as theirs.
 */
export async function runInquiry(deps: AgentDeps, inquiry: string, history: readonly Turn[] = []): Promise<AgentResult> {
  const { model, mcp, onEvent } = deps;
  const limits = { ...defaultLimits, ...deps.limits };

  const tools: ToolDef[] = (await mcp.listTools()).tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));

  const earlier = history.slice(-HISTORY_LIMIT);
  const messages: Message[] = [
    ...earlier.flatMap((t): Message[] => [
      { role: "user", content: t.inquiry },
      { role: "assistant", content: [{ type: "text", text: t.reply }] },
    ]),
    { role: "user", content: inquiry },
  ];
  const trace: TraceEntry[] = [];
  const handoffs: HandoffTicket[] = [];
  const usage = emptyUsage();
  const evidence = {
    chunkIds: new Set<string>(),
    listingIds: new Set<string>(),
    toolTexts: [] as string[],
    inquiry: [...earlier.map((t) => t.inquiry), inquiry].join("\n"),
  } satisfies Evidence;
  let turns = 0;
  let repairs = 0;

  const callTool = async (name: string, args: Record<string, unknown>, forced = false) => {
    const started = performance.now();
    let text: string, structured: unknown, isError: boolean;
    try {
      const res = await mcp.callTool({ name, arguments: args }, undefined, { signal: AbortSignal.timeout(limits.toolTimeoutMs) });
      text = ((res.content as { type: string; text?: string }[]) ?? []).map((c) => c.text ?? "").join("\n");
      structured = res.structuredContent;
      isError = res.isError === true;
    } catch (e) {
      text = `Tool call failed: ${e instanceof Error ? e.message : String(e)}`;
      structured = undefined;
      isError = true;
    }
    const entry: TraceEntry = {
      turn: turns,
      tool: name,
      arguments: args,
      summary: summarise(name, structured, text, isError),
      result: structured ?? text,
      isError,
      durationMs: Math.round(performance.now() - started),
      ...(forced && { forced }),
    };
    trace.push(entry);
    onEvent?.({ type: "trace", entry });

    if (!isError) {
      evidence.toolTexts.push(text);
      walk(structured, (key, v) => {
        if (typeof v !== "string") return;
        if (key === "chunkId") evidence.chunkIds.add(v);
        if ((key === "id" || key === "listingId") && LISTING_ID.test(v)) evidence.listingIds.add(v);
      });
      if (name === "hand_off_to_human" && structured) handoffs.push(structured as HandoffTicket);
    }
    return { text, isError };
  };

  const finish = (reply: string, outcome: Outcome): AgentResult => ({
    reply,
    citations: outcome.status === "answered" ? extractCitations(reply).citations : [],
    handoffs,
    trace,
    usage,
    outcome,
  });

  const forceHandoff = async (cause: ForcedCause, detail?: string): Promise<AgentResult> => {
    const only = evidence.listingIds.size === 1 ? [...evidence.listingIds][0]! : null;
    await callTool(
      "hand_off_to_human",
      {
        reason: "not_answerable_from_listing",
        listingId: only,
        summary: short(`Automatic hand-off (${cause}). Inquiry: ${inquiry}`, 500),
        contactEmail: null,
      },
      true,
    );
    return finish(FORCED_HANDOFF_REPLY, { status: "forced_handoff", cause, ...(detail && { detail }) });
  };

  while (true) {
    if (turns >= limits.maxTurns) return forceHandoff("turn_limit", `${limits.maxTurns} model calls`);
    if (total(usage) >= limits.tokenBudget) return forceHandoff("token_budget", `${total(usage)} tokens`);
    turns++;

    const signal = AbortSignal.timeout(limits.modelTimeoutMs);
    let response;
    try {
      response = await model.complete({ system: SYSTEM_PROMPT, tools, messages, maxTokens: limits.maxTokens, signal });
    } catch (e) {
      if (signal.aborted) return forceHandoff("model_timeout", `no response within ${limits.modelTimeoutMs} ms`);
      throw e;
    }
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    usage.cacheReadTokens += response.usage.cacheReadTokens;
    usage.cacheWriteTokens += response.usage.cacheWriteTokens;
    messages.push({ role: "assistant", content: response.content });

    const uses = response.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    if (uses.length) {
      const results: Block[] = [];
      for (const use of uses) {
        const { text, isError } = await callTool(use.name, use.input);
        results.push({ type: "tool_result", toolUseId: use.id, content: text, ...(isError && { isError }) });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    if (response.stop === "refusal") return forceHandoff("refused");
    if (response.stop === "max_tokens") return forceHandoff("truncated", `reply cut off at ${limits.maxTokens} tokens`);

    const reply = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    const violations = checkReply(reply, evidence);
    if (!violations.length) return finish(reply, { status: "answered" });

    const repairing = repairs < REPAIRS_ALLOWED;
    onEvent?.({ type: "guard", violations, repairing });
    if (!repairing) return forceHandoff("guard_failed", violations.map((v) => v.message).join(" "));
    repairs++;
    messages.push({
      role: "user",
      content:
        "Your draft was not sent to the inquirer. Fix these problems:\n" +
        violations.map((v) => `- ${v.message}`).join("\n") +
        "\nYou may call tools first. Then write the corrected reply, or hand off if the record does not support an answer.",
    });
  }
}
