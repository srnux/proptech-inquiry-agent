import type { Usage } from "@proptech/core";

/**
 * Claude API list prices in USD per million tokens, 2026-09-25. Cache writes are the 5-minute rate (1.25x input),
 * which is what the adapter's ephemeral cache_control asks for. Bedrock bills separately; the report says so.
 */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** "eu.anthropic.claude-opus-5-5" and "claude-opus-5-5" are the same model for pricing. */
export const baseModelId = (id: string) => id.replace(/^(?:[a-z]+\.)?anthropic\./, "");

/** Cost of one run in USD; 0 for the demo and scripted models, which make no calls; null for an unknown model. */
export function costUsd(usage: Usage, modelId: string): number | null {
  if (modelId === "demo" || modelId === "scripted") return 0;
  const p = PRICES[baseModelId(modelId)];
  if (!p) return null;
  return (
    (usage.inputTokens * p.input + usage.outputTokens * p.output + usage.cacheReadTokens * p.cacheRead + usage.cacheWriteTokens * p.cacheWrite) /
    1_000_000
  );
}
