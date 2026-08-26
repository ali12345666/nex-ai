/**
 * Phase 72 — ModelScope Alternative Source Test
 *
 * Verifies that SecureDownloader can download from ModelScope (the alternative
 * source when HuggingFace CDN is blocked). Downloads 5MB then aborts.
 */
import '../tests/__mocks__/install-electron-mock.js';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const MODELSCOPE_URL = 'https://modelscope.cn/api/v1/models/Qwen/Qwen2.5-0.5B-Instruct-GGUF/repo?Revision=master&FilePath=qwen2.5-0.5b-instruct-q4_k_m.gguf';
const TARGET_BYTES = 5 * 1024 * 1024;  // 5 MB

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Phase 72 — ModelScope Alternative Source Test');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const { SecureDownloader } = await import('../src/main/update/secure-downloader');
  const sandboxDir = path.join(os.tmpdir(), `nex-phase72-modelscope-${Date.now()}`);
  fs.mkdirSync(sandboxDir, { recursive: true });
  const downloader = new SecureDownloader(sandboxDir);

  console.log(`URL:     ${MODELSCOPE_URL}`);
  console.log(`Target:  ${TARGET_BYTES} bytes (5 MB)\n`);

  let abortRequested = false;
  const startMs = Date.now();

  const result = await downloader.download({
    url: MODELSCOPE_URL,
    filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    onProgress: (p) => {
      if (p.bytesDownloaded >= TARGET_BYTES && !abortRequested) {
        abortRequested = true;
        console.log(`  ✓ Reached ${p.bytesDownloaded} bytes — aborting (target met)`);
      }
    },
    shouldAbort: () => abortRequested,
    timeoutMs: 60_000,
    maxRetries: 3,
  });

  const duration = Date.now() - startMs;
  const destPath = path.join(sandboxDir, 'qwen2.5-0.5b-instruct-q4_k_m.gguf');

  console.log('');
  console.log('RESULT:');
  console.log(`  success:          ${result.success}`);
  console.log(`  bytesDownloaded:  ${result.bytesDownloaded}`);
  console.log(`  duration:         ${duration}ms`);
  console.log(`  retries:          ${result.retries}`);
  console.log(`  error:            ${result.error || '(none)'}`);

  if (fs.existsSync(destPath)) {
    const stat = fs.statSync(destPath);
    const fd = fs.openSync(destPath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const magic = buf.toString('ascii');
    console.log(`  File size:        ${stat.size} bytes`);
    console.log(`  GGUF magic:       ${magic === 'GGUF' ? '✓ VALID' : `✗ INVALID ("${magic}")`}`);
  }

  const passed = result.bytesDownloaded >= TARGET_BYTES;
  console.log('');
  console.log(`  ModelScope download: ${passed ? 'PASS' : 'FAIL'}`);
  console.log('');

  // Cleanup
  try { fs.unlinkSync(destPath); } catch {}
  try { fs.rmdirSync(sandboxDir); } catch {}

  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
