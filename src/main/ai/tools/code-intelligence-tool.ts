/**
 * NEX AI — Code Intelligence Tool
 *
 * Agent tool for code analysis and symbol search.
 * Wraps the existing code-structure.ts AST-lite extractor to provide
 * IDE-like capabilities: find symbols, find references, analyze project.
 *
 * Tools:
 *   - find_symbol: find all definitions of a function/class/method
 *   - find_references: search for usages of a symbol across files
 *   - analyze_project: get project structure + dependencies + stats
 */

import * as path from 'path';
import * as fs from 'fs';
import { assertPathInside } from '../../security';
import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

export class FindSymbolTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'find_symbol',
    description: 'Find all definitions of a function, class, method, or type in the project. Returns file paths, line numbers, and symbol types.',
    category: 'filesystem',
    permission: 'read',
    parameters: [
      { name: 'symbol', type: 'string', description: 'The symbol name to search for (e.g. "createTask", "MyClass")', required: true },
      { name: 'file_pattern', type: 'string', description: 'Optional file pattern to limit search (e.g. "*.ts", "src/*.js")' },
    ],
    returns: { type: 'string', description: 'List of symbol definitions found' },
    tags: ['code', 'symbol', 'search', 'ide'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const symbol = params.symbol;
    if (!symbol) return { success: false, error: 'Missing required parameter: symbol' };

    const root = context.projectPath || process.cwd();
    const results: Array<{ file: string; line: number; type: string; name: string }> = [];

    try {
      // Walk the project directory and search for symbol definitions
      const { extractSymbols } = require('../../knowledge/code-structure');
      const pattern = params.file_pattern || '*';

      const walkDir = (dir: string, depth = 0) => {
        if (depth > 6 || results.length > 50) return; // depth + result limits
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (!['.ts', '.js', '.tsx', '.jsx', '.py', '.java', '.c', '.cpp', '.go', '.rs'].includes(ext)) continue;
            try {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const symbols = extractSymbols(content, ext.substring(1));
              for (const sym of symbols) {
                if (sym.name === symbol || sym.name.includes(symbol)) {
                  results.push({ file: path.relative(root, fullPath), line: sym.line, type: sym.type, name: sym.name });
                }
              }
            } catch { /* skip unreadable files */ }
          }
        }
      };

      walkDir(root);

      if (results.length === 0) {
        return { success: true, output: `No definitions found for "${symbol}"`, data: { symbol, results: [] } };
      }

      const formatted = results.map((r, i) =>
        `${i + 1}. ${r.name} (${r.type}) — ${r.file}:${r.line}`
      ).join('\n');

      return {
        success: true,
        output: `Found ${results.length} definition(s) for "${symbol}":\n${formatted}`,
        data: { symbol, results },
      };
    } catch (err: any) {
      // Fallback: simple regex search if code-structure is unavailable
      try {
        const regex = new RegExp(`\\b(def|function|class|const|let|var|type|interface|struct|fn|func)\\s+${symbol}\\b`, 'gi');
        const walkDir = (dir: string, depth = 0) => {
          if (depth > 4) return;
          let entries: fs.Dirent[];
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) { walkDir(fullPath, depth + 1); continue; }
            const ext = path.extname(entry.name).toLowerCase();
            if (!['.ts', '.js', '.py', '.java', '.go'].includes(ext)) continue;
            try {
              const lines = fs.readFileSync(fullPath, 'utf-8').split('\n');
              lines.forEach((line, i) => {
                if (regex.test(line)) {
                  results.push({ file: path.relative(root, fullPath), line: i + 1, type: 'definition', name: symbol });
                }
              });
            } catch { /* */ }
          }
        };
        walkDir(root);
        if (results.length === 0) return { success: true, output: `No definitions found for "${symbol}"` };
        const formatted = results.map((r, i) => `${i + 1}. ${r.name} — ${r.file}:${r.line}`).join('\n');
        return { success: true, output: `Found ${results.length}:\n${formatted}`, data: { symbol, results } };
      } catch {
        return { success: false, error: `Symbol search failed: ${err.message}` };
      }
    }
  }
}

export class FindReferencesTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'find_references',
    description: 'Search for usages of a symbol (variable, function, class name) across the project. Returns all lines where the symbol appears.',
    category: 'filesystem',
    permission: 'read',
    parameters: [
      { name: 'symbol', type: 'string', description: 'The symbol name to search for', required: true },
      { name: 'max_results', type: 'number', description: 'Max results (default: 20)', default: 20 },
    ],
    returns: { type: 'string', description: 'List of references found' },
    tags: ['code', 'reference', 'search', 'ide'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const symbol = params.symbol;
    if (!symbol) return { success: false, error: 'Missing required parameter: symbol' };

    const maxResults = params.max_results || 20;
    const root = context.projectPath || process.cwd();
    const results: Array<{ file: string; line: number; text: string }> = [];

    const walkDir = (dir: string, depth = 0) => {
      if (depth > 6 || results.length >= maxResults) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) { walkDir(fullPath, depth + 1); continue; }
        const ext = path.extname(entry.name).toLowerCase();
        if (!['.ts', '.js', '.tsx', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp'].includes(ext)) continue;
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (content.length > 500000) continue; // skip large files
          const lines = content.split('\n');
          const regex = new RegExp(`\\b${symbol}\\b`, 'g');
          lines.forEach((line, i) => {
            if (results.length >= maxResults) return;
            if (regex.test(line)) {
              results.push({ file: path.relative(root, fullPath), line: i + 1, text: line.trim().substring(0, 120) });
            }
          });
        } catch { /* */ }
      }
    };

    walkDir(root);

    if (results.length === 0) {
      return { success: true, output: `No references found for "${symbol}"`, data: { symbol, results: [] } };
    }

    const formatted = results.map((r, i) =>
      `${i + 1}. ${r.file}:${r.line} — ${r.text}`
    ).join('\n');

    return {
      success: true,
      output: `Found ${results.length} reference(s) for "${symbol}":\n${formatted}`,
      data: { symbol, results },
    };
  }
}
