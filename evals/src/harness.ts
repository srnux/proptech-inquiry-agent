import {
  InMemoryHandoffQueue,
  InMemoryListingRepository,
  runInquiry,
  type AgentLimits,
  type AgentResult,
  type KnowledgeBase,
  type Listing,
  type ModelClient,
  type PolicyPage,
  type Violation,
} from "@proptech/core";
import { connectInProcess } from "@proptech/server/connect";
import type { EvalCase } from "./cases.js";
import { costUsd } from "./cost.js";
import type { Judge, JudgeVerdict } from "./judge.js";

/** The data one run sees: the real catalogue, or the catalogue plus the test-only fixtures. */
export interface Catalogue {
  listings: Listing[];
  knowledge: KnowledgeBase;
}

export interface HarnessDeps {
  model: ModelClient;
  judge?: Judge;
  policies: PolicyPage[];
  catalogue: Catalogue;
  /** Used for cases with `fixtures: true`. */
  fixtureCatalogue: Catalogue;
  limits?: Partial<AgentLimits>;
}

export interface CaseRun {
  case: EvalCase;
  /** Undefined when the run threw; `error` says why. */
  result?: AgentResult;
  error?: string;
  /** Guard failures the loop reported, before any repair. */
  guardEvents: { violations: Violation[]; repairing: boolean }[];
  latencyMs: number;
  costUsd: number | null;
  verdict?: JudgeVerdict;
  judgeError?: string;
  judgeCostUsd?: number | null;
}

/** Runs one case on a fresh server and hand-off queue, so no ticket leaks between cases, then judges the reply. */
export async function runCase(c: EvalCase, deps: HarnessDeps): Promise<CaseRun> {
  const { listings, knowledge } = c.fixtures ? deps.fixtureCatalogue : deps.catalogue;
  const mcp = await connectInProcess({
    listings: new InMemoryListingRepository(listings),
    handoffs: new InMemoryHandoffQueue(),
    knowledge,
    policies: deps.policies,
  });
  const guardEvents: CaseRun["guardEvents"] = [];
  const started = performance.now();
  let run: CaseRun;
  try {
    const result = await runInquiry(
      { model: deps.model, mcp, limits: deps.limits, onEvent: (e) => e.type === "guard" && guardEvents.push({ violations: e.violations, repairing: e.repairing }) },
      c.inquiry,
      c.history,
    );
    run = { case: c, result, guardEvents, latencyMs: Math.round(performance.now() - started), costUsd: costUsd(result.usage, deps.model.id) };
  } catch (e) {
    run = { case: c, error: e instanceof Error ? e.message : String(e), guardEvents, latencyMs: Math.round(performance.now() - started), costUsd: null };
  } finally {
    await mcp.close();
  }

  if (deps.judge && run.result) {
    try {
      run.verdict = await deps.judge.judge(c, run.result);
      run.judgeCostUsd = costUsd(run.verdict.usage, deps.judge.id);
    } catch (e) {
      run.judgeError = e instanceof Error ? e.message : String(e);
    }
  }
  return run;
}

/** Runs `fn` over `items` with at most `n` in flight, keeping the input order in the output. */
export async function pool<T, R>(items: readonly T[], n: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  return out;
}
