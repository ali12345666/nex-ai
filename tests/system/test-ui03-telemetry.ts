/**
 * UI-03 — Hardware Telemetry Polish Tests
 *
 * Verifies:
 *   1. GPU backend detection is REAL (was hardcoded 'cpu')
 *   2. contextMaxTokens is set on loadModel (was agent-only)
 *   3. BottomStatusBar shows GPU% when available
 *   4. BottomStatusBar shows VRAM% when available
 *   5. BottomStatusBar shows agent state when active
 *   6. N/A fallback for unavailable metrics (no fake values)
 *
 * Run: npx tsx tests/system/test-ui03-telemetry.ts
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
  const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

  console.log('\n1) inference.ts: GPU backend detection (GAP-5 fix):');
  const inferenceSrc = read('../../src/main/ai/inference.ts');
  assert('_gpuBackend module-level variable declared', /let _gpuBackend: 'cpu' \| 'cuda' \| 'metal' \| 'vulkan' = 'cpu'/.test(inferenceSrc));
  assert('getLlamaInstance captures _llama.gpu', /\(_llama as any\)\.gpu/.test(inferenceSrc));
  assert('assigns gpuBackend based on gpu type (metal/cuda/vulkan)', /if \(gpu === 'metal' \|\| gpu === 'cuda' \|\| gpu === 'vulkan'\)/.test(inferenceSrc));
  assert('falls back to cpu when gpu is false/unknown', /else {[\s\S]*?_gpuBackend = 'cpu'/.test(inferenceSrc));
  assert('logs actual GPU backend on init', /Engine ready \(GPU backend: \$\{_gpuBackend\}\)/.test(inferenceSrc));
  assert('exports getGpuBackend() function', /export function getGpuBackend\(\): 'cpu' \| 'cuda' \| 'metal' \| 'vulkan'/.test(inferenceSrc));

  console.log('\n2) llamacpp-runtime.ts: uses real gpuBackend (GAP-5 fix):');
  const runtimeSrc = read('../../src/main/ai/runtimes/llamacpp-runtime.ts');
  assert('imports getGpuBackend from inference', /import[\s\S]*?getGpuBackend as _getGpuBackend[\s\S]*?from '\.\.\/inference'/.test(runtimeSrc));
  assert('getStats uses _getGpuBackend() (not hardcoded)', /gpuBackend: _getGpuBackend\(\)/.test(runtimeSrc));
  assert('hardcoded "gpuBackend: \'cpu\'" removed', !/gpuBackend: 'cpu',\s*\/\/ will be 'vulkan'/.test(runtimeSrc));
  assert('NO remaining hardcoded cpu comment', !/will be 'vulkan' \/ 'cuda' when GPU works/.test(runtimeSrc));

  console.log('\n3) runtime-telemetry.ts: accepts contextMaxTokens (GAP-10 fix):');
  const telemetrySrc = read('../../src/main/ai/runtime-telemetry.ts');
  assert('_lastInference type has contextMaxTokens', /contextMaxTokens\?: number;/.test(telemetrySrc));
  assert('noteInferenceStats accepts contextMaxTokens', /noteInferenceStats\(stats: \{[\s\S]*?contextMaxTokens\?: number/.test(telemetrySrc));

  console.log('\n4) inference.ts loadModel: surfaces contextMaxTokens (GAP-10 fix):');
  assert('loadModel calls noteInferenceStats with contextMaxTokens', /noteInferenceStats\(\{[\s\S]*?contextMaxTokens: opts\.contextSize \?\? model\.contextSize \?\? 2048/.test(inferenceSrc));
  assert('call placed AFTER model loaded', (() => {
    const idxLoad = inferenceSrc.indexOf('_loadedModelId = model.id;');
    const idxNote = inferenceSrc.indexOf('noteInferenceStats({\n    contextMaxTokens:');
    return idxLoad > 0 && idxNote > 0 && idxNote > idxLoad;
  })());

  console.log('\n5) BottomStatusBar: GPU/VRAM/agent indicators:');
  const bsbSrc = read('../../src/renderer/components/layout/BottomStatusBar.tsx');
  assert('imports Gauge icon', /Gauge/.test(bsbSrc));
  assert('imports Bot icon', /Bot/.test(bsbSrc));
  assert('extracts gpu from snapshot.gpus[0]', /snap\?\.gpus\?\.\[0\]/.test(bsbSrc));
  assert('extracts gpuPercent', /gpu\?\.utilizationPercent/.test(bsbSrc));
  assert('extracts vramPercent', /gpu\?\.vramPercent/.test(bsbSrc));
  assert('extracts agent from snapshot', /snap\?\.agent/.test(bsbSrc));
  assert('GPU indicator only renders when gpu exists', /\{gpu && \(/.test(bsbSrc));
  assert('VRAM indicator only renders when vramPercent available', /\{gpu && vramPercent !== undefined &&/.test(bsbSrc));
  assert('agent indicator only renders when agentLabel set', /\{agentLabel && agent &&/.test(bsbSrc));
  assert('GPU shows N/A when utilizationPercent undefined', /gpuPercent !== undefined \? `\$\{Math\.round\(gpuPercent\)\}%` : 'N\/A'/.test(bsbSrc));

  console.log('\n6) Agent state logic:');
  assert('agentActive excludes idle state', /agent\.queueState !== 'idle'/.test(bsbSrc));
  assert('agentActive excludes unknown state', /agent\.queueState !== 'unknown'/.test(bsbSrc));
  assert('agentLabel prefers activeTool', /agent\.activeTool[\s\S]*?\? `tool: \$\{agent\.activeTool\}`/.test(bsbSrc));
  assert('agentLabel falls back to currentTask', /agent\.currentTask[\s\S]*?\? `task:/.test(bsbSrc));
  assert('agentLabel truncated for display', /\.slice\(0, 24\)/.test(bsbSrc));

  console.log('\n7) Context usage in BottomStatusBar:');
  assert('contextMaxTokens shown when > 0', /rt\?\.contextMaxTokens !== undefined && rt\.contextMaxTokens > 0/.test(bsbSrc));
  assert('contextUsedTokens shown as percentage', /rt\.contextUsedTokens \/ rt\.contextMaxTokens \* 100/.test(bsbSrc));

  console.log('\n8) No fake data introduced:');
  // All GPU/VRAM/agent values come from snapshot — never fabricated.
  assert('NO hardcoded GPU value', !/gpuPercent = 0\.\d/.test(bsbSrc));
  assert('NO hardcoded VRAM value', !/vramPercent = 0\.\d/.test(bsbSrc));
  assert('NO hardcoded agent state', !/queueState = 'running'/.test(bsbSrc));
  assert('NO Math.random in BottomStatusBar', !/Math\.random/.test(bsbSrc));

  console.log('\n9) Accessibility for new indicators:');
  assert('GPU icon has aria-hidden', /Gauge size=\{12\} aria-hidden/.test(bsbSrc));
  assert('VRAM icon has aria-hidden', /HardDrive size=\{12\} aria-hidden/.test(bsbSrc));
  assert('Bot icon has aria-hidden', /Bot size=\{12\} aria-hidden/.test(bsbSrc));
  assert('agent indicator has title attribute', /title=\{`Agent: \$\{agent\.queueState\}/.test(bsbSrc));

  console.log('\n10) HardwareMonitorPanel unchanged (audit confirmed COMPLETE):');
  const hwSrc = read('../../src/renderer/components/HardwareMonitorPanel.tsx');
  assert('HardwareMonitorPanel still exists', hwSrc.length > 0);
  assert('still shows CPU + per-core', /per-core|perCore/.test(hwSrc));
  assert('still shows GPU details', /gpus\.length|utilizationPercent|gpu backend/.test(hwSrc));
  assert('still shows N/A fallback', /N\/A/.test(hwSrc));

  console.log('\n11) No regressions in SystemMonitorSnapshot type:');
  const electronTypes = read('../../src/renderer/types/electron.d.ts');
  assert('snapshot.gpus still array', /gpus: Array</.test(electronTypes));
  assert('snapshot.gpus[0] still has utilizationPercent', /utilizationPercent\?: number/.test(electronTypes));
  assert('snapshot.gpus[0] still has vramPercent', /vramPercent\?: number/.test(electronTypes));
  assert('snapshot.aiRuntime still has gpuBackend', /gpuBackend\?: string/.test(electronTypes));
  assert('snapshot.aiRuntime still has contextMaxTokens', /contextMaxTokens\?: number/.test(electronTypes));
  assert('snapshot.agent still has queueState', /queueState: 'idle' \| 'running' \| 'waiting-permission' \| 'queued' \| 'unknown'/.test(electronTypes));

  console.log('\n══════════════════════════════════════');
  console.log(`UI-03 RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('UI-03 HARDWARE TELEMETRY: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
