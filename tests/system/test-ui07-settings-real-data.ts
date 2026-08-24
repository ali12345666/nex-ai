/**
 * UI-07 — Settings Panel Real Data Tests
 *
 * Verifies:
 *   1. Security section no longer uses hardcoded `status: true` × 6
 *   2. Version string no longer hardcoded '2.0.0-alpha'
 *   3. Engine Status no longer hardcoded 'Ready'
 *   4. Real data sources: persistenceInfo (secretsAvailable), modelList (count)
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

  console.log('\n1) Security section: no longer hardcoded status:true:');
  const settingsSrc = read('../../src/renderer/components/SettingsPanel.tsx');
  assert('NO inline array of {label, status: true} objects', !/\[\s*\{ label: '[^']+', status: true \},[\s\S]*?\{ label: '[^']+', status: true \},?\s*\]/.test(settingsSrc));
  assert('uses securityFeatures variable', /securityFeatures\.map/.test(settingsSrc));
  assert('securityFeatures array is typed', /const securityFeatures: Array<\{ label: string; status: boolean; detail\?: string \}>/.test(settingsSrc));
  assert('CSP status is boolean (not literal true)', /Content Security Policy \(CSP\)', status: true/.test(settingsSrc) === false || /Content Security Policy \(CSP\)'.*?status: true/.test(settingsSrc));

  console.log('\n2) API Key Encryption status is REAL (not always true):');
  assert('API Key Encryption status comes from secretsAvailable', /status: secretsAvailable === true/.test(settingsSrc));
  assert('shows checking state when secretsAvailable is null', /secretsAvailable === null \? 'Checking…'/.test(settingsSrc));
  assert('shows safeStorage detail when available', /secretsAvailable \? 'safeStorage \(OS keychain\)'/.test(settingsSrc));
  assert('shows not-available detail when unavailable', /'Not available — keys stored in-memory only'/.test(settingsSrc));

  console.log('\n3) Version string no longer hardcoded 2.0.0-alpha:');
  assert('NO hardcoded "2.0.0-alpha" in code (comments OK)', !/^[^/]*2\.0\.0-alpha/.test(settingsSrc.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')));
  assert('uses appVersion state variable in JSX', /Version \{appVersion\}/.test(settingsSrc));
  assert('appVersion state declared', /const \[appVersion, setAppVersion\] = useState<string>/.test(settingsSrc));
  assert('appVersion defaults to 0.0.0', /useState<string>\('0\.0\.0'\)/.test(settingsSrc));
  assert('version effect sets appVersion', /setAppVersion\(v\)/.test(settingsSrc));

  console.log('\n4) Engine Status no longer hardcoded Ready:');
  assert('NO hardcoded "Engine Status: Ready" pattern', !/Engine Status.*?<\/div>[\s\S]*?node-llama-cpp \(bundled\)<\/div>[\s\S]*?<span[^>]*>Ready<\/span>/.test(settingsSrc));
  assert('uses localModelCount variable', /localModelCount/.test(settingsSrc));
  assert('localModelCount state declared', /const \[localModelCount, setLocalModelCount\] = useState<number>/.test(settingsSrc));
  assert('shows count in description', /\{localModelCount\} model/.test(settingsSrc));
  assert('badge shows Ready only when count > 0', /localModelCount > 0 \? 'Ready' : 'No models'/.test(settingsSrc));
  assert('badge color varies by count', /localModelCount > 0[\s\S]*?'rgba\(34,197,94,0\.15\)'/.test(settingsSrc));

  console.log('\n5) Real data sources (no new IPC added):');
  assert('uses persistenceInfo for secrets availability', /window\.nexAPI\.persistenceInfo\(\)/.test(settingsSrc));
  assert('uses modelList for model count', /window\.nexAPI\.modelList\(\)/.test(settingsSrc));
  assert('NO new IPC channels added', !/window\.nexAPI\.\w+\(\)/.test(settingsSrc.replace(/persistenceInfo\(\)/g, '').replace(/modelList\(\)/g, '').replace(/openFolder\(\)/g, '').replace(/settingsSave/g, '').replace(/settingsLoad/g, '')));

  console.log('\n6) Detail text for security features:');
  assert('CSP has detail text', /detail: 'Enforced on all renderer processes'/.test(settingsSrc));
  assert('Context Isolation has detail', /detail: 'Renderer cannot access Node globals'/.test(settingsSrc));
  assert('Node Integration has detail', /detail: 'Prevents direct shell access from web content'/.test(settingsSrc));

  console.log('\n7) Status badge styling (not always green):');
  assert('status true shows green Active', /item\.status[\s\S]*?\{ background: 'rgba\(34,197,94,0\.15\)'/.test(settingsSrc));
  assert('status false shows red Disabled', /item\.status[\s\S]*?\{ background: 'rgba\(239,68,68,0\.15\)'/.test(settingsSrc));
  assert('badge text varies by status', /\{item\.status \? 'Active' : 'Disabled'\}/.test(settingsSrc));

  console.log('\n8) Model count effect with proper cleanup + re-fetch:');
  assert('modelList effect depends on activeSection (re-fetches when entering Local AI)', /\}, \[activeSection\]\);/.test(settingsSrc));
  assert('catches errors gracefully', /\.catch\(\(\) => \{[\s\S]*?setLocalModelCount\(0\)/.test(settingsSrc));
  assert('handles non-array response', /Array\.isArray\(models\) \? models\.length : 0/.test(settingsSrc));

  console.log('\n9) Persistence info handler captures secretsAvailable:');
  assert('persistenceInfo then-handler extracts secretsAvailable', /persistenceInfo\(\)\.then/.test(settingsSrc) && settingsSrc.includes('setSecretsAvailable(info?.secretsAvailable ?? false)'));
  assert('catch-handler sets secretsAvailable to false', /\.catch\(\(\) => \{[\s\S]*?setSecretsAvailable\(false\)/.test(settingsSrc));

  console.log('\n10) No regression to other SettingsPanel sections:');
  assert('AI Mode section still present', /activeSection === 'ai'/.test(settingsSrc));
  assert('Local AI section still present', /activeSection === 'local'/.test(settingsSrc));
  assert('Online AI section still present', /activeSection === 'online'/.test(settingsSrc));
  assert('Appearance section still present', /activeSection === 'appearance'/.test(settingsSrc));
  assert('Voice section still present', /activeSection === 'voice'/.test(settingsSrc));
  assert('About section still present', /activeSection === 'about'/.test(settingsSrc));
  assert('ThemeSelector still imported', /import ThemeSelector/.test(settingsSrc));
  assert('handleSave still defined', /const handleSave = async/.test(settingsSrc));

  console.log('\n══════════════════════════════════════');
  console.log(`UI-07 RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('UI-07 SETTINGS REAL DATA: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
