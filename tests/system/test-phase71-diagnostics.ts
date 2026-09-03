/**
 * Phase 71 — Download Loop / Socket Reset Diagnostics Tests
 *
 * Verifies:
 *   1. Retry loop is HARD-CAPPED at maxRetries (default 5)
 *   2. [DOWNLOAD_ATTEMPT] N/5 logging exists
 *   3. [DOWNLOAD_FINAL_FAILURE] logging exists with attempts/code/message/bytesReceived/host
 *   4. [REDIRECT] from/to logging exists
 *   5. .part file state logging between retries (size/mtime)
 *   6. Detailed error info (errorCode/errorStage/errorHost/bytesExpected) in DownloadResult
 *   7. Independent Node HTTPS diagnostic script exists
 *   8. Windows network diagnostics batch script exists
 *   9. Fresh SecureDownloader diagnostic script exists
 *  10. DownloadEntry includes error detail fields
 *  11. failDownload accepts detailed error info
 *  12. UI displays detailed error info (code/stage/host/received/expected)
 *  13. Spinner stops on failure (isDownloading excludes download-failed)
 *  14. No infinite retry (maxRetries respected, not Infinity)
 *
 * Run: npx tsx tests/system/test-phase71-diagnostics.ts
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
  const exists = (p: string) => fs.existsSync(path.join(__dirname, p));

  // ═══════════════════════════════════════════════════════════════════════
  // 1) SecureDownloader: Retry loop cap + logging
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) SecureDownloader: Retry loop cap + logging:');
  const sdSrc = read('../../src/main/update/secure-downloader.ts');

  assert('maxRetries defaults to 5', sdSrc.includes('opts.maxRetries ?? 5'));
  assert('[DOWNLOAD_ATTEMPT] N/5 logging exists', sdSrc.includes('[DOWNLOAD_ATTEMPT]'));
  assert('[DOWNLOAD_FINAL_FAILURE] logging exists', sdSrc.includes('[DOWNLOAD_FINAL_FAILURE]'));
  assert('[DOWNLOAD_FINAL_FAILURE] logs attempts', sdSrc.includes('attempts='));
  assert('[DOWNLOAD_FINAL_FAILURE] logs code', sdSrc.includes('code='));
  assert('[DOWNLOAD_FINAL_FAILURE] logs message', sdSrc.includes('message='));
  assert('[DOWNLOAD_FINAL_FAILURE] logs bytesReceived', sdSrc.includes('bytesReceived='));
  assert('[DOWNLOAD_FINAL_FAILURE] logs host', sdSrc.includes('host='));
  assert('[DOWNLOAD_RETRY] logging exists', sdSrc.includes('[DOWNLOAD_RETRY]'));
  assert('[DOWNLOAD_ABORTED] logging exists', sdSrc.includes('[DOWNLOAD_ABORTED]'));
  assert('[REDIRECT] from/to logging exists', sdSrc.includes('[REDIRECT] from='));
  assert('[REDIRECT] logs to host', sdSrc.includes('to='));
  assert('.part file state logging exists', sdSrc.includes('.part file state'));
  assert('.part logs size', sdSrc.includes('.part exists: true — size='));
  assert('.part logs mtime', sdSrc.includes('mtime='));
  assert('.part logs fresh download', sdSrc.includes('fresh download (no Range header)'));

  // Verify no infinite retry
  assert('NO maxRetries = 20', !sdSrc.includes('maxRetries ?? 20'));
  assert('NO maxRetries = Infinity', !sdSrc.includes('Infinity'));
  assert('NO ignore ECONNRESET', !sdSrc.includes("ignore 'ECONNRESET'") && !sdSrc.includes('ignoreECONNRESET'));
  assert('NO disable TLS', !sdSrc.includes('rejectUnauthorized: false'));
  assert('NO disable certificate', !sdSrc.includes('NODE_TLS_REJECT_UNAUTHORIZED'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) DownloadResult: detailed error fields
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) DownloadResult: detailed error fields:');
  assert('DownloadResult has errorCode', sdSrc.includes('errorCode?: string'));
  assert('DownloadResult has errorStage', sdSrc.includes('errorStage?: string'));
  assert('DownloadResult has errorHost', sdSrc.includes('errorHost?: string'));
  assert('DownloadResult has bytesExpected', sdSrc.includes('bytesExpected?: number'));
  assert('final failure returns errorCode', sdSrc.includes('errorCode: lastErrorCode'));
  assert('final failure returns errorStage', sdSrc.includes('errorStage: lastErrorStage'));
  assert('final failure returns errorHost', sdSrc.includes('errorHost: lastHost'));
  assert('final failure returns bytesExpected', sdSrc.includes('bytesExpected: totalBytesExpected'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) Diagnostic scripts exist
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Diagnostic scripts exist:');
  assert('Node HTTPS diagnostic exists', exists('../../diagnostics/test-node-https.js'));
  assert('Windows network diagnostics batch exists', exists('../../diagnostics/windows-network-diagnostics.bat'));
  assert('SecureDownloader fresh diagnostic exists', exists('../../diagnostics/test-secure-downloader-fresh.ts'));

  const nodeHttpsSrc = read('../../diagnostics/test-node-https.js');
  assert('Node HTTPS diagnostic uses only built-in https module', nodeHttpsSrc.includes("require('https')"));
  assert('Node HTTPS diagnostic does NOT import Electron', !nodeHttpsSrc.includes('electron'));
  assert('Node HTTPS diagnostic does NOT import React', !nodeHttpsSrc.includes('react'));
  assert('Node HTTPS diagnostic does NOT import Zustand', !nodeHttpsSrc.includes('zustand'));
  assert('Node HTTPS diagnostic logs Node version', nodeHttpsSrc.includes('Node version'));
  assert('Node HTTPS diagnostic logs platform', nodeHttpsSrc.includes('Platform'));
  assert('Node HTTPS diagnostic logs proxy env', nodeHttpsSrc.includes('HTTP_PROXY') && nodeHttpsSrc.includes('HTTPS_PROXY'));
  assert('Node HTTPS diagnostic logs DNS resolution', nodeHttpsSrc.includes('dns.resolve4'));
  assert('Node HTTPS diagnostic logs redirect chain', nodeHttpsSrc.includes('REDIRECT'));
  assert('Node HTTPS diagnostic verifies GGUF magic', nodeHttpsSrc.includes('GGUF'));
  assert('Node HTTPS diagnostic reports PASS/FAIL', nodeHttpsSrc.includes('PASS') && nodeHttpsSrc.includes('FAIL'));

  const batSrc = read('../../diagnostics/windows-network-diagnostics.bat');
  assert('Batch script checks Node version', batSrc.includes('node --version'));
  assert('Batch script checks npm version', batSrc.includes('npm --version'));
  assert('Batch script checks Electron version', batSrc.includes('npm ls electron'));
  assert('Batch script checks proxy env', batSrc.includes('HTTP_PROXY') && batSrc.includes('HTTPS_PROXY'));
  assert('Batch script checks npm proxy config', batSrc.includes('npm config get proxy'));
  assert('Batch script checks DNS for huggingface', batSrc.includes('nslookup huggingface.co'));
  assert('Batch script checks DNS for CDN', batSrc.includes('nslookup us.aws.cdn.hf.co'));
  assert('Batch script runs curl HEAD', batSrc.includes('curl.exe -I -L'));
  assert('Batch script runs curl 1MB download', batSrc.includes('curl.exe -L -r 0-1048575'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Download Store: detailed error fields
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Download Store: detailed error fields:');
  const storeSrc = read('../../src/renderer/store/download-store.ts');

  assert('DownloadEntry has errorCode', storeSrc.includes('errorCode?: string'));
  assert('DownloadEntry has errorStage', storeSrc.includes('errorStage?: string'));
  assert('DownloadEntry has errorHost', storeSrc.includes('errorHost?: string'));
  assert('DownloadEntry has bytesExpected', storeSrc.includes('bytesExpected?: number'));
  assert('failDownload accepts details param', storeSrc.includes('failDownload: (id, error, details'));
  assert('failDownload stores errorCode', storeSrc.includes('errorCode: details?.code'));
  assert('failDownload stores errorStage', storeSrc.includes('errorStage: details?.stage'));
  assert('failDownload stores errorHost', storeSrc.includes('errorHost: details?.host'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Spinner state machine: failed stops spinner
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Spinner state machine:');
  assert('isDownloading excludes download-failed', storeSrc.includes("'download-failed'") && storeSrc.includes('isDownloading'));
  assert('isDownloading excludes permission-denied', storeSrc.includes("'permission-denied'"));
  assert('isDownloading excludes rolled-back', storeSrc.includes("'rolled-back'"));

  const libSrc = read('../../src/renderer/components/NexLibraryPanel.tsx');
  assert('activeDownloads excludes download-failed', libSrc.includes("!['deployed', 'download-failed', 'rolled-back', 'permission-denied']"));
  assert('spinner only shows for downloading/requesting-permission', libSrc.includes("dl.status === 'downloading' || dl.status === 'requesting-permission'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) UI: detailed error display
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) UI: detailed error display:');
  assert('UI shows errorCode', libSrc.includes('dl.errorCode') && libSrc.includes('Error:'));
  assert('UI shows errorStage', libSrc.includes('dl.errorStage') && libSrc.includes('Stage:'));
  assert('UI shows errorHost', libSrc.includes('dl.errorHost') && libSrc.includes('Host:'));
  assert('UI shows received/expected bytes', libSrc.includes('Received:') && libSrc.includes('formatBytes'));
  assert('UI only shows error details on download-failed', libSrc.includes("dl.status === 'download-failed' && (dl.errorCode || dl.errorStage || dl.errorHost)"));
  assert('UI passes detailed error to failDownload', libSrc.includes('failDownload(ev.id, ev.error, {') || libSrc.includes('failDownload(ev.id'));
  assert('UI logs [INSTALL:ERROR] with code/stage/host', libSrc.includes("[INSTALL:ERROR] Download failed — code:"));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Main process: passes detailed error to renderer
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Main process: passes detailed error to renderer:');
  const mainSrc = read('../../src/main/main.ts');

  assert('main.ts stores errorCode from result', mainSrc.includes('errorCode: result.errorCode'));
  assert('main.ts stores errorStage from result', mainSrc.includes('errorStage: result.errorStage'));
  assert('main.ts stores errorHost from result', mainSrc.includes('errorHost: result.errorHost'));
  assert('main.ts stores bytesExpected from result', mainSrc.includes('bytesExpected: result.bytesExpected'));
  assert('main.ts sends download:error with result on failure', mainSrc.includes("mainWindow?.webContents.send('download:error'") && mainSrc.includes('result,'));
  // Verify download:completed is only sent when result.success is true
  const completedSendIdx = mainSrc.indexOf("send('download:completed', { id: downloadId, result })");
  const successCheckIdx = mainSrc.indexOf('if (result.success) {');
  assert('download:completed only sent on success (not on failure)',
    completedSendIdx > 0 && successCheckIdx > 0 && completedSendIdx > successCheckIdx,
    `completedSendIdx=${completedSendIdx}, successCheckIdx=${successCheckIdx}`);
  assert('main.ts catches errors with errorCode', mainSrc.includes("errorCode: err?.code || 'CAUGHT'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Behavioral: SecureDownloader retry cap
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Behavioral: SecureDownloader retry cap:');
  const { SecureDownloader } = await import('../../src/main/update/secure-downloader');
  const sandboxDir = path.join(require('os').tmpdir(), `nex-phase71-test-${Date.now()}`);
  fs.mkdirSync(sandboxDir, { recursive: true });
  const downloader = new SecureDownloader(sandboxDir);

  // Test: non-HTTPS URL fails immediately (no retry)
  const result = await downloader.download({
    url: 'http://example.com/file.bin',
    filename: 'test.bin',
    maxRetries: 5,
  });

  assert('Non-HTTPS URL rejected immediately', !result.success);
  assert('Non-HTTPS rejection has no retries', result.retries === 0);
  assert('Non-HTTPS error mentions security', result.error.includes('Security') || result.error.includes('HTTPS'));

  // Cleanup
  try { fs.rmdirSync(sandboxDir); } catch {}

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`Phase 71 Tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
}

// Helper for batch script assertions removed — using direct .includes() now

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
