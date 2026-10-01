import { describe, expect, it } from "vitest";
import type { AgentResult, HandoffReason, TraceEntry } from "@proptech/core";
import { EvalCase } from "../src/cases.js";
import { baseModelId, costUsd } from "../src/cost.js";
import type { CaseRun } from "../src/harness.js";
import { parseJudgeReport, verdictOf, type JudgeReport } from "../src/judge.js";
import { checkThresholds, handoffStats, scoreCase, summarise } from "../src/metrics.js";

const evalCase = (over: Partial<EvalCase> = {}) => EvalCase.parse({ id: "c", lang: "en", inquiry: "Is heating included in HH-1001?", ...over });

const listingTrace: TraceEntry = {
  turn: 1,
  tool: "get_listing",
  arguments: { id: "HH-1001" },
  summary: "HH-1001",
  result: { id: "HH-1001", price: 1650, description: "Utilities (Nebenkosten) are an additional 240 EUR per month, heating included." },
  isError: false,
  durationMs: 3,
};

const ticket = (reason: HandoffReason) => ({ ticketId: `T-${reason}`, createdAt: "2026-10-01T00:00:00Z", reason, listingId: null, summary: "s", contactEmail: null });

function run(over: { case?: Partial<EvalCase>; reply?: string; handoffs?: HandoffReason[]; run?: Partial<CaseRun> } = {}): CaseRun {
  const result: AgentResult = {
    reply: over.reply ?? "Heating is included in the utilities of 240 EUR [HH-1001].",
    citations: [],
    handoffs: (over.handoffs ?? []).map(ticket),
    trace: [listingTrace],
    usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
    outcome: { status: "answered" },
  };
  return { case: evalCase({ listings: ["HH-1001"], ...over.case }), result, guardEvents: [], latencyMs: 1000, costUsd: 0.01, ...over.run };
}

