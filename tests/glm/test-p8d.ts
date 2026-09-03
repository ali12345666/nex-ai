/**
 * Phase 8 / P8-D — Windows 10/11 Readiness Tests
 *
 * This sandbox is Linux, so Windows verification is done in two layers:
 *   1. UNIT (real): resolveCommandForPlatform + isShellSafeArg with injected
 *      platform — proves the .cmd shim path and the injection guard.
 *   2. STATIC AUDIT (real): scan the Phase 8 surface (and key main-process
 *      files) for Windows landmines:
 *        - path construction via '/' concatenation (should use path.join)
 *        - hardcoded 'bash'/'/bin/' assumptions
 *        - llama.cpp binary handling (node-llama-cpp = cross-platform ✓)
 *        - safeExecFile('npm')-style calls go through the resolver (they do —
 *          it's inside safeExecFile itself)
 *
 * The dynamic Windows checklist (installer, GPU, DPAPI) is documented in
 * docs/WINDOWS-VERIFICATION.md and must be run on a real Windows machine.
 *
 * Run: npx tsx tests/glm/test-p8d.ts
 */
import '../__mocks__/install-electron-mock.js';

import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main(): Promise<void> {

const { resolveCommandForPlatform, isShellSafeArg, safeExecFile } = await import('../../src/main/security/shell');

// ─── 1. Command resolution ──────────────────────────────────────────────────
console.log('\n1. resolveCommandForPlatform:');
assert('win32 npm → npm.cmd + shell', (() => { const r = resolveCommandForPlatform('npm', 'win32'); return r.bin === 'npm.cmd' && r.useShell === true; })());
assert('win32 npx → npx.cmd + shell', resolveCommandForPlatform('npx', 'win32').bin === 'npx.cmd');
assert('win32 yarn/pnpm/bun shimmed', ['yarn','pnpm','bun'].every((b) => resolveCommandForPlatform(b, 'win32').bin === `${b}.cmd`));
assert('win32 git NOT shimmed (real exe)', (() => { const r = resolveCommandForPlatform('git', 'win32'); return r.bin === 'git' && r.useShell === false; })());
assert('win32 case-insensitive NPM', resolveCommandForPlatform('NPM', 'win32').bin === 'NPM.cmd');
assert('linux npm unchanged no shell', (() => { const r = resolveCommandForPlatform('npm', 'linux'); return r.bin === 'npm' && r.useShell === false; })());
assert('darwin npm unchanged', resolveCommandForPlatform('npm', 'darwin').useShell === false);

// ─── 2. Injection guard ─────────────────────────────────────────────────────
console.log('\n2. isShellSafeArg (cmd.exe metacharacters):');
assert('plain script name safe', isShellSafeArg('build') === true);
assert('ampersand blocked', isShellSafeArg('build&del') === false);
assert('pipe blocked', isShellSafeArg('a|b') === false);
assert('redirect blocked', isShellSafeArg('a>b') === false);
assert('caret blocked', isShellSafeArg('a^b') === false);
assert('percent blocked', isShellSafeArg('%PATH%') === false);
assert('quote blocked', isShellSafeArg('"x"') === false);
assert('newline blocked', isShellSafeArg('a\nb') === false);
assert('dashes and dots safe', isShellSafeArg('--prod.test-x') === true);
assert('non-string rejected', isShellSafeArg(undefined as any) === false);

// On THIS platform (linux), safeExecFile npm with metachars is NOT blocked
// (no shell involved) — the guard only engages for the shim path:
const linuxMeta = await safeExecFile('git', ['--version'], { timeout: 10000 });
assert('linux git still works through resolver', linuxMeta.success === true);

// ─── 3. Static audit: Phase 8 surface ───────────────────────────────────────
console.log('\n3. Static Windows audit (Phase 8 files):');
const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

// No '/'-concatenated paths in new files (must use path.join/isAbsolute)
const p8Files = [
  '../../src/main/ai/glm.ts',
  '../../src/main/ai/runtimes/online-runtime.ts',
  '../../src/main/ai/runtimes/online-transport.ts',
  '../../src/main/agent/model-router.ts',
  '../../src/main/ai/tools/read-multiple-files-tool.ts',
  '../../src/main/ai/tools/project-structure-tool.ts',
  '../../src/main/ai/tools/multi-file-edit-tool.ts',
];
for (const f of p8Files) {
  const src = read(f);
  const base = path.basename(f);
  // Detect template-literal path concatenation (`${x}/y`) while allowing
  // pure-DISPLAY strings: ratios ("${ok}/${total}") and tree prefixes
  // ("${prefix}${name}/" — display-only, never fed to fs APIs).
  const noUrls = src.replace(/https?:\/\/[^`'"\s)]*/g, '');
  const suspicious = noUrls
    .split('\n')
    .filter((line) => /\$\{[^}]+\}\//.test(line) || /\/\$\{/.test(line))
    .filter((line) => !/^\s*(lines\.push\(`\$\{prefix\}|.*\$\{[a-zA-Z]+\}\/\$\{)/.test(line.trim()))
    .filter((line) => !/display|ratio|summary/i.test(line));
  assert(`${base}: uses path.join (no '/' concat)`, suspicious.length === 0, suspicious[0]);
  assert(`${base}: path.isAbsolute for user input`, !src.includes("startsWith('/')"));
}

// shell.ts now contains resolver + guard
const shellSrc = read('../../src/main/security/shell.ts');
assert('shell.ts: resolver exported', /export function resolveCommandForPlatform/.test(shellSrc));
assert('shell.ts: meta guard exported', /export function isShellSafeArg/.test(shellSrc));
assert('shell.ts: safeExecFile uses resolver', /resolveCommandForPlatform\(bin\)/.test(shellSrc));
assert('shell.ts: guard wired into safeExecFile', /resolved\.useShell && args\.some/.test(shellSrc));
assert('shell.ts: PowerShell spawn for win32 terminals', /powershell\.exe/.test(shellSrc));

// persistence portable paths
const persistSrc = read('../../src/main/persistence/index.ts');
assert('persistence: portable path support', /portable/i.test(persistSrc));
assert('persistence: safeStorage encryption (DPAPI on win)', /safeStorage/.test(persistSrc));

// main.ts windows guards
const mainSrc = read('../../src/main/main.ts');
assert('main.ts: System32 block on win32', /win32/.test(mainSrc) && /system32/i.test(mainSrc));
assert('main.ts: win32 quit behavior', /process\.platform !== 'darwin'/.test(mainSrc));

// electron-builder Windows targets
const pkg = JSON.parse(read('../../package.json'));
assert('builder: nsis + portable x64 targets', (() => {
  const t = pkg.build?.win?.target as any[] | undefined;
  if (!t) return false;
  const names = t.map((x) => typeof x === 'string' ? x : x.target);
  return names.includes('nsis') && names.includes('portable');
})());
assert('builder: installer icon configured', !!pkg.build?.win?.icon);

// llama.cpp: node-llama-cpp is cross-platform (no manual binary paths)
const inferenceSrc = read('../../src/main/ai/inference.ts');
assert('inference: uses node-llama-cpp getLlama (cross-platform)', /getLlama/.test(inferenceSrc));
assert('inference: NO hardcoded .exe/.so paths', !/\.(exe|so|dll)['"]/.test(inferenceSrc));

// ─── 4. Windows checklist doc exists ────────────────────────────────────────
console.log('\n4. Documentation:');
const docPath = path.join(__dirname, '../../docs/WINDOWS-VERIFICATION.md');
assert('docs/WINDOWS-VERIFICATION.md exists', fs.existsSync(docPath));
if (fs.existsSync(docPath)) {
  const doc = fs.readFileSync(docPath, 'utf-8');
  for (const topic of ['Electron', 'llama.cpp', 'GLM', 'GPU', 'PowerShell', 'Installer', 'safeStorage']) {
    assert(`checklist covers ${topic}`, doc.includes(topic));
  }
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`P8-D RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('ALL P8-D WINDOWS-READINESS TESTS PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
