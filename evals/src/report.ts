import { HandoffReason } from "@proptech/core";
import type { CaseRun } from "./harness.js";
import type { CaseScore, Summary, ThresholdCheck } from "./metrics.js";

export interface RunMeta {
  /** File name without extension; traces live in a folder of the same name next to the report. */
  name: string;
  date: string;
  commit: string;
  agentModel: string;
  judgeModel: string | null;
  provider: string;
  retrieval: string;
  selection: string;
  concurrency: number;
}

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const usd = (x: number | null | undefined) => (x === null || x === undefined ? "n/a" : `$${x.toFixed(4)}`);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const reasons = (rs: readonly string[]) => (rs.length ? rs.join(", ") : "none");

const formatMetric = (metric: string, v: number | null) =>
  v === null ? "n/a" : metric.endsWith("Usd") ? usd(v) : metric.endsWith("Ms") ? secs(v) : metric === "retrievalFalsePositives" ? String(v) : pct(v);

export const tracePath = (meta: Pick<RunMeta, "name">, caseId: string) => `${meta.name}/${caseId}.json`;

/** The markdown report: thresholds first, then hand-offs per reason, every case, and each failure with a link to its trace. */
export function renderReport(meta: RunMeta, runs: readonly CaseRun[], scores: readonly CaseScore[], summary: Summary, checks: readonly ThresholdCheck[]): string {
  const failed = checks.filter((c) => c.ok === false);
  const out: string[] = [];
  out.push(`# Eval report ${meta.name}`, "");
  out.push(
    `- Date: ${meta.date}, commit \`${meta.commit}\``,
    `- Agent: \`${meta.agentModel}\` (${meta.provider}); judge: ${meta.judgeModel ? `\`${meta.judgeModel}\`` : "none (run with --no-judge)"}`,
    `- Retrieval: ${meta.retrieval}`,
    `- Cases: ${meta.selection}, ${meta.concurrency} at a time (latency includes waiting for the shared local reranker)`,
    "- Cost: Claude API list prices per token; Bedrock bills at its own rates.",
    "",
  );

  out.push(`## Result: ${failed.length ? `FAIL, ${failed.length} of ${checks.length} thresholds missed` : `PASS, ${checks.length} thresholds met`}`, "");
  out.push("| Metric | Value | Threshold | |", "|---|---|---|---|");
  for (const c of checks) {
    out.push(`| ${c.metric} | ${formatMetric(c.metric, c.value)} | ${c.kind === "min" ? "≥" : "≤"} ${formatMetric(c.metric, c.limit)} | ${c.ok === null ? "not measured" : c.ok ? "ok" : "**missed**"} |`);
  }
  out.push("");
  out.push(
    `${summary.passed} of ${summary.cases} cases passed. ${summary.forcedHandoffs} ended in a hand-off forced by the code, ${summary.errors} threw. ` +
      `First drafts with every figure grounded: ${pct(summary.firstDraftGroundedness)}. ` +
      `Mean cost ${usd(summary.meanCostUsd)} per inquiry (${usd(summary.totalCostUsd)} in total, judge ${usd(summary.judgeCostUsd)}); ` +
      `latency mean ${secs(summary.meanLatencyMs)}, p50 ${secs(summary.p50LatencyMs)}, p95 ${secs(summary.p95LatencyMs)}.`,
    "",
  );

  out.push("## Hand-offs per reason", "", "| Reason | Correct | Extra | Missed | Precision | Recall |", "|---|---|---|---|---|---|");
  for (const r of HandoffReason.options) {
    const s = summary.handoffs.perReason[r];
    out.push(`| ${r} | ${s.tp} | ${s.fp} | ${s.fn} | ${pct(s.precision)} | ${pct(s.recall)} |`);
  }
  const m = summary.handoffs.micro;
  out.push(`| **all** | ${m.tp} | ${m.fp} | ${m.fn} | ${pct(m.precision)} | ${pct(m.recall)} |`, "");
  out.push("A ticket a case lists under `allowHandoffs` counts as neither correct nor extra.", "");

  if (summary.retrieval) {
    const r = summary.retrieval;
    out.push("## Retrieval", "");
    out.push(
      `Golden set: recall@5 ${pct(r.recallAt5)} over ${r.questions} questions${r.skippedSemantic ? ` (${r.skippedSemantic} cross-lingual or paraphrased ones skipped for the hashing embedder)` : ""}; ` +
        `${r.falsePositives.length} of ${r.negatives} questions without an answer returned a passage.`,
    );
    if (r.misses.length) out.push(`Misses: ${r.misses.map((q) => `"${q}"`).join(", ")}.`);
    if (r.falsePositives.length) out.push(`False positives: ${r.falsePositives.map((q) => `"${q}"`).join(", ")}.`);
    out.push("");
  }

  out.push("## Cases", "", "| Case | Tags | Hand-offs expected | Hand-offs created | Grounded | Judge | Latency | Cost | |", "|---|---|---|---|---|---|---|---|---|");
  runs.forEach((run, i) => {
    const s = scores[i]!;
    const judge = s.correct === null ? (run.judgeError ? "error" : "n/a") : s.correct ? "correct" : "**wrong**";
    out.push(
      `| [${s.id}](${tracePath(meta, s.id)}) | ${run.case.tags.join(", ")} | ${reasons(s.expectedHandoffs)} | ${reasons(s.actualHandoffs)} | ` +
        `${s.grounded === null ? "n/a" : s.grounded ? "yes" : "**no**"}${s.firstDraftGrounded === false ? " (repaired)" : ""} | ${judge} | ${secs(run.latencyMs)} | ${usd(run.costUsd)} | ${s.passed ? "pass" : "**fail**"} |`,
    );
  });
  out.push("");

  const failing = scores.map((s, i) => ({ s, run: runs[i]! })).filter(({ s }) => !s.passed);
  if (failing.length) {
    out.push("## Failures", "");
    for (const { s, run } of failing) {
      out.push(`### ${s.id}`, "", `[Trace](${tracePath(meta, s.id)}) · ${run.case.lang}`, "");
      out.push(`Inquiry: ${cell(run.case.inquiry)}`, "");
      if (run.result) out.push(...run.result.reply.split(/\r?\n/).map((l) => `> ${l}`), "");
      out.push(...s.failures.map((f) => `- ${cell(f)}`), "");
    }
  }
  return out.join("\n");
}

/** What goes into each trace file: the case, the full run and the judge's grading. */
export function traceFile(run: CaseRun, score: CaseScore) {
  return { case: run.case, score, latencyMs: run.latencyMs, costUsd: run.costUsd, error: run.error, guardEvents: run.guardEvents, result: run.result, verdict: run.verdict, judgeError: run.judgeError };
}
