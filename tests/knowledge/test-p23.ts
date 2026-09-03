/**
 * Phase 23 / P23 — Knowledge maintenance UI (last unbridged preload APIs)
 *
 * Sweep found knowledgePurgeMissing + knowledgeClear had ZERO renderer
 * consumers (backend-only since P10). Now wired:
 *   - Purge Deleted button (honest outcome, refresh)
 *   - Clear All… with two-step confirm (destructive op)
 *   - IPC behavioral: purge removes stale entries only; clear wipes only
 *     the target project (isolation re-pinned)
 *
 * Run: npx tsx tests/knowledge/test-p23.ts
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

console.log('\nIPC behavioral (service behind the buttons):');
const { HashEmbedder } = await import('../../src/main/knowledge/hash-embedder');
const { KnowledgeService } = await import('../../src/main/knowledge/knowledge-service');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'p23-'));
const ROOT_B = fs.mkdtempSync(path.join(os.tmpdir(), 'p23b-'));
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'p23-ud-'));

const svc = new KnowledgeService({ userDataDir: UD, projectId: 'p23a', embedder: new HashEmbedder(), roots: [ROOT] });
const svcB = new KnowledgeService({ userDataDir: UD, projectId: 'p23b', embedder: new HashEmbedder(), roots: [ROOT_B] });
fs.writeFileSync(path.join(ROOT, 'keep.md'), '# Keep\n\nrotating deploy keys content');
fs.writeFileSync(path.join(ROOT, 'gone.md'), '# Gone\n\nwill be deleted then purged');
fs.writeFileSync(path.join(ROOT_B, 'b-doc.md'), '# B\n\nother project');
await svc.ingestWithReport(path.join(ROOT, 'keep.md'));
await svc.ingestWithReport(path.join(ROOT, 'gone.md'));
await svcB.ingestWithReport(path.join(ROOT_B, 'b-doc.md'));

// purge: delete file first, then purge via the same IPC handler semantics
fs.rmSync(path.join(ROOT, 'gone.md'));
const purged = await svc.purgeMissing();
assert('purge removed exactly the stale doc', purged.length === 1);
assert('survivor still retrievable', (await svc.retrieveForPrompt('rotating deploy keys', 2)).results.some((r: any) => r.document.title === 'keep.md'));
const purgedAgain = await svc.purgeMissing();
assert('second purge is a no-op', purgedAgain.length === 0);

// clear: wipes ONLY this project (isolation contract re-pinned)
await svc.clearProject();
assert('clear empties target project', (await svc.listDocuments()).length === 0 && (await svc.getStats()).documents === 0);
assert('other project untouched (isolation)', (await svcB.listDocuments()).length === 1);

console.log('\nUI contract:');
const panel = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/KnowledgePanel.tsx'), 'utf-8');
assert('Purge Deleted button wired', /knowledgePurgeMissing\(projectPath\)/.test(panel) && /Purge Deleted/.test(panel));
assert('Clear All has two-step confirm', /confirmClear/.test(panel) && /Cannot be undone/.test(panel));
assert('clear calls IPC then refresh', /knowledgeClear\(projectPath\)/.test(panel));
assert('destructive style (red)', /border-red-500/.test(panel));
assert('buttons disabled while busy', /disabled=\{busy/.test(panel));

console.log('\nNo unbridged preload APIs remain:');
// TEST BUG (documented): original scan covered only components/*.tsx +
// App.tsx; bridges are ALSO consumed from store/useStore.ts and nested
// component dirs. Scan the ENTIRE renderer tree.
const pre = fs.readFileSync(path.join(__dirname, '../../src/main/preload.ts'), 'utf-8');
const apis = [...pre.matchAll(/(\w+):\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\('([a-z-]+)'/g)].map((m) => m[1]);
const rendererSrc = fs.readdirSync(path.join(__dirname, '../../src/renderer'), { recursive: true })
  .filter((f: any) => String(f).endsWith('.ts') || String(f).endsWith('.tsx'))
  .map((f: any) => fs.readFileSync(path.join(__dirname, '../../src/renderer', String(f)), 'utf-8'))
  .join('\n');
const unused = apis.filter((a) => !new RegExp(`\\b${a}\\b`).test(rendererSrc));
assert('every invoke-bridge has a renderer consumer (whole tree)', unused.length === 0, unused.join(','));

console.log('\n══════════════════════════════════════');
console.log(`P23 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P23 KNOWLEDGE MAINTENANCE UI: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
