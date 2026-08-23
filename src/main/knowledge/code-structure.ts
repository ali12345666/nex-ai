/**
 * NEX AI — Code Structure Extractor (Phase 11 / P11-A)
 *
 * Best-effort, regex-based structural metadata extraction for source code:
 *   - language detection from filename
 *   - imports / requires / includes / use / package statements
 *   - symbols: functions, classes, methods, interfaces, types, structs,
 *     enums, traits — each with 1-based startLine (+ endLine where the
 *     brace/indent tracker can close it)
 *   - exports list (JS/TS family)
 *
 * PURE module: string operations only — no fs, no electron, no network.
 * Never throws: unknown languages return empty structures.
 *
 * Consumers: the ingester attaches this metadata to document + chunk
 * records (chunks already carry startLine/endLine from the Phase-9 chunker,
 * making citations like "calculator.ts → function add → lines 10-18").
 */

export type CodeLanguage =
  | 'typescript' | 'javascript' | 'python' | 'java' | 'c' | 'cpp' | 'csharp'
  | 'rust' | 'go' | 'shell' | 'powershell' | 'php' | 'ruby' | 'sql' | 'css'
  | 'html' | 'json' | 'yaml' | 'xml' | 'markdown' | 'plaintext';

const EXT_TO_LANG: Record<string, CodeLanguage> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp',
  '.cs': 'csharp',
  '.rs': 'rust',
  '.go': 'go',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.ps1': 'powershell', '.psm1': 'powershell',
  '.php': 'php',
  '.rb': 'ruby',
  '.sql': 'sql',
  '.css': 'css', '.scss': 'css', '.less': 'css',
  '.html': 'html', '.htm': 'html',
  '.json': 'json',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.xml': 'xml',
  '.md': 'markdown', '.markdown': 'markdown', '.mdx': 'markdown',
  '.txt': 'plaintext', '.log': 'plaintext', '.ini': 'plaintext', '.cfg': 'plaintext',
};

/** Detect language from a filename (null when unknown). */
export function detectLanguage(filename: string): CodeLanguage | null {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return null;
  return EXT_TO_LANG[filename.slice(dot).toLowerCase()] || null;
}

// ─── Symbol model ───────────────────────────────────────────────────────────

export type SymbolKind =
  | 'function' | 'class' | 'method' | 'interface' | 'type'
  | 'struct' | 'enum' | 'trait' | 'const';

export interface CodeSymbol {
  kind: SymbolKind;
  name: string;
  startLine: number;       // 1-based
  endLine?: number;        // 1-based, when closable
}

export interface CodeStructure {
  language: CodeLanguage;
  imports: string[];
  symbols: CodeSymbol[];
  exports: string[];
}

export function extractCodeStructure(code: string, language: CodeLanguage): CodeStructure {
  const lines = code.split('\n');
  switch (language) {
    case 'typescript':
    case 'javascript':
      return extractJsFamily(lines, language);
    case 'python':
      return extractPython(lines);
    case 'java':
      return extractJava(lines);
    case 'c':
    case 'cpp':
    case 'csharp':
      return extractCFamily(lines, language);
    case 'rust':
      return extractRust(lines);
    case 'go':
      return extractGo(lines);
    case 'shell':
      return extractShell(lines);
    case 'powershell':
      return extractPowerShell(lines);
    case 'php':
      return extractPhp(lines);
    case 'ruby':
      return extractRuby(lines);
    default:
      // data/markup formats: structural symbols are not meaningful
      return { language, imports: [], symbols: [], exports: [] };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Close a brace-block opened on `startIdx` (0-based); returns 1-based end line. */
function closeBrace(lines: string[], startIdx: number): number | undefined {
  let depth = 0;
  let seen = false;
  for (let i = startIdx; i < lines.length && i <= startIdx + 5000; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; seen = true; }
      else if (ch === '}') depth--;
    }
    if (seen && depth <= 0) return i + 1;
    if (!seen && i > startIdx + 5) return startIdx + 1; // signature-only decl
  }
  return undefined;
}

function stripComment(line: string): string {
  // crude: line comments only (good enough for symbol scanning)
  const idx = line.indexOf('//');
  return idx >= 0 ? line.slice(0, idx) : line;
}

// ─── JS / TS ────────────────────────────────────────────────────────────────

const JS_CONTROL = /^(if|for|while|switch|catch|else|do|try)\b/;

