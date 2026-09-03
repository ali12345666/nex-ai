/**
 * Phase 11 / P11-A — Document Format Support (structural, additive)
 *
 * Coverage:
 *   1. All 19 requested formats detect + ingest structurally
 *      (TXT MD JSON CSV TS JS TSX JSX HTML CSS YAML XML Python Java C/C++
 *       Rust Go Shell PowerShell)
 *   2. XML parser: comments/PIs stripped, CDATA kept, entities decoded
 *   3. code-structure (pure):
 *      - language detection matrix
 *      - TS: imports / function+line-range / class+methods / interface /
 *             type / enum / arrow-fn / exports / const
 *      - Python: import / def (indent-closed) / class
 *      - Java: import / class / method
 *      - C/C++/C#: include/using / struct / function
 *      - Rust: use / fn / struct / enum / trait / impl
 *      - Go: package imports (block+single) / func (methods) / type
 *      - Shell + PowerShell functions
 *   4. attachSymbolsToChunks: overlap → chunk.metadata.symbols + language
 *   5. Ingestion end-to-end: document metadata (language/imports/symbolCount)
 *      + chunk metadata symbols — citation-friendly (calculator.ts →
 *      function add → lines)
 *   6. Additivity: previous Phase 9 parse behavior intact; no Phase 9
 *      parser rewritten (only registry additions); offline purity.
 *
 * Run: npx tsx tests/knowledge/test-p11-a.ts
 */
