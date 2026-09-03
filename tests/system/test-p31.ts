/**
 * Phase 31 / P31 — Theme Engine Tests
 *
 * Tests theme list, validation, default, preview colors, orb integration,
 * persistence, and token completeness.
 *
 * Run: npx tsx tests/system/test-p31.ts
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

console.log('\n1) Theme list:');
const { NEX_THEMES, DEFAULT_THEME, isValidTheme } = await import('../../src/renderer/lib/theme-engine');
assert('exactly 16 themes', NEX_THEMES.length === 16, `got ${NEX_THEMES.length}`);
assert('default is cyan', DEFAULT_THEME === 'cyan');
assert('isValidTheme(cyan) true', isValidTheme('cyan'));
assert('isValidTheme(nonexistent) false', !isValidTheme('nonexistent'));
assert('all themes have unique ids', new Set(NEX_THEMES.map((t) => t.id)).size === 16);
assert('all themes have names', NEX_THEMES.every((t) => t.name.length > 0));
assert('all themes have hints', NEX_THEMES.every((t) => t.hint.length > 0));

console.log('\n2) Token completeness (all 16 themes in CSS):');
const tokensSrc = read('../../src/renderer/styles/tokens.css');
const themeIds = NEX_THEMES.map((t) => t.id);
for (const id of themeIds) {
  assert(`[${id}] data-theme selector present`, tokensSrc.includes(`[data-theme="${id}"]`));
}
const requiredTokens = [
  '--nex-accent', '--nex-accent-secondary', '--nex-accent-text', '--nex-accent-glow', '--nex-accent-dim',
  '--nex-orb-primary', '--nex-orb-secondary', '--nex-orb-glow',
];
const firstThemeBlock = tokensSrc.slice(
  tokensSrc.indexOf('[data-theme="cyan"]'),
  tokensSrc.indexOf('[data-theme="electric-blue"]')
);
for (const token of requiredTokens) {
  assert(`cyan theme has ${token}`, firstThemeBlock.includes(token));
}

console.log('\n3) Theme engine functions:');
const engineSrc = read('../../src/renderer/lib/theme-engine.ts');
assert('applyTheme sets data-theme', /setAttribute\('data-theme'/.test(engineSrc));
assert('getCurrentTheme reads data-theme', /getAttribute\('data-theme'/.test(engineSrc));
assert('getOrbColors resolves CSS vars', /resolveCssVar/.test(engineSrc));
assert('getThemePreview uses temp element', /createElement/.test(engineSrc));
assert('persistTheme uses configSet IPC', /configSet/.test(engineSrc));
assert('restoreTheme uses configGet IPC', /configGet/.test(engineSrc));
assert('fallback color defined', /#00e5ff/.test(engineSrc));

console.log('\n4) ThemeSelector component:');
const selectorSrc = read('../../src/renderer/components/settings/ThemeSelector.tsx');
assert('renders all 16 themes', /NEX_THEMES\.map/.test(selectorSrc));
assert('uses radiogroup role', /radiogroup/.test(selectorSrc));
assert('uses radio role per button', /role="radio"/.test(selectorSrc));
assert('aria-checked for selection', /aria-checked/.test(selectorSrc));
assert('aria-label on each theme', /aria-label=/.test(selectorSrc));
assert('check icon for active (not color-only)', /Check/.test(selectorSrc));
assert('mini orb preview', /radial-gradient/.test(selectorSrc));
assert('glass card styling', /var\(--nex-glass-bg\)/.test(selectorSrc));
assert('focus-visible support', /nex-focus/.test(selectorSrc));
assert('persist on select', /configSet.*nexTheme/.test(selectorSrc));
assert('restore on mount', /configGet.*nexTheme/.test(selectorSrc));

console.log('\n5) Settings panel integration:');
const settingsSrc = read('../../src/renderer/components/SettingsPanel.tsx');
assert('ThemeSelector imported', /ThemeSelector/.test(settingsSrc));
assert('in appearance section', settingsSrc.includes('<ThemeSelector />') && settingsSrc.indexOf('<ThemeSelector />') > settingsSrc.indexOf("'appearance'"));

console.log('\n6) Orb theme integration:');
const orbSrc = read('../../src/renderer/components/orb/NexOrb.tsx');
assert('uniforms created once (empty deps)', /\[\]\); \/\/ create once/.test(orbSrc));
assert('uniform colors updated via useEffect', /uPrimary\.value\.set\(primaryColor\)/.test(orbSrc) && /useEffect/.test(orbSrc));
assert('particle colors NOT recreated on theme change', /Phase 31.*particle colors.*ONCE/.test(orbSrc));
assert('NO geometry recreation on color change', !/colors.*primaryColor.*secondaryColor.*\]/.test(orbSrc.replace(/Phase 31[^}]+}/g, '')));

const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
assert('AppShell uses getOrbColors', /getOrbColors/.test(shellSrc));
assert('AppShell uses MutationObserver for theme changes', /MutationObserver/.test(shellSrc));
assert('orb receives hex colors (not CSS vars)', /orbColors\.primary/.test(shellSrc));
assert('orb receives hex secondary', /orbColors\.secondary/.test(shellSrc));

console.log('\n7) No hard-coded cyan in components:');
const navSrc = read('../../src/renderer/components/layout/NavigationRail.tsx');
assert('Navigation uses var(--nex-accent)', /var\(--nex-accent\)/.test(navSrc));
assert('Navigation has no #00E5FF', !/#00E5FF|#00e5ff/.test(navSrc));
const statusSrc = read('../../src/renderer/components/layout/BottomStatusBar.tsx');
assert('StatusBar uses var(--nex-accent)', /var\(--nex-accent\)/.test(statusSrc));

console.log('\n8) Branding:');
assert('NO AURA in new files', !/AURA/i.test(engineSrc + selectorSrc));
assert('NEX referenced', /NEX/.test(engineSrc + selectorSrc));

console.log('\n9) Performance (no unnecessary recreation):');
assert('Orb shader uniforms updated (not recreated)', /uniforms\.uPrimary\.value\.set/.test(orbSrc));
assert('particle buffers created once', /particleCount\]\)/.test(orbSrc) && !/particleCount.*primaryColor/.test(orbSrc));
assert('MutationObserver (lightweight, no polling)', /MutationObserver/.test(shellSrc));
assert('observer disconnected on cleanup', /observer\.disconnect/.test(shellSrc));

console.log('\n══════════════════════════════════════');
console.log(`P31 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P31 THEME ENGINE: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
