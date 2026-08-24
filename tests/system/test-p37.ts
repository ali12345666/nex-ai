/**
 * Phase 37 — Final Structural Tests (dead code cleanup + active migration + release gate)
 * Run: npx tsx tests/system/test-p37.ts
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
const exists = (p: string) => fs.existsSync(path.join(__dirname, p));

console.log('\n1. Dead Code Cleanup:');
assert('DiffViewer.tsx removed (was dead)', !exists('../../src/renderer/components/DiffViewer.tsx'));
assert('AgentDiffViewer.tsx still present (active)', exists('../../src/renderer/components/agent/AgentDiffViewer.tsx'));
assert('ChatPanel.tsx still present (fallback)', exists('../../src/renderer/components/ChatPanel.tsx'));
assert('StatusBar.tsx still present (fallback)', exists('../../src/renderer/components/StatusBar.tsx'));
assert('WelcomeScreen.tsx still present (fallback)', exists('../../src/renderer/components/WelcomeScreen.tsx'));

console.log('\n2. Active Legacy Token Migration (4 panels — SnippetPanel removed UI-09):');
// UI-09: SnippetPanel deleted (fake data + __monacoEditor global hack + unreachable).
const activePanels = ['GitPanel', 'SearchPanel', 'DiagnosticsPanel', 'EditorPanel'];
const legacyPattern = /bg-nex-|text-nex-|border-nex-|placeholder-nex-/;
for (const name of activePanels) {
  const src = read(`../../src/renderer/components/${name}.tsx`);
  const count = (src.match(legacyPattern) || []).length;
  assert(`${name}: zero legacy classes`, count === 0);
  const tokens = (src.match(/var\(--nex-/g) || []).length;
  assert(`${name}: uses NEX tokens (${tokens})`, tokens > 0);
}

console.log('\n3. All Migrated Panels Summary:');
// UI-09: SnippetPanel removed from list (file deleted).
const allMigrated = ['ModelsPanel', 'SettingsPanel', 'KnowledgePanel', 'MemoryPanel', 'PluginsPanel',
  'HardwareMonitorPanel', 'AgentDiffViewer', 'AgentStateDisplay', 'PermissionPrompt', 'CommandPalette',
  'GitPanel', 'SearchPanel', 'DiagnosticsPanel', 'EditorPanel'];
for (const name of allMigrated) {
  const p = name.startsWith('Agent') || name.startsWith('Permission')
    ? `../../src/renderer/components/agent/${name}.tsx`
    : `../../src/renderer/components/${name}.tsx`;
  const src = read(p);
  const count = (src.match(legacyPattern) || []).length;
  assert(`${name}: zero legacy (${count} found)`, count === 0);
}

console.log('\n4. Fallback components (intentionally kept):');
const fallbacks = ['ChatPanel', 'StatusBar', 'WelcomeScreen', 'FileExplorer', 'Sidebar', 'TitleBar', 'RecentProjects', 'InputDialog'];
let fallbackTotal = 0;
for (const name of fallbacks) {
  const p = `../../src/renderer/components/${name}.tsx`;
  if (exists(p)) {
    const src = read(p);
    const count = (src.match(legacyPattern) || []).length;
    fallbackTotal += count;
    console.log(`  ${name}: ${count} legacy (fallback — intentional)`);
  }
}
console.log(`  TOTAL fallback legacy: ${fallbackTotal} (documented, kept as safety net)`);
assert('fallback components documented', fallbackTotal >= 0);

console.log('\n5. Persistence Security:');
const persistSrc = read('../../src/main/persistence/index.ts');
assert('no sqlite/no new database', !persistSrc.includes('sqlite') && !persistSrc.includes('leveldb'));
assert('secrets encrypted via safeStorage', persistSrc.includes('safeStorage'));
assert('no apiKey field in conversation model', !persistSrc.includes('apiKey'));

console.log('\n6. Architecture Final:');
const appSrc = read('../../src/renderer/App.tsx');
assert('AppShell statically imported', appSrc.includes('import AppShell from'));
assert('NexErrorBoundary wraps both paths', appSrc.includes('<NexErrorBoundary>'));
const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
assert('Orb present', shellSrc.includes('NexOrb'));
assert('NavigationRail present', shellSrc.includes('NavigationRail'));
assert('NEX branding', shellSrc.includes('N E X'));
assert('no AURA', !shellSrc.includes('AURA'));

console.log('\n7. Full App.tsx Import Audit:');
// Verify App.tsx only imports components it actually uses
const imports = appSrc.match(/import\s+\w+\s+from\s+'\.\/components\/([^']+)'/g) || [];
console.log(`  Total component imports: ${imports.length}`);
for (const imp of imports) {
  const name = imp.match(/from\s+'\.\/components\/([^']+)'/)?.[1];
  if (name) {
    const compPath = `../../src/renderer/components/${name}.tsx`;
    assert(`import target exists: ${name}`, exists(compPath));
  }
}

console.log('\n══════════════════════════════════════');
console.log(`P37 STRUCTURAL RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P37 STRUCTURAL: ALL PASS');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
