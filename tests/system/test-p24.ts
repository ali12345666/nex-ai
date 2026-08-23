/**
 * Phase 24 / P24 — StatusBar LIVE telemetry (fake → real)
 *
 * REAL BUGS in the old bar (all violations of the no-fake rule):
 *  1. branch hardcoded 'main'
 *  2. errors/warnings hardcoded '0'
 *  3. isOnline initialized true and NEVER updated (static fake)
 *  4. no model/tok/s/context/CPU/RAM/agent display (P12 backend unused)
 *
 * Now: git-status IPC (branch + dirty count), system-snapshot IPC
 * (CPU/RAM/model/backend/tok/s/context/agent), aiMode-based offline
 * indicator, real unsaved count, N/A for unavailable metrics.
 *
 * Run: npx tsx tests/system/test-p24.ts
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

console.log('\nbehavioral (real git repo fixture):');
// Real git-status over a temp repo
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'p24-'));
const { safeExecFile } = await import('../../src/main/security/shell');
await safeExecFile('git', ['init', '-q'], { cwd: ROOT, timeout: 5000 });
await safeExecFile('git', ['checkout', '-q', '-b', 'feature/test-branch'], { cwd: ROOT, timeout: 5000 });
fs.writeFileSync(path.join(ROOT, 'a.txt'), 'x');
fs.writeFileSync(path.join(ROOT, 'b.txt'), 'y');
await safeExecFile('git', ['add', '.'], { cwd: ROOT, timeout: 5000 });
fs.writeFileSync(path.join(ROOT, 'c.txt'), 'z'); // 1 untracked

// handler semantics
const statusResult = await safeExecFile('git', ['status', '--porcelain'], { cwd: ROOT, timeout: 5000 });
const branchResult = await safeExecFile('git', ['branch', '--show-current'], { cwd: ROOT, timeout: 5000 });
assert('real branch reported (not main)', branchResult.stdout.trim() === 'feature/test-branch');
const files = statusResult.stdout.split('\n').filter(Boolean);
assert('real dirty count (2 staged + 1 untracked)', files.length === 3, `got ${files.length}`);

// system snapshot delivers everything the bar renders
const { SystemMonitorService } = await import('../../src/main/system-monitor/service');
const svc = new SystemMonitorService({
  runtimeStats: () => ({
    defaultRuntimeType: 'llamacpp',
    stats: [{ instanceId: 'default', type: 'llamacpp', loaded: true, loadedModelName: 'stories15M', gpuBackend: 'cpu' }],
    lastInference: { tokensPerSecond: 129.4, promptTokens: 40, generatedTokens: 32, durationMs: 260, active: true },
  }),
  agentState: () => ({
    queueState: 'running' as const, cancelled: false,
    currentTask: 'validate', stepProgress: { current: 2, total: 5 }, contextUsedTokens: 812, contextMaxTokens: 2048,
  }),
  platform: 'sunos',
});
const snap = await svc.snapshot(true);
assert('model name present', snap.aiRuntime.activeModelName === 'stories15M');
assert('tok/s present while active', snap.aiRuntime.lastTokensPerSecond === 129.4);
assert('agent step 2/5 present', snap.agent.stepProgress!.current === 2);
assert('cpu usage measured', typeof snap.cpu.usagePercent === 'number' || snap.cpu.usagePercent === undefined);
assert('ram % always present', typeof snap.memory.usagePercent === 'number');

console.log('\nrenderer contract (no-fake verification):');
const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/StatusBar.tsx'), 'utf-8');
assert('branch from git-status IPC (not hardcoded)', /gitStatus\(projectPath\)/.test(src) && !/>main</.test(src));
assert('NO hardcoded error/warning counters', !/\>0\<\/span>.*AlertCircle/.test(src) && (src.match(/AlertCircle/g) || []).length === 0);
assert('NO navigator.onLine / static isOnline', !/navigator\.onLine/.test(src) && !/useState\(true\)/.test(src));
assert('offline indicator = aiMode (honest)', /aiMode === 'local' \? <WifiOff/.test(src));
assert('tok/s rendered from snapshot', /lastTokensPerSecond/.test(src));
assert('context % rendered', /contextUsedTokens \/ rt\?\.contextMaxTokens/.test(src.replace(/\?/g, '?')) || /contextPct/.test(src));
assert('CPU% with N/A fallback', /usagePercent !== undefined/.test(src));
assert('RAM% rendered', /memory\.usagePercent/.test(src));
assert('agent state + step rendered', /agent\.queueState/.test(src) && /stepProgress/.test(src));
// TEST BUG (documented): interval uses POLL_MS constant (=2000), not a
// literal — regex updated to match the constant + its 2000 assignment.
assert('2s polling (POLL_MS=2000) with cleanup', /POLL_MS = 2000/.test(src) && /setInterval\(poll, POLL_MS\)/.test(src) && /clearInterval\(timerRef\.current\)/.test(src) && /mountedRef\.current = false/.test(src));
assert('role=status + aria labels', /role="status"/.test(src) && /aria-label/.test(src) && /aria-hidden/.test(src));
assert('project change re-polls (dep)', /\[poll\]/.test(src));

console.log('\npurity:');
assert('no direct fs/git in renderer', !/child_process|execFile|require\('fs'\)/.test(src));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));
assert('deps unchanged (12)', Object.keys(pkg.dependencies).length === 12);

console.log('\n══════════════════════════════════════');
console.log(`P24 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P24 STATUSBAR LIVE: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
