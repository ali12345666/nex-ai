/**
 * NEX AI — Structured Chunker (Phase 11 / P11-D)
 *
 * Format-aware chunking that upgrades the Phase 9 flow ADDITIVELY:
 *   JSON  → object/array boundaries: each top-level key subtree (object) or
 *           row groups (array) becomes a chunk annotated with jsonPath.
 *   CSV   → header + row groups: header line repeated in EVERY chunk
 *           (retrieval + citation friendly), rows counted per group.
 *   Code  → symbol-aligned: boundaries from P11-A extracted symbols
 *           (function/class/method ranges) — prelude (imports/comments)
 *           chunks first, then consecutive symbols grouped up to target
 *           size. Falls back to the Phase 9 unit flow when no symbols.
 *   Text/Markdown → Phase 9 behavior (already paragraph/heading-aware).
 *
 * Deterministic + stable chunk IDs (reuses chunker.stableChunkId).
 * Citation-friendly: every chunk keeps 1-based startLine/endLine + symbols
 * (via metadata) so citations can read "calculator.ts → function add →
 * lines 10-18".
 *
 * Pure module — no fs, no imports beyond the sibling chunker helpers.
 */

import { stableChunkId, splitBlock, DEFAULT_CHUNKER_CONFIG, type ChunkerConfig } from './chunker';
import type { DocumentChunk, DocumentFormat } from '../ai/knowledge-types';
import { extractCodeStructure, type CodeSymbol } from './code-structure';

export interface StructuredChunkInput {
  documentId: string;
  text: string;
  format: DocumentFormat;
  filename?: string;
  config?: ChunkerConfig;
  /** pre-extracted structure (ingester already has it) — optional */
  symbols?: CodeSymbol[];
  language?: string;
  sections?: Array<{ title: string; text: string }>; // markdown path (P9)
}

/**
 * Entry point: pick the structured strategy per format; returns null for
 * formats where the Phase 9 chunker remains the strategy (plaintext,
 * markdown, yaml, html, xml, docx) — callers fall back to chunkDocument.
 */
export function structuredChunkDocument(input: StructuredChunkInput): DocumentChunk[] | null {
  switch (input.format) {
    case 'json':
      return chunkJson(input);
    case 'csv':
      return chunkCsv(input);
    case 'source-code':
      return chunkCodeStructured(input);
    default:
      return null; // Phase 9 path stays authoritative
  }
}

// ─── JSON ───────────────────────────────────────────────────────────────────

function chunkJson(input: StructuredChunkInput): DocumentChunk[] | null {
  const cfg = { ...DEFAULT_CHUNKER_CONFIG, ...(input.config || {}) };
  const { documentId, text } = input;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null; // malformed → caller falls back to text-flow chunking
  }

  const chunks: DocumentChunk[] = [];
  const lines = text.split('\n');
  let idx = 0;

  const push = (content: string, jsonPath: string, kind: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    const startLine = locateLine(lines, trimmed);
    const endLine = startLine + Math.max(0, trimmed.split('\n').length - 1);
    chunks.push({
      id: stableChunkId(documentId, idx, trimmed),
      documentId,
      content: trimmed,
      index: idx++,
      startOffset: text.indexOf(trimmed.slice(0, 40)),
      endOffset: 0,
      metadata: { format: 'json' as DocumentFormat, startLine, endLine, jsonPath, jsonKind: kind },
    });
  };

  if (Array.isArray(parsed)) {
    // row groups: up to `groupSize` serialized items per chunk
    const groupSize = Math.max(1, Math.floor(cfg.targetChars / 80) || 15);
    for (let i = 0; i < parsed.length; i += groupSize) {
      const slice = parsed.slice(i, i + groupSize);
      push(JSON.stringify(slice, null, 1), `$[${i}:${i + slice.length - 1}]`, 'array-group');
    }
    if (parsed.length === 0) push(text, '$', 'empty-array');
    return reindex(chunks);
  }

  if (parsed && typeof parsed === 'object') {
    const entries = Object.entries(parsed as Record<string, unknown>);
    for (const [key, value] of entries) {
      const serialized = JSON.stringify({ [key]: value }, null, 1);
      push(serialized, `$.${key}`, value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);
    }
    if (entries.length === 0) push(text, '$', 'empty-object');
    return reindex(chunks);
  }

  // primitive root (rare) — plain flow
  return null;
}

