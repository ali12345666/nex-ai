/**
 * UI-08 — Dead Code Sweep Tests
 *
 * Verifies:
 *   1. App.tsx legacy fallback layout removed (was 47 lines of dead code)
 *   2. 15 dead legacy imports removed from App.tsx
 *   3. SidebarContent function removed (was only used by legacy layout)
 *   4. AppShellReady variable removed (was always non-null — dead branch)
 *   5. Legacy component files still exist (not deleted — other phases may
 *      re-wire them; deletion is a separate decision)
 *   6. No regression to AppShell rendering path
 *
 * Run: npx tsx tests/system/test-ui08-dead-code-sweep.ts
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

  console.log('\n1) App.tsx: legacy fallback layout removed:');
  const appSrc = read('../../src/renderer/App.tsx');
  assert('NO <TitleBar> JSX in App.tsx', !appSrc.includes('<TitleBar'));
  assert('NO <Sidebar> JSX in App.tsx', !appSrc.includes('<Sidebar'));
  assert('NO <StatusBar> JSX in App.tsx', !appSrc.includes('<StatusBar'));
  assert('NO <WelcomeScreen> JSX in App.tsx', !appSrc.includes('<WelcomeScreen'));
  assert('NO legacy SidebarContent function', !appSrc.includes('function SidebarContent'));
  assert('NO legacy SIDEBAR_WIDTH constant', !appSrc.includes('SIDEBAR_WIDTH'));
  assert('NO legacy panelMap definition', !appSrc.includes('panelMap'));
  assert('NO activePanel === \'settings\' legacy render', !appSrc.includes("activePanel === 'settings' && <SettingsPanel"));
  assert('NO activePanel === \'chat\' legacy render', !appSrc.includes("activePanel === 'chat' && (hasFiles"));

  console.log('\n2) App.tsx: dead legacy imports removed:');
  assert('NO import TitleBar', !/^import TitleBar/m.test(appSrc));
  assert('NO import Sidebar', !/^import Sidebar/m.test(appSrc));
  assert('NO import ChatPanel (legacy)', !/^import ChatPanel/m.test(appSrc));
  assert('NO import TerminalPanel (legacy)', !/^import TerminalPanel/m.test(appSrc));
  assert('NO import FileExplorer (legacy)', !/^import FileExplorer/m.test(appSrc));
  assert('NO import SearchPanel (legacy)', !/^import SearchPanel/m.test(appSrc));
  assert('NO import SnippetPanel', !/^import SnippetPanel/m.test(appSrc));
  assert('NO import DiagnosticsPanel (legacy)', !/^import DiagnosticsPanel/m.test(appSrc));
  assert('NO import ModelsPanel (legacy)', !/^import ModelsPanel/m.test(appSrc));
  assert('NO import WelcomeScreen', !/^import WelcomeScreen/m.test(appSrc));
  assert('NO import StatusBar (legacy)', !/^import StatusBar/m.test(appSrc));

  console.log('\n3) App.tsx: only essential imports remain:');
  assert('imports AppShell', appSrc.includes("import AppShell from './components/layout/AppShell'"));
  assert('imports CommandPalette', appSrc.includes("import CommandPalette from './components/CommandPalette'"));
  assert('imports PermissionPrompt', appSrc.includes("import PermissionPrompt from './components/agent/PermissionPrompt'"));
  assert('imports AgentDiffViewer', appSrc.includes("import AgentDiffViewer from './components/agent/AgentDiffViewer'"));
  assert('imports NexErrorBoundary', appSrc.includes("import NexErrorBoundary from './components/layout/NexErrorBoundary'"));
  assert('imports useStore', appSrc.includes("import { useStore } from './store/useStore'"));
  assert('total imports reduced (was 23, now ~7)', (appSrc.match(/^import /gm) || []).length <= 8);

  console.log('\n4) AppShellReady dead variable removed:');
  assert('NO AppShellReady variable declaration', !appSrc.includes('const AppShellReady'));
  assert('NO if (AppShellReady) conditional', !appSrc.includes('if (AppShellReady)'));
  assert('NO <AppShellReady /> JSX render', !appSrc.includes('<AppShellReady'));

  console.log('\n5) App.tsx: render path simplified (single return):');
  assert('single return statement at end', (appSrc.match(/^  return \(/gm) || []).length === 1);
  assert('AppShell rendered directly', /return \([\s\S]*?<AppShell \/>/.test(appSrc));
  assert('CommandPalette conditionally rendered', /commandPaletteOpen && <CommandPalette/.test(appSrc));
  assert('PermissionPrompt rendered', /<PermissionPrompt/.test(appSrc));
  assert('AgentDiffViewer conditionally rendered', /showDiffViewer && pendingDiffs\.length > 0/.test(appSrc));
  assert('NexErrorBoundary wraps everything', /<NexErrorBoundary>[\s\S]*?<AppShell \/>/.test(appSrc));

  console.log('\n6) onOpenSettings wired to nex:navigate (UI-06 pattern):');
  assert('onOpenSettings dispatches nex:navigate settings', /onOpenSettings\(\(\) => \{[\s\S]*?dispatchEvent\(new CustomEvent\('nex:navigate'[\s\S]*?view: 'settings'/.test(appSrc));

  console.log('\n7) Legacy component files still exist (not deleted — separate decision):');
  // These are still imported by other tests / potential future re-wiring.
  // Deletion would be a separate phase (and risks breaking p36 legacy audit).
  // UI-09 INTEGRATION FIX: SnippetPanel.tsx was removed from this list because
  // UI-09 deleted the file (fake data + __monacoEditor hack). The original
  // UI-08 test expected all 15 files to still exist; after merging UI-09,
  // SnippetPanel no longer exists.
  // TERMINAL REWRITE FIX: TerminalPanel.tsx was removed from this list because
  // the PTY rewrite deleted it — it was the old pipe-based terminal panel
  // superseded by TerminalSessionPanel (now PTY-backed). The old non-session
  // terminal IPC (terminal-spawn/write/output) was also removed.
  const componentFiles = [
    'TitleBar.tsx', 'Sidebar.tsx', 'ChatPanel.tsx',
    'FileExplorer.tsx', 'SearchPanel.tsx', 'DiagnosticsPanel.tsx',
    'ModelsPanel.tsx', 'WelcomeScreen.tsx', 'StatusBar.tsx', 'EditorPanel.tsx',
    'GitPanel.tsx', 'InputDialog.tsx', 'RecentProjects.tsx',
  ];
  for (const f of componentFiles) {
    const exists = fs.existsSync(path.join(__dirname, `../../src/renderer/components/${f}`));
    assert(`${f} still exists (not deleted)`, exists);
  }

  console.log('\n8) No regression to App.tsx functionality:');
  assert('useStore destructuring still present', /const \{[\s\S]*?\} = useStore\(\)/.test(appSrc));
  assert('permission prompt state still managed', /pendingPermission/.test(appSrc));
  assert('agent diff state still managed', /pendingDiffs/.test(appSrc) && /showDiffViewer/.test(appSrc));
  assert('keyboard shortcuts still wired', /handleKeyDown/.test(appSrc));
  assert('settings load on startup still present', /settingsLoad\(\)/.test(appSrc));
  assert('file watcher still active', /fsWatch/.test(appSrc) && /fsUnwatch/.test(appSrc));
  assert('onPermissionRequest listener still active', /onPermissionRequest/.test(appSrc));
  assert('onAgentEvent listener still active', /onAgentEvent/.test(appSrc));

  console.log('\n9) TypeScript compiles cleanly:');
  // This is checked externally — just verify the file is valid TS by structure.
  assert('App.tsx exports default App function', /export default App;/.test(appSrc));
  assert('App function defined', /function App\(\)/.test(appSrc));

  console.log('\n10) File size reduced (dead code eliminated):');
  const lineCount = appSrc.split('\n').length;
  assert('App.tsx under 220 lines (was 303)', lineCount < 220);

  console.log('\n══════════════════════════════════════');
  console.log(`UI-08 RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('UI-08 DEAD CODE SWEEP: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
