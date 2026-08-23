/**
 * Phase 16 / P16 — Plugin Sandbox + Loader
 *
 * A (sandbox):
 *  - capability gates: undeclared permission use → audible denial
 *  - fs jailed to pluginDir (traversal blocked)
 *  - net permanently refused (local-first)
 *  - timers capped; source size cap; entry-escape rejection
 *  - fresh vm context (no process/require/globalThis)
 * B (loader):
 *  - valid plugin activates + tools registered namespaced
 *  - escalation guard: admin tool w/o admin permission → downgraded
 *  - broken exports / activate throw / timeout → failed (never crash)
 *  - disabled → skipped; deactivateAll best-effort
 *
 * Run: npx tsx tests/plugins/test-p16.ts
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

function manifest(over: any = {}) {
  return {
    id: 'com.test.demo', name: 'Demo', version: '1.0.0', author: 't', description: 'd',
    main: 'index.js',
    permissions: [{ type: 'filesystem', scope: 'read-only', reason: 'reads own files' }],
    provides: { tools: ['demo_tool'] },
    ...over,
  } as any;
}

async function main(): Promise<void> {

const { createPluginSandbox, MAX_PLUGIN_SOURCE_BYTES } = await import('../../src/main/plugins/sandbox');
const { PluginLoader } = await import('../../src/main/plugins/loader');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'p16-'));

console.log('\nA) sandbox:');
// happy module export + capability use
const sb = createPluginSandbox({ pluginDir: ROOT, manifest: manifest() });
const goodSrc = `
module.exports = {
  activate: async (ctx) => { ctx.log('info', 'activated'); },
  deactivate: async () => {},
  getTools: () => [],
};
`;
const r1 = sb.runModule(goodSrc, path.join(ROOT, 'index.js'));
assert('module loads + exports Plugin contract', r1.ok === true && typeof (r1 as any).exports.activate === 'function');

// no Plugin contract
const r2 = sb.runModule('module.exports = {};', path.join(ROOT, 'x.js'));
assert('non-plugin exports still run (loader validates)', r2.ok === true);

// entry outside plugin dir
const r3 = sb.runModule('1;', '/etc/evil.js');
assert('entry escape rejected', r3.ok === false && /escapes/.test((r3 as any).error));

// oversized source
const r4 = sb.runModule('//' + 'x'.repeat(MAX_PLUGIN_SOURCE_BYTES + 10), path.join(ROOT, 'big.js'));
assert('oversized source rejected', r4.ok === false && /too large/.test((r4 as any).error));

// undeclared permission → audible denial (network undeclared here)
const sbNet = createPluginSandbox({ pluginDir: ROOT, manifest: manifest() });
let deniedMsg = '';
try { sbNet.runModule('nex.net.fetch("x");', path.join(ROOT, 'n.js')); } catch { /* inside vm */ }
// The denial event lands via the gate proxy — invoke through a module that touches it:
const r5 = sbNet.runModule(`
try { nex.net.fetch('http://x'); module.exports = { touched: true }; }
catch (e) { module.exports = { err: e.message } }
`, path.join(ROOT, 'n.js'));
assert('net access throws INSIDE sandbox (no throw out)', r5.ok === true);
assert('net denial event recorded', sbNet.events.some((e) => e.kind === 'capability-denied' && /network/.test(e.detail)));

// declared fs works + jailed
fs.writeFileSync(path.join(ROOT, 'data.txt'), 'plugin-data');
const sbFs = createPluginSandbox({ pluginDir: ROOT, manifest: manifest() });
const r6 = sbFs.runModule(`module.exports = { content: nex.fs.readFile('data.txt') };`, path.join(ROOT, 'f.js'));
assert('declared fs read works', r6.ok === true && (r6 as any).exports.content === 'plugin-data');
const sbFs2 = createPluginSandbox({ pluginDir: ROOT, manifest: manifest() });
const r7 = sbFs2.runModule(`module.exports = { ok: true };
try { nex.fs.readFile('../../outside.txt'); } catch (e) { module.exports = { blocked: e.message } }
`, path.join(ROOT, 'f2.js'));
assert('fs traversal blocked inside jail', r7.ok === true && /Blocked/.test((r7 as any).exports.blocked || ''));

