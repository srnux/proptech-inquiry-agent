import { fileURLToPath } from "node:url";

/**
 * Judges whether a passage answers a question by reading both together (a cross-encoder).
 * Embeddings compare two separately computed vectors and are good at "which passage is closest";
 * a reranker is trained on "does this passage answer this question" and gives a score from 0 to 1
 * that means the same thing for every question. See DECISIONS.md 18.
 */
export interface Reranker {
  readonly id: string;
  /** One relevance score in [0, 1] per passage, same order as the input. */
  score(query: string, passages: string[]): Promise<number[]>;
}

type Tokenizer = (a: string[], opts: object) => unknown;
type Model = (inputs: unknown) => Promise<{ logits: { sigmoid(): { tolist(): number[][] } } }>;

/**
 * BAAI bge-reranker-v2-m3 (multilingual, Apache-2.0) in the ONNX conversion for transformers.js.
 * The quantised file is about 570 MB, downloaded on first use into `.models/`.
 */
export class BgeReranker implements Reranker {
  readonly id: string;
  private loaded: Promise<{ tokenizer: Tokenizer; model: Model }> | undefined;

  constructor(
    private readonly model = "onnx-community/bge-reranker-v2-m3-ONNX",
    private readonly dtype = "q8",
  ) {
    this.id = `${model}@${dtype}`;
  }

  private load() {
    this.loaded ??= import("@huggingface/transformers").then(async (t) => {
      t.env.cacheDir = process.env.MODEL_CACHE_DIR ?? fileURLToPath(new URL("../../.models/", import.meta.url));
      const tokenizer = (await t.AutoTokenizer.from_pretrained(this.model)) as unknown as Tokenizer;
      const model = (await t.AutoModelForSequenceClassification.from_pretrained(this.model, {
        dtype: this.dtype as "q8",
      })) as unknown as Model;
      return { tokenizer, model };
    });
    return this.loaded;
  }

  async score(query: string, passages: string[]): Promise<number[]> {
    if (passages.length === 0) return [];
    const { tokenizer, model } = await this.load();
    const inputs = tokenizer(new Array(passages.length).fill(query), {
      text_pair: passages,
      padding: true,
      truncation: true,
    });
    const { logits } = await model(inputs);
    return logits.sigmoid().tolist().map((row) => row[0]!);
  }
}

export function rerankerFromEnv(env = process.env): Reranker | undefined {
  const kind = env.RERANKER ?? ((env.EMBEDDER ?? "e5") === "e5" ? "bge" : "none");
  if (kind === "none") return undefined;
  if (kind === "bge") return new BgeReranker();
  throw new Error(`Unknown RERANKER "${kind}". Use "bge" or "none".`);
}
