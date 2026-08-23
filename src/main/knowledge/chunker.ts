/**
 * NEX AI — Document Chunker (Phase 9 / P9-S1)
 *
 * Splits parsed text into retrieval-sized chunks with:
 *  - configurable target size + overlap (NOT hardcoded — ChunkerConfig)
 *  - structure awareness:
 *      • markdown sections respected when the parser supplied them
 *      • source code split at top-level boundaries (blank lines between
 *        blocks, then brace-depth resets) so functions/classes stay whole
 *        whenever they fit
 *  - stable chunk IDs: sha1(documentId + index + content hash) — same file
 *    content → same IDs across re-indexes (dedup-friendly)
 *  - char offsets + line ranges preserved for citations
 *
 * Pure module (crypto + string logic only) — deterministic, unit-testable.
 */

import * as crypto from 'crypto';
import type { DocumentChunk, DocumentFormat } from '../ai/knowledge-types';

export interface ChunkerConfig {
  /** target chunk size in CHARACTERS (default 1200) */
  targetChars?: number;
  /** max hard chunk size (default 2000) — oversized units get force-split */
  maxChars?: number;
  /** overlap between consecutive chunks in CHARACTERS (default 150) */
  overlapChars?: number;
  /** minimum chars for a standalone trailing chunk (default 80) */
  minChunkChars?: number;
}

export const DEFAULT_CHUNKER_CONFIG: Required<ChunkerConfig> = {
  targetChars: 1200,
  maxChars: 2000,
  overlapChars: 150,
  minChunkChars: 80,
};

/** Stable chunk id: deterministic from document + position + content. */
export function stableChunkId(documentId: string, index: number, content: string): string {
  const h = crypto.createHash('sha1').update(`${documentId}:${index}:${content}`).digest('hex');
  return `chk_${h.slice(0, 20)}`;
}

interface LineRange {
  startLine: number; // 1-based inclusive
  endLine: number;   // 1-based inclusive
}

/** Convert char offsets → 1-based line range (pure). */
export function offsetsToLines(text: string, start: number, end: number): LineRange {
  const before = text.slice(0, start);
  const startLine = before.split('\n').length;
  const body = text.slice(start, end);
  const endLine = startLine + body.split('\n').length - 1;
  return { startLine, endLine };
}

// ─── Generic text splitting with overlap ────────────────────────────────────

/**
 * Split a text block into pieces ≤ target size, cutting at the LAST
 * paragraph/sentence/word boundary before the limit, with overlap carried
 * from the tail of the previous piece.
 */
function splitBlock(block: string, cfg: Required<ChunkerConfig>): string[] {
  if (block.length <= cfg.maxChars) return [block];
  const pieces: string[] = [];
  let cursor = 0;
  while (cursor < block.length) {
    let end = Math.min(cursor + cfg.targetChars, block.length);
    if (end < block.length) {
      // find a soft boundary inside (cursor, end]
      const window = block.slice(cursor, end);
      let cut = -1;
      const para = window.lastIndexOf('\n\n');
      const line = window.lastIndexOf('\n');
      const sent = Math.max(window.lastIndexOf('. '), window.lastIndexOf('۔ '));
      const word = window.lastIndexOf(' ');
      if (para >= cfg.targetChars * 0.4) cut = para;
      else if (line >= cfg.targetChars * 0.4) cut = line;
      else if (sent >= cfg.targetChars * 0.4) cut = sent + 1;
      else if (word >= cfg.targetChars * 0.4) cut = word;
      if (cut > 0) end = cursor + cut + 1;
    }
    const piece = block.slice(cursor, end).trim();
    if (piece.length > 0) pieces.push(piece);
    if (end >= block.length) break;
    // advance with overlap
    cursor = end - Math.min(cfg.overlapChars, Math.floor(cfg.targetChars / 3));
    if (cursor < 0) cursor = 0;
  }
  return pieces;
}

// ─── Code-aware unit extraction ─────────────────────────────────────────────

/**
 * Split source code into logical units: a unit ends at a blank line whose
 * brace depth is 0 (top-level boundary). Units map 1:1 to "blocks" later
 * split by size. This keeps functions/classes intact whenever they fit.
 */
