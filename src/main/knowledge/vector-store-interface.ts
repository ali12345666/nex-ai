/**
 * NEX AI — Vector Store Interface (Phase 40)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The audit found that the vector store is a concrete class (LocalVectorStore)
 * with no interface abstraction. This makes it impossible to swap in a
 * SQLite-vector, HNSW, or FAISS backend without changing all callers.
 *
 * Phase 40 introduces the VectorStore interface — a minimal contract that
 * all vector stores must implement. The existing LocalVectorStore (JSON +
 * linear scan) continues to work as the default implementation.
 *
 * Future backends:
 *   - SqliteVectorStore (sqlite-vss or sqlite-vec)
 *   - HnswVectorStore (hnswlib-node)
 *   - FaissVectorStore (faiss-node)
 *
 * All can be added WITHOUT changing any caller code.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export interface VectorRecord {
  /** Unique ID for this vector. */
  id: string;
  /** The embedding vector. */
  embedding: number[];
  /** Metadata associated with this vector. */
  metadata: Record<string, any>;
}

export interface VectorSearchResult {
  /** The matched record. */
  record: VectorRecord;
  /** Similarity score (0..1, higher = more similar). */
  score: number;
}

export interface VectorStoreOptions {
  /** Dimension of vectors stored. */
  dimension?: number;
  /** Distance metric: 'cosine' | 'euclidean' | 'dot'. Default: 'cosine'. */
  metric?: 'cosine' | 'euclidean' | 'dot';
  /** Whether to persist to disk. */
  persist?: boolean;
  /** Path for persistence (if persist=true). */
  persistPath?: string;
}

// ─── VectorStore Interface ────────────────────────────────────────────────

/**
 * Minimal vector store contract. All vector store implementations must
 * implement this interface.
 *
 * The interface is intentionally simple — it does NOT include schema
 * management, document tracking, or chunking. Those concerns stay in
 * the KnowledgeService layer. This interface is ONLY about vectors.
 */
export interface VectorStore {
  /** Add a single vector. */
  add(record: VectorRecord): Promise<void>;

  /** Add multiple vectors (batch). */
  addBatch(records: VectorRecord[]): Promise<void>;

  /** Remove a vector by ID. */
  remove(id: string): Promise<boolean>;

  /** Remove multiple vectors by ID. */
  removeBatch(ids: string[]): Promise<number>;

  /** Update a vector's embedding and/or metadata. */
  update(id: string, patch: { embedding?: number[]; metadata?: Record<string, any> }): Promise<boolean>;

  /** Get a vector by ID. */
  get(id: string): Promise<VectorRecord | null>;

  /** Search for similar vectors. */
  search(
    queryEmbedding: number[],
    opts?: {
      limit?: number;
      filter?: (record: VectorRecord) => boolean;
      minScore?: number;
    },
  ): Promise<VectorSearchResult[]>;

  /** Count total vectors. */
  count(): Promise<number>;

  /** Persist to disk (if the store supports persistence). */
  flush(): Promise<void>;

  /** Load from disk (if the store supports persistence). */
  load(): Promise<void>;

  /** Clear all vectors. */
  clear(): Promise<void>;

  /** Dispose resources. */
  dispose(): Promise<void>;
}

// ─── In-Memory Vector Store (reference implementation) ────────────────────

/**
 * A simple in-memory vector store with linear cosine scan.
 * This is the reference implementation — it works but doesn't scale.
 * For production use, swap in a SqliteVectorStore or HnswVectorStore.
 */
export class InMemoryVectorStore implements VectorStore {
  private records: Map<string, VectorRecord> = new Map();
  private opts: Required<VectorStoreOptions>;

  constructor(opts: VectorStoreOptions = {}) {
    this.opts = {
      dimension: opts.dimension || 256,
      metric: opts.metric || 'cosine',
      persist: opts.persist || false,
      persistPath: opts.persistPath || '',
    };
  }

  async add(record: VectorRecord): Promise<void> {
    this.records.set(record.id, { ...record });
  }

  async addBatch(records: VectorRecord[]): Promise<void> {
    for (const r of records) {
      this.records.set(r.id, { ...r });
    }
  }

  async remove(id: string): Promise<boolean> {
    return this.records.delete(id);
  }

  async removeBatch(ids: string[]): Promise<number> {
    let count = 0;
    for (const id of ids) {
      if (this.records.delete(id)) count++;
    }
    return count;
  }

  async update(id: string, patch: { embedding?: number[]; metadata?: Record<string, any> }): Promise<boolean> {
    const existing = this.records.get(id);
    if (!existing) return false;
    if (patch.embedding) existing.embedding = patch.embedding;
    if (patch.metadata) existing.metadata = { ...existing.metadata, ...patch.metadata };
    return true;
  }

  async get(id: string): Promise<VectorRecord | null> {
    const r = this.records.get(id);
    return r ? { ...r } : null;
  }

  async search(
    queryEmbedding: number[],
    opts?: { limit?: number; filter?: (r: VectorRecord) => boolean; minScore?: number },
  ): Promise<VectorSearchResult[]> {
    const limit = opts?.limit ?? 10;
    const minScore = opts?.minScore ?? 0;
    const results: VectorSearchResult[] = [];

    for (const record of this.records.values()) {
      if (opts?.filter && !opts.filter(record)) continue;
      const score = this.computeSimilarity(queryEmbedding, record.embedding);
      if (score >= minScore) {
        results.push({ record: { ...record }, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  async count(): Promise<number> {
    return this.records.size;
  }

  async flush(): Promise<void> {
    // No-op for in-memory store
  }

  async load(): Promise<void> {
    // No-op for in-memory store
  }

  async clear(): Promise<void> {
    this.records.clear();
  }

  async dispose(): Promise<void> {
    this.records.clear();
  }

  private computeSimilarity(a: number[], b: number[]): number {
    if (this.opts.metric === 'cosine') {
      return cosineSimilarity(a, b);
    } else if (this.opts.metric === 'dot') {
      return dotProduct(a, b);
    } else {
      // euclidean → convert to similarity (0..1)
      const dist = euclideanDistance(a, b);
      return 1 / (1 + dist);
    }
  }
}

// ─── Math helpers ──────────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function dotProduct(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

export function euclideanDistance(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}
