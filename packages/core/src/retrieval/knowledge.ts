import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Listing } from "../domain/listing.js";
import { Bm25Index } from "./bm25.js";
import { chunkListings, chunkPolicies, type Chunk, type PolicyPage } from "./chunk.js";
import type { Embedder } from "./embedder.js";
import type { Reranker } from "./reranker.js";
import { InMemoryVectorStore, type VectorStore } from "./store.js";

export interface Thresholds {
  /**
   * Minimum z-score of a passage's cosine against all candidate passages for the same question: how far
   * it stands out, in standard deviations. Absolute cosines are useless for judging relevance with e5,
   * whose similarities all sit between about 0.75 and 0.9 (DECISIONS.md 16). Model-specific.
   */
  minZ: number;
  /** Minimum IDF-weighted share of query terms a passage must contain to count as relevant on keywords alone. */
  minCoverage: number;
}

export interface KnowledgeHit {
  chunkId: string;
  source: Chunk["source"];
  listingId: string | null;
  policy: string | null;
  text: string;
  /** Reciprocal rank fusion score; only meaningful for ordering. */
  score: number;
  cosine: number;
  /** Standard deviations above the mean similarity of all candidate passages. */
  z: number;
  bm25: number;
  coverage: number;
  /** Reranker relevance in [0, 1]; present when a reranker judged the passage. */
  rerank?: number;
}

/** A reranker plus the minimum score at which a passage counts as answering the question. */
export interface Rerank {
  reranker: Reranker;
  minScore: number;
}

/**
 * What gets embedded for each chunk. `header`: the passage with its listing or page header, as BM25
 * sees it. `plain`: the passage alone. BM25 always uses the header version. See DECISIONS.md 13 and 17.
 */
export type EmbedText = "header" | "plain";

export type KnowledgeResult =
  | { found: true; results: KnowledgeHit[] }
  | { found: false; results: []; reason: string };

interface IndexFile {
  version: 1;
  embedderId: string;
  corpusHash: string;
  vectors: Record<string, number[]>;
}

const RRF_K = 60;
const CANDIDATES = 20;

export class KnowledgeBase {
  private readonly byId: Map<string, Chunk>;
  private readonly bm25: Bm25Index;

  private constructor(
    readonly chunks: Chunk[],
    private readonly store: VectorStore,
    private readonly embedder: Embedder,
    private readonly thresholds: Thresholds,
    private readonly rerank?: Rerank,
  ) {
    this.byId = new Map(chunks.map((c) => [c.chunkId, c]));
    this.bm25 = new Bm25Index(chunks.map((c) => ({ id: c.chunkId, text: c.indexText })));
  }

  static corpus(listings: Listing[], policies: PolicyPage[]): Chunk[] {
    const chunks = [...chunkListings(listings), ...chunkPolicies(policies)];
    const ids = new Set<string>();
    for (const c of chunks) {
      if (ids.has(c.chunkId)) throw new Error(`duplicate chunk id ${c.chunkId}`);
      ids.add(c.chunkId);
    }
    return chunks;
  }

  static hash(chunks: Chunk[]): string {
    const h = createHash("sha256");
    for (const c of chunks) h.update(`${c.chunkId}\u0000${c.indexText}\u0000`);
    return h.digest("hex").slice(0, 16);
  }

