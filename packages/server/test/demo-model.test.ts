import { DemoModel, EXAMPLE_INQUIRIES, type Turn, InMemoryHandoffQueue, InMemoryListingRepository, paths, runInquiry } from "@proptech/core";
import { knowledgeBase, policies } from "@proptech/core/testing";
import { describe, expect, it } from "vitest";
import { connectInProcess } from "../src/agent/connect.js";

const kb = await knowledgeBase();

async function ask(inquiry: string, history: Turn[] = []) {
  const handoffs = new InMemoryHandoffQueue();
  const mcp = await connectInProcess({ listings: InMemoryListingRepository.fromFile(paths.listings), handoffs, knowledge: kb, policies });
  try {
    return await runInquiry({ model: new DemoModel(), mcp }, inquiry, history);
  } finally {
    await mcp.close();
  }
}
const example = (id: string) => EXAMPLE_INQUIRIES.find((e) => e.id === id)!.inquiry;

// The demo model's replies go through the same guards as the real model's: "answered" means they passed.
describe("demo model on the example inquiries", () => {
  it("answers the fact question from the retrieved passage, with its citation", async () => {
    const r = await ask(example("fact"));
    expect(r.outcome).toEqual({ status: "answered" });
    expect(r.trace.map((t) => t.tool)).toEqual(["search_knowledge"]);
    expect(r.citations).toContainEqual({ listingId: "HH-1001", chunkId: "HH-1001#s5" });
    expect(r.reply).toContain("heating included");
    expect(r.handoffs).toEqual([]);
  });

  it("hands a viewing request to a human with the inquirer's email, and confirms nothing", async () => {
    const r = await ask(example("viewing"));
    expect(r.outcome).toEqual({ status: "answered" });
    expect(r.handoffs).toMatchObject([{ reason: "viewing_request", listingId: "HH-1001", contactEmail: "jana.becker@example.com" }]);
    expect(r.reply).toContain("colleague");
  });

  it("hands off a question the record does not answer", async () => {
    const r = await ask(example("out-of-scope"));
    expect(r.outcome).toEqual({ status: "answered" });
    expect(r.trace[0]).toMatchObject({ tool: "search_knowledge", result: { found: false } });
    expect(r.handoffs).toMatchObject([{ reason: "not_answerable_from_listing", listingId: "HH-1001" }]);
  });

  it("finds the listing from the criteria in German, keeps pets on request, and hands off the viewing", async () => {
    const r = await ask(example("german"));
    expect(r.outcome).toEqual({ status: "answered" });
    expect(r.trace[0]).toMatchObject({ tool: "search_listings", arguments: { city: "Hamburg", maxPrice: 2000, hasPet: true } });
    expect(r.reply).toContain("HH-1001");
    expect(r.reply).toContain("nur auf Anfrage");
    expect(r.handoffs.map((t) => t.reason)).toContain("viewing_request");
  });

  it("hands off without a listing id when the named listing does not exist", async () => {
    const r = await ask("Is heating included in the rent for XX-9999?");
    expect(r.outcome).toEqual({ status: "answered" });
    expect(r.trace[0]).toMatchObject({ tool: "search_knowledge", isError: true });
    expect(r.handoffs).toMatchObject([{ reason: "not_answerable_from_listing", listingId: null }]);
    expect(r.citations).toEqual([]);
  });

  it("takes the listing from the conversation for a follow-up that names none", async () => {
    const first = await ask(example("fact"));
    const r = await ask("And what is the deposit?", [{ inquiry: example("fact"), reply: first.reply }]);
    expect(r.outcome).toEqual({ status: "answered" });
    expect(r.trace[0]).toMatchObject({ tool: "search_knowledge", arguments: { listingId: "HH-1001" } });
    expect(r.reply).toContain("Deposit is three months' cold rent");
  });
});
