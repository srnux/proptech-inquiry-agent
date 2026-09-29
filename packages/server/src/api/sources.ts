import type { ServerResponse } from "node:http";
import type { ServerDeps } from "../mcp/server.js";

/** What a citation chip opens: the cited passage and the document it comes from. */
export interface Source {
  id: string;
  kind: "listing" | "policy";
  /** Listing title or policy page title. */
  title: string;
  /** Listing id, or null for a policy passage. */
  listingId: string | null;
  /** The cited passage; null when the citation is a whole listing (`[HH-1001]`). */
  passage: string | null;
  /** The listing description or the policy page as markdown. */
  document: string;
  /** Structured fields, for a listing citation. */
  facts?: Record<string, unknown>;
}

/** Resolve a citation id (`HH-1001#s5`, `policy:pets#pets-on-request`, `HH-1001`) to its source, or undefined. */
export function findSource(id: string, { knowledge, listings, policies }: ServerDeps): Source | undefined {
  const chunk = knowledge.chunks.find((c) => c.chunkId === id);
  if (chunk?.source === "policy") {
    const page = policies.find((p) => p.slug === chunk.policy);
    return { id, kind: "policy", title: page?.title ?? chunk.policy!, listingId: null, passage: chunk.text, document: page?.markdown ?? chunk.text };
  }
  const listing = listings.get(chunk?.listingId ?? id);
  if (!listing) return undefined;
  const { description, title, ...facts } = listing;
  return { id, kind: "listing", title, listingId: listing.id, passage: chunk?.text ?? null, document: description, ...(!chunk && { facts }) };
}

/** GET /sources/:id */
export function handleSource(rawId: string, res: ServerResponse, deps: ServerDeps): void {
  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    id = rawId;
  }
  const source = findSource(id, deps);
  res.writeHead(source ? 200 : 404, { "content-type": "application/json" });
  res.end(JSON.stringify(source ?? { error: `No source with id ${id}` }));
}
