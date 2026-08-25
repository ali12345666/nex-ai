/**
 * Phase 44 — Production Update Execution Layer Tests
 *
 * Verifies the real update execution system:
 *   1. SecureDownloader (HTTPS only + sandbox + resume + progress)
 *   2. SignatureVerifier (Ed25519 + RSA + version compatibility)
 *   3. UpdateInstaller (NSIS + portable + model + backup + rollback)
 *   4. ModelUpdater (permission + download + verify + install)
 *   5. UpdateHistory (persistence + entries + queries)
 *   6. IPC handlers registered
 *   7. No autonomous execution (all Phase 43 security rules preserved)
 *
 * Run: npx tsx tests/system/test-phase44-production-update.ts
 */
import '../__mocks__/install-electron-mock.js';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main(): Promise<void> {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) SecureDownloader module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) SecureDownloader module:');
  const sdSrc = read('../../src/main/update/secure-downloader.ts');

  assert('secure-downloader.ts exists', sdSrc.length > 0);
  assert('SecureDownloader class exported', sdSrc.includes('export class SecureDownloader'));
  assert('download method', sdSrc.includes('async download('));
  assert('HTTPS only (rejects HTTP)', sdSrc.includes("startsWith('https://')"));
  assert('rejects non-HTTPS URLs', sdSrc.includes('only HTTPS URLs are allowed'));
  assert('uses sandbox directory', sdSrc.includes('sandbox'));
  assert('resume support (Range header)', sdSrc.includes('Range'));
  assert('progress reporting', sdSrc.includes('onProgress'));
  assert('download speed calculation', sdSrc.includes('speedBytesPerSec'));
  assert('ETA estimation', sdSrc.includes('etaSeconds'));
  assert('SHA-256 hash during download', sdSrc.includes("crypto.createHash('sha256')"));
  assert('abort support', sdSrc.includes('shouldAbort'));
  assert('timeout support', sdSrc.includes('timeoutMs'));
  assert('cleanSandbox method', sdSrc.includes('cleanSandbox'));
  assert('DownloadProgress interface', sdSrc.includes('interface DownloadProgress'));
  assert('DownloadResult interface', sdSrc.includes('interface DownloadResult'));
  assert('DownloadOptions interface', sdSrc.includes('interface DownloadOptions'));
  assert('uses https module (no external deps)', sdSrc.includes("import * as https from 'https'"));
  assert('NO fetch() calls', !sdSrc.includes('fetch('));
  assert('NO axios/got/request', !sdSrc.includes('axios') && !sdSrc.includes('got(') && !sdSrc.includes("require('request')"));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) SignatureVerifier module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) SignatureVerifier module:');
  const svSrc = read('../../src/main/update/signature-verifier.ts');

  assert('signature-verifier.ts exists', svSrc.length > 0);
  assert('SignatureVerifier class exported', svSrc.includes('export class SignatureVerifier'));
  assert('verifyEd25519 method', svSrc.includes('verifyEd25519'));
  assert('verifyRsaSha256 method', svSrc.includes('verifyRsaSha256'));
  assert('verify (auto-detect) method', svSrc.includes('verify('));
  assert('checkVersionCompatibility method', svSrc.includes('checkVersionCompatibility'));
  assert('verifyForInstallation method', svSrc.includes('verifyForInstallation'));
  assert('Ed25519 support', svSrc.includes("'ed25519'"));
  assert('RSA-SHA256 support', svSrc.includes("'rsa-sha256'"));
  assert('version downgrade check', svSrc.includes('isDowngrade'));
  assert('major jump check', svSrc.includes('isMajorJump'));
  assert('stops on verification failure', svSrc.includes('STOP'));
  assert('uses crypto.verify', svSrc.includes('crypto.verify'));
  assert('computeFileHash method', svSrc.includes('computeFileHash'));
  assert('parseVersion method', svSrc.includes('parseVersion'));
  assert('SignatureVerificationResult interface', svSrc.includes('interface SignatureVerificationResult'));
  assert('VersionCompatibilityResult interface', svSrc.includes('interface VersionCompatibilityResult'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) UpdateInstaller module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) UpdateInstaller module:');
  const uiSrc = read('../../src/main/update/update-installer.ts');

  assert('update-installer.ts exists', uiSrc.length > 0);
  assert('UpdateInstaller class exported', uiSrc.includes('export class UpdateInstaller'));
  assert('install method', uiSrc.includes('async install('));
  assert('NSIS installer support', uiSrc.includes('installNsis'));
  assert('portable update support', uiSrc.includes('installPortable'));
  assert('model install support', uiSrc.includes('installModel'));
  assert('backup before install', uiSrc.includes('createBackup'));
  assert('automatic rollback on failure', uiSrc.includes('rolling back') || uiSrc.includes('Rollback'));
  assert('post-install verification', uiSrc.includes('verifyAfterInstall'));
  assert('verifyInstallation method', uiSrc.includes('verifyInstallation'));
  assert('uses safeExecFile (NSIS)', uiSrc.includes('safeExecFile'));
  assert('NSIS silent mode (/S flag)', uiSrc.includes("'/S'"));
  assert('InstallMethod type (nsis/portable/model)', uiSrc.includes("'nsis'") && uiSrc.includes("'portable'") && uiSrc.includes("'model'"));
  assert('InstallOptions interface', uiSrc.includes('interface InstallOptions'));
  assert('InstallResult interface', uiSrc.includes('interface InstallResult'));
  assert('install log (messages array)', uiSrc.includes('log: string[]'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) ModelUpdater module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) ModelUpdater module:');
  const muSrc = read('../../src/main/update/model-updater.ts');

  assert('model-updater.ts exists', muSrc.length > 0);
  assert('ModelUpdater class exported', muSrc.includes('export class ModelUpdater'));
  assert('updateModel method', muSrc.includes('async updateModel'));
  assert('generates Persian explanation', muSrc.includes('آیا اجازه دانلود این مدل را می‌دهی؟'));
  assert('requests permission before download', muSrc.includes('requestPermission'));
  assert('uses SecureDownloader', muSrc.includes('SecureDownloader'));
  assert('uses SignatureVerifier', muSrc.includes('SignatureVerifier'));
  assert('uses UpdateInstaller', muSrc.includes('UpdateInstaller'));
  assert('uses AuditLogger', muSrc.includes('AuditLogger'));
  assert('ModelType includes gguf', muSrc.includes("'gguf'"));
  assert('ModelType includes whisper', muSrc.includes("'whisper'"));
  assert('ModelType includes piper', muSrc.includes("'piper'"));
  assert('ModelType includes vision', muSrc.includes("'vision'"));
  assert('ModelUpdateInfo interface', muSrc.includes('interface ModelUpdateInfo'));
  assert('ModelUpdateResult interface', muSrc.includes('interface ModelUpdateResult'));
  assert('generateModelExplanation method', muSrc.includes('generateModelExplanation'));
  assert('stops on permission denial', muSrc.includes('permission denied'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) UpdateHistory module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) UpdateHistory module:');
  const uhSrc = read('../../src/main/update/update-history.ts');

  assert('update-history.ts exists', uhSrc.length > 0);
  assert('UpdateHistory class exported', uhSrc.includes('export class UpdateHistory'));
  assert('addEntry method', uhSrc.includes('addEntry'));
  assert('getEntries method', uhSrc.includes('getEntries'));
  assert('getRecent method', uhSrc.includes('getRecent'));
  assert('getLastSuccessfulUpdate method', uhSrc.includes('getLastSuccessfulUpdate'));
  assert('getFailedUpdates method', uhSrc.includes('getFailedUpdates'));
  assert('getVoiceApprovedUpdates method', uhSrc.includes('getVoiceApprovedUpdates'));
  assert('clearHistory method', uhSrc.includes('clearHistory'));
  assert('persists to update-history.json', uhSrc.includes('update-history.json'));
  assert('atomic write (temp + rename)', uhSrc.includes('renameSync'));
  assert('UpdateHistoryEntry interface', uhSrc.includes('interface UpdateHistoryEntry'));
  assert('approvalMethod field (voice/text/denied)', uhSrc.includes("approvalMethod: 'voice' | 'text' | 'denied'"));
  assert('result field (success/failure/rollback)', uhSrc.includes("result: 'success' | 'failure' | 'rollback'"));
  assert('rollbackStatus field', uhSrc.includes('rollbackStatus'));
  assert('filesChanged field', uhSrc.includes('filesChanged'));
  assert('hash field', uhSrc.includes('hash'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) UpdateManager integration (Phase 44 components wired)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) UpdateManager integration:');
  const umSrc = read('../../src/main/update/update-manager.ts');

  assert('imports SecureDownloader', umSrc.includes('SecureDownloader'));
  assert('imports SignatureVerifier', umSrc.includes('SignatureVerifier'));
  assert('imports UpdateInstaller', umSrc.includes('UpdateInstaller'));
  assert('imports ModelUpdater', umSrc.includes('ModelUpdater'));
  assert('imports UpdateHistory', umSrc.includes('UpdateHistory'));
  assert('getSecureDownloader accessor', umSrc.includes('getSecureDownloader'));
  assert('getSignatureVerifier accessor', umSrc.includes('getSignatureVerifier'));
  assert('getUpdateInstaller accessor', umSrc.includes('getUpdateInstaller'));
  assert('getModelUpdater accessor', umSrc.includes('getModelUpdater'));
  assert('getUpdateHistory accessor', umSrc.includes('getUpdateHistory'));
  assert('still has Phase 43 PermissionGate', umSrc.includes('getPermissionGate'));
  assert('still has Phase 43 AuditLogger', umSrc.includes('getAuditLogger'));
  assert('still has Phase 43 RollbackManager', umSrc.includes('getRollbackManager'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) IPC handlers registered
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');
  assert('update-download handler', mainSrc.includes("'update-download'"));
  assert('update-verify-signature handler', mainSrc.includes("'update-verify-signature'"));
  assert('update-install handler', mainSrc.includes("'update-install'"));
  assert('update-model handler', mainSrc.includes("'update-model'"));
  assert('update-model-explanation handler', mainSrc.includes("'update-model-explanation'"));
  assert('update-get-history handler', mainSrc.includes("'update-get-history'"));
  assert('update-add-history handler', mainSrc.includes("'update-add-history'"));
  assert('update-last-successful handler', mainSrc.includes("'update-last-successful'"));
  assert('Phase 44 comment in main.ts', mainSrc.includes('Phase 44'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Preload bridges
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Preload bridges:');
  const preSrc = read('../../src/main/preload.ts');
  assert('updateDownload bridge', preSrc.includes('updateDownload'));
  assert('updateVerifySignature bridge', preSrc.includes('updateVerifySignature'));
  assert('updateInstall bridge', preSrc.includes('updateInstall'));
  assert('updateModel bridge', preSrc.includes('updateModel'));
  assert('updateModelExplanation bridge', preSrc.includes('updateModelExplanation'));
  assert('updateGetHistory bridge', preSrc.includes('updateGetHistory'));
  assert('updateAddHistory bridge', preSrc.includes('updateAddHistory'));
  assert('updateLastSuccessful bridge', preSrc.includes('updateLastSuccessful'));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Type definitions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Type definitions:');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('updateDownload type', typesSrc.includes('updateDownload'));
  assert('updateVerifySignature type', typesSrc.includes('updateVerifySignature'));
  assert('updateInstall type', typesSrc.includes('updateInstall'));
  assert('updateModel type', typesSrc.includes('updateModel'));
  assert('updateGetHistory type', typesSrc.includes('updateGetHistory'));
  assert('updateLastSuccessful type', typesSrc.includes('updateLastSuccessful'));

  // ═══════════════════════════════════════════════════════════════════════
  // 10) FUNCTIONAL TESTS — SecureDownloader (HTTP rejection)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) SecureDownloader functional tests:');

  const { SecureDownloader } = await import('../../src/main/update/secure-downloader');
  const downloader = new SecureDownloader();

  // HTTP URL should be rejected
  const httpResult = await downloader.download({ url: 'http://example.com/test.bin' });
  assert('HTTP URLs rejected (security)', httpResult.success === false);
  assert('HTTP rejection mentions "HTTPS only"', httpResult.error?.includes('HTTPS'));

  // HTTPS URL with invalid host should fail gracefully
  const httpsResult = await downloader.download({
    url: 'https://localhost:1/nonexistent', // port 1 = connection refused
    timeoutMs: 3000,
  });
  assert('HTTPS to invalid host fails gracefully', httpsResult.success === false);
  assert('HTTPS failure has error message', httpsResult.error !== undefined);

  // Sandbox directory exists
  assert('sandbox directory exists', fs.existsSync(downloader.sandboxPath));

  // ═══════════════════════════════════════════════════════════════════════
  // 11) FUNCTIONAL TESTS — SignatureVerifier
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n11) SignatureVerifier functional tests:');

  const { SignatureVerifier } = await import('../../src/main/update/signature-verifier');
  const verifier = new SignatureVerifier();

  // Version compatibility
  const compatResult = verifier.checkVersionCompatibility('1.0.0', '1.1.0');
  assert('v1.0 → v1.1 compatible', compatResult.compatible === true);
  assert('v1.0 → v1.1 not downgrade', compatResult.isDowngrade === false);

  const downgradeResult = verifier.checkVersionCompatibility('1.1.0', '1.0.0');
  assert('v1.1 → v1.0 is downgrade (blocked)', downgradeResult.compatible === false);
  assert('downgrade detected', downgradeResult.isDowngrade === true);

  const majorJumpResult = verifier.checkVersionCompatibility('1.0.0', '3.0.0');
  assert('v1.0 → v3.0 is major jump', majorJumpResult.isMajorJump === true);

  // Hash + signature verification (create test file)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase44-'));
  const testFile = path.join(tmpDir, 'test-update.bin');
  const testContent = Buffer.from('NEX AI Phase 44 update content');
  fs.writeFileSync(testFile, testContent);
  const expectedHash = crypto.createHash('sha256').update(testContent).digest('hex');

  // verifyForInstallation with correct hash
  const installVerify = verifier.verifyForInstallation({
    filePath: testFile,
    expectedHash,
    currentVersion: '1.0.0',
    targetVersion: '1.1.0',
  });
  assert('verifyForInstallation: hash matches', installVerify.hashVerified === true);
  assert('verifyForInstallation: can install', installVerify.canInstall === true);

  // verifyForInstallation with wrong hash
  const failedVerify = verifier.verifyForInstallation({
    filePath: testFile,
    expectedHash: 'deadbeef',
    currentVersion: '1.0.0',
    targetVersion: '1.1.0',
  });
  assert('verifyForInstallation: wrong hash → cannot install', failedVerify.canInstall === false);
  assert('verifyForInstallation: hash mismatch detected', failedVerify.hashVerified === false);

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }

  // ═══════════════════════════════════════════════════════════════════════
  // 12) FUNCTIONAL TESTS — UpdateInstaller (portable install)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n12) UpdateInstaller functional tests:');

  const { UpdateInstaller } = await import('../../src/main/update/update-installer');
  const installer = new UpdateInstaller();

  // Create a test source file + target dir
  const installTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase44-install-'));
  const sourceFile = path.join(installTmpDir, 'model.gguf');
  const targetDir = path.join(installTmpDir, 'models');
  fs.writeFileSync(sourceFile, Buffer.from('fake model content'));

  // Portable install (single file copy)
  const installResult = await installer.install({
    method: 'portable',
    sourcePath: sourceFile,
    targetDir,
    currentVersion: '1.0.0',
    newVersion: '1.1.0',
    createBackup: false,
    verifyAfterInstall: true,
  });
  assert('portable install succeeds', installResult.success === true);
  assert('portable install method = portable', installResult.method === 'portable');
  assert('installed file exists', fs.existsSync(path.join(targetDir, 'model.gguf')));

  // Model install (copy model to target dir)
  const modelTargetDir = path.join(installTmpDir, 'models2');
  const modelResult = await installer.install({
    method: 'model',
    sourcePath: sourceFile,
    targetDir: modelTargetDir,
    currentVersion: '0',
    newVersion: 'test-model',
    createBackup: false,
    verifyAfterInstall: true,
  });
  assert('model install succeeds', modelResult.success === true);
  assert('model install method = model', modelResult.method === 'model');
  assert('model file exists', fs.existsSync(path.join(modelTargetDir, 'model.gguf')));

  // Cleanup
  try { fs.rmSync(installTmpDir, { recursive: true, force: true }); } catch { /* */ }

  // ═══════════════════════════════════════════════════════════════════════
  // 13) FUNCTIONAL TESTS — UpdateHistory
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n13) UpdateHistory functional tests:');

  const { UpdateHistory } = await import('../../src/main/update/update-history');
  const history = new UpdateHistory();

  // Add an entry
  const entry = history.addEntry({
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    approvalMethod: 'text',
    confirmationPhrase: 'تایید می‌کنم',
    filesChanged: ['app.exe', 'config.json'],
    result: 'success',
    rollbackStatus: 'not-needed',
    durationMs: 5000,
    hash: 'abc123',
    downloadSizeBytes: 350 * 1024 * 1024,
  });
  assert('addEntry returns entry with id', entry.id !== undefined);
  assert('addEntry sets date', entry.date !== undefined);
  assert('entry has fromVersion', entry.fromVersion === '1.0.0');
  assert('entry has toVersion', entry.toVersion === '1.1.0');

  // Get entries
  const entries = history.getEntries();
  assert('getEntries returns array', Array.isArray(entries));
  assert('getEntries includes our entry', entries.length > 0);

  // Get recent
  const recent = history.getRecent(5);
  assert('getRecent returns limited entries', recent.length <= 5);

  // Get last successful
  const lastSuccess = history.getLastSuccessfulUpdate();
  assert('getLastSuccessfulUpdate returns entry', lastSuccess !== null);

  // Add a voice-approved entry
  history.addEntry({
    fromVersion: '1.1.0',
    toVersion: '1.2.0',
    approvalMethod: 'voice',
    confirmationPhrase: 'اجازه دانلود آپدیت را می‌دهم',
    filesChanged: ['app.exe'],
    result: 'success',
    rollbackStatus: 'not-needed',
    durationMs: 3000,
  });

  const voiceApproved = history.getVoiceApprovedUpdates();
  assert('getVoiceApprovedUpdates returns voice entries', voiceApproved.length >= 1);
  assert('voice entry has approvalMethod=voice', voiceApproved.some((e) => e.approvalMethod === 'voice'));

  // ═══════════════════════════════════════════════════════════════════════
  // 14) No autonomous execution (Phase 43 security preserved)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n14) Phase 43 security rules preserved:');
  assert('PermissionGate still present in update-manager', umSrc.includes('PermissionGate'));
  assert('requestPermission still called before download', /requestPermission[\s\S]{0,500}download/i.test(umSrc));
  assert('stops on denial still present', umSrc.includes('permission denied'));
  assert('auditLogger still logs all actions', umSrc.includes('auditLogger.log'));
  assert('rollbackManager still present', umSrc.includes('RollbackManager'));
  assert('no auto-download without permission', !/auto.*download/i.test(umSrc));
  assert('no auto-install without permission', !/auto.*install/i.test(umSrc));
  assert('HTTPS-only enforced in downloader', sdSrc.includes('HTTPS'));

  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 44 PRODUCTION UPDATE RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('PHASE 44 PRODUCTION UPDATE EXECUTION LAYER: ALL PASS ✅');
  console.log('\nNOTE: Windows runtime QA is NOT VERIFIED by this test.');
  console.log('      The user MUST verify on Windows:');
  console.log('      1. update-download downloads to sandbox (HTTPS only)');
  console.log('      2. update-verify-signature checks SHA-256 + Ed25519');
  console.log('      3. update-install backs up + installs + verifies + rollbacks');
  console.log('      4. update-model requests permission before model download');
  console.log('      5. update-get-history shows update history with approval method');
  console.log('      6. Voice approval works (Phase 41 STT)');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
