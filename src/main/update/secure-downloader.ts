/**
 * NEX AI — Secure Downloader (Phase 44 / Phase 65 fix)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Secure HTTPS downloader with:
 *   - Resume support (HTTP Range header — CORRECTLY set before request)
 *   - Automatic retry on transient errors (ECONNRESET, ETIMEDOUT, EPIPE)
 *   - Idle timeout (not total timeout — large files on slow connections)
 *   - User-Agent header (required by HuggingFace CDN)
 *   - Redirect handling with header preservation
 *   - Progress reporting (bytes, speed, ETA)
 *   - SHA-256 hash (correctly computed on resume — hashes existing + new bytes)
 *   - Sandbox destination (never writes to target directly)
 *
 * CRITICAL SECURITY:
 *   - HTTPS ONLY (HTTP URLs rejected)
 *   - This module does NOT decide whether to download — it ONLY executes
 *     the download AFTER PermissionGate has approved it.
 *   - TLS verification is NEVER disabled.
 *   - No insecure workarounds.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as crypto from 'crypto';
import { URL } from 'url';

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
  /** Number of retries attempted. */
  retries: number;
}

export interface DownloadOptions {
  url: string;
  expectedSize?: number;
  onProgress?: (progress: DownloadProgress) => void;
  shouldAbort?: () => boolean;
  /** Idle timeout in ms (no data received for this long → timeout). Default 60s. */
  timeoutMs?: number;
  sandboxDir?: string;
  filename?: string;
  /** Max retry attempts for transient errors. Default 3. */
  maxRetries?: number;
}

// ─── Error Classification ─────────────────────────────────────────────────

/** Transient errors that warrant a retry. */
const TRANSIENT_ERRORS = [
  'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH',
  'ENETUNREACH', 'EAI_AGAIN', 'ECONNABORTED', 'UND_ERR_SOCKET',
];

/** Errors that indicate the connection was interrupted mid-download. */
const INTERRUPT_ERRORS = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNABORTED'];

function isTransientError(err: any): boolean {
  const code = err?.code || err?.message || '';
  return TRANSIENT_ERRORS.some(e => code.includes(e));
}

