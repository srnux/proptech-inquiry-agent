import { readFileSync } from "node:fs";
import { ListingCatalogue, type Listing } from "./domain/listing.js";
import { loadPolicies } from "./retrieval/chunk.js";
import { HashingEmbedder, type Embedder } from "./retrieval/embedder.js";
import { KnowledgeBase, loadThresholds } from "./retrieval/knowledge.js";
import { paths } from "./retrieval/open.js";

/** Fixtures for tests in every package: the real catalogue and policies, indexed with the offline embedder. */
export const listings: Listing[] = ListingCatalogue.parse(JSON.parse(readFileSync(paths.listings, "utf8")));
export const policies = loadPolicies(paths.policies);

export async function knowledgeBase(embedder: Embedder = new HashingEmbedder(), cacheFile?: string) {
  const { kb } = await KnowledgeBase.open({
    listings,
    policies,
    embedder,
    thresholds: loadThresholds(paths.thresholds, embedder.id),
    cacheFile,
  });
  return kb;
}
