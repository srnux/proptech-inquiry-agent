import { readFileSync } from "node:fs";
import { ListingCatalogue, type Listing } from "../src/domain/listing.js";
import { loadPolicies } from "../src/retrieval/chunk.js";
import { HashingEmbedder, type Embedder } from "../src/retrieval/embedder.js";
import { KnowledgeBase, loadThresholds } from "../src/retrieval/knowledge.js";

export const listings: Listing[] = ListingCatalogue.parse(JSON.parse(readFileSync("data/listings.json", "utf8")));
export const policies = loadPolicies("data/policies");

export async function knowledgeBase(embedder: Embedder = new HashingEmbedder(), cacheFile?: string) {
  const { kb } = await KnowledgeBase.open({
    listings,
    policies,
    embedder,
    thresholds: loadThresholds("retrieval.thresholds.json", embedder.id),
    cacheFile,
  });
  return kb;
}
