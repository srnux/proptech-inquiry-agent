import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HandoffReason, type HandoffQueue } from "../domain/handoff.js";
import { OfferType, PropertyType } from "../domain/listing.js";
import type { ListingRepository } from "../domain/repository.js";
import type { PolicyPage } from "../retrieval/chunk.js";
import type { KnowledgeBase } from "../retrieval/knowledge.js";

export interface ServerDeps {
  listings: ListingRepository;
  handoffs: HandoffQueue;
  knowledge: KnowledgeBase;
  policies: PolicyPage[];
}

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>,
});

const toolError = (message: string) => ({
  isError: true,
  content: [{ type: "text" as const, text: message }],
});

/**
 * Tool descriptions are written for the model, not for humans: they say when to
 * use the tool, when NOT to, and what the agent may not do with the result.
 */
export function createServer({ listings, handoffs, knowledge, policies }: ServerDeps): McpServer {
  const server = new McpServer({ name: "proptech-inquiry", version: "0.2.0" });

  server.registerTool(
    "search_listings",
    {
      title: "Search listings",
      description:
        "Find listings by hard criteria (city, rent or sale, price ceiling, rooms, area, features, move-in date). " +
        "Use this when the inquirer states requirements. Returns summaries sorted by price, cheapest first. " +
        "Do not use it to answer questions about a specific listing's details; call get_listing for that.",
      inputSchema: {
        city: z.string().optional().describe("City name, e.g. Hamburg, Berlin, München, Köln"),
        offerType: OfferType.optional(),
        propertyType: PropertyType.optional(),
        maxPrice: z.number().positive().optional().describe("EUR per month for rent, EUR total for sale"),
        minRooms: z.number().positive().optional(),
        minAreaSqm: z.number().positive().optional(),
        features: z.array(z.string()).optional().describe("All must match, e.g. balcony, lift, garden, accessible"),
        hasPet: z.boolean().optional().describe("True if the inquirer has a pet. 'on-request' listings are kept; never promise them."),
        availableBy: z.iso.date().optional().describe("Latest acceptable move-in date, YYYY-MM-DD"),
        limit: z.number().int().min(1).max(25).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => json(listings.search(args)),
  );

  server.registerTool(
    "get_listing",
    {
      title: "Get listing",
      description:
        "Return the full record of one listing: structured fields and the description text. " +
        "Use it for facts such as price, size, rooms, floor, features and move-in date. " +
        "For a free-text question about the listing or general terms (deposit, utilities, pets, commission), " +
        "call search_knowledge with the listing id instead. Answer only from what these tools return.",
      inputSchema: { id: z.string().describe("Listing id, e.g. HH-1001") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const listing = listings.get(id);
      return listing ? json(listing) : toolError(`No listing with id ${id}. Use search_listings to find valid ids.`);
    },
  );

  server.registerTool(
    "search_knowledge",
    {
      title: "Search listing texts and policies",
      description:
        "Search the listing descriptions and the agency's policy pages for passages that answer a question. " +
        "Pass listingId when the question is about one listing: results are then limited to that listing and " +
        "the general policies, never another listing. Every fact you state must come from a returned passage; " +
        "cite its chunkId. If found is false, nothing relevant exists: do not answer from general knowledge, " +
        "hand off with reason not_answerable_from_listing.",
      inputSchema: {
        query: z.string().min(3).max(300).describe("The question, in the inquirer's words. German or English."),
        listingId: z.string().optional().describe("Restrict to this listing plus general policies"),
        k: z.number().int().min(1).max(10).optional().describe("Maximum passages, default 5"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, listingId, k }) => {
      const id = listingId?.trim().toUpperCase();
      if (id && !listings.get(id)) {
        return toolError(`No listing with id ${listingId}. Use search_listings to find valid ids, or omit listingId.`);
      }
      return json(await knowledge.search(query, { listingId: id, k }));
    },
  );

  for (const page of policies) {
    server.registerResource(
      `policy-${page.slug}`,
      `policy://${page.slug}`,
      { title: page.title, description: `Agency policy: ${page.title}`, mimeType: "text/markdown" },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: page.markdown }] }),
    );
  }

  server.registerTool(
    "hand_off_to_human",
    {
      title: "Hand off to a human agent",
      description:
        "Create a ticket for the letting or sales team. You MUST use this, and not answer yourself, for: " +
        "booking viewings, any price or rent negotiation, contract or legal questions, complaints, requests about " +
        "personal data, and any question the listing record does not answer. Summarise the inquiry in one or two " +
        "sentences so the human does not have to reread the thread.",
      inputSchema: {
        reason: HandoffReason,
        listingId: z.string().nullable().describe("Listing the inquiry is about, or null"),
        summary: z.string().min(10).max(500),
        contactEmail: z.email().nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ reason, listingId, summary, contactEmail }) => {
      if (listingId !== null && !listings.get(listingId)) {
        return toolError(`Unknown listing id ${listingId}. Pass null if the inquiry is not about a specific listing.`);
      }
      const ticket = handoffs.enqueue({ reason, listingId: listingId?.toUpperCase() ?? null, summary, contactEmail });
      return json(ticket);
    },
  );

  return server;
}
