/**
 * NEX AI — Unified Model Download Manager (Phase 72 — Robust Multi-Source)
 * ════════════════════════════════════════════════════════════════════════════════════════
 *
 * ONE unified pipeline for all model downloads. Replaces the fragmented
 * approach where SecureDownloader, ModelDeploymentManager, and main.ts IPC
 * handlers each implemented parts of the flow independently.
 *
 * Architecture:
 *
 *   Model Catalog (with multi-source metadata)
 *         │
 *         ▼
 *   ModelDownloadManager  ← THIS FILE
 *         │
 *         ├── Source Resolver     (priority-based source selection + fallback)
 *         ├── SecureDownloader    (HTTPS download with .part resume + retry)
 *         ├── Integrity Validator (GGUF magic + size + SHA-256)
 *         └── Installer           (atomic rename to models/ dir + registry)
 *         │
 *         ▼
 *   Installed Model (local, offline-ready)
 *
 * Key features:
 *   - Multi-source support: each model can have multiple verified sources
 *   - Automatic fallback: if source 1 fails (CDN blocked), try source 2
 *   - Bounded retry: MAX_ATTEMPTS=5 per source, exponential backoff
 *   - .part resume: downloads to <filename>.part, atomically renames on success
 *   - Integrity validation: GGUF magic + size + SHA-256 before install
 *   - Explicit state machine: queued → resolving → connecting → downloading
 *     → verifying → installing → completed (or download-failed/cancelled)
 *   - Durable storage: models stored in <userData>/models/, NOT tmpdir
 *   - Offline-first: installed models work without network
 *
 * Security:
 *   - HTTPS ONLY (HTTP rejected)
 *   - TLS verification NEVER disabled (rejectUnauthorized stays true)
 *   - Redirects must remain HTTPS
 *   - No arbitrary local paths — all paths validated inside models/ dir
 *   - Partial files never exposed as installed models
 *
 * ════════════════════════════════════════════════════════════════════════════════════════
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as https from 'https';
import * as os from 'os';
import { app } from 'electron';
import { addModel, updateModel, type LocalModelInfo, type AddModelOptions } from '../ai/model-registry';
import { SecureDownloader, type DownloadResult, type DownloadProgress, classifyDownloadError, isKnownCdnHost } from '../update/secure-downloader';

// ─── Types ─────────────────────────────────────────────────────────────────────────

/**
 * A single download source for a model. A model can have multiple sources
 * with different priorities — if source 1 fails, the manager falls back
 * to source 2, etc.
 */
export interface ModelSource {
  /** Source type for classification + UI display. */
  type: 'huggingface' | 'modelscope' | 'mirror' | 'direct';
  /** HTTPS URL to download the GGUF file. */
  url: string;
  /** Priority (1 = highest). Lower priority = tried first. */
  priority: number;
  /** Human-readable label for UI. */
  label: string;
  /** Expected SHA-256 hash (if known). If absent, hash is computed but not verified. */
  expectedHash?: string;
  /** Expected file size in bytes (if known). */
  expectedSize?: number;
}

/**
 * Metadata for a downloadable model. Supports multiple sources.
 */
export interface DownloadableModel {
  /** Unique identifier (e.g. 'qwen2.5-0.5b-q4'). */
  id: string;
  /** Display name (e.g. 'Qwen2.5 0.5B Instruct Q4'). */
  name: string;
  /** Persian display name. */
  nameFa?: string;
  /** Provider (e.g. 'qwen'). */
  provider: string;
  /** Parameter count (e.g. '0.5B'). */
  parameterCount: string;
  /** Quantization (e.g. 'Q4_K_M'). */
  quantization: string;
  /** Architecture (e.g. 'qwen2'). */
  architecture: string;
  /** Model category. */
  category: 'general' | 'coding' | 'reasoning' | 'fast' | 'vision' | 'embedding';
  /** Required RAM in GB. */
  requiredRAM: number;
  /** Required VRAM in GB (0 for CPU-only). */
  requiredVRAM: number;
  /** Persian language support. */
  persianSupport: boolean;
  /** Ordered list of download sources (priority 1 tried first). */
  sources: ModelSource[];
  /** Filename for the downloaded GGUF file. */
  filename: string;
  /** Description (English). */
  description?: string;
  /** Description (Persian). */
  descriptionFa?: string;
}

