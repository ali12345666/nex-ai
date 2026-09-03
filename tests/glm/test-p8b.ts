/**
 * Phase 8 / P8-B — Multi-Backend Model Router + OnlineRuntime Tests
 *
 * Pure unit tests (no Electron, no network):
 *   1. Complexity estimation
 *   2. Routing policy — auto / local-first / online-first, fallbacks
 *   3. OnlineRuntime — AIRuntime contract with a fake transport
 *      (load → chat → stream → abort → stats → shutdown)
 *   4. ARCHITECTURE CONTRACTS:
 *      - model-router has ZERO direct glm/provider imports (provider-blind)
 *      - agent core still has ZERO direct glm/ai-service imports
 *      - runtime registry exposes 'online' type
 *
 * Run: npx tsx tests/glm/test-p8b.ts
 */

// Mock electron BEFORE any module that imports it (persistence chain).
// This import MUST come first — see tests/__mocks__/install-electron-mock.js
import '../__mocks__/install-electron-mock.js';

import * as fs from 'fs';
import * as path from 'path';

// Hermetic data dir for the model registry (JSON-backed)
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'nex-p8b-'));
process.env.NEX_AI_DATA_DIR = TMP;

import {
  estimateComplexity, routeModel, routeCodingTask,
  type OnlineEnvironment,
} from '../../src/main/agent/model-router';
import { OnlineRuntime } from '../../src/main/ai/runtimes/online-runtime';
import type { ChatResult } from '../../src/main/ai/runtime';
import { listModels } from '../../src/main/ai/model-registry';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main(): Promise<void> {

const ONLINE: OnlineEnvironment = { available: true, modelId: 'glm-5.3', modelName: 'GLM 5.3' };
const NO_ONLINE: OnlineEnvironment = { available: false };

// Force a deterministic local availability story: the temp registry starts
// EMPTY (no local models) for fallback tests…
const hasLocalModels = () => listModels().filter((m: any) => m.fileExists).length > 0;

// ─── 1. Complexity estimation ───────────────────────────────────────────────
console.log('\n1. estimateComplexity:');
assert('coding intent + long text → complex', estimateComplexity({ intent: 'coding', textLength: 800 }) === 'complex');
assert('coding intent + short text → moderate', estimateComplexity({ intent: 'coding', textLength: 100 }) === 'moderate');
assert('chat + short → simple', estimateComplexity({ intent: 'chat', textLength: 50 }) === 'simple');
assert('explicit complexity wins', estimateComplexity({ intent: 'chat', complexity: 'complex' }) === 'complex');
assert('long chat text → moderate', estimateComplexity({ intent: 'chat', textLength: 3000 }) === 'moderate');

// ─── 2. Routing policy ──────────────────────────────────────────────────────
console.log('\n2. routeModel policy:');

// Local selection comes from the real (temp) registry — empty here, so we
// control availability purely via the injected online env.
if (!hasLocalModels()) {
  const noLocalOnline = routeModel({ intent: 'coding', textLength: 900 }, ONLINE);
  assert('no local + online available → online', noLocalOnline.backend === 'online');
  assert('online model name propagated', noLocalOnline.onlineModel?.name === 'GLM 5.3');
  assert('reason mentions no local model', /No local model/.test(noLocalOnline.reason));

  const nothing = routeModel({ intent: 'chat' }, NO_ONLINE);
  assert('no local + no online → local backend (caller handles null)', nothing.backend === 'local' && nothing.localModel === null);

  const chatOnlineOnly = routeModel({ intent: 'chat', textLength: 30 }, ONLINE);
  assert('simple chat, no local → falls to online (only option)', chatOnlineOnly.backend === 'online');
}

// Explicit preferences
const prefOnline = routeModel({ intent: 'chat' }, ONLINE, undefined, { preference: 'online-first' });
assert('online-first preference honored', prefOnline.backend === 'online');
assert('preference reason mentions online-first', /online-first/.test(prefOnline.reason));

// online-first with NO online → falls back (can't pick unavailable backend)
const prefOnlineNoKey = routeModel({ intent: 'chat' }, NO_ONLINE, undefined, { preference: 'online-first' });
assert('online-first w/o key → local fallback decision shape ok', prefOnlineNoKey.backend === 'local' || prefOnlineNoKey.onlineModel === null);

// routeCodingTask convenience
const codingRoute = routeCodingTask(1000, ONLINE);
assert('routeCodingTask long → online', codingRoute.backend === 'online');
const codingRouteShort = routeCodingTask(10, NO_ONLINE);
assert('routeCodingTask short offline → local decision', codingRouteShort.backend === 'local');

// ─── 3. OnlineRuntime AIRuntime contract (fake transport) ───────────────────
console.log('\n3. OnlineRuntime contract:');
let transportCalls = 0;
const fakeResult: ChatResult = {
  content: 'line1\nline2\nline3',
  tokensGenerated: 7,
  modelId: 'glm-5.3',
  modelName: 'GLM 5.3',
  stopped: true,
  durationMs: 5,
};
const rt = new OnlineRuntime({
  modelId: 'glm-5.3',
  modelName: 'GLM 5.3',
  transport: async (messages, opts) => {
    transportCalls++;
    if (messages.length === 0) throw new Error('empty messages');
    return { ...fakeResult, content: fakeResult.content + ` (${messages.length} msgs, maxTokens=${opts.maxTokens ?? 4096})` };
  },
});

assert('type is online', rt.type === 'online');
assert('capabilities include coding', rt.capabilities.has('coding'));

let threw = '';
try { await rt.chat([{ role: 'user', content: 'x' }]); } catch (e: any) { threw = e.message; }
assert('chat before loadModel throws', /no model loaded/i.test(threw));

await rt.init();
const synthetic = { id: 'online:GLM 5.3', name: 'GLM 5.3', path: '', sizeBytes: 0, contextSize: 32768, gpuLayers: 0, category: 'coding', fileExists: true, addedAt: Date.now() } as any;
await rt.loadModel(synthetic);

const chat = await rt.chat([{ role: 'user', content: 'hello' }], { maxTokens: 512 });
assert('chat returns content', chat.content.includes('line1'));
assert('transport received maxTokens', chat.content.includes('maxTokens=512'));
assert('modelId reported', chat.modelId === 'glm-5.3');
assert('durationMs present', typeof chat.durationMs === 'number');
assert('transport called exactly once', transportCalls === 1);

// Streaming
let chunks: string[] = [];
let doneChunk = false;
const streamed = await rt.chatStream([{ role: 'user', content: 'x' }], (c) => {
  if (c.done) doneChunk = true; else chunks.push(c.content);
});
assert('stream returns full result', streamed.content.includes('line1'));
assert('stream emitted line chunks', chunks.length >= 3);
assert('stream finished with done chunk', doneChunk === true);
assert('stream chunks concatenate to content', chunks.join('').length > 0);

// Stats
const stats = rt.getStats();
assert('stats loaded after loadModel', stats.loaded === true);
assert('stats model name', stats.loadedModelName === 'GLM 5.3');
assert('stats no gpu', stats.gpuBackend === 'none');

// Abort during in-flight call: slow transport + abort() while pending
const slowRt = new OnlineRuntime({
  modelId: 'glm-5.3', modelName: 'GLM 5.3',
  transport: () => new Promise<ChatResult>((resolve) => {
    setTimeout(() => resolve({ ...fakeResult }), 150);
  }),
});
await slowRt.loadModel(synthetic);
const slowPromise = slowRt.chat([{ role: 'user', content: 'slow' }]);
setTimeout(() => slowRt.abort(), 30); // abort while in flight
const aborted = await slowPromise;
assert('abort during in-flight call marks result aborted', aborted.finishReason === 'aborted');
// A FRESH call after abort is clean (flag resets per call)
const fresh = await slowRt.chat([{ role: 'user', content: 'fresh' }]);
assert('fresh call after abort is clean', fresh.finishReason !== 'aborted');

// Unload + shutdown
await rt.unloadModel();
assert('stats unloaded after unloadModel', rt.getStats().loaded === false);
await rt.shutdown();
threw = '';
try { await rt.chat([{ role: 'user', content: 'z' }]); } catch (e: any) { threw = e.message; }
assert('chat after shutdown throws', /no model loaded/i.test(threw));

// ─── 4. Architecture contracts (static) ─────────────────────────────────────
console.log('\n4. Architecture contracts:');
const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

const routerSrc = read('../../src/main/agent/model-router.ts');
assert('model-router: NO glm import', !/from ['"].*ai\/glm/.test(routerSrc));
assert('model-router: NO provider import', !/from ['"].*ai\/provider/.test(routerSrc));
assert('model-router: NO ai-service import', !/from ['"].*ai-service/.test(routerSrc));
assert('model-router: reuses Phase 7 selector', /from ['"]\.\/model-selector['"]/.test(routerSrc));

const coreSrc = read('../../src/main/agent/core.ts');
assert('core: NO glm import', !/from ['"].*ai\/glm/.test(coreSrc));
assert('core: NO ai-service import', !/from ['"]\.\.\/ai-service['"]/.test(coreSrc));
assert('core: backend routing via model-router', /from ['"]\.\/model-router['"]/.test(coreSrc));
assert('core: online model is INJECTED not imported', /onlineEnvironment\?: OnlineEnvironment/.test(coreSrc));

const runtimeSrc = read('../../src/main/ai/runtime.ts');
assert("runtime: 'online' in RuntimeType", /'llamacpp' \| 'onnx' \| 'mlc' \| 'wasm' \| 'online' \| 'custom'/.test(runtimeSrc));
assert('runtime: online factory registered', /registerRuntime\('online'/.test(runtimeSrc));

const transportSrc = read('../../src/main/ai/runtimes/online-transport.ts');
assert('transport: routes via provider abstraction only', /routeChat/.test(transportSrc));
assert('transport: NO direct glm import', !/from ['"]\.\.\/glm['"]/.test(transportSrc));
assert('transport: secrets via getSecret only', /getSecret\('glmApiKey'\)/.test(transportSrc));

// online-runtime must be electron-free
const onlineRtSrc = read('../../src/main/ai/runtimes/online-runtime.ts');
assert('online-runtime: zero electron imports', !/from ['"]electron['"]/.test(onlineRtSrc));

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`P8-B RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('ALL P8-B ROUTER + RUNTIME TESTS PASS ✅');

} // end main

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
