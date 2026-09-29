/**
 * Build (or confirm) the knowledge index for the configured embedder and load the reranker.
 * First run downloads both models (about 120 MB and 570 MB) into .models/.
 */
import { openKnowledgeBase, paths } from "../src/retrieval/open.js";

const t = Date.now();
const { kb, rebuilt } = await openKnowledgeBase();
console.log(`${rebuilt ? "built" : "up to date"}: ${kb.chunks.length} chunks, ${kb.embedderId}, ${Date.now() - t} ms`);
console.log(`  index: ${paths.cache(kb.embedderId)}`);
if (kb.rerankerId) {
  const r = Date.now();
  await kb.search("warm-up");
  const q = Date.now();
  await kb.search("Is heating included?", { listingId: "HH-1001" });
  console.log(`reranker ${kb.rerankerId}: loaded in ${q - r} ms, one question in ${Date.now() - q} ms`);
}
