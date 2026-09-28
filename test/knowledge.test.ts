import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Bm25Index } from "../src/retrieval/bm25.js";
import { HashingEmbedder } from "../src/retrieval/embedder.js";
import { loadGolden } from "../src/retrieval/golden.js";
import { KnowledgeBase, type KnowledgeBase as KB } from "../src/retrieval/knowledge.js";
import { InMemoryVectorStore } from "../src/retrieval/store.js";
import { knowledgeBase, listings, policies } from "./helpers.js";

let kb: KB;
beforeAll(async () => {
  kb = await knowledgeBase();
});

describe("listing filter", () => {
  it("never returns another listing's passage", async () => {
    const questions = ["Is heating included?", "How much is the deposit?", "Are pets allowed?", "What are the utilities?"];
    for (const l of listings) {
      for (const q of questions) {
        const r = await kb.search(q, { listingId: l.id, k: 10 });
        for (const hit of r.results) expect(hit.listingId === l.id || hit.source === "policy").toBe(true);
      }
    }
  });
});

describe("keyword terms", () => {
  it.each([
    ["What is the Hausgeld?", "B-2003#s2"],
    ["Do I need a WBS?", "B-2001#s5"],
    ["Is it a Staffelmiete?", "B-2002#s4"],
  ])("%s finds %s", async (q, expected) => {
    const r = await kb.search(q);
    expect(r.results.map((h) => h.chunkId)).toContain(expected);
  });

  it("weights coverage by IDF, so one rare word does not make a question answerable", () => {
    const idx = new Bm25Index([
      { id: "a", text: "shared areas are cleaned weekly" },
      { id: "b", text: "the flat has a balcony" },
      { id: "c", text: "the flat has a lift" },
    ]);
    const [top] = idx.score("is the flat in a safe area at night");
    expect(top!.coverage).toBeLessThan(0.5);
  });
});

describe("golden set, offline embedder", () => {
  const golden = loadGolden("evals/retrieval-golden.json");
  const positives = golden.positives.filter((p) => !p.semantic);

  it("puts an expected chunk in the top 5 for every non-semantic question", async () => {
    const misses: string[] = [];
    for (const p of positives) {
      const r = await kb.search(p.q, { listingId: p.listingId, k: 5 });
      if (!r.results.some((h) => p.expect.includes(h.chunkId))) misses.push(p.q);
    }
    expect(misses).toEqual([]);
  });

  it.each(golden.negatives.map((n) => [n.q, n.listingId] as const))("reports nothing relevant for: %s", async (q, listingId) => {
    const r = await kb.search(q, { listingId });
    expect(r).toMatchObject({ found: false, results: [] });
  });
});

describe("index cache", () => {
  it("reuses vectors for the same corpus and embedder, rebuilds when either changes", async () => {
    const cacheFile = join(mkdtempSync(join(tmpdir(), "pia-")), "index.json");
    const open = (embedder: HashingEmbedder, ls = listings) =>
      KnowledgeBase.open({ listings: ls, policies, embedder, thresholds: { minZ: 2, minCoverage: 0.3 }, cacheFile });

    expect((await open(new HashingEmbedder())).rebuilt).toBe(true);
    expect((await open(new HashingEmbedder())).rebuilt).toBe(false);
    expect((await open(new HashingEmbedder(256))).rebuilt).toBe(true);
    const edited = listings.map((l) => (l.id === "K-4002" ? { ...l, description: "Shop unit." } : l));
    expect((await open(new HashingEmbedder(256), edited)).rebuilt).toBe(true);
  });
});

describe("vector store", () => {
  it("rejects vectors of a different dimension", () => {
    const store = new InMemoryVectorStore();
    store.upsert([{ id: "a", vector: [1, 0] }]);
    expect(() => store.upsert([{ id: "b", vector: [1, 0, 0] }])).toThrow(/dimensions/);
  });
});

describe("specific before general", () => {
  it("ranks the listing's own deposit rule above the general deposit policy", async () => {
    const r = await kb.search("How much is the deposit?", { listingId: "K-4001" });
    expect(r.results[0]?.chunkId).toBe("K-4001#s4");
    expect(r.results.map((h) => h.chunkId)).toContain("policy:deposit#amount");
  });
});
