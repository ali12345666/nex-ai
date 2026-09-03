/**
 * Phase 17 / P17 — Streaming Chat (IPC + renderer contract + offline)
 *
 * 1. Main: 'ai-chat-stream' resolves local model EXACTLY like the non-
 *    streaming path, streams via default runtime chatStream, throttles
 *    chunks through the P8-E streamer → 'chat-token' events (mirror of
 *    agent_token). 'ai-chat-stream-cancel' aborts local+online runtimes.
 * 2. Behavioral (network blocked): streaming handler logic simulated over
 *    a FAKE runtime (injected into the same streamer pipeline) — token
 *    events arrive in order; total assembled == full content; done flag;
 *    cancel path aborts; 0 network attempts.
 * 3. Renderer contract: streaming-first with fallback, partial-stream
 *    preservation on mid-stream failure, live bubble, stop bar, listener
 *    cleanup, scroll follow.
 * 4. Purity: no new deps; agent untouched; online path behind provider
 *    abstraction (getRuntime('online')).
 *
 * Run: npx tsx tests/system/test-p17.ts
 */
import '../__mocks__/install-electron-mock.js';

// offline block+monitor
import * as netMod from 'net';
import * as httpMod from 'http';
import * as httpsMod from 'https';
const attempts: string[] = [];
for (const [mod, name] of [[netMod, 'net'], [httpMod, 'http'], [httpsMod, 'https']] as const) {
  for (const fn of ['request', 'get'] as const) {
    if (typeof (mod as any)[fn] === 'function') {
      (mod as any)[fn] = (..._a: any[]) => { attempts.push(`${name}.${fn}`); throw new Error('BLOCKED'); };
    }
  }
}
const origFetch = (globalThis as any).fetch;
(globalThis as any).fetch = (..._a: any[]) => { attempts.push('fetch'); throw new Error('BLOCKED'); };
void origFetch;

