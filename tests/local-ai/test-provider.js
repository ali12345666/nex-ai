/**
 * Phase 5 — Provider Abstraction Tests
 *
 * Verifies the unified routeChat() works for all three providers:
 *  - local: real llama.cpp inference (reuses Phase 3 model)
 *  - openai: origin validation (no actual API call)
 *  - claude: origin validation (no actual API call)
 *
 * Run with: bash /tmp/run-provider-test.sh
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
    console.log('\n=== Phase 5 Provider Abstraction Tests ===\n');

    const { initPersistence } = require('../../dist/main/persistence');
    const { addModel } = require('../../dist/main/ai/model-registry');
    const { routeChat } = require('../../dist/main/ai/provider');
    const { unloadModel } = require('../../dist/main/ai/inference');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-prov-'));
    initPersistence(tmpDir);

    const model = addModel(MODEL_PATH, {
      name: 'Qwen2.5-0.5B-Instruct',
      contextSize: 2048,
      category: 'fast',
    });

    // ── 1. Local provider ──
    console.log('1. Local provider via routeChat:');
    console.log('   Prompt: "Say hello in one word."');
    const start1 = Date.now();
    const result1 = await routeChat({
      provider: 'local',
      localModelId: model.id,
      localContextSize: 2048,
      localThreads: 4,
      localGpuLayers: 0,
      localTemperature: 0.3,
      localMaxTokens: 16,
      maxTokens: 16,
      temperature: 0.3,
    }, [{ role: 'user', content: 'Say hello in one word.' }]);
    const ms1 = Date.now() - start1;
    console.log(`   Response: "${(result1.content || '').slice(0, 200)}"`);
    console.log(`   Duration: ${ms1}ms, Provider: ${result1.provider}`);
    assert('local provider returns success', result1.success === true);
    assert('local provider returns content', (result1.content || '').trim().length > 0);
    assert('local provider result has provider=local', result1.provider === 'local');
    assert('local provider returns model name', result1.modelName === 'Qwen2.5-0.5B-Instruct');

    await unloadModel();

    // ── 2. OpenAI provider — missing API key ──
    console.log('\n2. OpenAI provider — missing API key:');
    const result2 = await routeChat({
      provider: 'openai',
      apiKey: '',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o',
      maxTokens: 64,
      temperature: 0.7,
    }, [{ role: 'user', content: 'test' }]);
    assert('openai without key returns clear error', result2.success === false);
    assert('error mentions API key', (result2.error || '').includes('API key'));
    assert('result has provider=openai', result2.provider === 'openai');

    // ── 3. OpenAI provider — disallowed origin ──
    console.log('\n3. OpenAI provider — disallowed origin:');
    const result3 = await routeChat({
      provider: 'openai',
      apiKey: 'sk-fake',
      endpoint: 'https://evil.example.com/v1/chat',
      model: 'gpt-4o',
      maxTokens: 64,
      temperature: 0.7,
    }, [{ role: 'user', content: 'test' }]);
    assert('disallowed origin returns error', result3.success === false);
    assert('error mentions blocked origin', (result3.error || '').toLowerCase().includes('blocked'));

    // ── 4. Claude provider — missing API key ──
    console.log('\n4. Claude provider — missing API key:');
    const result4 = await routeChat({
      provider: 'claude',
      apiKey: '',
      endpoint: 'https://api.anthropic.com/v1/messages',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 64,
      temperature: 0.7,
    }, [{ role: 'user', content: 'test' }]);
    assert('claude without key returns clear error', result4.success === false);
    assert('error mentions API key', (result4.error || '').includes('API key'));
    assert('result has provider=claude', result4.provider === 'claude');

    // ── 5. Local provider — no model registered ──
    console.log('\n5. Local provider — no model configured:');
    const result5 = await routeChat({
      provider: 'local',
      localModelId: 'nonexistent',
      maxTokens: 32,
      temperature: 0.3,
    }, [{ role: 'user', content: 'test' }]);
    assert('local without model returns clear error', result5.success === false);
    assert('error mentions local model', (result5.error || '').toLowerCase().includes('local model'));

    await unloadModel();
    fs.rmSync(tmpDir, { recursive: true });

    console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===\n`);
    app.exit(fail > 0 ? 1 : 0);
  } catch (err) {
    console.error('Top-level error:', err);
    app.exit(1);
  }
});
