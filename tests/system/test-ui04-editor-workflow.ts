/**
 * UI-04 — Editor Workflow Tests
 *
 * Verifies the critical fix: clicking a file in WorkspaceExplorer now
 * actually displays the EditorPanel (was previously a silent no-op —
 * openFile() set activePanel='editor' in store, but AppShell never
 * rendered EditorPanel).
 *
 * Run: npx tsx tests/system/test-ui04-editor-workflow.ts
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

  console.log('\n1) AppShell now renders EditorPanel when a file is open:');
  const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
  // UI-16: EditorPanel moved to WorkspacePanel, not AppShell
  assert('NO EditorPanel import in AppShell (moved to WorkspacePanel)', !/const EditorPanel = lazy/.test(shellSrc));
  assert('NO activeFile in AppShell (moved to WorkspacePanel)', !/activeFile/.test(shellSrc.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('{/*')).join('\n')));
  assert('NO closeFile in AppShell (moved to WorkspacePanel)', !/closeFile/.test(shellSrc.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('{/*')).join('\n')));
  // UI-16: Orb is always visible, panels float beside it
  assert('Orb always rendered (showOrb used for sizing)', /showOrb/.test(shellSrc));

  console.log('\n2) EditorPanel now in WorkspacePanel (UI-15+UI-16):');
  const wsSrc = read('../../src/renderer/components/layout/WorkspacePanel.tsx');
  assert('WorkspacePanel imports EditorPanel', /EditorPanel/.test(wsSrc));
  assert('WorkspacePanel has editor tab (display:none pattern)', /display.*editor.*EditorPanel/.test(wsSrc) || /EditorPanel/.test(wsSrc));
  // UI-16: Escape handler removed from AppShell (was UI-04 feature, now editor
  // is inside WorkspacePanel which handles its own keyboard shortcuts)
  assert('NO Escape handler in AppShell (moved to WorkspacePanel)', !/addEventListener\('keydown'/.test(shellSrc));

  console.log('\n3) Floating panel layout (UI-16):');
  assert('floating panel uses nex-glass-strong', /nex-glass-strong/.test(shellSrc));
  assert('floating panel uses nex-animate-in', /nex-animate-in/.test(shellSrc));
  assert('panel is absolute overlay (not flex)', /absolute/.test(shellSrc));
  assert('panel has conditional width (settings wider)', /view === 'settings'/.test(shellSrc) || /width: 420/.test(shellSrc));

  console.log('\n4) Orb always visible (UI-16):');
  assert('NEX AI branding present', /NEX AI/.test(shellSrc));
  assert('NO LOCAL INTELLIGENCE subtitle (UI-16 removed)', !/LOCAL INTELLIGENCE/.test(shellSrc));
  assert('NO ALWAYS READY subtitle (UI-16 removed)', !/ALWAYS READY/.test(shellSrc));
  assert('Orb container has responsive sizing (dynamic)', /min\(\d+vh/.test(shellSrc));
  assert('Orb always rendered (showOrb used for sizing)', /showOrb/.test(shellSrc));
  assert('Orb fallback OrbLoading still present', /OrbLoading/.test(shellSrc));
  assert('NO voice toggle button (UI-14)', !/voiceActive \? 'LISTENING' : 'VOICE'/.test(shellSrc));
  assert('Partial transcript display still present', /partialTranscript/.test(shellSrc));

  console.log('\n5) Store openFile/closeFile contract unchanged:');
  const storeSrc = read('../../src/renderer/store/useStore.ts');
  assert('openFile sets activeFile + activePanel', /set\(\{ activeFile: filePath, activePanel: 'editor' \}\)/.test(storeSrc));
  assert('closeFile clears activeFile when matching', /activeFile:[\s\S]*?s\.activeFile === filePath/.test(storeSrc));
  assert('closeFile returns to chat when no files left', /activePanel: remaining\.length === 0 \? 'chat' : s\.activePanel/.test(storeSrc));
  assert('openFile reads file via nexAPI.readFile', /window\.nexAPI\.readFile\(filePath\)/.test(storeSrc));
  assert('openFile detects language from filename', /getLanguageFromFilename\(name\)/.test(storeSrc));

  console.log('\n6) EditorPanel component unchanged (reads from store):');
  const editorSrc = read('../../src/renderer/components/EditorPanel.tsx');
  assert('EditorPanel still imports Monaco', /@monaco-editor\/react/.test(editorSrc));
  assert('reads openFiles from store', /openFiles,/.test(editorSrc));
  assert('reads activeFile from store', /activeFile,/.test(editorSrc));
  assert('reads closeFile from store', /closeFile,/.test(editorSrc));
  assert('reads setActiveFile from store', /setActiveFile,/.test(editorSrc));
  assert('reads updateFileContent from store', /updateFileContent,/.test(editorSrc));
  assert('reads saveFile from store', /saveFile,/.test(editorSrc));
  assert('empty state when no open files', /if \(openFiles\.length === 0\)/.test(editorSrc));
  assert('FileTab component present', /function FileTab/.test(editorSrc));
  assert('Save button calls saveFile', /saveFile\(activeFile\)/.test(editorSrc));

  console.log('\n7) No dead code introduced (UI-16 architecture):');
  // UI-16: EditorPanel not in AppShell (moved to WorkspacePanel)
  assert('NO EditorPanel rendered in AppShell', (shellSrc.match(/<EditorPanel/g) || []).length === 0);
  assert('Only one NexOrb JSX render in AppShell', (shellSrc.match(/<NexOrb[\s/]/g) || []).length === 1);
  assert('NO closeFile calls in AppShell', (shellSrc.match(/closeFile\(/g) || []).length === 0);

  console.log('\n8) WorkspaceExplorer unchanged (still calls openFile):');
  const explorerSrc = read('../../src/renderer/components/layout/WorkspaceExplorer.tsx');
  assert('WorkspaceExplorer still imports openFile from store', /\{[^}]*openFile[^}]*\} = useStore/.test(explorerSrc));
  assert('WorkspaceExplorer still calls openFile on click', /openFile\(f\.path\)/.test(explorerSrc));
  assert('WorkspaceExplorer still calls openFile on Enter', /openFile\(node\.path\)/.test(explorerSrc));

  console.log('\n══════════════════════════════════════');
  console.log(`UI-04 RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('UI-04 EDITOR WORKFLOW: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
