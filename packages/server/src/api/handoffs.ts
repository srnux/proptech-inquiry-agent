import type { ServerResponse } from "node:http";
import type { ServerDeps } from "../mcp/server.js";

/**
 * GET /handoffs: the hand-off queue as server-sent events. One `snapshot` with every ticket so far, then one
 * `ticket` event per new ticket, whether the agent or an external MCP client created it.
 */
export function handleHandoffStream(res: ServerResponse, { handoffs }: ServerDeps): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(`event: snapshot\ndata: ${JSON.stringify(handoffs.list())}\n\n`);
  const stop = handoffs.subscribe((ticket) => res.write(`event: ticket\ndata: ${JSON.stringify(ticket)}\n\n`));
  // Proxies drop idle connections; a comment line every 25 s keeps this one open.
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  res.on("close", () => {
    clearInterval(ping);
    stop();
  });
}
