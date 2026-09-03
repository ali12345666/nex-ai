/**
 * Phase 19 / P19 — Runtime telemetry wiring + Command palette coverage
 *
 * A (behavioral): llamacpp + online runtimes now CALL noteInferenceStats —
 * chat sets tps/tokens/duration(inactive), chatStream sets active:true
 * during and clears on finish/error. getRuntimeMonitorStats reflects it.
 * B (contract): palette exposes knowledge/memory/system/plugins commands
 * wired to setSidebarView; store field present; icons imported.
 * Purity: no agent changes; offline (net blocked); deps unchanged.
 *
 * Run: npx tsx tests/system/test-p19.ts
 */
import '../__mocks__/install-electron-mock.js';

import * as netMod from 'net';
const attempts: string[] = [];
(netMod as any).request = (..._a: any[]) => { attempts.push('net'); throw new Error('BLOCKED'); };
const origFetch = (globalThis as any).fetch;
(globalThis as any).fetch = (..._a: any[]) => { attempts.push('fetch'); throw new Error('BLOCKED'); };
void origFetch;

import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main(): Promise<void> {

console.log('\nA) telemetry wiring (behavioral over fakes + real registry):');
const { noteInferenceStats, getRuntimeMonitorStats } = await import('../../src/main/ai/runtime');

// before anything: undefined inference record
const s0 = getRuntimeMonitorStats();
assert('fresh monitor: no lastInference', s0.lastInference === undefined);

// simulate what a runtime now does on stream start/finish
noteInferenceStats({ active: true });
const s1 = getRuntimeMonitorStats();
assert('active flag exposed', s1.lastInference?.active === true);

noteInferenceStats({ tokensPerSecond: 18.4, promptTokens: 220, generatedTokens: 46, durationMs: 2500, active: false });
const s2 = getRuntimeMonitorStats();
assert('tps/tokens/duration recorded', s2.lastInference?.tokensPerSecond === 18.4 && s2.lastInference?.promptTokens === 220 && s2.lastInference?.generatedTokens === 46 && s2.lastInference?.durationMs === 2500);

// static: both runtimes actually call the hook
const lama = fs.readFileSync(path.join(__dirname, '../../src/main/ai/runtimes/llamacpp-runtime.ts'), 'utf-8');
const online = fs.readFileSync(path.join(__dirname, '../../src/main/ai/runtimes/online-runtime.ts'), 'utf-8');
assert('llamacpp: chat() feeds telemetry', /async chat\([\s\S]{0,700}noteInferenceStats\(\{[\s\S]{0,200}tokensPerSecond/.test(lama));
assert('llamacpp: chatStream sets active + clears on error', /chatStream[\s\S]{0,400}noteInferenceStats\(\{ active: true \}\)[\s\S]{0,900}catch[\s\S]{0,120}noteInferenceStats\(\{ active: false \}\)/.test(lama));
assert('online: chat() feeds telemetry + clears on error', /noteInferenceStats\(\{ active: true \}\)[\s\S]{0,900}catch[\s\S]{0,120}noteInferenceStats\(\{ active: false \}\)/.test(online));
assert('tps math = tokens / (durationMs/1000)', /tokensGenerated \/ \(result\.durationMs \/ 1000\)/.test(lama));

// staleness contract still intact (runtime.ts pin)
const rt = fs.readFileSync(path.join(__dirname, '../../src/main/ai/runtime.ts'), 'utf-8');
assert('5-min staleness pin intact', /5 \* 60 \* 1000/.test(rt));

console.log('\nB) command palette coverage:');
const palette = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/CommandPalette.tsx'), 'utf-8');
// UI-15 INTEGRATION FIX: palette commands consolidated to 5 main views.
// view-system-monitor and view-plugins removed (Hardware/Plugins now in Settings).
// view-knowledge and view-memory preserved (they're main nav items).
for (const [id, view] of [['view-knowledge', 'knowledge'], ['view-memory', 'memory']] as const) {
  assert(`palette: '${id}' → ${view}`, palette.includes(`id: '${id}'`) && palette.includes(`navigateTo('${view}')`));
}
// UI-15: workspace command added (replaces terminal/files/etc.)
assert('palette: open-workspace → workspace', palette.includes("id: 'open-workspace'") && palette.includes("navigateTo('workspace')"));
assert('palette: labels human-readable', ['Knowledge Base'].every((l) => palette.includes(l)));
const storeSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/store/useStore.ts'), 'utf-8');
assert("SidebarView includes all 4", ["'knowledge'", "'memory'", "'system'", "'plugins'"].every((v) => storeSrc.includes(v)));

console.log('\npurity:');
assert('ZERO network attempts', attempts.length === 0, attempts.join(','));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));
assert('deps count verified (16 after Phase 27 + node-pty)', Object.keys(pkg.dependencies).length === 16);
assert('agent core untouched', !/noteInferenceStats/.test(fs.readFileSync(path.join(__dirname, '../../src/main/agent/core.ts'), 'utf-8')));

console.log('\n══════════════════════════════════════');
console.log(`TOTAL NETWORK ATTEMPTS: ${attempts.length} ${attempts.length === 0 ? '✅' : '❌'}`);
console.log(`P19 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0 || attempts.length > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P19 TELEMETRY + PALETTE: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
