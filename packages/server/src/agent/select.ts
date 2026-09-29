import { DemoModel, type ModelClient } from "@proptech/core";
import { AnthropicModel, missingCredentials } from "./anthropic.js";

export type ModelChoice = { model: ModelClient; label: string } | { error: string };

/**
 * The model from the environment: `MODEL_PROVIDER=demo` for the rule-based demo model (DECISIONS.md 28), otherwise
 * the Claude API or Bedrock. With `demoFallback`, missing credentials select the demo model instead of an error,
 * so `pnpm dev` works from a clean clone.
 */
export function modelFromEnv({ demoFallback = false } = {}): ModelChoice {
  if (process.env.MODEL_PROVIDER === "demo") return { model: new DemoModel(), label: "demo model (MODEL_PROVIDER=demo)" };
  const missing = missingCredentials();
  if (missing && demoFallback) {
    return { model: new DemoModel(), label: `demo model, since no credentials are set. ${missing}` };
  }
  if (missing) return { error: missing };
  const model = new AnthropicModel();
  return { model, label: `model ${model.id} via ${model.provider}` };
}
