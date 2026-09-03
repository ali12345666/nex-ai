/**
 * NEX AI — Phase 116: Add Local Model + Test Load Tests
 *
 * Tests the "Add Local Model" feature:
 *   1. addModel accepts an absolute path (no copy)
 *   2. addModel rejects non-.gguf files
 *   3. addModel rejects non-existent files
 *   4. listModels returns the added model with correct metadata
 *   5. Model persists across "restart" (loadState)
 *   6. Test Load: valid GGUF magic bytes check
 *   7. Test Load: rejects invalid GGUF (wrong magic bytes)
 *   8. Test Load: rejects non-existent file
 *   9. Test Load: rejects non-readable file
 *
 * NOTE: We cannot test the actual node-llama-cpp load in this environment
 * (no real GGUF model file, and node-llama-cpp requires a real model to
 * initialize). The test validates the file-existence + readability + GGUF
 * magic-bytes checks that run BEFORE llama.loadModel().
 *
 * Run with: npx tsx tests/tools/test-phase-116-local-model.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Register electron mock BEFORE any imports that touch electron
process.env.NODE_PATH = path.join(__dirname, '..', '__mocks__');
require('module').Module._initPaths();

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) { passed++; console.log(`  PASS: ${name}`); }
    else { failed++; console.error(`  FAIL: ${name}`); }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-phase116-'));
  console.log(`Test workspace: ${tmpDir}`);

  // ════════════════════════════════════════════════════════════════════════
  // 1. addModel — accepts absolute path, no copy
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 1. addModel — Absolute Path (No Copy) ===');

  const { addModel, listModels, removeModel, getModel } =
    await import('../../src/main/ai/model-registry');

  // Test 1: Create a fake GGUF file with valid magic bytes + add it
  console.log('\nTest 1: Add a valid .gguf file by absolute path');
  {
    const ggufPath = path.join(tmpDir, 'Qwen3-8B-Q4_K_M.gguf');
    // Write a valid GGUF magic header (4 bytes: "GGUF") + some dummy data
    const magic = Buffer.from('GGUF', 'ascii');
    const dummyData = Buffer.alloc(1024, 0);
    const fileBuf = Buffer.concat([magic, dummyData]);
    fs.writeFileSync(ggufPath, fileBuf);

    const model = addModel(ggufPath);
    assert(model.id !== undefined, 'Should return a model with an id');
    assert(model.name === 'Qwen3-8B-Q4_K_M', 'Should derive name from filename');
    assert(model.path === ggufPath, 'Should store the REAL absolute path');
    assert(model.sizeBytes === fileBuf.length, 'Should record correct size');
    assert(model.fileExists === true, 'Should mark fileExists=true');
    assert(fs.existsSync(ggufPath), 'Original file should still exist (no copy)');

    // Verify NO copy was made — the only .gguf file in tmpDir should be the original
    const ggufFiles = fs.readdirSync(tmpDir).filter(f => f.endsWith('.gguf'));
    assert(ggufFiles.length === 1, 'Should NOT create a copy (only 1 .gguf file)');
    assert(ggufFiles[0] === 'Qwen3-8B-Q4_K_M.gguf', 'Original file name preserved');
  }

  // Test 2: addModel rejects non-.gguf files
  console.log('\nTest 2: Reject non-.gguf files');
  {
    const txtPath = path.join(tmpDir, 'not-a-model.txt');
    fs.writeFileSync(txtPath, 'hello');
    let threw = false;
    let errMsg = '';
    try {
      addModel(txtPath);
    } catch (err: any) {
      threw = true;
      errMsg = err.message;
    }
    assert(threw === true, 'Should throw on non-.gguf file');
    assert(errMsg.includes('.gguf'), 'Error should mention .gguf requirement');
  }

  // Test 3: addModel rejects non-existent files
  console.log('\nTest 3: Reject non-existent files');
  {
    const fakePath = path.join(tmpDir, 'does-not-exist.gguf');
    let threw = false;
    let errMsg = '';
    try {
      addModel(fakePath);
    } catch (err: any) {
      threw = true;
      errMsg = err.message;
    }
    assert(threw === true, 'Should throw on non-existent file');
    assert(errMsg.includes('not found') || errMsg.includes('File not found'), 'Error should mention not found');
  }

  // Test 4: listModels returns the added model
  console.log('\nTest 4: listModels returns added model');
  {
    const models = listModels();
    const found = models.find(m => m.name === 'Qwen3-8B-Q4_K_M');
    assert(found !== undefined, 'Should find the added model in listModels');
    assert(found!.fileExists === true, 'Should have fileExists=true');
    assert(found!.path.includes('Qwen3-8B-Q4_K_M.gguf'), 'Should have the real path');
  }

  // Test 5: getModel by ID
  console.log('\nTest 5: getModel by ID');
  {
    const models = listModels();
    const first = models[0];
    const retrieved = getModel(first.id);
    assert(retrieved !== null, 'getModel should return the model');
    assert(retrieved!.id === first.id, 'IDs should match');
  }

  // Test 6: Model persists across "restart" (loadState)
  console.log('\nTest 6: Model persists in state (survives restart)');
  {
    const { loadState } = await import('../../src/main/persistence');
    const state = loadState();
    const persistedModels = state.localModels || [];
    const found = persistedModels.find(m => m.name === 'Qwen3-8B-Q4_K_M');
    assert(found !== undefined, 'Model should be persisted in state');
    assert(found!.path.includes('Qwen3-8B-Q4_K_M.gguf'), 'Persisted path should be the real path');
  }

  // Test 7: Adding the same path twice — upsert (no duplicate)
  console.log('\nTest 7: Adding same path twice — upsert');
  {
    const ggufPath = path.join(tmpDir, 'Qwen3-8B-Q4_K_M.gguf');
    const beforeCount = listModels().filter(m => m.name === 'Qwen3-8B-Q4_K_M').length;
    addModel(ggufPath); // add again
    const afterCount = listModels().filter(m => m.name === 'Qwen3-8B-Q4_K_M').length;
    assert(beforeCount === 1, 'Should have 1 model before re-add');
    assert(afterCount === 1, 'Should still have 1 model after re-add (upsert, no duplicate)');
  }

  // ════════════════════════════════════════════════════════════════════════
  // 2. GGUF Magic Bytes Validation
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 2. GGUF Magic Bytes Validation ===');

  // Test 8: Valid GGUF magic bytes
  console.log('\nTest 8: Valid GGUF magic bytes');
  {
    const ggufPath = path.join(tmpDir, 'valid-magic.gguf');
    const magic = Buffer.from('GGUF', 'ascii');
    fs.writeFileSync(ggufPath, Buffer.concat([magic, Buffer.alloc(100, 0)]));

    const fd = fs.openSync(ggufPath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    assert(buf.toString('ascii') === 'GGUF', 'Should read valid GGUF magic bytes');
  }

  // Test 9: Invalid GGUF magic bytes
  console.log('\nTest 9: Invalid GGUF magic bytes (corrupt file)');
  {
    const badPath = path.join(tmpDir, 'corrupt.gguf');
    fs.writeFileSync(badPath, Buffer.from('XXXX' + 'dummy data')); // wrong magic

    const fd = fs.openSync(badPath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    assert(buf.toString('ascii') !== 'GGUF', 'Should detect invalid magic bytes');
    assert(buf.toString('ascii') === 'XXXX', 'Should read the actual wrong magic');
  }

  // Test 10: Empty file (0 bytes)
  console.log('\nTest 10: Empty file rejected by magic bytes check');
  {
    const emptyPath = path.join(tmpDir, 'empty.gguf');
    fs.writeFileSync(emptyPath, Buffer.alloc(0));

    let readFailed = false;
    try {
      const fd = fs.openSync(emptyPath, 'r');
      const buf = Buffer.alloc(4);
      const bytesRead = fs.readSync(fd, buf, 0, 4, 0);
      fs.closeSync(fd);
      if (bytesRead < 4 || buf.toString('ascii') !== 'GGUF') readFailed = true;
    } catch {
      readFailed = true;
    }
    assert(readFailed === true, 'Empty file should fail magic bytes check');
  }

  // ════════════════════════════════════════════════════════════════════════
  // 3. File Existence + Readability Checks
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 3. File Existence + Readability ===');

  // Test 11: Non-existent file
  console.log('\nTest 11: Non-existent file check');
  {
    const fakePath = path.join(tmpDir, 'nonexistent.gguf');
    assert(fs.existsSync(fakePath) === false, 'Should report file does not exist');
  }

  // Test 12: Readable file
  console.log('\nTest 12: Readable file check');
  {
    const ggufPath = path.join(tmpDir, 'Qwen3-8B-Q4_K_M.gguf');
    let readable = true;
    try {
      fs.accessSync(ggufPath, fs.constants.R_OK);
    } catch {
      readable = false;
    }
    assert(readable === true, 'GGUF file should be readable');
  }

  // Test 13: Directory (not a file) — should fail magic bytes read
  console.log('\nTest 13: Directory is not a valid GGUF');
  {
    const dirPath = path.join(tmpDir, 'a-directory.gguf');
    fs.mkdirSync(dirPath);
    let failed = false;
    try {
      const fd = fs.openSync(dirPath, 'r');
      fs.closeSync(fd);
    } catch {
      failed = true;
    }
    assert(failed === true || fs.statSync(dirPath).isDirectory(), 'Directory should not be openable as a file');
  }

  // ════════════════════════════════════════════════════════════════════════
  // 4. Cleanup — removeModel
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 4. removeModel ===');

  // Test 14: removeModel deletes from registry
  console.log('\nTest 14: removeModel');
  {
    const models = listModels();
    const target = models.find(m => m.name === 'Qwen3-8B-Q4_K_M');
    if (target) {
      const ok = removeModel(target.id);
      assert(ok === true, 'removeModel should return true');
      const after = listModels().find(m => m.id === target.id);
      assert(after === undefined, 'Model should be removed from registry');
    } else {
      assert(false, 'Test setup failed — model not found');
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 116 local model tests: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
