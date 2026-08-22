/**
 * Phase 3 — Local AI Core Tests (Part B: Real Inference via Electron)
 *
 * Runs inside Electron's main process to test the full pipeline:
 *   IPC (renderer) → IPC (main) → ai/local-engine → ai/inference → node-llama-cpp
 *
 * Run with:
 *   DISPLAY=:99 ./node_modules/.bin/electron --no-sandbox tests/local-ai/test-inference-electron.js
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MODEL_PATH = '/home/z/my-project/repos/nex-ai/models/qwen2.5-0.5b-q4_k_m.gguf';

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else      { fail++; console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

app.whenReady().then(async () => {
  try {
    console.log('\n=== Phase 3 Real Inference Tests (Electron) ===\n');

    if (!fs.existsSync(MODEL_PATH)) {
      console.error(`Model file not found: ${MODEL_PATH}`);
      app.exit(1);
      return;
    }

    // Use the dist/ built code
    const { initPersistence } = require('../../dist/main/persistence');
    const { addModel, listModels } = require('../../dist/main/ai/model-registry');
    const { chatComplete, unloadModel } = require('../../dist/main/ai/inference');
    const { localChatComplete } = require('../../dist/main/ai/local-engine');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-infer-'));
    initPersistence(tmpDir);

    console.log('1. Register model:');
    const model = addModel(MODEL_PATH, {
      name: 'Qwen2.5-0.5B-Instruct',
      contextSize: 2048,
      category: 'fast',
    });
    assert('model registered with correct name', model.name === 'Qwen2.5-0.5B-Instruct');
    assert('model file exists', listModels()[0].fileExists === true);
    console.log(`   Size: ${(model.sizeBytes / 1024 / 1024).toFixed(1)} MB`);

    console.log('\n2. Direct chatComplete:');
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
    } catch (err) {
      console.error('   Error:', err.message);
      console.error(err.stack);
      assert('direct chatComplete succeeds', false, err.message);
    }

    console.log('\n3. localChatComplete (provider abstraction):');
    console.log('   Prompt: "Write a 1-line Python function to add two numbers."');
    // Unload the previous model so this test loads fresh
    await unloadModel();
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
    } catch (err) {
      console.error('   Error:', err.message);
      console.error(err.stack);
      assert('localChatComplete succeeds', false, err.message);
    }

    console.log('\n4. Error handling (no model):');
    const result4 = await localChatComplete({
      provider: 'local',
      localModelId: 'nonexistent-id',
      maxTokens: 32,
      temperature: 0.3,
    }, [{ role: 'user', content: 'test' }]);
    assert('returns clear error when no model is set', result4.success === false && !!result4.error);

    await unloadModel();
    fs.rmSync(tmpDir, { recursive: true });

    console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===\n`);
    app.exit(fail > 0 ? 1 : 0);
  } catch (err) {
    console.error('Top-level error:', err);
    app.exit(1);
  }
});
