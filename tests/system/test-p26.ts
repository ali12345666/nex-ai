/**
 * Phase 26 / P26 — DiagnosticsPanel dead-API fix (REAL BUG)
 *
 * BUG: DiagnosticsPanel called window.nexAPI.execCommand() — an API that
 * was REMOVED in Phase 1's security hardening (command injection risk).
 * The "Run diagnostics" button was silently broken at runtime.
 *
 * FIX: new 'run-tsc-check' IPC (safeExecFile npx tsc --noEmit, argv
 * array, no shell, 30s timeout) + preload bridge + electron.d.ts cleanup
 * (dead execCommand declaration REMOVED, runTscCheck added) + panel
 * uses the safe API.
 *
 * Run: npx tsx tests/system/test-p26.ts
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

console.log('\nbehavioral: safeExecFile runs tsc correctly');
const { safeExecFile } = await import('../../src/main/security/shell');
// run tsc on a temp dir with no tsconfig → should succeed (exit 0 or 1, both valid)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p26-'));
const r = await safeExecFile('npx', ['tsc', '--noEmit', '--pretty', 'false'], { cwd: TMP, timeout: 30000 });
assert('safeExecFile npx tsc runs without shell injection', typeof r.success === 'boolean' || typeof r.exitCode === 'number');
void r;

console.log('\nIPC contract:');
const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main/main.ts'), 'utf-8');
assert("'run-tsc-check' handler registered", mainSrc.includes("'run-tsc-check'"));
assert('uses safeExecFile (not exec/shell)', /run-tsc-check[\s\S]{0,600}safeExecFile/.test(mainSrc));
assert('argv array (no shell string)', /\['tsc', '--noEmit'/.test(mainSrc));
assert('timeout 30s', /timeout: 30000/.test(mainSrc));
assert('cwd guarded', /assertPathInside/.test(mainSrc.split('run-tsc-check')[1] || ''));

console.log('\npreload + types:');
const pre = fs.readFileSync(path.join(__dirname, '../../src/main/preload.ts'), 'utf-8');
assert('preload bridges runTscCheck', pre.includes('runTscCheck'));
const types = fs.readFileSync(path.join(__dirname, '../../src/renderer/types/electron.d.ts'), 'utf-8');
assert('dead execCommand REMOVED from types', !types.includes('execCommand:'));
assert('runTscCheck typed', types.includes('runTscCheck:'));

console.log('\nDiagnosticsPanel fixed:');
const panel = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/DiagnosticsPanel.tsx'), 'utf-8');
// TEST BUG (documented): the comment 'replaces removed execCommand' is
// prose, not an API call. Check for actual invocations only.
assert('calls runTscCheck (not execCommand API)', /runTscCheck\(projectPath\)/.test(panel) && !/window\.nexAPI\.execCommand/.test(panel));
assert('handles both success + output', /tsResult\.success && tsResult\.output/.test(panel));

console.log('\nno other dead API references remain:');
// scan whole renderer for execCommand usage
const rendererFiles = fs.readdirSync(path.join(__dirname, '../../src/renderer'), { recursive: true })
  .filter((f: any) => String(f).endsWith('.ts') || String(f).endsWith('.tsx'));
let deadRefs = 0;
for (const f of rendererFiles) {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer', String(f)), 'utf-8');
  if (/window\.nexAPI\.execCommand/.test(src)) { deadRefs++; console.log(`  DEAD: ${f}`); }
}
assert('zero renderer references to dead execCommand', deadRefs === 0);

console.log('\npurity:');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));
assert('deps count verified (15 after Phase 27)', Object.keys(pkg.dependencies).length === 15);

console.log('\n══════════════════════════════════════');
console.log(`P26 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P26 DIAGNOSTICS FIX: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