  /**
   * Build the index, reusing vectors from `cacheFile` when it was built from the same corpus with the
   * same embedder. Anything else (new listing text, other model) triggers a full rebuild.
   */
  static async open(opts: {
    listings: Listing[];
    policies: PolicyPage[];
    embedder: Embedder;
    thresholds: Thresholds;
    cacheFile?: string;
    embedText?: EmbedText;
    rerank?: Rerank;
  }): Promise<{ kb: KnowledgeBase; rebuilt: boolean }> {
    const chunks = KnowledgeBase.corpus(opts.listings, opts.policies);
    const embedText = opts.embedText ?? "plain";
    const corpusHash = `${embedText}:${KnowledgeBase.hash(chunks)}`;
    const store = new InMemoryVectorStore();

    if (opts.cacheFile && existsSync(opts.cacheFile)) {
      const cached = JSON.parse(readFileSync(opts.cacheFile, "utf8")) as IndexFile;
      if (cached.version === 1 && cached.embedderId === opts.embedder.id && cached.corpusHash === corpusHash) {
        store.upsert(chunks.map((c) => ({ id: c.chunkId, vector: cached.vectors[c.chunkId]! })));
        return { kb: new KnowledgeBase(chunks, store, opts.embedder, opts.thresholds, opts.rerank), rebuilt: false };
      }
    }

    const vectors = await opts.embedder.embedPassages(chunks.map((c) => (embedText === "plain" ? c.text : c.indexText)));
    store.upsert(chunks.map((c, i) => ({ id: c.chunkId, vector: vectors[i]! })));

    if (opts.cacheFile) {
      const file: IndexFile = {
        version: 1,
        embedderId: opts.embedder.id,
        corpusHash,
        vectors: Object.fromEntries(chunks.map((c, i) => [c.chunkId, vectors[i]!])),
      };
      mkdirSync(dirname(opts.cacheFile), { recursive: true });
      writeFileSync(opts.cacheFile, JSON.stringify(file));
    }
    return { kb: new KnowledgeBase(chunks, store, opts.embedder, opts.thresholds, opts.rerank), rebuilt: true };
  }

  get embedderId() {
    return this.embedder.id;
  }

  get rerankerId() {
    return this.rerank?.reranker.id;
  }

  /**
   * Candidates from both rankings, each scored by the reranker. The reranker reads the passage with
   * its listing or page header: "Not approved for residential use" only answers "Can I live there?"
   * when the reader knows it is about the office unit.
   */
  async rerankSignals(query: string, listingId?: string) {
    if (!this.rerank) throw new Error("no reranker configured");
    const { vector, keyword } = await this.signals(query, listingId);
    const ids = [...new Set([...vector.map((v) => v.id), ...keyword.map((v) => v.id)])];
    const scores = await this.rerank.reranker.score(
      query,
      ids.map((id) => this.byId.get(id)!.indexText),
    );
    const rerank = ids.map((id, i) => ({ id, score: scores[i]! })).sort((a, b) => b.score - a.score);
    return { vector, keyword, rerank };
  }

  /** Raw signals for one query, used by search and by the calibration script. */
  async signals(query: string, listingId?: string) {
    const filter = (id: string) => {
      if (!listingId) return true;
      const c = this.byId.get(id)!;
      return c.listingId === listingId || c.source === "policy";
    };
    const [qv] = await this.embedder.embedQueries([query]);
    const { mean, std } = this.store.distribution(qv!, filter);
    const vector = this.store
      .query(qv!, CANDIDATES, filter)
      .map((v) => ({ ...v, z: std > 0 ? (v.score - mean) / std : 0 }));
    const keyword = this.bm25.score(query, filter).slice(0, CANDIDATES);
    return { vector, keyword };
  }

