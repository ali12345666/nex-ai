/**
 * Phase O / O5 — Live Activity UI Tests
 *
 * Pure unit tests (no Electron, no React) covering:
 *   1. redactAgentText — defense-in-depth redaction of event.message + streamText
 *      * OpenAI / Anthropic / Google / GitHub keys
 *      * Bearer tokens, JWTs
 *      * Generic key=, api_key=, token=, password=, secret= assignments
 *      * x-goog-api-key / x-api-key / authorization header lines
 *      * ?key= / ?api_key= URL query params
 *      * Non-secret text passes through unchanged
 *   2. AgentStateDisplay is revived and imported by NexChatPanel (source grep)
 *   3. NexChatPanel uses the EXISTING `agent-event` IPC — no new event bus
 *   4. NexChatPanel filters streamText to FINAL phase only (no planner JSON leak)
 *   5. No fake animation: AgentStateDisplay returns null when no events (source grep)
 *   6. Agent core has ZERO direct imports of AgentStateDisplay (architecture: UI is
 *      a passive consumer of agent events, never the other way around)
 *
 * Run: npx tsx tests/glm/test-phase-o5-activity.ts
 */

import { redactAgentText } from '../../src/renderer/components/agent/AgentStateDisplay';
import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

// ─── 1. redactAgentText — defense-in-depth ──────────────────────────────────
console.log('\n1. redactAgentText — secret redaction:');

// OpenAI key
const openai = redactAgentText('Error: invalid key sk-abcdefghijklmnopqrstuvwxyz in request');
assert('OpenAI key redacted', !openai.includes('sk-abcdefghijklmnopqrstuvwxyz'));
assert('OpenAI key replaced with marker', openai.includes('REDACTED'));

// Anthropic key
const anthropic = redactAgentText('Auth failed for sk-ant-abcdefghijklmnopqrstuvwxyz123');
assert('Anthropic key redacted', !anthropic.includes('sk-ant-abcdefghijklmnopqrstuvwxyz123'));

// Google API key (AIza prefix, 39+ chars total)
const google = redactAgentText('Request to x-goog-api-key: AIzaSyBhJdKsLmNpQrStUvWxYz0123456789abc failed');
assert('Google API key redacted', !google.includes('AIzaSyBhJdKsLmNpQrStUvWxYz0123456789abc'));
assert('Google key marker present', google.includes('REDACTED'));

// Bearer token
const bearer = redactAgentText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIx.mHlpc');
assert('Bearer token redacted', !bearer.includes('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIx.mHlpc'));
assert('Bearer prefix preserved', bearer.includes('Bearer ***REDACTED***'));

// JWT
const jwt = redactAgentText('Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
assert('JWT redacted', !jwt.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));

