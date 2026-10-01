import { readFileSync } from "node:fs";
import { z } from "zod";
import { HandoffReason, HISTORY_LIMIT, ListingCatalogue, repoPath, type Listing } from "@proptech/core";

export const evalPaths = {
  cases: repoPath("evals/cases.jsonl"),
  rubric: repoPath("evals/rubric.md"),
  thresholds: repoPath("evals/thresholds.json"),
  fixtures: repoPath("evals/fixtures/listings.json"),
  reports: repoPath("evals/reports"),
};

/**
 * One eval case. `handoffs` is the exact set of reasons the run must create tickets for; `allowHandoffs` lists
 * reasons that are acceptable but not required (a pet "on request" may be passed to a colleague, or not), so
 * they count neither for nor against hand-off precision. `must` and `mustNot` are judged by the model judge
 * against the rubric; each listing id in `listings` must be named in the reply or attached to a ticket, checked in code.
 */
export const EvalCase = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    lang: z.enum(["de", "en"]),
    inquiry: z.string().min(1),
    history: z.array(z.object({ inquiry: z.string(), reply: z.string() })).max(HISTORY_LIMIT).default([]),
    listings: z.array(z.string()).default([]),
    handoffs: z.array(HandoffReason).default([]),
    allowHandoffs: z.array(HandoffReason).default([]),
    must: z.array(z.string().min(1)).default([]),
    mustNot: z.array(z.string().min(1)).default([]),
    tags: z.array(z.string()).default([]),
    /** Part of the small set run on every pull request (DECISIONS.md 33). */
    subset: z.boolean().default(false),
    /** Run against the catalogue plus the test-only listings in evals/fixtures (the prompt-injection listing). */
    fixtures: z.boolean().default(false),
  })
  .strict();
export type EvalCase = z.infer<typeof EvalCase>;

export function parseCases(text: string): EvalCase[] {
  const cases: EvalCase[] = [];
  const ids = new Set<string>();
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (e) {
      throw new Error(`cases line ${i + 1}: invalid JSON (${(e as Error).message})`);
    }
    const parsed = EvalCase.safeParse(raw);
    if (!parsed.success) throw new Error(`cases line ${i + 1}: ${z.prettifyError(parsed.error)}`);
    const c = parsed.data;
    if (ids.has(c.id)) throw new Error(`cases line ${i + 1}: duplicate id ${c.id}`);
    if (c.handoffs.some((r) => c.allowHandoffs.includes(r))) throw new Error(`case ${c.id}: a reason is both required and allowed`);
    ids.add(c.id);
    cases.push(c);
  });
  return cases;
}

export const loadCases = (file = evalPaths.cases) => parseCases(readFileSync(file, "utf8"));

export const loadFixtureListings = (file = evalPaths.fixtures): Listing[] => ListingCatalogue.parse(JSON.parse(readFileSync(file, "utf8")));
