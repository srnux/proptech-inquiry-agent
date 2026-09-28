/**
 * Prints the relevance signals of the golden set for the current embedder and proposes thresholds.
 * Run after changing a model or the corpus: `pnpm calibrate` (EMBEDDER=hashing for the offline one).
 * With a reranker configured (the default with e5), a second section prints the reranker scores, which
 * are what decides in that setup; the first section then only shows how well candidates are collected.
 * The proposal is printed, not written: the numbers go into retrieval.thresholds.json by hand.
 *
 * Columns: cosine, z (standard deviations above the mean similarity of all candidates),
 * rank (position of the best expected chunk in the vector ranking), keyword coverage.
 */
import { readFileSync } from "node:fs";
import { ListingCatalogue } from "../src/domain/listing.js";
import { loadPolicies } from "../src/retrieval/chunk.js";
import { embedderFromEnv } from "../src/retrieval/embedder.js";
import { rerankerFromEnv } from "../src/retrieval/reranker.js";
import { loadGolden } from "../src/retrieval/golden.js";
import { KnowledgeBase } from "../src/retrieval/knowledge.js";
import { paths } from "../src/retrieval/open.js";

const embedder = embedderFromEnv();
const semanticModel = !embedder.id.startsWith("hashing");
const { kb } = await KnowledgeBase.open({
  listings: ListingCatalogue.parse(JSON.parse(readFileSync(paths.listings, "utf8"))),
  policies: loadPolicies(paths.policies),
  embedder,
  thresholds: { minZ: Number.NEGATIVE_INFINITY, minCoverage: 0 },
  cacheFile: paths.cache(embedder.id),
});
const golden = loadGolden(paths.golden);
const f = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "-").padStart(7);

console.log(`embedder: ${embedder.id}\n`);
console.log(`POSITIVES: signals of the best expected chunk\n ${"cosine".padStart(7)} ${"z".padStart(7)} ${"rank".padStart(5)} ${"cover".padStart(7)}`);
const pos: { q: string; z: number; cov: number }[] = [];
for (const p of golden.positives) {
  if (p.semantic && !semanticModel) continue;
  const { vector, keyword } = await kb.signals(p.q, p.listingId);
  const rank = vector.findIndex((v) => p.expect.includes(v.id));
  const best = rank >= 0 ? vector[rank]! : undefined;
  const cov = Math.max(0, ...keyword.filter((v) => p.expect.includes(v.id)).map((v) => v.coverage));
  pos.push({ q: p.q, z: best?.z ?? Number.NEGATIVE_INFINITY, cov });
  console.log(` ${f(best?.score ?? NaN)} ${f(best?.z ?? NaN, 2)} ${String(rank >= 0 ? rank + 1 : "-").padStart(5)} ${f(cov)}  ${p.q}`);
}

console.log(`\nNEGATIVES: best signal of any chunk (must stay below the thresholds)`);
const neg: { z: number; cov: number }[] = [];
for (const n of golden.negatives) {
  const { vector, keyword } = await kb.signals(n.q, n.listingId);
  const top = vector[0];
  const cov = Math.max(0, ...keyword.map((v) => v.coverage));
  neg.push({ z: top?.z ?? 0, cov });
  console.log(` ${f(top?.score ?? NaN)} ${f(top?.z ?? NaN, 2)} ${"".padStart(5)} ${f(cov)}  ${n.q}`);
}

const minZ = Math.max(...neg.map((n) => n.z)) + 0.1;
const minCoverage = Math.min(1, Math.max(...neg.map((n) => n.cov)) + 0.05);
const missed = pos.filter((p) => p.z < minZ && p.cov < minCoverage);
console.log(`\nproposed: { "minZ": ${minZ.toFixed(2)}, "minCoverage": ${minCoverage.toFixed(2)} }`);
console.log(`positives clearing a threshold: ${pos.length - missed.length}/${pos.length}`);
for (const m of missed) console.log(`  missed: ${m.q}`);

// Reranker: the signal that decides when one is configured (the default with e5).
const reranker = rerankerFromEnv();
if (reranker) {
  const { kb: rkb } = await KnowledgeBase.open({
    listings: ListingCatalogue.parse(JSON.parse(readFileSync(paths.listings, "utf8"))),
    policies: loadPolicies(paths.policies),
    embedder,
    thresholds: { minZ: Number.NEGATIVE_INFINITY, minCoverage: 0 },
    cacheFile: paths.cache(embedder.id),
    rerank: { reranker, minScore: 0 },
  });
  const s = (x: number | undefined) => (x === undefined ? "-" : x.toFixed(3)).padStart(7);
  console.log(`\n\nRERANKER: ${reranker.id}\n\nPOSITIVES: reranker score of the best expected chunk ("-": not among the candidates)`);
  const rpos: { q: string; score: number | undefined }[] = [];
  for (const p of golden.positives) {
    const { rerank } = await rkb.rerankSignals(p.q, p.listingId);
    const best = rerank.find((r) => p.expect.includes(r.id));
    const rank = best ? rerank.indexOf(best) + 1 : undefined;
    rpos.push({ q: p.q, score: best?.score });
    console.log(` ${s(best?.score)} ${String(rank ?? "-").padStart(4)}  ${p.q}`);
  }
  console.log(`\nNEGATIVES: highest reranker score of any candidate`);
  const rneg: number[] = [];
  for (const n of golden.negatives) {
    const { rerank } = await rkb.rerankSignals(n.q, n.listingId);
    rneg.push(rerank[0]?.score ?? 0);
    console.log(` ${s(rerank[0]?.score)}       ${n.q}  (${rerank[0]?.id ?? "-"})`);
  }
  const maxNeg = Math.max(...rneg);
  const found = rpos.filter((p) => p.score !== undefined && p.score > maxNeg);
  const lowestPos = Math.min(...found.map((p) => p.score!));
  const proposed = found.length > 0 ? (maxNeg + lowestPos) / 2 : maxNeg + 0.05;
  console.log(`\nhighest negative ${maxNeg.toFixed(3)}, lowest positive above it ${Number.isFinite(lowestPos) ? lowestPos.toFixed(3) : "-"}`);
  console.log(`proposed: { "minScore": ${proposed.toFixed(3)} }   (midpoint of that gap)`);
  console.log(`positives above every negative: ${found.length}/${rpos.length}`);
  for (const p of rpos.filter((x) => !found.includes(x))) console.log(`  missed: ${p.q}`);
}
