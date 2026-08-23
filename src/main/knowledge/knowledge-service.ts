/**
 * NEX AI — Knowledge Service (Phase 9 / P9-S3)
 *
 * Implements the pre-existing `KnowledgeBase` interface (ai/knowledge-types.ts)
 * as the single facade over the Phase 9 subsystem:
 *
 *   addDocument (validate → parse → chunk → embed → store, with dedup)
 *   removeDocument / listDocuments / getDocument / retrieve / getStats
 *   + rebuildIndex / clearProject / ensureEmbedded (backfill)
 *
 * Bound to ONE project per instance (projectId) — isolation by construction.
 *
 * Injection-only wiring (architecture rule): embedder is passed in
 * (HashEmbedder offline default / LlamaCppEmbedder GGUF upgrade). NOTHING
 * imports the agent; the AGENT side receives a port (see P9-S4).
 *
 * Persistence location: <userDataDir>/knowledge/<projectId>/ — the same
 * userData layout the Phase 2 persistence layer established (portable-aware
 * via the userData root chosen by the caller in main.ts).
 */

import * as path from 'path';
import type {
  DocumentChunk, Embedder, KnowledgeBase, KnowledgeDocument,
  KnowledgeDomain, RetrievalQuery, RetrievalResult,
} from '../ai/knowledge-types';
import { ingestFile, needsReindex, type IngestOutcome } from './ingester';
import { LocalVectorStore } from './vector-store';
import { HybridRetriever } from './retriever';
import { frameDocumentChunk } from './security';

export interface KnowledgeServiceOptions {
  userDataDir: string;
  projectId: string;
  embedder: Embedder;
  /** allowed roots for ingestion (defaults to nothing — caller must set) */
  roots: string[];
}

export interface AddDocumentReport {
  documentId?: string;
  status: 'indexed' | 'skipped-unchanged' | 'unsupported' | 'rejected';
  reason?: string;
  chunkCount?: number;
}

export class KnowledgeService implements KnowledgeBase {
  readonly projectId: string;
  private store: LocalVectorStore;
  private retriever: HybridRetriever;
  private embedder: Embedder;
  private roots: string[];

  constructor(opts: KnowledgeServiceOptions) {
    this.projectId = opts.projectId;
    this.embedder = opts.embedder;
    this.roots = opts.roots;
    this.store = new LocalVectorStore(opts.userDataDir, opts.projectId);
    this.retriever = new HybridRetriever({ store: this.store, embedder: this.embedder });
  }

  /** Exposed for the tool layer / IPC stats. */
  getStatsStore(): LocalVectorStore { return this.store; }

  /**
   * Phase 10 / P10-A: describe the active embedder for the UI —
   * duck-typed so the service keeps depending on the Embedder INTERFACE
   * (no concrete-class imports here).
   */
  embeddingInfo(): { backend: 'hash' | 'llamacpp' | 'custom'; dimension?: number; offline: boolean; modelPath?: string } {
    const e = this.embedder as any;
    const safeDim = (): number | undefined => {
      try { return this.embedder.dimension; } catch { return undefined; } // GGUF embedder: unknown until first embed
    };
    if (typeof e?.embedSync === 'function') {
      return { backend: 'hash', dimension: safeDim(), offline: true };
    }
    if (typeof e?.dispose === 'function' && typeof e?.opts?.modelPath === 'string') {
      return { backend: 'llamacpp', dimension: safeDim(), offline: true, modelPath: e.opts.modelPath };
    }
    return { backend: 'custom', offline: true };
  }

  // ── KnowledgeBase interface ───────────────────────────────────────────────

  async addDocument(
    filePath: string,
    domain?: KnowledgeDomain,
    metadata?: Record<string, any>
  ): Promise<KnowledgeDocument> {
    const report = await this.ingestWithReport(filePath, domain, metadata);
    if (report.documentId) {
      const doc = this.store.getDocument(report.documentId);
      if (doc) return doc;
    }
    throw new Error(report.reason || `Ingestion failed: ${report.status}`);
  }

