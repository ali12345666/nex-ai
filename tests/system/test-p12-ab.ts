/**
 * Phase 12 / P12-A+B — System Monitor samplers + service
 *
 * 1. cpu: first-call no-usage (honest delta), second-call usage 0-100,
 *    perCore length = threads, no fabricated temperature
 * 2. memory: used+free=total, percent math exact
 * 3. gpu: no-tools platform → single honest fallback entry (no fabricated
 *    metrics); allowlist constant; safeExecFile-only architecture
 * 4. service: DI sources, snapshot shape (runtime/agent), fast re-poll
 *    caching (≤1 source hit), degraded recording, cadence table sanity
 * 5. static: no child_process outside gpu.ts; DI-only service; pure types;
 *    zero external endpoints in all monitor modules
 *
 * Run: npx tsx tests/system/test-p12-ab.ts
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

console.log('\n1) CPU sampler:');
const { sampleCpu, resetCpuBaseline } = await import('../../src/main/system-monitor/cpu');
resetCpuBaseline();
const c1 = sampleCpu();
assert('first call: no usagePercent (needs delta — honest)', c1.usagePercent === undefined);
assert('model present', typeof c1.model === 'string' && c1.model.length > 0);
assert('threads = os.cpus().length', c1.threads === os.cpus().length);
assert('cores >= 1', c1.cores >= 1);
const spinEnd = Date.now() + 60;
while (Date.now() < spinEnd) { Math.sqrt(Date.now()); }
const c2 = sampleCpu();
assert('second call: usagePercent defined (0-100)', typeof c2.usagePercent === 'number' && c2.usagePercent >= 0 && c2.usagePercent <= 100, String(c2.usagePercent));
assert('perCore length = threads', Array.isArray(c2.perCore) && c2.perCore!.length === c2.threads);
assert('perCore values in 0-100', c2.perCore!.every((v) => v >= 0 && v <= 100));
assert('temperature NOT fabricated', c2.temperatureC === undefined);

console.log('\n2) Memory sampler:');
const { sampleMemory } = await import('../../src/main/system-monitor/memory');
const m = sampleMemory();
assert('total = os.totalmem', m.totalBytes === os.totalmem());
assert('used + free = total', m.usedBytes + m.freeBytes === m.totalBytes);
assert('usagePercent 0-100', m.usagePercent >= 0 && m.usagePercent <= 100);
assert('math exact', Math.abs(m.usagePercent - (m.usedBytes / m.totalBytes) * 100) < 0.001);

console.log('\n3) GPU sampler (no-tools platform):');
const { sampleGpus, GPU_ALLOWED_BINARIES } = await import('../../src/main/system-monitor/gpu');
const none = await sampleGpus('sunos');
assert('no tools -> single honest fallback entry', none.gpus.length === 1 && none.gpus[0].vendor === 'unknown' && none.gpus[0].source === 'unknown');
assert('fallback entry has NO fabricated metrics',
  none.gpus[0].utilizationPercent === undefined &&
  none.gpus[0].vramUsedBytes === undefined &&
  none.gpus[0].temperatureC === undefined);
assert('allowlist = nvidia-smi, rocm-smi, wmic', JSON.stringify(GPU_ALLOWED_BINARIES) === '["nvidia-smi","rocm-smi","wmic"]');
const gpuSrc = fs.readFileSync(path.join(__dirname, '../../src/main/system-monitor/gpu.ts'), 'utf-8');
assert('gpu.ts uses safeExecFile ONLY', /safeExecFile/.test(gpuSrc) && !/child_process/.test(gpuSrc));
assert('gpu.ts: no shell:true', !/shell:\s*true/.test(gpuSrc));

console.log('\n4) Service (DI + caching + degraded):');
const { SystemMonitorService } = await import('../../src/main/system-monitor/service');
const { RECOMMENDED_INTERVALS_MS } = await import('../../src/main/system-monitor/types');

let runtimeCalls = 0;
let agentCalls = 0;
const svc = new SystemMonitorService({
  runtimeStats: () => {
    runtimeCalls++;
    return {
      defaultRuntimeType: 'llamacpp',
      stats: [{ instanceId: 'default', type: 'llamacpp', loaded: true, loadedModelName: 'Qwen2.5-0.5B', gpuBackend: 'cpu' }],
      lastInference: { tokensPerSecond: 14.2, promptTokens: 210, generatedTokens: 64, durationMs: 4500, modelLoadMs: 1800, active: false },
    };
  },
  agentState: () => {
    agentCalls++;
    return {
      currentTask: 'refactor auth module',
      currentStep: 'step 2: edit files',
      stepProgress: { current: 2, total: 5 },
      activeTool: 'propose_changes',
      toolDurationMs: 340,
      queueState: 'running' as const,
      cancelled: false,
      inferenceActive: true,
      contextUsedTokens: 812,
      contextMaxTokens: 2048,
      backend: 'local' as const,
    };
  },
  platform: 'sunos',
});

const s1 = await svc.snapshot(true);
assert('snapshot cpu/memory present', s1.cpu.threads > 0 && s1.memory.totalBytes > 0);
assert('aiRuntime: local backend + model + tps', s1.aiRuntime.backend === 'local' && s1.aiRuntime.activeModelName === 'Qwen2.5-0.5B' && s1.aiRuntime.lastTokensPerSecond === 14.2);
assert('aiRuntime tokens/duration/load', s1.aiRuntime.lastPromptTokens === 210 && s1.aiRuntime.lastGeneratedTokens === 64 && s1.aiRuntime.lastInferenceDurationMs === 4500 && s1.aiRuntime.lastModelLoadMs === 1800);
assert('agent: task/step/progress/tool', s1.agent.currentTask === 'refactor auth module' && s1.agent.stepProgress!.current === 2 && s1.agent.activeTool === 'propose_changes' && s1.agent.queueState === 'running');
assert('agent extras captured', svc.lastAgentRuntimeExtras.contextUsedTokens === 812 && svc.lastAgentRuntimeExtras.inferenceActive === true);
assert('platform override honored', s1.platform === 'sunos');

const beforeR = runtimeCalls, beforeA = agentCalls;
await svc.snapshot();
assert('fast re-poll: runtime source NOT re-queried (cache)', runtimeCalls === beforeR);
assert('fast re-poll: agent source at most once (800ms cadence)', agentCalls <= beforeA + 1);

const svc2 = new SystemMonitorService({ platform: 'sunos' });
const s2 = await svc2.snapshot(true);
assert('missing runtimeStats -> degraded + none backend', s2.aiRuntime.backend === 'none' && s2.degradedSources.includes('runtime-stats'));
assert('missing agentState -> unknown queue', s2.agent.queueState === 'unknown');

assert('cadence 500-2000ms + static slow',
  RECOMMENDED_INTERVALS_MS.cpu >= 500 && RECOMMENDED_INTERVALS_MS.cpu <= 2000 &&
  RECOMMENDED_INTERVALS_MS.agent >= 500 && RECOMMENDED_INTERVALS_MS.agent <= 2000 &&
  RECOMMENDED_INTERVALS_MS.staticInfo >= 30000);

console.log('\n5) architecture static:');
const svcSrc = fs.readFileSync(path.join(__dirname, '../../src/main/system-monitor/service.ts'), 'utf-8');
assert('service: NO child_process', !/child_process/.test(svcSrc));
assert('service: DI only (no agent/ai/knowledge imports)', !/from ['"]\.\.\/agent|from ['"]\.\.\/ai\/runtime|from ['"]\.\.\/knowledge/.test(svcSrc));
const typesSrc = fs.readFileSync(path.join(__dirname, '../../src/main/system-monitor/types.ts'), 'utf-8');
assert('types: pure (zero imports)', !/^import /m.test(typesSrc));
const monitorDir = path.join(__dirname, '../../src/main/system-monitor');
for (const f of fs.readdirSync(monitorDir).filter((x) => x.endsWith('.ts'))) {
  const clean = fs.readFileSync(path.join(monitorDir, f), 'utf-8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  const bad = ['api.openai.com','api.anthropic.com','generativelanguage','api.z.ai','open.bigmodel.cn','api.nexai.app'].find((e) => clean.includes(e));
  assert(`${f}: no external endpoints`, !bad, bad);
}

console.log('\n══════════════════════════════════════');
console.log(`P12-A/B RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P12-A/B SYSTEM MONITOR CORE: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