export function splitCodeUnits(code: string): string[] {
  const lines = code.split('\n');
  const units: string[] = [];
  let depth = 0;
  let current: string[] = [];
  for (const line of lines) {
    current.push(line);
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }
    const isBlank = line.trim() === '';
    if (isBlank && depth === 0 && current.some((l) => l.trim() !== '')) {
      units.push(current.join('\n'));
      current = [];
    }
  }
  if (current.some((l) => l.trim() !== '')) units.push(current.join('\n'));
  return units.length > 0 ? units : [code];
}

// ─── Main chunker ───────────────────────────────────────────────────────────

export interface ChunkInput {
  documentId: string;
  text: string;
  format: DocumentFormat;
  /** markdown sections (from MarkdownParser) — optional */
  sections?: Array<{ title: string; text: string }>;
  config?: ChunkerConfig;
}

/**
 * Chunk a parsed document. Deterministic: same input → same chunks/ids.
 */
export function chunkDocument(input: ChunkInput): DocumentChunk[] {
  const cfg = { ...DEFAULT_CHUNKER_CONFIG, ...(input.config || {}) };
  const { documentId, text, format } = input;
  const chunks: DocumentChunk[] = [];

  // ── Markdown with sections: chunk per section (citations get titles) ──
  if (input.sections && input.sections.length > 0) {
    let idx = 0;
    for (const sec of input.sections) {
      const pieces = splitBlock(sec.text, cfg);
      for (const p of pieces) {
        const { startLine } = locate(text, p);
        const chunk: DocumentChunk = {
          id: stableChunkId(documentId, idx, p),
          documentId,
          content: p,
          index: idx,
          startOffset: text.indexOf(p),
          endOffset: text.indexOf(p) + p.length,
          sectionTitle: sec.title,
          metadata: {
            format,
            startLine,
            endLine: startLine + p.split('\n').length - 1,
          },
        };
        chunks.push(chunk);
        idx++;
      }
    }
    return finalize(chunks, cfg);
  }

  // ── Source code: unit-aware then size-aware ──
  if (format === 'source-code') {
    const units = splitCodeUnits(text);
    // merge small adjacent units up to target size
    const merged: string[] = [];
    let buf = '';
    for (const u of units) {
      if (buf.length + u.length + 1 <= cfg.targetChars) {
        buf = buf.length === 0 ? u : `${buf}\n${u}`;
      } else {
        if (buf) merged.push(buf);
        buf = u;
      }
    }
    if (buf) merged.push(buf);
    let idx = 0;
    for (const unit of merged) {
      for (const piece of splitBlock(unit, cfg)) {
        pushWithLocation(piece, idx++);
      }
    }
    return finalize(chunks, cfg);
  }

  // ── Default: paragraph-flow splitting ──
  {
    let idx = 0;
    for (const piece of splitBlock(text, cfg)) {
      pushWithLocation(piece, idx++);
    }
  }

  return finalize(chunks, cfg);

  // helper: push + compute real line range by locating content in text
  function pushWithLocation(content: string, index: number, sectionTitle?: string) {
    const trimmed = content.trim();
    if (!trimmed) return;
    const { startLine, startOffset } = locate(text, trimmed);
    chunks.push({
      id: stableChunkId(documentId, index, trimmed),
      documentId,
      content: trimmed,
      index,
      startOffset,
      endOffset: startOffset + trimmed.length,
      sectionTitle,
      metadata: {
        format,
        startLine,
        endLine: startLine + trimmed.split('\n').length - 1,
      },
    });
  }
}

/** find a content block's 1-based start line + char offset (best effort) */
function locate(text: string, content: string): { startLine: number; startOffset: number } {
  const startOffset = text.indexOf(content.slice(0, Math.min(60, content.length)));
  if (startOffset < 0) return { startLine: 1, startOffset: 0 };
  const startLine = text.slice(0, startOffset).split('\n').length;
  return { startLine, startOffset };
}

/** drop too-small trailing fragments + enforce index continuity */
function finalize(chunks: DocumentChunk[], cfg: Required<ChunkerConfig>): DocumentChunk[] {
  const kept = chunks.filter((c, i) =>
    c.content.length >= cfg.minChunkChars || i === 0 || i === chunks.length - 1
  );
  // re-number indexes after filtering
  return kept.map((c, i) => ({ ...c, index: i }));
}
