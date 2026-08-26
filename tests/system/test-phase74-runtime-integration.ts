/**
 * Phase 74 — Runtime Integration Tests
 *
 * Verifies:
 *   1. resolveModel is exported from local-engine
 *   2. Chat template fix: no manual "User:/Assistant:/System:" labeling
 *   3. [CHAT_REQUEST]/[LOCAL_RUNTIME]/[CHAT_RESPONSE] diagnostics exist
 *   4. [MODEL_LOAD] log exists
 *   5. ai-chat-stream handler uses resolveModel (not undefined)
 *   6. System prompt not duplicated
 *   7. LlamaChatSession native multi-turn API used
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
  console.log('Phase 74 — Runtime Integration Tests');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) resolveModel exported from local-engine
  // ═══════════════════════════════════════════════════════════════════════
  console.log('1) resolveModel exported:');
  const leSrc = read('../../src/main/ai/local-engine.ts');

  assert('resolveModel is exported', leSrc.includes('export function resolveModel'));
  assert('resolveModel is NOT just a local function', !leSrc.includes('\nfunction resolveModel('));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Chat template fix in inference.ts
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Chat template fix:');
  const infSrc = read('../../src/main/ai/inference.ts');

  // The OLD buggy code manually labeled messages
  assert('NO manual "User:" label in chatComplete', !infSrc.includes("const label = m.role === 'user' ? 'User' : 'Assistant'"));
  assert('NO manual "System:" label duplication', !infSrc.includes("parts.push(`System: ${opts.systemPrompt}`)"));
  assert('NO "Assistant:" prompt suffix', !infSrc.includes("parts.push('Assistant:')"));

  // The NEW code uses native multi-turn API
  assert('Uses LlamaChatSession native API', infSrc.includes('new _LlamaChatSession'));
  assert('systemPrompt passed to session constructor', infSrc.includes('systemPrompt: opts.systemPrompt'));
  assert('Replays prior messages via session.prompt', infSrc.includes('Replay prior conversation'));
  assert('Uses session.prompt for final message', infSrc.includes('session.prompt(lastUserMsg.content'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) [CHAT_REQUEST]/[LOCAL_RUNTIME]/[CHAT_RESPONSE] diagnostics
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Runtime diagnostics:');
  assert('[CHAT_REQUEST] log in local-engine', leSrc.includes('[CHAT_REQUEST]'));
  assert('[CHAT_REQUEST] logs panel', leSrc.includes('panel='));
  assert('[CHAT_REQUEST] logs provider', leSrc.includes('provider=local'));
  assert('[CHAT_REQUEST] logs modelId', leSrc.includes('modelId='));
  assert('[CHAT_REQUEST] logs modelPath', leSrc.includes('modelPath='));
  assert('[LOCAL_RUNTIME] log exists', leSrc.includes('[LOCAL_RUNTIME]'));
  assert('[LOCAL_RUNTIME] logs loaded', leSrc.includes('loaded='));
  assert('[LOCAL_RUNTIME] logs backend', leSrc.includes('backend=node-llama-cpp'));
  assert('[LOCAL_RUNTIME] logs contextSize', leSrc.includes('contextSize='));
  assert('[LOCAL_RUNTIME] logs tokensGenerated', leSrc.includes('tokensGenerated='));
  assert('[CHAT_RESPONSE] log exists', leSrc.includes('[CHAT_RESPONSE]'));
  assert('[CHAT_RESPONSE] logs source', leSrc.includes('source=local'));
  assert('[CHAT_RESPONSE] logs tokens', leSrc.includes('tokens='));
  assert('[CHAT_RESPONSE] logs error', leSrc.includes('error='));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) [MODEL_LOAD] log
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) [MODEL_LOAD] log:');
  assert('[MODEL_LOAD] log exists', infSrc.includes('[MODEL_LOAD]'));
  assert('[MODEL_LOAD] logs path', infSrc.includes('path=${model.path}'));
  assert('[MODEL_LOAD] logs size', infSrc.includes('size=${model.sizeBytes}'));
  assert('[MODEL_LOAD] logs contextSize', infSrc.includes('contextSize=${opts'));
  assert('[MODEL_LOAD] logs gpuLayers', infSrc.includes('gpuLayers=${opts'));
  assert('[MODEL_LOAD] logs modelId', infSrc.includes('modelId=${model.id}'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) ai-chat-stream handler uses resolveModel
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) ai-chat-stream handler:');
  const mainSrc = read('../../src/main/main.ts');

  assert('ai-chat-stream imports resolveModel', mainSrc.includes("const { resolveModel } = await import('./ai/local-engine')"));
  assert('ai-chat-stream calls resolveModel(config)', mainSrc.includes('resolveModel(config)'));
  assert('ai-chat-stream has [CHAT_REQUEST] log', mainSrc.includes('[CHAT_REQUEST]'));
  assert('ai-chat-stream has [CHAT_RESPONSE] log', mainSrc.includes('[CHAT_RESPONSE]'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) No mock/demo providers
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) No mock/demo providers:');
  assert('NO mock provider in ai-service', !read('../../src/main/ai-service.ts').toLowerCase().includes('mockprovider'));
  assert('NO demo provider in provider.ts', !read('../../src/main/ai/provider.ts').toLowerCase().includes('demoprovider'));
  assert('inference.ts uses node-llama-cpp', infSrc.includes('node-llama-cpp') || infSrc.includes("import('node-llama-cpp')"));
  assert('inference.ts has REAL local AI comment', infSrc.includes('REAL local AI'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Behavioral: resolveModel returns null when no models
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Behavioral: resolveModel:');
  const { resolveModel } = await import('../../src/main/ai/local-engine');

  // With no models registered, should return null
  const result = resolveModel({ provider: 'local', maxTokens: 1024, temperature: 0.7 });
  assert('resolveModel returns null when no models registered', result === null);

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 74 Tests: ${pass} passed, ${fail} failed`);
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
