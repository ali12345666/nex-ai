/**
 * UI-02 — Connectivity Control (aiMode Enforcement) Tests
 *
 * Verifies the Phase 2 backend enforcement + frontend toggle:
 *   1. New `ai-mode.ts` module exists with required exports
 *   2. routeChat now reads + enforces persisted aiMode
 *   3. ai-chat-stream handler also enforces (was previously unchecked)
 *   4. BottomStatusBar has a real toggle (not just a label)
 *   5. Settings persistence is used (no new fake state)
 *   6. Network availability check exists for online mode
 *
 * Run: npx tsx tests/system/test-ui02-aimode-enforcement.ts
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

  console.log('\n1) ai-mode.ts module exists with required exports:');
  const aiModeSrc = read('../../src/main/ai/ai-mode.ts');
  assert('ai-mode.ts file exists', aiModeSrc.length > 0);
  assert('exports AIMode type', /export type AIMode = 'local' \| 'online' \| 'auto'/.test(aiModeSrc));
  assert('exports getCurrentAiMode function', /export function getCurrentAiMode\(\)/.test(aiModeSrc));
  assert('exports isNetworkAvailable function', /export function isNetworkAvailable\(\)/.test(aiModeSrc));
  assert('exports enforceAiMode function', /export function enforceAiMode\(/.test(aiModeSrc));
  assert('reads aiMode from persistence loadState', /loadState\(\)/.test(aiModeSrc));
  assert('safe default is local', /return 'local'; \/\/ safe default/.test(aiModeSrc));
  assert('imports net from electron', /from 'electron'/.test(aiModeSrc) && /import.*net/.test(aiModeSrc));
  assert('uses net.online for network check', /net.*\.online/.test(aiModeSrc));

  console.log('\n2) enforceAiMode decision matrix:');
  // Block: local mode + online provider
  assert('blocks local mode + online provider', /mode === 'local' && provider !== 'local'/.test(aiModeSrc));
  assert('returns clear error message for blocked', /Blocked by aiMode='local'/.test(aiModeSrc));
  // Allow: local mode + local provider (implicit — not in block list)
  // Allow: online mode + local provider (implicit)
  // Block: online mode + online provider + no network
  assert('checks network for online+online', /mode === 'online' && provider !== 'local' && !isNetworkAvailable\(\)/.test(aiModeSrc));
  assert('returns network error message', /No network connectivity/.test(aiModeSrc));
  // Auto mode: always allow
  assert('auto mode falls through (no block)', /return null;[\s\S]*?\}$/m.test(aiModeSrc) || /\/\/ Auto mode: backend doesn't second-guess/.test(aiModeSrc));

  console.log('\n3) routeChat now enforces aiMode (GAP-1 fix):');
  const providerSrc = read('../../src/main/ai/provider.ts');
  assert('imports enforceAiMode from ai-mode', /import.*enforceAiMode.*from '\.\/ai-mode'/.test(providerSrc));
  assert('imports getCurrentAiMode', /import.*getCurrentAiMode.*from '\.\/ai-mode'/.test(providerSrc));
  assert('routeChat accepts aiModeOverride param', /aiModeOverride\?: AIMode/.test(providerSrc));
  assert('routeChat calls getCurrentAiMode', /getCurrentAiMode\(\)/.test(providerSrc));
  assert('routeChat calls enforceAiMode', /enforceAiMode\(mode, config\.provider\)/.test(providerSrc));
  assert('routeChat returns blocked result early', /if \(blocked\) {[\s\S]*?return blocked;[\s\S]*?}/.test(providerSrc));
  assert('enforcement runs BEFORE origin/apiKey validation', (() => {
    // Look inside routeChat function body only (not imports at top of file).
    const fnStart = providerSrc.indexOf('export async function routeChat');
    const fnBody = providerSrc.slice(fnStart);
    const idxEnforce = fnBody.indexOf('enforceAiMode');
    const idxOrigin = fnBody.indexOf('isAllowedAIOrigin');
    return idxEnforce > 0 && idxOrigin > 0 && idxEnforce < idxOrigin;
  })());

  console.log('\n4) ai-chat-stream handler also enforces (GAP fix for stream path):');
  const mainSrc = read('../../src/main/main.ts');
  assert('stream handler imports enforceAiMode', /ai-chat-stream[\s\S]*?import\('\.\/ai\/ai-mode'\)/.test(mainSrc));
  assert('stream handler calls enforceAiMode', /ai-chat-stream[\s\S]*?enforceAiMode\(getCurrentAiMode\(\), config\.provider\)/.test(mainSrc));
  assert('stream handler returns blocked error early', /if \(blocked\) {[\s\S]*?return { success: false, replyId, error: blocked\.error };[\s\S]*?}/.test(mainSrc));
  assert('stream handler enforcement BEFORE runtime resolution', (() => {
    const idxEnforce = mainSrc.indexOf("enforceAiMode(getCurrentAiMode()");
    const idxRuntime = mainSrc.indexOf("let runtime:", idxEnforce);
    return idxEnforce > 0 && idxRuntime > 0 && idxEnforce < idxRuntime;
  })());

  console.log('\n5) BottomStatusBar has a real toggle (UI-02 fix):');
  const bsbSrc = read('../../src/renderer/components/layout/BottomStatusBar.tsx');
  assert('imports settingsLoad', /window\.nexAPI\.settingsLoad\(\)/.test(bsbSrc));
  assert('imports settingsSave', /window\.nexAPI\.settingsSave/.test(bsbSrc));
  assert('has cycleMode callback', /cycleMode/.test(bsbSrc));
  assert('MODE_CYCLE constant defines 3 modes', /MODE_CYCLE.*=.*\['local', 'online', 'auto'\]/.test(bsbSrc));
  assert('toggle button exists with onClick', /onClick=\{cycleMode\}/.test(bsbSrc));
  assert('toggle button has aria-label', /aria-label=\{`AI mode:/.test(bsbSrc));
  assert('toggle button has title with description', /title=\{MODE_DESCRIPTION/.test(bsbSrc));
  assert('toggle is disabled while switching', /disabled=\{modeSwitching\}/.test(bsbSrc));
  assert('mode state loaded from settings on mount', /settingsLoad\(\)/.test(bsbSrc));
  assert('mode persists via settingsSave', /settingsSave\(updatedSettings\)/.test(bsbSrc));
  assert('NO fake LOCAL/ONLINE label-only display', !/isLocal \? \(\(<>/.test(bsbSrc));
  assert('NO leftover rt.backend-based LOCAL/ONLINE logic', !/rt\?\.backend === 'local' \|\| rt\?\.backend === 'none'/.test(bsbSrc));

  console.log('\n6) Network availability in renderer:');
  assert('subscribes to online event', /addEventListener\('online'/.test(bsbSrc));
  assert('subscribes to offline event', /addEventListener\('offline'/.test(bsbSrc));
  assert('removes listeners on unmount', /removeEventListener\('online'/.test(bsbSrc) && /removeEventListener\('offline'/.test(bsbSrc));
  assert('initial state from navigator.onLine', /navigator\.onLine/.test(bsbSrc));
  assert('shows network dot only when mode != local', /\{aiMode !== 'local' &&/.test(bsbSrc));

  console.log('\n7) Mode color + icon vary per state:');
  assert('modeColor varies: local = accent', /aiMode === 'local'[\s\S]*?'var\(--nex-accent\)'/.test(bsbSrc));
  assert('modeColor varies: online = success/warning', /aiMode === 'online'[\s\S]*?'var\(--nex-success\)'/.test(bsbSrc));
  assert('ModeIcon chosen per mode (Cpu/Cloud/Zap)', /aiMode === 'local' \? CpuIcon : aiMode === 'online' \? Cloud : Zap/.test(bsbSrc));

  console.log('\n8) Runtime status still shown (separate concept from aiMode):');
  assert('runtimeBackend extracted from snapshot', /runtimeBackend = rt\?\.backend/.test(bsbSrc));
  assert('runtimeLabel shows actual backend', /runtimeLabel = runtimeBackend === 'local'/.test(bsbSrc));
  assert('runtimeLabel shown next to mode', /\{runtimeLabel\}/.test(bsbSrc));

  console.log('\n9) Single source of truth (GAP-9 from audit):');
  // BottomStatusBar uses aiMode (the SETTING), not rt.backend (RUNTIME status).
  // StatusBar.tsx (legacy) uses rt.backend — but it's dead code per audit.
  assert('BottomStatusBar primary signal is aiMode', /MODE_LABEL\[aiMode\]/.test(bsbSrc));
  assert('NO duplicate LOCAL/ONLINE logic from old code', !/isLocal \? \(/.test(bsbSrc));

  console.log('\n10) ai-mode.ts: enforceAiMode signature + return type:');
  assert('enforceAiMode returns ProviderResult | null', /:\s*ProviderResult \| null/.test(aiModeSrc));
  assert('enforceAiMode takes (mode, provider)', /enforceAiMode\(\s*mode:\s*AIMode,\s*provider:\s*ProviderType/.test(aiModeSrc));
  assert('ProviderResult imported from provider', /import type \{ ProviderType, ProviderResult \} from '\.\/provider'/.test(aiModeSrc));

  console.log('\n11) Persistence contract preserved (no schema changes):');
  const persistenceSrc = read('../../src/main/persistence/index.ts');
  assert('aiMode field exists in PersistedSettings', /aiMode\?: 'local' \| 'online' \| 'auto'/.test(persistenceSrc));
  assert('loadState still returns PersistedState', /export function loadState\(\): PersistedState/.test(persistenceSrc));
  assert('updateSettings still works', /export function updateSettings\(patch: Partial<PersistedSettings>/.test(persistenceSrc));

  console.log('\n12) Security: no new attack surface:');
  // No new IPC channels added — uses existing settings-save.
  assert('NO new IPC channel added for aiMode', !/ipcMain\.handle\('ai-mode/.test(mainSrc));
  assert('NO new IPC channel added for network', !/ipcMain\.handle\('network-/.test(mainSrc));
  assert('NO direct net.request call in ai-mode.ts', !/net\.request/.test(aiModeSrc));
  assert('enforceAiMode is pure (no side effects)', /function enforceAiMode\([\s\S]*?\{[\s\S]*?return null;/.test(aiModeSrc));

  console.log('\n══════════════════════════════════════');
  console.log(`UI-02 RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('UI-02 CONNECTIVITY CONTROL: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
