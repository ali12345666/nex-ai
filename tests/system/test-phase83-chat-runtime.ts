/**
 * Phase 83 — Chat Runtime Fix Tests
 *
 * Verifies:
 *   1. ai-chat-stream handler logs [MODEL_RESOLVE] with resolved/path
 *   2. ai-chat-stream handler logs [INFERENCE_START]
 *   3. ai-chat-stream handler logs [INFERENCE_ERROR] on failure
 *   4. ai-chat handler logs [CHAT_REQUEST]
 *   5. resolveModel logs when activeLocalModelId not found
 *   6. resolveModel logs error reading settings (not catch {})
 *   7. resolveModel logs error checking AI Storage (not catch {})
 *   8. Streaming handler skips reload if model already loaded
 *   9. Streaming handler gets default runtime if null
 *  10. Error message is user-friendly
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
  console.log('Phase 83 — Chat Runtime Fix Tests');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const mainSrc = read('../../src/main/main.ts');
  const leSrc = read('../../src/main/ai/local-engine.ts');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) Streaming handler diagnostics
  // ═══════════════════════════════════════════════════════════════════════
  console.log('1) Streaming handler diagnostics:');
  assert('[CHAT_REQUEST] in ai-chat-stream', mainSrc.includes('[CHAT_REQUEST]') && mainSrc.includes('panel=ai-chat-stream'));
  assert('[MODEL_RESOLVE] in streaming handler', mainSrc.includes('[MODEL_RESOLVE]'));
  assert('[MODEL_RESOLVE] logs resolved=', mainSrc.includes('resolved='));
  assert('[MODEL_RESOLVE] logs modelPath=', mainSrc.includes('modelPath='));
  assert('[MODEL_RESOLVE] logs modelName=', mainSrc.includes('modelName='));
  assert('[MODEL_RESOLVE] logs fileExists=', mainSrc.includes('fileExists='));
  assert('[INFERENCE_START] exists', mainSrc.includes('[INFERENCE_START]'));
  assert('[INFERENCE_START] logs model name', mainSrc.includes('Loading model:'));
  assert('[INFERENCE_START] logs already loaded', mainSrc.includes('Model already loaded'));
  assert('[INFERENCE_START] logs loaded successfully', mainSrc.includes('Model loaded successfully'));
  assert('[INFERENCE_START] logs chatStream start', mainSrc.includes('Starting chatStream'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Error handling
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Error handling:');
  assert('[INFERENCE_ERROR] exists', mainSrc.includes('[INFERENCE_ERROR]'));
  assert('[INFERENCE_ERROR] logs message', mainSrc.includes('message='));
  assert('[INFERENCE_ERROR] logs code', mainSrc.includes('code='));
  assert('[INFERENCE_ERROR] logs stack', mainSrc.includes('stack='));
  assert('Error message uses console.error (not console.log)', mainSrc.includes('console.error(`[INFERENCE_ERROR]'));
  assert('User-friendly error: "Activate a model"', mainSrc.includes('Activate a model in Library'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) Non-streaming handler diagnostics
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Non-streaming handler:');
  assert('[CHAT_REQUEST] in ai-chat (non-streaming)', mainSrc.includes('panel=ai-chat (non-streaming)'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) resolveModel error logging
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) resolveModel error logging:');
  assert('resolveModel logs when activeLocalModelId not found', leSrc.includes('not found in registry — falling through'));
  assert('resolveModel logs error reading settings', leSrc.includes('Error reading activeLocalModelId'));
  assert('resolveModel logs error checking AI Storage', leSrc.includes('Error checking AI Storage registry'));
  assert('resolveModel does NOT have empty catch {}', !leSrc.includes('} catch {}'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Model already loaded optimization
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Model already loaded:');
  assert('Checks getLoadedModelInfo', mainSrc.includes('getLoadedModelInfo'));
  assert('Skips reload if same model', mainSrc.includes('loadedInfo.id === model.id'));
  assert('Gets default runtime if null', mainSrc.includes('if (!runtime)'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Context size fallback
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Context size fallback:');
  assert('Uses model.contextSize || 2048', mainSrc.includes('model.contextSize || 2048'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) [CHAT_RESPONSE] logs contentLength
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Chat response logging:');
  assert('[CHAT_RESPONSE] logs contentLength', mainSrc.includes('contentLength='));

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 83 Tests: ${pass} passed, ${fail} failed`);
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