// ─── CSV ────────────────────────────────────────────────────────────────────

function chunkCsv(input: StructuredChunkInput): DocumentChunk[] | null {
  const cfg = { ...DEFAULT_CHUNKER_CONFIG, ...(input.config || {}) };
  const { documentId, text } = input;
  const lines = text.split('\n').filter((l, i, arr) => l.trim() !== '' || i < arr.length - 1);
  if (lines.length === 0) return [];

  const header = lines[0];
  const dataLines = lines.slice(1).filter((l) => l.trim() !== '');
  if (dataLines.length === 0) {
    return [{
      id: stableChunkId(documentId, 0, header),
      documentId,
      content: header,
      index: 0,
      metadata: { format: 'csv' as DocumentFormat, startLine: 1, endLine: 1, rowRange: 'header-only' },
    }];
  }

  // group rows until target chars (header always prepended → self-describing
  // chunks: "name,role\nAli,engineer\nSara,designer")
  const chunks: DocumentChunk[] = [];
  let idx = 0;
  let group: string[] = [];
  let groupFirstRow = 1; // 1-based data row numbers
  let rowCursor = 0;

  const flush = () => {
    if (group.length === 0) return;
    const content = `${header}\n${group.join('\n')}`;
    const startLine = 1 + (groupFirstRow - 1) + 1; // header line + rows above
    const endLine = startLine + group.length - 1;
    chunks.push({
      id: stableChunkId(documentId, idx, content),
      documentId,
      content,
      index: idx++,
      metadata: {
        format: 'csv' as DocumentFormat,
        startLine,
        endLine,
        rowRange: `rows ${groupFirstRow}-${groupFirstRow + group.length - 1}`,
        rowCount: group.length,
      },
    });
    group = [];
  };

  let est = header.length;
  for (const line of dataLines) {
    rowCursor++;
    if (group.length === 0) groupFirstRow = rowCursor;
    if (est + line.length + 1 > cfg.targetChars && group.length > 0) {
      flush();
      groupFirstRow = rowCursor;
      est = header.length;
    }
    group.push(line);
    est += line.length + 1;
    if (est >= cfg.maxChars) flush(); // hard cap per group
  }
  flush();
  return reindex(chunks);   // row groups are atomic — no min-chars drop
}

// ─── Source code (symbol-aligned) ───────────────────────────────────────────

