import { describe, expect, it } from "vitest";
import { InMemoryHandoffQueue, type HandoffTicket } from "../src/domain/handoff.js";

const ticket = { reason: "complaint" as const, listingId: null, summary: "Complaint about noise.", contactEmail: null };

describe("hand-off queue subscriptions", () => {
  it("tells every subscriber about each new ticket, and stops after unsubscribe", () => {
    const queue = new InMemoryHandoffQueue();
    const a: HandoffTicket[] = [];
    const b: HandoffTicket[] = [];
    const stopA = queue.subscribe((t) => a.push(t));
    queue.subscribe((t) => b.push(t));

    const first = queue.enqueue(ticket);
    stopA();
    queue.enqueue(ticket);

    expect(a).toEqual([first]);
    expect(b).toHaveLength(2);
    expect(queue.list()).toHaveLength(2);
  });

  it("does not replay tickets created before the subscription", () => {
    const queue = new InMemoryHandoffQueue();
    queue.enqueue(ticket);
    const seen: HandoffTicket[] = [];
    queue.subscribe((t) => seen.push(t));
    expect(seen).toEqual([]);
  });
});
