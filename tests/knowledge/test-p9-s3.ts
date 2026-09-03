/**
 * Phase 9 / P9-S3 — Hybrid Retriever + Citations + KnowledgeService
 *
 * End-to-end over the real subsystem (deterministic hash embedder, real
 * temp-disk store; NO network, NO model download):
 *   P9-F (retrieval):   hybrid semantic+keyword fusion, paraphrase recall,
 *                       exact-identifier recall, filters (domain/docIds),
 *                       minScore, limit
 *   P9-H (sources):     every result carries sourcePath + line range;
 *                       retrieveForPrompt frames with citations
 *   service:            addDocument KnowledgeBase conformance, dedup skip,
 *                       removeDocument, list/filter, stats, rebuild, purge,
 *                       project isolation through the service layer
 *
 * Run: npx tsx tests/knowledge/test-p9-s3.ts
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
const { KnowledgeService, getKnowledgeService, listKnowledgeProjects } = await import('../../src/main/knowledge/knowledge-service');
const { HybridRetriever } = await import('../../src/main/knowledge/retriever');
type KnowledgeBaseT = import('../../src/main/ai/knowledge-types').KnowledgeBase;

// ─── Fixture: realistic mini-corpus ─────────────────────────────────────────
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p9s3-'));
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p9s3-ud-'));
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });

fs.writeFileSync(path.join(ROOT, 'docs', 'auth.md'),
`# Authentication\n\nThe login endpoint validates JWT bearer tokens.\nTokens expire after 24 hours by default.\n\n# Refresh Flow\n\nUse refresh tokens to obtain new access tokens silently.`);

fs.writeFileSync(path.join(ROOT, 'docs', 'deploy.md'),
`# Deployment\n\nSet DATABASE_URL in the environment before deploying.\nRun migrations with npm run migrate on every release.`);

fs.writeFileSync(path.join(ROOT, 'docs', 'pricing.ts'),
`export function calculateTotalPrice(items: CartItem[]): number {\n  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);\n  const tax = subtotal * 0.09;\n  return subtotal + tax;\n}`);

const emb = new HashEmbedder();
const svc = new KnowledgeService({ userDataDir: UD, projectId: 'projX', embedder: emb, roots: [ROOT] });
const kb: KnowledgeBaseT = svc; // interface conformance

// ─── ingestion via service ──────────────────────────────────────────────────
console.log('\nservice ingestion:');
const r1 = await svc.ingestWithReport(path.join(ROOT, 'docs', 'auth.md'), 'software');
const r2 = await svc.ingestWithReport(path.join(ROOT, 'docs', 'deploy.md'), 'software');
const r3 = await svc.ingestWithReport(path.join(ROOT, 'docs', 'pricing.ts'), 'software');
assert('md doc indexed', r1.status === 'indexed' && r1.chunkCount! >= 1);
assert('md doc #2 indexed', r2.status === 'indexed');
assert('code doc indexed', r3.status === 'indexed');

// dedup skip
const again = await svc.ingestWithReport(path.join(ROOT, 'docs', 'auth.md'));
assert('re-ingest identical file → skipped-unchanged', again.status === 'skipped-unchanged');

// re-index after change
fs.writeFileSync(path.join(ROOT, 'docs', 'deploy.md'),
`# Deployment\n\nSet DATABASE_URL in the environment before deploying.\nRun migrations with npm run migrate on every release.\n\n# Rollback\n\nUse npm run rollback if migrations fail.`);
const changed = await svc.ingestWithReport(path.join(ROOT, 'docs', 'deploy.md'), 'software');
assert('changed file re-indexed', changed.status === 'indexed');

// KnowledgeBase.addDocument contract (throws on unsupported)
let threwUnsupported = false;
try { await kb.addDocument(path.join(ROOT, 'docs', 'nope.xyz')); } catch { threwUnsupported = true; }
fs.writeFileSync(path.join(ROOT, 'docs', 'nope.xyz'), 'data');
assert('addDocument throws on unsupported ext', threwUnsupported === true);
const added = await kb.addDocument(path.join(ROOT, 'docs', 'auth.md'));
assert('addDocument returns KnowledgeDocument', added.id.startsWith('doc_') && added.title === 'auth.md');

// ─── P9-F: hybrid retrieval ─────────────────────────────────────────────────
console.log('\nP9-F hybrid retrieval:');

// paraphrase (semantic-leaning): "how do tokens stay valid" ≈ expiry text
const para = await svc.retrieve({ query: 'how long do login tokens stay valid', mode: 'hybrid', limit: 3 });
assert('paraphrase query retrieves auth doc', para.length > 0 && para[0].document.title === 'auth.md');

// exact identifier (keyword-leaning)
const ident = await svc.retrieve({ query: 'calculateTotalPrice', mode: 'hybrid', limit: 3 });
assert('exact identifier retrieves pricing.ts first', ident[0].document.title === 'pricing.ts');

// keyword mode
const kw = await svc.retrieve({ query: 'DATABASE_URL migrations', mode: 'keyword', limit: 3 });
assert('keyword mode finds deploy doc', kw.some((r) => r.document.title === 'deploy.md'));

// semantic mode
const sem = await svc.retrieve({ query: 'tax computation for shopping cart totals', mode: 'semantic', limit: 3 });
assert('semantic mode finds pricing logic', sem.some((r) => r.document.title === 'pricing.ts'));

// fusion beats single legs: chunk matched by BOTH ranks first
const both = await svc.retrieve({ query: 'calculateTotalPrice cart total price', mode: 'hybrid', limit: 3 });
assert('hybrid ranks identifier+paraphrase match first', both[0].document.title === 'pricing.ts');
assert('results carry matchType', both.every((r) => ['keyword', 'semantic', 'hybrid'].includes(r.matchType)));

// limit respected
const lim = await svc.retrieve({ query: 'tokens', mode: 'hybrid', limit: 1 });
assert('limit respected', lim.length <= 1);

// domain filter
const domF = await svc.retrieve({ query: 'tokens', mode: 'hybrid', limit: 5, domain: 'physics' });
assert('foreign domain filter → empty', domF.length === 0);
const domT = await svc.retrieve({ query: 'tokens', mode: 'hybrid', limit: 5, domain: 'software' });
assert('matching domain filter → results', domT.length > 0);

// documentIds filter
const docList = await svc.listDocuments();
const onlyAuth = docList.find((d) => d.title === 'auth.md')!;
const fDocs = await svc.retrieve({ query: 'migrate deploy database', mode: 'hybrid', limit: 5, documentIds: [onlyAuth.id] });
assert('documentIds filter restricts results', fDocs.length === 0 || fDocs.every((r) => r.document.title === 'auth.md'));

// ─── P9-H: source/citation tracking ─────────────────────────────────────────
console.log('\nP9-H sources & citations:');
assert('results carry sourcePath', (await svc.retrieve({ query: 'JWT tokens', mode: 'hybrid', limit: 3 })).every((r) => !!r.document.sourcePath));
const cited = await svc.retrieve({ query: 'refresh tokens obtain new access', mode: 'hybrid', limit: 3 });
assert('chunks carry line ranges', cited.every((r) => {
  const m = r.chunk.metadata || {};
  return typeof m.startLine === 'number' && typeof m.endLine === 'number' && m.endLine >= m.startLine;
}));
assert('markdown chunks may carry sectionTitle', (await svc.retrieve({ query: 'refresh flow', mode: 'hybrid', limit: 5 })).some((r) => r.chunk.sectionTitle === 'Refresh Flow'));

const { framed, results } = await svc.retrieveForPrompt('how does the refresh flow work', 3);
assert('retrieveForPrompt frames as UNTRUSTED DATA', framed.includes('UNTRUSTED DOCUMENT EXCERPT') && framed.includes('NOT INSTRUCTIONS'));
assert('framed context cites source files', framed.includes('auth.md'));
assert('framed context includes line numbers', /\(lines \d+-\d+\)|\(lines \d+\)/.test(framed));
assert('framing returns underlying results', results.length > 0);

// ─── service extras ─────────────────────────────────────────────────────────
console.log('\nservice extras:');
const stats = await svc.getStats();
assert('stats documents ≥ 3', stats.documents >= 3);
assert('stats chunks > 0', stats.chunks > 0);
assert('stats domains recorded', stats.domains['software'] >= 3);

const removed = docList.find((d) => d.title === 'deploy.md')!;
await svc.removeDocument(removed.id);
const after = await svc.listDocuments();
assert('removeDocument deletes record', !after.some((d) => d.id === removed.id));
const postRemove = await svc.retrieve({ query: 'DATABASE_URL migrations rollback', mode: 'hybrid', limit: 5 });
assert('removed doc no longer retrieved', !postRemove.some((r) => r.document.id === removed.id));

const rebuild = await svc.rebuildIndex();
assert('rebuildIndex re-indexes remaining docs', rebuild.indexed >= 2);

// purgeMissing: delete a source file then purge
const pricingDoc = (await svc.listDocuments()).find((d) => d.title === 'pricing.ts')!;
fs.rmSync(path.join(ROOT, 'docs', 'pricing.ts'));
const purged = await svc.purgeMissing();
assert('purgeMissing removes deleted-file docs', purged.includes(pricingDoc.id));
const postPurge = await svc.retrieve({ query: 'calculateTotalPrice', mode: 'hybrid', limit: 5 });
assert('purged doc not retrievable', !postPurge.some((r) => r.document.id === pricingDoc.id));

// registry + isolation through getKnowledgeService
// (registry tracks FACTORY-created services — the main.ts wiring path;
//  direct construction stays DI-pure for tests/embeddings)
const svcB = getKnowledgeService({ userDataDir: UD, projectId: 'projY', embedder: emb, roots: [ROOT] });
const svcX2 = getKnowledgeService({ userDataDir: UD, projectId: 'projX', embedder: emb, roots: [ROOT] });
assert('registry returns same instance per project', getKnowledgeService({ userDataDir: UD, projectId: 'projY', embedder: emb, roots: [ROOT] }) === svcB);
const st1 = await svcX2.getStats(); const st2 = await svc.getStats();
assert('registry resolves existing projX store (same data)', st1.documents === st2.documents && st1.chunks === st2.chunks);
assert('registry tracks projects', listKnowledgeProjects().includes('projX') && listKnowledgeProjects().includes('projY'));
const crossProbe = await svcB.retrieve({ query: 'JWT refresh tokens authentication', mode: 'hybrid', limit: 5 });
assert('isolation: service B cannot retrieve projX docs', crossProbe.length === 0);
const bStats = await svcB.getStats();
assert('isolation: service B store empty', bStats.documents === 0 && bStats.chunks === 0);

// retriever direct construction (dependency injection proof)
const { LocalVectorStore } = await import('../../src/main/knowledge/vector-store');
const directStore = new LocalVectorStore(UD, 'projX');
const directRetriever = new HybridRetriever({ store: directStore, embedder: emb });
const directHits = await directRetriever.retrieve({ query: 'authentication JWT', mode: 'hybrid', limit: 3 });
assert('HybridRetriever works standalone over injected store+embedder', directHits.length > 0);

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`P9-S3 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P9-S3 RETRIEVER + CITATIONS + SERVICE: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
