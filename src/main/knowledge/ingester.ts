/**
 * NEX AI — Document Ingester (Phase 9 / P9-S1)
 *
 * Turns a validated file into a KnowledgeDocument + chunks, with:
 *  - full metadata (id, projectId, sourcePath, filename, extension, size,
 *    modifiedAt, hash, chunkCount, indexedAt)
 *  - content hash (sha256) → same file content never duplicates
 *  - change detection → re-index path replaces chunks cleanly
 *  - stable document id from (projectId + relative-ish path) so re-ingest
 *    UPDATES the same document record instead of creating a new one
 *
 * Storage-agnostic: the ingester produces records; the KnowledgeService
 * (P9-S3) decides where they persist.
 *
 * Pure Node (fs + crypto) — deterministic and unit-testable.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { DocumentChunk, DocumentParser, KnowledgeDocument, KnowledgeDomain } from '../ai/knowledge-types';
import { detectFormat, getParser } from './parsers';
import { chunkDocument, type ChunkerConfig } from './chunker';
import { validateIngestFile, stripControlChars, scanForInjection, type IngestGuardOptions } from './security';
// Phase 11 / P11-A: structural source-code metadata (additive enrichment)
import { detectLanguage, extractCodeStructure, attachSymbolsToChunks } from './code-structure';

export interface IngestOptions {
  projectId: string;
  /** allowed roots for validation (usually [projectPath]) */
  roots: string[];
  domain?: KnowledgeDomain;
  chunkerConfig?: ChunkerConfig;
  guard?: Partial<IngestGuardOptions>;
  /** override computed id (tests) */
  documentId?: string;
}

export type IngestOutcome =
  | { status: 'indexed'; document: KnowledgeDocument; chunks: DocumentChunk[] }
  | { status: 'unsupported'; reason: string; filePath: string }
  | { status: 'rejected'; reason: string; filePath: string };

/** sha256 of file bytes — dedup + change detection. */
export function hashFileContent(absPath: string): string {
  const buf = fs.readFileSync(absPath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Stable document id from project + normalized path (no random). */
export function stableDocumentId(projectId: string, absPath: string): string {
  const norm = absPath.split(path.sep).join('/');
  const h = crypto.createHash('sha1').update(`${projectId}:${norm}`).digest('hex');
  return `doc_${h.slice(0, 20)}`;
}

/**
 * Ingest one file: validate → parse → chunk → annotate.
 * NEVER writes to the store — returns the records (caller persists).
 */
export async function ingestFile(filePath: string, opts: IngestOptions): Promise<IngestOutcome> {
  // 1) Security gate (traversal/symlink/size/binary/format)
  const guard = validateIngestFile(filePath, { roots: opts.roots, ...opts.guard });
  if (!guard.ok) {
    const unsupported = /Unsupported/.test(guard.reason || '');
    return unsupported
      ? { status: 'unsupported', reason: guard.reason!, filePath }
      : { status: 'rejected', reason: guard.reason!, filePath };
  }
  const abs = guard.resolvedPath!;
  const format = guard.format!;

  // 2) Parse (parser guaranteed by format allowlist)
  const parser = getParser(format);
  if (!parser) {
    return { status: 'unsupported', reason: `No parser for ${format}`, filePath };
  }
  let parsed: Awaited<ReturnType<DocumentParser['parse']>>;
  try {
    parsed = await parser.parse(abs);
  } catch (err: any) {
    // Phase 11 / P11-C: containment for malformed/corrupt containers
    // (e.g. truncated DOCX zips, zip-bomb guards) — reject cleanly, never throw.
    return { status: 'rejected', reason: `Parse failed: ${err.message}`, filePath };
  }
  const text = stripControlChars(parsed.text);
  if (text.trim().length === 0) {
    return { status: 'rejected', reason: 'No extractable text', filePath };
  }

  // 3) Metadata + hash
  const stat = fs.statSync(abs);
  const hash = hashFileContent(abs);
  const filename = path.basename(abs);
  const extension = path.extname(filename).toLowerCase().slice(1);

  // 4) Chunk (structure-aware)
  const chunks = chunkDocument({
    documentId: opts.documentId || stableDocumentId(opts.projectId, abs),
    text,
    format,
    sections: parsed.sections,
    config: opts.chunkerConfig,
  });

  // 4.5) Phase 11 / P11-A: structural metadata for source files — language,
  // imports and symbols attached to document + overlapping chunks (citations
  // can then say "calculator.ts → function add → lines 10-18").
  const language = detectLanguage(filename);
  let structure: ReturnType<typeof extractCodeStructure> | null = null;
  if (language) {
    try {
      structure = extractCodeStructure(text, language);
      attachSymbolsToChunks(chunks, structure);
    } catch {
      structure = null; // best-effort only — never fail ingestion
    }
  }

  // 5) Injection annotation (data stays data — flag only)
  for (const c of chunks) {
    const scan = scanForInjection(c.content);
    c.metadata = {
      ...(c.metadata || {}),
      projectId: opts.projectId,
      hash,
      ...(scan.suspected ? { suspectedInjection: true, injectionMatches: scan.matches } : {}),
    };
  }

  const document: KnowledgeDocument = {
    id: opts.documentId || stableDocumentId(opts.projectId, abs),
    title: filename,
    format,
    sourcePath: abs,
    domain: opts.domain || 'user-imported',
    version: '1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {
      sizeBytes: stat.size,
      checksum: hash,
      projectId: opts.projectId,
      filename,
      extension,
      modifiedAt: Math.round(stat.mtimeMs),
      chunkCount: chunks.length,
      indexedAt: Date.now(),
      // Phase 11 / P11-A: structural document metadata
      ...(language ? { language } : {}),
      ...(structure && structure.imports.length > 0 ? { imports: structure.imports.slice(0, 100) } : {}),
      ...(structure && structure.symbols.length > 0 ? { symbolCount: structure.symbols.length } : {}),
    },
  };

  return { status: 'indexed', document, chunks };
}

/**
 * Compare an incoming doc against the stored one (same id) to decide
 * skip/re-index. Pure helper — store lookup happens in KnowledgeService.
 */
export function needsReindex(
  incoming: { hash: string; sizeBytes: number; modifiedAt: number },
  stored?: { metadata?: { checksum?: string; sizeBytes?: number; modifiedAt?: number } } | null
): boolean {
  if (!stored) return true;
  const m = stored.metadata || {};
  if (m.checksum && m.checksum === incoming.hash) return false; // identical
  if (m.sizeBytes === incoming.sizeBytes && m.modifiedAt === incoming.modifiedAt) return false;
  return true;
}
