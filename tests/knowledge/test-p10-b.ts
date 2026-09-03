/**
 * Phase 10 / P10-B — Folder Scanner + Document Management pipeline
 *
 * Pure tests for scanFolderForIngest (the "Add Folder" engine) + the full
 * UI-path pipeline through KnowledgeService. Deterministic, no network.
 *
 * Covers (P10-H security set applies per-file via Phase 9 guards):
 *   - supported files collected recursively
 *   - ignored dirs skipped (node_modules/.git/dist/…, dot-dirs)
 *   - per-file guards reused (binary rejected, oversized rejected)
 *   - caps: maxFiles / maxTotalBytes → truncated flag
 *   - traversal: folder itself outside roots (handler guard simulated)
 *   - full pipeline: scan → ingestWithReport → list → retrieve → remove
 *   - IPC surface static contract (preload bridges ↔ main handlers)
 *
 * Run: npx tsx tests/knowledge/test-p10-b.ts
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

const { scanFolderForIngest, DEFAULT_SCAN_MAX_FILES } = await import('../../src/main/knowledge/folder-scan');
const { HashEmbedder } = await import('../../src/main/knowledge/hash-embedder');
const { KnowledgeService } = await import('../../src/main/knowledge/knowledge-service');

// ─── Fixture tree ───────────────────────────────────────────────────────────
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p10b-'));
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p10b-ud-'));

fs.mkdirSync(path.join(ROOT, 'docs', 'deep'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'a.md'), '# A\n\nalpha notes about authentication');
fs.writeFileSync(path.join(ROOT, 'docs', 'deep', 'b.ts'), 'export const B = 2;\n');
fs.writeFileSync(path.join(ROOT, 'readme.txt'), 'root readme text');
fs.mkdirSync(path.join(ROOT, 'node_modules', 'pkg'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'node_modules', 'pkg', 'junk.js'), 'junk');
fs.mkdirSync(path.join(ROOT, '.git'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.git', 'HEAD'), 'ref');
fs.mkdirSync(path.join(ROOT, '.hidden'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.hidden', 's.md'), 'hidden');
fs.writeFileSync(path.join(ROOT, 'bin-artifact.log'), Buffer.from([0x61, 0x00, 0x62])); // binary
fs.writeFileSync(path.join(ROOT, 'pic.png'), 'fakepng');

console.log('\nscanner:');
const scan = scanFolderForIngest(ROOT, { roots: [ROOT] });
assert('collects supported files recursively', scan.files.length === 3);
assert('a.md included', scan.files.some((f) => f.endsWith('a.md')));
assert('deep/b.ts included', scan.files.some((f) => f.endsWith(path.join('deep', 'b.ts'))));
assert('readme.txt included', scan.files.some((f) => f.endsWith('readme.txt')));
assert('node_modules skipped', !scan.files.some((f) => f.includes('node_modules')));
assert('.git skipped', !scan.files.some((f) => f.includes(`${path.sep}.git${path.sep}`)));
assert('dot-dirs skipped', !scan.files.some((f) => f.includes('.hidden')));
assert('binary file REJECTED by guard', scan.rejected.some((r) => r.file.endsWith('bin-artifact.log')));
assert('unsupported ext not in rejected spam', !scan.rejected.some((r) => r.file.endsWith('pic.png')));
assert('no cap truncation on small tree', scan.truncated === false);
assert('totalBytes counted', scan.totalBytes > 0);

// caps: maxFiles — contract: never exceed the cap + mark truncated.
// skippedByCaps counts valid files ENCOUNTERED after the cap (the scanner
// stops expanding further dirs once truncated — protective cutoff), so the
// assertion is on cap+flag, not total-tree accounting.
const capped = scanFolderForIngest(ROOT, { roots: [ROOT], maxFiles: 1 });
assert('maxFiles cap → truncated, files capped', capped.truncated === true && capped.files.length === 1 && capped.skippedByCaps >= 1);

// caps: bytes
const cappedBytes = scanFolderForIngest(ROOT, { roots: [ROOT], maxTotalBytes: 5 });
assert('maxTotalBytes cap → truncated', cappedBytes.truncated === true && cappedBytes.files.length <= 1);

// outside-root files rejected by guard inside scan (folder within root but
// symlink pointing out — handled by validateIngestFile realpath check)
const OUTSIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p10b-out-'));
fs.writeFileSync(path.join(OUTSIDE, 'secret.md'), 'SECRET');
fs.symlinkSync(path.join(OUTSIDE, 'secret.md'), path.join(ROOT, 'leak.md'));
const leakScan = scanFolderForIngest(ROOT, { roots: [ROOT] });
assert('symlink-escape file rejected in scan', leakScan.rejected.some((r) => r.file.endsWith('leak.md')));
assert('secret content never collected', !leakScan.files.some((f) => fs.readFileSync(f, 'utf-8').includes('SECRET')));
fs.rmSync(path.join(ROOT, 'leak.md'));

console.log('\npipeline (scan → ingest → list → search → remove):');
const emb = new HashEmbedder();
const svc = new KnowledgeService({ userDataDir: UD, projectId: 'p10b', embedder: emb, roots: [ROOT] });

// ingest ALL scanned files through the service (the IPC handler equivalent)
const reports = [];
for (const f of leakScan.files) reports.push({ filePath: f, ...(await svc.ingestWithReport(f)) });
assert('all scanned files indexed', reports.every((r) => r.status === 'indexed'));
assert('documents listed = scanned count', (await svc.listDocuments()).length === leakScan.files.length);

const stats = await svc.getStats();
assert('stats documents matches', stats.documents === leakScan.files.length);
assert('embeddingInfo: hash backend + offline', (() => {
  const info = svc.embeddingInfo();
  return info.backend === 'hash' && info.offline === true && info.dimension === 256;
})());

// retrieval across folder-ingested corpus
const hits = await svc.retrieveForPrompt('authentication notes alpha', 3);
assert('search finds folder-ingested doc', hits.results.some((r) => r.document.title === 'a.md'));
assert('citation includes source path', hits.framed.includes('a.md'));

// remove one document, verify gone
const docs = await svc.listDocuments();
const target = docs.find((d) => d.title === 'readme.txt')!;
await svc.removeDocument(target.id);
assert('remove deletes document', (await svc.listDocuments()).length === leakScan.files.length - 1);
const post = await svc.retrieveForPrompt('root readme text', 3);
assert('removed doc not retrievable', !post.results.some((r) => r.document.id === target.id));

// re-index (file changed)
fs.writeFileSync(path.join(ROOT, 'docs', 'a.md'), '# A\n\nalpha notes about authentication and SESSION EXPIRY details');
const re = await svc.ingestWithReport(path.join(ROOT, 'docs', 'a.md'));
assert('changed file re-indexed via same path', re.status === 'indexed');
const reHits = await svc.retrieveForPrompt('session expiry details', 3);
assert('new content retrievable after re-index', reHits.results.some((r) => r.document.title === 'a.md'));

console.log('\nIPC surface contract (static):');
const preloadSrc = fs.readFileSync(path.join(__dirname, '../../src/main/preload.ts'), 'utf-8');
const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main/main.ts'), 'utf-8');
for (const ch of ['knowledge-ingest-folder', 'knowledge-ingest-many', 'knowledge-remove', 'knowledge-rebuild', 'knowledge-stats', 'knowledge-list']) {
  assert(`preload bridges '${ch}'`, preloadSrc.includes(`'${ch}'`));
  assert(`main handles '${ch}'`, mainSrc.includes(`'${ch}'`));
}
assert('folder handler guards traversal (assertPathInside)', /knowledge-ingest-folder[\s\S]{0,600}assertPathInside/.test(mainSrc));
assert('folder handler uses pure scanner', /scanFolderForIngest/.test(mainSrc));
assert('dialog-open-files multi-select exists', mainSrc.includes("'dialog-open-files'") && mainSrc.includes('multiSelections'));

const scanSrc = fs.readFileSync(path.join(__dirname, '../../src/main/knowledge/folder-scan.ts'), 'utf-8');
assert('scanner: zero electron imports', !/from ['"]electron['"]/.test(scanSrc));
assert('scanner: delegates to validateIngestFile (no own rules)', /validateIngestFile/.test(scanSrc));
assert('scanner: caps configurable (not hardcoded call)', /opts\.maxFiles|DEFAULT_SCAN_MAX_FILES/.test(scanSrc));

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`P10-B RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P10-B FOLDER SCANNER + DOC MANAGEMENT: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
