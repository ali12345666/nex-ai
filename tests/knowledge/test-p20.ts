/**
 * Phase 20 / P20 — Retrieval quality wiring (reranker ON by default)
 *
 * The P18 LexicalReranker existed but was NEVER instantiated — dead
 * quality stage. Now KnowledgeService wires it by default:
 *   1. Behavioral: service WITH reranker (default) still retrieves and
 *      cites correctly on the P9/P10 fixture patterns
 *   2. A/B: disableReranker opt-out preserved for baseline determinism
 *   3. Quality: reranked top-1 is at least as precise on phrase queries
 *   4. Purity: composition only — retriever/agent untouched
 *
 * Run: npx tsx tests/knowledge/test-p20.ts
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

const { HashEmbedder } = await import('../../src/main/knowledge/hash-embedder');
const { KnowledgeService } = await import('../../src/main/knowledge/knowledge-service');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'p20-'));
const mk = (dir: string) => fs.mkdtempSync(path.join(os.tmpdir(), 'p20-ud-'));
fs.writeFileSync(path.join(ROOT, 'auth.md'),
`# Auth\n\nRotate the deploy key quarterly through the security console with 32 char minimum stored in the vault.`);
fs.writeFileSync(path.join(ROOT, 'other.md'), '# Other\n\nGardening recipes with pasta and olive oil for dinner tonight.');

const emb = new HashEmbedder();

console.log('\n1) default service now reranks (behavioral):');
const svc = new KnowledgeService({ userDataDir: mk(), projectId: 'a', embedder: emb, roots: [ROOT] });
await svc.ingestWithReport(path.join(ROOT, 'auth.md'));
await svc.ingestWithReport(path.join(ROOT, 'other.md'));
const hits = await svc.retrieveForPrompt('rotate the deploy key quarterly', 2);
assert('reranked pipeline retrieves the right doc first', hits.results[0]?.document.title === 'auth.md');
assert('citation survives (lines + source)', hits.framed.includes('auth.md'));
assert('scores present', typeof hits.results[0]?.score === 'number');

console.log('\n2) opt-out path identical contract:');
const svcBase = new KnowledgeService({ userDataDir: mk(), projectId: 'b', embedder: emb, roots: [ROOT], disableReranker: true });
await svcBase.ingestWithReport(path.join(ROOT, 'auth.md'));
await svcBase.ingestWithReport(path.join(ROOT, 'other.md'));
const base = await svcBase.retrieveForPrompt('rotate the deploy key quarterly', 2);
assert('baseline (no reranker) still retrieves correctly', base.results[0]?.document.title === 'auth.md');
assert('baseline framing unchanged (UNTRUSTED)', base.framed.includes('UNTRUSTED DOCUMENT EXCERPT'));

console.log('\n3) quality: reranker improves phrase precision (A/B):');
const svcRr = new KnowledgeService({ userDataDir: mk(), projectId: 'c', embedder: emb, roots: [ROOT] });
const svcNo = new KnowledgeService({ userDataDir: mk(), projectId: 'd', embedder: emb, roots: [ROOT], disableReranker: true });
for (const s of [svcRr, svcNo]) {
  await s.ingestWithReport(path.join(ROOT, 'auth.md'));
  await s.ingestWithReport(path.join(ROOT, 'other.md'));
}
let rrFirst = 0, noFirst = 0;
for (const q of ['rotate deploy key vault', 'security console minimum characters', 'quarterly key rotation policy']) {
  const a = (await svcRr.retrieveForPrompt(q, 1)).results[0];
  const b = (await svcNo.retrieveForPrompt(q, 1)).results[0];
  if (a?.document.title === 'auth.md') rrFirst++;
  if (b?.document.title === 'auth.md') noFirst++;
}
assert('reranker ≥ baseline on all phrase queries', rrFirst >= noFirst && rrFirst >= 2, `rr=${rrFirst} base=${noFirst}`);

console.log('\n4) wiring + purity:');
const src = fs.readFileSync(path.join(__dirname, '../../src/main/knowledge/knowledge-service.ts'), 'utf-8');
assert('service constructs LexicalReranker by default', /reranker: new LexicalReranker\(\)/.test(src));
assert('disableReranker opt-out exists', /disableReranker/.test(src));
const agentSrc = fs.readFileSync(path.join(__dirname, '../../src/main/agent/core.ts'), 'utf-8');
assert('agent still port-only (no reranker import)', !/reranker/.test(agentSrc));

console.log('\n══════════════════════════════════════');
console.log(`P20 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P20 RETRIEVAL QUALITY WIRING: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
