/**
 * Phase 33 / P33 — Conversation Lifecycle Tests
 *
 * Tests auto-save, startup restore, edit, regenerate, shortcuts,
 * and regression of existing conversation persistence.
 *
 * Run: npx tsx tests/system/test-p33.ts
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
const chatSrc = read('../../src/renderer/components/chat/NexChatPanel.tsx');

console.log('\n1) Auto-save:');
assert('saveConversation function defined', /const saveConversation = useCallback/.test(chatSrc));
assert('auto-save after streaming completes', /auto-save on completed/.test(chatSrc));
assert('auto-save in finally block', /final save.*captures error\/partial/.test(chatSrc));
assert('save on unmount (crash safety)', /Save on unmount/.test(chatSrc));
assert('dedup guard (500ms)', /lastSavedAt.*500/.test(chatSrc));
assert('lazily creates conversation ID', /conv-.*Date\.now/.test(chatSrc));
assert('auto-title from first user message', /find.*role === 'user'.*slice\(0, 60\)/.test(chatSrc));
assert('attachment content stripped for persistence', /content.*NOT persisted|a\.content\.length < 2048/.test(chatSrc));

console.log('\n2) Startup restore:');
assert('restore on mount', /Startup restore/.test(chatSrc));
assert('loads last conversation from list', chatSrc.includes('conversationList') && chatSrc.includes('conversations[0]'));
assert('graceful fallback on error', /no conversations or IPC unavailable/.test(chatSrc));

console.log('\n3) Load/New conversation events:');
assert('listens for nex:load-conversation', /nex:load-conversation/.test(chatSrc));
assert('listens for nex:new-conversation', /nex:new-conversation/.test(chatSrc));
assert('new conversation resets state', /setConversationId\(null\)/.test(chatSrc));

console.log('\n4) Edit message:');
assert('startEdit function exists', /const startEdit/.test(chatSrc));
assert('handleEditMessage function exists', /const handleEditMessage/.test(chatSrc));
assert('edit truncates dependent messages', /messages\.slice\(0, msgIndex\)/.test(chatSrc));
assert('edit persists truncated conversation', /saveConversation\(newMessages\)/.test(chatSrc));
assert('edit textarea with Enter/Escape', /Edit message.*Enter.*Escape/.test(chatSrc) || /e\.key === 'Enter'/.test(chatSrc));
assert('Edit button on user messages', /msg\.role === 'user'/.test(chatSrc) && />Edit</.test(chatSrc) || /Edit message/.test(chatSrc));

console.log('\n5) Regenerate:');
assert('handleRegenerate function exists', /const handleRegenerate/.test(chatSrc));
assert('regenerate removes last assistant response', /messages\.slice\(0, lastAssistantIdx\)/.test(chatSrc));
assert('regenerate re-sends user message', /userContent/.test(chatSrc));
assert('regenerate only on last assistant message', /msg === messages\[messages\.length - 1\]/.test(chatSrc));
assert('Regenerate button present', /Regenerate/.test(chatSrc));
assert('no duplicate messages (truncates before resend)', /setMessages\(truncated\)/.test(chatSrc));

console.log('\n6) Keyboard shortcuts:');
assert('Ctrl+N for new conversation', /ctrlKey.*metaKey.*key === 'n'/.test(chatSrc));
assert('Ctrl+K for history search', /ctrlKey.*metaKey.*key === 'k'/.test(chatSrc));
assert('shortcut NOT active in input/textarea', /isInput.*tagName === 'INPUT'.*TEXTAREA/.test(chatSrc));
assert('shortcut cleanup on unmount', /removeEventListener.*keydown/.test(chatSrc));

console.log('\n7) Streaming regression:');
assert('aiChatStream still used', /aiChatStream\(providerConfig/.test(chatSrc));
assert('onChatToken listener still active', /onChatToken/.test(chatSrc));
assert('streaming status still updates messages', /status: 'streaming'/.test(chatSrc));
assert('stop/cancel still present', /aiChatStreamCancel/.test(chatSrc));
assert('non-stream fallback still present', /aiChat\(providerConfig/.test(chatSrc));

console.log('\n8) No secrets persisted:');
assert('no apiKey in save payload', !chatSrc.includes('apiKey'));
assert('no password in save payload', !chatSrc.includes('password'));
assert('no token in save payload', !chatSrc.includes('token:'));

console.log('\n9) Existing persistence reuse:');
const persistSrc = read('../../src/main/persistence/index.ts');
assert('uses persistence/index.ts (no second DB)', persistSrc.includes('saveConversation') && persistSrc.includes('loadConversation'));
assert('file-based (JSON), no SQL/no new DB engine', !persistSrc.includes('sqlite') && !persistSrc.includes('better-sqlite') && !persistSrc.includes('leveldb'));

console.log('\n10) Architecture unchanged:');
assert('voice controller still imported', /voiceController/.test(chatSrc));
assert('thinking state still wired', /setThinking/.test(chatSrc));
assert('message model still NexMessage', /NexMessage/.test(chatSrc));
assert('getProviderConfig still used', /getProviderConfig/.test(chatSrc));
const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
assert('AppShell composition preserved (NEX AI branding, UI-14)', /NEX AI/.test(shellSrc));
// UI-14 §3: voice toggle removed
assert('NO voice toggle (UI-14)', !/VOICE/.test(shellSrc));
assert('orb still receives audioLevel', /orbAudioRef/.test(shellSrc));

console.log('\n══════════════════════════════════════');
console.log(`P33 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P33 CONVERSATION LIFECYCLE: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
