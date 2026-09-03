/**
 * NEX AI — PDF Parser (Phase 40)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The audit found that PDF is explicitly listed as UNSUPPORTED in parsers.ts.
 * Phase 40 adds a basic PDF text extractor.
 *
 * This parser does NOT use external dependencies (no pdf-parse, no pdfjs).
 * Instead it implements a lightweight text extraction from the PDF binary
 * stream. It handles:
 *   - Uncompressed text streams (BT...ET blocks with Tj/TJ operators)
 *   - Basic metadata (Title, Author, Subject from the info dictionary)
 *   - Page detection (count /Type /Page entries)
 *
 * It does NOT handle:
 *   - Encrypted/password-protected PDFs
 *   - Compressed streams (FlateDecode) — needs zlib inflation
 *   - Embedded images
 *   - Complex layout reconstruction
 *
 * For production-grade PDF parsing, a future Phase can add an optional
 * dependency on `pdf-parse` or `pdfjs-dist`. This parser provides basic
 * text extraction without any external dependency — good enough for
 * simple text-based PDFs (documentation, manuals, papers).
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as fs from 'fs';
import type { DocumentParser } from '../ai/knowledge-types';

// ─── PDF Parser ────────────────────────────────────────────────────────────

export class PdfParser implements DocumentParser {
  readonly name = 'pdf';

  async parse(filePath: string): Promise<{ text: string; pages?: string[]; sections?: Array<{ title: string; text: string }> }> {
    const buffer = fs.readFileSync(filePath);
    const text = extractPdfText(buffer);
    const pages = splitIntoPages(buffer, text);
    return {
      text,
      pages,
    };
  }

  canHandle(format: string): boolean {
    return format === 'pdf';
  }
}

// ─── Text Extraction ───────────────────────────────────────────────────────

/**
 * Extract text from a PDF buffer.
 *
 * PDF text is encoded in content streams between BT (Begin Text) and
 * ET (End Text) markers. Text is rendered by:
 *   - (string) Tj   — show text
 *   - [array] TJ    — show text with positioning
 *   - 'string'      — move to next line + show text
 *   - "string"      — set word/char spacing + show text
 *
 * We extract the text from these operators. For compressed streams
 * (most modern PDFs), we attempt zlib inflation — if that fails, we
 * fall back to extracting whatever plaintext we can find.
 */
function extractPdfText(buffer: Buffer): string {
  // Convert buffer to a Latin1 string (PDF spec uses 8-bit chars).
  // We use Latin1 to preserve byte values 0-255 without UTF-8 decode errors.
  const data = buffer.toString('latin1');

  // Strategy 1: Try to find uncompressed text in BT/ET blocks.
  const texts: string[] = [];
  const btEtRegex = /BT\s*([\s\S]*?)\s*ET/g;
  let match: RegExpExecArray | null;
  while ((match = btEtRegex.exec(data)) !== null) {
    const block = match[1];
    const text = extractTextFromBlock(block);
    if (text) texts.push(text);
  }

  // Strategy 2: If BT/ET extraction yielded little, try raw Tj/TJ extraction.
  if (texts.join('').length < 50) {
    const tjRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g;
    while ((match = tjRegex.exec(data)) !== null) {
      const text = unescapePdfString(match[1]);
      if (text.trim()) texts.push(text);
    }

    // Also try TJ arrays: [(text1) -10 (text2) 20 (text3)] TJ
    const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
    while ((match = tjArrayRegex.exec(data)) !== null) {
      const arrayContent = match[1];
      const stringParts: string[] = [];
      const stringRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
      let strMatch: RegExpExecArray | null;
      while ((strMatch = stringRegex.exec(arrayContent)) !== null) {
        stringParts.push(unescapePdfString(strMatch[1]));
      }
      if (stringParts.length > 0) {
        texts.push(stringParts.join(''));
      }
    }
  }

  // Strategy 3: If still nothing, try FlateDecode (zlib) decompression.
  if (texts.join('').length < 50) {
    try {
      const zlib = require('zlib');
      const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
      while ((match = streamRegex.exec(data)) !== null) {
        const streamData = match[1];
        try {
          // Strip any leading/trailing whitespace
          const trimmed = streamData.trim();
          const decompressed = zlib.inflateSync(Buffer.from(trimmed, 'latin1'));
          const text = decompressed.toString('latin1');
          // Extract text from the decompressed content stream
          const extracted = extractTextFromBlock(text);
          if (extracted) texts.push(extracted);
        } catch {
          // Not a FlateDecode stream, or inflation failed — skip
        }
      }
    } catch {
      // zlib not available — skip
    }
  }

  // Clean up: remove excessive whitespace
  const fullText = texts.join('\n')
    .replace(/\n{3,}/g, '\n\n')  // collapse multiple newlines
    .replace(/[ \t]+/g, ' ')       // collapse spaces
    .trim();

  return fullText;
}

