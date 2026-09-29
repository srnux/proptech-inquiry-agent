import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { type AgentEvent, type AgentLimits, call, HISTORY_LIMIT, type Turn, HandoffReason, InMemoryHandoffQueue, InMemoryListingRepository, type ModelClient, type ModelRequest, type ModelResponse, runInquiry, say, ScriptedModel, SYSTEM_PROMPT, paths } from "@proptech/core";
import { createServer } from "../src/mcp/server.js";
import { knowledgeBase, policies } from "@proptech/core/testing";

const kb = await knowledgeBase();

async function harness(model: ModelClient, limits?: Partial<AgentLimits>) {
  const handoffs = new InMemoryHandoffQueue();
  const server = createServer({ listings: InMemoryListingRepository.fromFile(paths.listings), handoffs, knowledge: kb, policies });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "agent", version: "0.0.0" });
  await Promise.all([server.connect(b), mcp.connect(a)]);
  const events: AgentEvent[] = [];
  const run = (inquiry: string, history?: Turn[]) => runInquiry({ model, mcp, limits, onEvent: (e) => events.push(e) }, inquiry, history);
  return { run, handoffs, events };
}

const utilities = call("search_knowledge", { query: "Is heating included?", listingId: "HH-1001" });
const lookup = call("get_listing", { id: "HH-1001" }, "toolu_get");

