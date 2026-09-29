#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InMemoryHandoffQueue, InMemoryListingRepository, loadPolicies, openKnowledgeBase, paths } from "@proptech/core";
import { createServer } from "./server.js";

// stdout belongs to the protocol; every diagnostic goes to stderr.
const started = Date.now();
const { kb, rebuilt } = await openKnowledgeBase();
// Load both models now, so the first real question does not wait for them.
await kb.search("warm-up");
console.error(
  `knowledge index ${rebuilt ? "built" : "loaded"} with ${kb.embedderId}` +
    `${kb.rerankerId ? `, reranker ${kb.rerankerId}` : ""}: ${kb.chunks.length} chunks in ${Date.now() - started} ms`,
);

const server = createServer({
  listings: InMemoryListingRepository.fromFile(paths.listings),
  handoffs: new InMemoryHandoffQueue(),
  knowledge: kb,
  policies: loadPolicies(paths.policies),
});

await server.connect(new StdioServerTransport());
console.error(`proptech-inquiry MCP server ready (listings: ${paths.listings})`);
