import { randomUUID } from "node:crypto";
import { z } from "zod";

/**
 * The escalation boundary. Everything on this list is something the agent must
 * NOT resolve on its own, however confident it is.
 */
export const HandoffReason = z.enum([
  "viewing_request",
  "price_negotiation",
  "contract_or_legal",
  "complaint",
  "personal_data_request",
  "not_answerable_from_listing",
]);
export type HandoffReason = z.infer<typeof HandoffReason>;

export interface HandoffTicket {
  ticketId: string;
  createdAt: string;
  reason: HandoffReason;
  listingId: string | null;
  summary: string;
  contactEmail: string | null;
}

export interface HandoffQueue {
  enqueue(t: Omit<HandoffTicket, "ticketId" | "createdAt">): HandoffTicket;
  list(): readonly HandoffTicket[];
}

export class InMemoryHandoffQueue implements HandoffQueue {
  private readonly tickets: HandoffTicket[] = [];
  constructor(private readonly now: () => Date = () => new Date()) {}

  enqueue(t: Omit<HandoffTicket, "ticketId" | "createdAt">): HandoffTicket {
    const ticket = { ...t, ticketId: `T-${randomUUID().slice(0, 8)}`, createdAt: this.now().toISOString() };
    this.tickets.push(ticket);
    return ticket;
  }
  list() {
    return this.tickets;
  }
}
