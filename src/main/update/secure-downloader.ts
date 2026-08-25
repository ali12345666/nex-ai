/**
 * NEX AI — Secure Downloader (Phase 44)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Phase 43 had the permission + verification architecture but NO actual
 * download implementation. Phase 44 adds the real downloader.
 *
 * Features:
 *   - HTTPS download support (via Node.js https module — no external deps)
 *   - Resume interrupted downloads (HTTP Range header)
 *   - Progress reporting (bytes downloaded, speed, ETA)
 *   - Download speed calculation
 *   - Remaining time estimation
 *   - Downloads to SANDBOX (temp directory) — never directly to target
 *
 * CRITICAL SECURITY:
 *   This module does NOT decide whether to download — it ONLY executes
 *   the download AFTER the PermissionGate has approved it. The caller
 *   (UpdateManager) is responsible for checking permission first.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DownloadProgress {
  /** Bytes downloaded so far. */
  bytesDownloaded: number;
  /** Total bytes to download (0 if unknown). */
  totalBytes: number;
  /** Percentage (0-100, or -1 if total unknown). */
  percent: number;
  /** Download speed in bytes/second. */
  speedBytesPerSec: number;
  /** Estimated remaining time in seconds (-1 if unknown). */
  etaSeconds: number;
}

export interface DownloadResult {
  success: boolean;
  /** Path to the downloaded file in the sandbox. */
  sandboxPath?: string;
  /** SHA-256 hash of the downloaded file. */
  hash: string;
  /** Total bytes downloaded. */
  bytesDownloaded: number;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Error message (if failed). */
  error?: string;
  /** Whether the download was resumed from a partial file. */
  resumed: boolean;
}

export interface DownloadOptions {
  /** URL to download from (HTTPS only — HTTP rejected for security). */
  url: string;
  /** Expected file size (for progress display, 0 if unknown). */
  expectedSize?: number;
  /** Progress callback (called every ~500ms). */
  onProgress?: (progress: DownloadProgress) => void;
  /** Abort signal (if set to true, download stops). */
  shouldAbort?: () => boolean;
  /** Timeout in milliseconds (default 5 minutes). */
  timeoutMs?: number;
  /** Sandbox directory (default: os.tmpdir()/nex-update-sandbox). */
  sandboxDir?: string;
  /** Custom filename in sandbox (default: derived from URL). */
  filename?: string;
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

  /**
   * Download a file securely to the sandbox.
   *
   * Security:
   *   - HTTPS ONLY (HTTP URLs are rejected)
   *   - File goes to sandbox (never directly to target)
   *   - SHA-256 hash computed during download (streaming)
   *   - Resume support (if partial file exists in sandbox)
   *   - Abort support (caller can cancel)
   *
   * This does NOT check permissions — the caller must do that first.
   */
  async download(opts: DownloadOptions): Promise<DownloadResult> {
    const startMs = Date.now();
    const timeoutMs = opts.timeoutMs || 5 * 60 * 1000;

    // Security: reject HTTP URLs (HTTPS only)
    if (!opts.url.startsWith('https://')) {
      return {
        success: false,
        hash: '',
        bytesDownloaded: 0,
        durationMs: Date.now() - startMs,
        error: 'Security: only HTTPS URLs are allowed (rejected: ' + opts.url.split(':')[0] + ')',
        resumed: false,
      };
    }

    // Determine filename
    const filename = opts.filename || this.deriveFilename(opts.url);
    const sandboxPath = path.join(this.sandboxDir, filename);

    // Check for partial download (resume support)
    let resumed = false;
    let existingBytes = 0;
    if (fs.existsSync(sandboxPath)) {
      const stat = fs.statSync(sandboxPath);
      existingBytes = stat.size;
      resumed = existingBytes > 0;
    }

    try {
      const result = await this.performDownload(opts.url, sandboxPath, existingBytes, opts, startMs, timeoutMs);
      return { ...result, resumed };
    } catch (err: any) {
      return {
        success: false,
        hash: '',
        bytesDownloaded: 0,
        durationMs: Date.now() - startMs,
        error: err.message,
        resumed,
      };
    }
  }

