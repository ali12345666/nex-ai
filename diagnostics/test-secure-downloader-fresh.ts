/**
 * NEX AI — Phase 71 SecureDownloader Fresh Download Diagnostic
 * =============================================================
 *
 * Tests the SecureDownloader with a FRESH download (no .part file,
 * no Range header, no resume). This isolates whether the Range/resume
 * logic is the root cause of download failures.
 *
 * Run: npx tsx diagnostics/test-secure-downloader-fresh.ts
 */
import '../tests/__mocks__/install-electron-mock.js';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const MODEL_URL = 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf';
const TARGET_BYTES = 5 * 1024 * 1024;  // 5 MB

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Phase 71 — SecureDownloader Fresh Download Diagnostic');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const { SecureDownloader } = await import('../src/main/update/secure-downloader');

  // Fresh sandbox — no existing .part file
  const sandboxDir = path.join(os.tmpdir(), `nex-phase71-fresh-${Date.now()}`);
  fs.mkdirSync(sandboxDir, { recursive: true });
  const downloader = new SecureDownloader(sandboxDir);

  console.log(`URL:         ${MODEL_URL}`);
  console.log(`Sandbox:     ${sandboxDir}`);
  console.log(`Target:      ${TARGET_BYTES} bytes (5 MB)`);
  console.log(`Max retries: 5`);
  console.log('');

  // Verify no .part file exists (fresh)
  const destPath = path.join(sandboxDir, 'qwen2.5-0.5b-instruct-q4_k_m.gguf');
  console.log(`Pre-download check:`);
  console.log(`  .part exists: ${fs.existsSync(destPath)}`);
  console.log('');

  let abortRequested = false;
  let progressCount = 0;
  const startMs = Date.now();

  const result = await downloader.download({
    url: MODEL_URL,
    filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    onProgress: (p) => {
      progressCount++;
      if (p.bytesDownloaded >= TARGET_BYTES && !abortRequested) {
        abortRequested = true;
        console.log(`  ✓ Reached ${p.bytesDownloaded} bytes — aborting (target met)`);
      }
    },
    shouldAbort: () => abortRequested,
    timeoutMs: 60_000,
    maxRetries: 5,
  });

  const duration = Date.now() - startMs;

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('RESULT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  success:          ${result.success}`);
  console.log(`  bytesDownloaded:  ${result.bytesDownloaded}`);
  console.log(`  hash:             ${result.hash ? result.hash.slice(0, 16) + '...' : '(none)'}`);
  console.log(`  error:            ${result.error || '(none)'}`);
  console.log(`  duration:         ${duration}ms`);
  console.log(`  retries:          ${result.retries}`);
  console.log(`  resumed:          ${result.resumed}`);
  console.log(`  progress events:  ${progressCount}`);

  // Check file
  if (fs.existsSync(destPath)) {
    const stat = fs.statSync(destPath);
    console.log(`  File on disk:     ${destPath}`);
    console.log(`  File size:        ${stat.size} bytes`);
    const fd = fs.openSync(destPath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const magic = buf.toString('ascii');
    console.log(`  GGUF magic:       ${magic === 'GGUF' ? '✓ VALID' : `✗ INVALID ("${magic}")`}`);
  } else {
    console.log(`  File on disk:     (not created)`);
  }

  const passed = result.bytesDownloaded >= TARGET_BYTES;
  console.log('');
  console.log(`  Fresh SecureDownloader: ${passed ? 'PASS' : 'FAIL'}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Cleanup
  try { fs.unlinkSync(destPath); } catch {}
  try { fs.rmdirSync(sandboxDir); } catch {}

  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
