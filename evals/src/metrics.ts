import { readFileSync } from "node:fs";
import { checkReply, HandoffReason, type KnowledgeBase, type GoldenSet } from "@proptech/core";
import type { CaseRun } from "./harness.js";

export interface CaseScore {
  id: string;
  passed: boolean;
  /** One line per failed check, for the report. Empty when the case passed. */
  failures: string[];
  expectedHandoffs: HandoffReason[];
  actualHandoffs: HandoffReason[];
  handoffsOk: boolean;
  /** Expected listings neither named in the reply nor attached to a ticket. */
  missingListings: string[];
  /** Every price, area and percentage in the final reply appears in a tool result or the inquirer's messages. */
  grounded: boolean | null;
  /** The model's first draft passed the number check, without a repair turn. */
  firstDraftGrounded: boolean | null;
  /** From the judge; null when the case was not judged. */
  correct: boolean | null;
}

const uniq = <T>(xs: T[]) => [...new Set(xs)];
const list = (xs: readonly string[]) => (xs.length ? xs.join(", ") : "none");

/** The number check from the loop's guard, run again on the final reply against this run's trace. */
export function ungroundedFigures(run: CaseRun): string[] {
  const r = run.result;
  if (!r) return [];
  const toolTexts = r.trace.filter((t) => !t.isError).map((t) => (typeof t.result === "string" ? t.result : JSON.stringify(t.result)));
  const inquiry = [...run.case.history.map((t) => t.inquiry), run.case.inquiry].join("\n");
  const violations = checkReply(r.reply, { chunkIds: new Set(), listingIds: new Set(), toolTexts, inquiry });
  return violations.filter((v) => v.guard === "number").map((v) => v.message);
}

export function scoreCase(run: CaseRun): CaseScore {
  const c = run.case;
  const failures: string[] = [];
  const r = run.result;
  if (run.error) failures.push(`run failed: ${run.error}`);

  const actual = uniq((r?.handoffs ?? []).map((h) => h.reason));
  const missing = c.handoffs.filter((x) => !actual.includes(x));
  const extra = actual.filter((x) => !c.handoffs.includes(x) && !c.allowHandoffs.includes(x));
  const handoffsOk = !!r && !missing.length && !extra.length;
  if (r && !handoffsOk) failures.push(`hand-offs: expected ${list(c.handoffs)}, got ${list(actual)}`);

  // Identified: named in the reply, or attached to a ticket (a viewing reply need not repeat the id).
  const missingListings = r ? c.listings.filter((id) => !r.reply.includes(id) && !r.handoffs.some((h) => h.listingId === id)) : [];
  if (missingListings.length) failures.push(`listing not identified, in the reply or on a ticket: ${list(missingListings)}`);

  const ungrounded = ungroundedFigures(run);
  const grounded = r ? ungrounded.length === 0 : null;
  if (ungrounded.length) failures.push(`ungrounded: ${ungrounded.join(" ")}`);
  const firstDraftGrounded = r ? !run.guardEvents.some((e) => e.violations.some((v) => v.guard === "number")) : null;

  if (r?.outcome.status === "forced_handoff") failures.push(`ended by the code: ${r.outcome.cause}${r.outcome.detail ? ` (${r.outcome.detail})` : ""}`);

  const v = run.verdict;
  if (v) {
    for (const m of v.must.filter((m) => !m.met)) failures.push(`judge, missing: ${m.fact}${m.note ? ` (${m.note})` : ""}`);
    if (v.must.length !== c.must.length) failures.push(`judge graded ${v.must.length} of ${c.must.length} must facts`);
    for (const m of v.mustNot.filter((m) => m.violated)) failures.push(`judge, must not: ${m.statement}${m.note ? ` (${m.note})` : ""}`);
    for (const u of v.unsupported) failures.push(`judge, unsupported: ${u}`);
    if (!v.languageMatches) failures.push(`judge: reply is not in ${c.lang}`);
  }
  if (run.judgeError) failures.push(`judge failed: ${run.judgeError}`);

  return {
    id: c.id,
    // A forced hand-off is listed for the reader but decided by the other checks: it may be the right outcome.
    passed: !run.error && handoffsOk && !missingListings.length && grounded === true && (v ? v.correct : !run.judgeError),
    failures,
    expectedHandoffs: c.handoffs,
    actualHandoffs: actual,
    handoffsOk,
    missingListings,
    grounded,
    firstDraftGrounded,
    correct: v ? v.correct : null,
  };
}

export interface ReasonStats {
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
}

const ratio = (a: number, b: number) => (b ? a / b : null);
const share = (xs: (boolean | null)[]) => {
  const known = xs.filter((x): x is boolean => x !== null);
  return known.length ? known.filter(Boolean).length / known.length : null;
};

/** Per reason: a ticket the case requires is a true positive or, when missing, a false negative; any other ticket not on the case's allowed list is a false positive. */
export function handoffStats(runs: readonly CaseRun[]): { perReason: Record<HandoffReason, ReasonStats>; micro: ReasonStats } {
  const counts = Object.fromEntries(HandoffReason.options.map((r) => [r, { tp: 0, fp: 0, fn: 0 }])) as Record<HandoffReason, { tp: number; fp: number; fn: number }>;
  for (const run of runs) {
    if (!run.result) continue;
    const actual = new Set(run.result.handoffs.map((h) => h.reason));
    for (const r of HandoffReason.options) {
      const expected = run.case.handoffs.includes(r);
      if (expected && actual.has(r)) counts[r].tp++;
      else if (expected) counts[r].fn++;
      else if (actual.has(r) && !run.case.allowHandoffs.includes(r)) counts[r].fp++;
    }
  }
  const stats = (c: { tp: number; fp: number; fn: number }): ReasonStats => ({ ...c, precision: ratio(c.tp, c.tp + c.fp), recall: ratio(c.tp, c.tp + c.fn) });
  const total = Object.values(counts).reduce((a, c) => ({ tp: a.tp + c.tp, fp: a.fp + c.fp, fn: a.fn + c.fn }), { tp: 0, fp: 0, fn: 0 });
  return {
    perReason: Object.fromEntries(Object.entries(counts).map(([r, c]) => [r, stats(c)])) as Record<HandoffReason, ReasonStats>,
    micro: stats(total),
  };
}

