/**
 * NEX AI — Semantic Memory Store (Phase 40)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The audit found that NEX AI's memory system has NO semantic recall:
 *   - Memory entries are stored as plain JSON files
 *   - context-manager.ts uses list().slice(N) — recency only
 *   - recallRelevantMemories() is defined but NEVER called
 *   - No embeddings on memory entries
 *
 * Phase 40 adds a SemanticMemoryStore that:
 *   1. Embeds memory content using the same Embedder as RAG
 *   2. Stores the embedding alongside the memory entry
 *   3. Provides semantic search (cosine similarity) over memories
 *   4. Tracks importance, access count, last access time
 *   5. Applies recency decay (older memories gradually lose score)
 *
 * This is SEPARATE from the existing key-value memory store — it wraps
 * it with an embedding index. The existing store remains the source of
 * truth; this module adds a search layer on top.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ARCHITECTURE
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   memory/index.ts (existing JSON store — source of truth)
 *         ↕ reads/writes entries
 *   SemanticMemoryStore (this module)
 *         ↕ embeds content + indexes
 *   MemoryRetrievalEngine (next module)
 *         ↕ hybrid: semantic + keyword + importance + recency
 *   context-manager.ts (consumes ranked memories)
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getUserDataDir } from '../persistence';
import type { Embedder } from '../ai/knowledge-types';
import { cosineSimilarity } from '../knowledge/hash-embedder';

// ─── Types ─────────────────────────────────────────────────────────────────

export type SemanticMemoryType =
  | 'user'        // user preferences, identity, style
  | 'project'     // project architecture, conventions, file map
  | 'task'        // task context, plan, state
  | 'conversation' // conversation summary
  | 'knowledge'   // user-imported knowledge
  | 'system'      // system-level facts
  | 'session';    // session-scoped (ephemeral, 24h)

export interface SemanticMemoryItem {
  /** Unique ID (same as the key in the existing store). */
  id: string;
  /** Memory type (which store). */
  type: SemanticMemoryType;
  /** Human-readable content (what the memory says). */
  content: string;
  /** Embedding vector (null if not yet embedded). */
  embedding: number[] | null;
  /** Importance score 0..1 (user-set or auto-computed). */
  importance: number;
  /** Metadata (tags, source, etc. from the original entry). */
  metadata: Record<string, any>;
  /** When the memory was created. */
  createdAt: number;
  /** When the memory was last accessed (for recency decay). */
  lastAccess: number;
  /** How many times this memory has been retrieved. */
  accessCount: number;
  /** Project ID (for project-scoped memories, null for global). */
  projectId?: string;
}

export interface SemanticSearchResult {
  item: SemanticMemoryItem;
  /** Combined score: semantic similarity + importance + recency. */
  score: number;
  /** Breakdown of the score. */
  semanticScore: number;
  importanceScore: number;
  recencyScore: number;
  keywordScore: number;
}

// ─── Semantic Memory Store ─────────────────────────────────────────────────

const INDEX_FILE = 'semantic-memory-index.json';

/**
 * A vector index over the existing memory stores. Stores embeddings + metadata
 * in a JSON file. Provides hybrid search (semantic + keyword + importance +
 * recency decay).
 *
 * This is a companion to the existing key-value memory store — it does NOT
 * replace it. The existing store is the source of truth; this adds search.
 */
export class SemanticMemoryStore {
  private items: Map<string, SemanticMemoryItem> = new Map();
  private indexPath: string;
  private embedder: Embedder;
  private dirty: boolean = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing: boolean = false;

  constructor(embedder: Embedder, userDataDir?: string) {
    this.embedder = embedder;
    const base = userDataDir || getUserDataDir();
    const dir = path.join(base, 'memory', 'semantic');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.indexPath = path.join(dir, INDEX_FILE);
    this.load();
    // Phase 111: Periodic auto-flush every 30 seconds.
    // Ensures embeddings survive crashes that bypass the before-quit handler.
    this.flushTimer = setInterval(() => this.flush(), 30_000);
    // Don't keep the process alive just for this timer
    if (this.flushTimer.unref) this.flushTimer.unref();
  }

  // ─── Persistence ──────────────────────────────────────────────────────

  private load(): void {
    try {
      if (fs.existsSync(this.indexPath)) {
        const data = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
        if (Array.isArray(data.items)) {
          for (const item of data.items) {
            this.items.set(item.id, item);
          }
        }
      }
    } catch {
      // corrupted index — start fresh
      this.items = new Map();
    }
  }

  /**
   * Phase 111: Flush is now re-entrant safe (flushing flag prevents
   * concurrent writes that could cause corruption).
   */
  flush(): void {
    if (!this.dirty || this.flushing) return;
    this.flushing = true;
    try {
      const data = { items: Array.from(this.items.values()), flushedAt: Date.now() };
      const tmp = this.indexPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmp, this.indexPath);
      this.dirty = false;
    } catch {
      // best-effort — dirty stays true, will retry on next flush
    } finally {
      this.flushing = false;
    }
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────

