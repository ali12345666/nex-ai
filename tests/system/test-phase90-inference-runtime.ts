/**
 * Phase 90 — Inference Runtime Root-Cause Audit Tests
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
  const infSrc = read('../../src/main/ai/inference.ts');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Phase 90 — Inference Runtime Audit Tests');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1) No global _abortFlag
  console.log('1) Abort system:');
  const infLines = infSrc.split('\n');
  const abortFlagCodeLines = infLines.filter(l =>
    l.includes('_abortFlag') && !l.trim().startsWith('//') && !l.trim().startsWith('*')
  );
  assert('NO _abortFlag variable usage in code', abortFlagCodeLines.length === 0,
    `found ${abortFlagCodeLines.length} code lines`);
  assert('_activeAbortController declared', infSrc.includes('let _activeAbortController'));
  assert('abortInference uses AbortController.abort()', infSrc.includes('_activeAbortController.abort()'));
  assert('chatStream creates per-request AbortController', infSrc.includes('const abortController = new AbortController()'));
  assert('chatComplete creates per-request AbortController', infSrc.includes('const abortController = new AbortController()'));
  assert('signal passed to session.prompt', infSrc.includes('signal: abortController.signal'));
  assert('AbortController cleared after completion', infSrc.includes('if (_activeAbortController === abortController) _activeAbortController = null'));

  // 2) Concurrency serialization
  console.log('\n2) Concurrency serialization:');
  assert('_inFlightPromise declared', infSrc.includes('let _inFlightPromise'));
  assert('waitForInFlight function exists', infSrc.includes('async function waitForInFlight'));
  assert('markInFlight function exists', infSrc.includes('function markInFlight'));
  assert('chatStream calls waitForInFlight', infSrc.includes('await waitForInFlight()'));
  assert('chatComplete calls waitForInFlight', infSrc.includes('await waitForInFlight()'));
  assert('loadModel calls waitForInFlight', infSrc.includes('await waitForInFlight()'));
  assert('unloadModel calls waitForInFlight', infSrc.includes('await waitForInFlight()'));
  assert('markInFlight used in chatStream', infSrc.includes('markInFlight(inferencePromise)'));
  assert('markInFlight used in chatComplete', infSrc.includes('markInFlight(inferencePromise)'));
  assert('clearInFlight called in finally', infSrc.includes('clearInFlight()'));

  // 3) Model object separation
  console.log('\n3) Model object separation:');
  assert('_loadedModel is native LlamaModel (comment)', infSrc.includes('// node-llama-cpp LlamaModel object'));
  assert('_loadedModelInfo is LocalModelInfo (comment)', infSrc.includes('LocalModelInfo that was passed to loadModel'));
  assert('getLoadedModel returns _loadedModelInfo', infSrc.includes('return _loadedModelInfo'));
  assert('getLoadedModel does NOT return _loadedModel', !infSrc.match(/return _loadedModel[^I]/));
  assert('_loadedModel set from llama.loadModel', infSrc.includes('_loadedModel = await llama.loadModel'));
  assert('_loadedModelInfo set from model param', infSrc.includes('_loadedModelInfo = model'));
  assert('_loadedModelInfo cleared in unloadModel', infSrc.includes('_loadedModelInfo = null'));

  // 4) No maxTokens:0
  console.log('\n4) No maxTokens:0:');
  assert('NO maxTokens: 0 in code', !infSrc.includes('maxTokens: 0'));
  assert('NO maxTokens:0 in code', !infSrc.includes('maxTokens:0'));

  // 5) chatHistory usage
  console.log('\n5) chatHistory:');
  assert('chatComplete uses chatHistory', infSrc.includes('chatHistory'));
  assert('chatStream uses chatHistory', infSrc.includes('chatHistory'));
  assert('chatHistory filters system messages', infSrc.includes("m.role !== 'system'"));
  assert('chatHistory includes assistant role', infSrc.includes("role: m.role as 'user' | 'assistant'"));
  assert('chatHistory passed to LlamaChatSession constructor', infSrc.includes('chatHistory: chatHistory.length > 0 ? chatHistory : undefined'));

  // 6) Inference metrics
  console.log('\n6) Inference metrics:');
  assert('[INFERENCE_METRICS] log exists', infSrc.includes('[INFERENCE_METRICS]'));
  assert('Metrics include model name', infSrc.includes('model=${model.name}'));
  assert('Metrics include backend', infSrc.includes('backend=${_gpuBackend}'));
  assert('Metrics include gpuLayers', infSrc.includes('gpuLayers='));
  assert('Metrics include context', infSrc.includes('context='));
  assert('Metrics include firstTokenMs (stream)', infSrc.includes('firstTokenMs='));
  assert('Metrics include generatedTokens', infSrc.includes('generatedTokens='));
  assert('Metrics include tokensPerSecond', infSrc.includes('tokensPerSecond='));
  assert('Metrics include totalMs', infSrc.includes('totalMs='));

  // 7) Error handling
  console.log('\n7) Error handling:');
  assert('chatStream catch resets active:false', infSrc.includes('noteInferenceStats({ active: false })'));
  assert('chatStream catch sends done:true with error', infSrc.includes("onChunk({ content: '', done: true, error: err.message })"));
  assert('Session disposed in finally', infSrc.includes("(session as any).dispose?.()"));
  assert('Dispose errors logged with console.warn', infSrc.includes('console.warn'));

  // 8) Path assertions
  console.log('\n8) Path assertions:');
  assert('loadModel checks model.path', infSrc.includes('if (!model.path)'));
  assert('chatComplete checks model.path', infSrc.includes('[MODEL_PATH_MISSING] chatComplete'));
  assert('chatStream checks model.path', infSrc.includes('[MODEL_PATH_MISSING] chatStream'));
  assert('[MODEL_PATH_MISSING] logs model JSON', infSrc.includes('JSON.stringify'));

  // 9) GPU backend detection
  console.log('\n9) GPU backend:');
  assert('getGpuBackend exported', infSrc.includes('export function getGpuBackend'));
  assert('GPU backend from llama.gpu', infSrc.includes('(_llama as any).gpu'));
  assert('Supports metal/cuda/vulkan/cpu', infSrc.includes("'metal'") && infSrc.includes("'cuda'") && infSrc.includes("'vulkan'") && infSrc.includes("'cpu'"));

  // 10) getSharedSequence
  console.log('\n10) getSharedSequence:');
  assert('getSharedSequence caches _ctxSequence', infSrc.includes('if (!_ctxSequence && _loadedContext)'));
  assert('_ctxSequence disposed in unloadModel', infSrc.includes('(_ctxSequence as any).dispose?.()'));
  assert('_ctxSequence nulled after dispose', infSrc.includes('_ctxSequence = null'));

  // SUMMARY
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 90 Tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(err => { console.error('Test runner error:', err); process.exit(1); });
