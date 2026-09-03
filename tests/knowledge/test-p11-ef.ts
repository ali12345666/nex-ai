/**
 * Phase 11 / P11-E+F — Citation Engine + Knowledge Viewer
 *
 * E: formatCitation across formats (code w/ symbols, md w/ section, csv
 *    w/ rowRange, json w/ jsonPath, score suffix, path shortening);
 *    framing gains locator line; search IPC carries citation+symbols.
 * F: knowledge-chunks IPC (doc detail + embedding + chunk list w/
 *    injection flags); panel viewer wiring contract.
 *
 * Run: npx tsx tests/knowledge/test-p11-ef.ts
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

const { formatCitation, framedCitationLine } = await import('../../src/main/knowledge/citation');
const { HashEmbedder } = await import('../../src/main/knowledge/hash-embedder');
const { KnowledgeService } = await import('../../src/main/knowledge/knowledge-service');
const { frameDocumentChunk } = await import('../../src/main/knowledge/security');

console.log('\nP11-E citation engine:');
// code with symbols
const codeCit = formatCitation({
  chunk: { metadata: { startLine: 12, endLine: 27, symbols: ['function add', 'class Calc'] }, sectionTitle: undefined },
  document: { title: 'calculator.ts', sourcePath: '/home/user/proj/src/calculator.ts' },
  score: 0.912,
});
assert('code citation: file→lines·symbols·score', codeCit === '…/proj/src/calculator.ts → lines 12-27 · function add + class Calc · score 0.91', codeCit);

// markdown with section, no symbols
const mdCit = formatCitation({
  chunk: { metadata: { startLine: 3, endLine: 9 }, sectionTitle: 'Refresh Flow' },
  document: { title: 'guide.md', sourcePath: '/p/docs/guide.md' },
  score: 0.845,
});
assert('md citation with § section', mdCit === 'p/docs/guide.md → lines 3-9 · § Refresh Flow · score 0.84', mdCit); // toFixed(0.845)=0.84 (float repr)

// csv row group
const csvCit = formatCitation({
  chunk: { metadata: { rowRange: 'rows 21-60' }, sectionTitle: undefined },
  document: { title: 'users.csv', sourcePath: '/p/users.csv' },
  score: 0.77,
});
assert('csv citation = rows', csvCit === 'p/users.csv → rows 21-60 · score 0.77', csvCit);

// json path
const jsonCit = formatCitation({
  chunk: { metadata: { jsonPath: '$.database' }, sectionTitle: undefined },
  document: { title: 'settings.json', sourcePath: '/x/y/settings.json' },
  score: 0.75,
});
assert('json citation = jsonPath', jsonCit === 'x/y/settings.json → $.database · score 0.75', jsonCit);

// single line (start==end)
const single = formatCitation({
  chunk: { metadata: { startLine: 7, endLine: 7 }, sectionTitle: undefined },
  document: { title: 'a.txt', sourcePath: 'a.txt' },
});
assert('single line: "lines 7" (no range dash)', single === 'a.txt → lines 7', single);

// no metadata at all → source only
assert('no meta → source only', formatCitation({ chunk: { metadata: {}, sectionTitle: undefined }, document: { title: 'x', sourcePath: undefined } }) === 'x');

// framed line (prompt variant, no score)
const framed = framedCitationLine({
  chunk: { metadata: { startLine: 5, endLine: 7, symbols: ['function add'] }, sectionTitle: undefined },
  document: { title: 'calculator.ts', sourcePath: 'calculator.ts' },
});
assert('framedCitationLine bracketed, no score', framed === '[calculator.ts → lines 5-7 · function add]', framed);

// framing gains locator line (P11-E)
const richFrame = frameDocumentChunk({
  source: 'calc.ts', startLine: 5, endLine: 7,
  content: 'export function add...',
  symbols: ['function add'], jsonPath: undefined, rowRange: undefined,
});
assert('frame gains symbols locator', richFrame.includes('symbols: function add'));
assert('frame keeps UNTRUSTED banner', richFrame.includes('UNTRUSTED DOCUMENT EXCERPT'));
const jsonFrame = frameDocumentChunk({ source: 's.json', content: 'x', jsonPath: '$.db', rowRange: 'rows 1-4' });
assert('frame json+rows locators', jsonFrame.includes('json: $.db') && jsonFrame.includes('rows: rows 1-4'));
const plainFrame = frameDocumentChunk({ source: 'a.txt', content: 'x', startLine: 2 });
assert('plain frame has NO locator line', !plainFrame.includes('locator:'));

console.log('\nP11-E search IPC carries citations (service-level):');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p11ef-'));
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p11ef-ud-'));
fs.writeFileSync(path.join(ROOT, 'calculator.ts'), [
  'export function add(a: number, b: number): number {',
  '  return a + b;',
  '}',
].join('\n'));
const svc = new KnowledgeService({ userDataDir: UD, projectId: 'p11ef', embedder: new HashEmbedder(), roots: [ROOT] });
await svc.ingestWithReport(path.join(ROOT, 'calculator.ts'), 'software');
const { framed: promptFramed, results } = await svc.retrieveForPrompt('add two numbers', 3);
assert('service framing now carries symbols locator', promptFramed.includes('symbols: function add'));
assert('results available for citation build', results.length > 0);
const cit = formatCitation({ chunk: results[0].chunk, document: results[0].document, score: results[0].score });
assert('citation builds from live retrieval', cit.includes('calculator.ts') && cit.includes('function add') && /score \d/.test(cit));

console.log('\nP11-F knowledge-chunks IPC + viewer:');
// simulate the exact handler mapping over the service
const doc0 = (await svc.listDocuments())[0];
const store = svc.getStatsStore();
const chunks = store.listChunksByDocument(doc0.id);
const mapped = chunks.map((c: any) => ({
  id: c.id, index: c.index,
  startLine: c.metadata?.startLine, endLine: c.metadata?.endLine,
  sectionTitle: c.sectionTitle, symbols: c.metadata?.symbols,
  jsonPath: c.metadata?.jsonPath, rowRange: c.metadata?.rowRange,
  language: c.metadata?.language,
  suspectedInjection: c.metadata?.suspectedInjection === true,
  preview: c.content.slice(0, 160), chars: c.content.length,
}));
assert('chunks listed with line ranges + symbols', mapped.length >= 1 && typeof mapped[0].startLine === 'number' && (mapped[0].symbols || []).includes('function add'));
assert('embedding info exposed for viewer', svc.embeddingInfo().backend === 'hash');
const missing = await svc.getDocument('nope');
assert('unknown doc → not found (handler errors cleanly)', missing === null);

// static wiring contracts
const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');
const mainSrc = read('../../src/main/main.ts');
assert("main handles 'knowledge-chunks'", mainSrc.includes("'knowledge-chunks'"));
assert('search handler emits citation via formatCitation', /knowledge-search[\s\S]{0,700}formatCitation/.test(mainSrc));
const pre = read('../../src/main/preload.ts');
assert('preload bridges knowledgeChunks', pre.includes('knowledgeChunks'));
const panel = read('../../src/renderer/components/KnowledgePanel.tsx');
assert('panel: viewer state + openDoc', /openDoc/.test(panel) && /viewDoc/.test(panel));
assert('panel: chunk list rendered with symbols', /viewDoc\.chunks\.map/.test(panel) && /c\.symbols/.test(panel));
assert('panel: injection flag surfaced', /suspectedInjection/.test(panel));
assert('panel: View button per document', />\s*View\s*</.test(panel));
assert('panel: citation line rendered on results', /r\.citation/.test(panel));
assert('panel: embedding shown in viewer', /viewDoc\.embedding/.test(panel));

console.log('\n══════════════════════════════════════');
console.log(`P11-E/F RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P11-E CITATION + P11-F VIEWER: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