  /**
   * Add or update a memory in the semantic index. Computes the embedding
   * asynchronously if the content changed.
   */
  async upsert(
    id: string,
    type: SemanticMemoryType,
    content: string,
    opts: {
      importance?: number;
      metadata?: Record<string, any>;
      projectId?: string;
      createdAt?: number;
    } = {},
  ): Promise<SemanticMemoryItem> {
    // Phase 111: Enforce secret redaction at the semantic store layer.
    // Even if a caller bypasses the consolidator, secrets are redacted
    // before being embedded and persisted.
    const { redactSecrets } = require('../agent/logger');
    const safeContent = redactSecrets(content).redacted;

    const existing = this.items.get(id);
    const contentChanged = !existing || existing.content !== safeContent;

    let embedding: number[] | null = existing?.embedding || null;
    if (contentChanged && safeContent.length > 0) {
      try {
        embedding = await this.embedder.embed(safeContent);
      } catch {
        embedding = null; // embedder failed — store without embedding
      }
    }

    const item: SemanticMemoryItem = {
      id,
      type,
      content: safeContent,
      embedding,
      importance: opts.importance ?? existing?.importance ?? 0.5,
      metadata: opts.metadata ?? existing?.metadata ?? {},
      createdAt: opts.createdAt ?? existing?.createdAt ?? Date.now(),
      lastAccess: existing?.lastAccess ?? Date.now(),
      accessCount: existing?.accessCount ?? 0,
      projectId: opts.projectId ?? existing?.projectId,
    };

    this.items.set(id, item);
    this.dirty = true;
    return item;
  }

  /** Remove a memory from the semantic index. */
  remove(id: string): boolean {
    const existed = this.items.delete(id);
    if (existed) this.dirty = true;
    return existed;
  }

  /** Get a memory by ID. */
  get(id: string): SemanticMemoryItem | null {
    return this.items.get(id) || null;
  }

  /** List all memories (optionally filtered by type/project). */
  list(filter?: {
    type?: SemanticMemoryType;
    projectId?: string;
  }): SemanticMemoryItem[] {
    let items = Array.from(this.items.values());
    if (filter?.type) {
      items = items.filter((i) => i.type === filter.type);
    }
    if (filter?.projectId !== undefined) {
      items = items.filter((i) => i.projectId === filter.projectId);
    }
    return items;
  }

  /** Mark a memory as accessed (bumps accessCount + lastAccess). */
  touch(id: string): void {
    const item = this.items.get(id);
    if (item) {
      item.lastAccess = Date.now();
      item.accessCount++;
      this.dirty = true;
    }
  }

  // ─── Search ──────────────────────────────────────────────────────────

  /**
   * Hybrid search over memories.
   *
   * Scoring:
   *   - semanticScore: cosine similarity (if embedding available)
   *   - keywordScore: substring/token match in content
   *   - importanceScore: item.importance (0..1)
   *   - recencyScore: exponential decay based on lastAccess
   *
   * Final score = 0.4*semantic + 0.2*keyword + 0.2*importance + 0.2*recency
   */
  async search(
    query: string,
    opts: {
      type?: SemanticMemoryType;
      projectId?: string;
      limit?: number;
      minScore?: number;
    } = {},
  ): Promise<SemanticSearchResult[]> {
    const limit = opts.limit ?? 10;
    const minScore = opts.minScore ?? 0.0;
    const candidates = this.list({ type: opts.type, projectId: opts.projectId });
    if (candidates.length === 0) return [];

    // Embed the query if any candidate has an embedding.
    let queryEmb: number[] | null = null;
    const hasEmbeddings = candidates.some((c) => c.embedding);
    if (hasEmbeddings && query.length > 0) {
      try {
        queryEmb = await this.embedder.embed(query);
      } catch {
        queryEmb = null;
      }
    }

    // Tokenize query for keyword matching.
    const queryTokens = query.toLowerCase().split(/[^a-z0-9\u0080-\uffff]+/).filter((t) => t.length > 1);

    const results: SemanticSearchResult[] = [];

    for (const item of candidates) {
      // Semantic score
      let semanticScore = 0;
      if (queryEmb && item.embedding) {
        semanticScore = cosineSimilarity(queryEmb, item.embedding);
        // Clamp to [0, 1]
        semanticScore = Math.max(0, Math.min(1, semanticScore));
      }

      // Keyword score (simple token overlap)
      let keywordScore = 0;
      if (queryTokens.length > 0) {
        const contentLower = item.content.toLowerCase();
        let matched = 0;
        for (const token of queryTokens) {
          if (contentLower.includes(token)) matched++;
        }
        keywordScore = matched / queryTokens.length;
      }

      // Importance score
      const importanceScore = item.importance;

      // Recency score (exponential decay: half-life = 7 days)
      const ageMs = Date.now() - item.lastAccess;
      const ageDays = ageMs / (24 * 60 * 60 * 1000);
      const recencyScore = Math.exp(-ageDays / 7); // 1.0 today, ~0.37 after 7 days

      // Combined score
      const score = 0.4 * semanticScore + 0.2 * keywordScore + 0.2 * importanceScore + 0.2 * recencyScore;

      if (score >= minScore) {
        results.push({
          item,
          score,
          semanticScore,
          importanceScore,
          recencyScore,
          keywordScore,
        });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Touch the top results (mark as accessed)
    for (const r of results.slice(0, limit)) {
      this.touch(r.item.id);
    }

    return results.slice(0, limit);
  }

  /** Get stats about the semantic index. */
  getStats(): {
    totalItems: number;
    withEmbeddings: number;
    byType: Record<string, number>;
    avgImportance: number;
  } {
    const items = Array.from(this.items.values());
    const byType: Record<string, number> = {};
    let withEmbeddings = 0;
    let importanceSum = 0;
    for (const item of items) {
      byType[item.type] = (byType[item.type] || 0) + 1;
      if (item.embedding) withEmbeddings++;
      importanceSum += item.importance;
    }
    return {
      totalItems: items.length,
      withEmbeddings,
      byType,
      avgImportance: items.length > 0 ? importanceSum / items.length : 0,
    };
  }

  /** Clear all memories (used for "reset" operations). */
  clear(): void {
    this.items.clear();
    this.dirty = true;
  }

  /** Dispose — flush pending writes + clear timer. */
  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }
}