/**
 * Explicit download state machine. Each download transitions through
 * these states. Terminal states: completed, download-failed, cancelled,
 * permission-denied. The UI spinner MUST stop on terminal states.
 */
export type DownloadState =
  | 'queued'
  | 'resolving'          // resolving source URL (following redirects)
  | 'connecting'         // TCP/TLS connection to CDN
  | 'downloading'        // streaming data
  | 'retrying'           // waiting before retry or switching source
  | 'verifying'          // integrity check (GGUF magic + size + hash)
  | 'installing'         // atomic rename + registry
  | 'completed'
  | 'download-failed'
  | 'cancelled'
  | 'permission-denied';

/**
 * Failure classification. 14 categories as specified in Phase 72.
 */
export type FailureClassification =
  | 'NETWORK_TRANSIENT'
  | 'CDN_UNREACHABLE'
  | 'TLS_FAILURE'
  | 'CONNECTION_RESET'
  | 'TIMEOUT'
  | 'DNS_FAILURE'
  | 'HTTP_ERROR'
  | 'AUTH_ERROR'
  | 'RANGE_UNSUPPORTED'
  | 'DISK_ERROR'
  | 'PERMISSION_ERROR'
  | 'INTEGRITY_ERROR'
  | 'USER_CANCELLED'
  | 'UNKNOWN';

/**
 * Detailed failure information persisted with each failed download.
 */
export interface DownloadFailureInfo {
  code: string;
  message: string;
  stage: string;
  host: string;
  source: string;        // source type that failed
  sourceUrl: string;     // URL that failed (hostname only in logs, full in debug)
  attempt: number;
  maxAttempts: number;
  bytesReceived: number;
  bytesExpected: number;
  httpStatus?: number;
  classification: FailureClassification;
  timestamp: number;
}

/**
 * Progress event emitted during download.
 */
export interface ModelDownloadProgress {
  downloadId: string;
  modelId: string;
  modelName: string;
  state: DownloadState;
  currentSource: ModelSource | null;
  attempt: number;
  maxAttempts: number;
  receivedBytes: number;
  totalBytes: number;
  percentage: number | null;   // null if total unknown
  speed: number;               // bytes/sec
  elapsed: number;             // ms
  eta: number;                 // ms, -1 if unknown
  stageMessage: string;
  stageMessageFa: string;
  failure?: DownloadFailureInfo;
}

/**
 * Result of a download operation.
 */
export interface ModelDownloadResult {
  success: boolean;
  downloadId: string;
  modelId: string;
  modelName: string;
  filePath?: string;          // final installed path (on success)
  hash?: string;
  bytesDownloaded: number;
  durationMs: number;
  state: DownloadState;
  failure?: DownloadFailureInfo;
  sourcesAttempted: ModelSource[];
}

// ─── Constants ──────────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS_PER_SOURCE = 5;
const MAX_TOTAL_ATTEMPTS = 10;   // across all sources
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 30000;

// ─── Model Storage Directory ────────────────────────────────────────────────────────

/**
 * Get the durable model storage directory. Models are stored here
 * (NOT in tmpdir) so they survive reboots.
 *
 * Path: <userData>/models/
 */
