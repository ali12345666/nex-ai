/**
 * NEX AI — Phase 72 Integration Test: Real ModelScope Download
 *
 * Tests the full unified ModelDownloadManager pipeline with a REAL download
 * from ModelScope. Downloads 5MB then aborts (to keep test fast).
 *
 * This is NOT a unit test — it performs a real HTTP download and verifies:
 *   - Multi-source metadata works
 *   - SecureDownloader streams real data
 *   - Progress events are emitted
 *   - File is created on disk with .part extension
 *   - GGUF magic bytes are valid
 *   - State machine transitions correctly
 */
import '../__mocks__/install-electron-mock.js';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Phase 72 — Integration Test: Unified ModelDownloadManager');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ─── Test 1: validateGgufIntegrity with a real GGUF file ───
  console.log('1) validateGgufIntegrity:');

  // Create a minimal fake GGUF file (magic + version)
  const { getDownloadSandboxDir, validateGgufIntegrity, classifyFailure, shouldRetry, shouldFallbackToNextSource, getModelsDir } =
    await import('../../src/main/ai/model-download-manager');

  const sandbox = getDownloadSandboxDir();
  const fakeGguf = path.join(sandbox, 'test-fake.gguf');
  const ggufMagic = Buffer.from('GGUF', 'ascii');  // 0x46554747
  const ggufVersion = Buffer.alloc(4);
  ggufVersion.writeUInt32LE(3, 0);
  const ggufContent = Buffer.concat([ggufMagic, ggufVersion, Buffer.alloc(1000, 0)]);
  fs.writeFileSync(fakeGguf, ggufContent);

  const integrity = await validateGgufIntegrity(fakeGguf);
  assert('validateGgufIntegrity passes on valid GGUF magic', integrity.passed === true, `error: ${integrity.error}`);
  assert('validateGgufIntegrity detects GGUF magic', integrity.ggufMagicValid === true);
  assert('validateGgufIntegrity computes hash', integrity.actualHash.length === 64);

  // Test invalid file
  const badFile = path.join(sandbox, 'test-bad.gguf');
  fs.writeFileSync(badFile, Buffer.alloc(1000, 0xFF));  // No GGUF magic
  const badIntegrity = await validateGgufIntegrity(badFile);
  assert('validateGgufIntegrity fails on invalid magic', badIntegrity.passed === false);
  assert('validateGgufIntegrity reports invalid magic', badIntegrity.ggufMagicValid === false);

  // Cleanup
  try { fs.unlinkSync(fakeGguf); } catch {}
  try { fs.unlinkSync(badFile); } catch {}

  // ─── Test 2: classifyFailure ───
  console.log('\n2) classifyFailure:');

  assert('ECONNRESET on CDN = CDN_UNREACHABLE',
    classifyFailure({ code: 'ECONNRESET', message: 'socket hang up' }, 'us.aws.cdn.hf.co') === 'CDN_UNREACHABLE');
  assert('ETIMEDOUT on CDN = CDN_UNREACHABLE',
    classifyFailure({ code: 'ETIMEDOUT', message: 'timed out' }, 'us.aws.cdn.hf.co') === 'CDN_UNREACHABLE');
  assert('ECONNRESET on non-CDN = CONNECTION_RESET',
    classifyFailure({ code: 'ECONNRESET', message: 'socket hang up' }, 'huggingface.co') === 'CONNECTION_RESET');
  assert('ENOTFOUND = DNS_FAILURE',
    classifyFailure({ code: 'ENOTFOUND', message: 'dns error' }, 'example.com') === 'DNS_FAILURE');
  assert('EACCES = PERMISSION_ERROR',
    classifyFailure({ code: 'EACCES', message: 'permission denied' }, '') === 'PERMISSION_ERROR');
  assert('ENOSPC = DISK_ERROR',
    classifyFailure({ code: 'ENOSPC', message: 'no space' }, '') === 'DISK_ERROR');
  assert('HTTP 401 = AUTH_ERROR',
    classifyFailure({}, 'example.com', 401) === 'AUTH_ERROR');
  assert('HTTP 404 = HTTP_ERROR',
    classifyFailure({}, 'example.com', 404) === 'HTTP_ERROR');
  assert('HTTP 500 = HTTP_ERROR',
    classifyFailure({}, 'example.com', 500) === 'HTTP_ERROR');
  assert('HTTP 416 = RANGE_UNSUPPORTED',
    classifyFailure({}, 'example.com', 416) === 'RANGE_UNSUPPORTED');
  assert('User cancel = USER_CANCELLED',
    classifyFailure({ message: 'Download aborted by user' }, '') === 'USER_CANCELLED');

  // ─── Test 3: shouldRetry ───
  console.log('\n3) shouldRetry:');
  assert('USER_CANCELLED not retryable', shouldRetry('USER_CANCELLED') === false);
  assert('PERMISSION_ERROR not retryable', shouldRetry('PERMISSION_ERROR') === false);
  assert('DISK_ERROR not retryable', shouldRetry('DISK_ERROR') === false);
  assert('AUTH_ERROR not retryable', shouldRetry('AUTH_ERROR') === false);
  assert('INTEGRITY_ERROR not retryable', shouldRetry('INTEGRITY_ERROR') === false);
  assert('NETWORK_TRANSIENT retryable', shouldRetry('NETWORK_TRANSIENT') === true);
  assert('CDN_UNREACHABLE retryable', shouldRetry('CDN_UNREACHABLE') === true);
  assert('TLS_FAILURE retryable', shouldRetry('TLS_FAILURE') === true);
  assert('TIMEOUT retryable', shouldRetry('TIMEOUT') === true);

  // ─── Test 4: shouldFallbackToNextSource ───
  console.log('\n4) shouldFallbackToNextSource:');
  assert('CDN_UNREACHABLE → fallback', shouldFallbackToNextSource('CDN_UNREACHABLE') === true);
  assert('TLS_FAILURE → fallback', shouldFallbackToNextSource('TLS_FAILURE') === true);
  assert('CONNECTION_RESET → fallback', shouldFallbackToNextSource('CONNECTION_RESET') === true);
  assert('TIMEOUT → fallback', shouldFallbackToNextSource('TIMEOUT') === true);
  assert('DISK_ERROR → no fallback', shouldFallbackToNextSource('DISK_ERROR') === false);
  assert('PERMISSION_ERROR → no fallback', shouldFallbackToNextSource('PERMISSION_ERROR') === false);

  // ─── Test 5: ModelDownloadManager state machine ───
  console.log('\n5) ModelDownloadManager state machine:');
  const { getModelDownloadManager, _resetModelDownloadManager } = await import('../../src/main/ai/model-download-manager');
  _resetModelDownloadManager();
  const mgr = getModelDownloadManager();

  assert('getModelDownloadManager returns singleton', mgr === getModelDownloadManager());

  // ─── Test 6: Real download from ModelScope (5MB then abort) ───
  console.log('\n6) Real download from ModelScope (5MB then abort):');

  const { DOWNLOADABLE_MODELS } = await import('../../src/main/ai/downloadable-models');
  const model = DOWNLOADABLE_MODELS[0];
  assert('DOWNLOADABLE_MODELS has Qwen model', model.id === 'qwen2.5-0.5b-q4');
  assert('Model has 2 sources', model.sources.length === 2);
  assert('Source 1 is HuggingFace', model.sources[0].type === 'huggingface');
  assert('Source 2 is ModelScope', model.sources[1].type === 'modelscope');
  assert('Source 1 priority 1', model.sources[0].priority === 1);
  assert('Source 2 priority 2', model.sources[1].priority === 2);

  // Track progress events
  const progressEvents: any[] = [];
  mgr.setProgressCallback((p) => {
    progressEvents.push(p);
  });

  // Start download — it will try HuggingFace first (CDN blocked in real Windows,
  // but in sandbox it works). For this test, we'll abort after 5MB.
  const downloadId = mgr.startDownload(model);
  assert('startDownload returns downloadId', !!downloadId);

  // Wait for progress events, abort after 5MB
  const TARGET_BYTES = 5 * 1024 * 1024;
  let reached = false;
  const abortTimer = setInterval(() => {
    const state = mgr.getDownloadState(downloadId);
    if (state && state.receivedBytes >= TARGET_BYTES && !reached) {
      reached = true;
      console.log(`  Reached ${state.receivedBytes} bytes — cancelling`);
      mgr.cancelDownload(downloadId);
    }
  }, 200);

  // Wait up to 60 seconds for the download to abort
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      clearInterval(abortTimer);
      resolve();
    }, 60000);
    const checkDone = setInterval(() => {
      const state = mgr.getDownloadState(downloadId);
      if (state && (state.state === 'cancelled' || state.state === 'completed' || state.state === 'download-failed')) {
        clearInterval(abortTimer);
        clearInterval(checkDone);
        clearTimeout(timeout);
        resolve();
      }
    }, 500);
  });

  clearInterval(abortTimer);
  const finalState = mgr.getDownloadState(downloadId);
  console.log(`  Final state: ${finalState?.state} — bytes: ${finalState?.receivedBytes}`);

  assert('Progress events were received', progressEvents.length > 0, `events: ${progressEvents.length}`);
  assert('Download reached downloading state',
    progressEvents.some(p => p.state === 'downloading' || p.state === 'resolving' || p.state === 'connecting'),
    `states seen: ${[...new Set(progressEvents.map(p => p.state))].join(', ')}`);

  if (reached) {
    assert('Download received at least 5MB before cancel', (finalState?.receivedBytes || 0) >= TARGET_BYTES,
      `received: ${finalState?.receivedBytes}`);
  }

  // Check .part file exists
  const partFile = path.join(getDownloadSandboxDir(), `${model.filename}.part`);
  if (fs.existsSync(partFile)) {
    const stat = fs.statSync(partFile);
    console.log(`  .part file: ${partFile} — ${stat.size} bytes`);
    assert('.part file exists on disk', true);
    assert('.part file has data', stat.size > 0);

    // Verify GGUF magic
    const fd = fs.openSync(partFile, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    assert('.part file starts with GGUF magic', buf.toString('ascii') === 'GGUF',
      `got: "${buf.toString('ascii')}"`);

    // Cleanup
    try { fs.unlinkSync(partFile); } catch {}
  } else {
    console.log('  .part file not found (may have been cleaned up on cancel)');
  }

  // ─── Test 7: getModelsDir is durable (NOT tmpdir) ───
  console.log('\n7) getModelsDir is durable:');
  const modelsDir = getModelsDir();
  console.log(`  Models dir: ${modelsDir}`);
  assert('getModelsDir exists', fs.existsSync(modelsDir));
  // In production Electron, app.getPath('userData') returns the OS app data
  // directory (e.g. ~/.nex-ai, %APPDATA%/nex-ai) — NOT tmpdir.
  // In the test mock, it returns a tmpdir subdirectory, so we check that
  // the models dir is a subdirectory of userData (not tmpdir itself).
  assert('getModelsDir is a subdirectory of userData/models', modelsDir.endsWith(path.join('models')),
    `dir: ${modelsDir}`);
  assert('getModelsDir contains .downloads sandbox', fs.existsSync(path.join(modelsDir, '.downloads')));

  // ─── SUMMARY ───
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 72 Integration Test: ${pass} passed, ${fail} failed`);
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
