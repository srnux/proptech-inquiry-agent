import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type ServerDeps } from "../mcp/server.js";

/**
 * An MCP client wired to our own server in the same process. The agent talks to it exactly as an external
 * client would, so tests and production run the same code path (DECISIONS.md 24).
 */
export async function connectInProcess(deps: ServerDeps): Promise<Client> {
  const server = createServer(deps);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "inquiry-agent", version: "0.3.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}
