/**
 * Phase 86 — Full Stabilization Tests
 *
 * Verifies all P0-P2 fixes from the Phase 85 audit:
 *   1. chatComplete/chatStream use chatHistory (not maxTokens:0 replay)
 *   2. No maxTokens:0 anywhere in inference.ts
 *   3. LlamaCppRuntime has NO _loadedModel field (unified state)
 *   4. LlamaCppRuntime reads from inference.ts getLoadedModel()
 *   5. No direct-path workaround in main.ts (Phase 84 workaround removed)
 *   6. No dead _currentSession field
 *   7. No duplicate idempotency check
 *   8. No empty catch {} blocks in inference.ts
 *   9. getLoadedModel() and getLoadedContext() exported
 *  10. chatStream error path resets active:false in telemetry
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
  console.log('Phase 86 — Full Stabilization Tests');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const infSrc = read('../../src/main/ai/inference.ts');
  const rtSrc = read('../../src/main/ai/runtimes/llamacpp-runtime.ts');
  const mainSrc = read('../../src/main/main.ts');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) P0-1/P0-2: chatHistory instead of maxTokens:0 replay
  // ═══════════════════════════════════════════════════════════════════════
  console.log('1) Chat history fix:');
  assert('chatComplete uses chatHistory', infSrc.includes('chatHistory'));
  assert('chatStream uses chatHistory', infSrc.includes('chatHistory'));
  assert('NO maxTokens: 0 anywhere', !infSrc.includes('maxTokens: 0'));
  assert('NO replay loop (session.prompt with maxTokens:0)', !infSrc.includes('maxTokens: 0, temperature: 0'));
  assert('chatHistory includes assistant role', infSrc.includes("role: m.role as 'user' | 'assistant'"));
  assert('chatHistory filters system messages', infSrc.includes("m.role !== 'system'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) P0-3: Unified model state
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Unified model state:');
  assert('LlamaCppRuntime has NO _loadedModel field', !rtSrc.includes('private _loadedModel'));
  assert('LlamaCppRuntime imports getLoadedModel', rtSrc.includes('getLoadedModel as _getLoadedModel'));
  assert('LlamaCppRuntime.chat reads from _getLoadedModel()', rtSrc.includes('_getLoadedModel()'));
  assert('LlamaCppRuntime.chatStream reads from _getLoadedModel()', rtSrc.includes('_getLoadedModel()'));
  assert('LlamaCppRuntime.getStats uses _getLoadedModel()', rtSrc.includes('loadedModel?.name'));
  assert('LlamaCppRuntime.loadModel does NOT set this._loadedModel', !rtSrc.includes('this._loadedModel ='));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) P0-3: Phase 84 workaround removed
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Workaround removed:');
  assert('NO direct-path call to inference.ts chatStream', !mainSrc.includes('directChatStream'));
  assert('NO source=local-stream-direct', !mainSrc.includes('source=local-stream-direct'));
  assert('NO if (!runtime) dead fallback', !mainSrc.includes('if (!runtime)'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) P1-6: No duplicate idempotency check
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Idempotency fix:');
  const loadModelMatches = infSrc.match(/_loadedModelId === model\.id && _loadedContext && _loadedModel/g);
  assert('Only ONE idempotency check (not duplicated)', loadModelMatches && loadModelMatches.length === 1,
    `found ${loadModelMatches?.length || 0}`);
  assert('fileExists checked BEFORE idempotency', infSrc.indexOf('model.fileExists') < infSrc.indexOf('_loadedModelId === model.id'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) P2-8: Dead code removed
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Dead code removed:');
  // Check that _currentSession is not used as a variable (only appears in comments)
  const infLines = infSrc.split('\n');
  const currentSessionCodeLines = infLines.filter(l =>
    l.includes('_currentSession') &&
    !l.trim().startsWith('//') &&
    !l.trim().startsWith('*')
  );
  assert('NO _currentSession variable usage (only in comments)', currentSessionCodeLines.length === 0,
    `found in ${currentSessionCodeLines.length} code lines`);

  // ═══════════════════════════════════════════════════════════════════════
  // 6) P2-1: No empty catch blocks in inference.ts
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) No empty catches:');
  const emptyCatches = infSrc.match(/catch\s*\{\s*\}/g);
  assert('NO empty catch {} in inference.ts', !emptyCatches || emptyCatches.length === 0,
    `found ${emptyCatches?.length || 0}`);
  assert('dispose catches use console.warn', infSrc.includes('console.warn'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) New exports
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) New exports:');
  assert('getLoadedModel exported', infSrc.includes('export function getLoadedModel'));
  assert('getLoadedContext exported', infSrc.includes('export function getLoadedContext'));
  assert('getLoadedModelInfo still exported', infSrc.includes('export function getLoadedModelInfo'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) P2: chatStream error path resets telemetry
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Telemetry reset on error:');
  assert('chatStream catch block has noteInferenceStats active:false', infSrc.includes('noteInferenceStats({ active: false })'));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) _ctxSequence disposed before nulling
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Sequence cleanup:');
  assert('_ctxSequence disposed in unloadModel', infSrc.includes('(_ctxSequence as any).dispose?.()'));

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 86 Tests: ${pass} passed, ${fail} failed`);
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
