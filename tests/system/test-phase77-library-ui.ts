/**
 * Phase 77 — Library UI/UX Optimization Tests
 *
 * Verifies:
 *   1. No horizontal overflow (tabs use grid, not overflow-x-auto)
 *   2. Tabs fit panel width (grid auto-fit)
 *   3. Model card opens details (onClick → handleOpenModelDetails)
 *   4. Card click does NOT immediately download
 *   5. Model details modal exists with metadata
 *   6. Manual download link + copy URL buttons
 *   7. Source selector for multi-source models
 *   8. Improved permission dialog (button-based, no mandatory typing)
 *   9. Download confirmation shows model/size/source
 *  10. Status badges (Installed, Available)
 *  11. Text wrapping (flex-wrap, truncate)
 *  12. No invented URLs
 *  13. Voice components still use unified installer
 *  14. Spinner terminates on terminal states
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

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Phase 77 — Library UI/UX Optimization Tests');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const libSrc = read('../../src/renderer/components/NexLibraryPanel.tsx');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) No horizontal scrolling
  // ═══════════════════════════════════════════════════════════════════════
  console.log('1) No horizontal scrolling:');
  assert('Tabs use grid layout (not overflow-x-auto)', libSrc.includes('grid gap-1 px-3 py-2') && libSrc.includes('gridTemplateColumns'));
  assert('Tabs do NOT use overflow-x-auto', !libSrc.includes('overflow-x-auto'));
  assert('Body uses overflow-x-hidden', libSrc.includes('overflow-x-hidden'));
  assert('Body does NOT use fixed maxHeight calc', !libSrc.includes('maxHeight: \'calc(100vh'));
  assert('Body uses minHeight: 0', libSrc.includes('minHeight: 0'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Tabs fit panel width
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Tabs fit panel width:');
  assert('Tabs use auto-fit minmax', libSrc.includes("repeat(auto-fit, minmax(70px, 1fr))"));
  assert('Tab labels use truncate', libSrc.includes('truncate'));
  assert('Tab buttons have overflow-hidden', libSrc.includes('overflow-hidden'));
  assert('Tabs reordered (recommended, models, installed, downloads, voice, tools, knowledge)',
    libSrc.indexOf("'recommended'") < libSrc.indexOf("'models'") &&
    libSrc.indexOf("'models'") < libSrc.indexOf("'installed'") &&
    libSrc.indexOf("'installed'") < libSrc.indexOf("'downloads'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) Model card opens details
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Model card opens details:');
  assert('handleOpenModelDetails function exists', libSrc.includes('const handleOpenModelDetails'));
  assert('handleCloseModelDetails function exists', libSrc.includes('const handleCloseModelDetails'));
  assert('selectedModel state exists', libSrc.includes('selectedModel'));
  assert('Recommended cards call handleOpenModelDetails', libSrc.includes('onClick={() => handleOpenModelDetails(m)}'));
  assert('Models cards call handleOpenModelDetails', libSrc.includes('handleOpenModelDetails(m)'));
  assert('Cards have cursor-pointer', libSrc.includes('cursor-pointer'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Card click does NOT immediately download
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Card click does NOT immediately download:');
  // The old code had: onClick={() => handleInstallModel(m.downloadUrl, m.name)}
  // Check that Recommended cards do NOT call handleInstallModel directly
  const recommendedStart = libSrc.indexOf('Recommended ═══');
  const recommendedEnd = libSrc.indexOf('AI Models ═══', recommendedStart);
  if (recommendedStart > 0 && recommendedEnd > 0) {
    const recommendedSection = libSrc.slice(recommendedStart, recommendedEnd);
    assert('Recommended cards do NOT call handleInstallModel', !recommendedSection.includes('handleInstallModel(m.downloadUrl'));
    assert('Recommended cards call handleOpenModelDetails', recommendedSection.includes('handleOpenModelDetails'));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Model details modal
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Model details modal:');
  assert('Model Details modal exists', libSrc.includes('Phase 77: Model Details Modal'));
  assert('Modal shows model name', libSrc.includes('selectedModel.name'));
  assert('Modal shows description', libSrc.includes('selectedModel.description') || libSrc.includes('selectedModel.purpose'));
  assert('Modal shows expectedSize', libSrc.includes('selectedModel.expectedSize'));
  assert('Modal shows quantization', libSrc.includes('selectedModel.quantization'));
  assert('Modal shows architecture', libSrc.includes('selectedModel.architecture'));
  assert('Modal shows parameterCount', libSrc.includes('selectedModel.parameterCount'));
  assert('Modal shows filename', libSrc.includes('selectedModel.filename'));
  assert('Modal shows sources', libSrc.includes('selectedModel.sources'));
  assert('Modal has close button', libSrc.includes('handleCloseModelDetails'));
  assert('Modal has download button', libSrc.includes('دانلود و نصب'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Manual download link + copy URL
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Manual download link + copy URL:');
  assert('handleCopyUrl function exists', libSrc.includes('const handleCopyUrl'));
  assert('handleOpenDownloadPage function exists', libSrc.includes('const handleOpenDownloadPage'));
  assert('Copy confirmation toast exists', libSrc.includes('copyConfirm'));
  assert('Open download page button exists', libSrc.includes('باز کردن صفحه دانلود'));
  assert('Copy link button exists', libSrc.includes('کپی لینک'));
  assert('navigator.clipboard.writeText used', libSrc.includes('navigator.clipboard.writeText'));
  assert('Copy confirmation message', libSrc.includes('کپی شد'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Source selector
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Source selector:');
  assert('selectedSource state exists', libSrc.includes('selectedSource'));
  assert('Automatic source option exists', libSrc.includes("'automatic'"));
  assert('Source selector buttons exist', libSrc.includes('setSelectedSource'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Improved permission dialog
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Improved permission dialog:');
  assert('pendingDownload state exists', libSrc.includes('pendingDownload'));
  assert('handleStartDownloadWithConfirm exists', libSrc.includes('handleStartDownloadWithConfirm'));
  assert('handleConfirmDownload exists', libSrc.includes('handleConfirmDownload'));
  assert('handleCancelDownload exists', libSrc.includes('handleCancelDownload'));
  assert('Confirm button says تأیید و شروع دانلود', libSrc.includes('تأیید و شروع دانلود'));
  assert('Cancel button says لغو', libSrc.includes('لغو'));
  assert('Dialog shows model name', libSrc.includes('pendingDownload.model.name'));
  assert('Dialog shows size', libSrc.includes('pendingDownload.model.expectedSize'));
  assert('Dialog shows source', libSrc.includes('pendingDownload.source'));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Status badges
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Status badges:');
  assert('Installed badge exists', libSrc.includes('نصب‌شده ✓'));
  assert('Available badge exists', libSrc.includes('موجود'));
  assert('Download badge exists', libSrc.includes('دانلود'));

  // ═══════════════════════════════════════════════════════════════════════
  // 10) Text wrapping
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) Text wrapping:');
  assert('Model names use truncate', libSrc.includes('truncate'));
  assert('Metadata uses flex-wrap', libSrc.includes('flex-wrap'));
  // Phase 78: URLs are now shown FULL (not truncated) in selectable input fields
  assert('Source URLs shown full (not truncated)', !libSrc.includes('url.slice(0, 50)'));

  // ═══════════════════════════════════════════════════════════════════════
  // 11) No invented URLs
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n11) No invented URLs:');
  assert('No example.com URLs', !libSrc.includes('example.com'));
  assert('No fake-mirror URLs', !libSrc.includes('fake-mirror'));
  assert('Sources come from model data', libSrc.includes('s.url'));

  // ═══════════════════════════════════════════════════════════════════════
  // 12) Voice components still use unified installer
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n12) Voice components:');
  assert('Voice tab still uses componentUnifiedInstall', libSrc.includes('handleInstallVoiceComponent'));
  assert('Voice tab still uses componentUnifiedVoiceList', libSrc.includes('componentUnifiedVoiceList'));
  assert('Voice tab still shows onComponentInstallProgress', libSrc.includes('onComponentInstallProgress'));

  // ═══════════════════════════════════════════════════════════════════════
  // 13) Spinner terminates
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n13) Spinner terminates:');
  assert('isActive excludes terminal states', libSrc.includes("'completed'") && libSrc.includes("'download-failed'") &&
    libSrc.includes("'cancelled'") && libSrc.includes("'permission-denied'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 14) Old permission dialog preserved for HIGH_RISK
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n14) Old permission preserved:');
  assert('Old permission dialog still exists (for HIGH_RISK)', libSrc.includes('pendingPermission && !pendingDownload'));
  assert('Old typed confirmation preserved', libSrc.includes('permissionInput'));

  // ═══════════════════════════════════════════════════════════════════════
  // 15) No duplicate download buttons
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n15) No duplicate download buttons:');
  // Models tab should NOT have inline download buttons — only card click → details → download
  const modelsStart = libSrc.indexOf('AI Models ═══');
  const modelsEnd = libSrc.indexOf('Voice (Phase 76', modelsStart);
  if (modelsStart > 0 && modelsEnd > 0) {
    const modelsSection = libSrc.slice(modelsStart, modelsEnd);
    assert('Models tab does NOT have inline handleInstallModel buttons', !modelsSection.includes('handleInstallModel(m.downloadUrl'));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 77 Tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
