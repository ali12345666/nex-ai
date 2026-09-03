/**
 * NEX AI — Citation Engine (Phase 11 / P11-E)
 *
 * One canonical, format-aware citation formatter for retrieved chunks:
 *
 *   calculator.ts → lines 12-27 · function add · score 0.91
 *   guide.md → lines 3-9 · § Refresh Flow · score 0.84
 *   users.csv → rows 21-60 · score 0.77
 *   settings.json → $.database · score 0.75
 *
 * Pure module — consumed by the knowledge-search IPC (renderer display)
 * and retrieveForPrompt framing. Chunk metadata keys are the ones produced
 * by the Phase 9 chunker + Phase 11 structured chunker (startLine/endLine/
 * sectionTitle/symbols/jsonPath/rowRange).
 */

import type { DocumentChunk, KnowledgeDocument } from '../ai/knowledge-types';

export interface CitationInput {
  chunk: Pick<DocumentChunk, 'metadata' | 'sectionTitle'>;
  document: Pick<KnowledgeDocument, 'title' | 'sourcePath'>;
  score?: number;
}

/** Short display path: last 3 path segments at most (leading ellipsis). */
function displaySource(doc: CitationInput['document']): string {
  const p = doc.sourcePath || doc.title || '(unknown)';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length <= 3 ? parts.join('/') : '…/' + parts.slice(-3).join('/');
}

/**
 * Build a single-line citation string.
 * Format precedence: jsonPath (JSON) → rowRange (CSV) → lines (+symbols/§).
 */
export function formatCitation(input: CitationInput): string {
  const { chunk } = input;
  const meta: any = chunk.metadata || {};
  const src = displaySource(input.document);
  const parts: string[] = [];

  if (typeof meta.jsonPath === 'string') {
    parts.push(`${src} → ${meta.jsonPath}`);
  } else if (typeof meta.rowRange === 'string') {
    parts.push(`${src} → ${meta.rowRange}`);
  } else {
    const start = meta.startLine;
    const end = meta.endLine;
    if (typeof start === 'number') {
      parts.push(`${src} → lines ${start}${typeof end === 'number' && end !== start ? `-${end}` : ''}`);
    } else {
      parts.push(src);
    }
    if (chunk.sectionTitle) parts.push(`§ ${chunk.sectionTitle}`);
    const symbols: string[] = Array.isArray(meta.symbols) ? meta.symbols : [];
    if (symbols.length > 0) parts.push(symbols.slice(0, 3).join(' + '));
  }

  if (typeof input.score === 'number' && input.score >= 0) {
    parts.push(`score ${input.score.toFixed(2)}`);
  }
  return parts.join(' · ');
}

/** Multi-line framed citation block for prompts (UNTRUSTED-DATA posture). */
export function framedCitationLine(input: CitationInput): string {
  return `[${formatCitation({ ...input, score: undefined })}]`;
}
