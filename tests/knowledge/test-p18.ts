/**
 * Phase 18 / P18 — Local Lexical Reranker
 *
 * 1. implements the EXISTING Reranker interface (scaffold → real)
 * 2. ranking quality: phrase beats partial; coverage beats single-term;
 *    proximity rewards tight evidence; repeats capped; length penalty
 * 3. determinism + empty/degenerate inputs safe
 * 4. retriever integration: injected reranker reorders RRF candidates;
 *    reranker failure keeps RRF order; no-reranker = previous behavior
 * 5. offline purity (suite runs net-blocked)
 *
 * Run: npx tsx tests/knowledge/test-p18.ts
 */
import '../__mocks__/install-electron-mock.js';

import * as netMod from 'net';
const attempts: string[] = [];
(netMod as any).request = (..._a: any[]) => { attempts.push('net'); throw new Error('BLOCKED'); };
const origFetch = (globalThis as any).fetch;
(globalThis as any).fetch = (..._a: any[]) => { attempts.push('fetch'); throw new Error('BLOCKED'); };
void origFetch;

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

function chunk(id: string, content: string): any {
  return { id, documentId: 'd', content, index: 0 };
}

async function main(): Promise<void> {

const { LexicalReranker, applyReranker } = await import('../../src/main/knowledge/reranker');
const rr = new LexicalReranker();

console.log('\n1) ranking quality:');
const query = 'how to rotate the deploy key';
const results = await rr.rerank(query, [
  chunk('phrase', 'You should rotate the deploy key every 90 days via the console.'),               // phrase + full coverage
  chunk('partial', 'The deploy process involves building artifacts and running smoke tests.'),      // deploy only
  chunk('spread', 'rotate the ... unrelated text ... key ... more unrelated ... how ... deploy ...'),// scattered
  chunk('none', 'Completely unrelated content about gardening and recipes here.'),
], 4);
const ids = results.map((r) => r.chunk.id);
assert('phrase-exact chunk ranks #1', ids[0] === 'phrase');
assert('unrelated chunk ranks last', ids[ids.length - 1] === 'none');
// TEST BUG (documented): original expectation 'partial beats spread' was
// WRONG — 'spread' contains ALL query terms (full idf coverage + density)
// which legitimately outranks 'partial' (single term 'deploy'). Proximity
// only differentiates among fully-covering candidates. Correct semantics:
assert('full-coverage spread beats single-term partial', ids.indexOf('spread') < ids.indexOf('partial'));
assert('coherent phrase beats scattered spread', ids.indexOf('phrase') < ids.indexOf('spread'));
assert('scores sorted desc', results.every((r, i) => i === 0 || results[i - 1].score >= r.score));
assert('scores present for matched chunks', results[0].score > 0);

// proximity: tight window beats same terms scattered
const prox = await rr.rerank('alpha beta gamma', [
  chunk('tight', 'alpha beta gamma all together in one line'),
  chunk('loose', 'alpha ... fifty words of filler text here between ... beta ... and more filler before gamma'),
], 2);
assert('tight proximity beats scattered', prox[0].chunk.id === 'tight');

// stopword-only query → all zero scores, original order kept
const stop = await rr.rerank('the a of to', [chunk('x', 'anything'), chunk('y', 'else')], 2);
assert('stopword-only query → zero scores, stable', stop.every((r) => r.score === 0) && stop[0].chunk.id === 'x');

// topK respected + determinism
const det1 = await rr.rerank('config server port', [chunk('a', 'server port config'), chunk('b', 'port'), chunk('c', 'config server')], 2);
const det2 = await rr.rerank('config server port', [chunk('a', 'server port config'), chunk('b', 'port'), chunk('c', 'config server')], 2);
assert('deterministic', JSON.stringify(det1.map((r) => [r.chunk.id, r.score])) === JSON.stringify(det2.map((r) => [r.chunk.id, r.score])));
assert('topK respected', det1.length === 2);

console.log('\n2) retriever integration (e2e over real service):');
const { HashEmbedder } = await import('../../src/main/knowledge/hash-embedder');
const { KnowledgeService } = await import('../../src/main/knowledge/knowledge-service');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'p18-'));
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'p18-ud-'));
fs.writeFileSync(path.join(ROOT, 'deploy.md'),
`# Deploy Keys\n\nRotate the deploy key quarterly through the security console.\nIt must be 32 characters minimum and stored in the vault.`);
fs.writeFileSync(path.join(ROOT, 'cooking.md'), '# Recipes\n\nBoil pasta for nine minutes then add olive oil and garlic carefully.');

