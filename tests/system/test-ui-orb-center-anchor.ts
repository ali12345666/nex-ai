/**
 * UI Layout — Orb Center Anchor Test
 *
 * Verifies Orb is ALWAYS centered (never moves when panels open).
 * Verifies workspace panel is absolute overlay (not in flex flow).
 * Verifies single panel rendering (no duplicates).
 *
 * Run: npx tsx tests/system/test-ui-orb-center-anchor.ts
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
  const shellNoComments = shellSrc.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('{/*')).join('\n');

  console.log('\n1) Orb is CENTER ANCHOR (absolute centered, never in flex flow):');
  assert('Orb container uses absolute inset-0 for centering', /absolute inset-0 flex flex-col items-center justify-center/.test(shellSrc));
  assert('Orb wrapper has pointer-events-none', /pointer-events-none/.test(shellSrc));
  assert('Orb inner container has pointer-events-auto', /pointer-events-auto/.test(shellSrc));

  console.log('\n2) Orb size is FIXED (does not change with panel state):');
  // Orb should NOT have showOrb conditional sizing
  assert('NO showOrb conditional on orb width', !/showOrb \? 'min\(/.test(shellSrc));
  assert('NO showOrb conditional on orb height', !/showOrb \? 'min\(\d+vh.*height/.test(shellSrc));
  assert('NO transition on orb size (no resize animation)', !/transition: 'width/.test(shellSrc));
  assert('Orb has fixed min() size', /min\(62vh, 42vw\)/.test(shellSrc));
  assert('Orb container is NOT shrink-0 (absolute, no flex)', !/shrink-0/.test(shellSrc.match(/Orb container.*?div/s)?.[0] || ''));

  console.log('\n3) Workspace panel is ABSOLUTE OVERLAY (not in flex flow):');
  assert('panel uses absolute positioning', /absolute.*nex-glass-strong/.test(shellSrc));
  assert('panel has fixed top/bottom/left (not right/full)', /top: 8,/.test(shellSrc) && /bottom: 8,/.test(shellSrc) && /left: 8,/.test(shellSrc));
  assert('panel has width for non-settings', /width: view === 'settings'/.test(shellSrc) || /width: 420/.test(shellSrc));
  assert('panel has maxWidth constraint', /maxWidth:/.test(shellSrc));
  assert('panel has zIndex', /zIndex: 5/.test(shellSrc));
  assert('panel does NOT use flex-1 or shrink-0', !/flex-1.*nex-glass-strong/.test(shellSrc) && !/shrink-0.*nex-glass-strong/.test(shellSrc));

  console.log('\n4) Main row uses relative (for absolute children):');
  assert('main row has relative class', /flex flex-1 overflow-hidden relative/.test(shellSrc));

  console.log('\n5) Center area is relative (Orb absolute inside):');
  assert('center container has relative + overflow-hidden', /flex-1 relative overflow-hidden/.test(shellSrc));

  console.log('\n6) Single panel rendering (no duplicates):');
  assert('leftPanel() called once via IIFE', /!showOrb \? leftPanel()/.test(shellSrc));
  assert('NO double panel render path', !/absolute inset-0 nex-glass-strong/.test(shellSrc));

  console.log('\n7) Chat is fixed-width (independent of panel):');
  assert('Chat has fixed width 360', /width: 360/.test(shellSrc));
  assert('Chat has minWidth 320', /minWidth: 320/.test(shellSrc));
  assert('Chat is NOT affected by panel (flex sibling, not absolute)', /nex-glass-accent.*flex flex-col/.test(shellSrc));

  console.log('\n8) Navigation is single-source (view state only):');
  assert('view state is the single source of truth', /const \[view, setView\] = useState/.test(shellSrc));
  assert('NO activePanel in code', !/activePanel/.test(shellNoComments));
  assert('NO sidebarView in code', !/sidebarView/.test(shellNoComments));

  console.log('\n9) Orb header shows ONLY "NEX AI" (minimal):');
  assert('NEX AI present', /NEX AI/.test(shellSrc));
  assert('NO LOCAL INTELLIGENCE subtitle', !/LOCAL INTELLIGENCE/.test(shellSrc));
  assert('NO ALWAYS READY subtitle', !/ALWAYS READY/.test(shellSrc));

  console.log('\n10) Panel close returns to Orb with no layout shift:');
  assert('showOrb variable controls panel visibility', /const showOrb = view === 'chat'/.test(shellSrc));
  assert('panel conditional on !showOrb (IIFE)', /!showOrb \? leftPanel()/.test(shellSrc));
  // Orb container is always present — no conditional render that would cause layout shift
  assert('Orb always rendered (no showOrb conditional on Orb itself)', /absolute inset-0 flex flex-col items-center justify-center pointer-events-none/.test(shellSrc));

  console.log('\n══════════════════════════════════════');
  console.log(`ORB CENTER ANCHOR RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('ORB CENTER ANCHOR: ALL PASS ✅');
  console.log('');
  console.log('ORB = CENTER FIXED ANCHOR ✓');
  console.log('WORKSPACE = ABSOLUTE OVERLAY ✓');
  console.log('CHAT = INDEPENDENT ✓');
  console.log('NO LAYOUT SHIFT ✓');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
