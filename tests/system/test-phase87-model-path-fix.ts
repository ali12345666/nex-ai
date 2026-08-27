/**
 * Phase 87 — Model Path Loss Fix Tests
 *
 * Root cause: inference.ts _loadedModel stores the node-llama-cpp LlamaModel
 * object (not LocalModelInfo). getLoadedModel() returned _loadedModel which
 * is the LlamaModel — it has no .path, .id, .fileExists, etc. When
 * LlamaCppRuntime.chatStream() called _chatStream(loadedModel, ...), the
 * loadedModel was the LlamaModel object, not LocalModelInfo, so
 * loadModel(loadedModel) checked loadedModel.fileExists (undefined) →
 * threw "Model file does not exist: undefined".
 *
 * Fix: Added _loadedModelInfo field that stores the LocalModelInfo passed
 * to loadModel(). getLoadedModel() returns _loadedModelInfo, not _loadedModel.
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
  console.log('Phase 87 — Model Path Loss Fix Tests');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const infSrc = read('../../src/main/ai/inference.ts');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) _loadedModelInfo field exists
  // ═══════════════════════════════════════════════════════════════════════
  console.log('1) _loadedModelInfo field:');
  assert('_loadedModelInfo declared', infSrc.includes('let _loadedModelInfo: LocalModelInfo | null'));
  assert('_loadedModelInfo set in loadModel', infSrc.includes('_loadedModelInfo = model'));
  assert('_loadedModelInfo set on idempotent path', infSrc.includes('// Phase 87: Update the stored LocalModelInfo even on idempotent path'));
  assert('_loadedModelInfo cleared in unloadModel', infSrc.includes('_loadedModelInfo = null;'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) getLoadedModel returns _loadedModelInfo (not _loadedModel)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) getLoadedModel returns LocalModelInfo:');
  assert('getLoadedModel checks _loadedModelInfo', infSrc.includes('!_loadedModelId || !_loadedModelInfo'));
  assert('getLoadedModel returns _loadedModelInfo', infSrc.includes('return _loadedModelInfo'));
  assert('getLoadedModel does NOT return _loadedModel', !infSrc.match(/return _loadedModel[^I]/));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) Path assertions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Path assertions:');
  assert('loadModel checks model.path', infSrc.includes('if (!model.path)'));
  assert('loadModel logs [MODEL_PATH_MISSING]', infSrc.includes('[MODEL_PATH_MISSING]'));
  assert('chatComplete checks model.path', infSrc.includes('[MODEL_PATH_MISSING] chatComplete'));
  assert('chatStream checks model.path', infSrc.includes('[MODEL_PATH_MISSING] chatStream'));
  assert('Error message mentions "no path"', infSrc.includes('has no path'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) LlamaCppRuntime uses getLoadedModel (which returns LocalModelInfo)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) LlamaCppRuntime uses correct model:');
  const rtSrc = read('../../src/main/ai/runtimes/llamacpp-runtime.ts');
  assert('LlamaCppRuntime imports getLoadedModel', rtSrc.includes('getLoadedModel as _getLoadedModel'));
  assert('chatStream uses _getLoadedModel()', rtSrc.includes('const loadedModel = _getLoadedModel()'));
  assert('chat uses _getLoadedModel()', rtSrc.includes('_getLoadedModel()'));
  assert('getStats uses _getLoadedModel()', rtSrc.includes('const loadedModel = _getLoadedModel()'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) No stale _loadedModel returned as LocalModelInfo
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) No stale model object:');
  // _loadedModel is the node-llama-cpp LlamaModel — should NOT be returned by getLoadedModel
  assert('_loadedModel is separate from _loadedModelInfo', infSrc.includes('// node-llama-cpp LlamaModel object'));
  assert('Comment explains the difference', infSrc.includes('LocalModelInfo that was passed to loadModel'));

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 87 Tests: ${pass} passed, ${fail} failed`);
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