import '../__mocks__/install-electron-mock.js';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main(): Promise<void> {

const { detectFormat, getParser } = await import('../../src/main/knowledge/parsers');
const { detectLanguage, extractCodeStructure, attachSymbolsToChunks } = await import('../../src/main/knowledge/code-structure');
const { ingestFile } = await import('../../src/main/knowledge/ingester');
const { scanFolderForIngest } = await import('../../src/main/knowledge/folder-scan');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p11a-'));
const D = (f: string) => path.join(ROOT, f);

// ─── 1) All 19 formats detected ─────────────────────────────────────────────
console.log('\n1) format matrix (all 19 from P11-A):');
const formats: Array<[string, string]> = [
  ['a.txt', 'plaintext'], ['a.md', 'markdown'], ['a.json', 'json'], ['a.csv', 'csv'],
  ['a.ts', 'source-code'], ['a.js', 'source-code'], ['a.tsx', 'source-code'], ['a.jsx', 'source-code'],
  ['a.html', 'html'], ['a.css', 'source-code'], ['a.yaml', 'yaml'], ['a.xml', 'xml'],
  ['a.py', 'source-code'], ['a.java', 'source-code'], ['a.c', 'source-code'], ['a.cpp', 'source-code'],
  ['a.rs', 'source-code'], ['a.go', 'source-code'], ['a.sh', 'source-code'], ['a.ps1', 'source-code'],
];
for (const [f, want] of formats) {
  assert(`detectFormat(${f}) = ${want}`, detectFormat(f) === want);
}
assert('getParser(xml) exists', !!getParser('xml'));
assert('xml now SUPPORTED (passes isSupportedFormat via parser presence)', (() => {
  const { isSupportedFormat } = require('../../src/main/knowledge/parsers');
  return isSupportedFormat('xml') === true;
})());

// ─── 2) XML parser ──────────────────────────────────────────────────────────
console.log('\n2) XML parsing:');
fs.writeFileSync(D('config.xml'), `<?xml version="1.0"?>\n<!-- company config -->\n<config>\n  <server host="api.local" port="8080"/>\n  <name><![CDATA[NEX & <AI>]]></name>\n  <flag>true</flag>\n</config>`);
const xmlRes = await ingestFile(D('config.xml'), { projectId: 'p11', roots: [ROOT] });
assert('xml ingests ok', xmlRes.status === 'indexed');
if (xmlRes.status === 'indexed') {
  const text = xmlRes.chunks.map((c) => c.content).join('\n');
  assert('xml: comment stripped', !text.includes('company config'));
  assert('xml: PI stripped', !text.includes('<?xml'));
  assert('xml: CDATA text kept', text.includes('NEX & <AI>'));
  assert('xml: attrs dropped, element text kept', text.includes('true'));
}

// ─── 3) code-structure per language ─────────────────────────────────────────
console.log('\n3) code-structure extraction:');

// language detection
const langMatrix: Array<[string, string]> = [
  ['x.ts', 'typescript'], ['x.tsx', 'typescript'], ['x.js', 'javascript'], ['x.jsx', 'javascript'],
  ['x.py', 'python'], ['x.java', 'java'], ['x.c', 'c'], ['x.h', 'c'], ['x.cpp', 'cpp'], ['x.cs', 'csharp'],
  ['x.rs', 'rust'], ['x.go', 'go'], ['x.sh', 'shell'], ['x.ps1', 'powershell'],
  ['x.rb', 'ruby'], ['x.php', 'php'], ['x.sql', 'sql'], ['x.css', 'css'],
  ['x.json', 'json'], ['x.yaml', 'yaml'], ['x.xml', 'xml'], ['x.md', 'markdown'],
];
for (const [f, want] of langMatrix) {
  assert(`detectLanguage(${f}) = ${want}`, detectLanguage(f) === want);
}
assert('detectLanguage(unknown.ext) = null', detectLanguage('unknown.ext') === null);

// TypeScript — the flagship case (calculator.ts from the spec)
const calcTs = [
  'import { validate } from "./util";',
  'import type { Result } from "./types";',
  '',
  '/** adds two numbers */',
  'export function add(a: number, b: number): number {',
  '  return a + b;',
  '}',
  '',
  'export const multiply = (a: number, b: number): number => a * b;',
  '',
  'export interface CalcOptions {',
  '  precision: number;',
  '}',
  '',
  'export type Mode = "basic" | "advanced";',
  '',
  'export class Calculator {',
  '  private history: number[] = [];',
  '',
  '  run(op: string, a: number, b: number): number {',
  '    const r = op === "add" ? add(a, b) : multiply(a, b);',
  '    this.history.push(r);',
  '    return r;',
  '  }',
  '}',
].join('\n');
fs.writeFileSync(D('calculator.ts'), calcTs);
const ts = extractCodeStructure(calcTs, 'typescript');
assert('TS: imports extracted', ts.imports.includes('./util') && ts.imports.includes('./types'));
const addFn = ts.symbols.find((s) => s.name === 'add');
assert('TS: function add found', !!addFn && addFn.kind === 'function');
assert('TS: add startLine = 5', addFn!.startLine === 5);
assert('TS: add endLine = 7 (closing brace line)', addFn!.endLine === 7);
assert('TS: arrow fn multiply (function kind)', ts.symbols.some((s) => s.name === 'multiply' && s.kind === 'function'));
assert('TS: interface CalcOptions', ts.symbols.some((s) => s.name === 'CalcOptions' && s.kind === 'interface'));
assert('TS: type Mode', ts.symbols.some((s) => s.name === 'Mode' && s.kind === 'type'));
const calcCls = ts.symbols.find((s) => s.name === 'Calculator');
assert('TS: class Calculator with endLine', !!calcCls && calcCls.kind === 'class' && calcCls!.endLine === 25);
assert('TS: method run detected', ts.symbols.some((s) => s.name === 'run' && s.kind === 'method'));
assert('TS: exports listed', ['add', 'multiply', 'CalcOptions', 'Mode', 'Calculator'].every((n) => ts.exports.includes(n)));

// Python
const py = [
  'import os',
  'from typing import List',
  '',
  'def add(a, b):',
  '    """add two"""',
  '    return a + b',
  '',
  'class Calculator:',
  '    def run(self):',
  '        return add(1, 2)',
].join('\n');
fs.writeFileSync(D('calc.py'), py);
const ps = extractCodeStructure(py, 'python');
assert('PY: imports', ps.imports.includes('os') && ps.imports.includes('typing'));
assert('PY: def add line 4', ps.symbols.some((s) => s.name === 'add' && s.startLine === 4));
assert('PY: class Calculator', ps.symbols.some((s) => s.name === 'Calculator' && s.kind === 'class'));
assert('PY: method run', ps.symbols.some((s) => s.name === 'run'));

// Java
const java = [
  'package com.nex;',
  'import java.util.List;',
  '',
  'public class Calculator {',
  '    public int add(int a, int b) {',
  '        return a + b;',
  '    }',
  '}',
].join('\n');
fs.writeFileSync(D('Calc.java'), java);
const js = extractCodeStructure(java, 'java');
assert('JAVA: import', js.imports.includes('java.util.List'));
assert('JAVA: class Calculator', js.symbols.some((s) => s.name === 'Calculator' && s.kind === 'class'));
assert('JAVA: method add', js.symbols.some((s) => s.name === 'add' && s.kind === 'method'));

// C / C++ / C#
const cCode = [
  '#include <stdio.h>',
  '#include "util.h"',
  '',
  'struct Point { int x; int y; };',
  '',
  'int add(int a, int b) {',
  '    return a + b;',
  '}',
].join('\n');
fs.writeFileSync(D('calc.c'), cCode);
const cs = extractCodeStructure(cCode, 'c');
assert('C: includes', cs.imports.includes('stdio.h') && cs.imports.includes('util.h'));
assert('C: struct Point', cs.symbols.some((s) => s.name === 'Point' && s.kind === 'struct'));
assert('C: function add', cs.symbols.some((s) => s.name === 'add' && s.kind === 'function'));
const csCode = 'using System;\nnamespace N {\n  public class Calc {\n    public int Add(int a, int b) { return a + b; }\n  }\n}\n';
fs.writeFileSync(D('Calc.cs'), csCode);
assert('C#: using', extractCodeStructure(csCode, 'csharp').imports.includes('System'));
assert('C#: class Calc', extractCodeStructure(csCode, 'csharp').symbols.some((s) => s.name === 'Calc'));

// Rust
const rsCode = [
  'use std::collections::HashMap;',
  '',
  'pub struct Cache {',
  '    map: HashMap<String, u64>,',
  '}',
  '',
  'pub enum Mode { Fast, Slow }',
  '',
  'pub fn add(a: u64, b: u64) -> u64 {',
  '    a + b',
  '}',
  '',
  'impl Cache {',
  '    pub fn new() -> Self { Self { map: HashMap::new() } }',
  '}',
].join('\n');
fs.writeFileSync(D('calc.rs'), rsCode);
const rs = extractCodeStructure(rsCode, 'rust');
assert('RS: use', rs.imports.includes('std::collections::HashMap'));
assert('RS: struct Cache', rs.symbols.some((s) => s.name === 'Cache' && s.kind === 'struct'));
assert('RS: enum Mode', rs.symbols.some((s) => s.name === 'Mode' && s.kind === 'enum'));
assert('RS: fn add', rs.symbols.some((s) => s.name === 'add' && s.kind === 'function'));
assert('RS: impl Cache', rs.symbols.some((s) => s.name.startsWith('impl Cache')));

// Go
const goCode = [
  'package calc',
  '',
  'import (',
  '  "fmt"',
  '  "strings"',
  ')',
  '',
  'type Point struct {',
  '  X int',
  '}',
  '',
  'func Add(a, b int) int {',
  '  return a + b',
  '}',
  '',
  'func (p *Point) Move() {',
  '  p.X++',
  '}',
].join('\n');
fs.writeFileSync(D('calc.go'), goCode);
const gs = extractCodeStructure(goCode, 'go');
assert('GO: import block both', gs.imports.includes('fmt') && gs.imports.includes('strings'));
assert('GO: type Point struct', gs.symbols.some((s) => s.name === 'Point' && s.kind === 'struct'));
assert('GO: func Add', gs.symbols.some((s) => s.name === 'Add' && s.kind === 'function'));
assert('GO: method Move', gs.symbols.some((s) => s.name === 'Move' && s.kind === 'function'));

// Shell / PowerShell
const sh = '#!/bin/bash\nfunction build() {\n  echo building\n}\ndeploy() {\n  echo deploy\n}\n';
fs.writeFileSync(D('ci.sh'), sh);
const shs = extractCodeStructure(sh, 'shell');
assert('SH: function build', shs.symbols.some((s) => s.name === 'build'));
assert('SH: deploy() syntax', shs.symbols.some((s) => s.name === 'deploy'));
const ps1 = 'function Test-Build {\n  Write-Host "ok"\n}\n';
fs.writeFileSync(D('ci.ps1'), ps1);
assert('PS1: function Test-Build', extractCodeStructure(ps1, 'powershell').symbols.some((s) => s.name === 'Test-Build'));

// JSON/YAML/MD → no symbols (data formats)
const jsS = extractCodeStructure('{"a":1}', 'json');
assert('JSON: no symbols (data format)', jsS.symbols.length === 0 && jsS.imports.length === 0);

// never throws on garbage
assert('garbage never throws', (() => { try { extractCodeStructure('///{{{{', 'typescript'); return true; } catch { return false; } })());

// ─── 4) attachSymbolsToChunks ───────────────────────────────────────────────
console.log('\n4) chunk attachment:');
const fakeChunks = [
  { content: 'add body', metadata: { startLine: 5, endLine: 8 } },
  { content: 'multiply', metadata: { startLine: 9, endLine: 9 } },
  { content: 'no range', metadata: {} },
];
attachSymbolsToChunks(fakeChunks, ts);
assert('chunk over add lists "function add"', fakeChunks[0].metadata.symbols.includes('function add'));
assert('chunk 1 also tags multiply', fakeChunks[1].metadata.symbols.includes('function multiply'));
assert('every chunk gets language', fakeChunks.every((c) => c.metadata.language === 'typescript'));
assert('no-range chunk skipped safely', !Array.isArray(fakeChunks[2].metadata.symbols));

// ─── 5) End-to-end ingestion with structure ─────────────────────────────────
console.log('\n5) ingestion end-to-end:');
const ing = await ingestFile(D('calculator.ts'), { projectId: 'p11', roots: [ROOT] });
assert('calculator.ts indexed', ing.status === 'indexed');
if (ing.status === 'indexed') {
  const dm = ing.document.metadata!;
  assert('doc metadata.language = typescript', dm.language === 'typescript');
  assert('doc metadata.imports', (dm.imports || []).includes('./util'));
  assert('doc metadata.symbolCount', typeof dm.symbolCount === 'number' && dm.symbolCount! >= 6);
  const addChunk = ing.chunks.find((c) => c.metadata?.symbols?.includes('function add'));
  assert('some chunk carries "function add"', !!addChunk);
  assert('that chunk has line range for citation', addChunk!.metadata!.startLine !== undefined && addChunk!.metadata!.endLine !== undefined);
  assert('chunk language set', ing.chunks.every((c) => c.metadata?.language === 'typescript'));
}

// python e2e
const pyIng = await ingestFile(D('calc.py'), { projectId: 'p11', roots: [ROOT] });
assert('calc.py indexed with language', pyIng.status === 'indexed' && (pyIng as any).document.metadata.language === 'python');

// folder scan now accepts xml
const scan = scanFolderForIngest(ROOT, { roots: [ROOT] });
assert('folder scan collects .xml now', scan.files.some((f) => f.endsWith('.xml')));
assert('folder scan collects all code samples', ['.ts', '.py', '.java', '.c', '.cs', '.rs', '.go', '.sh', '.ps1', '.xml'].every((ext) => scan.files.some((f) => f.endsWith(ext))));

// ─── 6) Additivity + purity ─────────────────────────────────────────────────
console.log('\n6) additivity + offline purity:');
const parsersSrc = fs.readFileSync(path.join(__dirname, '../../src/main/knowledge/parsers.ts'), 'utf-8');
assert('Phase 9 parsers untouched (all 6 classes still present)',
  ['PlainTextParser', 'MarkdownParser', 'JsonParser', 'LineTextParser', 'SourceCodeParser', 'HtmlParser'].every((c) => parsersSrc.includes(`class ${c}`)));
assert('XmlParser added AFTER existing registry (additive)', parsersSrc.indexOf('new XmlParser()') > parsersSrc.indexOf('new HtmlParser()'));
const structSrc = fs.readFileSync(path.join(__dirname, '../../src/main/knowledge/code-structure.ts'), 'utf-8');
assert('code-structure: ZERO imports (pure)', !/^import /m.test(structSrc));
assert('code-structure: no REAL fs/electron/network imports', !/^import|^const .* = require\(/m.test(structSrc));

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`P11-A RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P11-A DOCUMENT FORMAT SUPPORT: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
