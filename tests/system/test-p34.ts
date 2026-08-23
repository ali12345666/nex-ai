/**
 * Phase 34 / P34 — Conversation UX Polish + Token Migration Tests
 *
 * Run: npx tsx tests/system/test-p34.ts
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

// ═══ PART 1: Ctrl+K ═══
console.log('\n1) Ctrl+K complete wiring:');
const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
const histSrc = read('../../src/renderer/components/chat/ConversationHistory.tsx');
const chatSrc = read('../../src/renderer/components/chat/NexChatPanel.tsx');

assert('NexChatPanel dispatches nex:open-history-search', chatSrc.includes('nex:open-history-search'));
assert('AppShell listens for nex:open-history-search', shellSrc.includes('nex:open-history-search'));
assert('AppShell opens history on event', shellSrc.includes('setHistoryOpen(true)'));
assert('AppShell dispatches nex:focus-history-search', shellSrc.includes('nex:focus-history-search'));
assert('ConversationHistory listens for nex:focus-history-search', histSrc.includes('nex:focus-history-search'));
assert('ConversationHistory focuses search input on event', histSrc.includes('searchInputRef.current?.focus()'));
assert('ConversationHistory selects text on event', histSrc.includes('searchInputRef.current?.select()'));
assert('Ctrl+K has isInput guard', chatSrc.includes("tagName === 'INPUT'") && chatSrc.includes("tagName === 'TEXTAREA'"));
assert('Ctrl+K prevents default', chatSrc.includes('e.preventDefault()'));
assert('Escape closes history', histSrc.includes("e.key === 'Escape'") || histSrc.includes("'Escape'"));
assert('searchInputRef is an input ref', histSrc.includes('searchInputRef = useRef<HTMLInputElement>'));

// ═══ PART 2: Conversation UX ═══
console.log('\n2) Edit UX:');
assert('edit guard (isGenerating)', chatSrc.includes('if (isGenerating || isResendingRef.current) return;'));
assert('isResendingRef prevents double-send', chatSrc.includes('isResendingRef'));
assert('resend guard resets after 1s', chatSrc.includes('1000'));
assert('editing blocks send', chatSrc.includes('if (editingMessageId) return'));
assert('edit truncates messages', chatSrc.includes('messages.slice(0, msgIndex)'));
assert('edit persists truncated conversation', chatSrc.includes('saveConversation(newMessages)'));

console.log('\n3) Regenerate UX:');
assert('regenerate guard', chatSrc.includes('handleRegenerate'));
assert('regenerate removes assistant response', chatSrc.includes('messages.slice(0, lastAssistantIdx)'));
assert('regenerate sets truncated messages', chatSrc.includes('setMessages(truncated)'));
assert('regenerate only on last assistant', chatSrc.includes('msg === messages[messages.length - 1]'));

console.log('\n4) Auto-save regression:');
assert('saveConversation still exists', chatSrc.includes('const saveConversation = useCallback'));
assert('auto-save on stream complete', chatSrc.includes('auto-save on completed'));
assert('auto-save in finally', chatSrc.includes('final save'));
assert('save on unmount', chatSrc.includes('Save on unmount'));

console.log('\n5) Startup restore regression:');
assert('restore on mount', chatSrc.includes('Startup restore'));
assert('graceful fallback', chatSrc.includes('no conversations or IPC unavailable'));

console.log('\n6) ConversationHistory states:');
assert('loading state', histSrc.includes('isLoading'));
assert('loading spinner', histSrc.includes('animate-spin') || histSrc.includes('Loading'));
assert('load error state', histSrc.includes('loadError'));
assert('error retry button', histSrc.includes('Retry'));
assert('empty state (no conversations)', histSrc.includes('No conversations yet'));
assert('no search results state', histSrc.includes('No results for'));
assert('all states use NEX tokens', histSrc.includes('var(--nex-'));
assert('loading state does NOT show list', histSrc.includes('!isLoading') || histSrc.includes('isLoading &&'));

// ═══ PART 3: Token Migration ═══
console.log('\n7) Token migration (5 panels):');
const panels = ['ModelsPanel', 'SettingsPanel', 'KnowledgePanel', 'MemoryPanel', 'PluginsPanel'];
const legacyPatterns = /bg-nex-|text-nex-|border-nex-|placeholder-nex-/;
for (const p of panels) {
  const src = read(`../../src/renderer/components/${p}.tsx`);
  const legacyCount = (src.match(legacyPatterns) || []).length;
  assert(`${p}: zero legacy classes (${legacyCount} found)`, legacyCount === 0);
  const tokenCount = (src.match(/var\(--nex-/g) || []).length;
  assert(`${p}: uses NEX tokens (${tokenCount} instances)`, tokenCount > 0);
}

console.log('\n8) Architecture unchanged:');
assert('voice still imported in chat', chatSrc.includes('voiceController'));
assert('orb audio still in AppShell', shellSrc.includes('orbAudioRef'));
assert('NEX branding intact', shellSrc.includes('N E X'));
assert('NavigationRail still present', shellSrc.includes('NavigationRail'));
assert('BottomStatusBar still present', shellSrc.includes('BottomStatusBar'));
assert('no new database', !read('../../src/main/persistence/index.ts').includes('sqlite'));
assert('streaming still present', chatSrc.includes('aiChatStream'));

console.log('\n══════════════════════════════════════');
console.log(`P34 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P34 CONVERSATION UX + TOKEN MIGRATION: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
