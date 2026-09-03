/**
 * NEX AI — Secure Downloader (Phase 69 — socket hang up fix)
 *
 * Fixes "socket hang up" error during large file downloads.
 *
 * Root causes fixed:
 *   1. "socket hang up" was NOT in TRANSIENT_ERRORS list → no retry
 *   2. No HTTPS Agent with keepAlive → connection dropped mid-download
 *   3. No response.aborted handler → aborted responses not caught
 *   4. Content-Length not verified at end → incomplete files reported as success
 *   5. Idle timeout too short for slow CDN initial response (60s → 120s)
 *   6. No request-level timeout (only idle timeout) → DNS/connection hang forever
 *
 * CRITICAL SECURITY:
 *   - HTTPS ONLY (HTTP URLs rejected)
 *   - TLS verification NEVER disabled (rejectUnauthorized stays true)
 *   - Sandbox destination
 *   - SHA-256 checksum
 *   - PermissionGate not bypassed
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
  /** Phase 71: Detailed error info for UI display */
  errorCode?: string;
  errorStage?: string;
  errorHost?: string;
  bytesExpected?: number;
  /** Phase 72: CDN connection failure classification */
  errorClassification?: string;
  cdnHost?: string;
  hasAlternativeSource?: boolean;
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

// "socket hang up" is Node's generic message for ECONNRESET on HTTPS.
// It occurs when the remote server closes the connection unexpectedly.
const TRANSIENT_ERRORS = [
  'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH',
  'ENETUNREACH', 'EAI_AGAIN', 'ECONNABORTED', 'UND_ERR_SOCKET',
  'socket hang up',           // ← THE MISSING ONE
  'EPROTO',                   // TLS protocol error (sometimes transient)
  'HPE_INVALID_CONSTANT',     // HTTP parser error (sometimes transient)
];

function isTransientError(err: any): boolean {
  const code = err?.code || '';
  const message = err?.message || String(err);
  return TRANSIENT_ERRORS.some(e =>
    code.includes(e) || message.includes(e)
  );
}

export interface DownloadErrorInfo {
  code: string;
  message: string;
  isTransient: boolean;
  canResume: boolean;
  classification: 'network-interrupted' | 'timeout' | 'tls' | 'http' | 'permission' | 'disk' | 'cdn-connection-failure' | 'unknown';
  userMessage: string;
  userMessageFa: string;
  /** Phase 72: The CDN host that failed (if applicable) */
  cdnHost?: string;
  /** Phase 72: Whether an alternative source is available */
  hasAlternativeSource?: boolean;
}

/**
 * Phase 72: Known CDN hosts that may be blocked on some networks.
 * When a download fails connecting to these hosts, we classify it as a
 * 'cdn-connection-failure' rather than a generic transient error.
 */
const KNOWN_CDN_HOSTS = [
  'us.aws.cdn.hf.co',
  'cas-server.xethub.hf.co',
  'cdn-lfs.huggingface.co',
  'cdn-lfs-us-1.huggingface.co',
  'cdn-lfs-eu-1.huggingface.co',
];

/**
 * Phase 72: Check if a host is a known CDN that may be blocked.
 * Uses exact match or suffix match (e.g., 'us.aws.cdn.hf.co' matches
 * 'us.aws.cdn.hf.co' but 'huggingface.co' does NOT match just because
 * 'cdn-lfs.huggingface.co' contains 'huggingface.co').
 */
export function isKnownCdnHost(host: string): boolean {
  const h = host.toLowerCase();
  return KNOWN_CDN_HOSTS.some(known => {
    const k = known.toLowerCase();
    // Exact match, or host is a subdomain of a known CDN host
    return h === k || h.endsWith('.' + k);
  });
}

/**
 * Phase 72: Check if an error indicates a CDN connection failure
 * (ECONNRESET, ETIMEDOUT, TLS handshake timeout) on a known CDN host.
 */
export function isCdnConnectionFailure(err: any, host: string): boolean {
  if (!host) return false;
  if (!isKnownCdnHost(host)) return false;
  const code = err?.code || '';
  const message = err?.message || String(err);
  return (
    code.includes('ECONNRESET') ||
    code.includes('ETIMEDOUT') ||
    code.includes('EPROTO') ||
    message.includes('socket hang up') ||
    message.includes('Connection was reset') ||
    message.includes('TLS handshake') ||
    message.includes('Idle timeout')
  );
}

