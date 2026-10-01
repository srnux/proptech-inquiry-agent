import Anthropic, { betaRefusalFallbackMiddleware } from "@anthropic-ai/sdk";
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import type { Block, Message, ModelClient, ModelRequest, ModelResponse } from "@proptech/core";

/** DECISIONS.md 23: the default model, and why it is only a default. */
export const DEFAULT_MODEL = "claude-opus-5-5";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** DECISIONS.md 25: the Claude API, or the same Messages API on Amazon Bedrock (bedrock-runtime). */
export type Provider = "anthropic" | "bedrock";

/**
 * Bedrock serves current models only through inference profiles. The geography prefix keeps requests in the
 * region's geography (eu-central-1 -> eu.); regions outside the EU and US use the global profile.
 */
export const bedrockModel = (model: string, region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "") => {
  const geo = region.split("-")[0];
  return `${geo === "eu" || geo === "us" ? geo : "global"}.anthropic.${model}`;
};
/** Bedrock has no server-side fallbacks; the SDK middleware retries a refusal on this model instead. */
const BEDROCK_FALLBACK_MODEL = "claude-opus-4-8";

/** The one resource the adapter uses; both the Anthropic and the Bedrock client have it. */
export type MessagesClient = { beta: { messages: Pick<Anthropic["beta"]["messages"], "create"> } };

export interface AnthropicOptions {
  model?: string;
  effort?: Effort;
  provider?: Provider;
  client?: MessagesClient;
}

export const providerFromEnv = (): Provider => {
  const p = process.env.MODEL_PROVIDER ?? "anthropic";
  if (p !== "anthropic" && p !== "bedrock") throw new Error(`MODEL_PROVIDER must be "anthropic" or "bedrock", got "${p}"`);
  return p;
};

/** What is missing before the model can be called, or undefined. Checked up front so a run fails before indexing. */
export const missingCredentials = (provider = providerFromEnv()): string | undefined => {
  const env = process.env;
  if (provider === "anthropic") {
    return env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN ? undefined : "Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN).";
  }
  if (!env.AWS_REGION && !env.AWS_DEFAULT_REGION) return "Set AWS_REGION: MODEL_PROVIDER=bedrock needs a region.";
  // Without a bearer token the Bedrock client falls back to the normal AWS credential chain, so nothing else is required.
  return undefined;
};

const clientFor = (provider: Provider): MessagesClient =>
  provider === "bedrock"
    ? new AnthropicBedrock({
        // bedrock-runtime rejects the fallback-credit beta, so retries run without the credit discount.
        middleware: [betaRefusalFallbackMiddleware([{ model: bedrockModel(BEDROCK_FALLBACK_MODEL) }], { betas: [] })],
      })
    : new Anthropic();

const toParam = (b: Block): Anthropic.Beta.BetaContentBlockParam => {
  switch (b.type) {
    case "text":
      return { type: "text", text: b.text };
    case "tool_use":
      return { type: "tool_use", id: b.id, name: b.name, input: b.input };
    case "tool_result":
      return { type: "tool_result", tool_use_id: b.toolUseId, content: b.content, ...(b.isError && { is_error: true }) };
    case "provider":
      return b.block as Anthropic.Beta.BetaContentBlockParam;
  }
};

const fromResponse = (b: Anthropic.Beta.BetaContentBlock): Block =>
  b.type === "text"
    ? { type: "text", text: b.text }
    : b.type === "tool_use"
      ? { type: "tool_use", id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }
      : { type: "provider", block: b };

const stops: Record<string, ModelResponse["stop"]> = {
  end_turn: "end_turn",
  tool_use: "tool_use",
  max_tokens: "max_tokens",
  refusal: "refusal",
};

/**
 * The Messages API behind ModelClient. Caching: one breakpoint on the system prompt (tools render before it,
 * so it covers both) and automatic caching of the growing conversation. Thinking blocks are kept and sent
 * back unchanged, as the API requires while tools are in play. Refusals fall back server-side on the Claude API
 * and through the SDK middleware on Bedrock.
 */
export class AnthropicModel implements ModelClient {
  readonly id: string;
  readonly provider: Provider;
  private readonly client: MessagesClient;
  private readonly effort: Effort;

  constructor(opts: AnthropicOptions = {}) {
    this.provider = opts.provider ?? providerFromEnv();
    this.id = opts.model ?? process.env.ANTHROPIC_MODEL ?? (this.provider === "bedrock" ? bedrockModel(DEFAULT_MODEL) : DEFAULT_MODEL);
    this.effort = opts.effort ?? (process.env.ANTHROPIC_EFFORT as Effort | undefined) ?? "medium";
    this.client = opts.client ?? clientFor(this.provider);
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const res = await this.client.beta.messages.create(
      {
        model: this.id,
        max_tokens: req.maxTokens,
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        ...(req.tools.length && {
          tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })),
        }),
        messages: req.messages.map((m: Message) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : m.content.map(toParam),
        })),
        cache_control: { type: "ephemeral" },
        output_config: { effort: this.effort },
        ...(this.provider === "anthropic" && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
      },
      { signal: req.signal },
    );
    return {
      content: res.content.map(fromResponse),
      stop: stops[res.stop_reason ?? ""] ?? "other",
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
