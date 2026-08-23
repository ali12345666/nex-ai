/**
 * Phase 29 / P29 — Real AI Chat Tests
 *
 * Tests message model, code block, attachment handling, and the
 * existing AI integration contract.
 *
 * Run: npx tsx tests/system/test-p29.ts
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

console.log('\n1) Chat message model:');
const { createMessage, toApiMessages, buildAttachmentContext, MAX_ATTACHMENT_INLINE } = await import('../../src/renderer/lib/chat-model');

const userMsg = createMessage('user', 'Hello NEX');
assert('user message created', userMsg.role === 'user' && userMsg.content === 'Hello NEX');
assert('user message has id', userMsg.id.startsWith('msg-'));
assert('user message complete status', userMsg.status === 'complete');

const aiMsg = createMessage('assistant', '');
assert('assistant starts pending', aiMsg.status === 'pending');

// toApiMessages
const apiMsgs = toApiMessages([userMsg, aiMsg]);
assert('toApiMessages filters non-complete', apiMsgs.length === 1);
assert('toApiMessages strips UI fields', apiMsgs[0].role === 'user' && apiMsgs[0].content === 'Hello NEX');

// buildAttachmentContext
const ctx = buildAttachmentContext([
  { id: '1', name: 'app.ts', path: '/app.ts', size: 100, extension: 'ts', content: 'const x = 1;' },
  { id: '2', name: 'readme.md', path: '/readme.md', size: 200, extension: 'md', content: '# Hello' },
]);
assert('attachment context includes files', ctx.includes('app.ts') && ctx.includes('readme.md'));
assert('attachment context includes content', ctx.includes('const x = 1;') && ctx.includes('# Hello'));
const emptyCtx = buildAttachmentContext([]);
assert('empty attachments → empty context', emptyCtx === '');

console.log('\n2) AI backend reuse (no second backend):');
const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');
const chatSrc = read('../../src/renderer/components/chat/NexChatPanel.tsx');
assert('uses existing aiChatStream (P17)', /aiChatStream\(providerConfig/.test(chatSrc));
assert('uses existing aiChat fallback (P8)', /aiChat\(providerConfig/.test(chatSrc));
assert('uses existing getProviderConfig', /getProviderConfig/.test(chatSrc));
assert('NO new AI backend created', !/new.*Provider|createProvider/.test(chatSrc));
assert('NO direct model imports in chat', !/from ['"].*ai\/glm|from ['"].*ai-service/.test(chatSrc));

console.log('\n3) Token migration:');
assert('uses var(--nex-* tokens)', /var\(--nex-/.test(chatSrc));
const bubbleSrc = read('../../src/renderer/components/chat/MessageBubble.tsx');
assert('MessageBubble uses tokens', /var\(--nex-/.test(bubbleSrc));
const codeSrc = read('../../src/renderer/components/chat/CodeBlock.tsx');
assert('CodeBlock uses tokens', /var\(--nex-/.test(codeSrc));
assert('NO old Tailwind color classes (nex-bg etc.)', !/nex-bg\(|nex-text\(|nex-card\(|nex-accent\(/.test(chatSrc));

console.log('\n4) Branding:');
assert('NO AURA in new components', !/AURA|aura/i.test(chatSrc + bubbleSrc + codeSrc));
assert('NEX AI referenced', /NEX AI/i.test(chatSrc) || /How can I help you/i.test(chatSrc));

console.log('\n5) Streaming + cancel:');
assert('streaming listener registered', /onChatToken/.test(chatSrc));
assert('stream buffer accumulates', /streamBufRef\.current \+= ev\.text/.test(chatSrc));
assert('cancel button present', /aiChatStreamCancel/.test(chatSrc));
assert('stop button during generation', /Stop generating|>Stop</.test(chatSrc) || /Square/.test(chatSrc));

console.log('\n6) Attachments:');
assert('attachment button', /Paperclip/.test(chatSrc));
assert('file input with accept types', /accept=/.test(chatSrc));
assert('drag & drop handler', /onDrop=/.test(chatSrc));
assert('attachment remove', /removeAttachment/.test(chatSrc));
assert('attachment size limit', /MAX_ATTACHMENT_INLINE/.test(chatSrc));
assert('attachment preview cards', /attachments\.length > 0/.test(chatSrc));
assert('error state for unsupported files', /Unsupported type/.test(chatSrc));
assert('error state for oversized files', /File too large/.test(chatSrc));

console.log('\n7) Error/retry:');
assert('error display', /error/.test(chatSrc) && /Retry/.test(chatSrc));
assert('user message preserved on error (not removed)', /status: 'error'/.test(chatSrc));

console.log('\n8) Accessibility:');
assert('aria-label on messages', /aria-label/.test(chatSrc));
assert('aria-label on input', /aria-label=\"Chat input\"/.test(chatSrc));
assert('role=list for messages', /role=\"list\"/.test(chatSrc));
assert('keyboard send (Enter)', /e\.key === 'Enter' && !e\.shiftKey/.test(chatSrc));
assert('Shift+Enter for newline (not prevented)', /shiftKey/.test(chatSrc));

console.log('\n9) Orb state integration:');
assert('NEX Orb state NOT duplicated in chat', !/orbState|orbState/.test(chatSrc));
assert("chat doesn't create second voice model", !/voiceState|Web Audio/.test(chatSrc));

console.log('\n10) Security:');
assert('NO secrets in renderer state', !/apiKey.*=/.test(chatSrc));
assert('NO localStorage', !/localStorage/.test(chatSrc));
assert('uses IPC only (no direct network)', !/fetch\(|XMLHttpRequest/.test(chatSrc));

console.log('\n══════════════════════════════════════');
console.log(`P29 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P29 REAL CHAT: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
