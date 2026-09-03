/**
 * NEX AI — Local Hash Embedder (Phase 9 / P9-S2)
 *
 * implements the EXISTING `Embedder` interface (ai/knowledge-types.ts).
 *
 * 100% LOCAL and OFFLINE: deterministic feature-hashing embedding.
 *   - tokens → hashed into a fixed-dimension vector (default 256 dims)
 *   - unigrams + bigrams + character-trigram marks → decent lexical-semantic
 *     signal for hybrid retrieval (paired with keyword search)
 *   - L2-normalized → cosine similarity works with the plain vector store
 *
 * This is the DEFAULT embedder: zero deps, zero network, deterministic
 * (same text → same vector), fast on any CPU — meets the offline guarantee.
 *
 * A GGUF-model-based embedder (LlamaCppEmbedder) implements the same
 * interface and can REPLACE this one via configuration later — Agent Core
 * and the retriever never know which is active.
 */

import * as crypto from 'crypto';
import type { Embedder } from '../ai/knowledge-types';

export interface HashEmbedderOptions {
  /** vector dimensions (default 256; must be ≥ 64) */
  dimensions?: number;
}

/** Tokenize for hashing: lowercase words + code identifiers split. */
export function tokenizeForEmbedding(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`_*#>]/g, ' ')
    .split(/[^a-z0-9\u0080-\uffff]+/)
    .filter((t) => t.length > 1);
}

/** Deterministic hash → [0, dimensions) with sign. */
function hashIndex(token: string, salt: string, dimensions: number): { idx: number; sign: number } {
  const h = crypto.createHash('md5').update(`${salt}:${token}`).digest();
  const idx = h.readUInt16LE(0) % dimensions;
  const sign = (h[2] & 1) === 0 ? 1 : -1;
  return { idx, sign };
}

export class HashEmbedder implements Embedder {
  readonly dimension: number;
  readonly maxTokens = 8192; // text-level cap; longer text simply folds in
  private readonly dims: number;

  constructor(opts: HashEmbedderOptions = {}) {
    this.dims = Math.max(64, opts.dimensions ?? 256);
    this.dimension = this.dims;
  }

  async embed(text: string): Promise<number[]> {
    return this.embedBatch([text]).then((v) => v[0]);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedSync(t));
  }

  /** Synchronous core — also usable directly by tests/tools. */
  embedSync(text: string): number[] {
    const vec = new Float64Array(this.dims);
    const tokens = tokenizeForEmbedding(text).slice(0, this.maxTokens);

    // unigrams (weight 1.0)
    for (const tok of tokens) {
      const { idx, sign } = hashIndex(tok, 'uni', this.dims);
      vec[idx] += sign * 1.0;
    }
    // bigrams (weight 0.5) — local word order
    for (let i = 0; i + 1 < tokens.length; i++) {
      const { idx, sign } = hashIndex(`${tokens[i]}_${tokens[i + 1]}`, 'bi', this.dims);
      vec[idx] += sign * 0.5;
    }
    // char 4-gram marks (weight 0.25) — robustness to morphology/typos
    const joined = tokens.join(' ');
    for (let i = 0; i + 4 <= joined.length; i += 2) {
      const gram = joined.slice(i, i + 4);
      const { idx, sign } = hashIndex(gram, 'gr', this.dims);
      vec[idx] += sign * 0.25;
    }

    // L2 normalize → cosine == dot product for the vector store
    let norm = 0;
    for (let i = 0; i < this.dims; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;
    const out = new Array<number>(this.dims);
    for (let i = 0; i < this.dims; i++) out[i] = vec[i] / norm;
    return out;
  }
}

/** Cosine similarity for L2-normalized vectors (dot product). */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // normalized inputs → [-1, 1]
}
