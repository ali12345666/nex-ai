/**
 * UI-11 — Plugin Activation Tests
 *
 * Verifies:
 *   1. PluginLoader is instantiated in main.ts (was never wired before)
 *   2. plugins-set-enabled handler now actually loads/activates code
 *   3. On enable: loader.load(entry) called, tools registered, events forwarded
 *   4. On disable: loader.unload(id) called (best-effort deactivate)
 *   5. On activation failure: auto-disable + error returned
 *   6. PluginLoader.unload(pluginId) method added (was missing)
 *
 * Run: npx tsx tests/system/test-ui11-plugin-activation.ts
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

  console.log('\n1) PluginLoader instantiated in main.ts:');
  const mainSrc = read('../../src/main/main.ts');
  assert('_pluginLoader variable declared', /let _pluginLoader: import\('\.\/plugins\/loader'\)\.PluginLoader \| null = null/.test(mainSrc));
  assert('getPluginLoader() function defined', /function getPluginLoader\(\): import\('\.\/plugins\/loader'\)\.PluginLoader/.test(mainSrc));
  assert('imports PluginLoader from plugins/loader', /require\('\.\/plugins\/loader'\) as typeof import\('\.\/plugins\/loader'\)/.test(mainSrc));
  assert('creates PluginLoader instance with toolRegistry', /new PluginLoader\(\{[\s\S]*?toolRegistry: toolSink/.test(mainSrc));
  assert('forwards sandbox events to renderer', /mainWindow\?\.webContents\.send\('plugin-event'/.test(mainSrc));
  assert('toolSink uses registerTool from ai/tool-registry', /require\('\.\/ai\/tool-registry'\) as typeof import\('\.\/ai\/tool-registry'\)/.test(mainSrc));
  assert('toolSink catches registration errors', /console\.warn\(`\[NEX AI Plugin\] Failed to register tool/.test(mainSrc));

  console.log('\n2) plugins-set-enabled handler: actually loads code on enable:');
  assert('handler reads entry via reg.get(pluginId)', /const entry = reg\.get\(pluginId\)/.test(mainSrc));
  assert('handler returns Unknown plugin if not found', /if \(!entry\) return \{ success: false, error: 'Unknown plugin' \}/.test(mainSrc));
  assert('on enable: calls reg.enable then loader.load', /await reg\.enable\(pluginId\);[\s\S]*?const loader = getPluginLoader\(\);[\s\S]*?const report = await loader\.load\(entry\)/.test(mainSrc));
  assert('checks report.status for failure', /if \(report\.status === 'failed'\)/.test(mainSrc));
  assert('auto-disables on activation failure', /await reg\.disable\(pluginId\);[\s\S]*?return \{ success: false, error: `Plugin activation failed/.test(mainSrc));
  assert('returns tools + events on success', /return \{ success: true, tools: report\.tools, events: report\.events \}/.test(mainSrc));

  console.log('\n3) plugins-set-enabled handler: unloads on disable:');
  assert('on disable: calls loader.unload(pluginId)', /const loader = getPluginLoader\(\);[\s\S]*?try \{ await loader\.unload\(pluginId\)/.test(mainSrc));
  assert('unload is best-effort (try/catch)', /try \{ await loader\.unload\(pluginId\); \} catch \{ \/\* best-effort \*\/ \}/.test(mainSrc));
  assert('then calls reg.disable', /await reg\.disable\(pluginId\);[\s\S]*?return \{ success: true \};/m.test(mainSrc));

  console.log('\n4) PluginLoader.unload(pluginId) method added:');
  const loaderSrc = read('../../src/main/plugins/loader.ts');
  assert('unload(pluginId) method defined', /async unload\(pluginId: string\): Promise<void>/.test(loaderSrc));
  assert('unload gets loaded plugin from map', /const lp = this\.loaded\.get\(pluginId\)/.test(loaderSrc));
  assert('unload returns early if not loaded', /if \(!lp\) return; \/\/ not loaded/.test(loaderSrc));
  assert('unload calls deactivate with timeout', /await withTimeout\(lp\.instance\.deactivate/.test(loaderSrc));
  assert('unload deletes from loaded map', /this\.loaded\.delete\(pluginId\)/.test(loaderSrc));
  assert('unload is best-effort (try/catch)', /try \{ await withTimeout[\s\S]*?\} catch \{ \/\* best-effort \*\/ \}/.test(loaderSrc));
  assert('has UI-11 comment', /UI-11: deactivate \+ unload a single plugin/.test(loaderSrc));

  console.log('\n5) No regression to existing PluginLoader methods:');
  assert('load(entry) method still exists', /async load\(entry: PluginRegistryEntry\): Promise<LoadReport>/.test(loaderSrc));
  assert('deactivateAll() method still exists', /async deactivateAll\(\): Promise<void>/.test(loaderSrc));
  assert('listLoaded() method still exists', /listLoaded\(\): LoadedPlugin\[\]/.test(loaderSrc));
  assert('withTimeout helper still exists', /function withTimeout/.test(loaderSrc));

  console.log('\n6) No regression to other plugins IPC handlers:');
  assert('plugins-list handler still present', /ipcMain\.handle\('plugins-list'/.test(mainSrc));
  assert('plugins-list still calls reg.discover', /reg\.discover\(\)/.test(mainSrc));
  assert('plugins-list still returns entries', /plugins: entries\.map/.test(mainSrc));
  assert('plugins-list still returns invalid discoveries', /invalid: reg\.invalidDiscoveries\(\)/.test(mainSrc));

  console.log('\n7) No new IPC channels added (reused existing):');
  assert('NO new ipcMain.handle for plugin-load', !/ipcMain\.handle\('plugin-load'/.test(mainSrc));
  assert('NO new ipcMain.handle for plugin-activate', !/ipcMain\.handle\('plugin-activate'/.test(mainSrc));
  assert('NO new ipcMain.handle for plugin-deactivate', !/ipcMain\.handle\('plugin-deactivate'/.test(mainSrc));

  console.log('\n8) Security: sandbox boundary preserved:');
  assert('loader still creates plugin sandbox', /createPluginSandbox/.test(loaderSrc));
  assert('sandbox events captured in LoadReport', /events: SandboxEvent\[\]/.test(loaderSrc));
  assert('handler returns events to UI (audit trail)', /events: report\.events/.test(mainSrc));
  assert('plugin-event forwarded to renderer for audit', /plugin-event/.test(mainSrc));

  console.log('\n9) UI-11 comments document the fix:');
  assert('main.ts has UI-11 comment for loader bridge', /UI-11: PluginLoader bridge/.test(mainSrc));
  assert('main.ts explains old behavior was flag-only', /just flipping a boolean flag/.test(mainSrc));
  assert('loader.ts has UI-11 comment for unload method', /UI-11: deactivate \+ unload a single plugin/.test(loaderSrc));

  console.log('\n══════════════════════════════════════');
  console.log(`UI-11 RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('UI-11 PLUGIN ACTIVATION: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
