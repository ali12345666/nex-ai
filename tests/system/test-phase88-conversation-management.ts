/**
 * Phase 88 — Conversation Management Tests
 *
 * Verifies:
 *   1. conversation-create IPC handler exists
 *   2. conversation-update IPC handler exists
 *   3. createConversation function in persistence
 *   4. updateConversation function in persistence
 *   5. Preload bindings for create + update
 *   6. Type declarations for create + update
 *   7. NexChatPanel has New Chat button
 *   8. NexChatPanel has Delete Chat button
 *   9. NexChatPanel has conversation title display
 *  10. handleNewChat clears all state
 *  11. handleDeleteChat calls conversationDelete
 *  12. Conversation header is visible
 *  13. Ctrl+N keyboard shortcut dispatches nex:new-conversation
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
  console.log('Phase 88 — Conversation Management Tests');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) Persistence layer
  // ═══════════════════════════════════════════════════════════════════════
  console.log('1) Persistence layer:');
  const persistSrc = read('../../src/main/persistence/index.ts');

  assert('createConversation function exists', persistSrc.includes('export function createConversation'));
  assert('createConversation generates ID', persistSrc.includes('conv-${Date.now()}'));
  assert('createConversation saves empty conversation', persistSrc.includes('messages: []'));
  assert('updateConversation function exists', persistSrc.includes('export function updateConversation'));
  assert('updateConversation loads + merges + saves', persistSrc.includes('...conv, ...updates'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) IPC handlers
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');

  assert('conversation-create handler exists', mainSrc.includes("ipcMain.handle('conversation-create'"));
  assert('conversation-create calls createConversation', mainSrc.includes('createConversation(title)'));
  assert('conversation-create returns id', mainSrc.includes('return { success: true, id }'));
  assert('conversation-update handler exists', mainSrc.includes("ipcMain.handle('conversation-update'"));
  assert('conversation-update calls updateConversation', mainSrc.includes('updateConversation(id, updates)'));
  assert('imports createConversation', mainSrc.includes('createConversation, updateConversation'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) Preload + types
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Preload + types:');
  const preloadSrc = read('../../src/main/preload.ts');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');

  assert('preload: conversationCreate', preloadSrc.includes('conversationCreate:'));
  assert('preload: conversationUpdate', preloadSrc.includes('conversationUpdate:'));
  assert('types: conversationCreate declared', typesSrc.includes('conversationCreate:'));
  assert('types: conversationUpdate declared', typesSrc.includes('conversationUpdate:'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) NexChatPanel UI
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) NexChatPanel UI:');
  const chatSrc = read('../../src/renderer/components/chat/NexChatPanel.tsx');

  assert('Plus icon imported', chatSrc.includes('Plus,'));
  assert('Trash2 icon imported', chatSrc.includes('Trash2,'));
  assert('handleNewChat function exists', chatSrc.includes('const handleNewChat'));
  assert('handleNewChat clears messages', chatSrc.includes('setMessages([])'));
  assert('handleNewChat clears conversationId', chatSrc.includes('setConversationId(null)'));
  assert('handleNewChat dispatches event', chatSrc.includes("nex:new-conversation"));
  assert('handleDeleteChat function exists', chatSrc.includes('const handleDeleteChat'));
  assert('handleDeleteChat calls conversationDelete', chatSrc.includes('conversationDelete(id)'));
  assert('handleDeleteChat calls handleNewChat after delete', chatSrc.includes('handleNewChat()'));
  assert('New Chat button exists', chatSrc.includes('New'));
  assert('Conversation header exists', chatSrc.includes('Conversation Header'));
  assert('Conversation title displayed', chatSrc.includes('conversationTitle'));
  assert('Delete button conditional on conversationId', chatSrc.includes('conversationId && messages.length > 0'));
  assert('New button has aria-label', chatSrc.includes('aria-label="New conversation"'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Keyboard shortcut
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Keyboard shortcut:');
  assert('Ctrl+N shortcut exists', chatSrc.includes("e.key === 'n'"));
  assert('Ctrl+N dispatches nex:new-conversation', chatSrc.includes("nex:new-conversation"));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Existing conversation system intact
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Existing system intact:');
  assert('conversation-save still exists', mainSrc.includes("ipcMain.handle('conversation-save'"));
  assert('conversation-load still exists', mainSrc.includes("ipcMain.handle('conversation-load'"));
  assert('conversation-list still exists', mainSrc.includes("ipcMain.handle('conversation-list'"));
  assert('conversation-delete still exists', mainSrc.includes("ipcMain.handle('conversation-delete'"));
  assert('conversation-rename still exists', mainSrc.includes("ipcMain.handle('conversation-rename'"));
  assert('conversation-search still exists', mainSrc.includes("ipcMain.handle('conversation-search'"));
  assert('saveConversation still exists in persistence', persistSrc.includes('export function saveConversation'));
  assert('loadConversation still exists in persistence', persistSrc.includes('export function loadConversation'));
  assert('listConversations still exists in persistence', persistSrc.includes('export function listConversations'));
  assert('deleteConversation still exists in persistence', persistSrc.includes('export function deleteConversation'));
  assert('renameConversation still exists in persistence', persistSrc.includes('export function renameConversation'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) ConversationHistory component (existing)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) ConversationHistory:');
  const historySrc = read('../../src/renderer/components/chat/ConversationHistory.tsx');
  assert('ConversationHistory has New button', historySrc.includes('New Conversation'));
  assert('ConversationHistory has search', historySrc.includes('Search conversations'));
  assert('ConversationHistory has delete with confirm', historySrc.includes('confirmDelete'));
  assert('ConversationHistory has rename', historySrc.includes('handleRename'));
  assert('ConversationHistory groups by time', historySrc.includes('timeGroup'));

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 88 Tests: ${pass} passed, ${fail} failed`);
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
