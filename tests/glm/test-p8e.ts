/**
 * Phase 8 / P8-E — Agent UX + Streaming + Visibility Tests
 *
 * Layers:
 *   1. UNIT  — createTokenStreamer: batching, throttle, flush, end, caps,
 *              redacted assembled logging (pure, no electron).
 *   2. INTEGRATION — planner: uses chatStream when onToken provided, plain
 *              chat otherwise (no regression), usage captured (fake runtime).
 *   3. INTEGRATION — createTask: online routing surfaces backend/model/
 *              routingReason in task_created event data (electron mocked).
 *   4. SECURITY — redactSecrets masks key patterns used in stream logging.
 *   5. STATIC — event union has agent_token; core wiring; step progress data;
 *              architecture contracts (no direct glm/ai-service in agent/).
 *
 * Run: npx tsx tests/glm/test-p8e.ts
 */
import '../__mocks__/install-electron-mock.js';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main(): Promise<void> {

// ─── 1. createTokenStreamer (pure unit) ─────────────────────────────────────
console.log('\n1. createTokenStreamer:');
const { createTokenStreamer } = await import('../../src/main/agent/stream-emit');

const emitted: any[] = [];
const logged: string[] = [];
const s = createTokenStreamer('t1', undefined, 'planning', (p) => emitted.push(p), {
  intervalMs: 10_000, // effectively "never on time" → batching visible
  maxBufferChars: 1000,
  logAssembled: (t) => logged.push(t),
  redact: (t) => t.replace(/sk-[a-z]{20,}/g, '***K***'),
});

s.push('Hel');
s.push('lo ');
s.push('world');
assert('first push emits immediately (instant feedback)', emitted.length === 1 && emitted[0].text === 'Hel');
assert('subsequent pushes batch (no emit until interval/flush)', emitted.length === 1); // 'lo world' still buffered

s.push('');
assert('empty chunk ignored (still 1 emit)', emitted.length === 1);

emitted.length = 0;
s.flush(); // emits the buffered 'lo world'
assert('flush emits buffered remainder', emitted.length === 1 && emitted[0].text === 'lo world');
assert('chars cumulative after remainder (11)', emitted[0].chars === 11);
emitted.length = 0;
s.flush();
assert('flush with now-empty buffer emits nothing', emitted.length === 0);

s.push(' MORE');
emitted.length = 0;
s.flush();
assert('flush emits buffered immediately', emitted.length === 1 && emitted[0].text === ' MORE');
assert('chars counter cumulative (11 before + 5 more)', emitted[0].chars === 16);

emitted.length = 0;
s.end();
const doneEv = emitted.find((e) => e.done === true);
assert('end() emits done event', !!doneEv);
assert('end() flushes remainder', emitted.some((e) => e.text === ''));

emitted.length = 0;
s.push('late');
s.end();
assert('push after end ignored', emitted.length === 0);
assert('assembled text complete', s.text() === 'Hello world MORE');

assert('logAssembled called exactly once', logged.length === 1);
assert('assembled log matches text', logged[0] === 'Hello world MORE');

// redaction in assembled logging
const logged2: string[] = [];
const s2 = createTokenStreamer('t2', undefined, 'planning', () => {}, {
  intervalMs: 10_000,
  logAssembled: (t) => logged2.push(t),
  redact: (t) => t.replace(/sk-[a-z]{20,}/g, '***K***'),
});
s2.push('key: sk-abcdefghijklmnopqrstuvwx and more');
s2.end();
assert('assembled log is REDACTED', logged2[0].includes('***K***') && !logged2[0].includes('sk-abcdefghijklmnopqrstuvwx'));

// hard cap
const capped: any[] = [];
const s3 = createTokenStreamer('t3', undefined, 'planning', (p) => capped.push(p), {
  intervalMs: 0,
  maxTotalChars: 50,
});
for (let i = 0; i < 30; i++) s3.push('abcdefghij'); // 300 chars total
s3.end();
const totalEmitted = capped.filter((e) => !e.done).reduce((a: number, e: any) => a + e.text.length, 0);
assert('hard cap enforced (≤50 chars emitted)', totalEmitted <= 50);
assert('done event still emitted after cap', capped.some((e) => e.done === true));

// throttle: with intervalMs=0 every push emits
const fast: any[] = [];
const s4 = createTokenStreamer('t4', undefined, 'planning', (p) => fast.push(p), { intervalMs: 0 });
s4.push('a'); s4.push('b');
assert('intervalMs=0 emits per push', fast.length === 2);

// ─── 2. Planner streaming integration (fake runtime) ────────────────────────
console.log('\n2. Planner streaming:');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p8e-'));
const { generatePlan } = await import('../../src/main/agent/planner');

const PLAN_JSON = JSON.stringify({
  reasoning: 'simple plan',
  confidence: 0.9,
  warnings: [],
  steps: [{ description: 'do it', action: 'observe' }],
});

function makeFakeRuntime(streamed: boolean) {
  return {
    usedStream: false,
    usedChat: false,
    async chat() { this.usedChat = true; return { content: PLAN_JSON, tokensGenerated: 77, promptTokens: 10, completionTokens: 77, modelId: 'm', modelName: 'M', stopped: true, durationMs: 1 }; },
    async chatStream(_msgs: any[], onChunk: any) {
      this.usedStream = true;
      onChunk({ content: PLAN_JSON.slice(0, 20), done: false });
      onChunk({ content: PLAN_JSON.slice(20), done: false });
      onChunk({ content: '', done: true });
      return { content: PLAN_JSON, tokensGenerated: 77, promptTokens: 10, completionTokens: 77, modelId: 'm', modelName: 'M', stopped: true, durationMs: 2 };
    },
    abort() {}, async init() {}, async loadModel() {}, async unloadModel() {},
    async shutdown() {}, getStats() { return { type: 'llamacpp', loaded: true, loadedModelId: 'm', loadedModelName: 'M' }; },
    capabilities: new Set(['chat']),
    type: 'llamacpp',
  } as any;
}

const fakeModel = { id: 'm1', name: 'TestModel', path: '', sizeBytes: 0, contextSize: 2048, gpuLayers: 0, category: 'coding', fileExists: true, addedAt: Date.now() } as any;
const toolDefs: any[] = [];

// WITH onToken → chatStream path
const rtStream = makeFakeRuntime(true);
const gotChunks: string[] = [];
const plan1 = await generatePlan(rtStream, fakeModel, {
  userRequest: 'say hi', tools: toolDefs, onToken: (c) => gotChunks.push(c),
});
assert('planner uses chatStream when onToken provided', rtStream.usedStream && !rtStream.usedChat);
assert('tokens forwarded to callback', gotChunks.length >= 2);
assert('chunks reassemble to full response', gotChunks.join('') === PLAN_JSON);
assert('plan parsed from stream', plan1.steps.length === 1 && plan1.confidence === 0.9);
assert('usage captured (tokensGenerated)', plan1.usage?.tokensGenerated === 77);
assert('usage captured (promptTokens)', plan1.usage?.promptTokens === 10);
assert('usage captured (durationMs)', typeof plan1.usage?.durationMs === 'number');

// WITHOUT onToken → plain chat (regression-safe)
const rtChat = makeFakeRuntime(false);
const plan2 = await generatePlan(rtChat, fakeModel, { userRequest: 'say hi', tools: toolDefs });
assert('planner keeps runtime.chat without onToken (no regression)', rtChat.usedChat && !rtChat.usedStream);
assert('plan still parsed non-streamed', plan2.steps.length === 1);

// ─── 3. createTask event contract (online routing visibility) ──────────────
console.log('\n3. createTask event contract:');
const core = await import('../../src/main/agent/core');
const events: any[] = [];
const unsub = core.onAgentEvent((e: any) => events.push(e));

// No local models registered (fresh temp registry) → online routing path
const task = await core.createTask({
  userRequest: 'Refactor the entire authentication module and add tests for every edge case, including token expiry, refresh flows and concurrent sessions',
  intent: 'refactor',
  backend: 'auto',
  onlineEnvironment: { available: true, modelId: 'glm-5.3', modelName: 'GLM 5.3' },
});

const created = events.find((e) => e.type === 'task_created');
assert('task_created emitted', !!created);
assert('backend=online surfaced in event', created?.data?.backend === 'online');
assert('modelName=GLM 5.3 surfaced in event', created?.data?.modelName === 'GLM 5.3');
assert('routingReason present in event', typeof created?.data?.routingReason === 'string' && created.data.routingReason.length > 0);
assert('task object carries backend', task.backend === 'online');
assert('task object carries onlineModelName', task.onlineModelName === 'GLM 5.3');
assert('online task gets 32k context budget', task.context.maxContextTokens === 32768);
core.deleteTask(task.id);
unsub();

// ─── 4. Secret redaction (stream logging safety net) ────────────────────────
console.log('\n4. Secret-safe logging:');
const { redactSecrets } = await import('../../src/main/agent/logger');
const leaky = 'use key sk-abcdefghijklmnopqrstuvwxyz123456 now Bearer abcdefghijklmnopqrstuvwxyz123456';
const { redacted, redactions } = redactSecrets(leaky);
assert('openai-style key redacted', !redacted.includes('sk-abcdefghijklmnopqrstuvwxyz123456'));
assert('bearer token redacted', !redacted.includes('Bearer abcdefghijklmnopqrstuvwxyz'));
assert('redactions reported', redactions.length >= 1);

// ─── 5. Static contracts ────────────────────────────────────────────────────
console.log('\n5. Static contracts:');
const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

const typesSrc = read('../../src/main/agent/types.ts');
assert("AgentEventType includes 'agent_token'", /'agent_token'/.test(typesSrc));

const coreSrc = read('../../src/main/agent/core.ts');
assert('core: createTokenStreamer wired to planning', /createTokenStreamer\(taskId, undefined, 'planning'/.test(coreSrc));
assert('core: agent_token events emitted', /type: 'agent_token'/.test(coreSrc));
assert('core: streamer.end() called after plan', /streamer\.end\(\)/.test(coreSrc));
assert('core: assembled stream logged REDACTED', /redactSecrets\(s\)\.redacted/.test(coreSrc));
assert('core: task_created carries routingReason', /routingReason,/.test(coreSrc));
assert('core: step_started carries stepIndex+totalSteps', /stepIndex: step\.index/.test(coreSrc) && /totalSteps: task\.plan\.length/.test(coreSrc));
assert('core: planning_completed carries usage+backend+model', /usage: plan\.usage/.test(coreSrc) && /backend: task\.backend/.test(coreSrc));
assert('core: token usage tracked in context budget', /estimatedTokensUsed \+= plan\.usage\.tokensGenerated/.test(coreSrc));

const plannerSrc = read('../../src/main/agent/planner.ts');
assert('planner: onToken in PlanRequest', /onToken\?: \(chunk: string\) => void/.test(plannerSrc));
assert('planner: chatStream branch exists', /runtime\.chatStream\(context\.messages/.test(plannerSrc));
assert('planner: PlanUsage interface', /interface PlanUsage/.test(plannerSrc));

const streamSrc = read('../../src/main/agent/stream-emit.ts');
assert('stream-emit: zero electron imports', !/from ['"]electron['"]/.test(streamSrc));
assert('stream-emit: zero runtime imports (pure)', !/from ['"]\.\.\/ai\//.test(streamSrc));

// Architecture: agent/ still free of direct glm/ai-service imports
const agentDir = path.join(__dirname, '../../src/main/agent');
const agentFiles = fs.readdirSync(agentDir).filter((f) => f.endsWith('.ts'));
const staticImport = /^\s*import[^;'"]*from\s+['"][^'"]*\/glm['"]/m;
const dynamicImport = /import\(\s*['"][^'"]*\/glm['"]\s*\)/;
let violation = '';
for (const f of agentFiles) {
  const src = fs.readFileSync(path.join(agentDir, f), 'utf-8');
  if (staticImport.test(src) || dynamicImport.test(src) || /from ['"]\.\.\/ai-service['"]/.test(src)) { violation = f; break; }
}
assert('ARCHITECTURE: agent/ (incl. new files) has ZERO direct glm/ai-service imports', violation === '', violation);

// Renderer: ChatPanel routes agent_token to stream buffer
const chatSrc = read('../../src/renderer/components/ChatPanel.tsx');
assert('ChatPanel: agent_token handled separately', /'agent_token'/.test(chatSrc));
assert('ChatPanel: stream buffer accumulates', /streamBufRef\.current \+= d\.text/.test(chatSrc));
assert('ChatPanel: token events NOT in event list', /return;/.test(chatSrc.split("'agent_token'")[1] || ''));

const dispSrc = read('../../src/renderer/components/agent/AgentStateDisplay.tsx');
assert('AgentStateDisplay: streaming preview', /streamText/.test(dispSrc));
assert('AgentStateDisplay: backend badge (Local/Online)', /'Online' : 'Local'/.test(dispSrc));
assert('AgentStateDisplay: model name shown', /meta\.model/.test(dispSrc));
assert('AgentStateDisplay: progress bar', /stepProgress/.test(dispSrc));
assert('AgentStateDisplay: tool timing shown', /durationMs/.test(dispSrc));
assert('AgentStateDisplay: Stop button', /onStop/.test(dispSrc));
assert('AgentStateDisplay: token usage shown', /tokensGenerated/.test(dispSrc));

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`P8-E RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('ALL P8-E STREAMING + VISIBILITY TESTS PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
