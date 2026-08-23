/**
 * NEX AI — DOCX Parser (Phase 11 / P11-C)
 *
 * Implements the pre-existing DocumentParser interface for .docx via
 * `mammoth` (BSD-2-Clause, pure JS, zero native deps, Windows-safe, fully
 * offline — evaluation in the Phase 11 report).
 *
 * Architectural constraints honored:
 *   - LAZY require('mammoth') — nothing else in the knowledge subsystem
 *     gains a static mammoth import; paths that never touch DOCX never
 *     load it.
 *   - ZIP-BOMB defense: the Phase-9 file guard caps the ARCHIVE at 10 MB,
 *     but a small zip can expand enormously. This parser caps the EXTRACTED
 *     text (5M chars) and rejects with a clear reason instead of exploding
 *     memory.
 *   - Malformed archives: mammoth throws → the ingester's parse error
 *     containment converts it to a 'rejected' outcome (no crash, no retry
 *     storms).
 *
 * Only the modern OOXML .docx container is supported. Legacy binary .doc
 * and other office formats remain detected-but-unsupported (they map to
 * 'office-doc', which has no parser).
 */

import type { DocumentParser, DocumentFormat } from '../ai/knowledge-types';

/** Max extracted characters (zip-bomb expansion guard). */
export const MAX_DOCX_TEXT_CHARS = 5 * 1024 * 1024; // 5M chars ≈ 5-15 MB text

export class DocxParser implements DocumentParser {
  canHandle(format: DocumentFormat): boolean { return format === 'docx'; }

  async parse(filePath: string): Promise<{ text: string; pages?: string[] }> {
    // Lazy load: keeps mammoth out of every non-docx ingestion path.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mammoth = require('mammoth') as {
      extractRawText(opts: { path: string }): Promise<{ value: string }>;
    };

    const result = await mammoth.extractRawText({ path: filePath });
    const text = result.value || '';

    if (text.length > MAX_DOCX_TEXT_CHARS) {
      throw new Error(
        `DOCX expanded content too large (${(text.length / 1e6).toFixed(1)}M chars > ${MAX_DOCX_TEXT_CHARS / 1e6}M — possible zip bomb)`
      );
    }

    // Paragraph-aware split (mammoth separates paragraphs with \n\n);
    // pages[] is optional in the parse contract and improves citation
    // granularity later — cheap to provide here.
    const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
    return { text, pages: paragraphs.length > 1 ? paragraphs : undefined };
  }
}
