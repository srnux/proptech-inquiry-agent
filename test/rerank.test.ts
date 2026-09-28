import { describe, expect, it } from "vitest";
import { HashingEmbedder } from "../src/retrieval/embedder.js";
import { KnowledgeBase } from "../src/retrieval/knowledge.js";
import type { Reranker } from "../src/retrieval/reranker.js";
import { listings, policies } from "./helpers.js";

/** Scores a passage 0.9 if it contains the marker word, 0.01 otherwise, and records what it saw. */
class MarkerReranker implements Reranker {
  readonly id = "marker";
  seen: string[] = [];
  constructor(private readonly marker: RegExp) {}
  async score(_query: string, passages: string[]) {
    this.seen.push(...passages);
    return passages.map((p) => (this.marker.test(p) ? 0.9 : 0.01));
  }
}

async function kbWith(reranker: Reranker, minScore = 0.5) {
  const { kb } = await KnowledgeBase.open({
    listings,
    policies,
    embedder: new HashingEmbedder(),
    thresholds: { minZ: 99, minCoverage: 99 },
    rerank: { reranker, minScore },
  });
  return kb;
}

describe("search with a reranker", () => {
  it("lets the reranker alone decide what answers the question", async () => {
    // Vector and keyword thresholds are set impossibly high: only the reranker can pass anything.
    const kb = await kbWith(new MarkerReranker(/heating included/));
    const r = await kb.search("Is heating included?", { listingId: "HH-1001" });
    expect(r.found).toBe(true);
    expect(r.results.map((h) => h.chunkId)).toEqual(["HH-1001#s5"]);
    expect(r.results[0]!.rerank).toBe(0.9);
  });

  it("returns found: false when the reranker rejects every candidate", async () => {
    const kb = await kbWith(new MarkerReranker(/nothing matches this/));
    expect(await kb.search("Is heating included?", { listingId: "HH-1001" })).toMatchObject({ found: false, results: [] });
  });

  it("only shows the reranker passages that survived the listing filter, with their header", async () => {
    const reranker = new MarkerReranker(/./);
    const kb = await kbWith(reranker);
    await kb.search("Deposit?", { listingId: "K-4001" });
    expect(reranker.seen.length).toBeGreaterThan(0);
    for (const passage of reranker.seen) {
      const aboutOtherListing = listings.some((l) => l.id !== "K-4001" && passage.includes(`(${l.id},`));
      expect(aboutOtherListing).toBe(false);
    }
    expect(reranker.seen.some((p) => p.includes("(K-4001, Deutz, Köln)"))).toBe(true);
  });

  it("keeps the listing's own passages ahead of policies", async () => {
    const kb = await kbWith(new MarkerReranker(/deposit/i));
    const r = await kb.search("How much is the deposit?", { listingId: "K-4001" });
    expect(r.results[0]?.chunkId).toBe("K-4001#s4");
  });
});
