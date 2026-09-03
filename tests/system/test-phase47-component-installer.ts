/**
 * Phase 47 — Component Installation Assistant Tests
 *
 * Verifies:
 *   1. ComponentInstaller (integrates Phase 44 + 43 + permission flow)
 *   2. HealthChecker (post-install verification)
 *   3. Persian explanations
 *   4. Permission required (no auto-download)
 *   5. Checksum validation
 *   6. Rollback on failure
 *   7. IPC handlers registered
 *   8. No autonomous actions
 *
 * Run: npx tsx tests/system/test-phase47-component-installer.ts
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
  // 1) ComponentInstaller module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) ComponentInstaller module:');
  const ciSrc = read('../../src/main/runtime/component-installer.ts');

  assert('component-installer.ts exists', ciSrc.length > 0);
  assert('ComponentInstaller class exported', ciSrc.includes('export class ComponentInstaller'));
  assert('installComponent method', ciSrc.includes('async installComponent'));
  assert('generatePersianExplanation method', ciSrc.includes('generatePersianExplanation'));
  assert('PersianExplanation interface', ciSrc.includes('interface PersianExplanation'));
  assert('InstallResult47 interface', ciSrc.includes('interface InstallResult47'));
  assert('InstallProgress interface', ciSrc.includes('interface InstallProgress'));
  assert('InstallStage type (idle/requesting/downloading/etc)', ciSrc.includes("'requesting-permission'") && ciSrc.includes("'downloading'") && ciSrc.includes("'installing'") && ciSrc.includes("'activated'"));
  assert('uses PermissionGate (Phase 43)', ciSrc.includes('PermissionGate'));
  assert('uses SecureDownloader (Phase 44)', ciSrc.includes('SecureDownloader'));
  assert('uses SignatureVerifier (Phase 44)', ciSrc.includes('SignatureVerifier'));
  assert('uses UpdateInstaller (Phase 44)', ciSrc.includes('UpdateInstaller'));
  assert('uses RollbackManager (Phase 44)', ciSrc.includes('RollbackManager'));
  assert('uses UpdateHistory (Phase 44)', ciSrc.includes('UpdateHistory'));
  assert('uses AuditLogger (Phase 44)', ciSrc.includes('AuditLogger'));
  assert('uses getCatalogEntry (Phase 46)', ciSrc.includes('getCatalogEntry'));
  assert('uses formatBytes (Phase 43)', ciSrc.includes('formatBytes'));
  assert('getComponentInstaller singleton', ciSrc.includes('export function getComponentInstaller'));
  assert('setProgressCallback method', ciSrc.includes('setProgressCallback'));
  assert('getPermissionGate accessor', ciSrc.includes('getPermissionGate'));
  assert('getDownloader accessor', ciSrc.includes('getDownloader'));
  assert('getHealthChecker accessor', ciSrc.includes('getHealthChecker'));
  assert('flow: permission → download → verify → install → health',
    ciSrc.includes('requestPermission') && ciSrc.includes('downloader.download') &&
    ciSrc.includes('checksum') && ciSrc.includes('installer.install') && ciSrc.includes('healthChecker.check'));

  // Persian explanation fields
  assert('Persian title for LLM', ciSrc.includes('نصب مدل هوش مصنوعی'));
  assert('Persian title for voice-stt', ciSrc.includes('فعال کردن تشخیص گفتار'));
  assert('Persian title for voice-tts', ciSrc.includes('فعال کردن تولید گفتار'));
  assert('Persian title for vision', ciSrc.includes('فعال کردن بینایی'));
  assert('Persian title for tool', ciSrc.includes('نصب ابزار runtime'));
  assert('Persian question (آیا اجازه)', ciSrc.includes('آیا اجازه می‌دهید؟'));

  // Permission flow
  assert('requests permission before download', /requestPermission[\s\S]{0,1000}if \(!permResult\.approved\)/.test(ciSrc));
  assert('returns permission-denied stage on denial', ciSrc.includes("'permission-denied'"));
  assert('logs permission request to audit', ciSrc.includes("'permission-requested'"));
  assert('logs permission approval to audit', ciSrc.includes("'permission-approved'"));
  assert('logs permission denial to audit', ciSrc.includes("'permission-denied'"));

  // Download flow
  assert('downloads to sandbox', ciSrc.includes('downloader.download'));
  assert('passes downloadUrl', ciSrc.includes('url: component.downloadUrl'));
  assert('passes expectedSize', ciSrc.includes('expectedSize: component.sizeBytes'));
  assert('passes filename', ciSrc.includes('filename: component.filename'));
  assert('progress callback during download', ciSrc.includes('onProgress'));
  assert('returns download-failed stage on failure', ciSrc.includes("'download-failed'"));
  assert('logs download-started to audit', ciSrc.includes("'download-started'"));
  assert('logs download-completed to audit', ciSrc.includes("'download-completed'"));

  // Verification flow
  assert('verifies SHA-256 hash', ciSrc.includes('downloadResult.hash !== component.checksum'));
  assert('returns verification-failed stage on mismatch', ciSrc.includes("'verification-failed'"));
  assert('skips verification for pending checksums', ciSrc.includes("'pending'"));
  assert('skips verification for n/a checksums', ciSrc.includes("'n/a'"));
  assert('logs download-verified to audit', ciSrc.includes("'download-verified'"));

  // Install flow
  assert('uses installer.install', ciSrc.includes('installer.install'));
  assert('creates backup before install', ciSrc.includes('backupFile'));
  assert('returns install-failed stage on failure', ciSrc.includes("'install-failed'"));
  assert('rollback on install failure', /install-failed[\s\S]{0,300}restoreFile/.test(ciSrc));
  assert('returns rolled-back stage', ciSrc.includes("'rolled-back'"));
  assert('logs install-completed to audit', ciSrc.includes("'install-completed'"));
  assert('logs install-failed to audit', ciSrc.includes("'install-failed'"));

  // Health check flow
  assert('runs health checker after install', ciSrc.includes('healthChecker.check'));
  assert('returns health-failed stage on failure', ciSrc.includes("'health-failed'"));
  assert('returns health-passed stage on success', ciSrc.includes("'health-passed'"));

  // Activation + history
  assert('returns activated stage', ciSrc.includes("'activated'"));
  assert('records to UpdateHistory', ciSrc.includes('history.addEntry'));
  assert('records approvalMethod', ciSrc.includes('approvalMethod'));
  assert('records confirmationPhrase', ciSrc.includes('confirmationPhrase'));
  assert('records result as success', ciSrc.includes("result: 'success'"));
  assert('records hash', ciSrc.includes('hash: downloadResult.hash'));

  // Tool components (no download)
  assert('tool components skip download', ciSrc.includes("type === 'tool' && component.sizeBytes === 0"));
  assert('tool components activate directly', /type === 'tool'[\s\S]{0,300}activated/.test(ciSrc));

  // NO autonomous actions
  assert('NO auto-download without permission', !/setTimeout[\s\S]{0,100}download/i.test(ciSrc));
  assert('NO auto-install without permission', !/setTimeout[\s\S]{0,100}install/i.test(ciSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) HealthChecker
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) HealthChecker:');
  assert('HealthChecker class exported', ciSrc.includes('export class HealthChecker'));
  assert('HealthStatus type (passed/failed/skipped)', ciSrc.includes("'passed'") && ciSrc.includes("'failed'") && ciSrc.includes("'skipped'"));
  assert('HealthCheckResult interface', ciSrc.includes('interface HealthCheckResult'));
  assert('check method', ciSrc.includes('async check('));
  assert('checks file exists', ciSrc.includes('existsSync'));
  assert('checks file readable', ciSrc.includes('openSync'));
  assert('checks file not empty', ciSrc.includes('size > 0'));
  assert('checks GGUF magic for LLM', ciSrc.includes('GGUF'));
  assert('checks ONNX for piper', ciSrc.includes('.onnx'));
  assert('checks executable for tools', ciSrc.includes('Binary found'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) IPC handlers
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');
  assert('component-install handler', mainSrc.includes("'component-install'"));
  assert('component-explanation handler', mainSrc.includes("'component-explanation'"));
  assert('component-health-check handler', mainSrc.includes("'component-health-check'"));
  assert('component-respond-permission handler', mainSrc.includes("'component-respond-permission'"));
  assert('component-respond-voice handler', mainSrc.includes("'component-respond-voice'"));
  assert('Phase 47 comment in main.ts', mainSrc.includes('Phase 47'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Preload bridges
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Preload bridges:');
  const preSrc = read('../../src/main/preload.ts');
  assert('componentInstall bridge', preSrc.includes('componentInstall'));
  assert('componentExplanation bridge', preSrc.includes('componentExplanation'));
  assert('componentHealthCheck bridge', preSrc.includes('componentHealthCheck'));
  assert('componentRespondPermission bridge', preSrc.includes('componentRespondPermission'));
  assert('componentRespondVoice bridge', preSrc.includes('componentRespondVoice'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Type definitions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Type definitions:');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('componentInstall type', typesSrc.includes('componentInstall'));
  assert('componentExplanation type', typesSrc.includes('componentExplanation'));
  assert('componentHealthCheck type', typesSrc.includes('componentHealthCheck'));
  assert('componentRespondPermission type', typesSrc.includes('componentRespondPermission'));
  assert('componentRespondVoice type', typesSrc.includes('componentRespondVoice'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) FUNCTIONAL TESTS — HealthChecker
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) HealthChecker functional tests:');

  const { HealthChecker } = await import('../../src/main/runtime/component-installer');
  const { getCatalogEntry } = await import('../../src/main/runtime/component-catalog');
  const health = new HealthChecker();

  // Create a test file and run health check
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase47-'));
  const testFile = path.join(tmpDir, 'test-model.gguf');

  // Test with empty file
  fs.writeFileSync(testFile, Buffer.alloc(0));
  let healthResult = await health.check(getCatalogEntry('qwen2.5-7b-q4')!, testFile);
  assert('health check: empty file → failed', healthResult.status === 'failed');
  assert('health check: has checks array', Array.isArray(healthResult.checks));
  assert('health check: checks have name', healthResult.checks[0].name !== undefined);
  assert('health check: checks have passed', typeof healthResult.checks[0].passed === 'boolean');
  assert('health check: checks have message', typeof healthResult.checks[0].message === 'string');

  // Test with valid GGUF file (write GGUF magic bytes + some data)
  const ggufMagic = Buffer.from('GGUF', 'ascii');
  const ggufData = Buffer.concat([ggufMagic, Buffer.alloc(100, 0)]);
  fs.writeFileSync(testFile, ggufData);
  healthResult = await health.check(getCatalogEntry('qwen2.5-7b-q4')!, testFile);
  assert('health check: valid GGUF → passed', healthResult.status === 'passed');
  assert('health check: file exists check passed', healthResult.checks.some((c) => c.name === 'File exists' && c.passed));
  assert('health check: file readable check passed', healthResult.checks.some((c) => c.name === 'File readable' && c.passed));
  assert('health check: file not empty check passed', healthResult.checks.some((c) => c.name === 'File not empty' && c.passed));
  assert('health check: GGUF format valid check passed', healthResult.checks.some((c) => c.name === 'GGUF format valid' && c.passed));

  // Test with non-existent file
  healthResult = await health.check(getCatalogEntry('qwen2.5-7b-q4')!, '/nonexistent/path.gguf');
  assert('health check: nonexistent file → failed', healthResult.status === 'failed');
  assert('health check: file exists check failed', healthResult.checks.some((c) => c.name === 'File exists' && !c.passed));

  // Test with .onnx file for piper
  const onnxFile = path.join(tmpDir, 'test-voice.onnx');
  fs.writeFileSync(onnxFile, Buffer.alloc(100));
  healthResult = await health.check(getCatalogEntry('piper-en-us-lessac-medium')!, onnxFile);
  assert('health check: .onnx → ONNX format passed', healthResult.checks.some((c) => c.name === 'ONNX voice format' && c.passed));

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }

  // ═══════════════════════════════════════════════════════════════════════
  // 7) FUNCTIONAL TESTS — Persian explanations
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Persian explanations:');

  const { getComponentInstaller } = await import('../../src/main/runtime/component-installer');
  const installer = getComponentInstaller();

  const llmExplanation = installer.generatePersianExplanation(getCatalogEntry('qwen2.5-7b-q4')!);
  assert('LLM explanation has Persian title', llmExplanation.title.includes('مدل'));
  assert('LLM explanation has purpose', llmExplanation.body.length > 0);
  assert('LLM explanation has size', llmExplanation.size.length > 0);
  assert('LLM explanation has question', llmExplanation.question.includes('اجازه'));

  const voiceExplanation = installer.generatePersianExplanation(getCatalogEntry('whisper-medium-q5')!);
  assert('Voice explanation has Persian title', voiceExplanation.title.includes('تشخیص گفتار'));
  assert('Voice explanation has purpose', voiceExplanation.body.length > 0);

  const visionExplanation = installer.generatePersianExplanation(getCatalogEntry('llava-7b-q4')!);
  assert('Vision explanation has Persian title', visionExplanation.title.includes('بینایی'));

  const toolExplanation = installer.generatePersianExplanation(getCatalogEntry('llama-cpp')!);
  assert('Tool explanation has Persian title', toolExplanation.title.includes('ابزار'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) FUNCTIONAL TESTS — ComponentInstaller (permission denial)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) ComponentInstaller (permission denial):');

  // Install without permission → should deny
  const installPromise = installer.installComponent('qwen2.5-7b-q4');
  // Simulate user denying permission
  setTimeout(() => installer.getPermissionGate().respondToPermissionRequest('نه'), 50);
  const installResult = await installPromise;

  assert('install without permission → failed', installResult.success === false);
  assert('install stage = permission-denied', installResult.stage === 'permission-denied');
  assert('install error mentions permission denied', installResult.error.includes('Permission denied'));
  assert('install log mentions permission', installResult.log.some((l) => l.includes('Permission denied')));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) No autonomous actions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) No autonomous actions:');
  assert('NO auto-download in installer', !/setTimeout[\s\S]{0,100}download/i.test(ciSrc));
  assert('NO auto-install without permission', !/setTimeout[\s\S]{0,100}install/i.test(ciSrc));
  assert('installer requests permission first', /requestPermission[\s\S]{0,1000}if \(!permResult/.test(ciSrc));
  assert('installer logs all actions to audit', ciSrc.includes('audit.log'));
  assert('installer records to history', ciSrc.includes('history.addEntry'));

  // ═══════════════════════════════════════════════════════════════════════
  // 10) Phase 43/44/46 integration
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) Phase integration:');
  assert('Phase 43: permission-gate imported', ciSrc.includes("from '../update/permission-gate'"));
  assert('Phase 44: secure-downloader imported', ciSrc.includes("from '../update/secure-downloader'"));
  assert('Phase 44: signature-verifier imported', ciSrc.includes("from '../update/signature-verifier'"));
  assert('Phase 44: update-installer imported', ciSrc.includes("from '../update/update-installer'"));
  assert('Phase 44: rollback-manager imported', ciSrc.includes("from '../update/rollback-manager'"));
  assert('Phase 44: update-history imported', ciSrc.includes("from '../update/update-history'"));
  assert('Phase 44: audit-logger imported', ciSrc.includes("from '../update/audit-logger'"));
  assert('Phase 46: component-catalog imported', ciSrc.includes("from './component-catalog'"));
  assert('main.ts still has Phase 43 permission IPCs', mainSrc.includes("'update-respond-permission'"));
  assert('main.ts still has Phase 44 download IPCs', mainSrc.includes("'update-download'"));
  assert('main.ts still has Phase 46 runtime IPCs', mainSrc.includes("'runtime-scan'"));

  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 47 COMPONENT INSTALLER RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('PHASE 47 COMPONENT INSTALLATION ASSISTANT: ALL PASS ✅');
  console.log('\nNOTE: Windows runtime QA is NOT VERIFIED by this test.');
  console.log('      The user MUST verify on Windows:');
  console.log('      1. component-install requests permission (Persian text)');
  console.log('      2. Typing "تایید می‌کنم" starts download');
  console.log('      3. SHA-256 verification runs');
  console.log('      4. Health check passes after install');
  console.log('      5. NO download without permission');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
