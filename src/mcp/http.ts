import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type ServerDeps } from "./server.js";

const rpcError = (res: ServerResponse, status: number, message: string) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
};

/**
 * Streamable HTTP for the MCP server, stateless: every POST gets its own server and transport over the
 * shared listings, knowledge base and hand-off queue (DECISIONS.md 24). Nothing to expire or clean up.
 */
export function mcpHttpHandler(deps: ServerDeps) {
  return async (req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> => {
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      return rpcError(res, 405, "Method not allowed: this server is stateless, use POST.");
    }
    const server = createServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      console.error("MCP request failed:", e);
      if (!res.headersSent) rpcError(res, 500, "Internal server error");
    }
  };
}
