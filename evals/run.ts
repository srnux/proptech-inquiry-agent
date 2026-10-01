#!/usr/bin/env node
import "@proptech/server/env";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  embedderFromEnv,
  embedTextFromEnv,
  KnowledgeBase,
  ListingCatalogue,
  loadGolden,
  loadPolicies,
  loadRerankThreshold,
  loadThresholds as loadRetrievalThresholds,
  openKnowledgeBase,
  paths,
  rerankerFromEnv,
} from "@proptech/core";
import { AnthropicModel, bedrockModel, missingCredentials, providerFromEnv, type Effort, type Provider } from "@proptech/server/anthropic";
import { modelFromEnv } from "@proptech/server/select";
import { evalPaths, loadCases, loadFixtureListings } from "./src/cases.js";
import { pool, runCase } from "./src/harness.js";
import { ModelJudge } from "./src/judge.js";
import { checkThresholds, loadThresholds, retrievalStats, scoreCase, summarise } from "./src/metrics.js";
import { renderReport, traceFile, type RunMeta } from "./src/report.js";

const { values } = parseArgs({
  options: {
    subset: { type: "boolean" },
    case: { type: "string", multiple: true },
    "no-judge": { type: "boolean" },
    concurrency: { type: "string", default: "3" },
    name: { type: "string" },
  },
});

const usage = "Usage: pnpm eval [--subset] [--case <id>]... [--no-judge] [--concurrency 3] [--name <report name>]";
const choice = modelFromEnv();
if ("error" in choice) {
  console.error(`${choice.error} MODEL_PROVIDER=demo runs the cases on the demo model.\n${usage}`);
  process.exit(2);
}
const model = choice.model;

/** DECISIONS.md 34: the judge is a different model from the agent, Sonnet by default. */
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "claude-sonnet-5-5";
let judge: ModelJudge | undefined;
if (!values["no-judge"]) {
  // The judge runs where the agent runs; JUDGE_PROVIDER overrides it (the demo agent has no provider of its own).
  const provider = (process.env.JUDGE_PROVIDER as Provider | undefined) ?? (process.env.MODEL_PROVIDER === "demo" ? "anthropic" : providerFromEnv());
  const missing = missingCredentials(provider);
  if (missing) {
    console.error(`The judge needs credentials: ${missing} Or pass --no-judge to skip answer correctness.`);
    process.exit(2);
  }
  const judgeModel = new AnthropicModel({
    provider,
    model: provider === "bedrock" && !JUDGE_MODEL.includes(".") ? bedrockModel(JUDGE_MODEL) : JUDGE_MODEL,
    effort: (process.env.JUDGE_EFFORT as Effort | undefined) ?? "medium",
  });
  judge = new ModelJudge(judgeModel, readFileSync(evalPaths.rubric, "utf8"));
}

let cases = loadCases();
const all = cases.length;
if (values.subset) cases = cases.filter((c) => c.subset);
if (values.case?.length) {
  const unknown = values.case.filter((id) => !cases.some((c) => c.id === id));
  if (unknown.length) {
    console.error(`Unknown case ids: ${unknown.join(", ")}\n${usage}`);
    process.exit(2);
  }
  cases = cases.filter((c) => values.case!.includes(c.id));
}
const concurrency = Math.max(1, Number(values.concurrency) || 1);

console.error("Loading knowledge index...");
const embedder = embedderFromEnv();
const embedText = embedTextFromEnv();
const reranker = rerankerFromEnv();
const { kb } = await openKnowledgeBase(embedder, embedText, reranker);
const listings = ListingCatalogue.parse(JSON.parse(readFileSync(paths.listings, "utf8")));
const policies = loadPolicies(paths.policies);
const fixtureListings = [...listings, ...loadFixtureListings()];
const { kb: fixtureKb } = await KnowledgeBase.open({
  listings: fixtureListings,
  policies,
  embedder,
  embedText,
  thresholds: loadRetrievalThresholds(paths.thresholds, embedder.id),
  cacheFile: paths.cache(embedder.id, embedText).replace(/\.json$/, ".evals.json"),
  rerank: reranker && { reranker, minScore: loadRerankThreshold(paths.thresholds, reranker.id) },
});

console.error("Retrieval golden set...");
const retrieval = await retrievalStats(kb, loadGolden(paths.golden));

console.error(`Running ${cases.length} cases on ${model.id}${judge ? `, judged by ${judge.id}` : ""}...`);
let done = 0;
const runs = await pool(cases, concurrency, async (c) => {
  const run = await runCase(c, { model, judge, policies, catalogue: { listings, knowledge: kb }, fixtureCatalogue: { listings: fixtureListings, knowledge: fixtureKb } });
  const s = scoreCase(run);
  console.error(`  [${++done}/${cases.length}] ${s.passed ? "pass" : "FAIL"} ${c.id} (${(run.latencyMs / 1000).toFixed(1)} s)`);
  return run;
});

const scores = runs.map(scoreCase);
const summary = summarise(runs, scores, retrieval);
const checks = checkThresholds(summary, loadThresholds(evalPaths.thresholds));

const date = new Date().toISOString().slice(0, 10);
const partial = values.case?.length ? "-cases" : values.subset ? "-subset" : "";
const name = values.name ?? `${date}${partial}`;
let commit = "unknown";
try {
  commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  if (execSync("git status --porcelain", { encoding: "utf8" }).trim()) commit += " + local changes";
} catch {
  // not a git checkout
}
const meta: RunMeta = {
  name,
  date,
  commit,
  agentModel: model.id,
  judgeModel: judge?.id ?? null,
  provider: model instanceof AnthropicModel ? model.provider : "local",
  retrieval: `${embedder.id}${reranker ? ` + ${reranker.id}` : ", no reranker"}`,
  selection: values.case?.length ? `${cases.length} chosen of ${all}` : values.subset ? `subset, ${cases.length} of ${all}` : `all ${all}`,
  concurrency,
};

const traceDir = join(evalPaths.reports, name);
mkdirSync(traceDir, { recursive: true });
runs.forEach((run, i) => writeFileSync(join(traceDir, `${run.case.id}.json`), `${JSON.stringify(traceFile(run, scores[i]!), null, 2)}\n`));
const reportFile = join(evalPaths.reports, `${name}.md`);
writeFileSync(reportFile, `${renderReport(meta, runs, scores, summary, checks)}\n`);

console.log(`\n${summary.passed}/${summary.cases} cases passed. Report: ${reportFile}`);
for (const c of checks) {
  const v = c.value === null ? "n/a" : Number.isInteger(c.value) ? String(c.value) : c.value.toFixed(4);
  console.log(`  ${c.ok === null ? "skip" : c.ok ? " ok " : "MISS"}  ${c.metric} = ${v} (${c.kind} ${c.limit})`);
}
process.exit(checks.some((c) => c.ok === false) ? 1 : 0);