export function getModelsDir(): string {
  const dir = path.join(app.getPath('userData'), 'models');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get the download sandbox directory for .part files.
 * Path: <userData>/models/.downloads/
 */
export function getDownloadSandboxDir(): string {
  const dir = path.join(getModelsDir(), '.downloads');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ─── Failure Classification ──────────────────────────────────────────────────────────

/**
 * Classify a download error into one of 14 categories.
 * Uses the error code, message, host, and HTTP status.
 */
export function classifyFailure(
  err: any,
  host: string,
  httpStatus?: number,
): FailureClassification {
  const code = err?.code || '';
  const message = err?.message || String(err || '');

  // User cancelled
  if (message.includes('aborted by user') || code === 'USER_CANCELLED') {
    return 'USER_CANCELLED';
  }

  // Permission errors
  if (code.includes('EACCES') || code.includes('EPERM')) {
    return 'PERMISSION_ERROR';
  }

  // Disk errors
  if (code.includes('ENOSPC') || message.toLowerCase().includes('disk')) {
    return 'DISK_ERROR';
  }

  // DNS failures
  if (code.includes('ENOTFOUND') || code.includes('EAI_AGAIN') || code.includes('EAI_NODATA')) {
    return 'DNS_FAILURE';
  }

  // Auth errors (HTTP 401, 403)
  if (httpStatus === 401 || httpStatus === 403) {
    return 'AUTH_ERROR';
  }

  // HTTP errors (4xx, 5xx — except 416 which is Range)
  if (httpStatus && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 416) {
    return 'HTTP_ERROR';
  }
  if (httpStatus && httpStatus >= 500) {
    return 'HTTP_ERROR';  // 5xx — transient, but classified as HTTP_ERROR
  }

  // Range unsupported (416)
  if (httpStatus === 416) {
    return 'RANGE_UNSUPPORTED';
  }

  // TLS failures
  if (code.includes('CERT') || code.includes('TLS') || code.includes('SSL') || code.includes('EPROTO')) {
    // If on a known CDN host, classify as CDN_UNREACHABLE
    if (host && isKnownCdnHost(host)) {
      return 'CDN_UNREACHABLE';
    }
    return 'TLS_FAILURE';
  }

  // Connection reset
  if (code.includes('ECONNRESET') || message.includes('socket hang up') || message.includes('Connection was reset')) {
    if (host && isKnownCdnHost(host)) {
      return 'CDN_UNREACHABLE';
    }
    return 'CONNECTION_RESET';
  }

  // Timeouts
  if (code.includes('ETIMEDOUT') || message.includes('timed out') || message.includes('Idle timeout')) {
    if (host && isKnownCdnHost(host)) {
      return 'CDN_UNREACHABLE';
    }
    return 'TIMEOUT';
  }

  // Network transient (ECONNREFUSED, EPIPE, etc.)
  if (code.includes('ECONNREFUSED') || code.includes('EPIPE') || code.includes('EHOSTUNREACH') || code.includes('ENETUNREACH')) {
    return 'NETWORK_TRANSIENT';
  }

  return 'UNKNOWN';
}

/**
 * Determine if a failure classification should trigger a retry.
 * Non-retryable: USER_CANCELLED, PERMISSION_ERROR, DISK_ERROR, AUTH_ERROR,
 * INTEGRITY_ERROR (completed but invalid).
 */
export function shouldRetry(classification: FailureClassification): boolean {
  switch (classification) {
    case 'USER_CANCELLED':
    case 'PERMISSION_ERROR':
    case 'DISK_ERROR':
    case 'AUTH_ERROR':
    case 'INTEGRITY_ERROR':
      return false;
    case 'NETWORK_TRANSIENT':
    case 'CDN_UNREACHABLE':
    case 'TLS_FAILURE':
    case 'CONNECTION_RESET':
    case 'TIMEOUT':
    case 'DNS_FAILURE':
    case 'HTTP_ERROR':    // 5xx might be transient
    case 'RANGE_UNSUPPORTED':
    case 'UNKNOWN':
      return true;
    default:
      return true;
  }
}

/**
 * Determine if a failure should trigger source fallback (try next source).
 * CDN_UNREACHABLE and TLS_FAILURE on CDN hosts should fallback.
 */
export function shouldFallbackToNextSource(classification: FailureClassification): boolean {
  return classification === 'CDN_UNREACHABLE' ||
         classification === 'TLS_FAILURE' ||
         classification === 'CONNECTION_RESET' ||
         classification === 'TIMEOUT';
}

// ─── Integrity Validator ─────────────────────────────────────────────────────────────

/**
 * Validate a downloaded GGUF file.
 *   1. File exists
 *   2. File size > 0 (and matches expected if provided)
 *   3. GGUF magic bytes (first 4 bytes = 0x46554747 = "GGUF")
 *   4. SHA-256 hash (if expectedHash provided)
 */
export interface IntegrityResult {
  passed: boolean;
  actualSize: number;
  expectedSize?: number;
  actualHash: string;
  expectedHash?: string;
  ggufMagicValid: boolean;
  error?: string;
}

export async function validateGgufIntegrity(
  filePath: string,
  expectedHash?: string,
  expectedSize?: number,
): Promise<IntegrityResult> {
  try {
    if (!fs.existsSync(filePath)) {
      return { passed: false, actualSize: 0, expectedSize, actualHash: '', ggufMagicValid: false, error: 'File does not exist' };
    }

    const stat = fs.statSync(filePath);
    const actualSize = stat.size;

    if (actualSize === 0) {
      return { passed: false, actualSize: 0, expectedSize, actualHash: '', ggufMagicValid: false, error: 'File is empty' };
    }

    // Check GGUF magic bytes
    const fd = fs.openSync(filePath, 'r');
    const magicBuf = Buffer.alloc(4);
    fs.readSync(fd, magicBuf, 0, 4, 0);
    fs.closeSync(fd);
    const magicString = magicBuf.toString('ascii');
    const ggufMagicValid = magicString === 'GGUF';

    if (!ggufMagicValid) {
      return { passed: false, actualSize, expectedSize, actualHash: '', ggufMagicValid: false, error: `Invalid GGUF magic: expected "GGUF", got "${magicString}"` };
    }

    // Check expected size (with 5% tolerance)
    if (expectedSize && expectedSize > 0) {
      const tolerance = expectedSize * 0.05;
      if (Math.abs(actualSize - expectedSize) > tolerance) {
        return { passed: false, actualSize, expectedSize, actualHash: '', ggufMagicValid: true, error: `Size mismatch: expected ${expectedSize}, got ${actualSize}` };
      }
    }

    // Compute SHA-256
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    for await (const chunk of stream) {
      hash.update(chunk);
    }
    const actualHash = hash.digest('hex');

    // Verify hash if expected
    if (expectedHash && expectedHash !== 'pending' && expectedHash.length === 64) {
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        return { passed: false, actualSize, expectedSize, actualHash, expectedHash, ggufMagicValid: true, error: `Hash mismatch: expected ${expectedHash.slice(0, 16)}..., got ${actualHash.slice(0, 16)}...` };
      }
    }

    return { passed: true, actualSize, expectedSize, actualHash, expectedHash, ggufMagicValid: true };
  } catch (err: any) {
    return { passed: false, actualSize: 0, expectedSize, actualHash: '', ggufMagicValid: false, error: `Validation error: ${err?.message || err}` };
  }
}

// ─── Test Connection ─────────────────────────────────────────────────────────────────

export interface ConnectionTestResult {
  host: string;
  dns: 'PASS' | 'FAIL';
  tcp: 'PASS' | 'FAIL';
  tls: 'PASS' | 'FAIL';
  statusCode?: number;
  error?: string;
  latencyMs: number;
}

/**
 * Test connectivity to a host: DNS → TCP → TLS/HTTPS.
 * Uses the same Node.js HTTPS stack as the actual downloader.
 */
export async function testConnection(url: string, timeoutMs = 10000): Promise<ConnectionTestResult> {
  const start = Date.now();
  let urlObj: URL;
  try {
    urlObj = new URL(url);
  } catch {
    return { host: url, dns: 'FAIL', tcp: 'FAIL', tls: 'FAIL', error: 'Invalid URL', latencyMs: Date.now() - start };
  }

  const host = urlObj.hostname;

  // DNS test
  let dnsResult: 'PASS' | 'FAIL' = 'FAIL';
  try {
    const dns = await import('dns').then(m => m.promises);
    const addrs = await dns.resolve4(host);
    dnsResult = addrs.length > 0 ? 'PASS' : 'FAIL';
  } catch {
    dnsResult = 'FAIL';
  }

  // TCP + TLS test (HTTPS HEAD request)
  return new Promise((resolve) => {
    const req = https.request({
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'HEAD',
      timeout: timeoutMs,
    }, (res) => {
      res.resume();
      resolve({
        host,
        dns: dnsResult,
        tcp: 'PASS',
        tls: 'PASS',
        statusCode: res.statusCode,
        latencyMs: Date.now() - start,
      });
    });
    req.on('error', (err: any) => {
      const code = err.code || '';
      // TLS errors mean TCP succeeded but TLS failed
      const tlsFailed = code.includes('CERT') || code.includes('TLS') || code.includes('SSL') || code.includes('EPROTO') ||
                       err.message.includes('socket hang up') || code.includes('ECONNRESET');
      resolve({
        host,
        dns: dnsResult,
        tcp: tlsFailed ? 'PASS' : 'FAIL',
        tls: tlsFailed ? 'FAIL' : 'FAIL',
        error: `${code}: ${err.message}`,
        latencyMs: Date.now() - start,
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({
        host,
        dns: dnsResult,
        tcp: 'FAIL',
        tls: 'FAIL',
        error: 'TIMEOUT',
        latencyMs: Date.now() - start,
      });
    });
    req.end();
  });
}

// ─── Unified Model Download Manager ──────────────────────────────────────────────────

type ProgressCallback = (progress: ModelDownloadProgress) => void;

interface ActiveDownload {
  id: string;
  model: DownloadableModel;
  state: DownloadState;
  currentSourceIndex: number;
  attempt: number;
  receivedBytes: number;
  totalBytes: number;
  startedAt: number;
  abortController: { aborted: boolean };
  sourcesAttempted: ModelSource[];
  failure?: DownloadFailureInfo;
}

class ModelDownloadManagerClass {
  private activeDownloads = new Map<string, ActiveDownload>();
  private progressCallback: ProgressCallback | null = null;
  private secureDownloader: SecureDownloader;

  constructor() {
    this.secureDownloader = new SecureDownloader(getDownloadSandboxDir());
  }

  setProgressCallback(cb: ProgressCallback): void {
    this.progressCallback = cb;
  }

  private emitProgress(download: ActiveDownload, extra?: Partial<ModelDownloadProgress>): void {
    if (!this.progressCallback) return;
    const elapsed = Date.now() - download.startedAt;
    const speed = elapsed > 0 ? (download.receivedBytes / elapsed) * 1000 : 0;
    const remaining = download.totalBytes > 0 ? download.totalBytes - download.receivedBytes : 0;
    const eta = speed > 0 ? (remaining / speed) * 1000 : -1;
    const percentage = download.totalBytes > 0 ? (download.receivedBytes / download.totalBytes) * 100 : null;
    const currentSource = download.model.sources[download.currentSourceIndex] || null;

    this.progressCallback({
      downloadId: download.id,
      modelId: download.model.id,
      modelName: download.model.name,
      state: download.state,
      currentSource,
      attempt: download.attempt + 1,
      maxAttempts: MAX_ATTEMPTS_PER_SOURCE,
      receivedBytes: download.receivedBytes,
      totalBytes: download.totalBytes,
      percentage,
      speed,
      elapsed,
      eta,
      stageMessage: this.getStateMessage(download.state),
      stageMessageFa: this.getStateMessageFa(download.state, currentSource),
      ...extra,
    });
  }

  private getStateMessage(state: DownloadState): string {
    const messages: Record<DownloadState, string> = {
      'queued': 'Queued',
      'resolving': 'Resolving source URL...',
      'connecting': 'Connecting to server...',
      'downloading': 'Downloading...',
      'retrying': 'Retrying...',
      'verifying': 'Verifying integrity...',
      'installing': 'Installing model...',
      'completed': 'Download complete',
      'download-failed': 'Download failed',
      'cancelled': 'Download cancelled',
      'permission-denied': 'Permission denied',
    };
    return messages[state] || state;
  }

  private getStateMessageFa(state: DownloadState, source?: ModelSource | null): string {
    const messages: Record<DownloadState, string> = {
      'queued': 'در صف',
      'resolving': 'در حال حل منبع...',
      'connecting': 'در حال اتصال به سرور...',
      'downloading': 'در حال دانلود...',
      'retrying': 'در حال تلاش مجدد...',
      'verifying': 'در حال بررسی یکپارچگی...',
      'installing': 'در حال نصب مدل...',
      'completed': 'دانلود کامل شد',
      'download-failed': 'دانلود ناموفق بود',
      'cancelled': 'دانلود لغو شد',
      'permission-denied': 'اجازه داده نشد',
    };
    return messages[state] || state;
  }

  /**
   * Start a model download. Returns a downloadId immediately.
   * The download runs asynchronously and emits progress events.
   */
  startDownload(model: DownloadableModel): string {
    const downloadId = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const download: ActiveDownload = {
      id: downloadId,
      model,
      state: 'queued',
      currentSourceIndex: 0,
      attempt: 0,
      receivedBytes: 0,
      totalBytes: 0,
      startedAt: Date.now(),
      abortController: { aborted: false },
      sourcesAttempted: [],
    };

    this.activeDownloads.set(downloadId, download);
    this.emitProgress(download);

    // Start async download
    this.executeDownload(download).catch((err) => {
      console.error(`[MODEL_DL] Unhandled error for ${downloadId}:`, err);
      download.state = 'download-failed';
      download.failure = {
        code: 'UNHANDLED',
        message: err?.message || String(err),
        stage: 'execute',
        host: '',
        source: '',
        sourceUrl: '',
        attempt: download.attempt,
        maxAttempts: MAX_ATTEMPTS_PER_SOURCE,
        bytesReceived: download.receivedBytes,
        bytesExpected: download.totalBytes,
        classification: 'UNKNOWN',
        timestamp: Date.now(),
      };
      this.emitProgress(download, { failure: download.failure });
    });

    return downloadId;
  }

  /**
   * Cancel a download. Aborts the current request and transitions to 'cancelled'.
   */
  cancelDownload(downloadId: string): void {
    const download = this.activeDownloads.get(downloadId);
    if (!download) return;
    download.abortController.aborted = true;
    download.state = 'cancelled';
    this.emitProgress(download);
  }

  /**
   * Get the current state of a download.
   */
  getDownloadState(downloadId: string): ActiveDownload | undefined {
    return this.activeDownloads.get(downloadId);
  }

  /**
   * Get all active downloads.
   */
  getActiveDownloads(): ActiveDownload[] {
    return Array.from(this.activeDownloads.values());
  }

  /**
   * Main download execution loop. Iterates through sources, attempts each
   * with bounded retries, falls back to next source on failure.
   */
  private async executeDownload(download: ActiveDownload): Promise<void> {
    const { model, abortController } = download;
    const sources = [...model.sources].sort((a, b) => a.priority - b.priority);

    console.log(`[MODEL_DL:${download.id}] Starting download — model: ${model.name} — sources: ${sources.length}`);

    let totalAttempts = 0;
    let lastFailure: DownloadFailureInfo | undefined;

    for (let sourceIdx = 0; sourceIdx < sources.length; sourceIdx++) {
      const source = sources[sourceIdx];
      download.currentSourceIndex = sourceIdx;
      download.sourcesAttempted.push(source);

      console.log(`[MODEL_DL:${download.id}] Source ${sourceIdx + 1}/${sources.length}: ${source.type} — ${source.label}`);
      console.log(`[MODEL_DL:${download.id}] URL: ${source.url.slice(0, 80)}...`);

      if (abortController.aborted) {
        download.state = 'cancelled';
        this.emitProgress(download);
        return;
      }

      // Try this source with bounded retries
      for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_SOURCE; attempt++) {
        download.attempt = attempt;
        totalAttempts++;

        if (totalAttempts > MAX_TOTAL_ATTEMPTS) {
          console.log(`[MODEL_DL:${download.id}] Max total attempts (${MAX_TOTAL_ATTEMPTS}) reached`);
          download.state = 'download-failed';
          download.failure = lastFailure;
          this.emitProgress(download, { failure: lastFailure });
          return;
        }

        if (abortController.aborted) {
          download.state = 'cancelled';
          this.emitProgress(download);
          return;
        }

        console.log(`[MODEL_DL:${download.id}] Attempt ${attempt + 1}/${MAX_ATTEMPTS_PER_SOURCE} on source ${source.type}`);

        // Download via SecureDownloader
        download.state = 'resolving';
        this.emitProgress(download);

        const partPath = path.join(getDownloadSandboxDir(), `${model.filename}.part`);

        const result = await this.secureDownloader.download({
          url: source.url,
          filename: `${model.filename}.part`,
          expectedSize: source.expectedSize,
          maxRetries: 0,  // We handle retries ourselves
          timeoutMs: 120_000,
          shouldAbort: () => abortController.aborted,
          onProgress: (p: DownloadProgress) => {
            download.state = 'downloading';
            download.receivedBytes = p.bytesDownloaded;
            download.totalBytes = p.totalBytes;
            this.emitProgress(download);
          },
        });

        if (result.success) {
          // Download succeeded — verify integrity
          console.log(`[MODEL_DL:${download.id}] Download succeeded — ${result.bytesDownloaded} bytes`);
          download.state = 'verifying';
          download.receivedBytes = result.bytesDownloaded;
          this.emitProgress(download);

          const integrity = await validateGgufIntegrity(partPath, source.expectedHash, source.expectedSize);
          if (integrity.passed) {
            console.log(`[MODEL_DL:${download.id}] Integrity verified — GGUF magic valid, hash: ${integrity.actualHash.slice(0, 16)}...`);

            // Install: atomic rename to models/ dir
            download.state = 'installing';
            this.emitProgress(download);

            const finalPath = path.join(getModelsDir(), model.filename);
            try {
              // Atomic rename (on same filesystem)
              if (fs.existsSync(finalPath)) {
                fs.unlinkSync(finalPath);
              }
              fs.renameSync(partPath, finalPath);
              console.log(`[MODEL_DL:${download.id}] Installed: ${finalPath}`);

              // Register in model registry
              const addOpts: AddModelOptions = {
                name: model.name,
                category: model.category,
                quantization: model.quantization,
                parameterCount: model.parameterCount,
                architecture: model.architecture,
                capabilities: ['chat', 'completion'] as any,
                source: source.type === 'huggingface' ? 'huggingface' : source.type === 'modelscope' ? 'custom' : 'custom',
                sourceUrl: source.url,
              };
              const registered = addModel(finalPath, addOpts);
              updateModel(registered.id, {
                hash: integrity.actualHash,
                hashAlgorithm: 'sha256',
                verifiedAt: Date.now(),
                integrityStatus: 'verified',
              });

              download.state = 'completed';
              this.emitProgress(download);
              console.log(`[MODEL_DL:${download.id}] COMPLETE — modelId: ${registered.id}`);
              return;
            } catch (err: any) {
              console.error(`[MODEL_DL:${download.id}] Install error:`, err);
              lastFailure = {
                code: 'INSTALL_ERROR',
                message: err?.message || String(err),
                stage: 'installing',
                host: '',
                source: source.type,
                sourceUrl: source.url,
                attempt: attempt + 1,
                maxAttempts: MAX_ATTEMPTS_PER_SOURCE,
                bytesReceived: download.receivedBytes,
                bytesExpected: download.totalBytes,
                classification: 'DISK_ERROR',
                timestamp: Date.now(),
              };
              // Don't retry install errors — break to next source
              break;
            }
          } else {
            // Integrity failure
            console.error(`[MODEL_DL:${download.id}] Integrity FAILED:`, integrity.error);
            lastFailure = {
              code: 'INTEGRITY_ERROR',
              message: integrity.error || 'Integrity check failed',
              stage: 'verifying',
              host: '',
              source: source.type,
              sourceUrl: source.url,
              attempt: attempt + 1,
              maxAttempts: MAX_ATTEMPTS_PER_SOURCE,
              bytesReceived: download.receivedBytes,
              bytesExpected: download.totalBytes,
              classification: 'INTEGRITY_ERROR',
              timestamp: Date.now(),
            };
            // Delete corrupt file and try next source
            try { fs.unlinkSync(partPath); } catch {}
            break;  // Don't retry integrity — try next source
          }
        }

        // Download failed — classify and decide retry vs fallback
        if (abortController.aborted) {
          download.state = 'cancelled';
          this.emitProgress(download);
          return;
        }

        // Extract host from URL for classification
        let failedHost = '';
        try { failedHost = new URL(source.url).hostname; } catch {}

        const classification = classifyFailure(
          { message: result.error, code: result.errorCode },
          failedHost,
        );

        console.log(`[MODEL_DL:${download.id}] Attempt ${attempt + 1} failed — ${classification}: ${result.error}`);

        lastFailure = {
          code: result.errorCode || 'UNKNOWN',
          message: result.error || 'Unknown error',
          stage: result.errorStage || 'download',
          host: result.errorHost || failedHost,
          source: source.type,
          sourceUrl: source.url,
          attempt: attempt + 1,
          maxAttempts: MAX_ATTEMPTS_PER_SOURCE,
          bytesReceived: result.bytesDownloaded || 0,
          bytesExpected: result.bytesExpected || source.expectedSize || 0,
          classification,
          timestamp: Date.now(),
        };

        // Check if we should retry this source
        if (!shouldRetry(classification)) {
          console.log(`[MODEL_DL:${download.id}] ${classification} — not retryable, trying next source`);
          break;  // Try next source
        }

        // Check if we should fallback to next source (CDN block, TLS failure)
        if (shouldFallbackToNextSource(classification) && sourceIdx < sources.length - 1) {
          console.log(`[MODEL_DL:${download.id}] ${classification} — falling back to next source`);
          break;  // Try next source
        }

        // Retry this source with backoff
        if (attempt < MAX_ATTEMPTS_PER_SOURCE - 1) {
          const waitMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), BACKOFF_MAX_MS);
          console.log(`[MODEL_DL:${download.id}] Retrying in ${waitMs}ms...`);
          download.state = 'retrying';
          this.emitProgress(download, { failure: lastFailure });
          await new Promise(r => setTimeout(r, waitMs));
        }
      }
    }

    // All sources exhausted
    console.log(`[MODEL_DL:${download.id}] All sources exhausted — FAILED`);
    download.state = 'download-failed';
    download.failure = lastFailure;
    this.emitProgress(download, { failure: lastFailure });
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────────────

let _instance: ModelDownloadManagerClass | null = null;

export function getModelDownloadManager(): ModelDownloadManagerClass {
  if (!_instance) {
    _instance = new ModelDownloadManagerClass();
  }
  return _instance;
}

export function _resetModelDownloadManager(): void {
  _instance = null;
}
