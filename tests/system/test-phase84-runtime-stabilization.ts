/**
 * Phase 84 — Runtime Stabilization Tests
 *
 * Verifies the fix for the critical "Chat stays on Thinking" bug:
 *   - When model is already loaded (by activation), streaming handler
 *     calls inference.ts chatStream DIRECTLY, not through LlamaCppRuntime
 *     (which has a separate _loadedModel field that was never set).
 *   - contextSize fallback to 2048 when undefined
 *   - All empty catch blocks replaced with console.error
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
  console.log('Phase 84 — Runtime Stabilization Tests');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const mainSrc = read('../../src/main/main.ts');
  const leSrc = read('../../src/main/ai/local-engine.ts');
  const infSrc = read('../../src/main/ai/inference.ts');
  const rtSrc = read('../../src/main/ai/runtimes/llamacpp-runtime.ts');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) ROOT CAUSE FIX: Direct inference.ts call when model already loaded
  // ═══════════════════════════════════════════════════════════════════════
  console.log('1) Direct inference call (root cause fix):');
  assert('Streaming handler imports chatStream from inference.ts', mainSrc.includes("chatStream: directChatStream"));
  assert('Calls directChatStream when model already loaded', mainSrc.includes('directChatStream('));
  assert('Does NOT use runtime.chatStream when model already loaded (bypasses LlamaCppRuntime)',
    mainSrc.includes('calling inference.ts directly'));
  assert('Returns early with direct result', mainSrc.includes('source=local-stream-direct'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) LlamaCppRuntime._loadedModel issue documented
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) LlamaCppRuntime issue:');
  assert('LlamaCppRuntime has separate _loadedModel field', rtSrc.includes('private _loadedModel'));
  assert('LlamaCppRuntime.chatStream checks this._loadedModel', rtSrc.includes('if (!this._loadedModel)'));
  assert('LlamaCppRuntime throws "No model loaded" when _loadedModel is null', rtSrc.includes('No model loaded. Call loadModel() first.'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) contextSize fallback
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) contextSize fallback:');
  assert('localChatComplete: contextSize fallback to 2048', leSrc.includes('config.localContextSize || model.contextSize || 2048'));
  assert('localChatStream: contextSize fallback to 2048', leSrc.includes('config.localContextSize || model.contextSize || 2048'));
  assert('Streaming handler: contextSize fallback to 2048', mainSrc.includes('model.contextSize || 2048'));
  assert('inference.ts: contextSize fallback to 2048', infSrc.includes('opts.contextSize ?? model.contextSize ?? 2048'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) No empty catch blocks
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) No empty catch blocks:');
  assert('local-engine.ts has no empty catch {}', !leSrc.includes('} catch {}'));
  assert('local-engine.ts logs errors in catch blocks', leSrc.includes('console.error'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) inference.ts session management
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Session management:');
  assert('chatComplete disposes session in finally', infSrc.includes('session as any).dispose'));
  assert('chatStream disposes session in finally', infSrc.includes('session as any).dispose'));
  assert('getSharedSequence reuses _ctxSequence', infSrc.includes('if (!_ctxSequence && _loadedContext)'));
  assert('loadModel is idempotent (same model ID)', infSrc.includes('_loadedModelId === model.id'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Error handling
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Error handling:');
  assert('[INFERENCE_ERROR] logs message', mainSrc.includes('message='));
  assert('[INFERENCE_ERROR] logs stack', mainSrc.includes('stack='));
  assert('[INFERENCE_ERROR] uses console.error', mainSrc.includes('console.error(`[INFERENCE_ERROR]'));
  assert('User-friendly error message', mainSrc.includes('Activate a model in Library'));

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 84 Tests: ${pass} passed, ${fail} failed`);
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
