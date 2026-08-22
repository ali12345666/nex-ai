/**
 * Phase 3 — Local AI Core Tests (Part A: Model Registry)
 *
 * Verifies the model registry without actually running inference.
 *
 * Run with: npx tsx tests/local-ai/test-registry.ts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Stub Electron (no real app needed for these tests)
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (name: string) {
  if (name === 'electron') {
    return {
      app: { isPackaged: false, getPath: () => path.join(os.tmpdir(), 'nex-test-' + Date.now()) },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(s, 'utf-8'),
        decryptString: (b: Buffer) => b.toString('utf-8'),
      },
    };
  }
  return originalRequire.apply(this, arguments);
};

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else      { fail++; console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main() {
  const { initPersistence } = require('../../src/main/persistence');
  const { addModel, removeModel, listModels, getModel, updateModel, getDefaultModel, touchModel } =
    require('../../src/main/ai/model-registry');

  console.log('\n=== Phase 3 Model Registry Tests ===\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-models-'));
  initPersistence(tmpDir);

  const fakeGgufPath = path.join(tmpDir, 'fake-model.gguf');
  fs.writeFileSync(fakeGgufPath, Buffer.alloc(1024 * 100, 0));

  // ── 1. addModel ──
  console.log('1. Add model:');
  const model1 = addModel(fakeGgufPath, { name: 'Fake Model', contextSize: 1024, category: 'coding' });
  assert('model gets a UUID id', !!model1.id && model1.id.length > 0);
  assert('model has name', model1.name === 'Fake Model');
  assert('model has correct path', model1.path === fakeGgufPath);
  assert('model has sizeBytes > 0', model1.sizeBytes === 1024 * 100);
  assert('model has contextSize', model1.contextSize === 1024);
  assert('model has category', model1.category === 'coding');
  assert('model has addedAt', model1.addedAt > 0);

  // ── 2. listModels ──
  console.log('\n2. List models:');
  const all = listModels();
  assert('listModels returns 1 entry', all.length === 1);
  assert('listed model has fileExists=true', all[0].fileExists === true);

  // ── 3. getModel ──
  console.log('\n3. Get model by id:');
  const fetched = getModel(model1.id);
  assert('getModel returns the right model', fetched?.id === model1.id);
  assert('getModel returns null for unknown id', getModel('nonexistent-id') === null);

  // ── 4. updateModel ──
  console.log('\n4. Update model:');
  const updated = updateModel(model1.id, { name: 'Renamed Model', gpuLayers: 0 });
  assert('update returns new name', updated?.name === 'Renamed Model');
  assert('update sets gpuLayers', updated?.gpuLayers === 0);
  assert('update preserves id', updated?.id === model1.id);

  // ── 5. getDefaultModel ──
  console.log('\n5. Default model selection:');
  const def = getDefaultModel();
  assert('getDefaultModel returns the only model', def?.id === model1.id);

  // Add a second model and mark it as more recently used
  const fakeGguf2 = path.join(tmpDir, 'fake-model-2.gguf');
  fs.writeFileSync(fakeGguf2, Buffer.alloc(1024 * 200, 0));
  const model2 = addModel(fakeGguf2, { name: 'Second Model' });
  touchModel(model2.id);
  const def2 = getDefaultModel();
  assert('getDefaultModel returns most-recently-used', def2?.id === model2.id);

  // ── 6. removeModel ──
  console.log('\n6. Remove model:');
  const removed = removeModel(model1.id);
  assert('removeModel returns true on success', removed === true);
  assert('removeModel returns false for unknown id', removeModel('nonexistent') === false);
  assert('listModels shows 1 after remove', listModels().length === 1);
  assert('removed model file still exists on disk', fs.existsSync(fakeGgufPath));

  // ── 7. fileExists flag ──
  console.log('\n7. fileExists flag:');
  const orphanPath = path.join(tmpDir, 'orphan.gguf');
  fs.writeFileSync(orphanPath, Buffer.alloc(1024, 0));
  const orphan = addModel(orphanPath);
  fs.unlinkSync(orphanPath);
  const orphanList = listModels();
  const found = orphanList.find((m: any) => m.id === orphan.id);
  assert('missing file is flagged fileExists=false', found?.fileExists === false);

  // ── 8. Validation ──
  console.log('\n8. Input validation:');
  try {
    addModel('/nonexistent/path.gguf');
    assert('addModel rejects nonexistent file', false);
  } catch (err: any) {
    assert('addModel rejects nonexistent file', err.message.includes('not found'));
  }
  try {
    addModel(path.join(tmpDir, 'not-gguf.txt'));
    assert('addModel rejects non-.gguf extension', false);
  } catch (err: any) {
    assert('addModel rejects non-.gguf extension', err.message.includes('.gguf'));
  }
  try {
    addModel(fakeGguf2);
    assert('addModel rejects duplicate path', false);
  } catch (err: any) {
    assert('addModel rejects duplicate path', err.message.includes('already registered'));
  }

  fs.rmSync(tmpDir, { recursive: true });

  console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
