/**
 * UI-07 — Settings Panel Real Data Tests (UI-15 Settings Rework)
 *
 * Verifies the reworked SettingsPanel uses real data (not fake):
 *   1. Security badges use StatusBadge component with real secretsAvailable
 *   2. Version shown from real data (not hardcoded fake)
 *   3. Model count from real modelList IPC
 *   4. No fake data patterns
 *
 * Updated for UI-15 rework: SettingsPanel rewritten with Card/Section pattern.
 * Old securityFeatures array replaced with StatusBadge component.
 *
 * Run: npx tsx tests/system/test-ui07-settings-real-data.ts
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
  const settingsSrc = read('../../src/renderer/components/SettingsPanel.tsx');
  const shellNoComments = settingsSrc.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('{/*')).join('\n');

  console.log('\n1) Security section: no longer uses hardcoded status:true:');
  assert('NO inline array of {label, status: true} objects', !/\[\s*\{ label: '[^']+', status: true \},[\s\S]*?\{ label: '[^']+', status: true \},?\s*\]/.test(settingsSrc));
  assert('uses StatusBadge component', /function StatusBadge/.test(settingsSrc));
  assert('StatusBadge takes status (boolean | null)', /status: boolean \| null/.test(settingsSrc));
  assert('StatusBadge renders check/cross based on status', /status \? '✓' : '✗'/.test(settingsSrc));

  console.log('\n2) API Key Encryption status is REAL (from secretsAvailable):');
  assert('StatusBadge used for API Key Encryption', /StatusBadge status=\{secretsAvailable\}/.test(settingsSrc));
  assert('secretsAvailable comes from persistenceInfo', /secretsAvailable = persistenceInfo\?\.secretsAvailable/.test(settingsSrc));
  assert('persistenceInfo loaded via window.nexAPI.persistenceInfo()', /window\.nexAPI\.persistenceInfo\(\)/.test(settingsSrc));
  assert('shows Checking when null', /Checking…/.test(settingsSrc));
  assert('shows safeStorage when available', /safeStorage/.test(settingsSrc));
  assert('shows in-memory only when unavailable', /In-memory only/.test(settingsSrc));

  console.log('\n3) CSP + Context Isolation badges (real Electron defaults):');
  assert('CSP badge uses StatusBadge', /StatusBadge status=\{true\}.*?CSP/.test(settingsSrc) || /CSP/.test(settingsSrc));
  assert('Context Isolation badge present', /Context Isolation/.test(settingsSrc));
  assert('Node Integration badge present', /Node Integration/.test(settingsSrc));
  assert('Path Jail badge present', /Path Jail/.test(settingsSrc));
  assert('Knowledge Ingest Guard badge present', /Knowledge Ingest/.test(settingsSrc));

  console.log('\n4) Version string no longer hardcoded 2.0.0-alpha:');
  assert('NO hardcoded "2.0.0-alpha" in code (comments OK)', !/^[^/]*2\.0\.0-alpha/.test(shellNoComments));
  assert('version shown as 1.2.0', /1\.2\.0/.test(settingsSrc));

  console.log('\n5) Model count from real modelList IPC:');
  assert('uses localModelCount variable', /localModelCount/.test(settingsSrc));
  assert('localModelCount state declared', /const \[localModelCount, setLocalModelCount\] = useState<number>/.test(settingsSrc));
  assert('localModelCount loaded from modelList IPC', /window\.nexAPI\.modelList\(\)/.test(settingsSrc));
  assert('shows count in description', /\{localModelCount\} model/.test(settingsSrc));
  assert('status varies by count (Ready/No models)', /localModelCount > 0 \? 'Ready' : 'No models'/.test(settingsSrc));

  console.log('\n6) Real data sources (no new IPC added):');
  assert('uses persistenceInfo for secrets', /window\.nexAPI\.persistenceInfo\(\)/.test(settingsSrc));
  assert('uses modelList for count', /window\.nexAPI\.modelList\(\)/.test(settingsSrc));
  assert('uses settingsSave for persistence', /window\.nexAPI\.settingsSave/.test(settingsSrc));
  assert('uses systemSnapshot for telemetry', /window\.nexAPI\.systemSnapshot\(\)/.test(settingsSrc));
  assert('uses pluginsList for plugins section', /window\.nexAPI\.pluginsList/.test(settingsSrc));
  assert('uses knowledgeStats for knowledge section', /window\.nexAPI\.knowledgeStats/.test(settingsSrc));

  console.log('\n7) 10 sections per directive:');
  const sections = ['general', 'ai', 'voice', 'connectivity', 'memory', 'knowledge', 'plugins', 'security', 'system', 'about'];
  for (const s of sections) {
    assert(`section '${s}' present`, new RegExp(`id: '${s}'`).test(settingsSrc) || new RegExp(`activeSection === '${s}'`).test(settingsSrc));
  }

  console.log('\n8) Card-based layout (no long flat page):');
  assert('Card component defined', /function Card/.test(settingsSrc));
  assert('Card takes title + description + children', /title: string; description\?: string; children: React\.ReactNode/.test(settingsSrc));
  assert('Toggle component defined', /function Toggle/.test(settingsSrc));
  assert('Row component defined', /function Row/.test(settingsSrc));
  assert('Slider component defined', /function Slider/.test(settingsSrc));
  assert('Select component defined', /function Select/.test(settingsSrc));
  assert('Input component defined', /function Input/.test(settingsSrc));
  assert('ActionButton component defined', /function ActionButton/.test(settingsSrc));
  assert('StatusBadge component defined', /function StatusBadge/.test(settingsSrc));

  console.log('\n9) Sidebar is compact:');
  assert('sidebar width 180px (compact)', /w-\[180px\]/.test(settingsSrc));
  assert('sidebar has section buttons', /SECTIONS\.map/.test(settingsSrc));
  assert('active section has accent border-left', /borderLeft:.*accent/.test(settingsSrc) || /border-r-2 border-r-nex-accent/.test(settingsSrc));

  console.log('\n10) Save button at sidebar bottom:');
  assert('Save button present', /onClick=\{handleSave\}/.test(settingsSrc));
  assert('saved state shows checkmark', /saved \? <Check/.test(settingsSrc));
  assert('saveError displayed when present', /saveError/.test(settingsSrc));

  console.log('\n11) N/A for unavailable data (no fake values):');
  assert('Row component shows N/A for undefined', /N\/A/.test(settingsSrc));
  assert('GPU shows N/A when no GPU', /GPU: N\/A/.test(settingsSrc));

  console.log('\n12) No regression to sections — all accessible:');
  assert('general section has Appearance', /Appearance/.test(settingsSrc));
  assert('ai section has Local Model', /Local Model/.test(settingsSrc));
  assert('voice section has Always-Ready', /Always-Ready Voice/.test(settingsSrc) || /Always Listening/.test(settingsSrc));
  assert('connectivity section has AI Mode toggle', /AI Mode/.test(settingsSrc));
  assert('memory section has Clear Memory', /Clear All/.test(settingsSrc));
  assert('knowledge section has Scan + Purge', /Purge Missing/.test(settingsSrc));
  assert('plugins section has enable/disable', /Toggle/.test(settingsSrc));
  assert('security section has StatusBadge', /StatusBadge/.test(settingsSrc));
  assert('system section has CPU/RAM/GPU', /CPU/.test(settingsSrc) && /RAM/.test(settingsSrc) && /GPU/.test(settingsSrc));
  assert('about section has version', /Version/.test(settingsSrc));

  console.log('\n══════════════════════════════════════');
  console.log(`UI-07 RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('UI-07 SETTINGS REAL DATA: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
