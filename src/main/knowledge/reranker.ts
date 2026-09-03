/**
 * NEX AI — Local Lexical Reranker (Phase 18)
 *
 * Implements the pre-existing `Reranker` interface (knowledge-types.ts)
 * with a fully LOCAL, zero-dependency, model-free algorithm:
 *
 *   score = phraseBonus + coverage + proximity + idf-weighted density − lengthPenalty
 *
 *  - phraseBonus: exact multi-word query phrases appearing verbatim
 *  - coverage: fraction of DISTINCT query terms present (idf-weighted)
 *  - proximity: min window spanning all matched terms (tighter = better)
 *  - density: matched-term frequency per 100 tokens (capped)
 *  - lengthPenalty: gently favors focused chunks over walls of text
 *
 * RRF-fused retrieval (P9) casts a wide net; this reranker then reorders
 * the candidates so the BEST lexical evidence floats to the top — a
 * classic hybrid-RAG quality stage that needs no model download.
 *
 * Pure module: no fs/network/electron. Deterministic.
 */

import type { DocumentChunk, Reranker } from '../ai/knowledge-types';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at',
  'by', 'for', 'with', 'about', 'into', 'to', 'from', 'in', 'on', 'of', 'is',
  'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these',
  'as', 'how', 'do', 'does', 'what', 'which', 'who', 'can', 'use', 'using',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u0080-\uffff]+/)
    .filter((t) => t.length > 1);
}

function contentTerms(query: string): string[] {
  return [...new Set(tokenize(query).filter((t) => !STOPWORDS.has(t)))];
}

/** Positions of each term in the token stream (for proximity windows). */
function termPositions(tokens: string[], terms: string[]): Map<string, number[]> {
  const pos = new Map<string, number[]>();
  for (const t of terms) pos.set(t, []);
  tokens.forEach((tok, i) => {
    const hits = pos.get(tok);
    if (hits) hits.push(i);
  });
  return pos;
}

/** Smallest window covering ≥1 position of EVERY matched term. */
function minWindow(pos: Map<string, number[]>): number | null {
  const matched = [...pos.entries()].filter(([, p]) => p.length > 0);
  if (matched.length < 2) return null;
  // sliding window over sorted positions (classic min-cover)
  const events = matched.flatMap(([, p]) => p).sort((a, b) => a - b);
  const need = matched.length;
  let best: number | null = null;
  let left = 0;
  const counts = new Map<string, number>();
  const ownerOf = new Map<number, string>();
  for (const [term, p] of matched) for (const x of p) ownerOf.set(x, term);
  for (let right = 0; right < events.length; right++) {
    const rTerm = ownerOf.get(events[right])!;
    counts.set(rTerm, (counts.get(rTerm) || 0) + 1);
    while (counts.size === need) {
      const width = events[right] - events[left] + 1;
      if (best === null || width < best) best = width;
      const lTerm = ownerOf.get(events[left])!;
      const c = counts.get(lTerm)! - 1;
      if (c === 0) counts.delete(lTerm); else counts.set(lTerm, c);
      left++;
    }
  }
  return best;
}

export class LexicalReranker implements Reranker {
  async rerank(
    query: string,
    chunks: DocumentChunk[],
    topK: number
  ): Promise<Array<{ chunk: DocumentChunk; score: number }>> {
    const terms = contentTerms(query);
    if (terms.length === 0 || chunks.length === 0) {
      return chunks.slice(0, Math.max(0, topK)).map((chunk) => ({ chunk, score: 0 }));
    }
    const phrase = query.trim().toLowerCase();
    const multiWordPhrase = phrase.split(/\s+/).length >= 2 ? phrase : null;

    // idf over the candidate set (small n — cheap)
    const df = new Map<string, number>();
    const tokenized = chunks.map((c) => tokenize(c.content));
    for (const toks of tokenized) {
      const seen = new Set(toks);
      for (const t of terms) if (seen.has(t)) df.set(t, (df.get(t) || 0) + 1);
    }
    const idf = (t: string) => Math.log(1 + chunks.length / (1 + (df.get(t) || 0)));

    const scored = chunks.map((chunk, i) => {
      const toks = tokenized[i];
      const pos = termPositions(toks, terms);
      let coveredWeight = 0;
      let totalWeight = 0;
      let density = 0;
      for (const t of terms) {
        const w = idf(t);
        totalWeight += w;
        const p = pos.get(t)!;
        if (p.length > 0) {
          coveredWeight += w;
          density += Math.min(p.length, 5) * w; // cap runaway repeats
        }
      }
      const coverage = totalWeight > 0 ? coveredWeight / totalWeight : 0;
      const per100 = toks.length > 0 ? (density / toks.length) * 100 : 0;
      const densityScore = Math.min(per100, 12) / 12; // normalize to [0,1]

      const window = minWindow(pos);
      const nToks = Math.max(1, toks.length);
      const proximity = window === null ? 0 : Math.max(0, 1 - window / Math.min(nToks, 120));

      let phraseBonus = 0;
      if (multiWordPhrase && chunk.content.toLowerCase().includes(multiWordPhrase)) {
        phraseBonus = 0.5;
      }

      const lengthPenalty = nToks > 400 ? 0.05 : 0;

      const score =
        phraseBonus +
        0.45 * coverage +
        0.25 * proximity +
        0.15 * densityScore -
        lengthPenalty;

      return { chunk, score: Number(score.toFixed(6)) };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(0, topK));
  }
}

/**
 * Wire the reranker into the hybrid retrieval pipeline (additive):
 * applies the Reranker to RRF candidates when one is provided.
 */
export async function applyReranker(
  reranker: Reranker | null | undefined,
  query: string,
  candidates: Array<{ chunk: DocumentChunk; score: number }>,
  topK: number
): Promise<Array<{ chunk: DocumentChunk; score: number }>> {
  if (!reranker || candidates.length <= 1) {
    return candidates.slice(0, topK);
  }
  const reranked = await reranker.rerank(
    query,
    candidates.map((c) => c.chunk),
    topK
  );
  return reranked;
}
