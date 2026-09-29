import { describe, expect, it } from "vitest";
import { AnthropicModel, missingCredentials, providerFromEnv } from "../src/agent/anthropic.js";
import { connectInProcess } from "../src/agent/connect.js";
import { runInquiry } from "../src/agent/loop.js";
import { InMemoryHandoffQueue } from "../src/domain/handoff.js";
import { InMemoryListingRepository } from "../src/domain/repository.js";
import { knowledgeBase, policies } from "./helpers.js";

// Costs a few cents per run. Skipped unless credentials for MODEL_PROVIDER are in the environment (.env is not
// read, so `pnpm test` never spends money by accident). On Bedrock the bearer token is the opt-in, since an
// ambient AWS region alone says nothing. Retrieval uses the offline hashing embedder, so only the model is real;
// assertions are on behaviour the guards and tools guarantee, not on wording.
const credentialed =
  !missingCredentials() && (providerFromEnv() === "anthropic" || !!process.env.AWS_BEARER_TOKEN_BEDROCK);
describe.skipIf(!credentialed)("live agent", () => {
  it("answers a fact question with citations and hands off a viewing", { timeout: 120_000 }, async () => {
    const mcp = await connectInProcess({
      listings: InMemoryListingRepository.fromFile("data/listings.json"),
      handoffs: new InMemoryHandoffQueue(),
      knowledge: await knowledgeBase(),
      policies,
    });

    const result = await runInquiry(
      { model: new AnthropicModel(), mcp },
      "Is heating included in HH-1001, and can I view it on Saturday?",
    );

    expect(result.outcome).toEqual({ status: "answered" });
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.handoffs.map((h) => h.reason)).toContain("viewing_request");
    expect(result.trace.some((t) => t.tool === "search_knowledge" || t.tool === "get_listing")).toBe(true);
  });
});
