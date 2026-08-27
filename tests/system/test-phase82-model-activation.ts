/**
 * Phase 82 — Model Activation UI Tests
 *
 * Verifies:
 *   1. localRuntimeActivateModel IPC handler exists
 *   2. localRuntimeGetActiveModel IPC handler exists
 *   3. localRuntimeDetailedStatus IPC handler exists
 *   4. Preload bindings exist
 *   5. Type declarations exist
 *   6. SettingsPanel AI Storage section shows runtime status
 *   7. Library Installed tab has Activate button
 *   8. Library Installed tab has Active badge
 *   9. Library Installed tab has Runtime Status card
 *  10. resolveModel checks activeLocalModelId from settings
 *  11. getProviderConfig passes localModelId
 *  12. [MODEL_ACTIVATE] logging exists
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

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Phase 82 — Model Activation UI Tests');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) IPC handlers
  // ═══════════════════════════════════════════════════════════════════════
  console.log('1) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');

  assert('local-runtime-activate-model handler', mainSrc.includes("ipcMain.handle('local-runtime-activate-model'"));
  assert('local-runtime-get-active-model handler', mainSrc.includes("ipcMain.handle('local-runtime-get-active-model'"));
  assert('local-runtime-detailed-status handler', mainSrc.includes("ipcMain.handle('local-runtime-detailed-status'"));
  assert('[MODEL_ACTIVATE] logging exists', mainSrc.includes('[MODEL_ACTIVATE]'));
  assert('Activate persists activeLocalModelId', mainSrc.includes('(settings as any).activeLocalModelId = modelId'));
  assert('Activate unloads old model', mainSrc.includes('unloadModel()'));
  assert('Activate loads new model', mainSrc.includes('loadModel(modelId)'));
  assert('Detailed status returns loadedModel', mainSrc.includes('loadedModel'));
  assert('Detailed status returns contextSize', mainSrc.includes('contextSize'));
  assert('Detailed status returns gpuLayers', mainSrc.includes('gpuLayers'));
  assert('Detailed status returns tokensPerSecond', mainSrc.includes('tokensPerSecond'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Preload + types
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Preload + types:');
  const preloadSrc = read('../../src/main/preload.ts');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');

  assert('preload: localRuntimeActivateModel', preloadSrc.includes('localRuntimeActivateModel:'));
  assert('preload: localRuntimeGetActiveModel', preloadSrc.includes('localRuntimeGetActiveModel:'));
  assert('preload: localRuntimeDetailedStatus', preloadSrc.includes('localRuntimeDetailedStatus:'));
  assert('types: localRuntimeActivateModel declared', typesSrc.includes('localRuntimeActivateModel:'));
  assert('types: localRuntimeGetActiveModel declared', typesSrc.includes('localRuntimeGetActiveModel:'));
  assert('types: localRuntimeDetailedStatus declared', typesSrc.includes('localRuntimeDetailedStatus:'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) Library Installed tab
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Library Installed tab:');
  const libSrc = read('../../src/renderer/components/NexLibraryPanel.tsx');

  assert('activeModelId state exists', libSrc.includes('activeModelId'));
  assert('runtimeStatus state exists', libSrc.includes('runtimeStatus'));
  assert('activating state exists', libSrc.includes('activating'));
  assert('handleActivateModel function exists', libSrc.includes('handleActivateModel'));
  assert('Fetches localRuntimeGetActiveModel', libSrc.includes('localRuntimeGetActiveModel'));
  assert('Fetches localRuntimeDetailedStatus', libSrc.includes('localRuntimeDetailedStatus'));
  assert('Calls localRuntimeActivateModel', libSrc.includes('localRuntimeActivateModel'));
  assert('Activate button exists', libSrc.includes('Activate'));
  assert('Active badge exists', libSrc.includes('Active ✓'));
  assert('Runtime Status card exists', libSrc.includes('Runtime Status'));
  assert('Shows Loaded ✓ badge', libSrc.includes('Loaded ✓'));
  assert('Shows Not Loaded badge', libSrc.includes('Not Loaded'));
  assert('Shows backend', libSrc.includes('runtimeStatus.backend'));
  assert('Shows contextSize', libSrc.includes('runtimeStatus.contextSize'));
  assert('Shows gpuLayers', libSrc.includes('runtimeStatus.gpuLayers'));
  assert('Shows vramUsage', libSrc.includes('runtimeStatus.vramUsage'));
  assert('Shows tokensPerSecond', libSrc.includes('runtimeStatus.tokensPerSecond'));
  assert('Active model border highlight', libSrc.includes('rgba(6,182,212,0.3)'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) resolveModel checks activeLocalModelId
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) resolveModel active model:');
  const leSrc = read('../../src/main/ai/local-engine.ts');

  assert('resolveModel checks config.localModelId', leSrc.includes('config.localModelId'));
  assert('resolveModel checks activeLocalModelId from settings', leSrc.includes('activeLocalModelId'));
  assert('resolveModel logs [MODEL_RESOLVE]', leSrc.includes('[MODEL_RESOLVE]'));
  assert('resolveModel logs "Using active model from settings"', leSrc.includes('Using active model from settings'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) getProviderConfig passes localModelId
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) getProviderConfig:');
  const storeSrc = read('../../src/renderer/store/useStore.ts');

  assert('getProviderConfig passes localModelId', storeSrc.includes('localModelId:'));
  assert('Uses settings.activeLocalModelId', storeSrc.includes('settings.activeLocalModelId'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Behavioral: resolveModel with no models
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Behavioral:');
  const { resolveModel } = await import('../../src/main/ai/local-engine');
  const result = resolveModel({ provider: 'local', maxTokens: 1024, temperature: 0.7 } as any);
  assert('resolveModel returns null when no active model set', result === null || result === undefined);

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 82 Tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
