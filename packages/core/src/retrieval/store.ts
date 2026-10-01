/** Vector store boundary. In-memory now; a pgvector implementation can replace it (roadmap slice 7, optional). */
export interface VectorStore {
  upsert(items: { id: string; vector: number[] }[]): void;
  /** Cosine similarity, highest first. Vectors are expected to be L2-normalised. */
  query(vector: number[], k: number, filter?: (id: string) => boolean): { id: string; score: number }[];
  /**
   * Mean and standard deviation of the similarity over every stored vector that passes the filter.
   * Lets callers judge a hit relative to the rest of the corpus instead of by an absolute cosine.
   */
  distribution(vector: number[], filter?: (id: string) => boolean): { mean: number; std: number };
}

export class InMemoryVectorStore implements VectorStore {
  private readonly items = new Map<string, number[]>();
  private dimensions: number | undefined;

  upsert(items: { id: string; vector: number[] }[]) {
    for (const { id, vector } of items) {
      this.dimensions ??= vector.length;
      if (vector.length !== this.dimensions) {
        throw new Error(`vector for ${id} has ${vector.length} dimensions, store has ${this.dimensions}`);
      }
      this.items.set(id, vector);
    }
  }

  private scores(vector: number[], filter: (id: string) => boolean) {
    const out: { id: string; score: number }[] = [];
    for (const [id, v] of this.items) {
      if (!filter(id)) continue;
      let dot = 0;
      for (let i = 0; i < v.length; i++) dot += v[i]! * vector[i]!;
      out.push({ id, score: dot });
    }
    return out;
  }

  query(vector: number[], k: number, filter: (id: string) => boolean = () => true) {
    return this.scores(vector, filter).sort((a, b) => b.score - a.score).slice(0, k);
  }

  distribution(vector: number[], filter: (id: string) => boolean = () => true) {
    const s = this.scores(vector, filter).map((x) => x.score);
    const mean = s.reduce((a, b) => a + b, 0) / Math.max(s.length, 1);
    const std = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(s.length, 1));
    return { mean, std };
  }
}
