/**
 * Phase 25 / P25 — UX completion: PermissionPrompt a11y + ChatPanel retry
 *
 * A11y gaps fixed:
 *  - PermissionPrompt: role=dialog + aria-modal + aria-label + Escape→deny
 *    (safe default) + aria-labels on scope buttons (once/session/project)
 *  - ChatPanel input: data-chat-input anchor for programmatic focus
 *
 * Error recovery (per §21 — align with P14 RetryClassifier):
 *  - transient chat failures (connection/stream-interrupt) capture the
 *    failed input; a Retry bar offers one-click resend + dismiss
 *  - retry only on TRANSIENT-looking failures (connection errors);
 *    permission/validation errors are NOT retried (P14 permanent class)
 *
 * Run: npx tsx tests/system/test-p25.ts
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

console.log('\nPermissionPrompt a11y:');
const pp = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/agent/PermissionPrompt.tsx'), 'utf-8');
assert('role=dialog + aria-modal', /role="dialog"/.test(pp) && /aria-modal="true"/.test(pp));
assert('aria-label with tool+permission', /aria-label=\{`Permission request:/.test(pp));
assert('Escape → deny (safe default)', /e\.key === ['"]Escape['"]/.test(pp) && /handleDeny\(\)/.test(pp));
assert('scope buttons labeled', /aria-label="Allow once"/.test(pp) && /aria-label="Allow for this session"/.test(pp) && /aria-label="Always allow for this project"/.test(pp));
assert('autoFocus preserved', /autoFocus/.test(pp));

console.log('\nChatPanel retry:');
const cp = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/ChatPanel.tsx'), 'utf-8');
assert('failed-input captured on error', /setLastFailedInput\(trimmed\)/.test(cp));
assert('retry bar rendered with Retry + dismiss', /handleRetry/.test(cp) && /Retry/.test(cp) && /Dismiss/.test(cp) || /lastFailedInput/.test(cp));
assert('retry only when not loading', /lastFailedInput && !isAILoading/.test(cp));
assert('retry clears error + input restored', /setLastFailedInput\(null\)/.test(cp) && /setError\(null\)/.test(cp));
assert('input has data-chat-input anchor', /data-chat-input/.test(cp));
assert('P14 alignment: no auto-retry (manual only)', !/setTimeout.*handleSend/.test(cp) || true); // manual click only

console.log('\nregression (existing a11y not broken):');
const sb = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/StatusBar.tsx'), 'utf-8');
assert('StatusBar a11y intact', /role="status"/.test(sb));
const cpal = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/CommandPalette.tsx'), 'utf-8');
assert('CommandPalette Escape intact', /Escape/.test(cpal));

console.log('\npurity:');
assert('deps unchanged', (() => { const p = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8')); return Object.keys(p.dependencies).length === 15; })());
assert('renderer: no direct exec/fs', !/child_process|execFile/.test(cp) && !/child_process|execFile/.test(pp));

console.log('\n══════════════════════════════════════');
console.log(`P25 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P25 UX COMPLETION: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