function extractJsFamily(lines: string[], language: CodeLanguage): CodeStructure {
  const imports: string[] = [];
  const symbols: CodeSymbol[] = [];
  const exports: string[] = [];

  lines.forEach((raw, i) => {
    const line = stripComment(raw).trim();
    if (!line) return;

    // imports
    let m = /(?:^|\s)import\s+[^;'"]*['"]([^'"]+)['"]/.exec(line)
         || /require\(\s*['"]([^'"]+)['"]\s*\)/.exec(line);
    if (m) imports.push(m[1]);

    // export names
    const ex = /^export\s+(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(function\*?\s+\w+|class\s+\w+|const\s+\w+|let\s+\w+|var\s+\w+|interface\s+\w+|type\s+\w+|enum\s+\w+)/.exec(line);
    if (ex) {
      const name = ex[1].split(/\s+/)[1];
      if (name) exports.push(name);
    }

    // class
    if (/(?:^|\s)(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/.test(line) && !line.startsWith('extends')) {
      const cm = /class\s+([A-Za-z_$][\w$]*)/.exec(line);
      if (cm && !symbols.some((s) => s.name === cm[1] && s.kind === 'class')) {
        symbols.push({ kind: 'class', name: cm[1], startLine: i + 1, endLine: closeBrace(lines, i) });
      }
    }
    // interface / type
    const it = /^(?:export\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (it) {
      symbols.push({ kind: it[0].startsWith('interface') || /interface/.test(it[0]) ? 'interface' : 'type', name: it[1], startLine: i + 1, endLine: closeBrace(lines, i) });
    }
    // enum
    const en = /^(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (en) symbols.push({ kind: 'enum', name: en[1], startLine: i + 1, endLine: closeBrace(lines, i) });
    // function declaration
    const fn = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(line);
    if (fn) {
      symbols.push({ kind: 'function', name: fn[1], startLine: i + 1, endLine: closeBrace(lines, i) });
      return;
    }
    // arrow / const function
    const ar = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]*)?=>|[A-Za-z_$][\w$]*\s*=>)/.exec(line);
    if (ar) {
      symbols.push({ kind: 'function', name: ar[1], startLine: i + 1, endLine: closeBrace(lines, i) });
      return;
    }
    // plain exported const (non-function)
    const pc = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/.exec(line);
    if (pc && !ar) {
      symbols.push({ kind: 'const', name: pc[1], startLine: i + 1 });
    }
    // class methods (inside a class — heuristic: identifier(…) { at line start,
    // not a control/statement keyword; runs on the trimmed line)
    const mm = /^(?:public|private|protected|static|readonly|async|override|abstract|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]*)?\{/.exec(line);
    const NON_METHODS = ['function', 'return', 'new', 'delete', 'throw', 'typeof', 'await'];
    if (mm && !JS_CONTROL.test(line) && !NON_METHODS.includes(mm[1])) {
      symbols.push({ kind: 'method', name: mm[1], startLine: i + 1, endLine: closeBrace(lines, i) });
    }
  });

  return { language, imports: dedupe(imports), symbols, exports: dedupe(exports) };
}

// ─── Python ─────────────────────────────────────────────────────────────────

function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

function closeIndent(lines: string[], startIdx: number): number | undefined {
  const base = indentOf(lines[startIdx]);
  for (let i = startIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '' || l.trimStart().startsWith('#')) continue;
    if (indentOf(l) <= base) return i; // line BEFORE this one is last of block
  }
  return lines.length;
}

function extractPython(lines: string[]): CodeStructure {
  const imports: string[] = [];
  const symbols: CodeSymbol[] = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    let m = /^(?:import|from)\s+([\w.]+)/.exec(line);
    if (m) imports.push(m[1]);
    const fn = /^(?:async\s+)?def\s+(\w+)/.exec(line);
    if (fn) symbols.push({ kind: 'function', name: fn[1], startLine: i + 1, endLine: closeIndent(lines, i) });
    const cl = /^class\s+(\w+)/.exec(line);
    if (cl) symbols.push({ kind: 'class', name: cl[1], startLine: i + 1, endLine: closeIndent(lines, i) });
  });
  return { language: 'python', imports: dedupe(imports), symbols, exports: [] };
}

// ─── Java ───────────────────────────────────────────────────────────────────

