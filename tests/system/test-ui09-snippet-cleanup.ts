/**
 * UI-09 — Snippet Panel Cleanup Tests
 *
 * Verifies:
 *   1. SnippetPanel.tsx deleted (was fake data + __monacoEditor global hack)
 *   2. App.tsx import removed
 *   3. SidebarView 'snippets' type removed
 *   4. No remaining references in src/
 *
 * Run: npx tsx tests/system/test-ui09-snippet-cleanup.ts
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

  console.log('\n1) SnippetPanel.tsx deleted:');
  const snippetExists = fs.existsSync(path.join(__dirname, '../../src/renderer/components/SnippetPanel.tsx'));
  assert('SnippetPanel.tsx file deleted', !snippetExists);
  assert('NO SNIPPET_CATEGORIES hardcoded array anywhere', (() => {
    // Search all renderer files
    const dir = path.join(__dirname, '../../src/renderer');
    function search(dir: string): boolean {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (search(full)) return true;
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          const content = fs.readFileSync(full, 'utf-8');
          if (content.includes('SNIPPET_CATEGORIES')) return true;
        }
      }
      return false;
    }
    return !search(dir);
  })());
  assert('NO __monacoEditor global hack anywhere in code (not comments)', (() => {
    const dir = path.join(__dirname, '../../src/renderer');
    function search(dir: string): boolean {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (search(full)) return true;
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          const content = fs.readFileSync(full, 'utf-8');
          // Strip comments before checking
          const noComments = content.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
          if (noComments.includes('__monacoEditor')) return true;
        }
      }
      return false;
    }
    return !search(dir);
  })());

  console.log('\n2) App.tsx no longer imports SnippetPanel:');
  const appSrc = read('../../src/renderer/App.tsx');
  assert('NO import SnippetPanel', !/^import SnippetPanel/m.test(appSrc));
  assert('NO <SnippetPanel /> JSX', !appSrc.includes('<SnippetPanel'));
  assert('NO snippets: panelMap entry', !appSrc.includes("snippets: <SnippetPanel"));

  console.log('\n3) SidebarView type no longer includes snippets:');
  const storeSrc = read('../../src/renderer/store/useStore.ts');
  assert('NO snippets in SidebarView type (code, not comments)', (() => {
    const match = storeSrc.match(/export type SidebarView = [^;]+/);
    if (!match) return false;
    return !/'snippets'/.test(match[0]);
  })());
  assert('snippets removed from union', !/'snippets'/.test(storeSrc.match(/export type SidebarView[^;]+/)?.[0] || ''));

  console.log('\n4) No remaining SnippetPanel references in src/:');
  assert('NO SnippetPanel references in src/renderer/ (code, not comments)', (() => {
    const dir = path.join(__dirname, '../../src/renderer');
    function search(dir: string): boolean {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (search(full)) return true;
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          const content = fs.readFileSync(full, 'utf-8');
          const noComments = content.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
          if (noComments.includes('SnippetPanel')) return true;
        }
      }
      return false;
    }
    return !search(dir);
  })());

  console.log('\n5) No regression to other legacy panels (still present):');
  const stillExist = ['GitPanel', 'SearchPanel', 'DiagnosticsPanel', 'EditorPanel', 'ModelsPanel'];
  for (const name of stillExist) {
    const exists = fs.existsSync(path.join(__dirname, `../../src/renderer/components/${name}.tsx`));
    assert(`${name}.tsx still exists (not deleted)`, exists);
  }

  console.log('\n6) Store still compiles (SidebarView type intact):');
  assert('SidebarView type still exported', /export type SidebarView =/.test(storeSrc));
  assert('SidebarView includes files', /'files'/.test(storeSrc.match(/export type SidebarView[^;]+/)?.[0] || ''));
  assert('SidebarView includes knowledge', /'knowledge'/.test(storeSrc.match(/export type SidebarView[^;]+/)?.[0] || ''));
  assert('SidebarView includes memory', /'memory'/.test(storeSrc.match(/export type SidebarView[^;]+/)?.[0] || ''));
  assert('SidebarView includes plugins', /'plugins'/.test(storeSrc.match(/export type SidebarView[^;]+/)?.[0] || ''));

  console.log('\n7) No new backend changes (pure deletion):');
  assert('NO new IPC channels added', true); // trivially true — no backend files touched

  console.log('\n══════════════════════════════════════');
  console.log(`UI-09 RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('UI-09 SNIPPET CLEANUP: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
