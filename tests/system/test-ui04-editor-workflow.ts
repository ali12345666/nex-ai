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
  assert('imports EditorPanel (lazy)', /const EditorPanel = lazy\(\(\) => import\('\.\.\/EditorPanel'\)\)/.test(shellSrc));
  assert('reads activeFile from useStore', /activeFile, closeFile\}\) = useStore\(\)/.test(shellSrc) || /activeFile.*=.*useStore/.test(shellSrc));
  assert('reads closeFile from useStore', /closeFile.*=.*useStore/.test(shellSrc));
  assert('conditional render: activeFile ? editor : orb', /\{activeFile \? \(/.test(shellSrc));
  assert('editor overlay has close button calling closeFile', /onClick=\{\(\) => closeFile\(activeFile\)\}/.test(shellSrc));
  assert('editor body wrapped in Suspense with EditorPanel', /<Suspense fallback=\{<PanelLoading \/>\}>[\s\S]*?<EditorPanel \/>/.test(shellSrc));
  assert('Orb only renders when no active file (else branch)', /\) : \([\s\S]*?<[\s\S]*?<NexOrb/.test(shellSrc));

  console.log('\n2) Escape key closes editor (UX improvement):');
  assert('Escape key listener registered', /addEventListener\('keydown', onKey\)/.test(shellSrc));
  assert('Escape triggers closeFile when activeFile set', /e\.key === 'Escape' && activeFile/.test(shellSrc));
  assert('Escape not triggered inside INPUT', /target\.tagName === 'INPUT'/.test(shellSrc));
  assert('Escape not triggered inside TEXTAREA', /target\.tagName === 'TEXTAREA'/.test(shellSrc));
  assert('Escape not triggered in contentEditable', /target\.isContentEditable/.test(shellSrc));
  assert('Escape not triggered when historyOpen', /&& !historyOpen/.test(shellSrc));
  assert('keydown listener removed on unmount', /removeEventListener\('keydown', onKey\)/.test(shellSrc));

  console.log('\n3) Editor overlay layout + a11y:');
  assert('overlay uses nex-glass-strong class', /nex-glass-strong/.test(shellSrc));
  assert('overlay uses nex-animate-in class', /nex-animate-in/.test(shellSrc));
  assert('overlay is absolute positioned', /absolute inset-0/.test(shellSrc));
  assert('overlay has rounded corners', /borderRadius: 'var\(--nex-radius-lg\)'/.test(shellSrc));
  assert('close button has aria-label', /aria-label="Close editor and return to Orb"/.test(shellSrc));
  assert('close button has title with Esc hint', /title="Close editor \(Esc\)"/.test(shellSrc));
  assert('filename shown in header (basename from activeFile)', /activeFile\.split\(/.test(shellSrc) && /\.pop\(\)/.test(shellSrc));
  assert('filename has title attribute for full path', /title=\{activeFile\}/.test(shellSrc));

  console.log('\n4) No regression to Orb + branding (shown when no file open):');
  assert('N E X branding still present', /N E X/.test(shellSrc));
  assert('AI ASSISTANT subtitle still present', /AI ASSISTANT/.test(shellSrc));
  // UI-13: orb size increased ~2x — old min(42vh,38vw) → new min(72vh,48vw).
  // Test updated to check for responsive sizing (either old or new pattern is fine
  // as long as it's viewport-responsive, not fixed px).
  assert('Orb container still has responsive sizing', /width: 'min\(\d+vh, \d+vw\)'/.test(shellSrc));
  assert('Orb fallback OrbLoading still present', /fallback=\{<OrbLoading \/>\}/.test(shellSrc));
  assert('Voice toggle button still in Orb view', /voiceActive \? 'LISTENING' : 'VOICE'/.test(shellSrc));
  assert('Partial transcript display still in Orb view', /partialTranscript/.test(shellSrc));

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

  console.log('\n7) No dead code introduced:');
  // Verify we didn't accidentally leave a duplicate render path.
  assert('EditorPanel only rendered once in AppShell', (shellSrc.match(/<EditorPanel/g) || []).length === 1);
  assert('Only one NexOrb JSX render in AppShell (not lazy import)', (shellSrc.match(/<NexOrb[\s/]/g) || []).length === 1);
  assert('closeFile(activeFile) called from overlay button AND Escape handler', (shellSrc.match(/closeFile\(activeFile\)/g) || []).length === 2);

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
