/**
 * UI Navigation Single Panel Test
 *
 * Verifies the CRITICAL fix: ONE CLICK = ONE PANEL.
 *
 * Root cause: leftPanel() was called TWICE in AppShell JSX:
 *   1. In a 300px left workspace div (rendered panel)
 *   2. In the center area when showOrb=false (rendered SAME panel again)
 *
 * Fix: Removed the left workspace div entirely. Center area is the SOLE
 * panel renderer. One call to leftPanel(), one panel instance.
 *
 * Run: npx tsx tests/system/test-ui-nav-single-panel.ts
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
  const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');

  console.log('\n1) leftPanel() called EXACTLY ONCE in JSX (was twice):');
  // Count occurrences of leftPanel() in the JSX render section (not in the function definition)
  const renderSection = shellSrc.slice(shellSrc.indexOf('return ('));
  const leftPanelCalls = (renderSection.match(/\{leftPanel\(\)\}/g) || []).length;
  assert('leftPanel() called exactly once in render', leftPanelCalls === 1, `found ${leftPanelCalls} calls`);

  console.log('\n2) No separate 300px left workspace div (removed):');
  assert('NO 300px width workspace div', !/width: 300,/.test(renderSection) || !/leftPanel\(\)/.test(renderSection.split('width: 300')[0]?.slice(-200) || ''));
  // More specific: no div that contains leftPanel() AND has width 300
  assert('NO left workspace panel div with leftPanel()', !/width: 300[\s\S]*?leftPanel\(\)/.test(renderSection) && !/leftPanel\(\)[\s\S]*?width: 300/.test(renderSection));

  console.log('\n3) Single source of truth — center area is canonical renderer:');
  assert('showOrb variable controls center content', /const showOrb = view === 'chat'/.test(shellSrc));
  assert('center area has showOrb conditional', /\{showOrb \?/.test(renderSection));
  assert('center area calls leftPanel() in else branch', /: \([\s\S]*?leftPanel\(\)/.test(renderSection));

  console.log('\n4) Navigation — 5 nav items, each routes to ONE panel:');
  const navSrc = read('../../src/renderer/components/layout/NavigationRail.tsx');
  const navItems = (navSrc.match(/id: '/g) || []).length;
  assert('exactly 5 nav items', navItems === 5, `found ${navItems}`);

  // Each nav item should have exactly ONE case in leftPanel switch
  // Count in the full file (comments excluded)
  const shellNoComments2 = shellSrc.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('{/*') && !l.trim().startsWith('*')).join('\n');
  for (const item of ['chat', 'workspace', 'knowledge', 'memory', 'settings']) {
    const count = (shellNoComments2.match(new RegExp(`case '${item}':`, 'g')) || []).length;
    assert(`case '${item}' appears exactly once`, count === 1, `found ${count}`);
  }

  console.log('\n5) No duplicate event listeners:');
  const navigateListeners = (shellSrc.match(/addEventListener\('nex:navigate'/g) || []).length;
  assert('exactly 1 nex:navigate listener', navigateListeners === 1, `found ${navigateListeners}`);
  const focusChatListeners = (shellSrc.match(/addEventListener\('nex:focus-chat'/g) || []).length;
  assert('exactly 1 nex:focus-chat listener', focusChatListeners === 1, `found ${focusChatListeners}`);
  const historyListeners = (shellSrc.match(/addEventListener\('nex:open-history-search'/g) || []).length;
  assert('exactly 1 nex:open-history-search listener', historyListeners === 1, `found ${historyListeners}`);

  console.log('\n6) All listeners have cleanup (removeEventListener):');
  assert('nex:navigate has removeEventListener', /removeEventListener\('nex:navigate'/.test(shellSrc));
  assert('nex:focus-chat has removeEventListener', /removeEventListener\('nex:focus-chat'/.test(shellSrc));
  assert('nex:open-history-search has removeEventListener', /removeEventListener\('nex:open-history-search'/.test(shellSrc));

  console.log('\n7) No parallel state systems controlling panels:');
  // Verify there's no sidebarView or activePanel store reads in AppShell
  // (these were old legacy state systems from Phase 27)
  assert('NO sidebarView in AppShell', !/sidebarView/.test(shellSrc));
  assert('NO activePanel in AppShell (legacy store)', !/activePanel/.test(shellSrc) || /activePanel/.test(shellSrc.split('//')[0] || ''));
  // activePanel may appear in comments — check non-comment code
  const shellNoComments = shellSrc.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('{/*')).join('\n');
  assert('NO activePanel in code (comments OK)', !/activePanel/.test(shellNoComments));
  assert('NO sidebarView in code (comments OK)', !/sidebarView/.test(shellNoComments));

  console.log('\n8) Chat view shows Orb (not a panel):');
  assert("case 'chat' returns null", /case 'chat': return null/.test(shellSrc));
  assert('showOrb is true when view=chat', /showOrb = view === 'chat'/.test(shellSrc));

  console.log('\n9) Non-chat views render panel in center ONLY (not left):');
  // The center area's else branch should contain leftPanel()
  assert('else branch (non-chat) calls leftPanel()', /: \([\s\S]*?leftPanel\(\)/.test(renderSection));
  // Count leftPanel() calls in render section — should be exactly 1
  const leftPanelInRender = (renderSection.match(/\{leftPanel\(\)\}/g) || []).length;
  assert('exactly 1 leftPanel() call in render', leftPanelInRender === 1, `found ${leftPanelInRender}`);

  console.log('\n10) CommandPalette uses nex:navigate (single event, single handler):');
  const cpSrc = read('../../src/renderer/components/CommandPalette.tsx');
  assert('CommandPalette dispatches nex:navigate', /dispatchEvent\(new CustomEvent\('nex:navigate'/.test(cpSrc));
  assert('NO setActivePanel in CommandPalette code', !/setActivePanel/.test(cpSrc.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')));
  assert('NO setSidebarView in CommandPalette code', !/setSidebarView/.test(cpSrc.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')));

  console.log('\n══════════════════════════════════════');
  console.log(`NAV SINGLE PANEL RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('NAVIGATION SINGLE PANEL: ALL PASS ✅');
  console.log('');
  console.log('ONE CLICK = ONE NAVIGATION = ONE ACTIVE PANEL ✓');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
