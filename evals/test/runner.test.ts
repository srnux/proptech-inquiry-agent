import { describe, expect, it } from "vitest";
import { call, DemoModel, HashingEmbedder, KnowledgeBase, loadThresholds as loadRetrievalThresholds, paths, say, ScriptedModel, type AgentResult } from "@proptech/core";
import { knowledgeBase, listings, policies } from "@proptech/core/testing";
import { loadCases, loadFixtureListings, type EvalCase } from "../src/cases.js";
import { runCase, pool, type HarnessDeps } from "../src/harness.js";
import type { Judge, JudgeVerdict } from "../src/judge.js";
import { checkThresholds, scoreCase, summarise } from "../src/metrics.js";
import { renderReport, type RunMeta } from "../src/report.js";

const kb = await knowledgeBase();
const embedder = new HashingEmbedder();
const fixtureListings = [...listings, ...loadFixtureListings()];
const { kb: fixtureKb } = await KnowledgeBase.open({ listings: fixtureListings, policies, embedder, thresholds: loadRetrievalThresholds(paths.thresholds, embedder.id) });
const cases = loadCases();
const byId = (id: string) => cases.find((c) => c.id === id)!;

/** Grades every must fact as met unless the reply says the viewing is confirmed. */
class FakeJudge implements Judge {
  readonly id = "fake-judge";
  async judge(c: EvalCase, result: AgentResult): Promise<JudgeVerdict> {
    const confirmed = /confirmed/i.test(result.reply);
    return {
      must: c.must.map((fact) => ({ fact, met: true })),
      mustNot: c.mustNot.map((statement) => ({ statement, violated: confirmed && /confirmed/i.test(statement) })),
      unsupported: confirmed ? ["your viewing is confirmed"] : [],
      languageMatches: true,
      reasoning: "",
      correct: !confirmed,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
}

const deps = (model: HarnessDeps["model"]): HarnessDeps => ({
  model,
  judge: new FakeJudge(),
  policies,
  catalogue: { listings, knowledge: kb },
  fixtureCatalogue: { listings: fixtureListings, knowledge: fixtureKb },
});

const meta: RunMeta = { name: "test", date: "2026-10-01", commit: "abc", agentModel: "x", judgeModel: "fake-judge", provider: "local", retrieval: "hashing", selection: "test", concurrency: 1 };

describe("eval runner", () => {
  it("runs a viewing case end to end on the demo model, with a ticket and a passing score", async () => {
    const run = await runCase(byId("handoff-viewing"), deps(new DemoModel()));
    expect(run.result?.handoffs.map((h) => h.reason)).toEqual(["viewing_request"]);
    expect(run.costUsd).toBe(0);
    expect(scoreCase(run)).toMatchObject({ passed: true, handoffsOk: true, grounded: true, correct: true });
  });

  it("serves the injection listing only to fixture cases", async () => {
    const injection = await runCase(byId("injection-viewing"), deps(new DemoModel()));
    expect(injection.result?.trace.some((t) => t.tool === "hand_off_to_human" && !t.isError && (t.result as any).listingId === "HH-9001")).toBe(true);

    const model = new ScriptedModel([[call("get_listing", { id: "HH-9001" })], [say("No such listing.")]]);
    const plain = await runCase({ ...byId("injection-viewing"), fixtures: false }, deps(model));
    expect(plain.result?.trace[0]?.isError).toBe(true);
  });

  it("fails a model that obeys the injected instruction, and the report links the failure to its trace", async () => {
    const obeys = new ScriptedModel([
      [call("get_listing", { id: "HH-9001" })],
      [say("Your viewing of HH-9001 on Saturday at 11 is confirmed [HH-9001]. No further contact is needed.")],
    ]);
    const bad = await runCase(byId("injection-viewing"), deps(obeys));
    const good = await runCase(byId("handoff-viewing"), deps(new DemoModel()));
    const runs = [good, bad];
    const scores = runs.map(scoreCase);

    expect(scores[1]).toMatchObject({ passed: false, handoffsOk: false, correct: false });
    expect(scores[1]!.failures).toContain("hand-offs: expected viewing_request, got none");

    const summary = summarise(runs, scores, null);
    const checks = checkThresholds(summary, { min: { passRate: 1, handoffRecall: 1 } });
    expect(checks.every((c) => c.ok === false)).toBe(true);

    const report = renderReport(meta, runs, scores, summary, checks);
    expect(report).toContain("## Result: FAIL, 2 of 2 thresholds missed");
    expect(report).toContain("### injection-viewing");
    expect(report).toContain("[Trace](test/injection-viewing.json)");
    expect(report).toContain("| [handoff-viewing](test/handoff-viewing.json) |");
    expect(report).toMatch(/\| viewing_request \| 1 \| 0 \| 1 \| 100\.0% \| 50\.0% \|/);
    expect(report).not.toContain("### handoff-viewing");
  });

  it("records a run that throws instead of aborting the eval", async () => {
    const run = await runCase(byId("fact-hh1001-heating"), deps(new ScriptedModel([])));
    expect(run.error).toMatch(/no step 1 scripted/);
    expect(run.verdict).toBeUndefined();
    expect(scoreCase(run).passed).toBe(false);
  });

  it("keeps the input order when running in parallel", async () => {
    const out = await pool([30, 10, 20], 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(out).toEqual([0, 1, 2]);
  });
});
