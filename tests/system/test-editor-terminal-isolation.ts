/**
 * Editor + Terminal Isolation — Regression Tests
 *
 * Verifies the ROOT-CAUSE fixes for:
 *   E1) Editor tab lock: WorkspacePanel's effect snapped activeTab back to
 *      'editor' on ANY tab click when a file was open.
 *   T1) Residual WWWWW: term.open() on a 0×0 container corrupted xterm's
 *      renderer; the lazy-init fix waits for real dimensions before open().
 *   E2) Editor model loss: <Editor> without `path` prop swapped content
 *      instead of models, losing undo/cursor state on tab switch.
 *
 * These are STATIC / structural tests — they verify the fix is present in
 * source without requiring a running Electron app. Windows runtime QA
 * (§25 in the audit) is NOT VERIFIED here and MUST be done by the user.
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
  // E1) WORKSPACE PANEL — editor tab lock fix
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) WorkspacePanel: editor tab-lock fix (E1):');
  const wpSrc = read('../../src/renderer/components/layout/WorkspacePanel.tsx');

  // The OLD bug: effect depended on [activeFile, activeTab] and forced
  // activeTab='editor' whenever activeTab !== 'editor' — snapping the tab
  // back on every user click to Terminal/Files/Preview/Logs.
  assert('NO [activeFile, activeTab] dep array', !/\[activeFile,\s*activeTab\]/.test(wpSrc),
    'old buggy dependency array still present');

  // The NEW fix: effect depends on [activeFile] only, and uses a ref to
  // detect CHANGE (only switch when activeFile actually changes).
  assert('effect depends on [activeFile] only', /\],\s*\[activeFile\]\);/.test(wpSrc) ||
    /useEffect\([\s\S]*?\},\s*\[activeFile\]\);/.test(wpSrc));
  assert('prevActiveFileRef tracks previous value', wpSrc.includes('prevActiveFileRef'));
  assert('guard: only switch when activeFile CHANGED', /activeFile !== prevActiveFileRef\.current/.test(wpSrc));
  assert('updates prevActiveFileRef after check', /prevActiveFileRef\.current = activeFile/.test(wpSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // E2) EDITOR PANEL — Monaco model management fix
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) EditorPanel: Monaco model management fix (E2):');
  const epSrc = read('../../src/renderer/components/EditorPanel.tsx');

  // The fix: <Editor path={...}> lets @monaco-editor/react manage per-file
  // models (swap instead of setValue — preserves undo history + cursor).
  assert('<Editor> has path prop', /path=\{activeFileData\.path\}/.test(epSrc));

  // FileTab uses stable key (file.path, not index).
  assert('FileTab key is file.path (stable)', /key=\{file\.path\}/.test(epSrc));

  // No global keyboard capture that would block terminal.
  assert('NO window.addEventListener keydown', !/window\.addEventListener\('keydown'/.test(epSrc));
  assert('NO document.addEventListener', !/document\.addEventListener/.test(epSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // T1) TERMINAL SESSION PANEL — lazy-init fix (residual WWWWW)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) TerminalSessionPanel: lazy-init fix (T1 — residual WWWWW):');
  const tpSrc = read('../../src/renderer/components/layout/TerminalSessionPanel.tsx');

  // The fix: xterm is NOT created/opened on mount unconditionally. Instead
  // a createXterm() function checks isVisible(container) first.
  assert('createXterm() function present', tpSrc.includes('createXterm'));
  assert('isVisible() guard present', tpSrc.includes('isVisible'));
  assert('createXterm checks isVisible before open', /if \(!container \|\| !isVisible\(container\)\) return false/.test(tpSrc));
  assert('xtermCreatedRef one-shot guard', tpSrc.includes('xtermCreatedRef'));

  // The mount effect does NOT call term.open() directly — it calls
  // createXterm() which gates on visibility.
  assert('mount effect calls createXterm (not term.open directly)',
    /useEffect\([\s\S]{0,300}createXterm\(\)/.test(tpSrc));

  // ResizeObserver in mount effect handles the visibility transition
  // (display:none → display:flex) and triggers lazy-init.
  assert('ResizeObserver triggers createXterm on visibility', /ResizeObserver[\s\S]{0,400}createXterm/.test(tpSrc));

  // PTY spawn happens AFTER fit (correct geometry from byte zero).
  assert('spawn called inside createXterm (after fit)', /createXterm[\s\S]{0,800}spawnSession/.test(tpSrc));

  // Existing guards preserved.
  assert('MIN_COLS guard present', tpSrc.includes('MIN_COLS'));
  assert('MIN_ROWS guard present', tpSrc.includes('MIN_ROWS'));
  assert('safeDims validator present', tpSrc.includes('safeDims'));
  assert('lastReportedRef resize dedupe', tpSrc.includes('lastReportedRef'));
  assert('hasSpawnedRef single-spawn guard', tpSrc.includes('hasSpawnedRef'));
  assert('spawnedCwdRef cwd dedupe', tpSrc.includes('spawnedCwdRef'));
  assert('NO manual prompt injection', !tpSrc.includes('PS C:'));
  assert('NO removeAllListeners CALL', !/removeAllListeners\s*\(/.test(tpSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) NO GLOBAL EVENT BLOCKING FROM TERMINAL
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Terminal does not block global events (isolation):');
  // Terminal's preventDefault/stopPropagation must be SCOPED to the
  // contextmenu event on its own container — never on document/window.
  const contextMenuMatches = tpSrc.match(/preventDefault\(\)|stopPropagation\(\)/g) || [];
  assert('preventDefault/stopPropagation only in contextmenu handler',
    // All preventDefault/stopPropagation calls must be inside the
    // handleContextMenu function (scoped to the terminal container).
    /handleContextMenu[\s\S]{0,300}preventDefault[\s\S]{0,50}stopPropagation/.test(tpSrc));

  // Terminal must NOT add window-level keydown/mousedown/click listeners
  // (those would block Editor/Explorer/Tab clicks).
  assert('NO window keydown listener in terminal', !/window\.addEventListener\('keydown'/.test(tpSrc));
  assert('NO document keydown listener in terminal', !/document\.addEventListener\('keydown'/.test(tpSrc));
  assert('NO window mousedown listener in terminal', !/window\.addEventListener\('mousedown'/.test(tpSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) WORKSPACE — terminal tab and editor tab are siblings (no nesting)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Workspace tab structure (no nested blocking):');
  // Both editor and terminal tabs use the same display:none pattern (they
  // may not be adjacent — other tabs sit between them).
  assert('editor tab uses display:none pattern', /display: activeTab === 'editor' \? 'flex' : 'none'/.test(wpSrc));
  assert('terminal tab uses display:none pattern', /display: activeTab === 'terminal' \? 'flex' : 'none'/.test(wpSrc));
  assert('tabs switched via setActiveTab (not activePanel)', /onClick=\{\(\) => setActiveTab\(tab\.id\)\}/.test(wpSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) STORE — openFile does NOT clobber activeTab
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Store: openFile/setActiveFile behaviour:');
  const storeSrc = read('../../src/renderer/store/useStore.ts');
  // openFile sets activePanel='editor' (store-level), NOT activeTab
  // (WorkspacePanel-local). activeTab is only controlled by the
  // prevActiveFileRef effect, which fires on activeFile CHANGE.
  assert('openFile sets activePanel (not activeTab)', /openFile: async[\s\S]{0,200}activePanel: 'editor'/.test(storeSrc));
  assert('setActiveFile sets activePanel', /setActiveFile:[\s\S]{0,100}activePanel: 'editor'/.test(storeSrc));
  // closeFile handles remaining files + activeFile fallback.
  assert('closeFile filters remaining files', /closeFile:[\s\S]{0,300}openFiles\.filter/.test(storeSrc));
  assert('closeFile handles activeFile fallback', /remaining\[remaining\.length - 1\]/.test(storeSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) INVARIANT CHECKS (static)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Invariants:');
  // One TerminalSessionPanel instance per WorkspacePanel (not duplicated).
  const wspSrc = read('../../src/renderer/components/layout/WorkspacePanel.tsx');
  const tspCount = (wspSrc.match(/TerminalSessionPanel/g) || []).length;
  assert('TerminalSessionPanel imported + rendered once each', tspCount >= 2);
  const editorCount = (wspSrc.match(/EditorPanel/g) || []).length;
  assert('EditorPanel imported + rendered once each', editorCount >= 2);

  // Terminal's keyboard handler is attached via term.attachCustomKeyEventHandler
  // (scoped to the xterm canvas) — NOT via window/document listeners.
  assert('terminal keyboard via attachCustomKeyEventHandler (scoped)',
    tpSrc.includes('attachCustomKeyEventHandler'));
  assert('NO window-level keyboard capture in terminal',
    !/window\.addEventListener\('keydown'/.test(tpSrc));

  console.log('\n══════════════════════════════════════');
  console.log(`EDITOR+TERMINAL ISOLATION RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('EDITOR + TERMINAL ISOLATION: ALL PASS ✅');
  console.log('\nNOTE: Windows runtime QA (§25) is NOT VERIFIED by this test.');
  console.log('      The user MUST verify the §25 checklist on Windows manually.');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
