/**
 * UI-06 — Command Palette Wiring Tests
 *
 * Verifies:
 *   1. Dead store calls (setActivePanel/setSidebarView) replaced with
 *      nex:navigate CustomEvent
 *   2. AppShell listens for nex:navigate and calls setView
 *   3. All 12 original commands now work + 4 new nav commands added
 *   4. No dead store imports remain
 *
 * Run: npx tsx tests/system/test-ui06-command-palette.ts
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

  console.log('\n1) CommandPalette: nex:navigate CustomEvent introduced:');
  const cpSrc = read('../../src/renderer/components/CommandPalette.tsx');
  assert('imports NexView type from NavigationRail', /import type \{ NexView \} from '\.\/layout\/NavigationRail'/.test(cpSrc));
  assert('navigateTo helper function defined', /function navigateTo\(view: NexView\)/.test(cpSrc));
  assert('navigateTo dispatches nex:navigate CustomEvent', /window\.dispatchEvent\(new CustomEvent\('nex:navigate'/.test(cpSrc));
  assert('focusChat helper function defined', /function focusChat\(\)/.test(cpSrc));
  assert('focusChat dispatches nex:focus-chat CustomEvent', /window\.dispatchEvent\(new CustomEvent\('nex:focus-chat'/.test(cpSrc));

  console.log('\n2) Dead store calls removed from CommandPalette:');
  assert('NO setActivePanel calls remain', !/setActivePanel\(/.test(cpSrc));
  assert('NO setSidebarView calls remain', !/setSidebarView\(/.test(cpSrc));
  assert('NO toggleTerminal calls remain', !/toggleTerminal\(\)/.test(cpSrc));
  assert('setActivePanel NOT in useStore destructuring', !/setActivePanel,/.test(cpSrc));
  assert('setSidebarView NOT in useStore destructuring', !/setSidebarView,/.test(cpSrc));
  assert('toggleTerminal NOT in useStore destructuring', !/toggleTerminal,/.test(cpSrc));
  assert('setTerminalVisible NOT in useStore destructuring', !/setTerminalVisible,/.test(cpSrc));

  console.log('\n3) All original commands now use navigateTo or focusChat:');
  // UI-15: toggle-terminal replaced with open-workspace (consolidated).
  assert('open-workspace uses navigateTo(workspace)', /id: 'open-workspace'[\s\S]*?navigateTo\('workspace'\)/.test(cpSrc));
  assert('open-chat uses focusChat()', /id: 'open-chat'[\s\S]*?focusChat\(\)/.test(cpSrc));
  assert('open-settings uses navigateTo(settings)', /id: 'open-settings'[\s\S]*?navigateTo\('settings'\)/.test(cpSrc));
  assert('view-knowledge uses navigateTo(knowledge)', /id: 'view-knowledge'[\s\S]*?navigateTo\('knowledge'\)/.test(cpSrc));
  assert('view-memory uses navigateTo(memory)', /id: 'view-memory'[\s\S]*?navigateTo\('memory'\)/.test(cpSrc));

  console.log('\n4) Working commands preserved (no regression):');
  assert('open-folder still uses nexAPI.openFolder', /window\.nexAPI\.openFolder\(\)/.test(cpSrc));
  assert('save-file still uses saveFile', /if \(activeFile\) saveFile\(activeFile\)/.test(cpSrc));
  assert('increase-font still uses updateSettings', /updateSettings\(\{ fontSize:/.test(cpSrc));
  assert('decrease-font still uses updateSettings', /updateSettings\(\{ fontSize: Math\.max\(10,/.test(cpSrc));

  console.log('\n5) UI-15: New nav commands added (consolidated):');
  assert('open-workspace command added', /id: 'open-workspace'/.test(cpSrc));
  assert('open-workspace navigates to workspace', /id: 'open-workspace'[\s\S]*?navigateTo\('workspace'\)/.test(cpSrc));
  // UI-15: old sub-nav commands removed (consolidated into workspace)
  assert('NO view-home command (removed)', !/id: 'view-home'/.test(cpSrc));
  assert('NO view-files command (removed)', !/id: 'view-files'/.test(cpSrc));
  assert('NO view-agents command (removed)', !/id: 'view-agents'/.test(cpSrc));
  assert('NO view-tools command (removed)', !/id: 'view-tools'/.test(cpSrc));

  console.log('\n6) AppShell listens for nex:navigate:');
  const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
  assert('AppShell adds nex:navigate event listener', /addEventListener\('nex:navigate', handler\)/.test(shellSrc));
  assert('handler reads detail.view', /\(e as CustomEvent\)\.detail as \{ view: NexView \}/.test(shellSrc));
  assert('handler calls setView with detail.view', /setView\(detail\.view\)/.test(shellSrc));
  assert('listener removed on unmount', /removeEventListener\('nex:navigate', handler\)/.test(shellSrc));

  console.log('\n7) AppShell listens for nex:focus-chat:');
  assert('AppShell adds nex:focus-chat event listener', /addEventListener\('nex:focus-chat'/.test(shellSrc));
  assert('re-dispatches nex:focus-chat-input for NexChatPanel', /dispatchEvent\(new CustomEvent\('nex:focus-chat-input'\)\)/.test(shellSrc));
  assert('focus-chat listener removed on unmount', /removeEventListener\('nex:focus-chat'/.test(shellSrc));

  console.log('\n8) Command count check:');
  // Count command definitions — should be 12 original + 4 new = 16
  const commandCount = (cpSrc.match(/id: '[a-z-]+',/g) || []).length;
  assert('total commands >= 9 (UI-15 consolidated: removed 6 sub-nav, kept essentials + workspace)', commandCount >= 9);

  console.log('\n9) Accessibility preserved:');
  assert('keyboard navigation preserved (ArrowDown)', /e\.key === 'ArrowDown'/.test(cpSrc));
  assert('keyboard navigation preserved (ArrowUp)', /e\.key === 'ArrowUp'/.test(cpSrc));
  assert('Enter executes selected command', /e\.key === 'Enter'/.test(cpSrc));
  assert('Escape closes palette', /e\.key === 'Escape'/.test(cpSrc));
  assert('input autofocuses on mount', /inputRef\.current\?\.focus\(\)/.test(cpSrc));

  console.log('\n10) No new backend changes (pure renderer):');
  assert('NO new IPC calls added', !/window\.nexAPI\.\w+\(\)/.test(cpSrc.replace(/openFolder\(\)/g, '')) || (cpSrc.match(/window\.nexAPI\./g) || []).length === 1);

  console.log('\n11) Pattern consistency (matches existing nex: CustomEvents):');
  // AppShell already used nex:open-history-search, nex:voice-transcript, etc.
  assert('nex:navigate follows existing nex: event naming convention', /'nex:navigate'/.test(cpSrc));
  assert('nex:focus-chat follows existing nex: event naming convention', /'nex:focus-chat'/.test(cpSrc));
  assert('AppShell already had nex:open-history-search listener', /nex:open-history-search/.test(shellSrc));
  assert('AppShell already had nex:voice-transcript dispatch', /nex:voice-transcript/.test(shellSrc));

  console.log('\n══════════════════════════════════════');
  console.log(`UI-06 RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('UI-06 COMMAND PALETTE WIRING: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
