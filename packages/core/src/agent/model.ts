/**
 * The agent's view of a language model. No provider types cross this line, so the loop and its tests
 * run offline against ScriptedModel (DECISIONS.md 21).
 */

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean }
  /** A block the loop does not read (thinking) but must send back unchanged. */
  | { type: "provider"; block: unknown };

export interface Message {
  role: "user" | "assistant";
  content: string | Block[];
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

export interface ModelRequest {
  system: string;
  tools: ToolDef[];
  messages: Message[];
  maxTokens: number;
  signal?: AbortSignal;
}

export interface ModelResponse {
  content: Block[];
  stop: "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";
  usage: Usage;
}

export interface ModelClient {
  readonly id: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

/** One scripted turn: fixed blocks, or blocks computed from the request the loop just sent. */
export type ScriptStep = Block[] | ((request: ModelRequest) => Block[]);

export const say = (text: string): Block => ({ type: "text", text });
export const call = (name: string, input: Record<string, unknown>, id = `toolu_${name}`): Block => ({
  type: "tool_use",
  id,
  name,
  input,
});

/** Plays back a fixed script and records every request. Throws when the loop asks for more turns than scripted. */
export class ScriptedModel implements ModelClient {
  readonly id = "scripted";
  readonly requests: ModelRequest[] = [];
  private next = 0;

  constructor(
    private readonly steps: ScriptStep[],
    private readonly usage: Usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
  ) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone({ ...request, signal: undefined }));
    const step = this.steps[this.next++];
    if (!step) throw new Error(`ScriptedModel: no step ${this.next} scripted`);
    const content = typeof step === "function" ? step(request) : step;
    return { content, stop: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { ...this.usage } };
  }
}
