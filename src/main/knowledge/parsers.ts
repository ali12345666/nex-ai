/**
 * NEX AI — Document Parsers (Phase 9 / P9-S1)
 *
 * Implements the DocumentParser interface from ai/knowledge-types.ts
 * (pre-existing scaffolding from pre-Phase 7 infrastructure — NOT modified).
 *
 * Supported formats (all parsed with PURE Node, zero new dependencies):
 *   plaintext (.txt, .log, .ini, .cfg, …)
 *   markdown (.md, .markdown)
 *   json (.json)
 *   yaml (.yaml, .yml — parsed as structured text; no yaml dep needed
 *         because we only need TEXT for retrieval, not object parsing)
 *   csv (.csv, .tsv — rows preserved as lines)
 *   source-code (.ts, .tsx, .js, .jsx, .py, .css, .scss, and friends)
 *   html (.html, .htm — tags stripped via regex, scripts/styles dropped)
 *
 * NOT SUPPORTED in Phase 9 (would require new binary-format deps; none exist
 * in the project today — rule: no new mandatory deps without approval):
 *   pdf, office-doc, image
 *   → canHandle() returns false; ingester reports a clear error.
 *
 * Security notes (see knowledge/security.ts for the guard layer):
 *  - Parsers NEVER evaluate content. Everything is DATA.
 *  - HTML parser strips <script>/<style> bodies so executable/inline junk
 *    never enters the index.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DocumentFormat, DocumentParser } from '../ai/knowledge-types';

// ─── Format detection ───────────────────────────────────────────────────────

const EXT_TO_FORMAT: Record<string, DocumentFormat> = {
  '.txt': 'plaintext', '.log': 'plaintext', '.ini': 'plaintext', '.cfg': 'plaintext',
  '.md': 'markdown', '.markdown': 'markdown', '.mdx': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.csv': 'csv', '.tsv': 'csv',
  '.xml': 'xml',
  '.html': 'html', '.htm': 'html',
  '.ts': 'source-code', '.tsx': 'source-code', '.js': 'source-code', '.jsx': 'source-code',
  '.mjs': 'source-code', '.cjs': 'source-code', '.py': 'source-code', '.rb': 'source-code',
  '.go': 'source-code', '.rs': 'source-code', '.java': 'source-code', '.c': 'source-code',
  '.h': 'source-code', '.cpp': 'source-code', '.cs': 'source-code', '.php': 'source-code',
  '.css': 'source-code', '.scss': 'source-code', '.less': 'source-code', '.sql': 'source-code',
  '.sh': 'source-code', '.ps1': 'source-code',
  // Detected but NOT parseable in Phase 9 (no binary-format deps allowed).
  // Detection lets the ingester say "PDF unsupported" instead of "unknown".
  '.pdf': 'pdf',
  '.docx': 'office-doc', '.doc': 'office-doc', '.xlsx': 'office-doc', '.pptx': 'office-doc',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.svg': 'image',
};

/** Map a filename to a supported DocumentFormat (null = unsupported). */
export function detectFormat(filename: string): DocumentFormat | null {
  const ext = path.extname(filename).toLowerCase();
  return EXT_TO_FORMAT[ext] || null;
}

/** True when the format is handled by this parser set. */
export function isSupportedFormat(format: DocumentFormat): boolean {
  return format !== 'pdf' && format !== 'office-doc' && format !== 'image';
}

// ─── Parse result ───────────────────────────────────────────────────────────

export interface ParsedDocument {
  text: string;
  /** Optional page-like splits (markdown sections, html blocks) */
  pages?: string[];
  /** Optional named sections (markdown headings) */
  sections?: Array<{ title: string; text: string }>;
}

// ─── Parsers ────────────────────────────────────────────────────────────────

/** Plaintext passthrough. */
export class PlainTextParser implements DocumentParser {
  canHandle(format: DocumentFormat): boolean { return format === 'plaintext'; }
  async parse(filePath: string): Promise<ParsedDocument> {
    return { text: fs.readFileSync(filePath, 'utf-8') };
  }
}

/**
 * Markdown: text as-is + section split on ATX headings (## Title) so the
 * chunker can keep section boundaries and the retriever can cite sections.
 */