function extractJava(lines: string[]): CodeStructure {
  const imports: string[] = [];
  const symbols: CodeSymbol[] = [];
  lines.forEach((raw, i) => {
    const line = stripComment(raw).trim();
    const im = /^import\s+(?:static\s+)?([\w.*]+);/.exec(line);
    if (im) imports.push(im[1]);
    const cl = /(?:public|private|protected|abstract|final|static|\s)*\b(?:class|interface|enum|record)\s+(\w+)/.exec(line);
    if (cl && /\b(class|interface|enum|record)\b/.test(line)) {
      const kind = /interface/.test(line) ? 'interface' : /enum/.test(line) ? 'enum' : 'class';
      symbols.push({ kind, name: cl[1], startLine: i + 1, endLine: closeBrace(lines, i) });
      return;
    }
    // methods: modifier-ish + return type + name( ... ) {
    const me = /^(?:public|private|protected|static|final|abstract|synchronized|native|\s)*[\w<>\[\],\s]+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\{/.exec(line);
    if (me && !['if', 'for', 'while', 'switch', 'catch', 'new'].includes(me[1])) {
      symbols.push({ kind: 'method', name: me[1], startLine: i + 1, endLine: closeBrace(lines, i) });
    }
  });
  return { language: 'java', imports: dedupe(imports), symbols, exports: [] };
}

// ─── C / C++ / C# ───────────────────────────────────────────────────────────

const C_CONTROL = /^(if|for|while|switch|catch|else|return|do)\b/;

function extractCFamily(lines: string[], language: CodeLanguage): CodeStructure {
  const imports: string[] = [];
  const symbols: CodeSymbol[] = [];
  const sharpUsing = language === 'csharp';
  lines.forEach((raw, i) => {
    const line = stripComment(raw).trim();
    const inc = /^#include\s+[<"]([^>"]+)[>"]/.exec(line);
    if (inc) { imports.push(inc[1]); return; }
    const us = /^using\s+([\w.]+)\s*;/.exec(line);
    if (sharpUsing && us) { imports.push(us[1]); return; }
    const st = /\b(?:struct|class|enum|interface|namespace)\s+(\w+)/.exec(line);
    if (st) {
      const kind = /struct/.test(line) ? 'struct' : /enum/.test(line) ? 'enum' : /interface/.test(line) ? 'interface' : 'class';
      symbols.push({ kind, name: st[1], startLine: i + 1, endLine: closeBrace(lines, i) });
      return;
    }
    // top-level-looking function: has '(' and ends with '{' on same line
    const fn = /^[\w:<>\*&\[\],\s~]+\s+(\w+)\s*\([^;{]*\)\s*(?:const\s*)?(?:->\s*\w+\s*)?\{\s*$/.exec(line);
    if (fn && !C_CONTROL.test(line)) {
      symbols.push({ kind: 'function', name: fn[1], startLine: i + 1, endLine: closeBrace(lines, i) });
    }
  });
  return { language, imports: dedupe(imports), symbols, exports: [] };
}

// ─── Rust ───────────────────────────────────────────────────────────────────

function extractRust(lines: string[]): CodeStructure {
  const imports: string[] = [];
  const symbols: CodeSymbol[] = [];
  lines.forEach((raw, i) => {
    const line = stripComment(raw).trim();
    const us = /^use\s+([\w:]+)/.exec(line);
    if (us) { imports.push(us[1]); return; }
    const fn = /^(?:pub\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+(\w+)/.exec(line);
    if (fn) { symbols.push({ kind: 'function', name: fn[1], startLine: i + 1, endLine: closeBrace(lines, i) }); return; }
    const st = /^(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/.exec(line);
    if (st) {
      const kind = /struct/.test(line) ? 'struct' : /enum/.test(line) ? 'enum' : 'trait';
      symbols.push({ kind, name: st[1], startLine: i + 1, endLine: closeBrace(lines, i) });
      return;
    }
    const im = /^(?:pub\s+)?impl(?:<[^>]*>)?\s+([\w:]+)/.exec(line);
    if (im) symbols.push({ kind: 'trait', name: `impl ${im[1]}`, startLine: i + 1, endLine: closeBrace(lines, i) });
  });
  return { language: 'rust', imports: dedupe(imports), symbols, exports: [] };
}

// ─── Go ─────────────────────────────────────────────────────────────────────

function extractGo(lines: string[]): CodeStructure {
  const imports: string[] = [];
  const symbols: CodeSymbol[] = [];
  let inImportBlock = false;
  lines.forEach((raw, i) => {
    const line = stripComment(raw).trim();
    if (line === 'import (') { inImportBlock = true; return; }
    if (inImportBlock) {
      if (line === ')') inImportBlock = false;
      else { const m = /^"?([\w./-]+)"?/.exec(line); if (m && m[1] !== '_') imports.push(m[1]); }
      return;
    }
    const im = /^import\s+"([^"]+)"/.exec(line);
    if (im) { imports.push(im[1]); return; }
    const fn = /^func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/.exec(line);
    if (fn) { symbols.push({ kind: 'function', name: fn[1], startLine: i + 1, endLine: closeBrace(lines, i) }); return; }
    const ty = /^type\s+(\w+)\s+(struct|interface)\b/.exec(line);
    if (ty) symbols.push({ kind: ty[2] === 'struct' ? 'struct' : 'interface', name: ty[1], startLine: i + 1, endLine: closeBrace(lines, i) });
  });
  return { language: 'go', imports: dedupe(imports), symbols, exports: [] };
}

// ─── Shell / PowerShell ─────────────────────────────────────────────────────

function extractShell(lines: string[]): CodeStructure {
  const symbols: CodeSymbol[] = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    let m = /^function\s+(\w+)/.exec(line);
    if (m) { symbols.push({ kind: 'function', name: m[1], startLine: i + 1 }); return; }
    m = /^(\w+)\s*\(\s*\)\s*\{/.exec(line);
    if (m) symbols.push({ kind: 'function', name: m[1], startLine: i + 1 });
  });
  return { language: 'shell', imports: [], symbols, exports: [] };
}

function extractPowerShell(lines: string[]): CodeStructure {
  const symbols: CodeSymbol[] = [];
  lines.forEach((raw, i) => {
    const m = /^function\s+([\w-]+)/.exec(raw.trim());
    if (m) symbols.push({ kind: 'function', name: m[1], startLine: i + 1, endLine: closeBrace(lines, i) });
  });
  return { language: 'powershell', imports: [], symbols, exports: [] };
}

// ─── PHP / Ruby ─────────────────────────────────────────────────────────────

function extractPhp(lines: string[]): CodeStructure {
  const imports: string[] = [];
  const symbols: CodeSymbol[] = [];
  lines.forEach((raw, i) => {
    const line = stripComment(raw).trim();
    const us = /^(?:use|require|require_once|include|include_once)\s+([\w\\]+)/.exec(line);
    if (us) { imports.push(us[1]); return; }
    const fn = /^function\s+(\w+)\s*\(/.exec(line);
    if (fn) { symbols.push({ kind: 'function', name: fn[1], startLine: i + 1, endLine: closeBrace(lines, i) }); return; }
    const cl = /^(?:abstract\s+|final\s+)?class\s+(\w+)/.exec(line);
    if (cl) symbols.push({ kind: 'class', name: cl[1], startLine: i + 1, endLine: closeBrace(lines, i) });
  });
  return { language: 'php', imports: dedupe(imports), symbols, exports: [] };
}

function extractRuby(lines: string[]): CodeStructure {
  const imports: string[] = [];
  const symbols: CodeSymbol[] = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const rq = /^require(?:_relative)?\s+['"]([^'"]+)['"]/.exec(line);
    if (rq) { imports.push(rq[1]); return; }
    const fn = /^def\s+(\w+[?!=]?)/.exec(line);
    if (fn) { symbols.push({ kind: 'function', name: fn[1], startLine: i + 1, endLine: closeIndent(lines, i) }); return; }
    const cl = /^(?:class|module)\s+(\w+)/.exec(line);
    if (cl) symbols.push({ kind: 'class', name: cl[1], startLine: i + 1, endLine: closeIndent(lines, i) });
  });
  return { language: 'ruby', imports: dedupe(imports), symbols, exports: [] };
}

// ─── Chunk attachment ───────────────────────────────────────────────────────

export interface ChunkLike {
  content: string;
  metadata?: Record<string, any>;
}

/**
 * Attach overlapping symbols to each chunk's metadata:
 *   chunk.metadata.symbols = ['function add', 'class Calc', ...]
 *   chunk.metadata.language = language
 * A symbol overlaps when its [startLine, endLine||startLine] intersects the
 * chunk's [startLine, endLine] range (chunk line ranges come from the
 * Phase-9 chunker).
 */
export function attachSymbolsToChunks<T extends ChunkLike>(
  chunks: T[],
  structure: CodeStructure
): T[] {
  for (const chunk of chunks) {
    const meta = chunk.metadata || (chunk.metadata = {});
    meta.language = structure.language;
    const cs = meta.startLine as number | undefined;
    const ce = (meta.endLine as number | undefined) ?? cs;
    if (typeof cs !== 'number' || typeof ce !== 'number') continue;
    const overlapping = structure.symbols.filter((s) => {
      const se = s.endLine ?? s.startLine;
      return s.startLine <= ce && se >= cs;
    });
    meta.symbols = overlapping.map((s) => `${s.kind} ${s.name}`);
  }
  return chunks;
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
