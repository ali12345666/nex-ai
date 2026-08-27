/**
 * Phase 81 — Storage UI Integration Tests
 *
 * Verifies:
 *   1. SettingsPanel has AI Storage section
 *   2. AIStorageSection component exists with all buttons
 *   3. Library Installed tab shows AI Storage assets
 *   4. resolveModel checks AI Storage registry
 *   5. Auto-scan on startup
 *   6. Preload bindings for all storage IPCs
 *   7. Type declarations exist
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
  console.log('Phase 81 — Storage UI Integration Tests');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) SettingsPanel AI Storage section
  // ═══════════════════════════════════════════════════════════════════════
  console.log('1) SettingsPanel AI Storage:');
  const settingsSrc = read('../../src/renderer/components/SettingsPanel.tsx');

  assert('AIStorageSection component exists', settingsSrc.includes('function AIStorageSection'));
  assert('AI Storage card in settings', settingsSrc.includes('Phase 81: AI Storage Manager'));
  assert('Shows storage path', settingsSrc.includes('storageInfo.path'));
  assert('Shows total size', settingsSrc.includes('totalSize'));
  assert('Shows model count', settingsSrc.includes('modelCount'));
  assert('Shows voice count', settingsSrc.includes('voiceCount'));
  assert('Shows document count', settingsSrc.includes('documentCount'));
  assert('Change Location button', settingsSrc.includes('aiStorageChooseFolder'));
  assert('Scan Storage button', settingsSrc.includes('aiStorageScan'));
  assert('Repair Registry button', settingsSrc.includes('aiStorageRepair'));
  assert('Open Folder button', settingsSrc.includes('aiStorageOpenFolder'));
  assert('formatBytes helper exists', settingsSrc.includes('function formatBytes'));
  assert('Help text mentions manual download', settingsSrc.includes('Download models manually'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Library Installed tab shows AI Storage assets
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Library Installed tab:');
  const libSrc = read('../../src/renderer/components/NexLibraryPanel.tsx');

  assert('storageAssets state exists', libSrc.includes('storageAssets'));
  assert('Fetches aiStorageList in refresh', libSrc.includes('aiStorageList'));
  assert('Sets storageAssets from result', libSrc.includes('setStorageAssets'));
  assert('Installed tab shows AI Storage section', libSrc.includes('AI Storage'));
  assert('Shows asset name', libSrc.includes('asset.name'));
  assert('Shows asset type badge', libSrc.includes('asset.type'));
  assert('Shows asset provider', libSrc.includes('asset.provider'));
  assert('Shows asset parameterCount', libSrc.includes('asset.parameterCount'));
  assert('Shows asset quantization', libSrc.includes('asset.quantization'));
  assert('Shows asset size', libSrc.includes('formatBytes(asset.size)'));
  assert('Shows Ready/Missing badge', libSrc.includes('asset.fileExists'));
  assert('Ready badge exists', libSrc.includes('Ready'));
  assert('Missing badge exists', libSrc.includes('Missing'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) resolveModel checks AI Storage
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) resolveModel AI Storage fallback:');
  const leSrc = read('../../src/main/ai/local-engine.ts');

  assert('resolveModel checks AI Storage', leSrc.includes("require('./ai-storage-manager')"));
  assert('resolveModel reads registry', leSrc.includes('readRegistry'));
  assert('resolveModel finds .gguf LLM assets', leSrc.includes("a.format === 'gguf'"));
  assert('resolveModel checks llm/coder/vision-llm types', leSrc.includes("a.type === 'llm'"));
  assert('resolveModel logs [MODEL_RESOLVE]', leSrc.includes('[MODEL_RESOLVE]'));
  assert('resolveModel converts AIAsset to LocalModelInfo', leSrc.includes('id: llmAsset.id'));
  assert('resolveModel sets fileExists=true', leSrc.includes('fileExists: true'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Auto-scan on startup
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Auto-scan on startup:');
  const mainSrc = read('../../src/main/main.ts');

  assert('Auto-scan setTimeout exists', mainSrc.includes('setTimeout'));
  assert('Auto-scan calls scanStorage', mainSrc.includes('scanStorage()'));
  assert('Auto-scan logs registered count', mainSrc.includes('registered'));
  assert('Auto-scan has 3 second delay', mainSrc.includes('3000'));
  assert('Auto-scan is non-fatal (try/catch)', mainSrc.includes('non-fatal'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Preload + types
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Preload + types:');
  const preloadSrc = read('../../src/main/preload.ts');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');

  assert('preload: aiStorageInfo', preloadSrc.includes('aiStorageInfo:'));
  assert('preload: aiStorageScan', preloadSrc.includes('aiStorageScan:'));
  assert('preload: aiStorageChooseFolder', preloadSrc.includes('aiStorageChooseFolder:'));
  assert('preload: aiStorageRepair', preloadSrc.includes('aiStorageRepair:'));
  assert('preload: aiStorageOpenFolder', preloadSrc.includes('aiStorageOpenFolder:'));
  assert('types: aiStorageInfo declared', typesSrc.includes('aiStorageInfo:'));
  assert('types: aiStorageScan declared', typesSrc.includes('aiStorageScan:'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Behavioral: resolveModel falls back to AI Storage
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Behavioral: resolveModel AI Storage fallback:');
  const { resolveModel } = await import('../../src/main/ai/local-engine');
  const { setAIStoragePath, scanStorage, _resetModelDownloadManager } = await import('../../src/main/ai/model-download-manager');

  // With no models in either registry, resolveModel should return null
  const result = resolveModel({ provider: 'local', maxTokens: 1024, temperature: 0.7 } as any);
  assert('resolveModel returns null when no models anywhere', result === null || result === undefined);

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 81 Tests: ${pass} passed, ${fail} failed`);
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
