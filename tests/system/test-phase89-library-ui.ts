/**
 * Phase 89 — Library Model Center UI Tests
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
  const libSrc = read('../../src/renderer/components/NexLibraryPanel.tsx');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Phase 89 — Library Model Center UI Tests');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1) Tab bar
  console.log('1) Tab bar:');
  assert('Tabs use flex (not grid)', libSrc.includes('flex gap-0.5 px-2 py-1.5 shrink-0 overflow-hidden'));
  assert('NO grid layout for tabs', !libSrc.includes("gridTemplateColumns: 'repeat(auto-fit"));
  assert('Tabs use shrink-0', libSrc.includes('shrink-0'));
  assert('Tabs use whiteSpace nowrap', libSrc.includes('whiteSpace: \'nowrap\''));
  assert('Tab labels in English (not Persian)', libSrc.includes("'Models'") && libSrc.includes("'Installed'"));
  assert('Tab renamed tools to Runtime', libSrc.includes("'Runtime'"));

  // 2) Search + Filter
  console.log('\n2) Search + Filter:');
  assert('searchQuery state exists', libSrc.includes('searchQuery'));
  assert('filterType state exists', libSrc.includes('filterType'));
  assert('Search input exists', libSrc.includes('Search models...'));
  assert('Filter buttons exist (all/llm/voice/vision)', libSrc.includes("'all', 'llm', 'voice', 'vision'"));
  assert('filteredModels useMemo exists', libSrc.includes('filteredModels'));
  assert('Search filters by name', libSrc.includes('name.includes(q)'));
  assert('Search filters by provider', libSrc.includes('provider.includes(q)'));
  assert('Search filters by quantization', libSrc.includes('quant.includes(q)'));
  assert('Search filters by parameterCount', libSrc.includes('params.includes(q)'));

  // 3) Storage indicator
  console.log('\n3) Storage indicator:');
  assert('storageInfo state exists', libSrc.includes('storageInfo'));
  assert('Fetches aiStorageInfo in refresh', libSrc.includes('aiStorageInfo()'));
  assert('Shows total size in header', libSrc.includes('storageInfo.totalSize'));
  assert('Shows model count in header', libSrc.includes('storageInfo.modelCount'));

  // 4) Model card badges
  console.log('\n4) Model card badges:');
  assert('ACTIVE badge exists', libSrc.includes('>ACTIVE<'));
  assert('INSTALLED badge exists', libSrc.includes('>INSTALLED<'));
  assert('AVAILABLE badge exists', libSrc.includes('>AVAILABLE<'));
  assert('DL (downloading) badge exists', libSrc.includes('>DL<'));
  assert('Badges use shrink-0', libSrc.includes('shrink-0'));
  assert('Active model border highlight', libSrc.includes('rgba(6,182,212,0.3)'));

  // 5) Empty states
  console.log('\n5) Empty states:');
  assert('Models tab empty state', libSrc.includes('No models found'));
  assert('Installed tab empty state', libSrc.includes('No installed models'));
  assert('Downloads tab empty state', libSrc.includes('No active downloads'));
  assert('Recommended tab empty state', libSrc.includes('No recommendations available'));
  assert('Browse Models button in empty state', libSrc.includes('Browse Models'));

  // 6) Download progress in card
  console.log('\n6) Download progress:');
  assert('Progress bar in model card', libSrc.includes('activeDl.percentage'));
  assert('Progress shows percentage', libSrc.includes('activeDl.percentage.toFixed(0)'));
  assert('Progress shows bytes', libSrc.includes('formatBytes(activeDl.receivedBytes)'));

  // 7) No horizontal overflow
  console.log('\n7) Layout:');
  assert('overflow-hidden on container', libSrc.includes('overflow-hidden'));
  assert('overflow-x-hidden on body', libSrc.includes('overflow-x-hidden'));
  assert('min-w-0 on header', libSrc.includes('min-w-0'));
  assert('truncate on model names', libSrc.includes('truncate'));

  // 8) English labels
  console.log('\n8) English labels:');
  assert('Security note in English', libSrc.includes('All downloads require explicit permission'));
  assert('Recommended header in English', libSrc.includes('Recommended for your system'));
  assert('Installed header in English', libSrc.includes('Installed Models'));
  assert('LIBRARY header (not Persian)', libSrc.includes('>LIBRARY<'));

  // 9) Regression - existing features preserved
  console.log('\n9) Existing features:');
  assert('Model Details modal exists', libSrc.includes('Model Details Modal') || libSrc.includes('selectedModel'));
  assert('Permission dialog exists', libSrc.includes('pendingDownload'));
  assert('Source URLs in details', libSrc.includes('s.url'));
  assert('Copy URL button exists', libSrc.includes('handleCopyUrl'));
  assert('Activate button exists', libSrc.includes('handleActivateModel'));
  assert('Delete button exists', libSrc.includes('handleRemoveModel'));
  assert('Import button exists', libSrc.includes('handleImportLocalModel'));
  assert('Test Connection exists', libSrc.includes('handleTestConnection'));
  assert('Voice tab exists', libSrc.includes("tab === 'voice'"));
  assert('AI Storage assets shown', libSrc.includes('storageAssets'));

  // SUMMARY
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 89 Tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(err => { console.error('Test runner error:', err); process.exit(1); });