// fs undeclared → denial
const sbNoPerm = createPluginSandbox({ pluginDir: ROOT, manifest: manifest({ permissions: [] }) });
const r8 = sbNoPerm.runModule(`try { nex.fs.readFile('data.txt'); module.exports={}; } catch (e) { module.exports = { d: e.message } }`, path.join(ROOT, 'f3.js'));
assert('fs without permission denied', r8.ok === true && sbNoPerm.events.some((e) => e.kind === 'capability-denied'));

// process/require absent
const r9 = sb.runModule(`
module.exports = {
  hasProcess: typeof process !== 'undefined',
  hasRequire: typeof require !== 'undefined',
};
`, path.join(ROOT, 'p.js'));
assert('no process in sandbox', (r9 as any).exports.hasProcess === false);
assert('no require in sandbox', (r9 as any).exports.hasRequire === false);

console.log('\nB) loader:');
function mkPluginDir(name: string, source: string, m: any = manifest()) {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ ...m, ...{ main: m.main || 'index.js' } }));
  fs.writeFileSync(path.join(dir, m.main || 'index.js'), source);
  return { dir, pluginDir: dir, manifest: { ...m }, enabled: true } as any;
}
const registered: any[] = [];
const sink = { registerTool: (t: any) => registered.push(t) };
const events: any[] = [];
const loader = new PluginLoader({ toolRegistry: sink, onEvent: (e) => events.push(e) });

// good plugin with a tool
const good = mkPluginDir('good', `
module.exports = {
  manifest: { id: 'com.test.demo', version: '1.0.0' },
  activate: async (ctx) => {},
  deactivate: async () => {},
  getTools: () => [{
    definition: { name: 'demo_tool', description: 'demo', category: 'plugin', permission: 'read', parameters: [] },
    execute: async () => ({ success: true, output: 'hi' }),
  }],
};
`);
const lg = await loader.load(good);
assert('good plugin activated', lg.status === 'activated');
assert('tool registered namespaced', lg.tools[0].startsWith('plugin_com.test.demo_'.replace(/[^a-z0-9_]/gi, '_')) || lg.tools[0].startsWith('plugin_com_test_demo_'));
assert('sink received wrapped tool', registered.length === 1 && registered[0].definition.permission === 'read');

// admin escalation blocked (no admin permission)
registered.length = 0;
const admin = mkPluginDir('admin', `
module.exports = {
  activate: async () => {},
  getTools: () => [{ definition: { name: 'root_tool', description: 'x', category: 'plugin', permission: 'admin', parameters: [] }, execute: async () => ({ success: true }) }],
};
`);
const la = await loader.load(admin);
assert('admin tool downgraded without admin permission', registered.length === 1 && registered[0].definition.permission === 'write');

// broken plugin (no activate)
const broken = mkPluginDir('broken', 'module.exports = { foo: 1 };');
const lb = await loader.load(broken);
assert('non-plugin exports → failed with reason', lb.status === 'failed' && /activate/.test(lb.reason || ''));

// activate throws
const thr = mkPluginDir('throw', 'module.exports = { activate: async () => { throw new Error("boom"); } };');
const lt = await loader.load(thr);
assert('activate() throw → failed (host safe)', lt.status === 'failed' && /boom/.test(lt.reason || ''));

// disabled → skipped
const dis = mkPluginDir('dis', 'module.exports = { activate: async () => {} };');
const ld = await loader.load({ ...dis, enabled: false });
assert('disabled plugin skipped', ld.status === 'skipped');

// deactivateAll runs cleanly
await loader.deactivateAll();
assert('deactivateAll empties loaded set', loader.listLoaded().length === 0);

console.log('\n══════════════════════════════════════');
console.log(`P16 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P16 SANDBOX + LOADER: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
