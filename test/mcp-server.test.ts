import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryHandoffQueue } from "../src/domain/handoff.js";
import { InMemoryListingRepository } from "../src/domain/repository.js";
import { createServer } from "../src/mcp/server.js";

let client: Client;
let handoffs: InMemoryHandoffQueue;

beforeEach(async () => {
  handoffs = new InMemoryHandoffQueue(() => new Date("2026-09-28T09:00:00Z"));
  const server = createServer({ listings: InMemoryListingRepository.fromFile("data/listings.json"), handoffs });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

describe("MCP surface", () => {
  it("exposes exactly the three tools, with read-only hints on the reads", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_listing", "hand_off_to_human", "search_listings"]);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.search_listings?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get_listing?.annotations?.readOnlyHint).toBe(true);
    expect(byName.hand_off_to_human?.annotations?.readOnlyHint).toBe(false);
  });

  it("search_listings returns structured content", async () => {
    const res = await client.callTool({ name: "search_listings", arguments: { city: "Berlin", offerType: "sale" } });
    expect(res.structuredContent).toMatchObject({ total: 1, results: [{ id: "B-2003" }] });
  });

  it("rejects invalid input at the schema, before the handler runs", async () => {
    const res = await client.callTool({ name: "search_listings", arguments: { maxPrice: -5 } });
    expect(res.isError).toBe(true);
  });

  it("get_listing reports unknown ids as a tool error the model can recover from", async () => {
    const res = await client.callTool({ name: "get_listing", arguments: { id: "HH-9999" } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("search_listings");
  });

  it("hand_off_to_human enqueues a ticket", async () => {
    const res = await client.callTool({
      name: "hand_off_to_human",
      arguments: {
        reason: "viewing_request",
        listingId: "hh-1001",
        summary: "Wants to view the Eimsbüttel flat next week, has a small dog.",
        contactEmail: "jane@example.com",
      },
    });
    expect(res.isError).toBeFalsy();
    expect(handoffs.list()).toEqual([
      expect.objectContaining({ reason: "viewing_request", listingId: "HH-1001", createdAt: "2026-09-28T09:00:00.000Z" }),
    ]);
  });

  it("hand_off_to_human refuses a hallucinated listing id and enqueues nothing", async () => {
    const res = await client.callTool({
      name: "hand_off_to_human",
      arguments: { reason: "complaint", listingId: "HH-4242", summary: "Complains about noise.", contactEmail: null },
    });
    expect(res.isError).toBe(true);
    expect(handoffs.list()).toHaveLength(0);
  });
});
