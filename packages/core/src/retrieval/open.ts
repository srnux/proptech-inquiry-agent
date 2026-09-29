import { readFileSync } from "node:fs";
import { repoPath } from "../root.js";
import { ListingCatalogue } from "../domain/listing.js";
import { loadPolicies } from "./chunk.js";
import { embedderFromEnv, type Embedder } from "./embedder.js";
import { KnowledgeBase, loadRerankThreshold, loadThresholds, type EmbedText } from "./knowledge.js";
import { rerankerFromEnv, type Reranker } from "./reranker.js";


export const paths = {
  listings: process.env.LISTINGS_FILE ?? repoPath("data/listings.json"),
  policies: process.env.POLICIES_DIR ?? repoPath("data/policies"),
  thresholds: repoPath("retrieval.thresholds.json"),
  golden: repoPath("evals/retrieval-golden.json"),
  cache: (embedderId: string, embedText: EmbedText = "plain") =>
    repoPath(`.index/${embedderId.replace(/[^a-zA-Z0-9.@-]+/g, "_")}.${embedText}.json`),
};

export function embedTextFromEnv(env = process.env): EmbedText {
  const v = env.EMBED_TEXT ?? "plain";
  if (v !== "header" && v !== "plain") throw new Error(`Unknown EMBED_TEXT "${v}". Use "header" or "plain".`);
  return v;
}

/** Wire the knowledge base from files on disk. Used by the MCP entry point and the scripts. */
export async function openKnowledgeBase(
  embedder: Embedder = embedderFromEnv(),
  embedText = embedTextFromEnv(),
  reranker: Reranker | undefined = rerankerFromEnv(),
) {
  const listings = ListingCatalogue.parse(JSON.parse(readFileSync(paths.listings, "utf8")));
  const policies = loadPolicies(paths.policies);
  return KnowledgeBase.open({
    listings,
    policies,
    embedder,
    thresholds: loadThresholds(paths.thresholds, embedder.id),
    cacheFile: paths.cache(embedder.id, embedText),
    embedText,
    rerank: reranker && { reranker, minScore: loadRerankThreshold(paths.thresholds, reranker.id) },
  });
}
