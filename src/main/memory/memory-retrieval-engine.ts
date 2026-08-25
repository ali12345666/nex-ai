/**
 * NEX AI — Memory Retrieval Engine (Phase 40)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The audit found that recallRelevantMemories() is DEFINED but NEVER CALLED.
 * context-manager.ts uses list().slice(N) — recency only, no relevance scoring.
 *
 * Phase 40 fixes this by providing a unified MemoryRetrievalEngine that:
 *   1. Queries the SemanticMemoryStore (embedding-based hybrid search)
 *   2. Falls back to the existing key-value memory store (keyword search)
 *   3. Combines results from all memory stores (user, project, task, session)
 *   4. Returns ranked, deduplicated results
 *
 * The engine is called BEFORE the planner generates a plan:
 *   User Request → MemoryRetrievalEngine → Knowledge Retrieval → Context → Planner
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import type { SemanticMemoryStore, SemanticSearchResult, SemanticMemoryType } from './semantic-memory-store';
import type { Embedder } from '../ai/knowledge-types';
import { listMemory, type MemoryStoreType, type MemoryEntry } from './index';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface MemoryRetrievalRequest {
  /** The user's request / query. */
  query: string;
  /** Project path (for project-scoped memories). */
  projectId?: string;
  /** Which memory stores to search. Default: all. */
  stores?: SemanticMemoryType[];
  /** Max results. Default: 10. */
  limit?: number;
  /** Minimum score threshold (0..1). Default: 0.05. */
  minScore?: number;
}

export interface RetrievedMemory {
  /** The store this memory came from. */
  store: SemanticMemoryType;
  /** Memory key (from the existing key-value store). */
  key: string;
  /** Human-readable content. */
  content: string;
  /** Combined relevance score (0..1). */
  score: number;
  /** Importance (0..1). */
  importance: number;
  /** When the memory was created. */
  createdAt: number;
  /** When the memory was last accessed. */
  lastAccess: number;
  /** Metadata from the original entry. */
  metadata?: Record<string, any>;
}

export interface MemoryRetrievalResult {
  memories: RetrievedMemory[];
  /** Whether semantic search was used (vs keyword-only fallback). */
  usedSemantic: boolean;
  /** Total candidates scanned. */
  totalScanned: number;
}

// ─── Memory Retrieval Engine ───────────────────────────────────────────────

/**
 * Unified memory retrieval engine. Combines semantic search (from
 * SemanticMemoryStore) with keyword search (from the existing key-value
 * store) to provide ranked, relevant memories.
 *
 * Usage:
 *   const engine = new MemoryRetrievalEngine(semanticStore, embedder);
 *   const result = await engine.retrieve({
 *     query: "fix authentication bug",
 *     projectId: "/path/to/project",
 *   });
 *   // result.memories → ranked list of relevant memories
 */
export class MemoryRetrievalEngine {
  private semanticStore: SemanticMemoryStore;
  private embedder: Embedder;

  constructor(semanticStore: SemanticMemoryStore, embedder: Embedder) {
    this.semanticStore = semanticStore;
    this.embedder = embedder;
  }

  /**
   * Retrieve relevant memories for a query.
   *
   * Flow:
   *   1. Search SemanticMemoryStore (embedding + keyword + importance + recency)
   *   2. Fallback: scan the existing key-value stores for keyword matches
   *   3. Merge + deduplicate by key
   *   4. Return ranked results
   */
  async retrieve(request: MemoryRetrievalRequest): Promise<MemoryRetrievalResult> {
    const limit = request.limit ?? 10;
    const minScore = request.minScore ?? 0.05;
    const stores = request.stores ?? ['user', 'project', 'task', 'conversation', 'knowledge', 'session'];
    const results: Map<string, RetrievedMemory> = new Map(); // dedup by key
    let totalScanned = 0;
    let usedSemantic = false;

    // ── Phase 1: Semantic search ────────────────────────────────────────
    for (const storeType of stores) {
      const semanticResults = await this.semanticStore.search(request.query, {
        type: storeType,
        projectId: request.projectId,
        limit: limit * 2, // over-fetch for merging
        minScore: 0,
      });

      if (semanticResults.length > 0) {
        usedSemantic = true;
        totalScanned += semanticResults.length;
      }

      for (const r of semanticResults) {
        const key = `${r.item.type}:${r.item.id}`;
        const existing = results.get(key);
        if (!existing || existing.score < r.score) {
          results.set(key, {
            store: r.item.type,
            key: r.item.id,
            content: r.item.content,
            score: r.score,
            importance: r.item.importance,
            createdAt: r.item.createdAt,
            lastAccess: r.item.lastAccess,
            metadata: r.item.metadata,
          });
        }
      }
    }

    // ── Phase 2: Keyword fallback (scan existing key-value store) ───────
    // This catches memories that haven't been embedded yet (e.g. pre-Phase 40
    // memories created by the old system).
    if (results.size < limit) {
      const queryTokens = request.query.toLowerCase().split(/[^a-z0-9\u0080-\uffff]+/).filter((t) => t.length > 2);

      for (const storeType of stores) {
        const mappedStore = mapSemanticTypeToStoreType(storeType);
        if (!mappedStore) continue;

        const entries = listMemory(mappedStore as MemoryStoreType, request.projectId);
        totalScanned += entries.length;

        for (const entry of entries) {
          // Skip if already in results from semantic search
          const key = `${storeType}:${entry.key}`;
          if (results.has(key)) continue;

          // Simple keyword score
          const contentStr = JSON.stringify(entry.value).toLowerCase();
          const keyLower = entry.key.toLowerCase();
          let matched = 0;
          for (const token of queryTokens) {
            if (contentStr.includes(token) || keyLower.includes(token)) {
              matched++;
            }
          }
          if (queryTokens.length > 0 && matched > 0) {
            const keywordScore = matched / queryTokens.length;
            if (keywordScore >= minScore) {
              results.set(key, {
                store: storeType,
                key: entry.key,
                content: typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value),
                score: keywordScore * 0.5, // lower weight than semantic
                importance: 0.5, // default for un-embedded memories
                createdAt: entry.createdAt,
                lastAccess: entry.updatedAt,
                metadata: entry.metadata,
              });
            }
          }
        }
      }
    }

    // ── Phase 3: Sort + truncate ─────────────────────────────────────────
    const sorted = Array.from(results.values()).sort((a, b) => b.score - a.score);
    const truncated = sorted.slice(0, limit);

    return {
      memories: truncated,
      usedSemantic,
      totalScanned,
    };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function mapSemanticTypeToStoreType(semantic: SemanticMemoryType): string | null {
  switch (semantic) {
    case 'user': return 'user';
    case 'project': return 'project';
    case 'task': return 'task';
    case 'conversation': return 'session'; // conversations are in session store
    case 'knowledge': return 'knowledge';
    case 'session': return 'session';
    case 'system': return null; // system memories don't have a k-v store
    default: return null;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

let _retrievalEngine: MemoryRetrievalEngine | null = null;

export function getMemoryRetrievalEngine(): MemoryRetrievalEngine | null {
  return _retrievalEngine;
}

export function setMemoryRetrievalEngine(engine: MemoryRetrievalEngine): void {
  _retrievalEngine = engine;
}