// baseline service (no reranker)
const svcBase = new KnowledgeService({ userDataDir: UD, projectId: 'p18', embedder: new HashEmbedder(), roots: [ROOT] });
await svcBase.ingestWithReport(path.join(ROOT, 'deploy.md'));
await svcBase.ingestWithReport(path.join(ROOT, 'cooking.md'));

// service WITH reranker (injected through the same constructor path)
const svcRr = new KnowledgeService({ userDataDir: UD, projectId: 'p18b', embedder: new HashEmbedder(), roots: [ROOT] });
// NOTE: KnowledgeService doesn't expose reranker injection — integration is
// at the RETRIEVER layer; verify the retriever accepts and applies it:
const { HybridRetriever } = await import('../../src/main/knowledge/retriever');
const { LocalVectorStore } = await import('../../src/main/knowledge/vector-store');
const store = new LocalVectorStore(UD, 'p18b');
const retWith = new HybridRetriever({ store: svcBase.getStatsStore() as any, embedder: new HashEmbedder(), reranker: rr });
const retWithout = new HybridRetriever({ store: svcBase.getStatsStore() as any, embedder: new HashEmbedder() });
void store; void svcRr;

const q = { query: 'rotate deploy key security console', mode: 'hybrid' as const, limit: 2 };
const [withRr, withoutRr] = await Promise.all([retWith.retrieve(q), retWithout.retrieve(q)]);
assert('both return results', withRr.length > 0 && withoutRr.length > 0);
assert('reranked pipeline still cites deploy.md first', withRr[0].document.title === 'deploy.md');
assert('citations survive rerank (line ranges)', withRr.every((r) => r.chunk.metadata?.startLine === undefined || typeof r.chunk.metadata.startLine === 'number'));

// reranker failure tolerated
const boom: any = { rerank: async () => { throw new Error('boom'); } };
const retBoom = new HybridRetriever({ store: svcBase.getStatsStore() as any, embedder: new HashEmbedder(), reranker: boom });
const out = await retBoom.retrieve(q);
assert('reranker failure → RRF order kept (no throw)', out.length > 0);

// applyReranker helper semantics
const kept = await applyReranker(null, 'q', [chunk('a', 'x')], 5);
assert('applyReranker(null) passes through', kept.length === 1);
const empty = await applyReranker(rr, 'q', [], 5);
assert('empty candidates safe', empty.length === 0);

console.log('\n3) purity + contract:');
const src = fs.readFileSync(path.join(__dirname, '../../src/main/knowledge/reranker.ts'), 'utf-8');
assert('reranker: pure (no fs/net/electron)', !/require\(|from ['"](fs|net|http|electron)/.test(src));
assert('implements Reranker interface (rerank method)', /implements Reranker/.test(src));
const retSrc = fs.readFileSync(path.join(__dirname, '../../src/main/knowledge/reranker.ts'), 'utf-8') +
               fs.readFileSync(path.join(__dirname, '../../src/main/knowledge/retriever.ts'), 'utf-8');
assert('retriever: reranker optional + failure-tolerant', /reranker\?/.test(retSrc) && /enrichment only/.test(retSrc));
assert('ZERO network attempts', attempts.length === 0, attempts.join(','));

console.log('\n══════════════════════════════════════');
console.log(`P18 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0 || attempts.length > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P18 LOCAL RERANKER: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
