#!/usr/bin/env node
import "../env.js";
import { AnthropicModel, missingCredentials } from "../agent/anthropic.js";
import { loadServerDeps } from "../deps.js";
import { createHttpServer } from "./app.js";

const missing = missingCredentials();
if (missing) {
  console.error(`${missing} /inquiries needs the model. /mcp alone would not.`);
  process.exit(2);
}
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1"; // local only by default: there is no authentication
const model = new AnthropicModel();
const server = createHttpServer(await loadServerDeps(), model);
server.listen(port, host, () => console.error(`POST /inquiries and /mcp on http://${host}:${port} (model ${model.id} via ${model.provider})`));
