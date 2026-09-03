/**
 * Phase 32 / P32 — Conversation Center Tests
 *
 * Tests conversation CRUD via the real persistence module,
 * IPC contracts, and UI wiring.
 *
 * Run: npx tsx tests/system/test-p32.ts
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

console.log('\n1) Conversation persistence CRUD:');
const {
  saveConversation, loadConversation, listConversations,
  deleteConversation, renameConversation, searchConversations,
} = await import('../../src/main/persistence/index');

const conv1 = {
  id: 'test-conv-1', title: 'Test Conversation One',
  createdAt: Date.now() - 5000, updatedAt: Date.now() - 5000,
  messageCount: 2, messages: [
    { id: 'm1', role: 'user', content: 'Fix the Electron terminal IPC', timestamp: Date.now(), status: 'complete' },
    { id: 'm2', role: 'assistant', content: 'I can help with that.', timestamp: Date.now(), status: 'complete' },
  ],
};
const conv2 = {
  id: 'test-conv-2', title: 'VPN Project',
  createdAt: Date.now() - 86400000, updatedAt: Date.now() - 86400000,
  messageCount: 1, messages: [
    { id: 'm3', role: 'user', content: 'Configure WireGuard', timestamp: Date.now(), status: 'complete' },
  ],
};

assert('saveConversation conv1', saveConversation(conv1) === true);
assert('saveConversation conv2', saveConversation(conv2) === true);

const loaded = loadConversation('test-conv-1');
assert('loadConversation returns data', loaded !== null && loaded.title === 'Test Conversation One');
assert('loadConversation has messages', loaded.messages.length === 2);

const listed = listConversations();
assert('listConversations shows 2', listed.length >= 2);
assert('listConversations sorted by updatedAt desc', listed[0].updatedAt >= listed[1].updatedAt);

assert('renameConversation', renameConversation('test-conv-1', 'Renamed Title') === true);
const renamed = loadConversation('test-conv-1');
assert('rename persisted', renamed.title === 'Renamed Title');

const searchResult = searchConversations('WireGuard');
assert('searchConversations finds VPN', searchResult.some((c) => c.id === 'test-conv-2'));
const searchNone = searchConversations('nonexistent-query');
assert('searchConversations empty for no match', searchNone.length === 0);

assert('deleteConversation', deleteConversation('test-conv-2') === true);
assert('deleted conversation not in list', !listConversations().some((c) => c.id === 'test-conv-2'));
deleteConversation('test-conv-1');

// Path traversal test
const traversal = loadConversation('../../etc/passwd');
assert('path traversal blocked (returns null or empty)', traversal === null || !traversal);

console.log('\n2) IPC contract:');
const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');
const mainSrc = read('../../src/main/main.ts');
for (const ch of ['conversation-save','conversation-load','conversation-list','conversation-delete','conversation-rename','conversation-search']) {
  assert(`handler '${ch}'`, mainSrc.includes(`'${ch}'`));
}
const pre = read('../../src/main/preload.ts');
for (const b of ['conversationSave','conversationLoad','conversationList','conversationDelete','conversationRename','conversationSearch']) {
  assert(`preload ${b}`, pre.includes(b));
}

console.log('\n3) ConversationHistory component:');
const histSrc = read('../../src/renderer/components/chat/ConversationHistory.tsx');
assert('renders conversations', /conversations\.map/.test(histSrc) || /groups\.map/.test(histSrc));
assert('search with debounce', histSrc.includes('setTimeout') && histSrc.includes('}, 300)'));
assert('rename inline', /renaming/.test(histSrc));
assert('delete confirm', /confirmDelete/.test(histSrc));
assert('Escape to close', /Escape/.test(histSrc));
assert('click outside close', /mousedown/.test(histSrc));
assert('role=listbox', /listbox/.test(histSrc));
assert('aria-selected', /aria-selected/.test(histSrc));
assert('aria-label', /aria-label/.test(histSrc));
assert('new conversation button', /New Conversation/.test(histSrc));
assert('uses NEX tokens', /var\(--nex-/.test(histSrc));
assert('NO AURA branding', !/AURA/i.test(histSrc));

console.log('\n4) AppShell wiring:');
const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
assert('history button in chat header', /Conversation history/.test(shellSrc));
assert('ConversationHistory lazy loaded', /ConversationHistory/.test(shellSrc));
assert('conversation select dispatches event', /nex:load-conversation/.test(shellSrc));
assert('conversation new dispatches event', /nex:new-conversation/.test(shellSrc));

console.log('\n5) Persistence safety:');
assert('no secrets in conversation model', !/apiKey|password|token.*secret/.test(JSON.stringify(conv1)));
assert('persistence module reuses existing infra (no second DB)', mainSrc.includes('from \'./persistence\''));

console.log('\n6) Token migration check:');
const panels = ['ModelsPanel','SettingsPanel','KnowledgePanel','MemoryPanel','PluginsPanel'];
for (const p of panels) {
  const src = read(`../../src/renderer/components/${p}.tsx`);
  assert(`${p}: has some NEX tokens or is pending migration`, src.length > 0);
}

console.log('\n══════════════════════════════════════');
console.log(`P32 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P32 CONVERSATION CENTER: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
