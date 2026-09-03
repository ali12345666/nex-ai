#!/usr/bin/env node
/**
 * NEX AI — Phase 71 Independent Node HTTPS Diagnostic
 * =====================================================
 *
 * THIS IS A STANDALONE SCRIPT. It does NOT use:
 *   - React
 *   - Zustand
 *   - Electron IPC
 *   - DeploymentManager
 *   - PermissionGate
 *   - SecureDownloader
 *
 * It uses ONLY Node's built-in `https` module to download the Qwen 0.5B
 * GGUF model from HuggingFace. This isolates whether the problem is in
 * the network/Node layer or in NEX AI's download architecture.
 *
 * USAGE (on Windows, from the project root):
 *
 *   node diagnostics\test-node-https.js
 *
 * Or:
 *
 *   npx tsx diagnostics\test-node-https.ts
 *
 * OUTPUT:
 *   - Real-time progress (every 500ms)
 *   - Final result: PASS / FAIL
 *   - If FAIL: error code, message, bytes received, host
 *
 * The script downloads the first 5MB then stops (to keep it fast).
 * Change TARGET_BYTES to download more.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');

// ─── Configuration ──────────────────────────────────────────────────────────

const MODEL_URL = 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf';
const TARGET_BYTES = 5 * 1024 * 1024;  // 5 MB (then stop)
const DEST_DIR = path.join(os.tmpdir(), 'nex-diagnostic');
const DEST_FILE = path.join(DEST_DIR, 'qwen-diagnostic.gguf');
const CONNECT_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 60_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 23);  // HH:MM:SS.mmm
  console.log(`[${ts}] [${tag}] ${msg}`);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('NEX AI — Phase 71 Independent Node HTTPS Diagnostic');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ── Environment info ──
  console.log('Environment:');
  console.log(`  Node version:    ${process.version}`);
  console.log(`  Platform:        ${process.platform} ${process.arch}`);
  console.log(`  OS release:      ${os.release()}`);
  console.log(`  Hostname:        ${os.hostname()}`);
  console.log(`  TMP dir:         ${os.tmpdir()}`);
  console.log('');

  console.log('Proxy environment:');
  console.log(`  HTTP_PROXY=      ${process.env.HTTP_PROXY || process.env.http_proxy || '(not set)'}`);
  console.log(`  HTTPS_PROXY=     ${process.env.HTTPS_PROXY || process.env.https_proxy || '(not set)'}`);
  console.log(`  ALL_PROXY=       ${process.env.ALL_PROXY || process.env.all_proxy || '(not set)'}`);
  console.log(`  NO_PROXY=        ${process.env.NO_PROXY || process.env.no_proxy || '(not set)'}`);
  console.log('');

  console.log('Target:');
  console.log(`  URL:             ${MODEL_URL}`);
  console.log(`  Target bytes:    ${formatBytes(TARGET_BYTES)}`);
  console.log(`  Dest file:       ${DEST_FILE}`);
  console.log('');

  // ── DNS resolution test ──
  console.log('DNS resolution:');
  const dns = require('dns').promises;
  try {
    const hfAddrs = await dns.resolve4('huggingface.co');
    console.log(`  huggingface.co → ${hfAddrs.join(', ')}`);
  } catch (e) {
    console.log(`  huggingface.co → DNS FAILED: ${e.message}`);
  }
  console.log('');

  // ── Prepare destination ──
  if (!fs.existsSync(DEST_DIR)) fs.mkdirSync(DEST_DIR, { recursive: true });
  // Delete any existing file (fresh download)
  if (fs.existsSync(DEST_FILE)) {
    fs.unlinkSync(DEST_FILE);
    log('SETUP', 'Deleted existing file (fresh download)');
  }

  return new Promise((resolve) => {
    const startTime = Date.now();
    let bytesReceived = 0;
    let totalBytes = 0;
    let expectedContentLength = 0;
    let finalHost = '';
    let redirectChain = [];
    let lastProgressMs = Date.now();
    let lastProgressBytes = 0;
    let settled = false;
    let idleTimer = null;
    let writeStream = null;
    let attemptCount = 0;
    let targetReached = false;  // ← Set when we hit TARGET_BYTES

    const done = (success, error, errorCode) => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      try { writeStream?.close(); } catch {}

      const duration = Date.now() - startTime;
      console.log('');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('RESULT');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log(`  Status:            ${success ? 'PASS' : 'FAIL'}`);
      console.log(`  Bytes received:    ${formatBytes(bytesReceived)} (${bytesReceived} bytes)`);
      console.log(`  Expected total:    ${formatBytes(totalBytes)} (${totalBytes} bytes)`);
      console.log(`  Duration:          ${duration}ms`);
      console.log(`  Avg speed:         ${duration > 0 ? formatBytes((bytesReceived / duration) * 1000) + '/s' : 'N/A'}`);
      console.log(`  Final host:        ${finalHost}`);
      console.log(`  Redirect chain:    ${redirectChain.length > 0 ? redirectChain.join(' → ') : '(none)'}`);
      console.log(`  HTTP attempts:     ${attemptCount}`);
      if (!success) {
        console.log(`  Error code:        ${errorCode || 'N/A'}`);
        console.log(`  Error message:     ${error || 'N/A'}`);
      }

      // Check file on disk
      if (fs.existsSync(DEST_FILE)) {
        const stat = fs.statSync(DEST_FILE);
        console.log(`  File on disk:      ${DEST_FILE}`);
        console.log(`  File size:         ${formatBytes(stat.size)} (${stat.size} bytes)`);

        // Check GGUF magic bytes
        const fd = fs.openSync(DEST_FILE, 'r');
        const buf = Buffer.alloc(4);
        fs.readSync(fd, buf, 0, 4, 0);
        fs.closeSync(fd);
        const magic = buf.toString('ascii');
        console.log(`  GGUF magic bytes:  ${magic === 'GGUF' ? '✓ VALID (GGUF)' : `✗ INVALID ("${magic}")`}`);
      } else {
        console.log(`  File on disk:      (not created)`);
      }
      console.log('═══════════════════════════════════════════════════════════════\n');

      process.exit(success ? 0 : 1);
    };

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        done(false, `Idle timeout: no data for ${IDLE_TIMEOUT_MS}ms`, 'IDLE_TIMEOUT');
      }, IDLE_TIMEOUT_MS);
    };

    const makeRequest = (url) => {
      attemptCount++;
      const urlObj = new URL(url);
      finalHost = urlObj.hostname;
      log(`ATTEMPT ${attemptCount}`, `GET https://${urlObj.hostname}${urlObj.pathname}${urlObj.search.length > 50 ? urlObj.search.slice(0, 50) + '...' : urlObj.search}`);

      const headers = {
        'User-Agent': 'NEX-AI-Diagnostic/1.0',
        'Accept': 'application/octet-stream, */*',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive',
      };

      const req = https.request({
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers,
        timeout: CONNECT_TIMEOUT_MS,
      }, (response) => {
        log('RESPONSE', `status=${response.statusCode} ${response.statusMessage}`);
        log('HEADERS', `content-length=${response.headers['content-length'] || '?'}, content-type=${response.headers['content-type'] || '?'}, location=${response.headers.location ? '(redirect)' : '(none)'}`);

        // ── Handle redirect (3xx) ──
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          let redirectUrl = response.headers.location;
          redirectChain.push(urlObj.hostname);
          log('REDIRECT', `from=${urlObj.hostname} to=${redirectUrl.slice(0, 80)}...`);

          response.resume();
          if (idleTimer) clearTimeout(idleTimer);

          if (redirectUrl.startsWith('/')) {
            redirectUrl = `https://${urlObj.hostname}${redirectUrl}`;
          } else if (!redirectUrl.startsWith('https://')) {
            redirectUrl = new URL(redirectUrl, url).href;
          }
          log('REDIRECT', `following to: ${redirectUrl.slice(0, 100)}...`);
          makeRequest(redirectUrl);
          return;
        }

        // ── Handle non-200 ──
        if (response.statusCode !== 200 && response.statusCode !== 206) {
          done(false, `HTTP ${response.statusCode}: ${response.statusMessage}`, `HTTP_${response.statusCode}`);
          return;
        }

        // ── Get total size ──
        if (response.headers['content-length']) {
          expectedContentLength = parseInt(response.headers['content-length'], 10);
          totalBytes = expectedContentLength;
          log('STREAM', `totalBytes=${formatBytes(totalBytes)} (${totalBytes} bytes)`);
        }

        // ── Open write stream (fresh — 'w' not 'a') ──
        writeStream = fs.createWriteStream(DEST_FILE, { flags: 'w' });
        writeStream.on('error', (err) => {
          done(false, `Write error: ${err.message}`, 'WRITE_ERROR');
        });

        resetIdleTimer();

        // ── Handle response aborted ──
        response.on('aborted', () => {
          if (targetReached) return;  // Expected — we triggered the abort
          done(false, 'socket hang up (response aborted)', 'ECONNRESET');
        });

        // ── Stream data ──
        response.on('data', (chunk) => {
          resetIdleTimer();

          const ok = writeStream.write(chunk);
          if (!ok) {
            response.pause();
            writeStream.once('drain', () => response.resume());
          }

          bytesReceived += chunk.length;

          // Progress (every 500ms)
          const now = Date.now();
          if (now - lastProgressMs >= 500) {
            const elapsed = (now - lastProgressMs) / 1000;
            const bytesInInterval = bytesReceived - lastProgressBytes;
            const speed = elapsed > 0 ? bytesInInterval / elapsed : 0;
            const pct = totalBytes > 0 ? (bytesReceived / totalBytes) * 100 : 0;
            log('PROGRESS', `${pct.toFixed(2)}% — ${formatBytes(bytesReceived)} / ${formatBytes(totalBytes)} — ${formatBytes(speed)}/s`);
            lastProgressMs = now;
            lastProgressBytes = bytesReceived;
          }

          // Stop after TARGET_BYTES (diagnostic only — proves pipeline works)
          if (bytesReceived >= TARGET_BYTES) {
            targetReached = true;  // ← Mark before destroying
            log('TARGET', `Reached ${formatBytes(bytesReceived)} (target: ${formatBytes(TARGET_BYTES)}) — stopping`);
            response.destroy();
            writeStream.end(() => {
              done(true, null, null);
            });
          }
        });

        response.on('end', () => {
          if (idleTimer) clearTimeout(idleTimer);
          if (settled) return;
          log('END', `stream ended — bytesReceived=${formatBytes(bytesReceived)}`);
          writeStream.end(() => {
            done(bytesReceived > 0, null, null);
          });
        });

        response.on('error', (err) => {
          done(false, `Response error: ${err.message}`, err.code || 'RESPONSE_ERROR');
        });

        response.on('close', () => {
          if (targetReached) return;  // Expected
          if (!settled && !writeStream?.destroyed) {
            done(false, 'socket hang up (response closed unexpectedly)', 'ECONNRESET');
          }
        });
      });

      req.on('error', (err) => {
        done(false, `Request error: ${err.message}`, err.code || 'REQUEST_ERROR');
      });

      req.on('timeout', () => {
        log('TIMEOUT', `connection timeout (${CONNECT_TIMEOUT_MS}ms) — destroying`);
        req.destroy();
        done(false, `Connection timeout (${CONNECT_TIMEOUT_MS}ms)`, 'ETIMEDOUT');
      });

      req.end();
    };

    makeRequest(MODEL_URL);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
