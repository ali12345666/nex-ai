/**
 * NEX AI — Keyword Index (Phase 9 / P9-S2)
 *
 * BM25-lite full-text scoring over the SAME chunks stored in the vector
 * store — rebuilt in memory on demand (documents are small; rebuild is
 * microseconds-to-milliseconds for thousands of chunks). Zero deps, pure.
 *
 * Used by the hybrid retriever: semantic alone misses exact identifiers
 * (function names, error codes, part numbers) — keyword alone misses
 * paraphrases. Combined = robust retrieval, fully offline.
 */

import type { DocumentChunk } from '../ai/knowledge-types';
import { tokenizeForEmbedding } from './hash-embedder';

const K1 = 1.4;  // term frequency saturation
const B = 0.72;  // length normalization strength

interface Posting {
  chunkId: string;
  tf: number;
}

export class KeywordIndex {
  private postings = new Map<string, Posting[]>();
  private chunkLengths = new Map<string, number>();
  private totalDocs = 0;
  private avgDocLen = 0;

  /** (Re)build the index from a chunk list. */
  build(chunks: DocumentChunk[]): void {
    this.postings.clear();
    this.chunkLengths.clear();
    this.totalDocs = chunks.length;
    let totalLen = 0;

    for (const c of chunks) {
      const tokens = tokenizeForEmbedding(c.content);
      this.chunkLengths.set(c.id, tokens.length);
      totalLen += tokens.length;
      const counts = new Map<string, number>();
      for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
      for (const [term, tf] of counts) {
        let list = this.postings.get(term);
        if (!list) { list = []; this.postings.set(term, list); }
        list.push({ chunkId: c.id, tf });
      }
    }
    this.avgDocLen = this.totalDocs > 0 ? totalLen / this.totalDocs : 1;
  }

  private idf(term: string): number {
    const n = this.postings.get(term)?.length || 0;
    if (n === 0) return 0;
    return Math.log(1 + (this.totalDocs - n + 0.5) / (n + 0.5));
  }

  /**
   * Score chunks against a query. Returns chunk ids + BM25 scores, sorted.
   * `chunkById` resolves ids → chunks (kept as a param so the index owns
   * NO document data — separation of concerns).
   */
  search(
    query: string,
    limit: number,
    chunkById: Map<string, DocumentChunk>
  ): Array<{ chunk: DocumentChunk; score: number }> {
    const terms = tokenizeForEmbedding(query);
    const scores = new Map<string, number>();

    for (const term of terms) {
      const list = this.postings.get(term);
      if (!list) continue;
      const idf = this.idf(term);
      for (const { chunkId, tf } of list) {
        const len = this.chunkLengths.get(chunkId) || 1;
        const denom = tf + K1 * (1 - B + (B * len) / (this.avgDocLen || 1));
        const score = idf * ((tf * (K1 + 1)) / denom);
        scores.set(chunkId, (scores.get(chunkId) || 0) + score);
      }
    }

    const ranked = [...scores.entries()]
      .filter(([id]) => chunkById.has(id))
      .map(([id, score]) => ({ chunk: chunkById.get(id)!, score }))
      .sort((a, b) => b.score - a.score);

    return ranked.slice(0, Math.max(1, limit));
  }

  get termCount(): number {
    return this.postings.size;
  }
}
