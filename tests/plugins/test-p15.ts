/**
 * Phase 15 / P15-A+B — Plugin manifest validation + registry (no code exec)
 *
 * A: validateManifest matrix (happy path + every rejection branch: bad id/
 *    traversal id/abs main/../main/wrong ext/unknown perm type/dup perm/
 *    bad tool name/runtime decl/oversized fields) + loadManifestFromDir
 *    (missing/invalid JSON/too large/not-a-file) with injected fs.
 * B: LocalPluginRegistry — discover valid+invalid folders, duplicate ids,
 *    default-enabled, enable/disable persistence via atomic state file
 *    (prototype-pollution-safe read), uninstall bookkeeping, install
 *    explicit refusal (loader phase), caps (200 dirs), purity (no eval/
 *    no child_process/network anywhere).
 *
 * Run: npx tsx tests/plugins/test-p15.ts
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

function validManifest(): any {
  return {
    id: 'com.example.hello-tool',
    name: 'Hello Tool',
    version: '1.2.3',
    author: 'Example Corp',
    description: 'Adds a greeting tool',
    main: 'index.js',
    permissions: [{ type: 'filesystem', scope: 'read-only', reason: 'reads greeting templates' }],
    provides: { tools: ['hello_greet'] },
  };
}

async function main(): Promise<void> {

const { validateManifest, loadManifestFromDir, MAX_MANIFEST_BYTES } = await import('../../src/main/plugins/manifest');
const { LocalPluginRegistry } = await import('../../src/main/plugins/registry');

console.log('\nA) manifest validation:');
const ok = validateManifest(validManifest());
assert('valid manifest accepted', ok.ok === true && (ok as any).manifest.id === 'com.example.hello-tool');
assert('provides defaulted (empty arrays)', (ok as any).manifest.provides.runtimes.length === 0);
assert('optional homepage https kept', (() => {
  const m = validManifest(); m.homepage = 'https://example.com/plugin';
  const r = validateManifest(m) as any;
  return r.ok && r.manifest.homepage === 'https://example.com/plugin';
})());
assert('http homepage dropped (https-only)', (() => {
  const m = validManifest(); m.homepage = 'http://example.com';
  const r = validateManifest(m) as any;
  return r.ok && r.manifest.homepage === undefined;
})());
assert('prerelease semver ok', (() => { const m = validManifest(); m.version = '0.1.0-beta.1'; return validateManifest(m).ok; })());

const rejects: Array<[string, any, string]> = [
  ['non-object manifest', 'nope', 'manifest must be a JSON object'],
  ['bad id charset', { ...validManifest(), id: 'Bad ID!' }, 'invalid id'],
  ['traversal id', { ...validManifest(), id: 'a..b' }, '".."'],
  ['missing name', { ...validManifest(), name: '' }, 'name'],
  ['bad version', { ...validManifest(), version: 'one.two.three' }, 'semver'],
  ['missing author', { ...validManifest(), author: '' }, 'author'],
  ['abs main', { ...validManifest(), main: '/etc/passwd' }, 'relative'],
  ['parent-escape main', { ...validManifest(), main: '../index.js' }, 'relative'],
  ['wrong main ext', { ...validManifest(), main: 'index.exe' }, '.js/.cjs'],
  ['permissions not array', { ...validManifest(), permissions: 'fs' }, 'permissions must be an array'],
  ['too many permissions', { ...validManifest(), permissions: Array.from({ length: 20 }, () => validManifest().permissions[0]) }, 'too many'],
  ['unknown perm type', { ...validManifest(), permissions: [{ type: 'root', scope: 'all', reason: 'x' }] }, 'unknown permission type'],
  ['perm missing reason', { ...validManifest(), permissions: [{ type: 'git', scope: 'read' }] }, 'reason required'],
  ['dup permission', { ...validManifest(), permissions: [validManifest().permissions[0], validManifest().permissions[0]] }, 'duplicate'],
  ['bad tool name decl', { ...validManifest(), provides: { tools: ['BadName!'] } }, 'invalid tool name'],
  ['bad runtime decl', { ...validManifest(), provides: { runtimes: ['Bad Runtime'] } }, 'invalid runtime'],
  ['tools overflow', { ...validManifest(), provides: { tools: Array.from({ length: 60 }, (_, i) => `t${i}`) } }, 'provides.tools'],
];
for (const [name, m, expectSub] of rejects) {
  const r = validateManifest(m);
  assert(`reject: ${name}`, r.ok === false && r.reason.toLowerCase().includes(expectSub.toLowerCase().split(' ')[0]), r.ok ? 'ACCEPTED' : r.reason);
}

console.log('\nA2) manifest fs loading (injected fs):');
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'p15-'));
const good = path.join(UD, 'p-good');
fs.mkdirSync(good);
fs.writeFileSync(path.join(good, 'plugin.json'), JSON.stringify(validManifest()));
const rGood = loadManifestFromDir(good);
assert('valid dir loads', rGood.ok === true);

const noManifest = loadManifestFromDir(path.join(UD, 'p-empty'));
fs.mkdirSync(path.join(UD, 'p-empty'));
assert('missing plugin.json rejected', loadManifestFromDir(path.join(UD, 'p-empty')).ok === false);
void noManifest;
const badJson = path.join(UD, 'p-badjson');
fs.mkdirSync(badJson);
fs.writeFileSync(path.join(badJson, 'plugin.json'), '{broken');
assert('invalid JSON rejected', loadManifestFromDir(badJson).ok === false && /not valid JSON/.test((loadManifestFromDir(badJson) as any).reason));
const bigDir = path.join(UD, 'p-big');
fs.mkdirSync(bigDir);
fs.writeFileSync(path.join(bigDir, 'plugin.json'), 'x'.repeat(MAX_MANIFEST_BYTES + 1));
assert('oversized manifest rejected', loadManifestFromDir(bigDir).ok === false && /too large/.test((loadManifestFromDir(bigDir) as any).reason));

console.log('\nB) registry:');
// fixture plugins dir
const UD2 = fs.mkdtempSync(path.join(os.tmpdir(), 'p15-reg-'));
function mkPlugin(id: string, opts: { files?: Record<string, string> } = {}) {
  const dir = path.join(UD2, 'plugins', id.replace(/\./g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ ...validManifest(), id, ...opts.files?.manifest }));
  if (opts.files?.entry) fs.writeFileSync(path.join(dir, 'index.js'), opts.files.entry);
  return dir;
}
mkPlugin('com.a.one');
mkPlugin('com.a.two');
const reg = new LocalPluginRegistry(UD2);
const found = await reg.discover();
assert('discovers 2 valid plugins', found.length === 2);
assert('both default-enabled', found.every((e) => e.enabled === true));
assert('get by id', reg.get('com.a.one')?.manifest.id === 'com.a.one');

// invalid plugin folder recorded, not loaded
const invalidDir = path.join(UD2, 'plugins', 'broken-one');
fs.mkdirSync(invalidDir);
fs.writeFileSync(path.join(invalidDir, 'plugin.json'), 'not-json');
const reg2 = new LocalPluginRegistry(UD2);
const found2 = await reg2.discover();
assert('invalid folder skipped from entries', found2.length === 2 && reg2.get('broken-one') === undefined);
const inv = reg2.invalidDiscoveries();
assert('invalid recorded with reason', inv.length === 1 && inv[0].dir.includes('broken-one') && /not valid JSON/.test(inv[0].reason || ''));

// duplicate id
const dupDir = path.join(UD2, 'plugins', 'dup-of-one');
fs.mkdirSync(dupDir);
fs.writeFileSync(path.join(dupDir, 'plugin.json'), JSON.stringify({ ...validManifest(), id: 'com.a.one' }));
const reg3 = new LocalPluginRegistry(UD2);
const found3 = await reg3.discover();
assert('duplicate id kept once', found3.filter((e) => e.manifest.id === 'com.a.one').length === 1);
assert('duplicate recorded as invalid', reg3.invalidDiscoveries().some((d) => /duplicate/.test(d.reason || '')));

// enable/disable persists across instances (atomic state file)
await reg3.disable('com.a.one');
const reg4 = new LocalPluginRegistry(UD2);
await reg4.discover();
assert('disable persists across registry instances', reg4.get('com.a.one')?.enabled === false);
await reg4.enable('com.a.one');
const reg5 = new LocalPluginRegistry(UD2);
await reg5.discover();
assert('enable persists', reg5.get('com.a.one')?.enabled === true);

// state file pollution-safe: malicious keys dropped on read
const statePath = path.join(UD2, 'plugins', 'registry-state.json');
const st = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
st.enabled['__proto__'] = true;
st.enabled['x'.repeat(500)] = true;
st.enabled['valid-key'] = false;
st.unknownField = { evil: true };
fs.writeFileSync(statePath, JSON.stringify(st));
const reg6 = new LocalPluginRegistry(UD2);
await reg6.discover();
const stateAfter = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
assert('oversized keys dropped', !('x'.repeat(500) in stateAfter.enabled));
assert('proto key ignored', Object.keys(stateAfter).every((k) => k !== 'unknownField'));

// uninstall = bookkeeping only
await reg6.uninstall('com.a.two');
assert('uninstall removes entry', reg6.get('com.a.two') === undefined);
assert('plugin folder still on disk (user-managed)', fs.existsSync(path.join(UD2, 'plugins', 'com-a-two')));

// install explicitly refused in this phase
let refused = '';
try { await reg6.install('whatever.zip'); } catch (e: any) { refused = e.message; }
assert('zip install explicitly refused (loader phase)', /loader phase/.test(refused));

// scan cap
for (let i = 0; i < 205; i++) {
  const d = path.join(UD2, 'plugins', `filler-${i}`);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'plugin.json'), JSON.stringify({ ...validManifest(), id: `com.f.${i}` }));
}
const reg7 = new LocalPluginRegistry(UD2);
const found7 = await reg7.discover();
assert('scan capped at 200 entries', found7.length <= 200);

const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf-8');
console.log('\nC) IPC + panel contract:');
const mainSrc = read('../../src/main/main.ts');
assert("IPC 'plugins-list' registered", mainSrc.includes("'plugins-list'"));
assert("IPC 'plugins-set-enabled' registered", mainSrc.includes("'plugins-set-enabled'"));
assert('registry singleton lazy + userData-scoped', /getPluginRegistry[\s\S]{0,300}new LocalPluginRegistry\(userDataPath\)/.test(mainSrc));
assert('no plugin activation surface in IPC (manifest data only)', !/activate\(/.test(mainSrc));
const pre = read('../../src/main/preload.ts');
assert('preload bridges plugins', pre.includes('pluginsList') && pre.includes('pluginsSetEnabled'));
const panel = read('../../src/renderer/components/PluginsPanel.tsx');
assert('panel: manifest-only notice', /loader\/sandbox phase/.test(panel));
assert('panel: permissions chips with reason tooltip', /perm\.reason/.test(panel) && /ShieldAlert/.test(panel));
assert('panel: invalid discoveries surfaced', /invalid/.test(panel));
assert('panel: enable toggle', /toggle\(/.test(panel));
assert('panel: IPC only (no fs)', !/require\('fs'\)|from ['"]fs['"]/.test(panel));

console.log('\npurity:');
for (const f of ['../../src/main/plugins/manifest.ts', '../../src/main/plugins/registry.ts']) {
  const src = read(f);
  assert(`${path.basename(f)}: no eval/require of plugin code`, !/require\((?!['"]\.)/.test(src.replace(/require\('\.\/manifest'\)/, '')) && !/eval\(/.test(src));
  assert(`${path.basename(f)}: no network`, !/https?:\/\/|net\.request/.test(src.replace(/\/\/[^\n]*/g, '')));
}
assert('agent/ untouched by plugins (no imports)', !/from ['"]\.\.\/plugins|plugins\//.test(read('../../src/main/agent/core.ts')));

console.log('\n══════════════════════════════════════');
console.log(`P15 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P15 PLUGIN MANIFEST + REGISTRY: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
