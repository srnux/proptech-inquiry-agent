import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { AnthropicModel, bedrockModel } from "../src/agent/anthropic.js";
import { call, say, ScriptedModel, type ModelClient } from "../src/agent/model.js";
import { createHttpServer } from "../src/api/app.js";
import { InMemoryHandoffQueue } from "../src/domain/handoff.js";
import { InMemoryListingRepository } from "../src/domain/repository.js";
import { knowledgeBase, policies } from "./helpers.js";

const kb = await knowledgeBase();
const open: { close(): void }[] = [];
afterEach(() => open.splice(0).forEach((s) => s.close()));

async function start(model: ModelClient) {
  const handoffs = new InMemoryHandoffQueue();
  const server = createHttpServer(
    { listings: InMemoryListingRepository.fromFile("data/listings.json"), handoffs, knowledge: kb, policies },
    model,
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  open.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, handoffs };
}

const sse = (body: string) =>
  body
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => {
      const event = /^event: (.*)$/m.exec(frame)![1]!;
      return { event, data: JSON.parse(/^data: (.*)$/m.exec(frame)![1]!) };
    });

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST /inquiries", () => {
  it("streams trace events, then the final result, as server-sent events", async () => {
    const { url, handoffs } = await start(
      new ScriptedModel([
        [call("get_listing", { id: "HH-1001" })],
        [call("hand_off_to_human", { reason: "viewing_request", listingId: "HH-1001", summary: "Wants to view on Saturday.", contactEmail: null })],
        [say("Die Wohnung HH-1001 kostet 1.650 € [HH-1001]. Die Besichtigung habe ich an das Team weitergegeben.")],
      ]),
    );

    const res = await post(`${url}/inquiries`, { inquiry: "Was kostet HH-1001, und kann ich Samstag besichtigen?" });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = sse(await res.text());
    expect(events.map((e) => e.event)).toEqual(["trace", "trace", "result"]);
    expect(events[0]?.data).toMatchObject({ tool: "get_listing" });
    const result = events[2]!.data;
    expect(result.outcome).toEqual({ status: "answered" });
    expect(result.handoffs).toHaveLength(1);
    expect(result.citations).toEqual([{ listingId: "HH-1001", chunkId: null }]);
    expect(handoffs.list()).toHaveLength(1);
  });

  it("rejects a body without an inquiry", async () => {
    const { url } = await start(new ScriptedModel([]));
    const res = await post(`${url}/inquiries`, { question: "hi" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("inquiry");
  });

  it("rejects an oversized inquiry", async () => {
    const { url } = await start(new ScriptedModel([]));
    const res = await post(`${url}/inquiries`, { inquiry: "x".repeat(5000) });
    expect(res.status).toBe(400);
  });

  it("reports a model failure as an error event without leaking its message", async () => {
    const broken: ModelClient = { id: "broken", complete: async () => Promise.reject(new Error("401 sk-ant-secret")) };
    const { url } = await start(broken);
    const res = await post(`${url}/inquiries`, { inquiry: "Hallo, ist HH-1001 noch frei?" });
    const text = await res.text();
    expect(sse(text).map((e) => e.event)).toEqual(["error"]);
    expect(text).not.toContain("sk-ant-secret");
  });

  it("answers other paths with 404", async () => {
    const { url } = await start(new ScriptedModel([]));
    expect((await fetch(`${url}/nope`)).status).toBe(404);
  });
});

describe("Streamable HTTP MCP endpoint", () => {
  it("serves the same tools to an external MCP client, on the shared hand-off queue", async () => {
    const { url, handoffs } = await start(new ScriptedModel([]));
    const client = new Client({ name: "external", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_listing", "hand_off_to_human", "search_knowledge", "search_listings"]);

    await client.callTool({
      name: "hand_off_to_human",
      arguments: { reason: "complaint", listingId: null, summary: "Complaint about the last viewing.", contactEmail: null },
    });
    expect(handoffs.list()).toHaveLength(1);
    await client.close();
  });

  it("refuses GET, because the server holds no sessions", async () => {
    const { url } = await start(new ScriptedModel([]));
    expect((await fetch(`${url}/mcp`)).status).toBe(405);
  });
});

describe("AnthropicModel adapter", () => {
  const fake = (reply: unknown, provider: "anthropic" | "bedrock" = "anthropic") => {
    const sent: any[] = [];
    const client = { beta: { messages: { create: async (body: any) => (sent.push(body), reply) } } } as any;
    return { sent, model: new AnthropicModel({ client, model: "test-model", provider }) };
  };
  const request = { system: "SYS", tools: [], messages: [{ role: "user" as const, content: "hi" }], maxTokens: 100 };

  it("asks for server-side refusal fallback on the Claude API only", async () => {
    const reply = { content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
    const direct = fake(reply);
    await direct.model.complete(request);
    expect(direct.sent[0]).toMatchObject({ fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });

    const bedrock = fake(reply, "bedrock");
    await bedrock.model.complete(request);
    expect(bedrock.sent[0]).not.toHaveProperty("fallbacks");
    expect(bedrock.sent[0]).not.toHaveProperty("betas");
    expect(bedrock.sent[0]).toMatchObject({ cache_control: { type: "ephemeral" }, output_config: { effort: "medium" } });
  });

  it("defaults to the region's Bedrock inference profile on Bedrock", () => {
    const client = {} as any;
    const saved = process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_MODEL;
    try {
      expect(new AnthropicModel({ client, provider: "anthropic" }).id).toBe("claude-opus-5-5");
      expect(bedrockModel("claude-opus-5-5", "eu-central-1")).toBe("eu.anthropic.claude-opus-5-5");
      expect(bedrockModel("claude-opus-5-5", "us-east-1")).toBe("us.anthropic.claude-opus-5-5");
      expect(bedrockModel("claude-opus-5-5", "ap-northeast-1")).toBe("global.anthropic.claude-opus-5-5");
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_MODEL = saved;
    }
  });
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 };

  it("caches the system prompt, keeps thinking blocks, and maps usage and stop reason", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig" };
    const { sent, model } = fake({
      content: [thinking, { type: "tool_use", id: "t1", name: "get_listing", input: { id: "HH-1001" } }],
      stop_reason: "tool_use",
      usage,
    });

    const res = await model.complete({
      system: "SYS",
      tools: [{ name: "get_listing", description: "d", inputSchema: { type: "object" } }],
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
    });

    expect(sent[0].system[0]).toMatchObject({ text: "SYS", cache_control: { type: "ephemeral" } });
    expect(sent[0].cache_control).toEqual({ type: "ephemeral" });
    expect(sent[0].tools[0]).toMatchObject({ name: "get_listing", input_schema: { type: "object" } });
    expect(sent[0]).not.toHaveProperty("tool_choice");
    expect(res.stop).toBe("tool_use");
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 7, cacheWriteTokens: 3 });
    expect(res.content).toEqual([
      { type: "provider", block: thinking },
      { type: "tool_use", id: "t1", name: "get_listing", input: { id: "HH-1001" } },
    ]);

    // Sent back on the next turn exactly as received, next to the tool result.
    await model.complete({
      system: "SYS",
      tools: [],
      messages: [
        { role: "assistant", content: res.content },
        { role: "user", content: [{ type: "tool_result", toolUseId: "t1", content: "{}", isError: true }] },
      ],
      maxTokens: 100,
    });
    expect(sent[1].messages[0].content[0]).toBe(thinking);
    expect(sent[1].messages[1].content[0]).toEqual({ type: "tool_result", tool_use_id: "t1", content: "{}", is_error: true });
  });
});