export class MarkdownParser implements DocumentParser {
  canHandle(format: DocumentFormat): boolean { return format === 'markdown'; }
  async parse(filePath: string): Promise<ParsedDocument> {
    const text = fs.readFileSync(filePath, 'utf-8');
    const sections: Array<{ title: string; text: string }> = [];
    let currentTitle = '(intro)';
    let buffer: string[] = [];
    for (const line of text.split('\n')) {
      const m = /^(#{1,6})\s+(.*)$/.exec(line);
      if (m) {
        if (buffer.length > 0) sections.push({ title: currentTitle, text: buffer.join('\n').trim() });
        currentTitle = m[2].trim();
        buffer = [line];
      } else {
        buffer.push(line);
      }
    }
    if (buffer.length > 0) sections.push({ title: currentTitle, text: buffer.join('\n').trim() });
    const useful = sections.filter((s) => s.text.length > 0);
    return { text, sections: useful.length > 0 ? useful : undefined };
  }
}

/** JSON: pretty-normalized text (keys preserved — searchable). */
export class JsonParser implements DocumentParser {
  canHandle(format: DocumentFormat): boolean { return format === 'json'; }
  async parse(filePath: string): Promise<ParsedDocument> {
    const raw = fs.readFileSync(filePath, 'utf-8');
    try {
      const obj = JSON.parse(raw);
      return { text: JSON.stringify(obj, null, 2) };
    } catch {
      // Malformed JSON — index the raw text; retrieval still useful,
      // and the chunk metadata will mark the doc (ingester handles errors).
      return { text: raw };
    }
  }
}

/** YAML/CSV: text passthrough (line structure matters for retrieval). */
export class LineTextParser implements DocumentParser {
  canHandle(format: DocumentFormat): boolean { return format === 'yaml' || format === 'csv'; }
  async parse(filePath: string): Promise<ParsedDocument> {
    return { text: fs.readFileSync(filePath, 'utf-8') };
  }
}

/**
 * Source code: raw text (structure preserved for the code-aware chunker).
 * Shebang/BOM normalized; nothing is evaluated.
 */
export class SourceCodeParser implements DocumentParser {
  canHandle(format: DocumentFormat): boolean { return format === 'source-code'; }
  async parse(filePath: string): Promise<ParsedDocument> {
    let text = fs.readFileSync(filePath, 'utf-8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
    return { text };
  }
}

/**
 * HTML: strip script/style blocks entirely, then tags → text.
 * Pure regex — no DOM dependency needed for TEXT retrieval.
 */
export class HtmlParser implements DocumentParser {
  canHandle(format: DocumentFormat): boolean { return format === 'html'; }
  async parse(filePath: string): Promise<ParsedDocument> {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const text = raw
      .replace(/<!--[\s\S]*?-->/g, ' ')          // comments
      .replace(/<script[\s\S]*?<\/script>/gi, ' ') // scripts (never indexed)
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')   // styles
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n') // block ends → newlines
      .replace(/<[^>]+>/g, ' ')                    // remaining tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { text };
  }
}

/**
 * XML (Phase 11 / P11-A): tags → text with entity decoding and comment
 * removal. Structure-light (element names are NOT preserved as sections —
 * text retrieval only). Pure regex, zero deps — same posture as HtmlParser.
 */
export class XmlParser implements DocumentParser {
  canHandle(format: DocumentFormat): boolean { return format === 'xml'; }
  async parse(filePath: string): Promise<ParsedDocument> {
    const raw = fs.readFileSync(filePath, 'utf-8');
    // CDATA content may contain '<'/'>' that must NOT be eaten by later
    // tag-stripping → stash it behind a sentinel, strip tags, then restore.
    const cdataStash: string[] = [];
    const text = raw
      .replace(/<!--[\s\S]*?-->/g, ' ')                    // comments
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, inner) => {
        cdataStash.push(inner);
        return `\u0000CD${cdataStash.length - 1}\u0000`;
      })
      .replace(/<\?[\s\S]*?\?>/g, ' ')                     // processing instructions
      .replace(/\s*\/>/g, ' ')                               // self-closing tails
      .replace(/<\/[A-Za-z][\w:.-]*>/g, '\n')               // closing tags → newline
      .replace(/<[A-Za-z][\w:.-]*(?:\s[^<>]*)?>/g, ' ')      // opening tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(parseInt(d, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\u0000CD(\d+)\u0000/g, (_m, i) => cdataStash[Number(i)] || '')
      .trim();
    return { text };
  }
}

// ─── Registry ───────────────────────────────────────────────────────────────

const PARSERS: DocumentParser[] = [
  new PlainTextParser(),
  new MarkdownParser(),
  new JsonParser(),
  new LineTextParser(),
  new SourceCodeParser(),
  new HtmlParser(),
  new XmlParser(),   // Phase 11 / P11-A
];

/** Find the parser for a format (null when unsupported). */
export function getParser(format: DocumentFormat): DocumentParser | null {
  if (!isSupportedFormat(format)) return null;
  return PARSERS.find((p) => p.canHandle(format)) || null;
}

/** All parsers (for tests/diagnostics). */
export function listParsers(): DocumentParser[] {
  return [...PARSERS];
}
