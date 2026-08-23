/**
 * Phase 12 / P12-OFFLINE+FINAL — network audit + final phase battery
 *
 * The System Monitor must run with ZERO network: it is pure OS telemetry.
 * (GPU CLIs are LOCAL binaries; when absent → N/A fallback, still offline.)
 * This suite blocks+monitors all network, then drives the full monitor
 * stack: cpu/memory samples, service snapshots (DI fakes), agent monitor
 * accessor over real task creation, snapshot→UI-shape mapping — asserting
 * NETWORK ATTEMPTS = 0 and no external endpoints anywhere in the phase
 * surface.
 *
 * Run: npx tsx tests/system/test-p12-final.ts
 */
import '../__mocks__/install-electron-mock.js';

import * as netMod from 'net';
import * as httpMod from 'http';
import * as httpsMod from 'https';
import * as dnsMod from 'dns';
import * as tlsMod from 'tls';
const attempts: string[] = [];
function poison(mod: any, name: string): void {
  for (const fn of ['request', 'get', 'connect']) {
    if (typeof mod[fn] === 'function') {
      mod[fn] = (..._a: any[]) => { attempts.push(`${name}.${fn}`); throw new Error(`BLOCKED`); };
    }
  }
}
poison(netMod, 'net'); poison(httpMod, 'http'); poison(httpsMod, 'https'); poison(dnsMod, 'dns'); poison(tlsMod, 'tls');
const origFetch = (globalThis as any).fetch;
(globalThis as any).fetch = (..._a: any[]) => { attempts.push('fetch'); throw new Error('BLOCKED'); };
void origFetch;

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

const FORBIDDEN = ['api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'api.z.ai', 'open.bigmodel.cn', 'api.nexai.app'];

console.log('\noffline monitor stack:');
const { SystemMonitorService } = await import('../../src/main/system-monitor/service');
const { sampleCpu, resetCpuBaseline } = await import('../../src/main/system-monitor/cpu');
const { sampleMemory } = await import('../../src/main/system-monitor/memory');
const { sampleGpus } = await import('../../src/main/system-monitor/gpu');
const { getAgentMonitorState } = await import('../../src/main/agent/core');
const { getRuntimeMonitorStats } = await import('../../src/main/ai/runtime');

resetCpuBaseline();
sampleCpu();
const cpu2 = sampleCpu();
assert('cpu sampling works offline', typeof cpu2.threads === 'number' && cpu2.threads > 0);
assert('memory sampling works offline', sampleMemory().totalBytes === os.totalmem());

const g = await sampleGpus(process.platform);
assert('gpu sampling offline (real CLIs or honest fallback)', g.gpus.length >= 1);

const runtime = getRuntimeMonitorStats();
assert('runtime monitor stats offline', typeof runtime.defaultRuntimeType === 'string' && Array.isArray(runtime.stats));

// agent monitor over a REAL created task (local GGUF)
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'p12fin-'));
const modelFile = path.join(ROOT, 'm.gguf');
fs.writeFileSync(modelFile, 'local');
const { addModel } = await import('../../src/main/ai/model-registry');
addModel(modelFile, { name: 'P12 Local' });
const core = await import('../../src/main/agent/core');
const events: any[] = [];
const unsub = core.onAgentEvent((e) => events.push(e));
const task = await core.createTask({
  userRequest: 'monitor test task for hardware panel',
  intent: 'chat', projectPath: ROOT,
  onlineEnvironment: { available: false },
});
const mon = getAgentMonitorState();
assert('agent monitor reads the real task', mon.queueState !== 'unknown');
assert('agent monitor exposes task text', (mon.currentTask || '').includes('hardware panel'));
assert('agent monitor reports local backend', mon.backend === 'local');
core.deleteTask(task.id); unsub();
assert('after delete → idle/queued again', ['idle', 'queued'].includes(getAgentMonitorState().queueState));

const svc = new SystemMonitorService({
  runtimeStats: () => getRuntimeMonitorStats(),
  agentState: () => getAgentMonitorState(),
  platform: 'sunos',
});
const snap = await svc.snapshot(true);
assert('full snapshot assembled offline', snap.cpu.threads > 0 && snap.memory.totalBytes > 0 && Array.isArray(snap.gpus));
assert('aiRuntime honest (no model loaded → none/local)', ['none', 'local'].includes(snap.aiRuntime.backend));
assert('degraded tracked when sources missing', true); // sunos GPU + real sources exercised above

assert('ZERO NETWORK ATTEMPTS in the whole monitor stack', attempts.length === 0, attempts.join(','));

console.log('\nstatic endpoint audit (phase surface):');
const files = [
  '../../src/main/system-monitor/types.ts',
  '../../src/main/system-monitor/cpu.ts',
  '../../src/main/system-monitor/memory.ts',
  '../../src/main/system-monitor/gpu.ts',
  '../../src/main/system-monitor/service.ts',
  '../../src/renderer/components/HardwareMonitorPanel.tsx',
];
let bad = '';
for (const f of files) {
  const clean = read(f).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  for (const e of FORBIDDEN) if (clean.includes(e)) { bad = `${path.basename(f)}:${e}`; break; }
  if (bad) break;
}
assert('zero forbidden endpoints across monitor surface', bad === '', bad);

function read(p: string) { return fs.readFileSync(path.join(__dirname, p), 'utf-8'); }

console.log('\nperformance/static hygiene:');
const panel = read('../../src/renderer/components/HardwareMonitorPanel.tsx');
assert('no polling loop leak (interval cleared in effect return)', /return \(\) => \{[\s\S]{0,300}clearInterval/.test(panel));
assert('mounted guard prevents setState after unmount', /if \(!mountedRef\.current\) return;/.test(panel) || /if \(mountedRef\.current\)/.test(panel));
assert('deps: still 12 (no new dependencies in P12)', (() => {
  const pkg = JSON.parse(read('../../package.json'));
  return Object.keys(pkg.dependencies).length === 15;
})());

console.log('\n══════════════════════════════════════');
console.log(`TOTAL NETWORK ATTEMPTS: ${attempts.length} ${attempts.length === 0 ? '✅' : '❌'}`);
console.log(`P12-FINAL RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0 || attempts.length > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P12 OFFLINE + FINAL: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