function chunkCodeStructured(input: StructuredChunkInput): DocumentChunk[] | null {
  const cfg = { ...DEFAULT_CHUNKER_CONFIG, ...(input.config || {}) };
  const { documentId, text } = input;
  const allLines = text.split('\n');

  // symbols provided or extracted here (best-effort; extraction never throws)
  let symbols = input.symbols;
  if (!symbols && input.language && input.filename) {
    try {
      const structure = extractCodeStructure(text, input.language as any);
      symbols = structure.symbols;
    } catch {
      symbols = [];
    }
  }
  // normalize: sort by start, then keep ONLY non-overlapping outermost
  // symbols (first-wins): nested methods/locals inside a kept symbol's
  // [start, end] range are dropped — the enclosing symbol is the boundary.
  const sorted = (symbols || [])
    .filter((s) => typeof s.startLine === 'number' && s.startLine >= 1)
    .sort((a, b) => a.startLine - b.startLine);
  const flat: CodeSymbol[] = [];
  let lastEnd = 0;
  for (const sym of sorted) {
    if (sym.startLine > lastEnd) {
      flat.push(sym);
      lastEnd = sym.endLine ?? sym.startLine;
    }
  }
  symbols = flat;

  if (!symbols || symbols.length === 0) return null; // fallback → P9 units

  const chunks: DocumentChunk[] = [];
  let idx = 0;
  const mkChunk = (content: string, startLine: number, meta: { symbols: string[] }): DocumentChunk => {
    const trimmed = content.trim();
    const endLine = startLine + Math.max(0, content.split('\n').length - 1);
    return {
      id: stableChunkId(documentId, chunks.length, trimmed),
      documentId,
      content: trimmed,
      index: idx++,
      metadata: {
        format: 'source-code' as DocumentFormat,
        startLine,
        endLine,
        ...(meta.symbols.length > 0 ? { symbols: meta.symbols } : {}),
      },
    };
  };

  // 1) prelude: everything before the first symbol
  const firstStart = symbols[0].startLine;
  if (firstStart > 1) {
    const preludeLines = allLines.slice(0, firstStart - 1).join('\n');
    if (preludeLines.trim().length > 0) {
      for (const piece of splitBlock(preludeLines, cfg)) {
        chunks.push(mkChunk(piece, 1, { symbols: [] }));
      }
    }
  }

  // 2) symbols → grouped chunks (whole symbols kept intact when they fit)
  let buf: string[] = [];
  let bufStart = 0;
  let bufSymbols: string[] = [];
  let cursor = firstStart - 1; // 0-based line index after prelude

  const flushBuf = (endLine: number) => {
    if (buf.length === 0) return;
    const content = buf.join('\n');
    if (content.trim().length > 0) {
      chunks.push(mkChunk(content, bufStart, { symbols: bufSymbols }));
    }
    buf = [];
    bufSymbols = [];
  };

  for (const sym of symbols) {
    const symStart = sym.startLine;
    const symEnd = Math.min(sym.endLine ?? sym.startLine, allLines.length);

    // gap lines between cursor and this symbol (comments/blank glue code)
    if (symStart - 1 > cursor) {
      const gap = allLines.slice(cursor, symStart - 1).join('\n');
      if (gap.trim().length > 0 && buf.length === 0) bufStart = cursor + 1;
      if (gap.trim().length > 0) {
        // attach small gaps to the upcoming symbol's buffer
        if (gap.length <= cfg.overlapChars * 4) { if (buf.length === 0) bufStart = cursor + 1; buf.push(gap); }
        else { flushBuf(cursor); for (const p of splitBlock(gap, cfg)) chunks.push(mkChunk(p, cursor + 1, { symbols: [] })); }
      }
    }

    const symText = linesFor(allLines, symStart, symEnd);
    const symLabel = `${sym.kind} ${sym.name}`;

    if (symText.length > cfg.maxChars) {
      // oversized symbol: flush, then flow-split its body (label attached)
      flushBuf(symStart - 1);
      for (const piece of splitBlock(symText, cfg)) {
        chunks.push(mkChunk(piece, symStart, { symbols: [symLabel] }));
      }
    } else if (buf.join('\n').length + symText.length + 1 <= cfg.targetChars) {
      if (buf.length === 0) bufStart = symStart;
      buf.push(symText);
      bufSymbols.push(symLabel);
    } else {
      flushBuf(symStart - 1);
      bufStart = symStart;
      buf.push(symText);
      bufSymbols.push(symLabel);
    }
    cursor = symEnd; // 0-based index of last consumed line
  }

  // 3) trailing lines after the last symbol
  if (cursor < allLines.length - 1) {
    const tail = allLines.slice(cursor + 1).join('\n');
    if (tail.trim().length > 0) {
      if (buf.length === 0) bufStart = cursor + 1;
      buf.push(tail);
    }
  }
  flushBuf(allLines.length);

  return finalize(chunks, cfg);
}

function linesFor(allLines: string[], start: number, end: number): string {
  return allLines.slice(start - 1, end).join('\n');
}

// ─── shared helpers ─────────────────────────────────────────────────────────

function locateLine(lines: string[], needle: string): number {
  const head = needle.slice(0, 40).trim();
  if (!head) return 1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(head.slice(0, Math.min(20, head.length)))) return i + 1;
  }
  return 1;
}

/** Structural formats: preserve every unit, only fix indexes. */
function reindex(chunks: DocumentChunk[]): DocumentChunk[] {
  return chunks.map((c, i) => ({ ...c, index: i }));
}

function finalize(chunks: DocumentChunk[], cfg: Required<ChunkerConfig>): DocumentChunk[] {
  const kept = chunks.filter((c, i) => c.content.length >= cfg.minChunkChars || i === 0 || i === chunks.length - 1);
  return kept.map((c, i) => ({ ...c, index: i }));
}
