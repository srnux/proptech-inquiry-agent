import { createServer as createNodeServer, type Server } from "node:http";
import type { AgentLimits, ModelClient } from "@proptech/core";
import { mcpHttpHandler } from "../mcp/http.js";
import type { ServerDeps } from "../mcp/server.js";
import { handleHandoffStream } from "./handoffs.js";
import { handleInquiry, readJson } from "./inquiries.js";
import { handleSource } from "./sources.js";

/**
 * One process, two doors onto the same tools and queue: /mcp for MCP clients, /inquiries for the agent.
 * The web app reads the rest: /handoffs (the live queue), /sources/:id (what a citation points at) and /health.
 */
export function createHttpServer(deps: ServerDeps, model: ModelClient, limits?: Partial<AgentLimits>): Server {
  const mcp = mcpHttpHandler(deps);
  return createNodeServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    try {
      if (path === "/health") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, model: model.id }));
      } else if (path === "/mcp") {
        await mcp(req, res, req.method === "POST" ? await readJson(req) : undefined);
      } else if (path === "/inquiries" && req.method === "POST") {
        await handleInquiry(await readJson(req), res, { model, server: deps, limits });
      } else if (path === "/handoffs" && req.method === "GET") {
        handleHandoffStream(res, deps);
      } else if (path.startsWith("/sources/") && req.method === "GET") {
        handleSource(path.slice("/sources/".length), res, deps);
      } else {
        res.writeHead(path === "/inquiries" ? 405 : 404, { "content-type": "application/json" }).end('{"error":"Not found"}');
      }
    } catch (e) {
      const bad = e instanceof SyntaxError || (e instanceof Error && e.message === "Request body too large");
      if (!bad) console.error(e);
      if (!res.headersSent) {
        res.writeHead(bad ? 400 : 500, { "content-type": "application/json" }).end(JSON.stringify({ error: bad ? "Invalid request body" : "Internal server error" }));
      } else res.end();
    }
  });
}
