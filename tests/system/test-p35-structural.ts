/**
 * Phase 35 / P35 — Structural Tests (ErrorBoundary, Token Migration, A11y)
 *
 * Run: npx tsx tests/system/test-p35-structural.ts
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

// ═══ ErrorBoundary ═══
console.log('\nErrorBoundary structural:');
const ebSrc = read('../../src/renderer/components/layout/NexErrorBoundary.tsx');
assert('component file exists', ebSrc.length > 0);
assert('no third-party dependency', !ebSrc.includes('react-error-boundary'));
assert('uses native React.Component', ebSrc.includes('extends React.Component'));
assert('has error ID for diagnostics', ebSrc.includes('errorId'));
assert('theme-responsive (var(--nex-*)', ebSrc.includes('var(--nex-accent)'));
assert('has RefreshCw icon', ebSrc.includes('RefreshCw'));
assert('has AlertTriangle icon', ebSrc.includes('AlertTriangle'));
assert('reload calls window.location.reload', ebSrc.includes('window.location.reload'));
assert('dismiss resets state', ebSrc.includes('hasError: false'));

const appSrc = read('../../src/renderer/App.tsx');
assert('App.tsx wraps AppShell path', appSrc.includes('<NexErrorBoundary>'));
// UI-08: legacy fallback layout was removed (was dead code — AppShellReady
// was always non-null). Now there's only ONE NexErrorBoundary wrapper (around
// the single AppShell render path), not two (legacy + new).
assert('App.tsx has single NexErrorBoundary wrapper (legacy removed)', appSrc.split('<NexErrorBoundary>').length === 2);

// ═══ Token Migration (5 panels) ═══
console.log('\nToken migration structural:');
const panels = [
  'src/renderer/components/HardwareMonitorPanel.tsx',
  'src/renderer/components/agent/AgentDiffViewer.tsx',
  'src/renderer/components/agent/AgentStateDisplay.tsx',
  'src/renderer/components/agent/PermissionPrompt.tsx',
  'src/renderer/components/CommandPalette.tsx',
];
const legacyPattern = /bg-nex-|text-nex-|border-nex-|placeholder-nex-/;
for (const p of panels) {
  const src = read(`../../${p}`);
  const name = p.split('/').pop();
  const legacyCount = (src.match(legacyPattern) || []).length;
  assert(`${name}: zero legacy classes`, legacyCount === 0);
  const tokenCount = (src.match(/var\(--nex-/g) || []).length;
  assert(`${name}: uses NEX tokens (${tokenCount})`, tokenCount > 0);
}

// ═══ Malformed conversation protection ═══
console.log('\nMalformed protection structural:');
const validatorSrc = read('../../src/renderer/lib/conversation-validator.ts');
assert('validator module exists', validatorSrc.length > 0);
assert('validates id, role, content, timestamp', validatorSrc.includes('msg.id') && validatorSrc.includes('msg.role') && validatorSrc.includes('msg.content') && validatorSrc.includes('msg.timestamp'));

const chatSrc = read('../../src/renderer/components/chat/NexChatPanel.tsx');
assert('NexChatPanel imports validator', chatSrc.includes('validateConversationData'));
assert('startup restore uses validator', chatSrc.includes("Malformed conversation data on startup"));
assert('load event uses validator', chatSrc.includes('Malformed conversation on load'));

// ═══ Accessibility ═══
console.log('\nAccessibility structural:');
const histSrc = read('../../src/renderer/components/chat/ConversationHistory.tsx');
assert('ConversationHistory search has aria-label', histSrc.includes('aria-label="Search conversations"'));
const termSrc = read('../../src/renderer/components/layout/TerminalSessionPanel.tsx');
assert('Terminal Ctrl+C has aria-label', termSrc.includes('aria-label="Send Ctrl+C"'));
assert('Terminal Clear has aria-label', termSrc.includes('aria-label="Clear terminal"'));
assert('Terminal Close has aria-label', termSrc.includes('aria-label="Close terminal"'));

// ═══ Architecture unchanged ═══
console.log('\nArchitecture unchanged:');
assert('streaming still present', chatSrc.includes('aiChatStream'));
assert('voice still present', chatSrc.includes('voiceController'));
const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
assert('orb still present', shellSrc.includes('NexOrb'));
assert('NavigationRail still present', shellSrc.includes('NavigationRail'));
assert('BottomStatusBar still present', shellSrc.includes('BottomStatusBar'));
assert('NEX branding intact (NEX AI, UI-14)', shellSrc.includes('NEX AI'));
assert('no new database', !read('../../src/main/persistence/index.ts').includes('sqlite'));

console.log('\n══════════════════════════════════════');
console.log(`P35 STRUCTURAL RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P35 STRUCTURAL TESTS: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
