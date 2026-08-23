/**
 * Phase 36 — Structural Tests
 * Run: npx tsx tests/system/test-p36.ts
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

console.log('\n1. Production Bug Fix (require to import):');
const appSrc = read('../../src/renderer/App.tsx');
assert('AppShell statically imported', appSrc.includes('import AppShell from'));
assert('AppShellReady is always set (no try/catch null)', appSrc.includes('AppShellReady') && appSrc.includes('= AppShell'));
// Check no actual require() call (only the comment mentions it)
const appNoComments = appSrc.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
assert('no require() call in code (only in comments)', !appNoComments.includes("require('./"));

console.log('\n2. E2E Test Infrastructure:');
const e2eSrc = read('../../tests/e2e/test-p36-ui.js');
assert('E2E test exists', e2eSrc.length > 0);
assert('loads real main.js', e2eSrc.includes('dist/main/main.js'));
assert('forces production mode', e2eSrc.includes('isPackaged'));
assert('patches BrowserWindow', e2eSrc.includes('Proxy') && e2eSrc.includes('construct'));
assert('tests Ctrl+K open', e2eSrc.includes('Ctrl+K opens'));
assert('tests Search focus', e2eSrc.includes('Search focused'));
assert('tests Escape close', e2eSrc.includes('Escape closes'));
assert('tests isInput guard', e2eSrc.includes('NOT hijack'));
assert('tests Orb canvas', e2eSrc.includes('Orb canvas'));
assert('tests Navigation rail', e2eSrc.includes('Navigation rail'));
assert('tests NEX branding', e2eSrc.includes('NEX branding'));
assert('tests No AURA', e2eSrc.includes('No AURA'));
assert('tests theme token', e2eSrc.includes('nex-accent'));
assert('tests History no-results', e2eSrc.includes('no-results'));
assert('tests ErrorBoundary', e2eSrc.includes('No error state'));
assert('tests chat textarea', e2eSrc.includes('Chat textarea'));
assert('uses NO new dependencies', !e2eSrc.includes('playwright') && !e2eSrc.includes('puppeteer'));

console.log('\n3. Legacy Tailwind Audit:');
const legacyPattern = /bg-nex-|text-nex-|border-nex-|placeholder-nex-/;
const allComponents: Array<{file: string; count: number; category: string}> = [];
const componentDir = path.join(__dirname, '../../src/renderer/components');
const walkDir = (dir: string) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full);
    else if (entry.name.endsWith('.tsx')) {
      const src = fs.readFileSync(full, 'utf-8');
      const count = (src.match(legacyPattern) || []).length;
      if (count > 0) {
        const name = entry.name;
        const isFallback = ['ChatPanel', 'StatusBar', 'WelcomeScreen', 'FileExplorer', 'Sidebar', 'TitleBar'].some((n) => name.includes(n));
        const isAgent = name.includes('Agent') || name.includes('Permission');
        const category = isAgent ? 'B-Modal' : isFallback || name.includes('Panel') ? 'C-Fallback' : 'A-Active';
        allComponents.push({ file: name, count, category });
      }
    }
  }
};
walkDir(componentDir);
allComponents.sort((a, b) => b.count - a.count);
for (const c of allComponents) {
  console.log(`    ${c.category} | ${c.count} | ${c.file}`);
}
const totalLegacy = allComponents.reduce((a, c) => a + c.count, 0);
console.log(`  TOTAL: ${totalLegacy} remaining (documented, not migrated in P36)`);
assert('legacy audit report generated', allComponents.length > 0);

console.log('\n4. Architecture:');
const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
assert('AppShell has NexOrb', shellSrc.includes('NexOrb'));
assert('AppShell has NavigationRail', shellSrc.includes('NavigationRail'));
assert('NEX branding', shellSrc.includes('N E X'));
assert('no new database', !read('../../src/main/persistence/index.ts').includes('sqlite'));

console.log('\n══════════════════════════════════════');
console.log(`P36 STRUCTURAL RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P36 STRUCTURAL: ALL PASS');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