function isInterruptError(err: any): boolean {
  const code = err?.code || err?.message || '';
  return INTERRUPT_ERRORS.some(e => code.includes(e));
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

  if (isInterruptError(err)) {
    return {
      code, message,
      isTransient: true,
      canResume: hasPartialFile,
      classification: 'network-interrupted',
      userMessage: 'Network connection interrupted. The download can be resumed.',
      userMessageFa: 'اتصال شبکه قطع شد. دانلود قابل ازسراری است.',
    };
  }
  if (code.includes('ETIMEDOUT') || message.includes('timed out')) {
    return {
      code, message,
      isTransient: true,
      canResume: hasPartialFile,
      classification: 'timeout',
      userMessage: 'Download timed out (no data received). Retry or resume available.',
      userMessageFa: 'دانلود زمان‌سوت شد. تلاش مجدد یا ازسراری در دسترس است.',
    };
  }
  if (code.includes('CERT') || code.includes('TLS') || code.includes('SSL')) {
    return {
      code, message,
      isTransient: false,
      canResume: false,
      classification: 'tls',
      userMessage: 'TLS/SSL certificate error. Check your system certificates.',
      userMessageFa: 'خطای گواهی TLS/SSL. گواهی‌های سیستم را بررسی کنید.',
    };
  }
  if (code.includes('EACCES') || code.includes('EPERM')) {
    return {
      code, message,
      isTransient: false,
      canResume: false,
      classification: 'permission',
      userMessage: 'Permission denied. Check file/directory permissions.',
      userMessageFa: 'اجازه دسترسی داده نشد. مجوز فایل/دایرکتوری را بررسی کنید.',
    };
  }
  if (code.includes('ENOSPC') || code.includes('disk')) {
    return {
      code, message,
      isTransient: false,
      canResume: false,
      classification: 'disk',
      userMessage: 'Not enough disk space.',
      userMessageFa: 'فضای دیسک کافی نیست.',
    };
  }
  return {
    code: code || 'UNKNOWN',
    message,
    isTransient: isTransientError(err),
    canResume: hasPartialFile,
    classification: 'unknown',
    userMessage: `Download failed: ${message}`,
    userMessageFa: `دانلود ناموفق: ${message}`,
  };
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

  get sandboxPath(): string {
    return this.sandboxDir;
  }

  cleanSandbox(): void {
    try {
      const files = fs.readdirSync(this.sandboxDir);
      for (const f of files) {
        try { fs.unlinkSync(path.join(this.sandboxDir, f)); } catch { /* */ }
      }
    } catch { /* */ }
  }

  /**
   * Download a file securely to the sandbox.
   *
   * Features:
   *   - HTTPS only (HTTP rejected)
   *   - Resume from partial file (HTTP Range header)
   *   - Automatic retry on transient errors (ECONNRESET, ETIMEDOUT, etc.)
   *   - Idle timeout (not total timeout)
   *   - User-Agent header (required by HuggingFace CDN)
   *   - Redirect handling with header preservation
   *   - SHA-256 hash (correctly computed on resume — existing + new bytes)
   *   - Progress reporting
   */
  async download(opts: DownloadOptions): Promise<DownloadResult> {
    const startMs = Date.now();
    const maxRetries = opts.maxRetries ?? 3;
    const idleTimeoutMs = opts.timeoutMs ?? 60_000; // 60s idle timeout (not total)

    // Security: reject HTTP URLs
    if (!opts.url.startsWith('https://')) {
      return {
        success: false, hash: '', bytesDownloaded: 0,
        durationMs: Date.now() - startMs,
        error: `Security: only HTTPS URLs are allowed (rejected: ${opts.url.split(':')[0]})`,
        resumed: false, retries: 0,
      };
    }

    const filename = opts.filename || this.deriveFilename(opts.url);
    const sandboxPath = path.join(this.sandboxDir, filename);

    // Check for partial download (resume support)
    let existingBytes = 0;
    if (fs.existsSync(sandboxPath)) {
      const stat = fs.statSync(sandboxPath);
      existingBytes = stat.size;
    }
    const resumed = existingBytes > 0;

    let lastError: any = null;
    let retries = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (opts.shouldAbort && opts.shouldAbort()) {
        return {
          success: false, hash: '', bytesDownloaded: existingBytes,
          durationMs: Date.now() - startMs,
          error: 'Download aborted by user', resumed, retries: attempt,
        };
      }

      // Re-check partial file size (may have grown from a previous attempt)
      if (fs.existsSync(sandboxPath)) {
        existingBytes = fs.statSync(sandboxPath).size;
      } else {
        existingBytes = 0;
      }

      try {
        const result = await this.performDownload(
          opts.url, sandboxPath, existingBytes, opts, startMs, idleTimeoutMs,
        );

        if (result.success) {
          return { ...result, resumed: resumed || existingBytes > 0, retries: attempt };
        }

        lastError = result.error;

        // If the error is NOT transient, don't retry
        const errInfo = classifyDownloadError({ message: result.error }, existingBytes > 0);
        if (!errInfo.isTransient) {
          return { ...result, resumed: existingBytes > 0, retries: attempt };
        }

        // Transient error — wait and retry
        if (attempt < maxRetries) {
          const waitMs = Math.min(1000 * Math.pow(2, attempt), 10000); // exponential backoff: 1s, 2s, 4s... max 10s
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

    // All retries exhausted
    const errInfo = classifyDownloadError(lastError, existingBytes > 0);
    return {
      success: false,
      hash: '',
      bytesDownloaded: existingBytes,
      durationMs: Date.now() - startMs,
      error: errInfo.userMessageFa,
      resumed: existingBytes > 0,
      retries,
    };
  }

  /**
   * Perform a single HTTPS download attempt with proper headers, redirect,
   * idle timeout, and resume support.
   */
  private performDownload(
    url: string,
    destPath: string,
    existingBytes: number,
    opts: DownloadOptions,
    startMs: number,
    idleTimeoutMs: number,
  ): Promise<DownloadResult> {
    return new Promise((resolve) => {
      let urlObj: URL;
      try {
        urlObj = new URL(url);
      } catch {
        resolve({
          success: false, hash: '', bytesDownloaded: existingBytes,
          durationMs: Date.now() - startMs, error: 'Invalid URL', resumed: existingBytes > 0, retries: 0,
        });
        return;
      }

      // Build request options with proper headers
      const requestOpts: https.RequestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'User-Agent': 'NEX-AI/1.0 (local-ai-assistant; +https://github.com/ali12345666/nex-ai)',
          'Accept': 'application/octet-stream, */*',
          'Accept-Encoding': 'identity', // no compression — we need exact byte offsets for resume
          'Connection': 'keep-alive',
        },
      };

      // Add Range header for resume (CORRECTLY set BEFORE the request is made)
      if (existingBytes > 0) {
        (requestOpts.headers as Record<string, string>)['Range'] = `bytes=${existingBytes}-`;
      }

      // For hash computation on resume: hash existing file first, then continue
      const hash = crypto.createHash('sha256');
      let bytesDownloaded = existingBytes;
      let totalBytes = opts.expectedSize || 0;
      let lastProgressMs = Date.now();
      let lastProgressBytes = bytesDownloaded;
      let speedBytesPerSec = 0;
      let writeStream: fs.WriteStream | null = null;
      let aborted = false;
      let settled = false;

      // If resuming, hash the existing partial file first
      const initHash = async () => {
        if (existingBytes > 0 && fs.existsSync(destPath)) {
          return new Promise<void>((hashResolve) => {
            const readStream = fs.createReadStream(destPath);
            readStream.on('data', (chunk) => hash.update(chunk));
            readStream.on('end', () => hashResolve());
            readStream.on('error', () => hashResolve()); // best-effort
          });
        }
      };

      const setupWriteStream = () => {
        const flags = existingBytes > 0 ? 'a' : 'w';
        writeStream = fs.createWriteStream(destPath, { flags });
      };

      // Idle timeout: reset every time we receive data
      let idleTimer: NodeJS.Timeout | null = null;
      let requestRef: any = null;
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (!settled) {
            settled = true;
            requestRef?.destroy();
            writeStream?.close();
            resolve({
              success: false, hash: '', bytesDownloaded,
              durationMs: Date.now() - startMs,
              error: `Idle timeout: no data received for ${idleTimeoutMs}ms`,
              resumed: existingBytes > 0, retries: 0,
            });
          }
        }, idleTimeoutMs);
      };

      const doRequest = async () => {
        await initHash();
        setupWriteStream();

        const request = https.request(requestOpts, (response) => {
        requestRef = request;
          // Handle redirects (3xx)
          if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            response.resume(); // drain
            writeStream?.close();
            if (idleTimer) clearTimeout(idleTimer);

            // Resolve redirect URL (may be relative)
            let redirectUrl = response.headers.location;
            if (redirectUrl.startsWith('/')) {
              redirectUrl = `https://${urlObj.hostname}${redirectUrl}`;
            } else if (!redirectUrl.startsWith('https://')) {
              redirectUrl = new URL(redirectUrl, url).href;
            }

            // Re-check partial file size
            let currentBytes = 0;
            if (fs.existsSync(destPath)) {
              currentBytes = fs.statSync(destPath).size;
            }

            // Recurse with redirect URL — preserve all opts, headers, resume state
            this.performDownload(redirectUrl, destPath, currentBytes, opts, startMs, idleTimeoutMs)
              .then(resolve);
            return;
          }

          // Handle 416 (Range Not Satisfiable) — file already complete
          if (response.statusCode === 416) {
            response.resume();
            writeStream?.close();
            if (idleTimer) clearTimeout(idleTimer);
            // File is already complete — compute hash of existing file
            const fileBuf = fs.readFileSync(destPath);
            const finalHash = crypto.createHash('sha256').update(fileBuf).digest('hex');
            settled = true;
            resolve({
              success: true,
              sandboxPath: destPath,
              hash: finalHash,
              bytesDownloaded: existingBytes,
              durationMs: Date.now() - startMs,
              resumed: true,
              retries: 0,
            });
            return;
          }

          // Handle 206 (Partial Content) — resume successful
          // Or 200 (OK) — full download (server didn't honor Range)
          if (response.statusCode !== 200 && response.statusCode !== 206) {
            response.resume();
            writeStream?.close();
            if (idleTimer) clearTimeout(idleTimer);
            settled = true;
            resolve({
              success: false, hash: '', bytesDownloaded,
              durationMs: Date.now() - startMs,
              error: `HTTP ${response.statusCode}: ${response.statusMessage}`,
              resumed: existingBytes > 0, retries: 0,
            });
            return;
          }

          // If server sent 200 (ignored Range), we need to start fresh
          if (response.statusCode === 200 && existingBytes > 0) {
            // Close old stream, open new one in write mode
            writeStream?.close();
            writeStream = fs.createWriteStream(destPath, { flags: 'w' });
            bytesDownloaded = 0;
            // Re-init hash (fresh)
            hash.removeAllListeners();
            // Can't reuse the hash object — create a new one
            // Actually we need a fresh hash — let's handle this differently
            // Since hash was already updated with existing file, we need to redo
            // The simplest approach: re-read the entire file at the end for hash
          }

          // Get total size from Content-Length or Content-Range
          const contentRange = response.headers['content-range'];
          if (contentRange) {
            // Format: "bytes 0-499/1234" or "bytes 500-999/1234"
            const match = contentRange.match(/\/(\d+)/);
            if (match) {
              totalBytes = parseInt(match[1], 10);
            }
          } else if (response.headers['content-length']) {
            const cl = parseInt(response.headers['content-length'], 10);
            totalBytes = (response.statusCode === 206) ? existingBytes + cl : cl;
          }

          resetIdleTimer();

          // Pipe response to file + update hash
          response.on('data', (chunk: Buffer) => {
            if (opts.shouldAbort && opts.shouldAbort()) {
              aborted = true;
              request.destroy();
              writeStream?.close();
              if (idleTimer) clearTimeout(idleTimer);
              if (!settled) {
                settled = true;
                resolve({
                  success: false, hash: '', bytesDownloaded,
                  durationMs: Date.now() - startMs,
                  error: 'Download aborted by user',
                  resumed: existingBytes > 0, retries: 0,
                });
              }
              return;
            }

            resetIdleTimer();
            writeStream?.write(chunk);

            // Only update hash with new bytes (existing bytes were hashed in initHash)
            // But if server sent 200 (ignored Range), we're starting fresh
            if (response.statusCode === 206 || existingBytes === 0) {
              hash.update(chunk);
            }
            // For 200 with existingBytes > 0, we'll hash the whole file at the end

            bytesDownloaded += chunk.length;

            // Progress reporting (throttled to ~500ms)
            const now = Date.now();
            if (opts.onProgress && now - lastProgressMs >= 500) {
              const elapsed = (now - lastProgressMs) / 1000;
              const bytesInInterval = bytesDownloaded - lastProgressBytes;
              speedBytesPerSec = elapsed > 0 ? bytesInInterval / elapsed : 0;
              const remaining = totalBytes > 0 ? totalBytes - bytesDownloaded : 0;
              const etaSeconds = speedBytesPerSec > 0 ? remaining / speedBytesPerSec : -1;

              opts.onProgress({
                bytesDownloaded,
                totalBytes,
                percent: totalBytes > 0 ? (bytesDownloaded / totalBytes) * 100 : -1,
                speedBytesPerSec,
                etaSeconds,
              });

              lastProgressMs = now;
              lastProgressBytes = bytesDownloaded;
            }
          });

          response.on('end', () => {
            if (idleTimer) clearTimeout(idleTimer);
            if (aborted || settled) return;

            writeStream?.end(() => {
              if (settled) return;
              settled = true;

              // Compute final hash
              // If we resumed (206), hash was built incrementally (existing + new)
              // If server sent 200 with existing bytes, hash is incomplete — re-hash whole file
              let finalHash: string;
              if (response.statusCode === 206 || existingBytes === 0) {
                finalHash = hash.digest('hex');
              } else {
                // Server ignored Range — re-hash the entire file
                const fileBuf = fs.readFileSync(destPath);
                finalHash = crypto.createHash('sha256').update(fileBuf).digest('hex');
              }

              resolve({
                success: true,
                sandboxPath: destPath,
                hash: finalHash,
                bytesDownloaded,
                durationMs: Date.now() - startMs,
                resumed: existingBytes > 0,
                retries: 0,
              });
            });
          });

          response.on('error', (err) => {
            if (idleTimer) clearTimeout(idleTimer);
            writeStream?.close();
            if (!settled) {
              settled = true;
              resolve({
                success: false, hash: '', bytesDownloaded,
                durationMs: Date.now() - startMs,
                error: err.message,
                resumed: existingBytes > 0, retries: 0,
              });
            }
          });
        });

        request.on('error', (err) => {
          if (idleTimer) clearTimeout(idleTimer);
          writeStream?.close();
          if (!settled) {
            settled = true;
            resolve({
              success: false, hash: '', bytesDownloaded,
              durationMs: Date.now() - startMs,
              error: err.message,
              resumed: existingBytes > 0, retries: 0,
            });
          }
        });

        request.end();
      };

      doRequest().catch((err) => {
        if (idleTimer) clearTimeout(idleTimer);
        writeStream?.close();
        if (!settled) {
          settled = true;
          resolve({
            success: false, hash: '', bytesDownloaded,
            durationMs: Date.now() - startMs,
            error: err.message,
            resumed: existingBytes > 0, retries: 0,
          });
        }
      });
    });
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