export function classifyDownloadError(err: any, hasPartialFile: boolean, host?: string): DownloadErrorInfo {
  const code = err?.code || '';
  const message = err?.message || String(err);

  // ── Phase 72: CDN connection failure (check FIRST — before generic transient) ──
  if (host && isCdnConnectionFailure(err, host)) {
    return {
      code, message,
      isTransient: false,  // CDN blocks are typically persistent, not transient
      canResume: hasPartialFile,
      classification: 'cdn-connection-failure',
      cdnHost: host,
      hasAlternativeSource: true,
      userMessage: `Hugging Face CDN connection failed. The model server is reachable, but its download CDN (${host}) connection is being blocked/reset by the current network.`,
      userMessageFa: `اتصال به CDN هاگینگ‌فیس ناموفق بود. سرور مدل در دسترس است، اما اتصال به CDN دانلود (${host}) توسط شبکه فعلی مسدود/ریست می‌شود. از منبع جایگزین ModelScope استفاده کنید.`,
    };
  }

  const isInterrupt = TRANSIENT_ERRORS.slice(0, 10).some(e => (code + ' ' + message).includes(e));

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
  if (code.includes('CERT') || code.includes('TLS') || code.includes('SSL') || code.includes('EPROTO')) {
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

// ─── HTTPS Agent (keepAlive for stable connections) ───────────────────────

// Use a shared agent with keepAlive enabled for stable connections.
// This prevents the socket from being closed prematurely by Node's
// default agent (which has keepAlive=false).
const downloadAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 4,
  maxFreeSockets: 2,
  timeout: 120_000,           // 2 min socket timeout
  // rejectUnauthorized stays true (default) — TLS verification NEVER disabled
});

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
   * HTTPS only. Resume support. Automatic retry on transient errors (including socket hang up).
   *
   * Phase 71: Retry loop is HARD-CAPPED at maxRetries (default 5). After
   * exhausting retries, the download is marked FAILED and [DOWNLOAD_FINAL_FAILURE]
   * is logged with full diagnostics. The UI spinner stops because the status
   * becomes 'download-failed' (excluded from activeDownloads in the store).
   */
  async download(opts: DownloadOptions): Promise<DownloadResult> {
    const startMs = Date.now();
    const maxRetries = opts.maxRetries ?? 5;
    const idleTimeoutMs = opts.timeoutMs ?? 120_000;

    if (!opts.url.startsWith('https://')) {
      return { success: false, hash: '', bytesDownloaded: 0, durationMs: Date.now() - startMs,
        error: `Security: only HTTPS URLs are allowed (rejected: ${opts.url.split(':')[0]})`, resumed: false, retries: 0 };
    }

    const filename = opts.filename || this.deriveFilename(opts.url);
    const sandboxPath = path.join(this.sandboxDir, filename);

    console.log(`[DOWNLOAD_ATTEMPT] 0/${maxRetries} — START — url=${opts.url.slice(0, 80)}... — dest=${sandboxPath}`);

    let lastError: any = null;
    let lastErrorCode: string = '';
    let lastErrorStage: string = '';
    let lastHost: string = '';
    let totalBytesExpected: number = 0;
    let totalBytesReceived: number = 0;
    let retries = 0;

    // Shared context across all attempts — tracks host/stage/expected for diagnostics
    const diagCtx = { host: '', stage: '', bytesExpected: 0 };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (opts.shouldAbort?.()) {
        console.log(`[DOWNLOAD_ABORTED] by user — attempt ${attempt}/${maxRetries} — bytesReceived=${this.getPartialSize(sandboxPath)}`);
        return { success: false, hash: '', bytesDownloaded: this.getPartialSize(sandboxPath),
          durationMs: Date.now() - startMs, error: 'Download aborted by user',
          resumed: this.getPartialSize(sandboxPath) > 0, retries: attempt };
      }

      const existingBytes = this.getPartialSize(sandboxPath);

      // ── Log .part file state before each attempt ──
      console.log(`[DOWNLOAD_ATTEMPT] ${attempt + 1}/${maxRetries + 1} — .part file state:`);
      if (existingBytes > 0) {
        try {
          const stat = fs.statSync(sandboxPath);
          console.log(`  .part exists: true — size=${existingBytes} bytes — mtime=${stat.mtime.toISOString()}`);
          console.log(`  Resume: will send Range: bytes=${existingBytes}-`);
        } catch {
          console.log(`  .part stat failed — size=0`);
        }
      } else {
        console.log(`  .part exists: false — size=0 — fresh download (no Range header)`);
      }

      try {
        const result = await this.attemptDownload(opts.url, sandboxPath, existingBytes, opts, startMs, idleTimeoutMs, attempt, diagCtx);

        if (result.success) {
          console.log(`[DOWNLOAD_ATTEMPT] ${attempt + 1}/${maxRetries + 1} — SUCCESS — bytesDownloaded=${result.bytesDownloaded}`);
          return { ...result, resumed: existingBytes > 0, retries: attempt };
        }

        lastError = result.error;
        totalBytesReceived = result.bytesDownloaded || this.getPartialSize(sandboxPath);
        totalBytesExpected = diagCtx.bytesExpected || result.bytesDownloaded;
        lastHost = diagCtx.host;
        lastErrorStage = diagCtx.stage || 'response-stream';
        // Phase 72: Pass host to classifyDownloadError for CDN failure detection
        const errInfo = classifyDownloadError({ message: result.error, code: lastErrorCode }, this.getPartialSize(sandboxPath) > 0, lastHost);

        console.log(`[DOWNLOAD_ATTEMPT] ${attempt + 1}/${maxRetries + 1} — FAILED — error=${result.error}`);
        console.log(`  classification=${errInfo.classification} — isTransient=${errInfo.isTransient} — canResume=${errInfo.canResume}`);
        console.log(`  bytesReceived this attempt: ${result.bytesDownloaded}`);
        if (errInfo.classification === 'cdn-connection-failure') {
          console.log(`  CDN_HOST=${errInfo.cdnHost} — hasAlternativeSource=${errInfo.hasAlternativeSource}`);
        }

        if (!errInfo.isTransient) {
          // Non-transient error — stop immediately
          // Phase 72: CDN connection failures are non-transient — stop and report
          if (errInfo.classification === 'cdn-connection-failure') {
            console.log(`[DOWNLOAD_FINAL_FAILURE] — CDN connection failure, stopping (not transient)`);
            console.log(`  CDN host ${lastHost} is blocked — suggest alternative source`);
          } else {
            console.log(`[DOWNLOAD_FINAL_FAILURE] — non-transient error, stopping`);
          }
          console.log(`  attempts=${attempt + 1}/${maxRetries + 1}`);
          console.log(`  code=${lastErrorCode || 'N/A'}`);
          console.log(`  message=${result.error}`);
          console.log(`  bytesReceived=${totalBytesReceived}`);
          return { ...result, resumed: this.getPartialSize(sandboxPath) > 0, retries: attempt };
        }

        if (attempt < maxRetries) {
          const waitMs = Math.min(2000 * Math.pow(2, attempt), 30000);  // 2s, 4s, 8s, 16s, 30s
          console.log(`[DOWNLOAD_RETRY] waiting ${waitMs}ms before attempt ${attempt + 2}/${maxRetries + 1}...`);
          await new Promise(r => setTimeout(r, waitMs));
          retries = attempt + 1;
        }
      } catch (err: any) {
        lastError = err;
        lastErrorCode = err?.code || '';
        if (isTransientError(err) && attempt < maxRetries) {
          const waitMs = Math.min(2000 * Math.pow(2, attempt), 30000);
          console.log(`[DOWNLOAD_ATTEMPT] ${attempt + 1}/${maxRetries + 1} — THREW — code=${err.code} message=${err.message}`);
          console.log(`[DOWNLOAD_RETRY] waiting ${waitMs}ms before attempt ${attempt + 2}/${maxRetries + 1}...`);
          await new Promise(r => setTimeout(r, waitMs));
          retries = attempt + 1;
        } else {
          console.log(`[DOWNLOAD_ATTEMPT] ${attempt + 1}/${maxRetries + 1} — THREW (non-transient or max reached) — code=${err.code} message=${err.message}`);
          break;
        }
      }
    }

    // ── All retries exhausted — FINAL FAILURE ──
    const existingBytes = this.getPartialSize(sandboxPath);
    // Phase 72: Pass lastHost to classifyDownloadError for CDN failure detection
    const errInfo = classifyDownloadError(lastError, existingBytes > 0, lastHost);

    console.log(`[DOWNLOAD_FINAL_FAILURE]`);
    console.log(`  attempts=${retries}/${maxRetries + 1}`);
    console.log(`  code=${lastErrorCode || (lastError?.code || 'N/A')}`);
    console.log(`  message=${lastError?.message || String(lastError)}`);
    console.log(`  stage=${lastErrorStage || 'unknown'}`);
    console.log(`  bytesReceived=${existingBytes}`);
    console.log(`  bytesExpected=${totalBytesExpected || 'unknown'}`);
    console.log(`  host=${lastHost || 'unknown'}`);
    console.log(`  classification=${errInfo.classification}`);
    if (errInfo.classification === 'cdn-connection-failure') {
      console.log(`  CDN_HOST=${errInfo.cdnHost}`);
      console.log(`  hasAlternativeSource=${errInfo.hasAlternativeSource}`);
      console.log(`  SUGGESTION: Use ModelScope alternative source (RECOMMENDED_FIRST_MODEL_ALTERNATIVE)`);
    }

    return {
      success: false,
      hash: '',
      bytesDownloaded: existingBytes,
      durationMs: Date.now() - startMs,
      error: errInfo.userMessageFa,
      resumed: existingBytes > 0,
      retries,
      errorCode: lastErrorCode || (lastError?.code || 'UNKNOWN'),
      errorStage: lastErrorStage || 'unknown',
      errorHost: lastHost || 'unknown',
      bytesExpected: totalBytesExpected,
      // Phase 72: CDN-specific fields
      errorClassification: errInfo.classification,
      cdnHost: errInfo.cdnHost,
      hasAlternativeSource: errInfo.hasAlternativeSource,
    };
  }

  /**
   * Single download attempt with full request tracing.
   *
   * The `ctx` parameter tracks diagnostic state (stage, host, expected bytes)
   * across redirects within a single attempt. The caller's `download()` method
   * reads from this context when reporting [DOWNLOAD_FINAL_FAILURE].
   */
  private attemptDownload(
    url: string, destPath: string, existingBytes: number,
    opts: DownloadOptions, startMs: number, idleTimeoutMs: number,
    attemptNum: number,
    ctx?: { host?: string; stage?: string; bytesExpected?: number },
  ): Promise<DownloadResult> {
    return new Promise((resolve) => {
      const urlObj = new URL(url);
      const requestId = `HTTP:${String(attemptNum + 1).padStart(3, '0')}`;
      if (ctx) ctx.host = urlObj.hostname;

      // Build headers — ALL set BEFORE the request is made
      const headers: Record<string, string> = {
        'User-Agent': 'NEX-AI/1.0 (local-ai-assistant; +https://github.com/ali12345666/nex-ai)',
        'Accept': 'application/octet-stream, */*',
        'Accept-Encoding': 'identity',
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
        agent: downloadAgent,          // ← Use shared keepAlive agent
        timeout: 30_000,               // ← Initial connection timeout (30s)
      };

      console.log(`[INSTALL:10] [${requestId}] HTTP_REQUEST → GET https://${requestOpts.hostname}:${requestOpts.port || 443}${requestOpts.path}`);
      console.log(`[${requestId}] HOST=${requestOpts.hostname}`);
      console.log(`[${requestId}] Headers=${JSON.stringify(headers)}`);
      console.log(`[${requestId}] Dest=${destPath} — existingBytes=${existingBytes}`);
      console.log(`[${requestId}] Agent: keepAlive=${(downloadAgent as any).keepAlive}, maxSockets=${(downloadAgent as any).maxSockets}`);

      let bytesDownloaded = existingBytes;
      let totalBytes = opts.expectedSize || 0;
      let expectedContentLength = 0;
      let lastProgressMs = Date.now();
      let lastProgressBytes = bytesDownloaded;
      let settled = false;
      let idleTimer: NodeJS.Timeout | null = null;
      let writeStream: fs.WriteStream | null = null;
      let needFullHash = false;
      let redirectCount = 0;

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
            console.log(`[${requestId}] IDLE_TIMEOUT — no data for ${idleTimeoutMs}ms — bytes received: ${bytesDownloaded}`);
            if (ctx) { ctx.stage = 'idle-timeout'; }
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

      const failWith = (error: string, errObj?: any) => {
        if (settled) return;
        settled = true;
        if (idleTimer) clearTimeout(idleTimer);
        try { writeStream?.close(); } catch { /* */ }
        console.log(`[INSTALL:ERROR] [${requestId}] stage:http — code=${errObj?.code || 'N/A'} message=${error}`);
        console.log(`[INSTALL:ERROR] [${requestId}] stack=${errObj?.stack || '(no stack)'}`);
        console.log(`[${requestId}] bytes received before error: ${bytesDownloaded}`);
        console.log(`[${requestId}] content-length was: ${expectedContentLength}`);
        console.log(`[${requestId}] redirect count: ${redirectCount}`);
        resolve({
          success: false, hash: '', bytesDownloaded,
          durationMs: Date.now() - startMs, error,
          resumed: existingBytes > 0, retries: 0,
        });
      };

      let requestRef: any = null;

      // Initialize hash for resume
      initHashForResume();

      // Open write stream
      const writeFlags = existingBytes > 0 ? 'a' : 'w';
      writeStream = fs.createWriteStream(destPath, { flags: writeFlags });

      // Handle writeStream errors
      writeStream.on('error', (err) => {
        console.log(`[${requestId}] WRITE_STREAM_ERROR: ${err.message}`);
        failWith(`Write error: ${err.message}`, err);
      });

      requestRef = https.request(requestOpts, (response) => {
        console.log(`[INSTALL:11] [${requestId}] HTTP_RESPONSE ← status=${response.statusCode} ${response.statusMessage}`);
        console.log(`[${requestId}] RESPONSE headers: ${JSON.stringify({
          'content-length': response.headers['content-length'],
          'content-range': response.headers['content-range'],
          'content-type': response.headers['content-type'],
          'location': response.headers['location'] ? '(redirect)' : undefined,
          'transfer-encoding': response.headers['transfer-encoding'],
        })}`);

        // ── Handle redirects (3xx) ──
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          redirectCount++;
          const fromHost = urlObj.hostname;
          let redirectUrl = response.headers.location;
          let toHost: string;
          if (redirectUrl.startsWith('/')) {
            toHost = fromHost;
            redirectUrl = `https://${fromHost}${redirectUrl}`;
          } else if (!redirectUrl.startsWith('https://')) {
            try { toHost = new URL(redirectUrl, url).hostname; redirectUrl = new URL(redirectUrl, url).href; }
            catch { toHost = '?'; }
          } else {
            try { toHost = new URL(redirectUrl).hostname; } catch { toHost = '?'; }
          }
          console.log(`[REDIRECT] from=${fromHost} to=${toHost}`);
          console.log(`[REDIRECT] url=${redirectUrl.slice(0, 120)}${redirectUrl.length > 120 ? '...' : ''}`);

          response.resume();
          try { writeStream?.close(); } catch { /* */ }
          if (idleTimer) clearTimeout(idleTimer);

          const currentBytes = this.getPartialSize(destPath);
          this.attemptDownload(redirectUrl, destPath, currentBytes, opts, startMs, idleTimeoutMs, attemptNum, ctx).then(resolve);
          return;
        }

        // ── Handle 416 (Range Not Satisfiable) ──
        if (response.statusCode === 416) {
          console.log(`[${requestId}] 416 Range Not Satisfiable — file may already be complete`);
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
          console.log(`[${requestId}] HTTP_ERROR: ${response.statusCode}`);
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
          console.log(`[${requestId}] Server sent 200 (ignored Range) — restarting from scratch`);
          try { writeStream?.close(); } catch { /* */ }
          writeStream = fs.createWriteStream(destPath, { flags: 'w' });
          bytesDownloaded = 0;
          needFullHash = true;
        }

        // ── Get total size ──
        const contentRange = response.headers['content-range'];
        if (contentRange) {
          const match = contentRange.match(/\/(\d+)/);
          if (match) {
            totalBytes = parseInt(match[1], 10);
            expectedContentLength = totalBytes;
          }
        } else if (response.headers['content-length']) {
          const cl = parseInt(response.headers['content-length'], 10);
          expectedContentLength = cl;
          totalBytes = (response.statusCode === 206) ? existingBytes + cl : cl;
        }
        if (ctx) ctx.bytesExpected = totalBytes;

        console.log(`[INSTALL:12] [${requestId}] STREAM_START — totalBytes=${totalBytes} — statusCode=${response.statusCode}`);
        if (ctx) ctx.stage = 'response-stream';

        resetIdleTimer();

        // ── Handle response aborted (server closes connection) ──
        response.on('aborted', () => {
          console.log(`[${requestId}] RESPONSE_ABORTED — bytes received: ${bytesDownloaded}`);
          failWith('socket hang up', { code: 'ECONNRESET', message: 'socket hang up' });
        });

        // ── Stream data to file + hash + progress ──
        response.on('data', (chunk: Buffer) => {
          if (opts.shouldAbort?.()) {
            failWith('Download aborted by user');
            return;
          }

          resetIdleTimer();

          // Write to stream — handle backpressure
          const ok = writeStream?.write(chunk);
          if (!ok) {
            // Backpressure — pause response until drain
            response.pause();
            writeStream?.once('drain', () => response.resume());
          }

          // Update hash
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
            const pct = totalBytes > 0 ? (bytesDownloaded / totalBytes) * 100 : -1;
            console.log(`[INSTALL:13] [${requestId}] PROGRESS — ${pct.toFixed(1)}% — ${bytesDownloaded}/${totalBytes > 0 ? totalBytes : '?'} bytes — ${Math.round(speed / 1024)} KB/s`);
            opts.onProgress({
              bytesDownloaded, totalBytes,
              percent: pct,
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

          console.log(`[${requestId}] STREAM_END — bytes received: ${bytesDownloaded} — expected: ${totalBytes}`);

          // Verify content-length if available
          if (expectedContentLength > 0 && response.statusCode === 200 && bytesDownloaded !== totalBytes) {
            console.log(`[${requestId}] INCOMPLETE — received ${bytesDownloaded} but expected ${totalBytes}`);
            failWith(`Incomplete download: received ${bytesDownloaded} bytes but expected ${totalBytes}`);
            return;
          }

          writeStream?.end(() => {
            if (settled) return;
            settled = true;

            console.log(`[INSTALL:14] [${requestId}] DOWNLOAD_COMPLETE — file: ${destPath} — bytes: ${bytesDownloaded}`);

            let finalHash: string;
            if (needFullHash) {
              const fileBuf = fs.readFileSync(destPath);
              finalHash = crypto.createHash('sha256').update(fileBuf).digest('hex');
            } else {
              finalHash = hash.digest('hex');
            }

            console.log(`[${requestId}] SHA-256: ${finalHash.slice(0, 16)}...`);

            resolve({ success: true, sandboxPath: destPath, hash: finalHash,
              bytesDownloaded, durationMs: Date.now() - startMs,
              resumed: existingBytes > 0 && !needFullHash, retries: 0 });
          });
        });

        response.on('error', (err: Error) => {
          console.log(`[${requestId}] RESPONSE_ERROR: ${err.message} — code: ${(err as any).code}`);
          failWith(err.message, err);
        });

        response.on('close', () => {
          // 'close' fires after 'end' or 'error' — don't double-handle
          if (!settled && !writeStream?.destroyed) {
            // If close fires without end or error, it's an unexpected close
            console.log(`[${requestId}] RESPONSE_CLOSE without end/error — treating as error`);
            failWith('socket hang up', { code: 'ECONNRESET', message: 'socket hang up' });
          }
        });
      });

      // ── Request-level error handler ──
      requestRef.on('error', (err: Error) => {
        console.log(`[${requestId}] REQUEST_ERROR: ${err.message} — code: ${(err as any).code}`);
        if (ctx) { ctx.stage = 'request-error'; }
        failWith(err.message, err);
      });

      // ── Request-level timeout (initial connection / DNS) ──
      requestRef.on('timeout', () => {
        console.log(`[${requestId}] REQUEST_TIMEOUT — destroying request`);
        if (ctx) { ctx.stage = 'connection-timeout'; }
        requestRef.destroy();
        failWith('Connection timeout (30s)');
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