describe("scoreCase", () => {
  it("passes a grounded reply with the right hand-offs and the listing named", () => {
    const s = scoreCase(run());
    expect(s).toMatchObject({ passed: true, grounded: true, firstDraftGrounded: true, handoffsOk: true, failures: [] });
  });

  it("fails a reply with a figure no tool returned", () => {
    const s = scoreCase(run({ reply: "The warm rent is 1.890 € [HH-1001]." }));
    expect(s.grounded).toBe(false);
    expect(s.passed).toBe(false);
    expect(s.failures.join(" ")).toMatch(/1\.890 €/);
  });

  it("counts a figure the inquirer stated in an earlier turn as theirs", () => {
    const history = [{ inquiry: "Is it under 2.000 €?", reply: "Yes [HH-1001]." }];
    expect(scoreCase(run({ case: { history }, reply: "Yes, it is under 2.000 € [HH-1001]." })).grounded).toBe(true);
  });

  it("records a first draft that needed a repair turn", () => {
    const s = scoreCase(run({ run: { guardEvents: [{ violations: [{ guard: "number", message: "x" }], repairing: true }] } }));
    expect(s).toMatchObject({ grounded: true, firstDraftGrounded: false, passed: true });
  });

  it("fails on a missing or an extra hand-off, but not on an allowed one", () => {
    expect(scoreCase(run({ case: { handoffs: ["viewing_request"] } })).failures).toContain("hand-offs: expected viewing_request, got none");
    expect(scoreCase(run({ handoffs: ["complaint"] })).handoffsOk).toBe(false);
    expect(scoreCase(run({ case: { allowHandoffs: ["not_answerable_from_listing"] }, handoffs: ["not_answerable_from_listing"] })).handoffsOk).toBe(true);
  });

  it("fails when an expected listing is not named, and when the run threw", () => {
    expect(scoreCase(run({ case: { listings: ["HH-1002"] } })).missingListings).toEqual(["HH-1002"]);
    const thrown = scoreCase({ case: evalCase(), error: "boom", guardEvents: [], latencyMs: 5, costUsd: null });
    expect(thrown).toMatchObject({ passed: false, grounded: null });
    expect(thrown.failures).toEqual(["run failed: boom"]);
  });

  it("takes correctness from the judge's parts", () => {
    const c = evalCase({ must: ["heating included"], mustNot: ["heating extra"] });
    const report: JudgeReport = { must: [{ fact: "heating included", met: true }], mustNot: [{ statement: "heating extra", violated: true }], unsupported: [], languageMatches: true, reasoning: "" };
    expect(verdictOf(report, c)).toBe(false);
    expect(verdictOf({ ...report, mustNot: [{ statement: "heating extra", violated: false }] }, c)).toBe(true);
    expect(verdictOf({ ...report, must: [], mustNot: [] }, c)).toBe(false); // the judge skipped a fact
    const verdict = { ...report, correct: false, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    const s = scoreCase(run({ case: c, run: { verdict } }));
    expect(s.correct).toBe(false);
    expect(s.passed).toBe(false);
    expect(s.failures).toContain("judge, must not: heating extra");
  });
});

describe("hand-off precision and recall", () => {
  it("counts per reason and leaves allowed tickets out", () => {
    const runs = [
      run({ case: { handoffs: ["viewing_request"] }, handoffs: ["viewing_request"] }),
      run({ case: { handoffs: ["viewing_request", "price_negotiation"] }, handoffs: ["viewing_request"] }),
      run({ handoffs: ["not_answerable_from_listing"] }),
      run({ case: { allowHandoffs: ["not_answerable_from_listing"] }, handoffs: ["not_answerable_from_listing"] }),
    ];
    const { perReason, micro } = handoffStats(runs);
    expect(perReason.viewing_request).toMatchObject({ tp: 2, fp: 0, fn: 0, precision: 1, recall: 1 });
    expect(perReason.price_negotiation).toMatchObject({ tp: 0, fn: 1, recall: 0, precision: null });
    expect(perReason.not_answerable_from_listing).toMatchObject({ tp: 0, fp: 1, precision: 0 });
    expect(micro).toMatchObject({ tp: 2, fp: 1, fn: 1 });
  });
});

describe("thresholds", () => {
  const runs = [run(), run({ reply: "It costs 999 € [HH-1001]." })];
  const summary = summarise(runs, runs.map(scoreCase), null);

  it("summarises cost and latency per inquiry", () => {
    expect(summary).toMatchObject({ cases: 2, passed: 1, groundedness: 0.5, meanCostUsd: 0.01, p95LatencyMs: 1000, correctness: null });
  });

  it("misses a threshold below its minimum, and skips a metric that was not measured", () => {
    const checks = checkThresholds(summary, { min: { groundedness: 1, passRate: 0.5, correctness: 0.9 }, max: { meanCostUsd: 0.05 } });
    expect(checks.map((c) => [c.metric, c.ok])).toEqual([
      ["groundedness", false],
      ["passRate", true],
      ["correctness", null],
      ["meanCostUsd", true],
    ]);
  });

  it("rejects a misspelled metric", () => {
    expect(() => checkThresholds(summary, { min: { groundednes: 1 } })).toThrow(/unknown metric "groundednes"/);
  });
});

describe("judge output and cost", () => {
  it("reads the JSON object out of a fenced reply, and rejects a reply without one", () => {
    const json = '{"must":[],"mustNot":[],"unsupported":[],"languageMatches":true,"reasoning":"ok"}';
    expect(parseJudgeReport("```json\n" + json + "\n```").reasoning).toBe("ok");
    expect(() => parseJudgeReport("I think it is fine.")).toThrow(/no JSON object/);
    expect(() => parseJudgeReport('{"must":"yes"}')).toThrow();
  });

  it("prices Bedrock profile ids like the Claude API ids, and knows nothing of other models", () => {
    expect(baseModelId("eu.anthropic.claude-opus-5-5")).toBe("claude-opus-5-5");
    const usage = { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 };
    expect(costUsd(usage, "eu.anthropic.claude-opus-5-5")).toBeCloseTo(4 + 2 + 0.2);
    expect(costUsd(usage, "demo")).toBe(0);
    expect(costUsd(usage, "some-other-model")).toBeNull();
  });
});