export interface RetrievalStats {
  recallAt5: number;
  questions: number;
  misses: string[];
  falsePositives: string[];
  negatives: number;
  /** Cross-lingual and paraphrase questions are left out for the hashing embedder, as in the unit tests. */
  skippedSemantic: number;
}

export async function retrievalStats(kb: KnowledgeBase, golden: GoldenSet): Promise<RetrievalStats> {
  const lexicalOnly = kb.embedderId.startsWith("hashing");
  const positives = golden.positives.filter((p) => !(lexicalOnly && p.semantic));
  const misses: string[] = [];
  for (const p of positives) {
    const r = await kb.search(p.q, { listingId: p.listingId, k: 5 });
    if (!r.results.some((h) => p.expect.includes(h.chunkId))) misses.push(p.q);
  }
  const falsePositives: string[] = [];
  for (const n of golden.negatives) if ((await kb.search(n.q, { listingId: n.listingId })).found) falsePositives.push(n.q);
  return {
    recallAt5: 1 - misses.length / positives.length,
    questions: positives.length,
    misses,
    falsePositives,
    negatives: golden.negatives.length,
    skippedSemantic: golden.positives.length - positives.length,
  };
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;

export interface Summary {
  cases: number;
  passed: number;
  errors: number;
  forcedHandoffs: number;
  handoffs: ReturnType<typeof handoffStats>;
  groundedness: number | null;
  firstDraftGroundedness: number | null;
  correctness: number | null;
  judged: number;
  retrieval: RetrievalStats | null;
  meanCostUsd: number | null;
  totalCostUsd: number | null;
  judgeCostUsd: number | null;
  meanLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

export function summarise(runs: readonly CaseRun[], scores: readonly CaseScore[], retrieval: RetrievalStats | null): Summary {
  const costs = runs.map((r) => r.costUsd);
  const knownCost = costs.every((c) => c !== null);
  const total = knownCost ? (costs as number[]).reduce((a, b) => a + b, 0) : null;
  const judgeCosts = runs.filter((r) => r.verdict).map((r) => r.judgeCostUsd ?? null);
  const latencies = runs.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    cases: runs.length,
    passed: scores.filter((s) => s.passed).length,
    errors: runs.filter((r) => r.error).length,
    forcedHandoffs: runs.filter((r) => r.result?.outcome.status === "forced_handoff").length,
    handoffs: handoffStats(runs),
    groundedness: share(scores.map((s) => s.grounded)),
    firstDraftGroundedness: share(scores.map((s) => s.firstDraftGrounded)),
    correctness: share(scores.map((s) => s.correct)),
    judged: scores.filter((s) => s.correct !== null).length,
    retrieval,
    meanCostUsd: total === null || !runs.length ? null : total / runs.length,
    totalCostUsd: total,
    judgeCostUsd: judgeCosts.length && judgeCosts.every((c) => c !== null) ? (judgeCosts as number[]).reduce((a, b) => a + b, 0) : null,
    meanLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
  };
}

/** The metrics thresholds can name. Higher is better for every one under `min`, lower for every one under `max`. */
export function metricValues(s: Summary): Record<string, number | null> {
  return {
    passRate: s.cases ? s.passed / s.cases : null,
    handoffPrecision: s.handoffs.micro.precision,
    handoffRecall: s.handoffs.micro.recall,
    groundedness: s.groundedness,
    firstDraftGroundedness: s.firstDraftGroundedness,
    correctness: s.correctness,
    retrievalRecallAt5: s.retrieval?.recallAt5 ?? null,
    retrievalFalsePositives: s.retrieval?.falsePositives.length ?? null,
    meanCostUsd: s.meanCostUsd,
    p95LatencyMs: s.p95LatencyMs,
  };
}

export interface Thresholds {
  min?: Record<string, number>;
  max?: Record<string, number>;
  note?: string;
}

export interface ThresholdCheck {
  metric: string;
  kind: "min" | "max";
  limit: number;
  value: number | null;
  /** null: the metric was not measured in this run (no judge, for instance), so it neither passes nor fails. */
  ok: boolean | null;
}

export function loadThresholds(file: string): Thresholds {
  return JSON.parse(readFileSync(file, "utf8")) as Thresholds;
}

export function checkThresholds(s: Summary, t: Thresholds): ThresholdCheck[] {
  const values = metricValues(s);
  const checks: ThresholdCheck[] = [];
  for (const kind of ["min", "max"] as const) {
    for (const [metric, limit] of Object.entries(t[kind] ?? {})) {
      if (!(metric in values)) throw new Error(`thresholds: unknown metric "${metric}". Known: ${Object.keys(values).join(", ")}`);
      const value = values[metric] ?? null;
      checks.push({ metric, kind, limit, value, ok: value === null ? null : kind === "min" ? value >= limit - 1e-9 : value <= limit + 1e-9 });
    }
  }
  return checks;
}
