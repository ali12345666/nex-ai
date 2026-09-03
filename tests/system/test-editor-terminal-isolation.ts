/**
 * Editor + Terminal Isolation — Regression Tests
 *
 * Verifies:
 *   E1) Editor tab auto-switch on file open (nonce-based, no snap-back)
 *   E2) Monaco path → file:// URI conversion for Windows paths
 *   T1) Terminal session persistence (manager singleton, no dispose on unmount)
 *   T2) Terminal/Editor focus isolation (no global event blocking)
 *
 * Run: npx tsx tests/system/test-editor-terminal-isolation.ts
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

  // ═══════════════════════════════════════════════════════════════════════
  // E1) WORKSPACE PANEL — nonce-based tab switch (no snap-back)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) WorkspacePanel: nonce-based tab switch (E1):');
  const wpSrc = read('../../src/renderer/components/layout/WorkspacePanel.tsx');

  assert('reads openFileNonce from store', wpSrc.includes('openFileNonce'));
  assert('prevNonceRef tracks previous value', wpSrc.includes('prevNonceRef'));
  assert('effect compares nonce change', /openFileNonce !== prevNonceRef\.current/.test(wpSrc));
  assert('effect depends on [openFileNonce, activeFile]', /\[openFileNonce,\s*activeFile\]/.test(wpSrc));
  assert('NO old [activeFile, activeTab] dep array', !/\[activeFile,\s*activeTab\]/.test(wpSrc));
  assert('NO prevActiveFileRef (old pattern removed)', !wpSrc.includes('prevActiveFileRef'));

  // ═══════════════════════════════════════════════════════════════════════
  // E2) EDITOR PANEL — Monaco model management + Windows path fix
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) EditorPanel: Monaco path + URI conversion (E2):');
  const epSrc = read('../../src/renderer/components/EditorPanel.tsx');

  assert('pathToMonacoUri function present', epSrc.includes('pathToMonacoUri'));
  assert('Windows path detection (C:\\)', /[A-Za-z]:[\\/]/.test(epSrc));
  assert('file:// URI conversion', epSrc.includes('file:///'));
  assert('<Editor> uses pathToMonacoUri', /path=\{pathToMonacoUri\(/.test(epSrc));
  assert('FileTab key is file.path (stable)', /key=\{file\.path\}/.test(epSrc));
  assert('NO global keyboard capture', !/window\.addEventListener\('keydown'/.test(epSrc));
  assert('debug logging present', epSrc.includes('[EDITOR]'));

  // ═══════════════════════════════════════════════════════════════════════
  // T1) TERMINAL SESSION MANAGER — persistence architecture
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) TerminalSessionManager: persistence (T1):');
  const mgrSrc = read('../../src/renderer/services/terminal-session-manager.ts');
  const tpSrc = read('../../src/renderer/components/layout/TerminalSessionPanel.tsx');

  assert('manager file exists', mgrSrc.length > 0);
  assert('manager is a class', /class TerminalSessionManager/.test(mgrSrc));
  assert('manager exported as singleton', mgrSrc.includes('export const terminalSessionManager'));
  assert('ManagedTerminalSession interface', mgrSrc.includes('ManagedTerminalSession'));
  assert('sessions stored in Map', /Map<string, ManagedTerminalSession>/.test(mgrSrc));
  assert('getOrCreateSession method', mgrSrc.includes('getOrCreateSession'));
  assert('attachToContainer method', mgrSrc.includes('attachToContainer'));
  assert('detachFromContainer method', mgrSrc.includes('detachFromContainer'));
  assert('fitAndResize method', mgrSrc.includes('fitAndResize'));
  assert('disposeAll method', mgrSrc.includes('disposeAll'));
  assert('xterm CSS imported', mgrSrc.includes("xterm/css/xterm.css"));
  assert('cursor hex color (not CSS var)', mgrSrc.includes("cursor: '#00e5ff'"));
  assert('NO manual prompt injection', !mgrSrc.includes('PS C:'));

  // ═══════════════════════════════════════════════════════════════════════
  // T2) Panel is thin view — NO dispose/kill on unmount
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Panel: thin view (no dispose/kill on unmount):');
  assert('panel imports manager', tpSrc.includes('terminalSessionManager'));
  assert('panel calls getOrCreateSession', tpSrc.includes('getOrCreateSession'));
  assert('panel calls attachToContainer', tpSrc.includes('attachToContainer'));
  assert('panel calls detachFromContainer', tpSrc.includes('detachFromContainer'));
  assert('panel NO terminal.dispose()', !/terminal\.dispose\(\)/.test(tpSrc));
  assert('panel NO terminalSessionKill CALL (code, not comments)', !/terminalSessionManager\.\w+\([^)]*terminalSessionKill|\.terminalSessionKill\(/.test(tpSrc));
  assert('panel NO new Terminal()', !/new Terminal\(/.test(tpSrc));
  assert('panel NO new FitAddon()', !/new FitAddon\(\)/.test(tpSrc));
  assert('panel has ResizeObserver', tpSrc.includes('ResizeObserver'));
  assert('panel has isVisible guard', tpSrc.includes('isVisible'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) STORE — openFileNonce
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Store: openFileNonce:');
  const storeSrc = read('../../src/renderer/store/useStore.ts');
  assert('openFileNonce in state', storeSrc.includes('openFileNonce'));
  assert('openFileNonce initialized to 0', /openFileNonce:\s*0/.test(storeSrc));
  assert('openFile bumps nonce on new file', /openFileNonce: s\.openFileNonce \+ 1/.test(storeSrc));
  assert('openFile bumps nonce on existing file too', /existing[\s\S]{0,300}openFileNonce/.test(storeSrc));
  assert('openFile sets activePanel editor', /activePanel: 'editor'/.test(storeSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) NO GLOBAL EVENT BLOCKING
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) No global event blocking (isolation):');
  assert('panel NO window keydown', !/window\.addEventListener\('keydown'/.test(tpSrc));
  assert('panel NO document keydown', !/document\.addEventListener\('keydown'/.test(tpSrc));
  assert('manager keyboard via attachCustomKeyEventHandler', mgrSrc.includes('attachCustomKeyEventHandler'));
  assert('manager NO window keydown', !/window\.addEventListener\('keydown'/.test(mgrSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) WORKSPACE — display:none pattern (no unmount on tab switch)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Workspace: display:none pattern (no unmount):');
  assert('editor tab uses display:none', /display: activeTab === 'editor' \? 'flex' : 'none'/.test(wpSrc));
  assert('terminal tab uses display:none', /display: activeTab === 'terminal' \? 'flex' : 'none'/.test(wpSrc));
  assert('tabs switched via setActiveTab', /onClick=\{\(\) => setActiveTab\(tab\.id\)\}/.test(wpSrc));

  console.log('\n══════════════════════════════════════');
  console.log(`EDITOR+TERMINAL ISOLATION RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('EDITOR + TERMINAL ISOLATION: ALL PASS ✅');
  console.log('\nNOTE: Windows runtime QA is NOT VERIFIED by this test.');
  console.log('      The user MUST verify persistence + file-open on Windows.');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
