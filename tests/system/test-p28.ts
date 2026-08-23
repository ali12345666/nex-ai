/**
 * Phase 28 / P28 — Terminal + Filesystem Services Tests
 *
 * Tests real service behavior over temp directories.
 *
 * Run: npx tsx tests/system/test-p28.ts
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

// ─── FilesystemService ───────────────────────────────────────────────────────
console.log('\n1) FilesystemService:');
const { FilesystemService } = await import('../../src/main/services/filesystem-service');
const svc = new FilesystemService();

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'p28-'));
fs.mkdirSync(path.join(ROOT, 'src', 'components'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'node_modules'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src', 'App.tsx'), 'export const App = 1;');
fs.writeFileSync(path.join(ROOT, 'src', 'components', 'Button.tsx'), 'export const Button = 2;');
fs.writeFileSync(path.join(ROOT, 'package.json'), '{"name":"test"}');
fs.writeFileSync(path.join(ROOT, '.hidden'), 'hidden');

svc.setWorkspace(ROOT);

// readdir
const dir = svc.readDirectory(ROOT);
assert('readdir lists entries', dir.entries.length >= 3);
assert('dirs sorted first', dir.entries[0].isDirectory);
assert('hidden files excluded by default', !dir.entries.some((e) => e.name === '.hidden'));
const dirHidden = svc.readDirectory(ROOT, true);
assert('hidden files shown when requested', dirHidden.entries.some((e) => e.name === '.hidden'));

// readFile
const file = svc.readFile(path.join(ROOT, 'src', 'App.tsx'));
assert('readFile works', file.ok && file.content === 'export const App = 1;');
const binary = svc.readFile(path.join(ROOT, '..', '..', '..'));
assert('readFile rejects directories', !binary.ok);
const nonexistent = svc.readFile(path.join(ROOT, 'nope.ts'));
assert('readFile handles missing files', !nonexistent.ok);

// writeFile + createFile + createDirectory
assert('createFile works', svc.createFile(path.join(ROOT, 'src'), 'new-file.ts', '// hi').ok);
assert('createFile rejects existing', !svc.createFile(path.join(ROOT, 'src'), 'App.tsx').ok);
assert('createDirectory works', svc.createDirectory(path.join(ROOT, 'src'), 'new-dir').ok);
assert('writeFile works', svc.writeFile(path.join(ROOT, 'src', 'new-file.ts'), '// updated').ok);

// rename + delete
assert('rename works', svc.rename(path.join(ROOT, 'src', 'new-file.ts'), path.join(ROOT, 'src', 'renamed.ts')).ok);
assert('delete file works', svc.delete(path.join(ROOT, 'src', 'renamed.ts')).ok);
assert('delete directory works', svc.delete(path.join(ROOT, 'src', 'new-dir')).ok);

// search
const results = svc.search('App');
assert('search finds App.tsx', results.some((r) => r.name === 'App.tsx'));
const results2 = svc.search('Button');
assert('search finds nested Button.tsx', results2.some((r) => r.name === 'Button.tsx'));
const results3 = svc.search('zzz-nonexistent');
assert('search empty for no match', results3.length === 0);

// workspace jail
const outsideAttempt = svc.readFile('/etc/passwd');
assert('workspace jail blocks outside reads', !outsideAttempt.ok || outsideAttempt.content === undefined);

// traversal
const traversal = svc.readFile(path.join(ROOT, '..', 'outside.txt'));
assert('path traversal blocked', !traversal.ok || traversal.content === undefined);

// ─── TerminalService ─────────────────────────────────────────────────────────
console.log('\n2) TerminalService:');
const { TerminalService } = await import('../../src/main/services/terminal-service');
const ts = new TerminalService();

// Spawn a quick command (echo)
const session = ts.spawnSession(ROOT);
assert('session spawned', session.state === 'running');
assert('session has id', session.id.startsWith('term-'));

// Write a command
assert('write succeeds', ts.write(session.id, 'echo "hello nex"\n'));

// Wait for output
await new Promise((r) => setTimeout(r, 500));
const sessionInfo = ts.getSession(session.id);
assert('session still running', sessionInfo?.state === 'running');
assert('session cwd correct', sessionInfo?.cwd === ROOT);

// List
assert('listSessions shows session', ts.listSessions().length >= 1);

// Kill
assert('killSession works', ts.killSession(session.id));
await new Promise((r) => setTimeout(r, 200));
assert('session cleaned up', ts.getSession(session.id) === null);

// killAll
const s1 = ts.spawnSession(ROOT);
const s2 = ts.spawnSession(ROOT);
ts.killAll();
await new Promise((r) => setTimeout(r, 200));
assert('killAll cleans all sessions', ts.listSessions().length === 0);

// ─── IPC Contract (static) ──────────────────────────────────────────────────
console.log('\n3) IPC contract:');
const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');
const mainSrc = read('../../src/main/main.ts');
const handlers = [
  'terminal-session-spawn', 'terminal-session-write', 'terminal-session-signal',
  'terminal-session-kill', 'terminal-session-list',
  'fs-set-workspace', 'fs-service-readdir', 'fs-service-readfile',
  'fs-service-writefile', 'fs-service-create', 'fs-service-rename',
  'fs-service-delete', 'fs-service-search',
];
for (const h of handlers) {
  assert(`handler '${h}' registered`, mainSrc.includes(`'${h}'`));
}

// Payload validation
assert('terminal write validates types', /typeof sessionId !== 'string'/.test(mainSrc));
assert('signal validates against allowlist', /validSignals\.includes/.test(mainSrc));

// Cleanup on quit
assert('before-quit kills all sessions', /before-quit[\s\S]{0,200}terminalService\.killAll/.test(mainSrc));

// Preload bridges
const pre = read('../../src/main/preload.ts');
for (const bridge of ['terminalSessionSpawn', 'terminalSessionWrite', 'terminalSessionKill',
  'fsServiceReaddir', 'fsServiceReadfile', 'fsServiceSearch', 'fsSetWorkspace']) {
  assert(`preload bridges ${bridge}`, pre.includes(bridge));
}

// Security: no direct fs in renderer components
const explorerSrc = read('../../src/renderer/components/layout/WorkspaceExplorer.tsx');
const terminalSrc = read('../../src/renderer/components/layout/TerminalSessionPanel.tsx');
assert('explorer: no direct fs', !/require\('fs'\)|from ['"]fs['"]/.test(explorerSrc));
assert('terminal: no direct child_process', !/child_process/.test(terminalSrc));

console.log('\n══════════════════════════════════════');
console.log(`P28 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P28 TERMINAL + FILESYSTEM: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