describe("agent loop", () => {
  it("answers from one search and one lookup, with citations and a trace", async () => {
    const model = new ScriptedModel([
      [utilities],
      [lookup],
      [say("Ja, die Heizung ist in den Nebenkosten von 240 EUR enthalten [HH-1001#s5]. Die Kaltmiete beträgt 1.650 € [HH-1001].")],
    ]);
    const { run, handoffs, events } = await harness(model);

    const result = await run("Ist die Heizung bei HH-1001 inklusive?");

    expect(result.outcome).toEqual({ status: "answered" });
    expect(result.reply).toContain("240 EUR");
    expect(result.citations).toEqual([
      { listingId: "HH-1001", chunkId: "HH-1001#s5" },
      { listingId: "HH-1001", chunkId: null },
    ]);
    expect(result.trace.map((t) => t.tool)).toEqual(["search_knowledge", "get_listing"]);
    expect(result.trace[0]).toMatchObject({ arguments: { listingId: "HH-1001" }, isError: false });
    expect(result.trace[0]?.summary).toContain("HH-1001#s5");
    expect(result.trace[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.usage).toMatchObject({ inputTokens: 300, outputTokens: 60 });
    expect(result.handoffs).toEqual([]);
    expect(handoffs.list()).toHaveLength(0);
    expect(events.filter((e) => e.type === "trace")).toHaveLength(2);
  });

  it("sends the same system prompt and all four tools on every turn", async () => {
    const model = new ScriptedModel([[lookup], [say("Es kostet 1.650 € [HH-1001].")]]);
    const { run } = await harness(model);
    await run("Was kostet HH-1001?");
    expect(model.requests).toHaveLength(2);
    expect(model.requests.every((r) => r.system === SYSTEM_PROMPT)).toBe(true);
    expect(model.requests[0]?.tools.map((t) => t.name).sort()).toEqual(["get_listing", "hand_off_to_human", "search_knowledge", "search_listings"]);
  });

  it("the system prompt names every hand-off reason and the citation format", () => {
    for (const reason of HandoffReason.options) expect(SYSTEM_PROMPT).toContain(reason);
    expect(SYSTEM_PROMPT).toContain("[HH-1001#s5]");
  });

  it("citation guard catches a chunk the model never retrieved, and one repair turn fixes it", async () => {
    const model = new ScriptedModel([
      [lookup],
      [say("Die Heizung ist inklusive [HH-1001#s9].")],
      [say("Dazu steht in der Anzeige nichts Genaueres [HH-1001].")],
    ]);
    const { run, events } = await harness(model);

    const result = await run("Ist die Heizung inklusive?");

    expect(result.outcome).toEqual({ status: "answered" });
    expect(result.reply).toContain("nichts Genaueres");
    const repair = model.requests[2]?.messages.at(-1);
    expect(repair?.role).toBe("user");
    expect(JSON.stringify(repair?.content)).toContain("HH-1001#s9");
    expect(events.some((e) => e.type === "guard")).toBe(true);
  });

  it("number guard catches an invented price; when the repair repeats it, the run ends in a hand-off", async () => {
    const invented = say("Die Wohnung kostet nur 1.450 € kalt [HH-1001].");
    const model = new ScriptedModel([[lookup], [invented], [invented]]);
    const { run, handoffs } = await harness(model);

    const result = await run("Was kostet HH-1001?");

    expect(result.outcome).toMatchObject({ status: "forced_handoff", cause: "guard_failed" });
    expect(result.reply).not.toContain("1.450");
    expect(result.reply.length).toBeGreaterThan(0);
    expect(result.citations).toEqual([]);
    expect(result.handoffs).toHaveLength(1);
    expect(result.handoffs[0]).toMatchObject({ reason: "not_answerable_from_listing" });
    expect(handoffs.list()).toHaveLength(1);
    expect(result.trace.at(-1)).toMatchObject({ tool: "hand_off_to_human", forced: true });
    expect(model.requests).toHaveLength(3);
  });

  it("a viewing request produces a viewing_request ticket in the result and the queue", async () => {
    const model = new ScriptedModel([
      [
        call("hand_off_to_human", {
          reason: "viewing_request",
          listingId: "HH-1001",
          summary: "Wants to view HH-1001 on Saturday.",
          contactEmail: null,
        }),
      ],
      [say("Ich habe Ihre Besichtigungsanfrage an das Team weitergegeben.")],
    ]);
    const { run, handoffs } = await harness(model);

    const result = await run("Kann ich HH-1001 am Samstag besichtigen?");

    expect(result.outcome).toEqual({ status: "answered" });
    expect(result.handoffs).toHaveLength(1);
    expect(result.handoffs[0]).toMatchObject({ reason: "viewing_request", listingId: "HH-1001" });
    expect(handoffs.list()).toEqual(result.handoffs);
  });

  it("a tool error goes back to the model as an error result and the run continues", async () => {
    const model = new ScriptedModel([
      [call("get_listing", { id: "HH-9999" })],
      (req: ModelRequest) => {
        const last = req.messages.at(-1)!.content;
        expect(JSON.stringify(last)).toContain("search_listings");
        return [say("Diese Anzeige gibt es nicht.")];
      },
    ]);
    const { run } = await harness(model);
    const result = await run("Erzähl mir von HH-9999");
    expect(result.trace[0]).toMatchObject({ tool: "get_listing", isError: true });
    expect(result.outcome).toEqual({ status: "answered" });
  });

  it("the turn limit ends the run with a hand-off, not an exception", async () => {
    const model = new ScriptedModel([[lookup], [lookup], [lookup], [lookup]]);
    const { run, handoffs } = await harness(model, { maxTurns: 2 });

    const result = await run("Erzähl mir alles über HH-1001");

    expect(result.outcome).toMatchObject({ status: "forced_handoff", cause: "turn_limit" });
    expect(model.requests).toHaveLength(2);
    expect(handoffs.list()).toHaveLength(1);
    expect(result.reply.length).toBeGreaterThan(0);
  });

  it("the token budget ends the run with a hand-off", async () => {
    const model = new ScriptedModel([[lookup], [lookup], [lookup]]); // 120 tokens per turn
    const { run } = await harness(model, { tokenBudget: 200 });
    const result = await run("Erzähl mir alles über HH-1001");
    expect(result.outcome).toMatchObject({ status: "forced_handoff", cause: "token_budget" });
    expect(model.requests).toHaveLength(2);
  });

  it("a model call that exceeds its timeout ends the run with a hand-off", async () => {
    const hanging: ModelClient = {
      id: "hanging",
      complete: (req) =>
        new Promise<ModelResponse>((_, reject) => req.signal?.addEventListener("abort", () => reject(req.signal?.reason))),
    };
    const { run, handoffs } = await harness(hanging, { modelTimeoutMs: 20 });
    const result = await run("Hallo?");
    expect(result.outcome).toMatchObject({ status: "forced_handoff", cause: "model_timeout" });
    expect(handoffs.list()).toHaveLength(1);
  });

  it("an unexpected model error is not swallowed", async () => {
    const broken: ModelClient = { id: "broken", complete: async () => Promise.reject(new Error("401 invalid x-api-key")) };
    const { run, handoffs } = await harness(broken);
    await expect(run("Hallo?")).rejects.toThrow("401");
    expect(handoffs.list()).toHaveLength(0);
  });
});

describe("conversation history", () => {
  const first: Turn = {
    inquiry: "Ist die Heizung bei HH-1001 inklusive?",
    reply: "Ja, die Heizung ist in den Nebenkosten von 240 EUR enthalten [HH-1001#s5].",
  };

  it("sends earlier turns before the new inquiry, as plain user and assistant text", async () => {
    const model = new ScriptedModel([[say("Gern.")]]);
    const { run } = await harness(model);

    await run("Und die Kaution?", [first]);

    expect(model.requests[0]?.messages).toEqual([
      { role: "user", content: first.inquiry },
      { role: "assistant", content: [{ type: "text", text: first.reply }] },
      { role: "user", content: "Und die Kaution?" },
    ]);
  });

  it("keeps only the last HISTORY_LIMIT turns", async () => {
    const model = new ScriptedModel([[say("Gern.")]]);
    const { run } = await harness(model);
    const history = Array.from({ length: HISTORY_LIMIT + 2 }, (_, i) => ({ inquiry: `Frage ${i}`, reply: `Antwort ${i}` }));

    await run("Noch eine Frage?", history);

    const sent = model.requests[0]!.messages;
    expect(sent).toHaveLength(HISTORY_LIMIT * 2 + 1);
    expect(sent[0]).toEqual({ role: "user", content: "Frage 2" });
  });

  it("does not accept a citation that only an earlier reply contains: it must be retrieved again", async () => {
    const model = new ScriptedModel([
      [say("Wie gesagt, die Heizung ist inklusive [HH-1001#s5].")],
      [utilities],
      [say("Die Heizung ist inklusive [HH-1001#s5].")],
    ]);
    const { run, events } = await harness(model);

    const result = await run("Nochmal: ist die Heizung inklusive?", [first]);

    expect(events).toContainEqual(expect.objectContaining({ type: "guard", repairing: true }));
    expect(JSON.stringify(model.requests[1]?.messages.at(-1))).toContain("HH-1001#s5");
    expect(result.outcome).toEqual({ status: "answered" });
    expect(result.trace.map((t) => t.tool)).toEqual(["search_knowledge"]);
  });

  it("does not accept a figure that only an earlier reply contains", async () => {
    // 4.950 € is three months' rent worked out by hand: in the earlier reply, in no tool result.
    const earlier: Turn = { inquiry: "Wie hoch ist die Kaution bei HH-1001?", reply: "Die Kaution beträgt 4.950 € [HH-1001]." };
    const repeated = say("Wie gesagt, die Kaution beträgt 4.950 € [HH-1001].");
    const model = new ScriptedModel([[lookup], [repeated], [repeated]]);
    const { run } = await harness(model);

    const result = await run("Nochmal, wie hoch war die Kaution?", [earlier]);

    expect(result.outcome).toMatchObject({ status: "forced_handoff", cause: "guard_failed" });
  });

  it("accepts a figure the inquirer stated in an earlier turn", async () => {
    const model = new ScriptedModel([[lookup], [say("Unter 2.000 € passt HH-1001 [HH-1001].")]]);
    const { run } = await harness(model);

    const result = await run("Passt HH-1001?", [{ inquiry: "Ich suche etwas unter 2.000 €.", reply: "Gern, welche Wohnung interessiert Sie?" }]);

    expect(result.outcome).toEqual({ status: "answered" });
  });
});
