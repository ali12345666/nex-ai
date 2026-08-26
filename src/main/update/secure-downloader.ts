/**
 * NEX AI — Secure Downloader (Phase 66 rewrite)
 *
 * Complete rewrite to fix ECONNRESET and all download issues.
 *
 * Key improvements over previous version:
 *   1. Uses https.request() with full options object (headers set BEFORE request)
 *   2. Proper redirect following with new request options per redirect
 *   3. Idle timeout (resets on every data chunk)
 *   4. Automatic retry with exponential backoff for transient errors
 *   5. Resume via HTTP Range header (correctly set in request options)
 *   6. SHA-256 hash computed correctly on resume (hashes existing + new bytes)
 *   7. User-Agent header (required by HuggingFace CDN)
 *   8. Accept-Encoding: identity (prevents compression breaking byte offsets)
 *   9. Handles 200, 206, 416 status codes correctly
 *  10. Error classification with Persian user messages
 *  11. Abort/cancel support
 *  12. Progress reporting (bytes, speed, ETA)
 *
 * CRITICAL SECURITY:
 *   - HTTPS ONLY (HTTP URLs rejected)
 *   - TLS verification NEVER disabled
 *   - Sandbox destination (never writes to target directly)
 *   - This module does NOT decide whether to download — only executes
 *     AFTER PermissionGate has approved.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as crypto from 'crypto';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DownloadProgress {
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  speedBytesPerSec: number;
  etaSeconds: number;
}

export interface DownloadResult {
  success: boolean;
  sandboxPath?: string;
  hash: string;
  bytesDownloaded: number;
  durationMs: number;
  error?: string;
  resumed: boolean;
  retries: number;
}

export interface DownloadOptions {
  url: string;
  expectedSize?: number;
  onProgress?: (progress: DownloadProgress) => void;
  shouldAbort?: () => boolean;
  timeoutMs?: number;
  sandboxDir?: string;
  filename?: string;
  maxRetries?: number;
}

// ─── Error Classification ─────────────────────────────────────────────────

const TRANSIENT_ERRORS = [
  'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH',
  'ENETUNREACH', 'EAI_AGAIN', 'ECONNABORTED', 'UND_ERR_SOCKET',
];

function isTransientError(err: any): boolean {
  const code = err?.code || err?.message || '';
  return TRANSIENT_ERRORS.some(e => code.includes(e));
}

export interface DownloadErrorInfo {
  code: string;
  message: string;
  isTransient: boolean;
  canResume: boolean;
  classification: 'network-interrupted' | 'timeout' | 'tls' | 'http' | 'permission' | 'disk' | 'unknown';
  userMessage: string;
  userMessageFa: string;
}

export function classifyDownloadError(err: any, hasPartialFile: boolean): DownloadErrorInfo {
  const code = err?.code || '';
  const message = err?.message || String(err);
  const isInterrupt = TRANSIENT_ERRORS.slice(0, 4).some(e => (code || message).includes(e));

  if (isInterrupt) {
    return { code, message, isTransient: true, canResume: hasPartialFile,
      classification: 'network-interrupted',
      userMessage: 'Network connection interrupted. The download can be resumed.',
      userMessageFa: 'اتصال شبکه قطع شد. دانلود قابل ازسراری است.' };
  }
  if (code.includes('ETIMEDOUT') || message.includes('timed out') || message.includes('Idle timeout')) {
    return { code, message, isTransient: true, canResume: hasPartialFile,
      classification: 'timeout',
      userMessage: 'Download timed out (no data received). Retry or resume available.',
      userMessageFa: 'دانلود زمان‌سوت شد. تلاش مجدد یا ازسراری در دسترس است.' };
  }
  if (code.includes('CERT') || code.includes('TLS') || code.includes('SSL')) {
    return { code, message, isTransient: false, canResume: false,
      classification: 'tls',
      userMessage: 'TLS/SSL certificate error. Check your system certificates.',
      userMessageFa: 'خطای گواهی TLS/SSL. گواهی‌های سیستم را بررسی کنید.' };
  }
  if (code.includes('EACCES') || code.includes('EPERM')) {
    return { code, message, isTransient: false, canResume: false,
      classification: 'permission',
      userMessage: 'Permission denied. Check file/directory permissions.',
      userMessageFa: 'اجازه دسترسی داده نشد. مجوز فایل/دایرکتوری را بررسی کنید.' };
  }
  if (code.includes('ENOSPC') || code.includes('disk')) {
    return { code, message, isTransient: false, canResume: false,
      classification: 'disk',
      userMessage: 'Not enough disk space.',
      userMessageFa: 'فضای دیسک کافی نیست.' };
  }
  return { code: code || 'UNKNOWN', message, isTransient: isTransientError(err),
    canResume: hasPartialFile, classification: 'unknown',
    userMessage: `Download failed: ${message}`,
    userMessageFa: `دانلود ناموفق: ${message}` };
}

// ─── Secure Downloader ─────────────────────────────────────────────────────

export class SecureDownloader {
  private sandboxDir: string;

  constructor(sandboxDir?: string) {
    this.sandboxDir = sandboxDir || path.join(os.tmpdir(), 'nex-update-sandbox');
    if (!fs.existsSync(this.sandboxDir)) {
      fs.mkdirSync(this.sandboxDir, { recursive: true });
    }
  }

  get sandboxPath(): string { return this.sandboxDir; }

  cleanSandbox(): void {
    try {
      for (const f of fs.readdirSync(this.sandboxDir)) {
        try { fs.unlinkSync(path.join(this.sandboxDir, f)); } catch { /* */ }
      }
    } catch { /* */ }
  }

  /**
   * Download a file securely to the sandbox.
   * HTTPS only. Resume support. Automatic retry on transient errors.
   */
  async download(opts: DownloadOptions): Promise<DownloadResult> {
    const startMs = Date.now();
    const maxRetries = opts.maxRetries ?? 3;
    const idleTimeoutMs = opts.timeoutMs ?? 60_000;

    if (!opts.url.startsWith('https://')) {
      return { success: false, hash: '', bytesDownloaded: 0, durationMs: Date.now() - startMs,
        error: `Security: only HTTPS URLs are allowed (rejected: ${opts.url.split(':')[0]})`, resumed: false, retries: 0 };
    }

    const filename = opts.filename || this.deriveFilename(opts.url);
    const sandboxPath = path.join(this.sandboxDir, filename);

    let lastError: any = null;
    let retries = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (opts.shouldAbort?.()) {
        return { success: false, hash: '', bytesDownloaded: this.getPartialSize(sandboxPath),
          durationMs: Date.now() - startMs, error: 'Download aborted by user',
          resumed: this.getPartialSize(sandboxPath) > 0, retries: attempt };
      }

      const existingBytes = this.getPartialSize(sandboxPath);

      try {
        const result = await this.attemptDownload(opts.url, sandboxPath, existingBytes, opts, startMs, idleTimeoutMs);

        if (result.success) {
          return { ...result, resumed: existingBytes > 0, retries: attempt };
        }

        lastError = result.error;
        const errInfo = classifyDownloadError({ message: result.error }, this.getPartialSize(sandboxPath) > 0);
        if (!errInfo.isTransient) {
          return { ...result, resumed: this.getPartialSize(sandboxPath) > 0, retries: attempt };
        }

        if (attempt < maxRetries) {
          const waitMs = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.log(`[NEX SecureDownloader] Attempt ${attempt + 1} failed: ${result.error}. Retrying in ${waitMs}ms...`);
          await new Promise(r => setTimeout(r, waitMs));
          retries = attempt + 1;
        }
      } catch (err: any) {
        lastError = err;
        if (isTransientError(err) && attempt < maxRetries) {
          const waitMs = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.log(`[NEX SecureDownloader] Attempt ${attempt + 1} threw: ${err.message}. Retrying in ${waitMs}ms...`);
          await new Promise(r => setTimeout(r, waitMs));
          retries = attempt + 1;
        } else {
          break;
        }
      }
    }

    const existingBytes = this.getPartialSize(sandboxPath);
    const errInfo = classifyDownloadError(lastError, existingBytes > 0);
    return { success: false, hash: '', bytesDownloaded: existingBytes,
      durationMs: Date.now() - startMs, error: errInfo.userMessageFa,
      resumed: existingBytes > 0, retries };
  }

  /**
   * Single download attempt. Handles redirects, resume, idle timeout, streaming.
   */
  private attemptDownload(
    url: string, destPath: string, existingBytes: number,
    opts: DownloadOptions, startMs: number, idleTimeoutMs: number,
  ): Promise<DownloadResult> {
    return new Promise((resolve) => {
      const urlObj = new URL(url);

      // Build headers — ALL set BEFORE the request is made
      const headers: Record<string, string> = {
        'User-Agent': 'NEX-AI/1.0 (local-ai-assistant; +https://github.com/ali12345666/nex-ai)',
        'Accept': 'application/octet-stream, */*',
        'Accept-Encoding': 'identity', // no compression — exact byte offsets for resume
        'Connection': 'keep-alive',
      };
      if (existingBytes > 0) {
        headers['Range'] = `bytes=${existingBytes}-`;
      }

      const requestOpts: https.RequestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers,
      };

      console.log('[HTTP_REQUEST] →', requestOpts.method, 'https://' + requestOpts.hostname + ':' + (requestOpts.port || 443) + requestOpts.path);
      console.log('[HTTP_REQUEST] Headers:', JSON.stringify(headers));
      console.log('[HTTP_REQUEST] Dest:', destPath, '— existingBytes:', existingBytes);

      let bytesDownloaded = existingBytes;
      let totalBytes = opts.expectedSize || 0;
      let lastProgressMs = Date.now();
      let lastProgressBytes = bytesDownloaded;
      let settled = false;
      let idleTimer: NodeJS.Timeout | null = null;
      let writeStream: fs.WriteStream | null = null;
      let needFullHash = false; // true if server sends 200 despite Range request

      // Hash: if resuming (existingBytes > 0), we'll hash the existing file
      // first, then continue with new bytes. If server ignores Range (200),
      // we set needFullHash=true and hash the whole file at the end.
      const hash = crypto.createHash('sha256');
      let hashInitialized = false;

      const initHashForResume = () => {
        if (existingBytes > 0 && !hashInitialized && fs.existsSync(destPath)) {
          hashInitialized = true;
          const data = fs.readFileSync(destPath);
          hash.update(data);
        }
      };

      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (!settled) {
            settled = true;
            requestRef?.destroy();
            try { writeStream?.close(); } catch { /* */ }
            resolve({
              success: false, hash: '', bytesDownloaded,
              durationMs: Date.now() - startMs,
              error: `Idle timeout: no data received for ${idleTimeoutMs}ms`,
              resumed: existingBytes > 0, retries: 0,
            });
          }
        }, idleTimeoutMs);
      };

      let requestRef: any = null;

      // Initialize hash for resume BEFORE opening write stream
      initHashForResume();

      // Open write stream (append if resuming, write if fresh)
      const writeFlags = existingBytes > 0 ? 'a' : 'w';
      writeStream = fs.createWriteStream(destPath, { flags: writeFlags });

      requestRef = https.request(requestOpts, (response) => {
        console.log('[HTTP_REQUEST] ← Response status:', response.statusCode, response.statusMessage);
        console.log('[HTTP_REQUEST] ← Response headers:', JSON.stringify({
          'content-length': response.headers['content-length'],
          'content-range': response.headers['content-range'],
          'content-type': response.headers['content-type'],
          'location': response.headers['location'] ? '(redirect)' : undefined,
        }));

        // ── Handle redirects (3xx) ──
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          console.log('[HTTP_REQUEST] Redirect →', response.headers.location);
          response.resume();
          try { writeStream?.close(); } catch { /* */ }
          if (idleTimer) clearTimeout(idleTimer);

          let redirectUrl = response.headers.location;
          if (redirectUrl.startsWith('/')) {
            redirectUrl = `https://${urlObj.hostname}${redirectUrl}`;
          } else if (!redirectUrl.startsWith('https://')) {
            redirectUrl = new URL(redirectUrl, url).href;
          }
          console.log('[HTTP_REQUEST] Following redirect to:', redirectUrl);

          const currentBytes = this.getPartialSize(destPath);
          this.attemptDownload(redirectUrl, destPath, currentBytes, opts, startMs, idleTimeoutMs).then(resolve);
          return;
        }

        // ── Handle 416 (Range Not Satisfiable — file already complete) ──
        if (response.statusCode === 416) {
          response.resume();
          try { writeStream?.close(); } catch { /* */ }
          if (idleTimer) clearTimeout(idleTimer);
          const fileBuf = fs.readFileSync(destPath);
          const finalHash = crypto.createHash('sha256').update(fileBuf).digest('hex');
          settled = true;
          resolve({ success: true, sandboxPath: destPath, hash: finalHash,
            bytesDownloaded: existingBytes, durationMs: Date.now() - startMs, resumed: true, retries: 0 });
          return;
        }

        // ── Handle non-200/206 ──
        if (response.statusCode !== 200 && response.statusCode !== 206) {
          response.resume();
          try { writeStream?.close(); } catch { /* */ }
          if (idleTimer) clearTimeout(idleTimer);
          settled = true;
          resolve({ success: false, hash: '', bytesDownloaded,
            durationMs: Date.now() - startMs, error: `HTTP ${response.statusCode}: ${response.statusMessage}`,
            resumed: existingBytes > 0, retries: 0 });
          return;
        }

        // ── Handle 200 when we expected 206 (server ignored Range) ──
        if (response.statusCode === 200 && existingBytes > 0) {
          // Server sent full file — restart from scratch
          try { writeStream?.close(); } catch { /* */ }
          writeStream = fs.createWriteStream(destPath, { flags: 'w' });
          bytesDownloaded = 0;
          needFullHash = true; // hash the whole file at the end
        }

        // ── Get total size ──
        const contentRange = response.headers['content-range'];
        if (contentRange) {
          const match = contentRange.match(/\/(\d+)/);
          if (match) totalBytes = parseInt(match[1], 10);
        } else if (response.headers['content-length']) {
          const cl = parseInt(response.headers['content-length'], 10);
          totalBytes = (response.statusCode === 206) ? existingBytes + cl : cl;
        }

        resetIdleTimer();

        // ── Stream data to file + hash + progress ──
        response.on('data', (chunk: Buffer) => {
          if (opts.shouldAbort?.()) {
            try { writeStream?.close(); } catch { /* */ }
            if (idleTimer) clearTimeout(idleTimer);
            requestRef?.destroy();
            if (!settled) {
              settled = true;
              resolve({ success: false, hash: '', bytesDownloaded,
                durationMs: Date.now() - startMs, error: 'Download aborted by user',
                resumed: existingBytes > 0, retries: 0 });
            }
            return;
          }

          resetIdleTimer();
          writeStream?.write(chunk);

          // Update hash (only with new bytes if resuming via 206)
          if (!needFullHash) {
            hash.update(chunk);
          }

          bytesDownloaded += chunk.length;

          // Progress (throttled to ~500ms)
          const now = Date.now();
          if (opts.onProgress && now - lastProgressMs >= 500) {
            const elapsed = (now - lastProgressMs) / 1000;
            const bytesInInterval = bytesDownloaded - lastProgressBytes;
            const speed = elapsed > 0 ? bytesInInterval / elapsed : 0;
            const remaining = totalBytes > 0 ? totalBytes - bytesDownloaded : 0;
            opts.onProgress({
              bytesDownloaded, totalBytes,
              percent: totalBytes > 0 ? (bytesDownloaded / totalBytes) * 100 : -1,
              speedBytesPerSec: speed,
              etaSeconds: speed > 0 ? remaining / speed : -1,
            });
            lastProgressMs = now;
            lastProgressBytes = bytesDownloaded;
          }
        });

        response.on('end', () => {
          if (idleTimer) clearTimeout(idleTimer);
          if (settled) return;

          writeStream?.end(() => {
            if (settled) return;
            settled = true;

            let finalHash: string;
            if (needFullHash) {
              // Server sent 200 — hash the entire file
              const fileBuf = fs.readFileSync(destPath);
              finalHash = crypto.createHash('sha256').update(fileBuf).digest('hex');
            } else {
              finalHash = hash.digest('hex');
            }

            resolve({ success: true, sandboxPath: destPath, hash: finalHash,
              bytesDownloaded, durationMs: Date.now() - startMs,
              resumed: existingBytes > 0 && !needFullHash, retries: 0 });
          });
        });

        response.on('error', (err: Error) => {
          if (idleTimer) clearTimeout(idleTimer);
          try { writeStream?.close(); } catch { /* */ }
          if (!settled) {
            settled = true;
            resolve({ success: false, hash: '', bytesDownloaded,
              durationMs: Date.now() - startMs, error: err.message,
              resumed: existingBytes > 0, retries: 0 });
          }
        });
      });

      requestRef.on('error', (err: Error) => {
        if (idleTimer) clearTimeout(idleTimer);
        try { writeStream?.close(); } catch { /* */ }
        if (!settled) {
          settled = true;
          resolve({ success: false, hash: '', bytesDownloaded,
            durationMs: Date.now() - startMs, error: err.message,
            resumed: existingBytes > 0, retries: 0 });
        }
      });

      requestRef.end();
    });
  }

  private getPartialSize(filePath: string): number {
    try {
      if (fs.existsSync(filePath)) return fs.statSync(filePath).size;
    } catch { /* */ }
    return 0;
  }

  private deriveFilename(url: string): string {
    try {
      const urlObj = new URL(url);
      const basename = path.basename(urlObj.pathname);
      if (basename && basename.length > 0) return basename;
    } catch { /* */ }
    return `nex-download-${Date.now()}.bin`;
  }
}
