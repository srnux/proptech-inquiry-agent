/**
 * Experiment: does embedding the plain passage rank better than embedding it with its listing header?
 * Runs the golden set against both variants with the same model and prints them side by side.
 * Thresholds play no part here; this measures ranking only.
 *
 *   pnpm experiment:embed-text             (e5, the default)
 *   EMBEDDER=hashing pnpm experiment:embed-text
 */
import { readFileSync } from "node:fs";
import { ListingCatalogue } from "../src/domain/listing.js";
import { loadPolicies } from "../src/retrieval/chunk.js";
import { embedderFromEnv } from "../src/retrieval/embedder.js";
import { loadGolden } from "../src/retrieval/golden.js";
import { KnowledgeBase, type EmbedText } from "../src/retrieval/knowledge.js";
import { paths } from "../src/retrieval/open.js";

const embedder = embedderFromEnv();
const semanticModel = !embedder.id.startsWith("hashing");
const listings = ListingCatalogue.parse(JSON.parse(readFileSync(paths.listings, "utf8")));
const policies = loadPolicies(paths.policies);
const golden = loadGolden(paths.golden);
const positives = golden.positives.filter((p) => semanticModel || !p.semantic);

async function run(embedText: EmbedText) {
  const { kb } = await KnowledgeBase.open({
    listings,
    policies,
    embedder,
    embedText,
    thresholds: { minZ: Number.NEGATIVE_INFINITY, minCoverage: 0 },
    cacheFile: paths.cache(embedder.id, embedText),
  });
  const pos = [];
  for (const p of positives) {
    const { vector } = await kb.signals(p.q, p.listingId);
    const i = vector.findIndex((v) => p.expect.includes(v.id));
    pos.push({ rank: i >= 0 ? i + 1 : Infinity, z: i >= 0 ? vector[i]!.z : NaN });
  }
  const neg = [];
  for (const n of golden.negatives) neg.push((await kb.signals(n.q, n.listingId)).vector[0]?.z ?? 0);
  return { pos, neg };
}

const header = await run("header");
const plain = await run("plain");

const r = (x: number) => String(Number.isFinite(x) ? x : "-").padStart(4);
const z = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "-").padStart(6);
console.log(`embedder: ${embedder.id}\n`);
console.log(`VECTOR RANK OF THE EXPECTED CHUNK (and its z)\n ${"header".padStart(11)} ${"plain".padStart(11)}`);
positives.forEach((p, i) => {
  const h = header.pos[i]!;
  const pl = plain.pos[i]!;
  const mark = pl.rank < h.rank ? "+" : pl.rank > h.rank ? "-" : " ";
  console.log(` ${r(h.rank)} ${z(h.z)} ${r(pl.rank)} ${z(pl.z)} ${mark} ${p.q}`);
});

console.log(`\nNEGATIVES: z of the top chunk\n ${"header".padStart(6)} ${"plain".padStart(6)}`);
golden.negatives.forEach((n, i) => console.log(` ${z(header.neg[i]!)} ${z(plain.neg[i]!)}  ${n.q}`));

const summary = (pos: { rank: number; z: number }[], neg: number[]) => {
  const top1 = pos.filter((p) => p.rank === 1).length;
  const top5 = pos.filter((p) => p.rank <= 5).length;
  const mrr = pos.reduce((s, p) => s + (Number.isFinite(p.rank) ? 1 / p.rank : 0), 0) / pos.length;
  const maxNeg = Math.max(...neg);
  const aboveNeg = pos.filter((p) => p.z > maxNeg).length;
  return `top-1 ${top1}/${pos.length}   top-5 ${top5}/${pos.length}   MRR ${mrr.toFixed(3)}   z above every negative ${aboveNeg}/${pos.length}`;
};
console.log(`\nSUMMARY (vector side only, no keyword help)`);
console.log(`  header: ${summary(header.pos, header.neg)}`);
console.log(`  plain:  ${summary(plain.pos, plain.neg)}`);
