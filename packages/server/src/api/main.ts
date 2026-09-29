#!/usr/bin/env node
import "../env.js";
import { parseArgs } from "node:util";
import { modelFromEnv } from "../agent/select.js";
import { loadServerDeps } from "../deps.js";
import { createHttpServer } from "./app.js";

// `pnpm dev` passes --demo-fallback: without credentials it serves the demo model instead of exiting.
const { values } = parseArgs({ options: { "demo-fallback": { type: "boolean" } } });
const choice = modelFromEnv({ demoFallback: values["demo-fallback"] });
if ("error" in choice) {
  console.error(`${choice.error} /inquiries needs the model. /mcp alone would not. MODEL_PROVIDER=demo runs without one.`);
  process.exit(2);
}
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1"; // local only by default: there is no authentication
console.error("Loading knowledge index (the first run downloads the retrieval models)...");
const server = createHttpServer(await loadServerDeps(), choice.model);
server.listen(port, host, () => console.error(`POST /inquiries and /mcp on http://${host}:${port} (${choice.label})`));