/**
 * Extract text from a BT...ET content block.
 */
function extractTextFromBlock(block: string): string {
  const texts: string[] = [];

  // Match (string) Tj — show text
  const tjRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = tjRegex.exec(block)) !== null) {
    texts.push(unescapePdfString(match[1]));
  }

  // Match [array] TJ — show text array
  const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
  while ((match = tjArrayRegex.exec(block)) !== null) {
    const arrayContent = match[1];
    const stringRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
    let strMatch: RegExpExecArray | null;
    while ((strMatch = stringRegex.exec(arrayContent)) !== null) {
      texts.push(unescapePdfString(strMatch[1]));
    }
  }

  // Match 'string' — move to next line + show text
  const apostropheRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*'/g;
  while ((match = apostropheRegex.exec(block)) !== null) {
    texts.push('\n' + unescapePdfString(match[1]));
  }

  return texts.join('');
}

/**
 * Unescape a PDF string (handles \\, \), \(, \n, \r, \t, \b, \f, octal).
 */
function unescapePdfString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b')
    .replace(/\\f/g, '\f')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

// ─── Metadata Extraction ───────────────────────────────────────────────────

function extractPdfMetadata(buffer: Buffer): Record<string, any> | undefined {
  const data = buffer.toString('latin1');
  const metadata: Record<string, any> = {};

  // Extract from Info dictionary: /Title (text), /Author (text), etc.
  const fields: Array<[string, string]> = [
    ['title', 'Title'],
    ['author', 'Author'],
    ['subject', 'Subject'],
    ['keywords', 'Keywords'],
    ['creator', 'Creator'],
    ['producer', 'Producer'],
  ];

  for (const [key, pdfField] of fields) {
    const regex = new RegExp(`/${pdfField}\\s*\\(([^()\\n]*(?:\\\\.[^()\\n]*)*)\\)`, 'g');
    const match = regex.exec(data);
    if (match) {
      metadata[key] = unescapePdfString(match[1]);
    }
  }

  // Page count: count /Type /Page (not /Pages)
  const pageCount = (data.match(/\/Type\s*\/Page[^s]/g) || []).length;
  if (pageCount > 0) {
    metadata.pageCount = pageCount;
  }

  // Creation date: /CreationDate (D:YYYYMMDDHHmmSS...)
  const dateMatch = data.match(/\/CreationDate\s*\(([^)]*)\)/);
  if (dateMatch) {
    metadata.creationDate = dateMatch[1];
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

// ─── Page Splitting ────────────────────────────────────────────────────────

function splitIntoPages(buffer: Buffer, fullText: string): string[] | undefined {
  const data = buffer.toString('latin1');
  const pageCount = (data.match(/\/Type\s*\/Page[^s]/g) || []).length;

  // If we have a page count, we know the PDF structure. But splitting
  // extracted text by page is unreliable without parsing content streams
  // per page. For now, if we have a single text blob and multiple pages,
  // we return the whole text as one "page" — the chunker will split it.
  if (pageCount > 1 && fullText.length > 0) {
    return [fullText]; // single page — chunker handles splitting
  }

  return undefined;
}
