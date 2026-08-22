/**
 * Phase 3 — Local AI Core Tests (Part B: Real Inference)
 *
 * Loads a real GGUF model and runs a chat completion.
 * Verifies that NEX AI can do AI inference WITHOUT any external API.
 *
 * Prerequisite: model file at /home/z/my-project/repos/nex-ai/models/qwen2.5-0.5b-q4_k_m.gguf
 *
 * Run with: node --import tsx tests/local-ai/test-inference.mts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Stub Electron
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

const MODEL_PATH = '/home/z/my-project/repos/nex-ai/models/qwen2.5-0.5b-q4_k_m.gguf';

async function main() {
  console.log('\n=== Phase 3 Real Inference Tests ===\n');

  if (!fs.existsSync(MODEL_PATH)) {
    console.error(`Model file not found: ${MODEL_PATH}`);
    process.exit(1);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-infer-'));
  const { initPersistence } = require('../../src/main/persistence');
  initPersistence(tmpDir);

  const { addModel, listModels } = require('../../src/main/ai/model-registry');
  const { chatComplete, unloadModel } = require('../../src/main/ai/inference');
  const { localChatComplete } = require('../../src/main/ai/local-engine');

  // ── 1. Register model ──
  console.log('1. Register model:');
  const model = addModel(MODEL_PATH, {
    name: 'Qwen2.5-0.5B-Instruct',
    contextSize: 2048,
    category: 'fast',
  });
  assert('model registered with correct name', model.name === 'Qwen2.5-0.5B-Instruct');
  assert('model file exists', listModels()[0].fileExists === true);
  console.log(`   Size: ${(model.sizeBytes / 1024 / 1024).toFixed(1)} MB`);

  // ── 2. Direct chatComplete ──
  console.log('\n2. Direct chatComplete (bypass provider abstraction):');
  console.log('   Prompt: "Hello, what is 2 + 2?"');
  const start1 = Date.now();
  try {
    const result = await chatComplete(model, [
      { role: 'user', content: 'Hello, what is 2 + 2? Answer in one short sentence.' },
    ], {
      contextSize: 2048,
      threads: 4,
      gpuLayers: 0,
      temperature: 0.3,
      maxTokens: 64,
    });
    const ms = Date.now() - start1;
    console.log(`   Response: "${result.content.slice(0, 300)}"`);
    console.log(`   Tokens: ~${result.tokensGenerated}, Duration: ${ms}ms`);
    assert('response is non-empty', result.content.trim().length > 0);
    assert('model id matches', result.modelId === model.id);
    assert('model name matches', result.modelName === model.name);
    assert('duration is reasonable', result.durationMs > 100 && result.durationMs < 60000);
  } catch (err: any) {
    console.error('   Error:', err.message);
    assert('direct chatComplete succeeds', false, err.message);
  }

  // ── 3. localChatComplete (provider abstraction path) ──
  console.log('\n3. localChatComplete (provider abstraction):');
  console.log('   Prompt: "Write a 1-line Python function to add two numbers."');
  const start2 = Date.now();
  try {
    const result = await localChatComplete({
      provider: 'local',
      localModelId: model.id,
      localContextSize: 2048,
      localThreads: 4,
      localGpuLayers: 0,
      localTemperature: 0.3,
      localMaxTokens: 128,
      maxTokens: 128,
      temperature: 0.3,
    }, [
      { role: 'user', content: 'Write a 1-line Python function to add two numbers.' },
    ]);
    const ms = Date.now() - start2;
    console.log(`   Response: "${(result.content || '').slice(0, 300)}"`);
    console.log(`   Tokens: ~${result.tokens}, Duration: ${ms}ms`);
    assert('provider abstraction returns success', result.success === true);
    assert('provider abstraction returns content', (result.content || '').trim().length > 0);
    if (result.modelName) {
      assert('provider abstraction returns model name', result.modelName === 'Qwen2.5-0.5B-Instruct');
    }
  } catch (err: any) {
    console.error('   Error:', err.message);
    assert('localChatComplete succeeds', false, err.message);
  }

  // ── 4. No model configured error ──
  console.log('\n4. Error handling (no model):');
  const result4 = await localChatComplete({
    provider: 'local',
    localModelId: 'nonexistent-id',
    maxTokens: 32,
    temperature: 0.3,
  }, [{ role: 'user', content: 'test' }]);
  assert('returns clear error when no model is set', result4.success === false && !!result4.error);

  // ── 5. Cleanup ──
  await unloadModel();
  fs.rmSync(tmpDir, { recursive: true });

  console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
