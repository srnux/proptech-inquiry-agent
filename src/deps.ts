import { InMemoryHandoffQueue } from "./domain/handoff.js";
import { InMemoryListingRepository } from "./domain/repository.js";
import type { ServerDeps } from "./mcp/server.js";
import { loadPolicies } from "./retrieval/chunk.js";
import { openKnowledgeBase, paths } from "./retrieval/open.js";

/** Listings, knowledge base, policies and an empty hand-off queue, wired from files on disk. */
export async function loadServerDeps(): Promise<ServerDeps> {
  const { kb } = await openKnowledgeBase();
  await kb.search("warm-up"); // load both models now, not during the first inquiry
  return {
    listings: InMemoryListingRepository.fromFile(paths.listings),
    handoffs: new InMemoryHandoffQueue(),
    knowledge: kb,
    policies: loadPolicies(paths.policies),
  };
}
