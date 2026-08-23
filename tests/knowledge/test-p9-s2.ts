/**
 * Phase 9 / P9-S2 — Local Embedder + Vector Store + Keyword Index
 *
 * Deterministic (no model download, no network):
 *   P9-D (embedding):  determinism, L2 norm, similarity semantics,
 *                      batch, interface conformance, offline-by-construction
 *   P9-E (vector store): insert/update/delete/search/clear/stats,
 *                      persistence round-trip, atomic writes
 *   P9-G (isolation):  project A cannot see project B (by construction
 *                      + separate files + separate dirs)
 *   keyword index:     exact-identifier recall, ranking, IDF effect
 *
 * Run: npx tsx tests/knowledge/test-p9-s2.ts
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

const { HashEmbedder, cosineSimilarity, tokenizeForEmbedding } = await import('../../src/main/knowledge/hash-embedder');
const { LlamaCppEmbedder, createEmbedder } = await import('../../src/main/knowledge/llama-embedder');
const { LocalVectorStore, knowledgeDirFor, vectorStorePathsFor } = await import('../../src/main/knowledge/vector-store');
const { KeywordIndex } = await import('../../src/main/knowledge/keyword-index');
type EmbedderT = import('../../src/main/ai/knowledge-types').Embedder;
type DocumentChunkT = import('../../src/main/ai/knowledge-types').DocumentChunk;

// ─── P9-D: HashEmbedder ─────────────────────────────────────────────────────
console.log('\nP9-D local embedding (offline hash embedder):');
const emb = new HashEmbedder();
const embIface: EmbedderT = emb; void embIface; // interface conformance via assignment
assert('implements Embedder interface', typeof emb.embed === 'function' && typeof emb.embedBatch === 'function' && typeof emb.dimension === 'number');
assert('default dimension 256', emb.dimension === 256);
assert('deterministic (same text → same vector)', JSON.stringify(await emb.embed('hello world')) === JSON.stringify(await emb.embed('hello world')));
assert('different text → different vector', JSON.stringify(await emb.embed('hello world')) !== JSON.stringify(await emb.embed('goodbye moon')));

const v = await emb.embed('The quick brown fox jumps');
const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
assert('L2 normalized (‖v‖≈1)', Math.abs(norm - 1) < 1e-9);
assert('values in [-1,1]', v.every((x) => Math.abs(x) <= 1));

// similarity semantics: related > unrelated
const simA = cosineSimilarity(await emb.embed('install npm package dependencies'), await emb.embed('npm install adds package dependencies'));
const simB = cosineSimilarity(await emb.embed('install npm package dependencies'), await emb.embed('The weather is sunny today at the beach'));
assert('related texts score higher than unrelated', simA > simB, `related=${simA.toFixed(3)} unrelated=${simB.toFixed(3)}`);

const batch = await emb.embedBatch(['one two', 'three four']);
assert('batch embeds each text', batch.length === 2 && JSON.stringify(batch[0]) !== JSON.stringify(batch[1]));

assert('tokenization lowercase + split', JSON.stringify(tokenizeForEmbedding('Hello-World_test 42')) === JSON.stringify(['hello', 'world', 'test', '42']));

// custom dimensions
const emb512 = new HashEmbedder({ dimensions: 512 });
assert('configurable dimensions', (await emb512.embed('x')).length === 512);

// zero-network by construction (static)
const src = fs.readFileSync(path.join(__dirname, '../../src/main/knowledge/hash-embedder.ts'), 'utf-8');
assert('hash-embedder: ZERO network/https/fetch imports', !/net\.request|https?:\/\/|fetch\(|axios/.test(src.replace(/https?:\/\/[^'"\s]*only in comments/g, '')));

// LlamaCppEmbedder: interface conformance + lazy loading (no model needed here)
const llama = new LlamaCppEmbedder({ modelPath: '/nonexistent/model.gguf', dimensionHint: 384 });
assert('LlamaCppEmbedder implements Embedder', typeof llama.embed === 'function' && llama.dimension === 384);
let lazyThrew = false;
try { await llama.embed('x'); } catch { lazyThrew = true; }
assert('lazy load only on first embed (missing model → error, not at construction)', lazyThrew);
const llamaSrc = fs.readFileSync(path.join(__dirname, '../../src/main/knowledge/llama-embedder.ts'), 'utf-8');
assert('llama-embedder: NO external API endpoints', !/api\.(openai|anthropic|z\.ai)|bigmodel|nexai\.app/.test(llamaSrc));
const defaultEmb = await createEmbedder(undefined);
assert('createEmbedder default → HashEmbedder (offline)', defaultEmb instanceof HashEmbedder);

// ─── P9-E: Vector Store ─────────────────────────────────────────────────────
console.log('\nP9-E local vector store:');
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p9s2-ud-'));

function mkChunk(docId: string, i: number, content: string, embedding?: number[]): DocumentChunkT {
  return { id: `chk_${docId}_${i}`, documentId: docId, content, index: i, embedding };
}

const store = new LocalVectorStore(UD, 'projA');
assert('store bound to projectId', store.projectId === 'projA');
assert('knowledge dir per project', knowledgeDirFor(UD, 'projA').endsWith(path.join('knowledge', 'projA')));
assert('per-project file paths', vectorStorePathsFor(UD, 'projA').chunksFile !== vectorStorePathsFor(UD, 'projB').chunksFile);

const e1 = await emb.embed('alpha release notes describe new features');
const e2 = await emb.embed('beta migration guide for database changes');
await store.addChunks([
  { ...mkChunk('docA', 0, 'alpha release notes describe new features', e1) },
  { ...mkChunk('docB', 0, 'beta migration guide for database changes', e2) },
]);
store.putDocument({ id: 'docA', title: 'a.md', format: 'markdown', version: '1', createdAt: 1, updatedAt: 1, domain: 'software' } as any);
store.putDocument({ id: 'docB', title: 'b.md', format: 'markdown', version: '1', createdAt: 1, updatedAt: 1, domain: 'general' } as any);

const q = await emb.embed('release notes new features');
const hits = await store.searchSimilar(q, 5);
assert('semantic search finds right chunk first', hits[0].chunk.documentId === 'docA' && hits.length >= 1);
assert('scores sorted desc', hits.every((h, i) => i === 0 || hits[i - 1].score >= h.score));

// domain filter via interface signature
const domHits = await store.searchSimilar(q, 5, 'software');
assert('domain filter narrows to software docs', domHits.every((h) => h.chunk.documentId === 'docA'));
const domMiss = await store.searchSimilar(q, 5, 'physics');
assert('foreign domain → no results', domMiss.length === 0);

// documentIds allowlist via searchRaw
const onlyB = store.searchRaw(q, 5, ['docB']);
assert('documentIds allowlist honored', onlyB.every((h) => h.chunk.documentId === 'docB'));

// update (replace) semantics
const e1b = await emb.embed('alpha2 updated content');
await store.updateDocument(
  { id: 'docA', title: 'a2.md', format: 'markdown', version: '2', createdAt: 1, updatedAt: 2 } as any,
  [mkChunk('docA', 0, 'alpha2 updated content', e1b)]
);
assert('update replaces chunks (old gone)', store.listChunksByDocument('docA').length === 1 && store.getChunk('chk_docA_0') !== null);
assert('update bumps document record', store.getDocument('docA')!.version === '2');

// delete
await store.deleteByDocument('docB');
assert('deleteByDocument removes chunks', store.listChunksByDocument('docB').length === 0);
assert('deleteByDocument removes doc', store.getDocument('docB') === null);

// stats + persistence round-trip
store.flush();
const stats = await store.getStats();
assert('stats: 1 doc 1 chunk', stats.totalDocuments === 1 && stats.totalChunks === 1);
assert('stats: files on disk have size', stats.sizeBytes > 0);

const reloaded = new LocalVectorStore(UD, 'projA');
const reHits = await reloaded.searchSimilar(await emb.embed('alpha2 updated'), 3);
assert('persistence round-trip preserves vectors + search', reHits.length === 1 && reHits[0].chunk.documentId === 'docA');
assert('reload keeps doc records', reloaded.getDocument('docA')!.title === 'a2.md');

// ─── P9-G: Project isolation ────────────────────────────────────────────────
console.log('\nP9-G project isolation:');
const storeB = new LocalVectorStore(UD, 'projB');
const secretE = await emb.embed('project B secret token XYZPRIVATE');
await storeB.addChunks([mkChunk('docB1', 0, 'project B secret token XYZPRIVATE', secretE)]);
storeB.putDocument({ id: 'docB1', title: 'secret.md', format: 'markdown', version: '1', createdAt: 1, updatedAt: 1 } as any);
storeB.flush();

assert('isolation: A store cannot see B chunks', (() => {
  const probe = new LocalVectorStore(UD, 'projA');
  return probe.allChunks().every((c) => c.documentId !== 'docB1');
})());
assert('isolation: exact-content query in A does NOT surface B doc', (() => {
  const probe = new LocalVectorStore(UD, 'projA');
  return probe.searchRaw(secretE, 10).every((h) => h.chunk.documentId !== 'docB1');
})());
assert('isolation: separate files on disk', !fs.readFileSync(vectorStorePathsFor(UD, 'projA').chunksFile, 'utf-8').includes('XYZPRIVATE'));
assert('isolation: B store finds its own doc', storeB.searchRaw(secretE, 1)[0].chunk.documentId === 'docB1');

// clearProject wipes only that project
await storeB.clearProject();
assert('clearProject removes B data', new LocalVectorStore(UD, 'projB').allChunks().length === 0);
assert('clearProject leaves A intact', new LocalVectorStore(UD, 'projA').allChunks().length === 1);

// dangerous projectId sanitized for paths ('../evil/../proj' → '___evil___proj')
const weird = knowledgeDirFor(UD, '../evil/../proj');
assert('projectId sanitized (no traversal in dir)', !weird.split(path.sep).includes('..') && weird.endsWith(path.join('knowledge', '___evil___proj')));

// ─── Keyword index ──────────────────────────────────────────────────────────
console.log('\nkeyword index:');
const kchunks: DocumentChunkT[] = [
  mkChunk('d1', 0, 'function calculateTotalPrice applies tax and discount to the cart'),
  mkChunk('d2', 0, 'function renderSidebar draws navigation items in the UI'),
  mkChunk('d3', 0, 'const calculateTotalPrice = (items) => items.reduce(sum)'),
];
const kidx = new KeywordIndex();
kidx.build(kchunks);
const byId = new Map(kchunks.map((c) => [c.id, c]));
const kwHits = kidx.search('calculateTotalPrice', 3, byId);
assert('exact identifier found by keyword', kwHits.length >= 2 && kwHits[0].chunk.content.includes('calculateTotalPrice'));
assert('unrelated chunk ranked lower/absent', !kwHits.some((h) => h.chunk.documentId === 'd2'));
const commonHits = kidx.search('function', 3, byId);
assert('common term hits both functions', commonHits.length === 2);
assert('idf dampens common terms (function scores < unique identifier)', (kwHits[0].score > (commonHits[0]?.score || 0)));

// rebuild is idempotent
kidx.build(kchunks);
assert('rebuild deterministic', kidx.search('calculateTotalPrice', 3, byId)[0].chunk.id === kwHits[0].chunk.id);

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`P9-S2 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P9-S2 EMBEDDER + VECTOR STORE + KEYWORD INDEX: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
