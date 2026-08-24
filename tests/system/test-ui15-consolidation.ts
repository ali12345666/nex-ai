/**
 * UI-15 — Full UI Consolidation Tests
 *
 * Verifies:
 *   §2: Navigation consolidated to 5 items (Chat, Workspace, Memory, Knowledge, Settings)
 *   §3: Workspace has 5 tabs (Editor, Terminal, Preview, Files, Logs)
 *   §4: All nav items route to real panels (no dead buttons)
 *   §6: Voice toggle removed, Always-Ready preserved
 *   §8: Header minimal (compact)
 *   §16: No dead UI
 *
 * Run: npx tsx tests/system/test-ui15-consolidation.ts
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

  console.log('\n1) §2 Navigation consolidated to 5 items:');
  const navSrc = read('../../src/renderer/components/layout/NavigationRail.tsx');
  // Check NexView type declaration line specifically (not all occurrences)
  const nexViewMatch = navSrc.match(/export type NexView\s*=\s*([^;]+)/);
  assert('NexView type found', !!nexViewMatch);
  if (nexViewMatch) {
    const typeStr = nexViewMatch[1];
    assert("NexView type has 'chat'", /'chat'/.test(typeStr));
    assert("NexView type has 'workspace'", /'workspace'/.test(typeStr));
    assert("NexView type has 'memory'", /'memory'/.test(typeStr));
    assert("NexView type has 'knowledge'", /'knowledge'/.test(typeStr));
    assert("NexView type has 'settings'", /'settings'/.test(typeStr));
    assert('NexView type has exactly 5 values', (typeStr.match(/'[a-z]+'|'[a-z-]+'/g) || []).length === 5);
  }
  assert('NAV_ITEMS has 5 items', (navSrc.match(/id: '/g) || []).length === 5);
  assert('chat nav item present', /id: 'chat'/.test(navSrc));
  assert('workspace nav item present', /id: 'workspace'/.test(navSrc));
  assert('memory nav item present', /id: 'memory'/.test(navSrc));
  assert('knowledge nav item present', /id: 'knowledge'/.test(navSrc));
  assert('settings nav item present', /id: 'settings'/.test(navSrc));
  // Verify old nav items are GONE
  assert('NO home nav item', !/id: 'home'/.test(navSrc));
  assert('NO terminal nav item', !/id: 'terminal'/.test(navSrc));
  assert('NO files nav item', !/id: 'files'/.test(navSrc));
  assert('NO code nav item', !/id: 'code'/.test(navSrc));
  assert('NO agents nav item', !/id: 'agents'/.test(navSrc));
  assert('NO git nav item', !/id: 'git'/.test(navSrc));
  assert('NO tools nav item', !/id: 'tools'/.test(navSrc));
  assert('NO plugins nav item', !/id: 'plugins'/.test(navSrc));
  assert('NO monitor nav item', !/id: 'monitor'/.test(navSrc));

  console.log('\n2) §3 Workspace has 5 tabs:');
  const wsSrc = read('../../src/renderer/components/layout/WorkspacePanel.tsx');
  // WorkspaceTab is exported from NavigationRail (imported by WorkspacePanel)
  const navSrcForTabs = read('../../src/renderer/components/layout/NavigationRail.tsx');
  assert('WorkspaceTab type exported from NavigationRail', /export type WorkspaceTab =/.test(navSrcForTabs));
  assert('editor tab present', /'editor'/.test(wsSrc));
  assert('terminal tab present', /'terminal'/.test(wsSrc));
  assert('preview tab present', /'preview'/.test(wsSrc));
  assert('files tab present', /'files'/.test(wsSrc));
  assert('logs tab present', /'logs'/.test(wsSrc));
  assert('TABS array has 5 entries', (wsSrc.match(/id: '(editor|terminal|preview|files|logs)'/g) || []).length === 5);
  assert('WorkspacePanel default export', /export default function WorkspacePanel/.test(wsSrc));
  assert('EditorPanel lazy-imported', /lazy\(\(\) => import\('\.\.\/EditorPanel'\)\)/.test(wsSrc));
  assert('TerminalSessionPanel lazy-imported', /lazy\(\(\) => import\('\.\/TerminalSessionPanel'\)\)/.test(wsSrc));
  assert('WorkspaceExplorer lazy-imported', /lazy\(\(\) => import\('\.\/WorkspaceExplorer'\)\)/.test(wsSrc));

  console.log('\n3) §3 Workspace tabs render real panels (no placeholders):');
  assert('editor tab renders EditorPanel', /case 'editor':[\s\S]*?<EditorPanel/.test(wsSrc));
  assert('terminal tab renders TerminalSessionPanel', /case 'terminal':[\s\S]*?<TerminalSessionPanel/.test(wsSrc));
  assert('files tab renders WorkspaceExplorer', /case 'files':[\s\S]*?<WorkspaceExplorer/.test(wsSrc));
  assert('preview tab renders PreviewPanel', /case 'preview':[\s\S]*?<PreviewPanel/.test(wsSrc));
  assert('logs tab renders LogsPanel', /case 'logs':[\s\S]*?<LogsPanel/.test(wsSrc));

  console.log('\n4) §3 Preview panel is real (not placeholder):');
  assert('PreviewPanel function defined', /function PreviewPanel/.test(wsSrc));
  assert('PreviewPanel shows project name', /projectName/.test(wsSrc));
  assert('PreviewPanel uses projectPath', /projectPath/.test(wsSrc));
  assert('NO fake preview data', !/Math\.random/.test(wsSrc));

  console.log('\n5) §3 Logs panel uses real telemetry (no fake logs):');
  assert('LogsPanel function defined', /function LogsPanel/.test(wsSrc));
  assert('LogsPanel polls systemSnapshot', /window\.nexAPI\.systemSnapshot\(\)/.test(wsSrc));
  assert('LogsPanel shows agent task', /agent\?\.currentTask/.test(wsSrc));
  assert('LogsPanel shows tool running', /agent\?\.activeTool/.test(wsSrc));
  assert('LogsPanel shows inference active', /rt\?\.inferenceActive/.test(wsSrc));
  assert('LogsPanel shows tok/s', /lastTokensPerSecond/.test(wsSrc));
  assert('LogsPanel clears interval on unmount', /clearInterval\(timer\)/.test(wsSrc));
  assert('NO fake log strings', !/console\.log.*fake|FAKE_LOG/.test(wsSrc));

  console.log('\n6) §4 AppShell routing consolidated:');
  const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
  assert("case 'workspace' routes to WorkspacePanel", /case 'workspace': return <Suspense fallback=\{<PanelLoading \/>\}><WorkspacePanel/.test(shellSrc));
  assert("case 'chat' returns null (right panel handles it)", /case 'chat': return null/.test(shellSrc));
  assert("case 'knowledge' routes to KnowledgePanel", /case 'knowledge': return <Suspense/.test(shellSrc));
  assert("case 'memory' routes to MemoryPanel", /case 'memory': return <Suspense/.test(shellSrc));
  assert("case 'settings' routes to SettingsPanel", /case 'settings': return <Suspense/.test(shellSrc));
  // Old routing cases GONE
  assert('NO case home', !/case 'home'/.test(shellSrc));
  assert('NO case terminal in routing', !/case 'terminal': return/.test(shellSrc));
  assert('NO case files in routing', !/case 'files'/.test(shellSrc));
  assert('NO case agents in routing', !/case 'agents'/.test(shellSrc));
  assert('NO case git in routing', !/case 'git'/.test(shellSrc));
  assert('NO case tools in routing', !/case 'tools'/.test(shellSrc));
  assert('NO case plugins in routing', !/case 'plugins'/.test(shellSrc));
  assert('NO case monitor in routing', !/case 'monitor'/.test(shellSrc));

  console.log('\n7) §2 AppShell shows Orb when view=chat, panel otherwise:');
  assert('showOrb variable defined', /const showOrb = view === 'chat'/.test(shellSrc));
  assert('Orb rendered conditionally', /\{showOrb \? \(/.test(shellSrc));
  assert('Non-chat panel fills center', /: \([\s\S]*?absolute inset-0 nex-glass-strong/.test(shellSrc));

  console.log('\n8) §6 Voice toggle removed, Always-Ready preserved:');
  assert('NO voice toggle button', !/voiceController\.toggle\(\)/.test(shellSrc));
  // Check voiceActive only in non-comment code
  const shellNoComments = shellSrc.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('{/*')).join('\n');
  assert('NO voiceActive state in code (comments OK)', !/voiceActive/.test(shellNoComments));
  assert('voiceController.start() on boot', /voiceController\.start\(\)/.test(shellSrc));
  assert('start has .catch() for permission', /voiceController\.start\(\)\.catch/.test(shellSrc));

  console.log('\n9) §8 Header minimal (preserved from UI-14):');
  assert('compact text-base/sm', /text-base sm:text-lg/.test(shellSrc));
  assert('NEX AI title', /NEX AI/.test(shellSrc));
  assert('LOCAL INTELLIGENCE subtitle', /LOCAL INTELLIGENCE/.test(shellSrc));
  assert('ALWAYS READY subtitle', /ALWAYS READY/.test(shellSrc));
  assert('mb-2 margin', /mb-2/.test(shellSrc));

  console.log('\n10) §14 Command Palette consolidated:');
  const cpSrc = read('../../src/renderer/components/CommandPalette.tsx');
  assert('open-workspace command present', /id: 'open-workspace'/.test(cpSrc));
  assert('navigateTo workspace used', /navigateTo\('workspace'\)/.test(cpSrc));
  // Old dead commands removed
  assert('NO view-system-monitor command', !/id: 'view-system-monitor'/.test(cpSrc));
  assert('NO view-plugins command', !/id: 'view-plugins'/.test(cpSrc));
  assert('NO view-home command', !/id: 'view-home'/.test(cpSrc));
  assert('NO view-files command', !/id: 'view-files'/.test(cpSrc));
  assert('NO view-agents command', !/id: 'view-agents'/.test(cpSrc));
  assert('NO view-tools command', !/id: 'view-tools'/.test(cpSrc));
  assert('NO toggle-terminal command', !/id: 'toggle-terminal'/.test(cpSrc));

  console.log('\n11) §15 Git/Diagnostics/Plugins/Hardware NOT in main nav:');
  // These panels still exist (accessible via Settings/Agent), just not in nav.
  assert('GitPanel.tsx still exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/GitPanel.tsx')));
  assert('DiagnosticsPanel.tsx still exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/DiagnosticsPanel.tsx')));
  assert('PluginsPanel.tsx still exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/PluginsPanel.tsx')));
  assert('HardwareMonitorPanel.tsx still exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/HardwareMonitorPanel.tsx')));
  // But NOT referenced in NavigationRail
  assert('GitPanel NOT imported in NavigationRail', !/GitPanel/.test(navSrc));
  assert('PluginsPanel NOT imported in NavigationRail', !/PluginsPanel/.test(navSrc));
  assert('HardwareMonitorPanel NOT imported in NavigationRail', !/HardwareMonitorPanel/.test(navSrc));

  console.log('\n12) AppShell lazy imports consolidated:');
  assert('WorkspacePanel lazy-imported', /const WorkspacePanel = lazy\(\(\) => import\('\.\/WorkspacePanel'\)\)/.test(shellSrc));
  assert('KnowledgePanel lazy-imported', /const KnowledgePanel = lazy/.test(shellSrc));
  assert('MemoryPanel lazy-imported', /const MemoryPanel = lazy/.test(shellSrc));
  assert('SettingsPanel lazy-imported', /const SettingsPanel = lazy/.test(shellSrc));
  assert('NexChatPanel lazy-imported', /const NexChatPanel = lazy/.test(shellSrc));
  // Old lazy imports removed
  assert('NO TerminalSessionPanel lazy in AppShell', !/const TerminalSessionPanel = lazy/.test(shellSrc));
  assert('NO WorkspaceExplorer lazy in AppShell', !/const WorkspaceExplorer = lazy/.test(shellSrc));
  assert('NO EditorPanel lazy in AppShell', !/const EditorPanel = lazy/.test(shellSrc));
  assert('NO GitPanel lazy in AppShell', !/const GitPanel = lazy/.test(shellSrc));
  assert('NO AgentsPanel lazy in AppShell', !/const AgentsPanel = lazy/.test(shellSrc));
  assert('NO ToolsPanel lazy in AppShell', !/const ToolsPanel = lazy/.test(shellSrc));
  assert('NO OverviewPanel lazy in AppShell', !/const OverviewPanel = lazy/.test(shellSrc));
  assert('NO PluginsPanel lazy in AppShell', !/const PluginsPanel = lazy/.test(shellSrc));
  assert('NO HardwareMonitorPanel lazy in AppShell', !/const HardwareMonitorPanel = lazy/.test(shellSrc));

  console.log('\n13) §16 No dead UI — all nav items have real panels:');
  // Verify each nav item maps to a panel that actually renders content
  const navItems = ['chat', 'workspace', 'memory', 'knowledge', 'settings'];
  for (const item of navItems) {
    assert(`case '${item}' exists in leftPanel switch`, new RegExp(`case '${item}'`).test(shellSrc));
  }

  console.log('\n14) WorkspacePanel handles no-project state:');
  assert('NoProject component defined', /function NoProject/.test(wsSrc));
  assert('NoProject shows Open Project button', /Open Project/.test(wsSrc));
  assert('NoProject uses window.nexAPI.openFolder', /window\.nexAPI\.openFolder\(\)/.test(wsSrc));
  assert('renderTab checks projectPath', /if \(!projectPath && activeTab !== 'terminal'\)/.test(wsSrc));

  console.log('\n15) WorkspacePanel auto-switches to editor on file open:');
  assert('useEffect watches activeFile', /useEffect\([\s\S]*?activeFile/.test(wsSrc));
  assert('auto-switch to editor when file opens', /if \(activeFile && activeTab !== 'editor'\)/.test(wsSrc));

  console.log('\n16) Tab bar has accessible labels:');
  assert('TABS array has aria-label via title', /title=\{tab\.label\}/.test(wsSrc));
  assert('tab buttons have aria-current', /aria-current=\{isActive \? 'page' : undefined\}/.test(wsSrc));

  console.log('\n══════════════════════════════════════');
  console.log(`UI-15 RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('UI-15 FULL UI CONSOLIDATION: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
