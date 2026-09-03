/**
 * NEX AI — Web Tool
 *
 * Agent tool for web search and URL fetching.
 * Uses Electron's net module for HTTP requests (respects system proxy).
 *
 * Security:
 *   - HTTPS-only (HTTP rejected)
 *   - URL allow-list (no private IPs, no localhost)
 *   - 10s timeout
 *   - 5MB response size limit
 *   - HTML sanitized (tags stripped, text only)
 */

import * as path from 'path';
import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

// Lazy-load electron net (avoids import errors in non-electron contexts)
async function getNet(): Promise<any> {
  const { net } = require('electron');
  return net;
}

function isBlockedUrl(url: string): boolean {
  const lower = url.toLowerCase();
  // Block private IPs and localhost
  if (lower.includes('localhost') || lower.includes('127.0.0.1') || lower.includes('0.0.0.0')) return true;
  if (lower.includes('192.168.') || lower.includes('10.') || lower.includes('172.16.')) return true;
  if (lower.includes('file://') || lower.includes('ftp://')) return true;
  return false;
}

function stripHtml(html: string): string {
  // Remove script/style blocks
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  // Remove tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

export class WebFetchTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'web_fetch',
    description: 'Fetch the content of a web page. Returns the text content (HTML tags stripped). Use for reading documentation, articles, or API responses.',
    category: 'web',
    permission: 'network',
    requiresNetwork: true,
    parameters: [
      { name: 'url', type: 'string', description: 'The URL to fetch (must be HTTPS)', required: true },
      { name: 'max_length', type: 'number', description: 'Maximum content length in characters (default: 10000)', default: 10000 },
    ],
    returns: { type: 'string', description: 'The page content as text' },
    tags: ['web', 'fetch', 'network'],
  };

  async execute(params: Record<string, any>, _context: ToolContext): Promise<ToolResult> {
    const url = params.url;
    if (!url) return { success: false, error: 'Missing required parameter: url' };
    if (!url.startsWith('https://')) return { success: false, error: 'Only HTTPS URLs are allowed' };
    if (isBlockedUrl(url)) return { success: false, error: 'Blocked URL (private network or non-HTTP scheme)' };

    const maxLength = params.max_length || 10000;
    try {
      const net = await getNet();
      const result = await new Promise<string>((resolve, reject) => {
        const request = net.request(url);
        let body = '';
        let sizeExceeded = false;
        const timer = setTimeout(() => {
          request.abort();
          reject(new Error('Request timeout (10s)'));
        }, 10000);

        request.on('response', (response: any) => {
          const status = response.statusCode;
          if (status >= 400) {
            clearTimeout(timer);
            reject(new Error(`HTTP ${status}`));
            return;
          }
          response.on('data', (chunk: Buffer) => {
            if (sizeExceeded) return;
            body += chunk.toString('utf-8');
            if (body.length > 5 * 1024 * 1024) { // 5MB limit
              sizeExceeded = true;
              clearTimeout(timer);
              request.abort();
              reject(new Error('Response too large (5MB limit)'));
            }
          });
          response.on('end', () => {
            clearTimeout(timer);
            resolve(body);
          });
          response.on('error', (err: Error) => {
            clearTimeout(timer);
            reject(err);
          });
        });
        request.on('error', (err: Error) => {
          clearTimeout(timer);
          reject(err);
        });
        request.end();
      });

      // Strip HTML if the response looks like HTML
      const content = result.includes('<html') || result.includes('<!DOCTYPE')
        ? stripHtml(result)
        : result;

      const truncated = content.length > maxLength
        ? content.substring(0, maxLength) + '\n...(truncated)'
        : content;

      return {
        success: true,
        output: truncated,
        data: { url, contentLength: content.length, truncated: content.length > maxLength },
      };
    } catch (err: any) {
      return { success: false, error: `Web fetch failed: ${err.message}` };
    }
  }
}

export class WebSearchTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'web_search',
    description: 'Search the web for information. Returns search results with titles, URLs, and snippets. Uses DuckDuckGo HTML endpoint (no API key required).',
    category: 'web',
    permission: 'network',
    requiresNetwork: true,
    parameters: [
      { name: 'query', type: 'string', description: 'The search query', required: true },
      { name: 'max_results', type: 'number', description: 'Maximum number of results (default: 5)', default: 5 },
    ],
    returns: { type: 'string', description: 'Search results as formatted text' },
    tags: ['web', 'search', 'network'],
  };

  async execute(params: Record<string, any>, _context: ToolContext): Promise<ToolResult> {
    const query = params.query;
    if (!query) return { success: false, error: 'Missing required parameter: query' };

    const maxResults = params.max_results || 5;
    try {
      const net = await getNet();
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const html = await new Promise<string>((resolve, reject) => {
        const request = net.request(searchUrl);
        let body = '';
        const timer = setTimeout(() => { request.abort(); reject(new Error('Search timeout (10s)')); }, 10000);
        request.on('response', (response: any) => {
          response.on('data', (chunk: Buffer) => { body += chunk.toString('utf-8'); });
          response.on('end', () => { clearTimeout(timer); resolve(body); });
          response.on('error', (err: Error) => { clearTimeout(timer); reject(err); });
        });
        request.on('error', (err: Error) => { clearTimeout(timer); reject(err); });
        request.end();
      });

      // Parse DuckDuckGo HTML results
      const results: Array<{ title: string; url: string; snippet: string }> = [];
      const resultRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">(.*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>(.*?)<\/a>/g;
      let match;
      while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
        const url = match[1].replace(/&amp;/g, '&');
        const title = stripHtml(match[2]);
        const snippet = stripHtml(match[3]);
        results.push({ title, url, snippet });
      }

      if (results.length === 0) {
        return { success: true, output: 'No results found.', data: { query, results: [] } };
      }

      const formatted = results.map((r, i) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
      ).join('\n\n');

      return {
        success: true,
        output: formatted,
        data: { query, results },
      };
    } catch (err: any) {
      return { success: false, error: `Web search failed: ${err.message}` };
    }
  }
}