  /**
   * Richer add used by the service layer/IPC: reports skip/unsupported/
   * rejected instead of throwing, with chunk counts.
   *
   * `force` bypasses the unchanged-skip (rebuildIndex after an embedder
   * model swap must re-embed even identical content — vectors changed).
   */
  async ingestWithReport(
    filePath: string,
    domain?: KnowledgeDomain,
    _metadata?: Record<string, any>,
    force = false
  ): Promise<AddDocumentReport> {
    const outcome: IngestOutcome = await ingestFile(filePath, {
      projectId: this.projectId,
      roots: this.roots,
      domain,
    });

    if (outcome.status !== 'indexed') {
      return { status: outcome.status, reason: outcome.reason };
    }

    // dedup: identical content (same hash) → skip (unless forced)
    const existing = this.store.getDocument(outcome.document.id);
    if (!force && !needsReindex(
      { hash: outcome.document.metadata!.checksum!, sizeBytes: outcome.document.metadata!.sizeBytes!, modifiedAt: outcome.document.metadata!.modifiedAt! },
      existing
    )) {
      return { status: 'skipped-unchanged', documentId: outcome.document.id, chunkCount: existing?.metadata?.chunkCount ?? 0 };
    }

    // embed chunks (LOCAL embedder — offline guarantee)
    const chunks = outcome.chunks;
    const embeddings = await this.embedder.embedBatch(chunks.map((c) => c.content));
    const embedded: DocumentChunk[] = chunks.map((c, i) => ({ ...c, embedding: embeddings[i] }));

    // replace document + chunks atomically in the store, then persist
    await this.store.updateDocument(outcome.document, embedded);
    this.store.flush();

    return { status: 'indexed', documentId: outcome.document.id, chunkCount: embedded.length };
  }

  async removeDocument(documentId: string): Promise<void> {
    await this.store.deleteByDocument(documentId);
    this.store.flush();
  }

  /** Remove index data for files that no longer exist (cleanup pass). */
  async purgeMissing(): Promise<string[]> {
    const purged: string[] = [];
    for (const doc of this.store.listDocuments()) {
      if (!doc.sourcePath || !require('fs').existsSync(doc.sourcePath)) {
        await this.store.deleteByDocument(doc.id);
        purged.push(doc.id);
      }
    }
    if (purged.length > 0) this.store.flush();
    return purged;
  }

  async listDocuments(domain?: KnowledgeDomain): Promise<KnowledgeDocument[]> {
    const docs = this.store.listDocuments();
    return domain ? docs.filter((d) => d.domain === domain) : docs;
  }

  async retrieve(query: RetrievalQuery): Promise<RetrievalResult[]> {
    return this.retriever.retrieve(query);
  }

  async getDocument(documentId: string): Promise<KnowledgeDocument | null> {
    return this.store.getDocument(documentId);
  }

  async getStats(): Promise<{ documents: number; chunks: number; domains: Record<string, number> }> {
    const docs = this.store.listDocuments();
    const domains: Record<string, number> = {};
    for (const d of docs) domains[d.domain || 'general'] = (domains[d.domain || 'general'] || 0) + 1;
    const stats = await this.store.getStats();
    return { documents: stats.totalDocuments, chunks: stats.totalChunks, domains: domains as any };
  }

  // ── Extras (service layer) ────────────────────────────────────────────────

  async clearProject(): Promise<void> {
    await this.store.clearProject();
  }

  /**
   * Full rebuild: force re-ingest every registered source file and RE-EMBED
   * (bypasses unchanged-skip — primary use: after embedder model swap).
   */
  async rebuildIndex(onProgress?: (done: number, total: number) => void): Promise<{ indexed: number; skipped: number; failed: number }> {
    const docs = this.store.listDocuments();
    let indexed = 0, skipped = 0, failed = 0;
    let done = 0;
    for (const doc of docs) {
      if (doc.sourcePath) {
        const r = await this.ingestWithReport(doc.sourcePath, doc.domain, undefined, true);
        if (r.status === 'indexed') indexed++;
        else if (r.status === 'skipped-unchanged') skipped++;
        else failed++;
      } else {
        failed++;
      }
      done++;
      onProgress?.(done, docs.length);
    }
    return { indexed, skipped, failed };
  }

  /**
   * Prompt-ready context: retrieval results framed as UNTRUSTED DATA with
   * citations (section J) — this is what the agent side consumes.
   */
  async retrieveForPrompt(query: string, limit = 4): Promise<{ framed: string; results: RetrievalResult[] }> {
    const results = await this.retrieve({ query, mode: 'hybrid', limit });
    const framed = results.map((r) => {
      const m = r.chunk.metadata || {};
      const rel = this.projectId && r.document.sourcePath
        ? r.document.sourcePath
        : r.document.title;
      return frameDocumentChunk({
        source: rel,
        startLine: m.startLine,
        endLine: m.endLine,
        content: r.chunk.content,
      });
    }).join('\n\n');
    return { framed, results };
  }
}

/**
 * Registry of active per-project services (main-process side).
 * One service per project — isolation boundary. The IPC layer (P9-S4)
 * always resolves by projectId, never exposing cross-project handles.
 */
const _services = new Map<string, KnowledgeService>();

export function getKnowledgeService(
  opts: KnowledgeServiceOptions
): KnowledgeService {
  let svc = _services.get(opts.projectId);
  if (!svc) {
    svc = new KnowledgeService(opts);
    _services.set(opts.projectId, svc);
  }
  return svc;
}

export function listKnowledgeProjects(): string[] {
  return [..._services.keys()];
}

export function disposeKnowledgeServices(): void {
  _services.clear();
}
