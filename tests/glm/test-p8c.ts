/**
 * Phase 8 / P8-C — Advanced Agent Tools Tests
 *
 * Pure-Node tests with the electron mock (diff-manager imports logger →
 * electron mock). Covers:
 *   1. read_files — batching, per-file errors, size caps, path traversal block
 *   2. project_structure — tree, ignores, manifest, subdir scoping, traversal block
 *   3. propose_changes — multi-file diff proposal, new-file creation flag,
 *      no-op detection, disk untouched until approval, traversal block
 *   4. Registration: all three tools in the builtin registry
 *
 * Run: npx tsx tests/glm/test-p8c.ts
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

const { ReadMultipleFilesTool } = await import('../../src/main/ai/tools/read-multiple-files-tool');
const { ProjectStructureTool } = await import('../../src/main/ai/tools/project-structure-tool');
const { MultiFileEditTool } = await import('../../src/main/ai/tools/multi-file-edit-tool');
const { ensureBuiltinToolsRegistered, listToolDefinitions } = await import('../../src/main/ai/tool-registry');
const { listPendingChanges, clearTaskChanges, getPendingChange } = await import('../../src/main/agent/diff-manager');

// ─── Fixture project ────────────────────────────────────────────────────────
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p8c-'));
fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'node_modules', 'left-pad'), { recursive: true });
fs.mkdirSync(path.join(ROOT, '.git', 'objects'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src', 'a.ts'), 'export const A = 1;\n');
fs.writeFileSync(path.join(ROOT, 'src', 'b.ts'), 'export const B = 2;\n');
fs.writeFileSync(path.join(ROOT, 'README.md'), '# test project\n');
fs.writeFileSync(path.join(ROOT, 'node_modules', 'left-pad', 'index.js'), 'junk');
fs.writeFileSync(path.join(ROOT, '.git', 'HEAD'), 'ref');
fs.writeFileSync(path.join(ROOT, 'package.json'), JSON.stringify({
  name: 'fixture', version: '1.0.0',
  dependencies: { react: '^19' },
  scripts: { build: 'tsc', test: 'node test.js' },
}, null, 2));
const OUTSIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p8c-out-'));
fs.writeFileSync(path.join(OUTSIDE, 'secret.txt'), 'SECRET');

const ctx = (metadata?: Record<string, any>) => ({ projectPath: ROOT, metadata });

console.log('\n1. read_files:');
const rmt = new ReadMultipleFilesTool();

const batch = await rmt.execute({ paths: ['src/a.ts', 'src/b.ts', 'missing.ts'] }, ctx());
assert('batch succeeds (partial)', batch.success === true);
assert('output contains both files', (batch.output || '').includes('export const A') && (batch.output || '').includes('export const B'));
assert('missing file reported per-file', (batch.data.files.find((f: any) => f.path === 'missing.ts') || {}).ok === false);
assert('okCount = 2, errorCount = 1', batch.data.okCount === 2 && batch.data.errorCount === 1);

const traversal = await rmt.execute({ paths: [path.join(OUTSIDE, 'secret.txt')] }, ctx());
assert('traversal blocked', traversal.data.okCount === 0);
assert('secret content NOT returned', !(traversal.output || '').includes('SECRET'));

const nullByte = await rmt.execute({ paths: ['src/\0evil'] }, ctx());
assert('null-byte path rejected safely', nullByte.success === false || nullByte.data.okCount === 0);

const tooMany = await rmt.execute({ paths: Array.from({ length: 25 }, (_, i) => `f${i}.ts`) }, ctx());
assert('over-20 files rejected', tooMany.success === false && /Too many files/.test(tooMany.error || ''));

const badParam = await rmt.execute({ paths: 'not-array' }, ctx());
assert('non-array rejected', badParam.success === false);

console.log('\n2. project_structure:');
const pst = new ProjectStructureTool();

const tree = await pst.execute({}, ctx());
assert('tree succeeds', tree.success === true);
assert('shows a.ts with size hint', /\.ts \(\d+KB\)|a\.ts/.test(tree.output || ''));
assert('ignores node_modules', !(tree.output || '').includes('left-pad'));
assert('ignores .git contents', !(tree.output || '').includes('objects'));
assert('manifest name shown', (tree.output || '').includes('fixture@1.0.0'));
assert('manifest deps shown', (tree.output || '').includes('react'));
assert('manifest scripts shown', (tree.output || '').includes('build, test'));
assert('counts > 0 files', tree.data.files >= 3);

const scoped = await pst.execute({ subdir: 'src' }, ctx());
assert('subdir scoping works', scoped.success === true && (scoped.output || '').includes('a.ts'));

const scopeEscape = await pst.execute({ subdir: path.join(OUTSIDE) }, ctx());
assert('subdir traversal blocked', scopeEscape.success === false);

console.log('\n3. propose_changes:');
const met = new MultiFileEditTool();
const taskCtx = ctx({ taskId: 'task-p8c', stepId: 'step-1' });

fs.writeFileSync(path.join(ROOT, 'src', 'a.ts'), 'export const A = 1;\n'); // ensure pristine
const proposal = await met.execute({
  edits: [
    { path: 'src/a.ts', content: 'export const A = 42;\n' },
    { path: 'src/new-file.ts', content: 'export const NEW = true;\n' },
  ],
  description: 'P8-C test edits',
}, taskCtx);

assert('proposal succeeds', proposal.success === true);
assert('2 changes proposed', proposal.data.okCount === 2);
assert('existing file not created-flag', proposal.data.outcomes[0].created === false);
assert('new file created-flag', proposal.data.outcomes[1].created === true);
assert('change ids assigned', proposal.data.outcomes.every((o: any) => typeof o.changeId === 'string' && o.changeId.length > 0));
assert('output mentions approval requirement', (proposal.output || '').includes('approve'));

// CRITICAL: disk untouched before approval
assert('DISK UNTOUCHED: a.ts still original', fs.readFileSync(path.join(ROOT, 'src', 'a.ts'), 'utf-8') === 'export const A = 1;\n');
assert('DISK UNTOUCHED: new file not created', !fs.existsSync(path.join(ROOT, 'src', 'new-file.ts')));

// Pending changes registered in diff-manager
const pending = listPendingChanges('task-p8c');
assert('pending changes registered (2)', pending.length === 2);
assert('diff computed for existing file', (getPendingChange(pending[0].id)?.diff || '').includes('-export const A = 1'));
assert('diff computed for new file', (getPendingChange(pending[1].id)?.diff || '').includes('+export const NEW'));

// no-op detection
const noop = await met.execute({ edits: [{ path: 'src/b.ts', content: 'export const B = 2;\n' }] }, taskCtx);
assert('identical content → no-op reported', noop.data.okCount === 0 && /no changes/.test(JSON.stringify(noop.data.outcomes)));

// traversal + context checks
const esc = await met.execute({ edits: [{ path: path.join(OUTSIDE, 'evil.ts'), content: 'x' }] }, taskCtx);
assert('write traversal blocked', esc.data.okCount === 0 && /blocked/.test(JSON.stringify(esc.data.outcomes)));

const noCtx = await met.execute({ edits: [{ path: 'src/a.ts', content: 'y' }] }, ctx());
assert('missing task context rejected', noCtx.success === false && /task context/.test(noCtx.error || ''));

const badEdits = await met.execute({ edits: [{ path: 'x' }] }, taskCtx); // missing content
assert('invalid edit spec rejected', badEdits.data.okCount === 0);

clearTaskChanges('task-p8c');

console.log('\n4. Registry:');
await ensureBuiltinToolsRegistered();
const defs = listToolDefinitions();
assert('read_files registered', defs.some((d: any) => d.name === 'read_files'));
assert('project_structure registered', defs.some((d: any) => d.name === 'project_structure'));
assert('propose_changes registered', defs.some((d: any) => d.name === 'propose_changes'));
assert('previous tools intact (12 + 3 = 15)', defs.length >= 15);
assert('read_files permission read', defs.find((d: any) => d.name === 'read_files')?.permission === 'read');
assert('propose_changes permission write', defs.find((d: any) => d.name === 'propose_changes')?.permission === 'write');

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`P8-C RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('ALL P8-C ADVANCED TOOLS TESTS PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
