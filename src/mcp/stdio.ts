#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { InMemoryHandoffQueue } from "../domain/handoff.js";
import { InMemoryListingRepository } from "../domain/repository.js";
import { createServer } from "./server.js";

const dataFile = process.env.LISTINGS_FILE ?? fileURLToPath(new URL("../../data/listings.json", import.meta.url));

const server = createServer({
  listings: InMemoryListingRepository.fromFile(dataFile),
  handoffs: new InMemoryHandoffQueue(),
});

await server.connect(new StdioServerTransport());
// stdout belongs to the protocol; diagnostics go to stderr.
console.error(`proptech-inquiry MCP server ready (listings: ${dataFile})`);
