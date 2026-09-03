/**
 * NEX AI Markdown Renderer
 *
 * SECURITY-CRITICAL: This module renders AI model output into the DOM.
 *
 * Approach:
 *  - Pure-TypeScript markdown parser (no external deps, full control)
 *  - Strict HTML allow-list via sanitizeHtml()
 *  - Code blocks are rendered as <pre><code> with NO html execution
 *  - Inline code/links/bold/italic only
 *  - All <script>, onerror, javascript: URLs are stripped
 *
 * This is the FIX for v1.0's XSS vulnerability in ChatPanel.tsx:62
 * which used `dangerouslySetInnerHTML` with naive regex sanitization.
 */

import { sanitizeHtml } from './sanitize';

export interface MarkdownBlock {
  type: 'code' | 'text';
  content: string;
  lang?: string;
}

/**
 * Split markdown into code blocks and text blocks.
 * Code blocks (```...```) are kept separate so we can render them as <pre>
 * without parsing their inner content as markdown.
 */
export function splitMarkdown(input: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const parts = input.split(/(```[\s\S]*?```)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('```') && part.endsWith('```')) {
      const lines = part.split('\n');
      const lang = lines[0].replace(/^```/, '').trim();
      const code = lines.slice(1, -1).join('\n');
      blocks.push({ type: 'code', content: code, lang });
    } else {
      blocks.push({ type: 'text', content: part });
    }
  }
  return blocks;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render a markdown text block to SAFE HTML.
 * Supports: inline code, bold, italic, links [text](url), line breaks.
 * Everything else is escaped.
 *
 * After this function, we still pass through sanitizeHtml() to strip
 * any unexpected tags that may have slipped through.
 */
function renderInlineMarkdown(text: string): string {
  // Tokenize to handle nested patterns
  // Process order: code > bold > italic > links > line breaks
  let html = escapeHtml(text);

  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, (_m, code) => `<code class="nex-inline-code">${code}</code>`);

  // Links: [text](url) — only allow http/https/mailto
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, linkText, url) => {
      const trimmedUrl = url.trim();
      if (/^(https?:\/\/|mailto:)/i.test(trimmedUrl)) {
        return `<a href="${trimmedUrl}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
      }
      // Disallowed URL: render as plain text
      return linkText;
    }
  );

  // Bold: **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic: *text*
  html = html.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');

  // Headers at line start
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bullet lists
  html = html.replace(/^[\t ]*[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');

  // Line breaks
  html = html.replace(/\n/g, '<br/>');

  // Remove <br/> immediately after block tags
  html = html.replace(/(<\/(?:h[1-6]|ul|ol|li|p)>)<br\/?>/g, '$1');

  return html;
}

export function renderMarkdownToHtml(input: string): string {
  const blocks = splitMarkdown(input);
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'code') {
      const lang = block.lang || 'code';
      const escaped = escapeHtml(block.content);
      parts.push(
        `<div class="nex-code-block">` +
        `<div class="nex-code-header">` +
        `<span class="nex-code-lang">${escapeHtml(lang)}</span>` +
        `</div>` +
        `<pre><code>${escaped}</code></pre>` +
        `</div>`
      );
    } else {
      parts.push(`<div class="nex-text-block">${renderInlineMarkdown(block.content)}</div>`);
    }
  }
  const raw = parts.join('');
  // Final defense-in-depth: strip any unexpected tags/attrs
  return sanitizeHtml(raw);
}