// GitHub PAT
const ghp = redactAgentText('Using ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD');
assert('GitHub PAT (ghp_) redacted', !ghp.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD'));

// Generic key=value
const kv = redactAgentText('api_key=sk-abcdefghijklmnopqrstuvwxyz and token=verylongtokenvalue1234567890');
assert('api_key= redacted', !kv.includes('sk-abcdefghijklmnopqrstuvwxyz'));
assert('token= redacted', !kv.includes('verylongtokenvalue1234567890'));

// Header line: x-goog-api-key
const header = redactAgentText('x-goog-api-key: AIzaSyDUMMYKEYFORUNITTEST1234567890abcd');
assert('x-goog-api-key header redacted', !header.includes('AIzaSyDUMMYKEYFORUNITTEST1234567890abcd'));

// Header line: authorization
const authz = redactAgentText('authorization: Bearer somelongtokenvalue1234567890');
assert('authorization header redacted', !authz.includes('somelongtokenvalue1234567890'));

// URL query param
const url = redactAgentText('GET https://api.example.com/v1/chat?api_key=sk-abcdefghijklmnopqrstuvwxyz');
assert('URL ?api_key= redacted', !url.includes('sk-abcdefghijklmnopqrstuvwxyz'));
assert('URL host preserved', url.includes('api.example.com/v1/chat'));

// ─── 1b. Non-secret text passes through unchanged ──────────────────────────
console.log('\n1b. Non-secret text preserved:');
const safe1 = redactAgentText('Planning approach...');
assert('plain status text unchanged', safe1 === 'Planning approach...');
const safe2 = redactAgentText('Running tool write_file with path /home/user/src/app.ts');
assert('tool message with path unchanged', safe2 === 'Running tool write_file with path /home/user/src/app.ts');
const safe3 = redactAgentText('Step 3 of 5 completed.');
assert('step progress unchanged', safe3 === 'Step 3 of 5 completed.');
const safe4 = redactAgentText('Verified: tests pass (12/12).');
assert('verification text unchanged', safe4 === 'Verified: tests pass (12/12).');
// Short strings that LOOK like keys but are too short (< 20 chars) should NOT be redacted
const safe5 = redactAgentText('sk-short');
assert('short sk- prefix not redacted (too short to be a real key)', safe5 === 'sk-short');

// ─── 1c. Edge cases: empty / null / non-string ──────────────────────────────
console.log('\n1c. Edge cases:');
assert('empty string → empty string', redactAgentText('') === '');
assert('null → null (returned as-is)', redactAgentText(null as any) === null);
assert('undefined → undefined (returned as-is)', redactAgentText(undefined as any) === undefined);
assert('non-secret JSON unchanged', redactAgentText('{"tool":"write_file","path":"/tmp/x"}') === '{"tool":"write_file","path":"/tmp/x"}');

// ─── 2. AgentStateDisplay revived + imported by NexChatPanel ────────────────
console.log('\n2. AgentStateDisplay revived + wired:');
const chatSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/chat/NexChatPanel.tsx'), 'utf-8');
assert('NexChatPanel imports AgentStateDisplay', /import\s+AgentStateDisplay(?:,\s*\{\s*type\s+AgentEvent\s*\})?\s+from\s+['"][^'"]*AgentStateDisplay['"]/.test(chatSrc));
assert('NexChatPanel renders <AgentStateDisplay', /<AgentStateDisplay/.test(chatSrc));
assert('NexChatPanel passes events prop', /events=\{agentEvents\}/.test(chatSrc));
assert('NexChatPanel passes streamText prop', /streamText=\{agentStreamText\}/.test(chatSrc));
assert('NexChatPanel passes onStop prop', /onStop=\{handleStop\}/.test(chatSrc));
assert('NexChatPanel has agentEvents state', /useState<AgentEvent\[\]>/.test(chatSrc));
assert('NexChatPanel has agentStreamText state', /const\s+\[agentStreamText,\s*setAgentStreamText\]/.test(chatSrc));

// ─── 3. Uses EXISTING agent-event IPC — no new event bus ────────────────────
console.log('\n3. Existing agent-event IPC (no new event bus):');
assert('NexChatPanel uses window.nexAPI.onAgentEvent (existing IPC)', /window\.nexAPI\?\.onAgentEvent\?/.test(chatSrc));
assert('NexChatPanel does NOT create a new IPC channel for activity', !/ipcRenderer\.on\(['"]agent-activity['"]/.test(chatSrc) && !/ipcRenderer\.on\(['"]live-activity['"]/.test(chatSrc));
assert('AgentStateDisplay does NOT subscribe to any IPC directly', (() => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/agent/AgentStateDisplay.tsx'), 'utf-8');
  return !/ipcRenderer/.test(src) && !/window\.nexAPI/.test(src);
})());

// ─── 4. streamText filtered to FINAL phase only ────────────────────────────
console.log('\n4. streamText FINAL-phase-only filter:');
assert('NexChatPanel checks phase === final before accumulating streamText', /phase\s*===\s*['"]final['"]/.test(chatSrc));
assert('NexChatPanel does NOT accumulate planning-phase tokens into streamText', (() => {
  // The accumulation (setAgentStreamText(prev => prev + ...)) must be INSIDE
  // the `if (phase === 'final')` block, not unconditional.
  const idx = chatSrc.indexOf("phase === 'final'");
  if (idx === -1) return false;
  // Find the next setAgentStreamText((prev) after the phase check
  const after = chatSrc.slice(idx);
  const accIdx = after.indexOf('setAgentStreamText((prev)');
  if (accIdx === -1) return false;
  // The accumulation must come AFTER the phase check (within the same block)
  return accIdx < 500; // within the same block
})());

// ─── 5. No fake animation ──────────────────────────────────────────────────
console.log('\n5. No fake animation:');
const stateSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/agent/AgentStateDisplay.tsx'), 'utf-8');
assert('AgentStateDisplay returns null when no events and no streamText', /if\s*\(events\.length\s*===\s*0\s*&&\s*!streamText\)\s*return\s*null/.test(stateSrc));
assert('AgentStateDisplay does NOT fake a "searching" state when idle', !/searching/i.test(stateSrc.replace(/\/\/[^\n]*/g, '')));
assert('AgentStateDisplay does NOT fake a "thinking" indicator when no real events', (() => {
  // The only "thinking" should come from the streamPhase default label, which
  // only renders when streamText is truthy (a REAL final-phase stream).
  return !/thinking/i.test(stateSrc.replace(/streamPhase \|\| ['"]thinking['"]/, '').replace(/\/\/[^\n]*/g, ''));
})());

// ─── 6. Architecture: Agent core has ZERO direct imports of AgentStateDisplay ─
console.log('\n6. Architecture (agent core never imports UI):');
const agentDir = path.join(__dirname, '../../src/main/agent');
const agentFiles = fs.readdirSync(agentDir).filter((f) => f.endsWith('.ts'));
assert('agent/ has ZERO imports of AgentStateDisplay', (() => {
  for (const f of agentFiles) {
    const src = fs.readFileSync(path.join(agentDir, f), 'utf-8');
    if (/AgentStateDisplay/.test(src)) return false;
  }
  return true;
})());

// ─── 7. Architecture: AgentStateDisplay is a passive consumer ─────────────
console.log('\n7. AgentStateDisplay is passive (no side effects):');
assert('AgentStateDisplay does NOT call any nexAPI method', !/window\.nexAPI\./.test(stateSrc));
assert('AgentStateDisplay does NOT call ipcRenderer', !/ipcRenderer/.test(stateSrc));
assert('AgentStateDisplay does NOT mutate global state', !/voiceController/.test(stateSrc));

// ─── 8. event.message is redacted in the component ────────────────────────
console.log('\n8. event.message redaction in component:');
assert('getEventState calls redactAgentText on event.message', /redactAgentText\(event\.message/.test(stateSrc));
assert('streamText is redacted before rendering', /redactAgentText\(streamText/.test(stateSrc));
assert('activeTool.message is redacted', /redactAgentText\(activeTool\.message/.test(stateSrc));
assert('redactAgentText is exported (for unit testing)', /export\s+function\s+redactAgentText/.test(stateSrc));

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`PHASE O5 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('ALL PHASE O5 LIVE ACTIVITY TESTS PASS ✅');
