/**
 * NEX AI — Hybrid Retriever (Phase 9 / P9-S3)
 *
 * Implements retrieval over one project's store by combining:
 *   - SEMANTIC search (vector similarity via Embedder + VectorDB)
 *   - KEYWORD search (BM25-lite via KeywordIndex)
 *   - reciprocal-rank fusion (RRF) — parameter-free, robust
 *   - metadata filtering (domain / documentIds / minScore)
 *
 * Output: RetrievalResult[] (EXISTING type) carrying source + line ranges
 * for citations (section J): sourcePath, sectionTitle, startLine/endLine.
 *
 * Reranking interface: the existing `Reranker` type can be injected later;
 * Phase 9 ships RRF fusion (a rank-based reranker) — the abstraction is
 * ready and tested for a local cross-encoder in the future.
 *
 * Pure module — embedder/store injected. No network. No agent imports.
 */

import type {
  DocumentChunk, KnowledgeDocument,
  RetrievalQuery, RetrievalResult, Embedder,
} from '../ai/knowledge-types';
import type { LocalVectorStore } from './vector-store';
import { KeywordIndex } from './keyword-index';

export interface HybridRetrieverDeps {
  store: LocalVectorStore;
  embedder: Embedder;
  /** Phase 18: optional local reranker applied AFTER RRF fusion. */
  reranker?: import('../ai/knowledge-types').Reranker;
}

/** RRF constants (standard k=60). */
const RRF_K = 60;

/**
 * Semantic-only floor (Phase 9): a chunk surfaced ONLY by the semantic leg
 * (zero keyword corroboration) must clear this cosine similarity or it is
 * dropped — hash-embedding noise on unrelated text measures ≈ [-0.1, +0.05]
 * while true paraphrase matches measure ≥ ~0.2. Chunks the KEYWORD leg
 * independently ranked are always kept (exact-term evidence beats floors).
 */
const SEMANTIC_ONLY_FLOOR = 0.08;

export class HybridRetriever {
  private store: LocalVectorStore;
  private embedder: Embedder;
  private reranker?: import('../ai/knowledge-types').Reranker;
  private keywordIndex: KeywordIndex | null = null;
  private indexChunkCount = -1;

  constructor(deps: HybridRetrieverDeps) {
    this.store = deps.store;
    this.embedder = deps.embedder;
    this.reranker = deps.reranker; // Phase 18: optional quality stage
  }

  /** Rebuild the keyword index when the chunk set changed (cheap check). */
  private ensureIndex(): void {
    const chunks = this.store.allChunks();
    if (!this.keywordIndex || this.indexChunkCount !== chunks.length) {
      this.keywordIndex = new KeywordIndex();
      this.keywordIndex.build(chunks);
      this.indexChunkCount = chunks.length;
    }
  }

  /**
   * Retrieve relevant chunks for a query (implements the retrieval half of
   * the pre-existing KnowledgeBase interface contract used by the service).
   */
  async retrieve(query: RetrievalQuery): Promise<RetrievalResult[]> {
    this.ensureIndex();
    const limit = query.limit ?? 5;
    const minScore = query.minScore ?? 0.0;

    // candidate pool = a bit more than limit so fusion + filters can drop
    const pool = Math.max(limit * 3, 15);

    // allowlist from documentIds filter
    const allow = query.documentIds ? new Set(query.documentIds) : undefined;

    // ── semantic leg ──
    const qEmb = await this.embedder.embed(query.query);
    const semantic = this.store
      .searchRaw(qEmb, pool, allow)
      .map((h) => ({ chunk: h.chunk, score: h.score }));

    // ── keyword leg ──
    const byId = new Map<string, DocumentChunk>(
      this.store.allChunks().map((c) => [c.id, c] as const)
    );
    const keyword = allow
      ? this.keywordIndex!.search(query.query, pool, byId)
          .filter((h) => allow.has(h.chunk.documentId))
      : this.keywordIndex!.search(query.query, pool, byId);
    const keywordIds = new Set(keyword.map((h) => h.chunk.id));

    // domain filter applies to BOTH legs
    const domainOk = (chunk: DocumentChunk): boolean => {
      if (!query.domain) return true;
      const doc = this.store.getDocument(chunk.documentId);
      return doc?.domain === query.domain;
    };

    // ── reciprocal-rank fusion ──
    const fused = new Map<string, { chunk: DocumentChunk; semRank?: number; kwRank?: number; score: number }>();
    semantic
      .filter((h) => domainOk(h.chunk))
      .filter((h) => keywordIds.has(h.chunk.id) || h.score >= SEMANTIC_ONLY_FLOOR)
      .forEach((h, i) => {
        const e = fused.get(h.chunk.id) || { chunk: h.chunk, score: 0 };
        e.semRank = i + 1;
        e.score += 1 / (RRF_K + i + 1);
        fused.set(h.chunk.id, e);
      });
    keyword.filter((h) => domainOk(h.chunk)).forEach((h, i) => {
      const e = fused.get(h.chunk.id) || { chunk: h.chunk, score: 0 };
      e.kwRank = i + 1;
      e.score += 1 / (RRF_K + i + 1);
      fused.set(h.chunk.id, e);
    });

    // ── Phase 18: optional local reranker refines the fused ranking ──
    let ranked = [...fused.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    if (this.reranker && ranked.length > 1) {
      try {
        const reranked = await this.reranker.rerank(
          query.query,
          ranked.map((r) => r.chunk),
          limit
        );
        if (reranked.length > 0) {
          ranked = reranked.map((r) => {
            const prev = fused.get(r.chunk.id);
            return { chunk: r.chunk, score: r.score, semRank: prev?.semRank, kwRank: prev?.kwRank };
          });
        }
      } catch { /* reranker failure → keep RRF order (enrichment only) */ }
    }

    return ranked.map((e) => {
      const doc = this.store.getDocument(e.chunk.documentId);
      const matchedBoth = e.semRank !== undefined && e.kwRank !== undefined;
      return {
        chunk: e.chunk,
        document: doc || unknownDoc(e.chunk),
        score: e.score,
        matchType: query.mode === 'keyword' && !matchedBoth
          ? 'keyword'
          : query.mode === 'semantic' && !matchedBoth
          ? 'semantic'
          : 'hybrid',
        highlights: e.chunk.content
          .split('\n')
          .filter((l) => l.trim().length > 0)
          .slice(0, 3)
          .map((text) => ({ text: text.slice(0, 160), score: e.score })),
      } as RetrievalResult;
    }).filter((r) => r.score >= minScore || minScore === 0);
  }
}

function unknownDoc(chunk: DocumentChunk): KnowledgeDocument {
  return {
    id: chunk.documentId,
    title: '(missing document record)',
    format: (chunk.metadata?.format as any) || 'plaintext',
    version: '0',
    createdAt: 0,
    updatedAt: 0,
    sourcePath: undefined,
  };
}
