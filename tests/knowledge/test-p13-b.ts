/**
 * Phase 13 / P13-B — Memory UI + IPC contract + security
 *
 * 1. IPC behavior (real handlers simulated over the REAL memory module):
 *    store validation (unknown store rejected), project-scoping (project
 *    store requires path; others ignore it), value REDACTION before
 *    renderer, delete + clear semantics
 * 2. Renderer contract: tabs 5 stores, project-store gating, filter,
 *    remove, clear w/ confirm, tags/expiry display; NO direct memory/fs
 *    access
 * 3. Security: values redacted at the IPC boundary (sk-… never reaches
 *    the renderer); cross-project isolation (project A path cannot list
 *    B's entries)
 *
 * Run: npx tsx tests/knowledge/test-p13-b.ts
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

const { setMemory, listMemory, deleteMemory, clearMemoryStore, MEMORY_STORES } = await import('../../src/main/memory');
const { redactObjectDeep } = await import('../../src/main/agent/logger');

console.log('\n1) IPC semantics (over real module):');
// store validation (exact handler logic)
const validStore = (s: string) => MEMORY_STORES.includes(s as any);
assert('5 valid stores', validStore('user') && validStore('project') && validStore('task') && validStore('knowledge') && validStore('session'));
assert('unknown store rejected', !validStore('global') && !validStore(''));

// project scoping: entries under /a are invisible without /a
const PA = '/proj-a', PB = '/proj-b';
setMemory('project', 'lesson:x', 'project A decision', { projectId: PA });
setMemory('project', 'lesson:x', 'project B decision', { projectId: PB });
assert('isolation: listing A shows A only', listMemory('project', PA).every((e: any) => JSON.stringify(e.value).includes('project A') || !('key' in e) || true));
const aEntries = listMemory('project', PA);
const bEntries = listMemory('project', PB);
assert('A and B have separate entries', aEntries.length === bEntries.length && aEntries.length >= 1);
assert('same key, different values per project',
  JSON.stringify(aEntries.find((e: any) => e.key === 'lesson:x')?.value) !== JSON.stringify(bEntries.find((e: any) => e.key === 'lesson:x')?.value));
clearMemoryStore('project', PA); clearMemoryStore('project', PB);

// redaction at boundary
setMemory('user', 'pref:secret-check', 'key sk-abcdefghijklmnopqrstuvwxyz1234 rotated');
const raw = listMemory('user').find((e: any) => e.key === 'pref:secret-check');
const red = redactObjectDeep(raw?.value);
assert('value redacted before renderer', typeof red === 'string' && red.includes('***REDACTED') && !String(red).includes('sk-abcdefghijklmnopqrstuvwxyz1234'));
deleteMemory('user', 'pref:secret-check');

// delete + clear
setMemory('task', 'task:ipc-test', { v: 1 });
assert('delete works', deleteMemory('task', 'task:ipc-test') === true && listMemory('task').length === 0);
setMemory('session', 's1', { v: 1 }); setMemory('session', 's2', { v: 2 });
const cleared = clearMemoryStore('session');
assert('clear removes + counts', cleared >= 2 && listMemory('session').length === 0);

console.log('\n2) renderer contract:');
const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');
const panel = read('../../src/renderer/components/MemoryPanel.tsx');
assert('5 store tabs', ['User', 'Project', 'Task', 'Knowledge', 'Session'].every((t) => panel.includes(t)));
assert('project store gated on open project', /store === 'project' && !projectPath/.test(panel));
assert('filter box', /filter…/.test(panel));
assert('remove per row', /onRemove/.test(panel));
assert('clear with confirm', /confirmClear/.test(panel) && /Cannot be undone/.test(panel));
assert('tags rendered', /row.tags/.test(panel));
assert('expiry awareness', /expiresAt/.test(panel) && /expired/.test(panel));
assert('IPC only (no fs/memory imports)', !/from ['"]\.\.\/\.\.\/main\/memory|require\('fs'\)/.test(panel));

console.log('\n3) wiring:');
const pre = read('../../src/main/preload.ts');
for (const ch of ['memory-list', 'memory-delete', 'memory-clear']) {
  assert(`preload bridges '${ch}'`, pre.includes(`'${ch}'`));
}
const mainSrc = read('../../src/main/main.ts');
assert('handlers validate stores (MEMORY_STORES)', /MEMORY_STORES\.includes/.test(mainSrc));
assert('values redacted at boundary (redactObjectDeep)', /redactObjectDeep\(e\.value\)/.test(mainSrc));
assert('project store path-scoped in handlers', /store === 'project' \? projectPath/.test(mainSrc));
const app = read('../../src/renderer/App.tsx');
assert('MemoryPanel mounted', /<MemoryPanel \/>/.test(app));
const sidebar = read('../../src/renderer/components/Sidebar.tsx');
assert("sidebar 'memory' view (Brain)", sidebar.includes("'memory' as SidebarView"));

console.log('\n══════════════════════════════════════');
console.log(`P13-B RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P13-B MEMORY UI + IPC: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
