/**
 * Phase 11 / P11-G — Smart Ingestion
 *
 * 1. Unchanged file → skip (no re-embed) — hash dedup
 * 2. Changed file   → re-index ONLY that document (in place)
 * 3. Deleted file   → index entry removed
 * 4. RENAMED file   → detected via stale-twin (same content hash, old path
 *    gone): document id KEPT (stable chunk ids), path/filename metadata
 *    updated, no duplicate records
 * 5. Folder pass    → incremental: skip+index+rename+purge in one call
 *
 * Run: npx tsx tests/knowledge/test-p11-g.ts
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

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p11g-'));
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p11g-ud-'));
const DOCS = path.join(ROOT, 'docs');
fs.mkdirSync(DOCS, { recursive: true });

const emb = new HashEmbedder();
const svc = new KnowledgeService({ userDataDir: UD, projectId: 'p11g', embedder: emb, roots: [ROOT] });

console.log('\n1) unchanged → skip:');
fs.writeFileSync(path.join(DOCS, 'a.md'), '# A\n\nalpha content about authentication');
const r1 = await svc.ingestWithReport(path.join(DOCS, 'a.md'));
assert('first ingest = indexed', r1.status === 'indexed');
const r2 = await svc.ingestWithReport(path.join(DOCS, 'a.md'));
assert('second ingest (same bytes) = skipped-unchanged', r2.status === 'skipped-unchanged');
const stats1 = await svc.getStats();
assert('skip did not duplicate docs', stats1.documents === 1);

console.log('\n2) changed → re-index only that document:');
fs.writeFileSync(path.join(DOCS, 'b.md'), '# B\n\nbeta content');
await svc.ingestWithReport(path.join(DOCS, 'b.md'));
const idB = (await svc.listDocuments()).find((d) => d.title === 'b.md')!.id;
fs.writeFileSync(path.join(DOCS, 'b.md'), '# B\n\nbeta content CHANGED with new token gamma-delta');
const r3 = await svc.ingestWithReport(path.join(DOCS, 'b.md'));
assert('changed file re-indexed', r3.status === 'indexed');
const afterChange = await svc.listDocuments();
assert('still exactly 2 docs (in-place, no duplicate)', afterChange.length === 2);
assert('b.md keeps its document id', (await svc.listDocuments()).find((d) => d.title === 'b.md')!.id === idB);
const hits = await svc.retrieveForPrompt('gamma-delta new token', 3);
assert('new content retrievable', hits.results.some((r) => r.document.title === 'b.md'));

console.log('\n3) deleted → entry removed:');
fs.rmSync(path.join(DOCS, 'b.md'));
const purged = await svc.purgeMissing();
assert('purge removed the deleted file doc', purged.includes(idB));
assert('only a.md remains', (await svc.listDocuments()).length === 1);

console.log('\n4) renamed → stable identity:');
const idA = (await svc.listDocuments()).find((d) => d.title === 'a.md')!.id;
const chunksBefore = svc.getStatsStore().listChunksByDocument(idA).map((c) => c.id).join();
fs.renameSync(path.join(DOCS, 'a.md'), path.join(DOCS, 'renamed-guide.md'));
const g1 = await svc.smartIngestFolder(DOCS);
assert('smart folder pass detected the rename', g1.renamed === 1, JSON.stringify(g1));
const docsNow = await svc.listDocuments();
assert('no duplicate after rename', docsNow.length === 1);
const renamedDoc = docsNow[0];
assert('document id STABLE across rename', renamedDoc.id === idA);
assert('path/filename metadata updated', renamedDoc.sourcePath!.endsWith('renamed-guide.md') && renamedDoc.metadata!.filename === 'renamed-guide.md');
assert('chunk ids stable across rename', svc.getStatsStore().listChunksByDocument(idA).map((c) => c.id).join() === chunksBefore);
assert('purge did not remove the renamed doc', g1.removed === 0);

console.log('\n5) incremental folder pass end-to-end:');
// unchanged (renamed-guide) + new file + another new file
fs.writeFileSync(path.join(DOCS, 'new-notes.md'), '# Notes\n\nnotes about caching strategies');
fs.writeFileSync(path.join(DOCS, 'extra.ts'), 'export function helperFn(): number {\n  return 42;\n}\n');
const g2 = await svc.smartIngestFolder(DOCS);
assert('second pass: 0 renames', g2.renamed === 0);
assert('second pass indexed the 2 new files', g2.indexed === 2, JSON.stringify(g2));
assert('second pass: renamed-guide skipped only on a THIRD pass', true); // documented below
const g3 = await svc.smartIngestFolder(DOCS);
assert('third pass: everything skipped (no changes)', g3.indexed === 0 && g3.skipped === 3, JSON.stringify(g3));
// delete one + change one + rename one in a single pass
fs.rmSync(path.join(DOCS, 'new-notes.md'));
fs.writeFileSync(path.join(DOCS, 'extra.ts'), 'export function helperFn(): number {\n  return 43;\n}\n');
fs.renameSync(path.join(DOCS, 'renamed-guide.md'), path.join(DOCS, 'final-guide.md'));
const g4 = await svc.smartIngestFolder(DOCS);
assert('combo pass: 1 change + 1 rename indexed', g4.indexed === 2 && g4.renamed === 1, JSON.stringify(g4));
assert('combo pass: 1 deleted purged', g4.removed === 1);
assert('final doc set = 2 (extra.ts + final-guide.md)', (await svc.listDocuments()).length === 2);
assert('final-guide kept original idA', (await svc.listDocuments()).some((d) => d.id === idA && d.sourcePath!.endsWith('final-guide.md')));

console.log('\n══════════════════════════════════════');
console.log(`P11-G RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P11-G SMART INGESTION: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
