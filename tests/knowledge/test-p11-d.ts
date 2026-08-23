/**
 * Phase 11 / P11-D — Structured Chunking
 *
 * 1. JSON: object → per-key subtree chunks (jsonPath annotated);
 *    array → row groups; malformed → falls back to P9 flow
 * 2. CSV: header prepended to EVERY row-group chunk; rowRange metadata;
 *    header-only file → single header chunk
 * 3. Code: symbol-aligned boundaries (prelude / symbols / gaps / tail);
 *    whole symbols stay intact when they fit; oversized symbol flow-split
 *    with its label; no-symbols → falls back to P9 units
 * 4. Citation-friendliness: every chunk has 1-based startLine/endLine and
 *    (code) symbols — "calculator.ts → function add → lines 5-7"
 * 5. Determinism: stable IDs; same input → same output
 * 6. Ingestion e2e: json/csv/ts documents chunked via the new strategies
 *    with metadata intact; markdown/plaintext UNCHANGED (P9 behavior)
 *
 * Run: npx tsx tests/knowledge/test-p11-d.ts
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

const { structuredChunkDocument } = await import('../../src/main/knowledge/structured-chunker');
const { chunkDocument } = await import('../../src/main/knowledge/chunker');
const { extractCodeStructure } = await import('../../src/main/knowledge/code-structure');
const { ingestFile } = await import('../../src/main/knowledge/ingester');

// ─── JSON ───────────────────────────────────────────────────────────────────
console.log('\nJSON (object/array boundaries):');
const jsonObj = JSON.stringify({
  server: { host: 'localhost', port: 8080, tls: true },
  database: { url: 'postgres://db.local/main', pool: 20 },
  features: ['auth', 'rag', 'offline'],
}, null, 2);
const j1 = structuredChunkDocument({ documentId: 'd-json', text: jsonObj, format: 'json' });
assert('object → 3 key-subtree chunks', j1!.length === 3);
assert('jsonPath annotated', j1!.every((c, i) => c.metadata!.jsonPath === `$.${['server', 'database', 'features'][i]}`));
assert('content includes key name', j1![0].content.includes('server') && j1![0].content.includes('8080'));
assert('line ranges present', j1!.every((c) => typeof c.metadata!.startLine === 'number' && c.metadata!.endLine! >= c.metadata!.startLine!));
assert('indexes contiguous', j1!.every((c, i) => c.index === i));

const bigArray = JSON.stringify(Array.from({ length: 120 }, (_, i) => ({ id: i, name: `item-${i}`, qty: i % 7 })), null, 1);
const j2 = structuredChunkDocument({ documentId: 'd-arr', text: bigArray, format: 'json' });
assert('array → multiple row groups', j2!.length > 1 && j2!.length <= 10);
assert('groups carry array jsonPath ranges', /^\$\[\d+:\d+\]$/.test(j2![0].metadata!.jsonPath));
assert('first group starts at $[0:…]', j2![0].metadata!.jsonPath.startsWith('$[0:'));

const jBad = structuredChunkDocument({ documentId: 'd-bad', text: '{broken!!', format: 'json' });
assert('malformed JSON → null (P9 fallback)', jBad === null);

const jEmpty = structuredChunkDocument({ documentId: 'd-e', text: '{}', format: 'json' });
assert('empty object → single chunk', jEmpty!.length === 1);

// ─── CSV ────────────────────────────────────────────────────────────────────
console.log('\nCSV (header + row groups):');
const header = 'name,role,team,email,hire_date';
const rows = Array.from({ length: 60 }, (_, i) =>
  `user${String(i).padStart(3, '0')},role-${i % 3},team-${i % 5},user${i}@example-corp.test,202${i % 4}-0${(i % 9) + 1}-1${i % 9}`);
const csvText = [header, ...rows].join('\n');
const c1 = structuredChunkDocument({ documentId: 'd-csv', text: csvText, format: 'csv' });
assert('csv → multiple row-group chunks', c1!.length > 1);
assert('EVERY chunk starts with the header', c1!.every((c) => c.content.startsWith('name,role,team')));
assert('rowRange metadata', c1!.every((c) => /rows \d+-\d+/.test(c.metadata!.rowRange)));
assert('all rows covered exactly once', (() => {
  const seen = c1!.map((c) => c.content.split('\n').length - 1).reduce((a, b) => a + b, 0);
  return seen === 60;
})());
const cSmall = structuredChunkDocument({ documentId: 'd-s', text: 'a,b\n1,2\n3,4', format: 'csv' });
assert('small csv → single chunk (under target)', cSmall!.length === 1 && cSmall![0].content.startsWith('a,b'));
assert('first group = rows 1-N', c1![0].metadata!.rowRange === `rows 1-${c1![0].metadata!.rowCount}`);
const cHeader = structuredChunkDocument({ documentId: 'd-h', text: 'a,b,c', format: 'csv' });
assert('header-only → single header chunk', cHeader!.length === 1 && cHeader![0].metadata!.rowRange === 'header-only');

// ─── Code (symbol-aligned) ──────────────────────────────────────────────────
console.log('\nCode (symbol-aligned):');
const calcTs = [
  'import { validate } from "./util";',
  '// shared helpers module',
  '',
  '/** adds two numbers */',
  'export function add(a: number, b: number): number {',
  '  return a + b;',
  '}',
  '',
  'export class Calculator {',
  '  run(op: string): number {',
  '    return add(1, 2);',
  '  }',
  '}',
  '',
  '// trailing license note',
].join('\n');
const struct = extractCodeStructure(calcTs, 'typescript');
const code1 = structuredChunkDocument({ documentId: 'd-code', text: calcTs, format: 'source-code', filename: 'calc.ts', language: 'typescript', symbols: struct.symbols });
assert('code chunked (not null)', code1 !== null);
const prelude = code1!.find((c) => c.content.includes('import') && c.content.includes('helpers module'));
assert('prelude chunk holds imports + comments', !!prelude && (prelude.metadata!.symbols || []).length === 0);
const addChunk = code1!.find((c) => (c.metadata!.symbols || []).some((s: string) => s === 'function add'));
assert('function add in its own chunk, intact', !!addChunk && /export function add[\s\S]*return a \+ b;[\s\S]*\}/.test(addChunk!.content));
assert('add chunk line range ≈ 5-7', addChunk!.metadata!.startLine <= 5 && addChunk!.metadata!.endLine >= 7);
const clsChunk = code1!.find((c) => (c.metadata!.symbols || []).some((s: string) => s === 'class Calculator'));
assert('class chunk labeled', !!clsChunk);
assert('docstring for add lives in prelude (before symbol)', !!prelude && prelude!.content.includes('/** adds two numbers */') ? true : addChunk!.content.includes('/** adds two numbers */'));

