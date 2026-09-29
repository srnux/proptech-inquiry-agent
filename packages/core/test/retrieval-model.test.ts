import { describe, expect, it } from "vitest";
import { E5Embedder } from "../src/retrieval/embedder.js";
import { KnowledgeBase, loadRerankThreshold, loadThresholds } from "../src/retrieval/knowledge.js";
import { BgeReranker } from "../src/retrieval/reranker.js";
import { loadGolden } from "../src/retrieval/golden.js";
import { paths } from "../src/retrieval/open.js";
import { listings, policies } from "../src/testing.js";

// Needs the real model. Run with `pnpm test:model`; skipped in the normal test run and in CI.
describe.runIf(process.env.RUN_MODEL_TESTS === "1")("golden set, e5 retrieval plus bge reranker", () => {
  const golden = loadGolden("evals/retrieval-golden.json");

  it("reaches recall@5 of at least 0.9 with no false positives, German and paraphrased questions included", async () => {
    const embedder = new E5Embedder();
    const reranker = new BgeReranker();
    const { kb } = await KnowledgeBase.open({
      listings,
      policies,
      embedder,
      thresholds: loadThresholds(paths.thresholds, embedder.id),
      cacheFile: paths.cache(embedder.id),
      rerank: { reranker, minScore: loadRerankThreshold(paths.thresholds, reranker.id) },
    });
    const misses: string[] = [];
    for (const p of golden.positives) {
      const r = await kb.search(p.q, { listingId: p.listingId, k: 5 });
      if (!r.results.some((h) => p.expect.includes(h.chunkId))) misses.push(p.q);
    }
    const recall = 1 - misses.length / golden.positives.length;
    console.log(`recall@5 = ${recall.toFixed(2)}; misses: ${JSON.stringify(misses)}`);

    const falsePositives: string[] = [];
    for (const n of golden.negatives) if ((await kb.search(n.q, { listingId: n.listingId })).found) falsePositives.push(n.q);
    console.log(`false positives: ${JSON.stringify(falsePositives)}`);
    expect(recall).toBeGreaterThanOrEqual(0.9);
    expect(falsePositives).toEqual([]);
  });
});