  /**
   * Perform the actual HTTPS download with progress + resume.
   */
  private performDownload(
    url: string,
    destPath: string,
    existingBytes: number,
    opts: DownloadOptions,
    startMs: number,
    timeoutMs: number,
  ): Promise<DownloadResult> {
    return new Promise((resolve) => {
      const hash = crypto.createHash('sha256');
      let bytesDownloaded = existingBytes;
      let totalBytes = opts.expectedSize || 0;
      let lastProgressMs = Date.now();
      let lastProgressBytes = bytesDownloaded;
      let speedBytesPerSec = 0;
      let writeStream: fs.WriteStream | null = null;
      let aborted = false;

      // Open write stream (append mode if resuming)
      const flags = existingBytes > 0 ? 'a' : 'w';
      writeStream = fs.createWriteStream(destPath, { flags });

      const request = https.get(url, (response) => {
        // Handle redirects (3xx)
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          writeStream?.close();
          // Recurse with redirect URL
          this.performDownload(response.headers.location, destPath, existingBytes, opts, startMs, timeoutMs)
            .then(resolve);
          return;
        }

        if (response.statusCode !== 200) {
          writeStream?.close();
          resolve({
            success: false,
            hash: '',
            bytesDownloaded: 0,
            durationMs: Date.now() - startMs,
            error: `HTTP ${response.statusCode}: ${response.statusMessage}`,
            resumed: existingBytes > 0,
          });
          return;
        }

        // Get total size from Content-Length header
        if (response.headers['content-length']) {
          totalBytes = parseInt(response.headers['content-length'], 10) + existingBytes;
        }

        // Pipe response to file + update hash
        response.on('data', (chunk: Buffer) => {
          // Check abort
          if (opts.shouldAbort && opts.shouldAbort()) {
            aborted = true;
            request.destroy();
            writeStream?.close();
            return;
          }

          writeStream?.write(chunk);
          hash.update(chunk);
          bytesDownloaded += chunk.length;

          // Progress reporting (throttled to ~500ms)
          const now = Date.now();
          if (opts.onProgress && now - lastProgressMs >= 500) {
            const elapsed = (now - lastProgressMs) / 1000;
            const bytesInInterval = bytesDownloaded - lastProgressBytes;
            speedBytesPerSec = bytesInInterval / elapsed;
            const remaining = totalBytes - bytesDownloaded;
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
          if (aborted) {
            resolve({
              success: false,
              hash: '',
              bytesDownloaded,
              durationMs: Date.now() - startMs,
              error: 'Download aborted by user',
              resumed: existingBytes > 0,
            });
            return;
          }

          writeStream?.end(() => {
            resolve({
              success: true,
              sandboxPath: destPath,
              hash: hash.digest('hex'),
              bytesDownloaded,
              durationMs: Date.now() - startMs,
              resumed: existingBytes > 0,
            });
          });
        });

        response.on('error', (err) => {
          writeStream?.close();
          resolve({
            success: false,
            hash: '',
            bytesDownloaded,
            durationMs: Date.now() - startMs,
            error: err.message,
            resumed: existingBytes > 0,
          });
        });
      });

      request.on('error', (err) => {
        writeStream?.close();
        resolve({
          success: false,
          hash: '',
          bytesDownloaded,
          durationMs: Date.now() - startMs,
          error: err.message,
          resumed: existingBytes > 0,
        });
      });

      request.setTimeout(timeoutMs, () => {
        request.destroy();
        writeStream?.close();
        resolve({
          success: false,
          hash: '',
          bytesDownloaded,
          durationMs: Date.now() - startMs,
          error: `Download timed out after ${timeoutMs}ms`,
          resumed: existingBytes > 0,
        });
      });

      // Add Range header for resume
      if (existingBytes > 0) {
        request.setHeader('Range', `bytes=${existingBytes}-`);
      }
    });
  }

  /**
   * Derive a filename from a URL.
   */
  private deriveFilename(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const basename = path.basename(pathname);
      if (basename && basename.length > 0) return basename;
    } catch { /* */ }
    return `nex-download-${Date.now()}.bin`;
  }

  /**
   * Get the sandbox directory path.
   */
  get sandboxPath(): string {
    return this.sandboxDir;
  }

  /**
   * Clean up the sandbox (remove all files).
   */
  cleanSandbox(): void {
    try {
      const files = fs.readdirSync(this.sandboxDir);
      for (const f of files) {
        try { fs.unlinkSync(path.join(this.sandboxDir, f)); } catch { /* */ }
      }
    } catch { /* */ }
  }
}
