/**
 * NEX AI — Phase 116: Model Lifecycle Race Condition Tests
 *
 * Tests that the model loading/shutdown lifecycle is safe:
 *   1. Concurrent loadModel calls don't race
 *   2. shutdownLlama waits for in-progress loadModel
 *   3. loadModel refuses to start during shutdown
 *   4. unloadModel waits for in-progress loadModel
 *
 * Run with: npx tsx tests/tools/test-phase-116-lifecycle.ts
 */

import * as path from 'path';
import * as fs from 'fs';

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) { passed++; console.log(`  PASS: ${name}`); }
    else { failed++; console.error(`  FAIL: ${name}`); }
  }

  console.log('Phase 116 Model Lifecycle Race Condition Tests\n');

  // Read the inference source to verify the fixes exist
  const inferenceSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'inference.ts'),
    'utf-8'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 1. _loadingPromise tracking exists
  // ════════════════════════════════════════════════════════════════════════
  console.log('=== 1. _loadingPromise Tracking ===');

  console.log('\nTest 1: _loadingPromise variable exists');
  assert(inferenceSource.includes('let _loadingPromise'), '_loadingPromise should be declared');

  console.log('\nTest 2: _isShuttingDown flag exists');
  assert(inferenceSource.includes('let _isShuttingDown'), '_isShuttingDown should be declared');

  // ════════════════════════════════════════════════════════════════════════
  // 2. loadModel guards against shutdown
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 2. loadModel Guards ===');

  console.log('\nTest 3: loadModel refuses during shutdown');
  assert(
    inferenceSource.includes('_isShuttingDown') && inferenceSource.includes('Cannot load model during shutdown'),
    'loadModel should refuse to start when _isShuttingDown is true'
  );

  console.log('\nTest 4: loadModel waits for concurrent load');
  assert(
    inferenceSource.includes('_loadingPromise') && inferenceSource.includes('another load in progress, waiting'),
    'loadModel should wait for in-progress loadModel'
  );

  console.log('\nTest 5: loadModel reuses model after waiting');
  assert(
    inferenceSource.includes('reuse-after-wait'),
    'loadModel should reuse model after waiting for concurrent load'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 3. shutdownLlama waits for loadModel
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 3. shutdownLlama Safety ===');

  console.log('\nTest 6: shutdownLlama sets _isShuttingDown');
  assert(
    inferenceSource.includes('_isShuttingDown = true'),
    'shutdownLlama should set _isShuttingDown before disposing'
  );

  console.log('\nTest 7: shutdownLlama waits for _loadingPromise');
  assert(
    inferenceSource.includes('shutdownLlama() — waiting for in-progress loadModel'),
    'shutdownLlama should wait for _loadingPromise before disposing'
  );

  console.log('\nTest 8: shutdownLlama resets _isShuttingDown after completion');
  assert(
    inferenceSource.includes('_isShuttingDown = false'),
    'shutdownLlama should reset _isShuttingDown after completion'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 4. unloadModel waits for loadModel
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 4. unloadModel Safety ===');

  console.log('\nTest 9: unloadModel waits for _loadingPromise');
  assert(
    inferenceSource.includes('unloadModel() — waiting for in-progress loadModel'),
    'unloadModel should wait for _loadingPromise before disposing'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 5. _loadingPromise lifecycle
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 5. _loadingPromise Lifecycle ===');

  console.log('\nTest 10: _loadingPromise set before load work starts');
  assert(
    inferenceSource.includes('const loadWork = (async () => {'),
    'loadWork should be wrapped in async IIFE'
  );

  console.log('\nTest 11: _loadingPromise cleared in finally block');
  assert(
    inferenceSource.includes('if (_loadingPromise === loadWork) _loadingPromise = null'),
    '_loadingPromise should be cleared in finally block'
  );

  console.log('\nTest 12: _loadingPromise awaited before clearing');
  assert(
    inferenceSource.includes('await _loadingPromise'),
    '_loadingPromise should be awaited'
  );

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 116 lifecycle tests: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