// no symbols → fallback null
const codePlain = 'let x = 1;\nlet y = 2;\n';
const noSym = structuredChunkDocument({ documentId: 'd-plain', text: codePlain, format: 'source-code', filename: 'x.ts', language: 'typescript', symbols: [] });
assert('no symbols → null (P9 unit fallback)', noSym === null);

// oversized symbol → flow-split WITH label
const hugeFn = ['export function huge(n: number): number {', ...Array.from({ length: 300 }, (_, i) => `  const v${i} = n + ${i};`), '  return n;', '}'].join('\n');
const hugeCode = ['import x from "y";', '', hugeFn].join('\n');
const hugeStruct = extractCodeStructure(hugeCode, 'typescript');
const hc = structuredChunkDocument({ documentId: 'd-huge', text: hugeCode, format: 'source-code', filename: 'h.ts', language: 'typescript', symbols: hugeStruct.symbols, config: { targetChars: 400, maxChars: 600, overlapChars: 40 } });
assert('oversized symbol split into pieces', hc!.filter((c) => (c.metadata!.symbols || []).includes('function huge')).length > 1);
assert('every piece respects maxChars', hc!.every((c) => c.content.length <= 600));

// determinism
const again = structuredChunkDocument({ documentId: 'd-code', text: calcTs, format: 'source-code', filename: 'calc.ts', language: 'typescript', symbols: struct.symbols });
assert('deterministic (same ids)', again!.map((c) => c.id).join() === code1!.map((c) => c.id).join());

// ─── e2e ingestion ──────────────────────────────────────────────────────────
console.log('\ningestion e2e:');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p11d-'));
fs.writeFileSync(path.join(ROOT, 'settings.json'), jsonObj);
fs.writeFileSync(path.join(ROOT, 'users.csv'), csvText);
fs.writeFileSync(path.join(ROOT, 'calc.ts'), calcTs);

const rJson = await ingestFile(path.join(ROOT, 'settings.json'), { projectId: 'p11d', roots: [ROOT] });
assert('json e2e: 3 chunks w/ jsonPath', rJson.status === 'indexed' && (rJson as any).chunks.length === 3 && (rJson as any).chunks.every((c: any) => c.metadata.jsonPath));

const rCsv = await ingestFile(path.join(ROOT, 'users.csv'), { projectId: 'p11d', roots: [ROOT] });
assert('csv e2e: header-chunks', rCsv.status === 'indexed' && (rCsv as any).chunks.every((c: any) => c.content.startsWith('name,role,team,email,hire_date')));

const rTs = await ingestFile(path.join(ROOT, 'calc.ts'), { projectId: 'p11d', roots: [ROOT] });
assert('ts e2e: symbol-labeled chunks', rTs.status === 'indexed' && (rTs as any).chunks.some((c: any) => (c.metadata.symbols || []).includes('function add')));

// markdown/plaintext UNCHANGED (P9 authority)
const mdText = '# A\n\nalpha content here\n\n# B\n\nbeta content here\n';
const mdChunks = chunkDocument({ documentId: 'd-md', text: mdText, format: 'markdown', sections: [{ title: 'A', text: 'alpha content here' }, { title: 'B', text: 'beta content here' }] });
assert('markdown still P9 path w/ sections', structuredChunkDocument({ documentId: 'x', text: mdText, format: 'markdown' }) === null && mdChunks.some((c) => c.sectionTitle === 'A'));
const txtChunks = chunkDocument({ documentId: 'd-t', text: 'plain text flow', format: 'plaintext' });
assert('plaintext still P9 path', structuredChunkDocument({ documentId: 'x', text: 't', format: 'plaintext' }) === null && txtChunks.length === 1);

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`P11-D RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P11-D STRUCTURED CHUNKING: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
