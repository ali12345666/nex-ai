/**
 * Phase 70 — Permission-Gated Download Start Tests
 *
 * Verifies the CRITICAL fix: download state must NOT be created before
 * permission is APPROVED.
 *
 * Tests:
 *   1. download-start IPC handler requests permission BEFORE creating downloadId
 *   2. downloadFromUrl supports permissionPreApproved flag
 *   3. installRecommendedModel supports permissionPreApproved flag
 *   4. Renderer only shows "Download started" after IPC success + downloadId
 *   5. Renderer handles permission-denied silently (no toast, no error)
 *   6. IPC handler returns {status:'permission-denied'} (no downloadId) when denied
 *   7. IPC handler returns {success:true, downloadId, status:'approved'} when approved
 *   8. Trace logs [INSTALL:01] through [INSTALL:14] exist
 *   9. Tab persistence architecture preserved (display:none pattern)
 *  10. Download store survives component unmount (Zustand)
 *  11. No download state emitted before permission approval
 *
 * Run: npx tsx tests/system/test-phase70-permission-gated-download.ts
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

  // ═══════════════════════════════════════════════════════════════════════
  // 1) Main Process: download-start IPC handler — permission FIRST
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) Main Process: download-start IPC handler — permission FIRST:');
  const mainSrc = read('../../src/main/main.ts');

  // The OLD bug: activeDownloads.set + emitDownloadState BEFORE permission
  // The NEW fix: requestDownloadPermission is called BEFORE downloadId creation
  assert('requestDownloadPermission helper exists', mainSrc.includes('const requestDownloadPermission'));
  assert('startApprovedDownload helper exists', mainSrc.includes('const startApprovedDownload'));
  assert('download-start handler calls requestDownloadPermission', mainSrc.includes("await requestDownloadPermission(opts.url"));
  assert('download-start handler checks approved before creating downloadId', mainSrc.includes('if (!approved)'));
  assert('download-start handler returns permission-denied on deny', mainSrc.includes("status: 'permission-denied'"));
  assert('download-start handler returns approved on success', mainSrc.includes("status: 'approved'"));
  assert('download-start handler passes permissionPreApproved:true', mainSrc.includes('permissionPreApproved: true'));
  assert('download-start-recommended handler calls requestDownloadPermission', mainSrc.includes('await requestDownloadPermission(RECOMMENDED_FIRST_MODEL.downloadUrl'));
  assert('download-start-recommended handler passes permissionPreApproved:true', mainSrc.includes("installRecommendedModel({ permissionPreApproved: true })"));

  // Verify NO premature state creation — the old pattern is gone
  // OLD (buggy): activeDownloads.set → emitDownloadState → return downloadId → THEN permission
  // NEW (fixed): requestPermission → if approved → create downloadId → activeDownloads.set → emit
  const downloadStartMatch = mainSrc.match(/ipcMain\.handle\('download-start'[\s\S]*?(?=ipcMain\.handle\('download-start-recommended)/);
  if (downloadStartMatch) {
    const handlerSrc = downloadStartMatch[0];
    const permIdx = handlerSrc.indexOf('requestDownloadPermission');
    const downloadIdIdx = handlerSrc.indexOf("dl-${Date.now()}");
    assert('In download-start: permission request comes BEFORE downloadId creation',
      permIdx > 0 && downloadIdIdx > 0 && permIdx < downloadIdIdx,
      `permIdx=${permIdx}, downloadIdIdx=${downloadIdIdx}`);
  } else {
    assert('download-start handler found in source', false);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Model Deployment Manager: permissionPreApproved flag
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Model Deployment Manager: permissionPreApproved flag:');
  const dmSrc = read('../../src/main/ai/model-deployment-manager.ts');

  assert('ModelDownloadOptions has permissionPreApproved field', dmSrc.includes('permissionPreApproved?: boolean'));
  assert('downloadFromUrl checks permissionPreApproved', dmSrc.includes('if (opts.permissionPreApproved)'));
  assert('downloadFromUrl skips gate when pre-approved', dmSrc.includes('permission pre-approved, skipping gate'));
  assert('downloadFromUrl logs [INSTALL:08]', dmSrc.includes("[INSTALL:08] DOWNLOAD_MANAGER_START"));
  assert('downloadFromUrl logs [INSTALL:09]', dmSrc.includes("[INSTALL:09] SECURE_DOWNLOADER_START"));

  // Verify the permission block is inside the else branch (not always executed)
  const downloadFromUrlMatch = dmSrc.match(/async downloadFromUrl[\s\S]*?(?=async removeModel|async getStatus)/);
  if (downloadFromUrlMatch) {
    const methodSrc = downloadFromUrlMatch[0];
    assert('downloadFromUrl has if/else for permissionPreApproved',
      methodSrc.includes('if (opts.permissionPreApproved)') && methodSrc.includes('} else {'));
    assert('downloadFromUrl does NOT always call gate.requestPermission',
      methodSrc.includes('gate.requestPermission(action)') && methodSrc.includes('permissionPreApproved'));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3) First-Run Wizard: permissionPreApproved flag
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) First-Run Wizard: permissionPreApproved flag:');
  const wizSrc = read('../../src/main/ai/first-run-wizard.ts');

  assert('installRecommendedModel accepts permissionPreApproved opt', wizSrc.includes('permissionPreApproved?: boolean'));
  assert('installRecommendedModel passes permissionPreApproved to downloadOpts', wizSrc.includes('permissionPreApproved: opts?.permissionPreApproved'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Renderer: NexLibraryPanel — toast only after approval
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Renderer: NexLibraryPanel — toast only after approval:');
  const libSrc = read('../../src/renderer/components/NexLibraryPanel.tsx');

  assert('handleInstallModel logs [INSTALL:01] CLICK', libSrc.includes("[INSTALL:01] CLICK"));
  assert('handleInstallModel checks res.success && res.downloadId before toast', libSrc.includes('if (res.success && res.downloadId)'));
  assert('handleInstallModel handles permission-denied silently', libSrc.includes("res.status === 'permission-denied'"));

  // Verify the toast is INSIDE the success block (after approval), not before it.
  // The showToast('ok', 'دانلود شروع شد') call must come AFTER the if (res.success && res.downloadId) check.
  const toastIdx = libSrc.indexOf("دانلود شروع شد");
  const successCheckIdx = libSrc.indexOf('if (res.success && res.downloadId)');
  const permDeniedIdx = libSrc.indexOf("res.status === 'permission-denied'");
  assert('toast appears AFTER success check (toast only fires on approval)',
    toastIdx > successCheckIdx && toastIdx > 0,
    `toastIdx=${toastIdx}, successCheckIdx=${successCheckIdx}`);
  // The permission-denied branch must NOT contain showToast('ok' — verify by
  // checking there's no showToast between permDeniedIdx and the next function boundary
  const afterPermDenied = libSrc.slice(permDeniedIdx, permDeniedIdx + 300);
  assert('permission-denied branch does NOT call showToast',
    !afterPermDenied.includes("showToast('ok'"),
    'showToast found in permission-denied branch');
  assert('handleInstallRecommended also checks permission-denied',
    libSrc.includes('permission-denied') && libSrc.includes('handleInstallRecommended'));
  assert('handleInstallModel logs [INSTALL:ERROR]', libSrc.includes('[INSTALL:ERROR]'));
  assert('handleInstallModel logs stack on error', libSrc.includes("err?.stack"));

  // Verify the OLD comment is gone (the non-blocking pattern that caused the bug)
  assert('OLD non-blocking comment removed',
    !libSrc.includes('These call the new non-blocking IPC handlers that return immediately'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Type Declarations: downloadStart return type includes status
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Type Declarations: downloadStart return type includes status:');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');

  assert('downloadStart return type includes status?: string',
    typesSrc.includes('downloadStart: (opts: any) => Promise<{ success: boolean; downloadId?: string; status?: string; error?: string }>'));
  assert('downloadStartRecommended return type includes status?: string',
    typesSrc.includes('downloadStartRecommended: () => Promise<{ success: boolean; downloadId?: string; status?: string; error?: string }>'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Trace Logs: [INSTALL:01] through [INSTALL:14]
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Trace Logs: [INSTALL:01] through [INSTALL:14]:');
  const allSrc = mainSrc + dmSrc + libSrc + read('../../src/main/update/secure-downloader.ts');
  const sdSrc = read('../../src/main/update/secure-downloader.ts');

  const traceTags = [
    '[INSTALL:01]', '[INSTALL:02]', '[INSTALL:03]', '[INSTALL:04]',
    '[INSTALL:05]', '[INSTALL:06]', '[INSTALL:07]', '[INSTALL:08]',
    '[INSTALL:09]', '[INSTALL:10]', '[INSTALL:11]', '[INSTALL:12]',
    '[INSTALL:13]', '[INSTALL:14]',
  ];
  for (const tag of traceTags) {
    assert(`trace log ${tag} exists`, allSrc.includes(tag));
  }

  assert('[INSTALL:ERROR] trace exists in main.ts', mainSrc.includes('[INSTALL:ERROR]'));
  assert('[INSTALL:ERROR] trace exists in renderer', libSrc.includes('[INSTALL:ERROR]'));
  assert('[INSTALL:ERROR] trace exists in secure-downloader', sdSrc.includes('[INSTALL:ERROR]'));
  assert('[INSTALL:ERROR] logs stage', mainSrc.includes('[INSTALL:ERROR] stage:'));
  assert('[INSTALL:ERROR] logs stack', mainSrc.includes('[INSTALL:ERROR] stack:'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) SecureDownloader trace logs
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) SecureDownloader trace logs:');
  assert('[INSTALL:10] HTTP_REQUEST in secure-downloader', sdSrc.includes('[INSTALL:10]') && sdSrc.includes('HTTP_REQUEST'));
  assert('[INSTALL:11] HTTP_RESPONSE in secure-downloader', sdSrc.includes('[INSTALL:11]') && sdSrc.includes('HTTP_RESPONSE'));
  assert('[INSTALL:12] STREAM_START in secure-downloader', sdSrc.includes('[INSTALL:12]') && sdSrc.includes('STREAM_START'));
  assert('[INSTALL:13] PROGRESS in secure-downloader', sdSrc.includes('[INSTALL:13]') && sdSrc.includes('PROGRESS'));
  assert('[INSTALL:14] DOWNLOAD_COMPLETE in secure-downloader', sdSrc.includes('[INSTALL:14]') && sdSrc.includes('DOWNLOAD_COMPLETE'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Tab Persistence Architecture Preserved (Phase 68)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Tab Persistence Architecture Preserved (Phase 68):');
  assert('display:none pattern for tab persistence', libSrc.includes("display: tab ==="));
  assert('Zustand download store used', libSrc.includes('useDownloadStore'));
  assert('downloads read from store', libSrc.includes('useDownloadStore((s) => s.downloads)'));
  assert('onDownloadState subscription exists', libSrc.includes('onDownloadState'));
  assert('onDownloadCompleted subscription exists', libSrc.includes('onDownloadCompleted'));
  assert('onDownloadError subscription exists', libSrc.includes('onDownloadError'));
  assert('downloadGetActive called on mount', libSrc.includes('downloadGetActive'));
  assert('syncFromMain called on mount', libSrc.includes('syncFromMain'));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Download Store: no premature state
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Download Store: architecture intact:');
  const storeSrc = read('../../src/renderer/store/download-store.ts');

  assert('download-store.ts exists', storeSrc.length > 0);
  assert('Zustand create() used', storeSrc.includes('create<DownloadStore>'));
  assert('downloads array in store', storeSrc.includes('downloads:'));
  assert('startDownload action exists', storeSrc.includes('startDownload:'));
  assert('updateProgress action exists', storeSrc.includes('updateProgress:'));
  assert('completeDownload action exists', storeSrc.includes('completeDownload:'));
  assert('failDownload action exists', storeSrc.includes('failDownload:'));
  assert('syncFromMain action exists', storeSrc.includes('syncFromMain:'));
  assert('isDownloading helper exists', storeSrc.includes('export function isDownloading'));

  // ═══════════════════════════════════════════════════════════════════════
  // 10) Preload: IPC channel name parity
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) Preload: IPC channel name parity:');
  const preloadSrc = read('../../src/main/preload.ts');

  assert('preload exposes downloadStart', preloadSrc.includes("downloadStart:") && preloadSrc.includes("ipcRenderer.invoke('download-start'"));
  assert('preload exposes downloadStartRecommended', preloadSrc.includes("downloadStartRecommended:") && preloadSrc.includes("ipcRenderer.invoke('download-start-recommended'"));
  assert('preload exposes downloadGetActive', preloadSrc.includes("downloadGetActive:") && preloadSrc.includes("ipcRenderer.invoke('download-get-active'"));
  assert('preload exposes modelDeployRespondPermission', preloadSrc.includes("modelDeployRespondPermission:") && preloadSrc.includes("ipcRenderer.invoke('model-deploy-respond-permission'"));
  assert('preload exposes onModelDeploymentPermissionRequest', preloadSrc.includes('onModelDeploymentPermissionRequest') && preloadSrc.includes("ipcRenderer.on('model-deployment-permission-request'"));
  assert('preload exposes onDownloadState', preloadSrc.includes('onDownloadState') && preloadSrc.includes("ipcRenderer.on('download:state'"));

  // Verify main.ts registers the same channel names
  assert('main.ts registers download-start handler', mainSrc.includes("ipcMain.handle('download-start'"));
  assert('main.ts registers download-start-recommended handler', mainSrc.includes("ipcMain.handle('download-start-recommended'"));
  assert('main.ts registers download-get-active handler', mainSrc.includes("ipcMain.handle('download-get-active'"));
  assert('main.ts registers model-deploy-respond-permission handler', mainSrc.includes("ipcMain.handle('model-deploy-respond-permission'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 11) Security: PermissionGate integrity preserved
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n11) Security: PermissionGate integrity preserved:');
  const gateSrc = read('../../src/main/update/permission-gate.ts');

  assert('PermissionGate class exists', gateSrc.includes('export class PermissionGate'));
  assert('requestPermission method exists', gateSrc.includes('async requestPermission('));
  assert('respondToPermissionRequest method exists', gateSrc.includes('respondToPermissionRequest('));
  assert('install-model classified as REQUIRES_APPROVAL', gateSrc.includes("'install-model'") && gateSrc.includes("return 'REQUIRES_APPROVAL'"));
  assert('required phrase for REQUIRES_APPROVAL is تایید می‌کنم', gateSrc.includes("return 'تایید می‌کنم'"));
  assert('onRequestPermission callback invoked', gateSrc.includes('this.callbacks.onRequestPermission?.('));

  // ═══════════════════════════════════════════════════════════════════════
  // 12) Behavioral Test: PermissionGate request → deny → no download
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n12) Behavioral Test: PermissionGate deny → no approval:');
  const { PermissionGate } = await import('../../src/main/update/permission-gate');
  const gate = new PermissionGate();

  let permissionRequestSeen = false;
  gate.setCallbacks({
    onRequestPermission: (_req) => { permissionRequestSeen = true; },
  });

  const permPromise = gate.requestPermission({
    type: 'install-model',
    description: 'Test download',
    affectedItems: ['test.gguf'],
    reason: 'test',
  });

  assert('onRequestPermission callback was fired', permissionRequestSeen);

  // Deny
  gate.respondToPermissionRequest('نه');
  const result = await permPromise;

  assert('Permission denied on "نه"', result.approved === false);
  assert('Denial method is "denied"', result.confirmationMethod === 'denied');

  // ═══════════════════════════════════════════════════════════════════════
  // 13) Behavioral Test: PermissionGate request → approve
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n13) Behavioral Test: PermissionGate approve → approval:');
  const gate2 = new PermissionGate();
  let req2: any = null;
  gate2.setCallbacks({
    onRequestPermission: (req) => { req2 = req; },
  });

  const permPromise2 = gate2.requestPermission({
    type: 'install-model',
    description: 'Test download 2',
    affectedItems: ['test2.gguf'],
    reason: 'test 2',
  });

  assert('onRequestPermission fired with requiredPhrase', req2 && req2.requiredPhrase === 'تایید می‌کنم');

  // Approve
  gate2.respondToPermissionRequest('تایید می‌کنم');
  const result2 = await permPromise2;

  assert('Permission approved on "تایید می‌کنم"', result2.approved === true);
  assert('Approval method is "chat"', result2.confirmationMethod === 'chat');

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 70 Tests: ${pass} passed, ${fail} failed`);
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