  /**
   * Hybrid search. Filter first, rank by vector and by BM25 separately, merge with reciprocal rank
   * fusion, then put the listing's own passages ahead of general policies. A passage is only returned
   * if it stands out on similarity (z-score) or on keyword coverage;
   * if none does, the result says so, which is what sends the agent to a human.
   */
  async search(query: string, opts: { listingId?: string; k?: number } = {}): Promise<KnowledgeResult> {
    if (this.rerank) return this.searchReranked(query, opts);
    const { vector, keyword } = await this.signals(query, opts.listingId);
    const cosine = new Map(vector.map((v) => [v.id, v]));
    const bm25 = new Map(keyword.map((v) => [v.id, v]));

    const fused = new Map<string, number>();
    vector.forEach((v, rank) => fused.set(v.id, (fused.get(v.id) ?? 0) + 1 / (RRF_K + rank + 1)));
    keyword.forEach((v, rank) => fused.set(v.id, (fused.get(v.id) ?? 0) + 1 / (RRF_K + rank + 1)));

    const { minZ, minCoverage } = this.thresholds;
    const specificity = (id: string) => (opts.listingId && this.byId.get(id)!.listingId === opts.listingId ? 1 : 0);
    const results = [...fused.entries()]
      .map(([id, score]) => ({
        id,
        score,
        cosine: cosine.get(id)?.score ?? 0,
        z: cosine.get(id)?.z ?? Number.NEGATIVE_INFINITY,
        bm25: bm25.get(id)?.score ?? 0,
        coverage: bm25.get(id)?.coverage ?? 0,
      }))
      .filter((r) => r.z >= minZ || r.coverage >= minCoverage)
      // Scoped to a listing, its own passages go first: they are specific ("deposit two months")
      // where the policy is general ("at most three months"). Policies follow as context.
      .sort((a, b) => specificity(b.id) - specificity(a.id) || b.score - a.score)
      .slice(0, opts.k ?? 5)
      .map((r) => {
        const c = this.byId.get(r.id)!;
        return {
          chunkId: c.chunkId,
          source: c.source,
          listingId: c.listingId,
          policy: c.policy,
          text: c.text,
          score: round(r.score),
          cosine: round(r.cosine),
          z: round(r.z),
          bm25: round(r.bm25),
          coverage: round(r.coverage),
        };
      });

    return results.length > 0
      ? { found: true, results }
      : { found: false, results: [], reason: "No passage in the listing or the policies is relevant to this question." };
  }

  /**
   * With a reranker: vectors and keywords only collect candidates, the reranker alone decides what
   * answers the question. Same filter, same listing-first order, same `found: false` contract.
   */
  private async searchReranked(query: string, opts: { listingId?: string; k?: number }): Promise<KnowledgeResult> {
    const { vector, keyword, rerank } = await this.rerankSignals(query, opts.listingId);
    const cosine = new Map(vector.map((v) => [v.id, v]));
    const bm25 = new Map(keyword.map((v) => [v.id, v]));
    const specificity = (id: string) => (opts.listingId && this.byId.get(id)!.listingId === opts.listingId ? 1 : 0);

    const results = rerank
      .filter((r) => r.score >= this.rerank!.minScore)
      .sort((a, b) => specificity(b.id) - specificity(a.id) || b.score - a.score)
      .slice(0, opts.k ?? 5)
      .map((r) => {
        const c = this.byId.get(r.id)!;
        return {
          chunkId: c.chunkId,
          source: c.source,
          listingId: c.listingId,
          policy: c.policy,
          text: c.text,
          score: round(r.score),
          cosine: round(cosine.get(r.id)?.score ?? 0),
          z: round(cosine.get(r.id)?.z ?? 0),
          bm25: round(bm25.get(r.id)?.score ?? 0),
          coverage: round(bm25.get(r.id)?.coverage ?? 0),
          rerank: round(r.score),
        };
      });

    return results.length > 0
      ? { found: true, results }
      : { found: false, results: [], reason: "No passage in the listing or the policies is relevant to this question." };
  }
}

const round = (x: number) => Math.round(x * 1000) / 1000;

export function loadRerankThreshold(file: string, rerankerId: string): number {
  const all = JSON.parse(readFileSync(file, "utf8")) as Record<string, { minScore?: number }>;
  const t = all[`reranker:${rerankerId}`]?.minScore;
  if (t === undefined) throw new Error(`No threshold for reranker "${rerankerId}" in ${file}. Run pnpm calibrate.`);
  return t;
}

export function loadThresholds(file: string, embedderId: string): Thresholds {
  const all = JSON.parse(readFileSync(file, "utf8")) as Record<string, Thresholds & { note?: string }>;
  const t = all[embedderId];
  if (!t) throw new Error(`No retrieval thresholds for embedder "${embedderId}" in ${file}. Run pnpm calibrate.`);
  return { minZ: t.minZ, minCoverage: t.minCoverage };
}
