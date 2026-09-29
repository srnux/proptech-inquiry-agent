import { tokenise } from "./text.js";

/** Okapi BM25 over a fixed set of documents. Small corpus, so everything stays in memory. */
export class Bm25Index {
  private readonly docs: { id: string; tf: Map<string, number>; length: number }[];
  private readonly df = new Map<string, number>();
  private readonly avgLength: number;

  constructor(
    documents: { id: string; text: string }[],
    private readonly k1 = 1.2,
    private readonly b = 0.75,
  ) {
    this.docs = documents.map(({ id, text }) => {
      const tokens = tokenise(text);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { id, tf, length: tokens.length };
    });
    this.avgLength = this.docs.reduce((s, d) => s + d.length, 0) / Math.max(this.docs.length, 1);
  }

  private idf(term: string): number {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  /**
   * `score` is plain BM25 and is used for ranking. `coverage` is the IDF-weighted share of the query's
   * terms that occur in the document, from 0 to 1. Raw BM25 is unbounded and one rare word can dominate
   * it, so relevance is judged on coverage instead: "Is the flat in a safe area at night?" matches
   * "area" strongly but covers little of the question.
   */
  score(query: string, filter: (id: string) => boolean = () => true): { id: string; score: number; coverage: number }[] {
    const terms = [...new Set(tokenise(query))];
    const totalIdf = terms.reduce((sum, t) => sum + this.idf(t), 0);
    const out: { id: string; score: number; coverage: number }[] = [];
    for (const d of this.docs) {
      if (!filter(d.id)) continue;
      let s = 0;
      let matchedIdf = 0;
      for (const t of terms) {
        const f = d.tf.get(t);
        if (!f) continue;
        const idf = this.idf(t);
        matchedIdf += idf;
        s += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.length) / this.avgLength));
      }
      if (s > 0) out.push({ id: d.id, score: s, coverage: totalIdf > 0 ? matchedIdf / totalIdf : 0 });
    }
    return out.sort((a, b) => b.score - a.score);
  }
}
