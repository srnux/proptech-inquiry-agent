import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { tokenise } from "./text.js";

/**
 * Queries and passages are embedded through separate methods because asymmetric models
 * (e5 among them) need different prefixes for each; mixing them up silently lowers quality.
 */
export interface Embedder {
  /** Identifies model and settings. Stored with the index so a model change forces a rebuild. */
  readonly id: string;
  embedQueries(texts: string[]): Promise<number[][]>;
  embedPassages(texts: string[]): Promise<number[][]>;
}

function l2normalise(v: number[]): number[] {
  const n = Math.hypot(...v);
  return n === 0 ? v : v.map((x) => x / n);
}

/**
 * Offline, deterministic embedder: signed feature hashing of word tokens and character trigrams.
 * No semantics, but it catches spelling variants and compound words ("Nebenkosten", "Kosten")
 * that pure token matching misses. Used by tests and CI, and as a fallback without the model.
 */
export class HashingEmbedder implements Embedder {
  readonly id: string;
  constructor(private readonly dimensions = 512) {
    this.id = `hashing-v1-${dimensions}`;
  }

  private embed(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    const add = (feature: string, weight: number) => {
      const h = createHash("md5").update(feature).digest();
      const idx = h.readUInt32LE(0) % this.dimensions;
      v[idx]! += (h[4]! & 1 ? 1 : -1) * weight;
    };
    for (const token of tokenise(text)) {
      add(`w:${token}`, 1);
      const padded = `#${token}#`;
      for (let i = 0; i + 3 <= padded.length; i++) add(`c:${padded.slice(i, i + 3)}`, 0.3);
    }
    return l2normalise(v);
  }

  async embedQueries(texts: string[]) {
    return texts.map((t) => this.embed(t));
  }
  async embedPassages(texts: string[]) {
    return texts.map((t) => this.embed(t));
  }
}

/**
 * multilingual-e5-small via transformers.js, running in-process on the CPU.
 * The model (about 120 MB quantised) is downloaded from Hugging Face on first use and cached in `.models/`.
 * transformers.js is imported lazily so tests and the hashing path never load onnxruntime.
 */
export class E5Embedder implements Embedder {
  readonly id: string;
  private extractor: Promise<(texts: string[], opts: object) => Promise<{ tolist(): number[][] }>> | undefined;

  constructor(
    private readonly model = "Xenova/multilingual-e5-small",
    private readonly dtype = "q8",
  ) {
    this.id = `${model}@${dtype}`;
  }

  private load() {
    this.extractor ??= import("@huggingface/transformers").then(({ pipeline, env }) => {
      // Keep the model outside node_modules, so a reinstall does not throw away the download.
      env.cacheDir = process.env.MODEL_CACHE_DIR ?? fileURLToPath(new URL("../../.models/", import.meta.url));
      return pipeline("feature-extraction", this.model, { dtype: this.dtype as "q8" }) as unknown as (
          texts: string[],
        opts: object,
      ) => Promise<{ tolist(): number[][] }>;
    });
    return this.extractor;
  }

  private async run(texts: string[]): Promise<number[][]> {
    const extract = await this.load();
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 32) {
      const batch = await extract(texts.slice(i, i + 32), { pooling: "mean", normalize: true });
      out.push(...batch.tolist());
    }
    return out;
  }

  embedQueries(texts: string[]) {
    return this.run(texts.map((t) => `query: ${t}`));
  }
  embedPassages(texts: string[]) {
    return this.run(texts.map((t) => `passage: ${t}`));
  }
}

export function embedderFromEnv(env = process.env): Embedder {
  const kind = env.EMBEDDER ?? "e5";
  if (kind === "hashing") return new HashingEmbedder();
  if (kind === "e5") return new E5Embedder();
  throw new Error(`Unknown EMBEDDER "${kind}". Use "e5" or "hashing".`);
}
