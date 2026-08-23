/**
 * NEX AI — Local Vector Store (Phase 9 / P9-S2)
 *
 * implements the EXISTING `VectorDB` interface (ai/knowledge-types.ts).
 *
 * 100% LOCAL: JSON file per project under
 *   <userData>/knowledge/<projectId>/store.json
 *   <userData>/knowledge/<projectId>/docs.json
 *
 * PROJECT ISOLATION (critical): every store instance is bound to ONE
 * projectId at construction; the data file lives in a per-project
 * directory; searches only ever see that project's chunks. Cross-project
 * retrieval is impossible by construction (no API takes a foreign project).
 *
 * Operations: addChunk / addChunks, searchSimilar (exact cosine over the
 * in-memory index — thousands of chunks are microseconds), updateDocument
 * (delete+insert), deleteByDocument, deleteChunk, clearProject, getStats.
 * Persistence: debounced explicit flush() — callers control durability.
 *
 * No external services. No SQLite (avoids native module + file-locking
 * pitfalls on Windows). Plain fs — Windows-safe path joins via path module.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DocumentChunk, KnowledgeDocument, VectorDB } from '../ai/knowledge-types';
import { cosineSimilarity } from './hash-embedder';

export interface VectorStorePaths {
  docsFile: string;
  chunksFile: string;
}

export function knowledgeDirFor(userDataDir: string, projectId: string): string {
  // sanitize projectId into a filesystem-safe segment
  const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(userDataDir, 'knowledge', safe);
}

export function vectorStorePathsFor(userDataDir: string, projectId: string): VectorStorePaths {
  const dir = knowledgeDirFor(userDataDir, projectId);
  return {
    docsFile: path.join(dir, 'docs.json'),
    chunksFile: path.join(dir, 'store.json'),
  };
}

interface StoreState {
  docs: Record<string, KnowledgeDocument>;
  chunks: Record<string, DocumentChunk & { projectId: string }>;
}

export class LocalVectorStore implements VectorDB {
  private state: StoreState = { docs: {}, chunks: {} };
  private readonly paths: VectorStorePaths;
  readonly projectId: string;

  constructor(userDataDir: string, projectId: string) {
    this.projectId = projectId;
    this.paths = vectorStorePathsFor(userDataDir, projectId);
    this.load();
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private load(): void {
    try {
      if (fs.existsSync(this.paths.docsFile)) {
        this.state.docs = JSON.parse(fs.readFileSync(this.paths.docsFile, 'utf-8'));
      }
    } catch { this.state.docs = {}; }
    try {
      if (fs.existsSync(this.paths.chunksFile)) {
        this.state.chunks = JSON.parse(fs.readFileSync(this.paths.chunksFile, 'utf-8'));
      }
    } catch { this.state.chunks = {}; }
  }

  /** Persist to disk (atomic write via temp+rename — Windows-locked-file safe). */
  flush(): void {
    const dir = path.dirname(this.paths.docsFile);
    fs.mkdirSync(dir, { recursive: true });
    atomicWrite(this.paths.docsFile, JSON.stringify(this.state.docs));
    atomicWrite(this.paths.chunksFile, JSON.stringify(this.state.chunks));
  }

  // ── Documents ─────────────────────────────────────────────────────────────

  putDocument(doc: KnowledgeDocument): void {
    this.state.docs[doc.id] = { ...doc };
  }

  getDocument(documentId: string): KnowledgeDocument | null {
    return this.state.docs[documentId] || null;
  }

  listDocuments(): KnowledgeDocument[] {
    return Object.values(this.state.docs);
  }

  // ── Chunks (VectorDB interface + extras) ─────────────────────────────────

  async addChunk(chunk: DocumentChunk): Promise<void> {
    this.state.chunks[chunk.id] = { ...chunk, projectId: this.projectId } as any;
  }

  /** Batch insert for ingestion (single flush by caller). */
  async addChunks(chunks: DocumentChunk[]): Promise<void> {
    for (const c of chunks) await this.addChunk(c);
  }

  async updateDocument(doc: KnowledgeDocument, chunks: DocumentChunk[]): Promise<void> {
    await this.deleteByDocument(doc.id);
    this.putDocument(doc);
    await this.addChunks(chunks);
  }

  async deleteChunk(chunkId: string): Promise<void> {
    delete this.state.chunks[chunkId];
  }

  async deleteByDocument(documentId: string): Promise<void> {
    delete this.state.docs[documentId];
    for (const id of Object.keys(this.state.chunks)) {
      if (this.state.chunks[id].documentId === documentId) delete this.state.chunks[id];
    }
  }

  /** Full project wipe — removes in-memory state AND the on-disk files. */
  async clearProject(): Promise<void> {
    this.state = { docs: {}, chunks: {} };
    for (const f of [this.paths.docsFile, this.paths.chunksFile]) {
      try { if (fs.existsSync(f)) fs.rmSync(f); } catch { /* ignore */ }
    }
  }

  getChunk(chunkId: string): (DocumentChunk & { projectId: string }) | null {
    return this.state.chunks[chunkId] || null;
  }

  listChunksByDocument(documentId: string): DocumentChunk[] {
    return Object.values(this.state.chunks)
      .filter((c) => c.documentId === documentId)
      .sort((a, b) => a.index - b.index);
  }

  allChunks(): DocumentChunk[] {
    return Object.values(this.state.chunks);
  }

  /** Unindexed chunks (no embedding yet) — used by KnowledgeService backfill. */
  chunksNeedingEmbedding(): Array<DocumentChunk & { projectId: string }> {
    return Object.values(this.state.chunks).filter((c) => !c.embedding || c.embedding.length === 0);
  }

  // ── Search ────────────────────────────────────────────────────────────────

  async searchSimilar(
    queryEmbedding: number[],
    limit: number,
    domain?: import('../ai/knowledge-types').KnowledgeDomain
  ): Promise<Array<{ chunk: DocumentChunk; score: number }>> {
    // Domain filter: chunk → its document → doc.domain
    const domainDocIds = domain
      ? new Set(Object.values(this.state.docs).filter((d) => d.domain === domain).map((d) => d.id))
      : undefined;
    return Promise.resolve(this.searchRaw(queryEmbedding, limit, domainDocIds));
  }

  /**
   * Raw similarity search with an optional explicit document-id allowlist
   * (used by the hybrid retriever for RetrievalQuery.documentIds).
   */
  searchRaw(
    queryEmbedding: number[],
    limit: number,
    documentIds?: Set<string> | string[]
  ): Array<{ chunk: DocumentChunk; score: number }> {
    const allow = documentIds instanceof Set ? documentIds : (documentIds ? new Set(documentIds) : undefined);
    const results: Array<{ chunk: DocumentChunk; score: number }> = [];
    for (const c of Object.values(this.state.chunks)) {
      if (!c.embedding || c.embedding.length === 0) continue;
      if (allow && !allow.has(c.documentId)) continue;
      results.push({ chunk: c, score: cosineSimilarity(queryEmbedding, c.embedding) });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, Math.max(1, limit));
  }

  async getStats(): Promise<{ totalChunks: number; totalDocuments: number; sizeBytes: number }> {
    let size = 0;
    for (const f of [this.paths.docsFile, this.paths.chunksFile]) {
      try { if (fs.existsSync(f)) size += fs.statSync(f).size; } catch { /* ignore */ }
    }
    return {
      totalChunks: Object.keys(this.state.chunks).length,
      totalDocuments: Object.keys(this.state.docs).length,
      sizeBytes: size,
    };
  }
}

/** Atomic file write (temp + rename) — crash/Windows-lock safe. */
function atomicWrite(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filePath);
}
