/**
 * Phase 43 — Secure Self-Update & Permission System Tests
 *
 * Verifies the secure update architecture:
 *   1. PermissionGate (SAFE/REQUIRES_APPROVAL/HIGH_RISK + chat + voice confirmation)
 *   2. VoicePermissionVerifier (local STT confirmation)
 *   3. DownloadVerifier (SHA256 + sandbox)
 *   4. RollbackManager (backup + restore)
 *   5. AuditLogger (approved/rejected/history)
 *   6. UpdatePlanner (human-readable explanations)
 *   7. UpdateManager (orchestrator)
 *   8. IPC handlers registered
 *   9. No autonomous execution (every action requires permission)
 *
 * Run: npx tsx tests/system/test-phase43-secure-update.ts
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
  // 1) PermissionGate module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) PermissionGate module:');
  const pgSrc = read('../../src/main/update/permission-gate.ts');

  assert('permission-gate.ts exists', pgSrc.length > 0);
  assert('PermissionLevel type (SAFE/REQUIRES_APPROVAL/HIGH_RISK)', pgSrc.includes("'SAFE'") && pgSrc.includes("'REQUIRES_APPROVAL'") && pgSrc.includes("'HIGH_RISK'"));
  assert('ActionDescriptor interface', pgSrc.includes('interface ActionDescriptor'));
  assert('classifyAction function exported', pgSrc.includes('export function classifyAction'));
  assert('SAFE: check-update/show-changelog/show-size', /case 'check-update'[\s\S]{0,100}return 'SAFE'/.test(pgSrc));
  assert('REQUIRES_APPROVAL: download/install/modify-config', pgSrc.includes("'download'") && pgSrc.includes("'install'"));
  assert('HIGH_RISK: delete-file/modify-system/execute-script', pgSrc.includes("'delete-file'") && pgSrc.includes("'modify-system'"));
  assert('PermissionGate class exported', pgSrc.includes('export class PermissionGate'));
  assert('PermissionGate.requestPermission method', pgSrc.includes('requestPermission'));
  assert('PermissionGate.respondToPermissionRequest method', pgSrc.includes('respondToPermissionRequest'));
  assert('PermissionGate.respondViaVoice method', pgSrc.includes('respondViaVoice'));
  assert('SAFE actions auto-approved', pgSrc.includes("level === 'SAFE'") && pgSrc.includes('auto-approved'));
  assert('HIGH_RISK requires stronger confirmation', pgSrc.includes('Strong confirmation required'));
  assert('VoicePermissionVerifier class exported', pgSrc.includes('export class VoicePermissionVerifier'));
  assert('VoicePermissionVerifier.setCaptureFunction', pgSrc.includes('setCaptureFunction'));
  assert('VoicePermissionVerifier.captureConfirmation', pgSrc.includes('captureConfirmation'));
  assert('uses local voice (no cloud)', !pgSrc.includes('googleapis') && !pgSrc.includes('fetch('));
  assert('multilingual confirmation phrases (Persian)', pgSrc.includes('تایید می‌کنم') && pgSrc.includes('اجازه می‌دهم'));
  assert('HIGH_RISK action-specific phrases', pgSrc.includes('تایید حذف فایل') && pgSrc.includes('اجازه نصب آپدیت'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) DownloadVerifier module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) DownloadVerifier module:');
  const dvSrc = read('../../src/main/update/download-verifier.ts');

  assert('download-verifier.ts exists', dvSrc.length > 0);
  assert('DownloadVerifier class exported', dvSrc.includes('export class DownloadVerifier'));
  assert('computeFileHash method (SHA-256)', dvSrc.includes("crypto.createHash('sha256')"));
  assert('verifyDownload method', dvSrc.includes('verifyDownload'));
  assert('moveToTarget method', dvSrc.includes('moveToTarget'));
  assert('cleanSandbox method', dvSrc.includes('cleanSandbox'));
  assert('uses sandbox directory', dvSrc.includes('sandbox') && dvSrc.includes('tmpdir'));
  assert('hash comparison logic', dvSrc.includes('hashMatches'));
  assert('signature verification architecture', dvSrc.includes('signature') || dvSrc.includes('Signature'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) RollbackManager module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) RollbackManager module:');
  const rbSrc = read('../../src/main/update/rollback-manager.ts');

  assert('rollback-manager.ts exists', rbSrc.length > 0);
  assert('RollbackManager class exported', rbSrc.includes('export class RollbackManager'));
  assert('backupFile method', rbSrc.includes('backupFile'));
  assert('restoreFile method', rbSrc.includes('restoreFile'));
  assert('listBackups method', rbSrc.includes('listBackups'));
  assert('rollbackTo method', rbSrc.includes('rollbackTo'));
  assert('pruneOldBackups method', rbSrc.includes('pruneOldBackups'));
  assert('creates backup directory structure', rbSrc.includes('backups') && rbSrc.includes('version-'));
  assert('recursive directory copy', rbSrc.includes('copyDirectoryRecursive'));
  assert('BackupInfo interface', rbSrc.includes('interface BackupInfo'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) AuditLogger module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) AuditLogger module:');
  const alSrc = read('../../src/main/update/audit-logger.ts');

  assert('audit-logger.ts exists', alSrc.length > 0);
  assert('AuditLogger class exported', alSrc.includes('export class AuditLogger'));
  assert('log method (append)', alSrc.includes('appendFileSync'));
  assert('readRecent method', alSrc.includes('readRecent'));
  assert('readByAction method', alSrc.includes('readByAction'));
  assert('getUpdateHistory method', alSrc.includes('getUpdateHistory'));
  assert('getPermissionHistory method', alSrc.includes('getPermissionHistory'));
  assert('JSONL format (audit-log.jsonl)', alSrc.includes('audit-log.jsonl'));
  assert('AuditEntry interface', alSrc.includes('interface AuditEntry'));
  assert('AuditAction type (permission-requested/approved/denied)', alSrc.includes("'permission-requested'") && alSrc.includes("'permission-approved'") && alSrc.includes("'permission-denied'"));
  assert('AuditAction type (update actions)', alSrc.includes("'update-detected'") && alSrc.includes("'download-started'") && alSrc.includes("'install-completed'"));
  assert('AuditAction type (rollback actions)', alSrc.includes("'rollback-started'") && alSrc.includes("'rollback-completed'"));
  assert('never auto-deletes audit log', !alSrc.includes('unlink') && !alSrc.includes('deleteFile'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) UpdatePlanner module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) UpdatePlanner module:');
  const upSrc = read('../../src/main/update/update-planner.ts');

  assert('update-planner.ts exists', upSrc.length > 0);
  assert('UpdatePlanner class exported', upSrc.includes('export class UpdatePlanner'));
  assert('planUpdate method', upSrc.includes('planUpdate'));
  assert('generateExplanation method', upSrc.includes('generateExplanation'));
  assert('UpdateInfo interface', upSrc.includes('interface UpdateInfo'));
  assert('UpdatePlan interface', upSrc.includes('interface UpdatePlan'));
  assert('plan includes download step', upSrc.includes("type: 'download'"));
  assert('plan includes verify step', upSrc.includes('Verify') || upSrc.includes('verify'));
  assert('plan includes backup step', upSrc.includes('backup') && upSrc.includes('rollback'));
  assert('plan includes install step', upSrc.includes("type: 'install'"));
  assert('plan includes delete step (HIGH_RISK)', upSrc.includes("type: 'delete-file'"));
  assert('Persian explanation (آپدیت جدید)', upSrc.includes('یک آپدیت جدید پیدا کردم'));
  assert('Persian confirmation request (تایید می‌کنم)', upSrc.includes("'تایید می‌کنم'"));
  assert('generateDeleteExplanation method', upSrc.includes('generateDeleteExplanation'));
  assert('Persian delete explanation (اجازه حذف)', upSrc.includes('اجازه حذف می‌دهی'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) UpdateManager module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) UpdateManager module:');
  const umSrc = read('../../src/main/update/update-manager.ts');

  assert('update-manager.ts exists', umSrc.length > 0);
  assert('UpdateManager class exported', umSrc.includes('export class UpdateManager'));
  assert('checkForUpdate method', umSrc.includes('checkForUpdate'));
  assert('executeUpdate method', umSrc.includes('executeUpdate'));
  assert('respondToPermissionRequest method', umSrc.includes('respondToPermissionRequest'));
  assert('respondViaVoice method', umSrc.includes('respondViaVoice'));
  assert('getUpdateManager singleton', umSrc.includes('export function getUpdateManager'));
  assert('NEVER executes without permission', /requestPermission[\s\S]{0,500}if \(!downloadResult\.approved\)/.test(umSrc));
  assert('stops immediately on denial', umSrc.includes('Download permission denied'));
  assert('rollback on install denial', /installResult[\s\S]{0,300}rollback/.test(umSrc));
  assert('logs every step to audit', umSrc.includes('auditLogger.log'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) IPC handlers registered
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');
  assert('update-check handler', mainSrc.includes("'update-check'"));
  assert('update-execute handler', mainSrc.includes("'update-execute'"));
  assert('update-respond-permission handler', mainSrc.includes("'update-respond-permission'"));
  assert('update-respond-voice handler', mainSrc.includes("'update-respond-voice'"));
  assert('update-audit-history handler', mainSrc.includes("'update-audit-history'"));
  assert('update-history handler', mainSrc.includes("'update-history'"));
  assert('update-list-backups handler', mainSrc.includes("'update-list-backups'"));
  assert('update-rollback handler', mainSrc.includes("'update-rollback'"));
  assert('update-classify-action handler', mainSrc.includes("'update-classify-action'"));
  assert('Phase 43 log message', mainSrc.includes('Phase 43'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Preload bridges
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Preload bridges:');
  const preSrc = read('../../src/main/preload.ts');
  assert('updateCheck bridge', preSrc.includes('updateCheck'));
  assert('updateExecute bridge', preSrc.includes('updateExecute'));
  assert('updateRespondPermission bridge', preSrc.includes('updateRespondPermission'));
  assert('updateRespondVoice bridge', preSrc.includes('updateRespondVoice'));
  assert('updateAuditHistory bridge', preSrc.includes('updateAuditHistory'));
  assert('updateHistory bridge', preSrc.includes('updateHistory'));
  assert('updateListBackups bridge', preSrc.includes('updateListBackups'));
  assert('updateRollback bridge', preSrc.includes('updateRollback'));
  assert('updateClassifyAction bridge', preSrc.includes('updateClassifyAction'));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Type definitions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Type definitions:');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('updateCheck type', typesSrc.includes('updateCheck'));
  assert('updateExecute type', typesSrc.includes('updateExecute'));
  assert('updateRespondPermission type', typesSrc.includes('updateRespondPermission'));
  assert('updateRespondVoice type', typesSrc.includes('updateRespondVoice'));
  assert('updateAuditHistory type', typesSrc.includes('updateAuditHistory'));
  assert('updateRollback type', typesSrc.includes('updateRollback'));
  assert('updateClassifyAction type', typesSrc.includes('updateClassifyAction'));

  // ═══════════════════════════════════════════════════════════════════════
  // 10) FUNCTIONAL TESTS — PermissionGate
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) PermissionGate functional tests:');

  const { PermissionGate, classifyAction, formatBytes } = await import('../../src/main/update/permission-gate');
  const gate = new PermissionGate();

  // SAFE action: auto-approved
  const safeAction = { type: 'check-update' as const, description: 'Check for updates' };
  const safeResult = await gate.requestPermission(safeAction);
  assert('SAFE action auto-approved', safeResult.approved === true);

  // REQUIRES_APPROVAL action: needs confirmation
  const downloadAction = { type: 'download' as const, description: 'Download v1.1.0', sizeBytes: 245 * 1024 * 1024 };
  const downloadPromise = gate.requestPermission(downloadAction);
  // Simulate user typing "تایید می‌کنم"
  setTimeout(() => gate.respondToPermissionRequest('تایید می‌کنم'), 50);
  const downloadResult = await downloadPromise;
  assert('REQUIRES_APPROVAL: approved with correct phrase', downloadResult.approved === true);
  assert('REQUIRES_APPROVAL: confirmationMethod = chat', downloadResult.confirmationMethod === 'chat');

  // REQUIRES_APPROVAL with wrong phrase: denied
  const downloadAction2 = { type: 'download' as const, description: 'Download v1.2.0', sizeBytes: 100 * 1024 * 1024 };
  const downloadPromise2 = gate.requestPermission(downloadAction2);
  setTimeout(() => gate.respondToPermissionRequest('maybe'), 50);
  const downloadResult2 = await downloadPromise2;
  assert('REQUIRES_APPROVAL: denied with wrong phrase', downloadResult2.approved === false);
  assert('REQUIRES_APPROVAL: denialReason set', downloadResult2.denialReason !== undefined);

  // HIGH_RISK action: requires exact phrase
  const deleteAction = { type: 'delete-file' as const, description: 'Delete old.dll', targetPath: 'C:\\app\\old.dll' };
  const deletePromise = gate.requestPermission(deleteAction);
  setTimeout(() => gate.respondToPermissionRequest('تایید حذف فایل'), 50);
  const deleteResult = await deletePromise;
  assert('HIGH_RISK: approved with exact phrase', deleteResult.approved === true);

  // HIGH_RISK with wrong phrase: denied
  const deleteAction2 = { type: 'delete-file' as const, description: 'Delete old2.dll', targetPath: 'C:\\app\\old2.dll' };
  const deletePromise2 = gate.requestPermission(deleteAction2);
  setTimeout(() => gate.respondToPermissionRequest('ok'), 50);
  const deleteResult2 = await deletePromise2;
  assert('HIGH_RISK: denied with weak phrase', deleteResult2.approved === false);

  // ═══════════════════════════════════════════════════════════════════════
  // 11) FUNCTIONAL TESTS — classifyAction + formatBytes
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n11) classifyAction + formatBytes:');
  assert('classifyAction(check-update) = SAFE', classifyAction({ type: 'check-update', description: '' }) === 'SAFE');
  assert('classifyAction(download) = REQUIRES_APPROVAL', classifyAction({ type: 'download', description: '' }) === 'REQUIRES_APPROVAL');
  assert('classifyAction(install) = REQUIRES_APPROVAL', classifyAction({ type: 'install', description: '' }) === 'REQUIRES_APPROVAL');
  assert('classifyAction(delete-file) = HIGH_RISK', classifyAction({ type: 'delete-file', description: '' }) === 'HIGH_RISK');
  assert('classifyAction(modify-system) = HIGH_RISK', classifyAction({ type: 'modify-system', description: '' }) === 'HIGH_RISK');
  assert('classifyAction(execute-script) = HIGH_RISK', classifyAction({ type: 'execute-script', description: '' }) === 'HIGH_RISK');
  assert('formatBytes(500) = 500 B', formatBytes(500) === '500 B');
  assert('formatBytes(1024) = 1.0 KB', formatBytes(1024) === '1.0 KB');
  assert('formatBytes(245MB) = 245.0 MB', formatBytes(245 * 1024 * 1024) === '245.0 MB');

  // ═══════════════════════════════════════════════════════════════════════
  // 12) FUNCTIONAL TESTS — DownloadVerifier (SHA-256)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n12) DownloadVerifier (SHA-256):');

  const { DownloadVerifier } = await import('../../src/main/update/download-verifier');
  const verifier = new DownloadVerifier();

  // Create a test file in the sandbox
  const tmpFile = path.join(verifier.sandboxPath, 'test-download.bin');
  const testContent = Buffer.from('NEX AI Phase 43 test content');
  fs.writeFileSync(tmpFile, testContent);
  const expectedHash = crypto.createHash('sha256').update(testContent).digest('hex');

  // Verify with correct hash
  const verifiedResult = await verifier.verifyDownload(tmpFile, expectedHash);
  assert('SHA-256: correct hash → verified=true', verifiedResult.verified === true);
  assert('SHA-256: hashMatches=true', verifiedResult.hashMatches === true);

  // Verify with wrong hash
  const failedResult = await verifier.verifyDownload(tmpFile, 'deadbeef');
  assert('SHA-256: wrong hash → verified=false', failedResult.verified === false);
  assert('SHA-256: hashMatches=false', failedResult.hashMatches === false);
  assert('SHA-256: error mentions mismatch', failedResult.error?.includes('mismatch'));

  // Cleanup
  verifier.cleanSandbox();

  // ═══════════════════════════════════════════════════════════════════════
  // 13) FUNCTIONAL TESTS — RollbackManager
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n13) RollbackManager:');

  const { RollbackManager } = await import('../../src/main/update/rollback-manager');
  const rollback = new RollbackManager();

  // Create a test file, backup it, then verify backup exists
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase43-'));
  const testFile = path.join(tmpDir, 'app-config.json');
  fs.writeFileSync(testFile, '{"version":"1.0.0"}');

  const backupPath = rollback.backupFile(testFile, '1.0.0');
  assert('backupFile returns path', backupPath !== null);
  assert('backup file exists', backupPath !== null && fs.existsSync(backupPath));

  // List backups
  const backups = rollback.listBackups();
  assert('listBackups returns entries', backups.length > 0);
  assert('backup has version 1.0.0', backups.some((b) => b.version === '1.0.0'));

  // Restore
  const modifiedFile = path.join(tmpDir, 'app-config.json');
  fs.writeFileSync(modifiedFile, '{"version":"2.0.0"}');
  if (backupPath) {
    rollback.restoreFile(backupPath, modifiedFile);
    const restored = fs.readFileSync(modifiedFile, 'utf-8');
    assert('restoreFile restores original content', restored === '{"version":"1.0.0"}');
  }

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }

  // ═══════════════════════════════════════════════════════════════════════
  // 14) FUNCTIONAL TESTS — AuditLogger
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n14) AuditLogger:');

  const { AuditLogger } = await import('../../src/main/update/audit-logger');
  const audit = new AuditLogger();

  // Log some entries
  audit.log({ action: 'update-detected', description: 'v1.1.0 available' });
  audit.log({ action: 'permission-requested', description: 'Download v1.1.0', level: 'REQUIRES_APPROVAL' });
  audit.log({ action: 'permission-approved', description: 'Download approved', confirmationMethod: 'chat' });
  audit.log({ action: 'download-started', description: 'Downloading v1.1.0' });
  audit.log({ action: 'download-completed', description: 'Download finished' });

  // Read recent
  const recent = audit.readRecent(10);
  assert('readRecent returns entries', recent.length >= 5);
  assert('entries have id', recent[0].id !== undefined);
  assert('entries have timestamp', recent[0].timestamp !== undefined);

  // Read by action
  const downloads = audit.readByAction('download-started', 5);
  assert('readByAction filters by action', downloads.every((e) => e.action === 'download-started'));

  // Get update history
  const history = audit.getUpdateHistory();
  assert('getUpdateHistory returns update entries', history.length >= 3);
  assert('update history includes update-detected', history.some((e) => e.action === 'update-detected'));

  // Get permission history
  const permHistory = audit.getPermissionHistory();
  assert('getPermissionHistory returns permission entries', permHistory.length >= 1);

  // ═══════════════════════════════════════════════════════════════════════
  // 15) FUNCTIONAL TESTS — UpdatePlanner
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n15) UpdatePlanner:');

  const { UpdatePlanner } = await import('../../src/main/update/update-planner');
  const planner = new UpdatePlanner();

  const plan = planner.planUpdate({
    currentVersion: '1.0.0',
    newVersion: '1.1.0',
    downloadSizeBytes: 245 * 1024 * 1024,
    changelog: ['بهبود Agent', 'رفع خطای Terminal'],
    isSecurityUpdate: false,
    isOptional: false,
  });

  assert('plan has 5 steps', plan.steps.length === 5);
  assert('step 0 is download', plan.steps[0].action.type === 'download');
  assert('step 3 is install', plan.steps[3].action.type === 'install');
  assert('step 4 is delete-file (HIGH_RISK)', plan.steps[4].action.type === 'delete-file');
  assert('plan requiresBackup', plan.requiresBackup === true);
  assert('plan rollbackPossible', plan.rollbackPossible === true);
  assert('explanation contains Persian text', plan.explanation.includes('یک آپدیت جدید'));
  assert('explanation contains version numbers', plan.explanation.includes('1.0.0') && plan.explanation.includes('1.1.0'));
  assert('explanation contains download size', plan.explanation.includes('245.0 MB'));
  assert('explanation contains changelog', plan.explanation.includes('بهبود Agent'));

  // ═══════════════════════════════════════════════════════════════════════
  // 16) FUNCTIONAL TESTS — UpdateManager (no autonomous execution)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n16) UpdateManager (no autonomous execution):');

  const { UpdateManager } = await import('../../src/main/update/update-manager');
  const manager = new UpdateManager();

  let permissionRequested = false;
  manager.setCallbacks({
    onPermissionRequest: () => { permissionRequested = true; },
    onUpdateComplete: () => {},
    onProgress: () => {},
  });

  // Execute update — should request permission for download
  const execPromise = manager.executeUpdate(plan);
  // Wait a tick, then deny
  setTimeout(() => manager.respondToPermissionRequest('no'), 50);
  const execResult = await execPromise;

  assert('UpdateManager requests permission before download', permissionRequested === true);
  assert('UpdateManager stops on denial', execResult.success === false);
  assert('denial message mentions "permission denied"', execResult.message.includes('permission denied'));

  // ═══════════════════════════════════════════════════════════════════════
  // 17) No autonomous execution verification
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n17) No autonomous execution:');
  assert('NO auto-download in update-manager', !umSrc.includes('autoDownload') && !/setTimeout[\s\S]{0,100}download/i.test(umSrc));
  assert('NO auto-install without permission', !/autoInstall|auto_install/i.test(umSrc));
  assert('every executeUpdate step calls requestPermission (3+ calls)', (umSrc.match(/requestPermission/g) || []).length >= 3);

  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 43 SECURE UPDATE RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('PHASE 43 SECURE SELF-UPDATE & PERMISSION SYSTEM: ALL PASS ✅');
  console.log('\nNOTE: Windows runtime QA is NOT VERIFIED by this test.');
  console.log('      The user MUST verify on Windows:');
  console.log('      1. update-check shows update plan with Persian explanation');
  console.log('      2. update-execute asks permission (no auto-download)');
  console.log('      3. Typing "تایید می‌کنم" approves download');
  console.log('      4. Voice confirmation works (Phase 41 STT)');
  console.log('      5. SHA-256 verification works');
  console.log('      6. Rollback works on failure');
  console.log('      7. Audit log records all actions');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
