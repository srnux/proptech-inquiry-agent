import { describe, expect, it } from "vitest";
import { chunkListings, chunkPolicies, splitSentences } from "../src/retrieval/chunk.js";
import { KnowledgeBase } from "../src/retrieval/knowledge.js";
import { listings, policies } from "./helpers.js";

describe("splitSentences", () => {
  it("keeps decimals and splits at sentence ends", () => {
    expect(splitSentences("Commission 3.57 percent including VAT. Ceilings are 3.4 m high. Pets on request.")).toEqual([
      "Commission 3.57 percent including VAT.",
      "Ceilings are 3.4 m high.",
      "Pets on request.",
    ]);
  });
});

describe("chunking", () => {
  const all = KnowledgeBase.corpus(listings, policies);

  it("produces unique, non-empty chunks", () => {
    expect(new Set(all.map((c) => c.chunkId)).size).toBe(all.length);
    expect(all.every((c) => c.text.length > 0)).toBe(true);
  });

  it("tags listing chunks with their listing and gives them a context header", () => {
    const c = chunkListings(listings).find((x) => x.chunkId === "HH-1001#s5")!;
    expect(c).toMatchObject({ source: "listing", listingId: "HH-1001", policy: null });
    expect(c.text).toMatch(/^Utilities/);
    expect(c.indexText).toContain("Eimsbüttel");
  });

  it("splits policies by section and keeps the page title for context", () => {
    const c = chunkPolicies(policies).find((x) => x.chunkId === "policy:deposit#payment-in-instalments")!;
    expect(c).toMatchObject({ source: "policy", listingId: null, policy: "deposit" });
    expect(c.indexText).toContain("Kaution");
  });

  it("changes the corpus hash when any text changes", () => {
    const changed = listings.map((l) => (l.id === "B-2001" ? { ...l, description: l.description + " Newly painted." } : l));
    expect(KnowledgeBase.hash(KnowledgeBase.corpus(changed, policies))).not.toBe(KnowledgeBase.hash(all));
  });
});