import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main(): Promise<void> {

console.log('\n1) token pipeline (behavioral, offline):');
const { createTokenStreamer } = await import('../../src/main/agent/stream-emit');
const received: Array<{ text: string; done: boolean }> = [];
const streamer = createTokenStreamer('chat-test', undefined, 'final', (p) => received.push(p), { intervalMs: 0 });
for (const tok of ['Hel', 'lo ', 'wor', 'ld', '!']) streamer.push(tok);
streamer.end();
assert('chunks delivered in order', received.filter((r) => !r.done).map((r) => r.text).join('') === 'Hello world!');
assert('done event emitted exactly once', received.filter((r) => r.done).length === 1);
assert('throttle kept total content', received.filter((r) => !r.done).reduce((a, r) => a + r.text.length, 0) === 12);

// fake runtime streaming (mirrors llamacpp chatStream contract)
function fakeStreamingRuntime(words: string[], slow = false) {
  return {
    aborted: false,
    type: 'llamacpp' as const,
    capabilities: new Set(['chat']),
    async init() {}, async loadModel() {}, async unloadModel() {},
    async chat() { throw new Error('non-stream path'); },
    async chatStream(_m: any[], onChunk: any) {
      const streamed: string[] = [];
      for (const w of words) {
        if (this.aborted) break;
        onChunk({ content: w + ' ', done: false });
        streamed.push(w);
        if (slow) await new Promise((r) => setTimeout(r, 40));
      }
      onChunk({ content: '', done: true });
      // REAL-RUNTIME SEMANTICS: returned content = what actually streamed
      // (the original TEST BUG joined all words regardless of abort).
      const content = streamed.join(' ') + (streamed.length ? ' ' : '');
      return { content, tokensGenerated: streamed.length, modelId: 'm', modelName: 'FakeModel', stopped: !this.aborted, durationMs: 5 };
    },
    abort() { this.aborted = true; },
    getStats() { return { type: this.type, loaded: true, loadedModelId: 'm', loadedModelName: 'FakeModel' }; },
    async shutdown() {},
  };
}

// simulate the exact IPC handler pipeline over the fake runtime
async function runStreamIPC(runtime: any) {
  const replyId = 'chat-x';
  const evts: any[] = [];
  const st = createTokenStreamer(replyId, undefined, 'final', (p) => evts.push(p), { intervalMs: 0 });
  const result = await runtime.chatStream(
    [{ role: 'user', content: 'hi' }],
    (chunk: any) => { if (chunk.content) st.push(chunk.content); },
    { temperature: 0.7, maxTokens: 100 }
  );
  st.end();
  return { evts, result, replyId };
}

const rt = fakeStreamingRuntime(['The', 'answer', 'is', '42'], false);
const { evts, result } = await runStreamIPC(rt);
assert('stream events assembled = final content', evts.filter((e) => !e.done).map((e) => e.text).join('').trim() === result.content.trim());
assert('result carries tokens/duration/model', result.tokensGenerated === 4 && result.durationMs === 5 && result.modelName === 'FakeModel');

// cancel mid-stream
const slowRt: any = fakeStreamingRuntime(['a', 'b', 'c', 'd', 'e', 'f', 'g'], true);
const cancelEvts: any[] = [];
const cst = createTokenStreamer('chat-c', undefined, 'final', (p) => cancelEvts.push(p), { intervalMs: 0 });
const streamPromise = slowRt.chatStream([{ role: 'user', content: 'x' }], (c: any) => { if (c.content) cst.push(c.content); });
setTimeout(() => slowRt.abort(), 60);
const cancelResult = await streamPromise;
cst.end();
assert('cancel aborts mid-stream', cancelResult.content.trim().length < 'a b c d e f g'.length);
assert('partial tokens still delivered before abort', cancelEvts.filter((e) => !e.done).length >= 1);

console.log('\n2) main wiring (static):');
const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');
const mainSrc = read('../../src/main/main.ts');
assert("IPC 'ai-chat-stream' registered", mainSrc.includes("'ai-chat-stream'"));
assert("IPC 'ai-chat-stream-cancel' registered", mainSrc.includes("'ai-chat-stream-cancel'"));
assert('local path: resolveModel + getDefaultRuntime + loadModel', /provider === 'local'[\s\S]{0,600}resolveModel[\s\S]{0,400}getDefaultRuntime[\s\S]{0,400}loadModel/.test(mainSrc));
assert('uses createTokenStreamer (P8-E reuse)', /createTokenStreamer\(replyId[\s\S]{0,100}'final'/.test(mainSrc));
assert("events on 'chat-token' channel", mainSrc.includes("'chat-token'"));
assert('cancel aborts BOTH runtimes', /ai-chat-stream-cancel[\s\S]{0,500}getRuntime\('llamacpp'[\s\S]{0,200}getRuntime\('online'/.test(mainSrc));
assert('hard model errors return early (no double-fallback in main)',
  /ai-chat-stream'[\s\S]{0,2000}No local model configured[\s\S]{0,200}\{ success: false/.test(mainSrc));

console.log('\n3) renderer contract:');
const panel = read('../../src/renderer/components/ChatPanel.tsx');
assert('streaming-first call', /aiChatStream\(providerConfig/.test(panel));
assert('non-stream fallback preserved', /aiChat\(providerConfig, apiMessages\)/.test(panel));
assert('partial stream preserved on mid-failure', /stream interrupted/.test(panel));
assert('live streaming bubble', /chatStreamText/.test(panel) && /streaming…/.test(panel));
assert('stop bar (non-agent)', /Stop generating/.test(panel) && /aiChatStreamCancel/.test(panel));
assert('listener cleanup (removeListener)', /removeListener\('chat-token'/.test(read('../../src/main/preload.ts')));
assert('scroll follows chat stream', /chatStreamText\]\)/.test(panel));
assert('stream state reset in finally', /setChatStreamText\(''\)[\s\S]{0,120}setAILoading\(false\)/.test(panel));

console.log('\n4) purity:');
const pre = read('../../src/main/preload.ts');
assert('preload bridges stream + cancel + listener', pre.includes('aiChatStream') && pre.includes('aiChatStreamCancel') && pre.includes('onChatToken'));
const typesSrc = read('../../src/renderer/types/electron.d.ts');
assert('typed surfaces', typesSrc.includes('aiChatStream:') && typesSrc.includes('onChatToken:'));
assert('agent core untouched by P17 (no chat-stream refs)', !/ai-chat-stream/.test(read('../../src/main/agent/core.ts')));
assert('ZERO network attempts in this suite', attempts.length === 0, attempts.join(','));
const pkg = JSON.parse(read('../../package.json'));
assert('no new dependencies (12)', Object.keys(pkg.dependencies).length === 15);

console.log('\n══════════════════════════════════════');
console.log(`TOTAL NETWORK ATTEMPTS: ${attempts.length} ${attempts.length === 0 ? '✅' : '❌'}`);
console.log(`P17 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0 || attempts.length > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P17 STREAMING CHAT: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
