#!/usr/bin/env node
import "../env.js";
import { parseArgs } from "node:util";
import { loadServerDeps } from "../deps.js";
import { AnthropicModel, missingCredentials } from "./anthropic.js";
import { connectInProcess } from "./connect.js";
import { runInquiry } from "./loop.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { json: { type: "boolean" }, trace: { type: "boolean" } },
});
const inquiry = positionals.join(" ").trim();
if (!inquiry) {
  console.error('Usage: pnpm ask [--trace] [--json] "your inquiry"');
  process.exit(2);
}
const missing = missingCredentials();
if (missing) {
  console.error(`${missing} Retrieval and tools run locally; only the model is remote.`);
  process.exit(2);
}

// Diagnostics go to stderr; stdout carries the answer, so `pnpm ask --json | jq` works.
console.error("Loading knowledge index...");
const deps = await loadServerDeps();
const model = new AnthropicModel();
const mcp = await connectInProcess(deps);
const result = await runInquiry({ model, mcp }, inquiry);
await mcp.close();

if (values.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(result.reply);
  if (result.citations.length) {
    console.log(`\nCitations: ${result.citations.map((c) => c.chunkId ?? c.listingId).join(", ")}`);
  }
  for (const t of result.handoffs) console.log(`Ticket ${t.ticketId}: ${t.reason}${t.listingId ? ` (${t.listingId})` : ""} - ${t.summary}`);
  if (result.outcome.status === "forced_handoff") console.log(`Ended by the code: ${result.outcome.cause}`);
  if (values.trace) {
    console.log("\nTrace:");
    for (const e of result.trace) {
      console.log(`  ${e.turn}. ${e.tool}${e.forced ? " (forced)" : ""} ${JSON.stringify(e.arguments)} -> ${e.summary} [${e.durationMs} ms]`);
    }
  }
  const u = result.usage;
  console.log(`\n${model.id}: ${u.inputTokens} in, ${u.cacheReadTokens} cached, ${u.outputTokens} out`);
}
