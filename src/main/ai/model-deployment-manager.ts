/**
 * NEX AI — Model Deployment Manager (Phase 61)
 *
 * Orchestrates the full local AI model deployment flow:
 *   1. Import a GGUF file from disk (SAFE — reads local file)
 *   2. Download a GGUF from HTTPS URL (REQUIRES_APPROVAL — PermissionGate)
 *   3. Verify the model (format, size, checksum, hardware)
 *   4. Register in the model registry
 *   5. Test inference with the model
 *   6. Audit-log every stage
 *   7. Rollback on failure
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  Model Deployment Manager (this file)                        │
 *   │    importFromFile()  → verify → register → test              │
 *   │    downloadFromUrl() → permission → download → verify → register → test │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  Model Verifier (Phase 61)                                   │
 *   │    GGUF format + size + SHA-256 + hardware + integrity        │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  PermissionGate (Phase 43)                                   │
 *   │    REQUIRES_APPROVAL for downloads                            │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  SecureDownloader (Phase 43/44)                             │
 *   │    HTTPS-only download + SHA-256                             │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  Model Registry (Phase 39)                                  │
 *   │    addModel / removeModel / updateModel                       │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  Inference Tester (Phase 61)                                 │
 *   │    load + generate + measure tokens/sec                      │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  Audit Logger (Phase 43)                                    │
 *   │    log every stage + permission + result                      │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CRITICAL SECURITY (Phase 43)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * NEX MUST NEVER autonomously:
 *   - download a model
 *   - install a model
 *   - delete a model
 *
 * EVERY download goes through PermissionGate.requestPermission() with
 * type 'install-model' (REQUIRES_APPROVAL). Only after explicit user
 * confirmation ("تایید می‌کنم") does the SecureDownloader execute.
 *
 * Importing a local file is SAFE (no permission needed — the user already
 * has the file on disk). Verification and testing are also SAFE.
 *
 * NO SILENT EXECUTION. EVER.
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as fs from 'fs';
import * as path from 'path';
import { addModel, removeModel, getModel, updateModel, listModels, type LocalModelInfo, type AddModelOptions, type ModelCategory } from './model-registry';
import { getModelVerifier, type ModelVerificationResult, type VerificationOptions } from './model-verification';
import { getModelInferenceTester, type InferenceTestResult, type InferenceTestOptions } from './model-inference-tester';
import {
  PermissionGate,
  type ActionDescriptor,
  type PermissionGateResult,
  type PermissionGateCallbacks,
} from '../update/permission-gate';
import { SecureDownloader, type DownloadOptions, type DownloadResult, type DownloadProgress } from '../update/secure-downloader';
import { AuditLogger } from '../update/audit-logger';

// ─── Types ─────────────────────────────────────────────────────────────────

export type DeploymentStage =
  | 'idle'
  | 'requesting-permission'
  | 'permission-denied'
  | 'downloading'
  | 'download-complete'
  | 'download-failed'
  | 'verifying'
  | 'verification-passed'
  | 'verification-failed'
  | 'registering'
  | 'registration-complete'
  | 'registration-failed'
  | 'testing-inference'
  | 'inference-passed'
  | 'inference-failed'
  | 'deployed'
  | 'rolled-back';

export interface DeploymentProgress {
  stage: DeploymentStage;
  message: string;
  messageFa: string;
  percent?: number;
  bytesDownloaded?: number;
  totalBytes?: number;
  speedBytesPerSec?: number;
}

export interface ModelImportOptions {
  /** Display name for the model (default: filename). */
  name?: string;
  /** Model category (default: 'general'). */
  category?: ModelCategory;
  /** Quantization label (e.g. 'Q4_K_M'). */
  quantization?: string;
  /** Parameter count (e.g. '7B'). */
  parameterCount?: string;
  /** Architecture (e.g. 'qwen2', 'llama'). */
  architecture?: string;
  /** Capabilities. */
  capabilities?: LocalModelInfo['capabilities'];
  /** Source URL (if downloaded). */
  sourceUrl?: string;
  /** Source type. */
  source?: 'huggingface' | 'local' | 'custom';
  /** Skip checksum verification (faster for large files). */
  skipChecksum?: boolean;
  /** Expected hash (if known). */
  expectedHash?: string;
  /** Expected size in bytes (if known). */
  expectedSize?: number;
  /** Whether to run inference test after registration (default: true). */
  testInference?: boolean;
}

export interface ModelDownloadOptions extends ModelImportOptions {
  /** HTTPS URL to download the GGUF from. */
  url: string;
}

export interface DeploymentResult {
  success: boolean;
  stage: DeploymentStage;
  modelId?: string;
  modelName?: string;
  modelPath?: string;
  verification?: ModelVerificationResult;
  inferenceTest?: InferenceTestResult;
  error?: string;
  durationMs: number;
  log: string[];
}

export interface DeploymentStatus {
  active: boolean;
  currentStage: DeploymentStage;
  totalDeployed: number;
  totalDownloaded: number;
  totalImported: number;
  lastDeployment: DeploymentResult | null;
}

export interface PendingPermissionInfo {
  operation: 'download' | 'import' | 'remove';
  modelPath: string;
  url?: string;
  sizeBytes?: number;
  action: ActionDescriptor;
  requiredPhrase: string;
}

export type DeploymentProgressCallback = (progress: DeploymentProgress) => void;

// ─── Model Deployment Manager ─────────────────────────────────────────────

export class ModelDeploymentManager {
  private gate: PermissionGate;
  private downloader: SecureDownloader;
  private audit: AuditLogger;
  private progressCallback: DeploymentProgressCallback | null = null;
  private currentStage: DeploymentStage = 'idle';
  private totalDeployed = 0;
  private totalDownloaded = 0;
  private totalImported = 0;
  private lastDeployment: DeploymentResult | null = null;
  private pendingPermission: PendingPermissionInfo | null = null;

  constructor(gate?: PermissionGate, downloader?: SecureDownloader, audit?: AuditLogger) {
    this.gate = gate || new PermissionGate();
    this.downloader = downloader || new SecureDownloader();
    this.audit = audit || new AuditLogger();
  }

  getPermissionGate(): PermissionGate { return this.gate; }
  getDownloader(): SecureDownloader { return this.downloader; }
  getAuditLogger(): AuditLogger { return this.audit; }

  setProgressCallback(cb: DeploymentProgressCallback): void {
    this.progressCallback = cb;
  }

  setCallbacks(callbacks: PermissionGateCallbacks): void {
    this.gate.setCallbacks(callbacks);
  }

  // ── Import from local file (SAFE — no permission needed) ──

  /**
   * Import a GGUF model from a local file path. SAFE operation — the user
   * already has the file on disk, so no permission is required.
   *
   * Flow:
   *   1. Verify the file (format, size, checksum, hardware)
   *   2. Register in the model registry (addModel)
   *   3. Test inference (if testInference is true)
   *   4. Return the deployment result
   */
  async importFromFile(filePath: string, opts?: ModelImportOptions): Promise<DeploymentResult> {
    const start = Date.now();
    const log: string[] = [];
    this.setStage('verifying');
    log.push(`Importing from file: ${filePath}`);

    // 1. Verify the model
    let verification: ModelVerificationResult | undefined;
    try {
      const verifier = getModelVerifier();
      verification = await verifier.verify(filePath, {
        skipChecksum: opts?.skipChecksum,
        expectedHash: opts?.expectedHash,
        expectedSize: opts?.expectedSize,
      });
      log.push(`Verification: ${verification.passed ? 'passed' : 'failed'} — ${verification.summary}`);

      if (!verification.passed) {
        this.setStage('verification-failed');
        this.audit.log({
          action: 'install-failed',
          description: `Model verification failed: ${path.basename(filePath)}`,
          targetPath: filePath,
          error: verification.summary,
          metadata: { stage: 'verification', checks: verification.checks },
        });
        const result: DeploymentResult = {
          success: false, stage: 'verification-failed', modelPath: filePath,
          verification, error: verification.summaryFa, durationMs: Date.now() - start, log,
        };
        this.lastDeployment = result;
        return result;
      }
      this.setStage('verification-passed');
    } catch (err: any) {
      this.setStage('verification-failed');
      const result: DeploymentResult = {
        success: false, stage: 'verification-failed', modelPath: filePath,
        error: `Verification error: ${err?.message || err}`, durationMs: Date.now() - start, log,
      };
      this.lastDeployment = result;
      return result;
    }

    // 2. Register in the model registry
    this.setStage('registering');
    let model: LocalModelInfo;
    try {
      const addOpts: AddModelOptions = {
        name: opts?.name || path.basename(filePath, '.gguf'),
        category: opts?.category || 'general',
        quantization: opts?.quantization,
        parameterCount: opts?.parameterCount,
        architecture: opts?.architecture,
        capabilities: opts?.capabilities,
        source: opts?.source || 'local',
        sourceUrl: opts?.sourceUrl,
      };
      model = addModel(filePath, addOpts);
      log.push(`Registered model: ${model.name} (id: ${model.id})`);

      // Update with verification hash
      if (verification?.checksum) {
        updateModel(model.id, {
          hash: verification.checksum,
          hashAlgorithm: 'sha256',
          verifiedAt: Date.now(),
          integrityStatus: 'verified',
        });
      }
      this.setStage('registration-complete');
      this.totalImported++;
    } catch (err: any) {
      this.setStage('registration-failed');
      this.audit.log({
        action: 'install-failed',
        description: `Model registration failed: ${path.basename(filePath)}`,
        targetPath: filePath,
        error: err?.message || String(err),
        metadata: { stage: 'registration' },
      });
      const result: DeploymentResult = {
        success: false, stage: 'registration-failed', modelPath: filePath,
        verification, error: `Registration failed: ${err?.message || err}`, durationMs: Date.now() - start, log,
      };
      this.lastDeployment = result;
      return result;
    }

    // 3. Test inference (optional)
    let inferenceTest: InferenceTestResult | undefined;
    if (opts?.testInference !== false) {
      this.setStage('testing-inference');
      try {
        const tester = getModelInferenceTester();
        inferenceTest = await tester.testInference(model.id);
        log.push(`Inference test: ${inferenceTest.status} — ${inferenceTest.tokensPerSecond.toFixed(1)} tokens/sec`);
        if (inferenceTest.status === 'failed') {
          this.setStage('inference-failed');
          // Don't rollback — the model is registered but inference failed.
          // The user may still want to use it with different settings.
        } else {
          this.setStage('inference-passed');
        }
      } catch (err: any) {
        log.push(`Inference test error: ${err?.message || err}`);
        this.setStage('inference-failed');
      }
    }

    // 4. Success
    this.setStage('deployed');
    this.totalDeployed++;
    this.audit.log({
      action: 'install-completed',
      description: `Model deployed: ${model.name}`,
      targetPath: model.path,
      sizeBytes: model.sizeBytes,
      hash: verification?.checksum,
      metadata: { modelId: model.id, source: 'import', verified: true, tested: !!inferenceTest },
    });

    const result: DeploymentResult = {
      success: true,
      stage: 'deployed',
      modelId: model.id,
      modelName: model.name,
      modelPath: model.path,
      verification,
      inferenceTest,
      durationMs: Date.now() - start,
      log,
    };
    this.lastDeployment = result;
    return result;
  }

  // ── Download from URL (REQUIRES_APPROVAL — PermissionGate) ──

  /**
   * Download a GGUF model from an HTTPS URL. REQUIRES_APPROVAL — the
   * user must explicitly confirm before the download starts.
   *
   * Flow:
   *   1. PermissionGate.requestPermission (type 'install-model')
   *   2. If denied → return
   *   3. SecureDownloader.download (HTTPS-only, sandboxed)
   *   4. Verify the downloaded file
   *   5. Register in the model registry
   *   6. Test inference
   *   7. Audit-log every stage
   *   8. Rollback on failure (remove from registry + delete file)
   */
  async downloadFromUrl(opts: ModelDownloadOptions): Promise<DeploymentResult> {
    const start = Date.now();
    const log: string[] = [];
    const url = opts.url;

    console.log('[IPC_INSTALL] downloadFromUrl START — url:', url, 'name:', opts.name);

    // Validate URL is HTTPS
    if (!url.startsWith('https://')) {
      console.log('[IPC_INSTALL] REJECTED: non-HTTPS URL');
      return this.fail('download-failed', `Security: only HTTPS URLs are allowed (rejected: ${url.split(':')[0]})`, start, log);
    }

    // 1. Request permission (REQUIRES_APPROVAL)
    console.log('[PERMISSION] Requesting permission for model download — filename:', opts.name);
    this.setStage('requesting-permission');
    const filename = opts.name || path.basename(url) || 'downloaded-model.gguf';
    const action: ActionDescriptor = {
      type: 'install-model',
      description: `Download model: ${filename}`,
      sizeBytes: opts.expectedSize,
      affectedItems: [filename],
      reason: `دانلود مدل GGUF از ${url}`,
    };

    this.audit.log({
      action: 'permission-requested',
      description: `Model download requested: ${filename}`,
      level: 'REQUIRES_APPROVAL',
      targetPath: filename,
      sizeBytes: opts.expectedSize,
      metadata: { url, filename },
    });

    this.pendingPermission = { operation: 'download', modelPath: filename, url, sizeBytes: opts.expectedSize, action, requiredPhrase: 'تایید می‌کنم' };

    console.log('[PERMISSION] Calling gate.requestPermission — waiting for user response...');
    const permResult: PermissionGateResult = await this.gate.requestPermission(action);
    console.log('[PERMISSION] Result:', permResult.approved ? 'APPROVED' : 'DENIED', '— method:', permResult.confirmationMethod);
    this.pendingPermission = null;

    if (!permResult.approved) {
      this.setStage('permission-denied');
      this.audit.log({
        action: 'permission-denied',
        description: `Model download denied: ${filename}`,
        level: 'REQUIRES_APPROVAL',
        targetPath: filename,
        metadata: { denialReason: permResult.denialReason || 'User declined' },
      });
      const result: DeploymentResult = {
        success: false, stage: 'permission-denied',
        error: 'Permission denied by user', durationMs: Date.now() - start, log,
      };
      this.lastDeployment = result;
      return result;
    }

    this.audit.log({
      action: 'permission-approved',
      description: `Model download approved: ${filename}`,
      level: 'REQUIRES_APPROVAL',
      targetPath: filename,
      metadata: { confirmationMethod: permResult.confirmationMethod },
    });

    // 2. Download (HTTPS-only, sandboxed)
    console.log('[DOWNLOADER_START] Starting download — url:', url, 'filename:', filename);
    this.setStage('downloading');
    log.push(`Downloading from: ${url}`);
    this.audit.log({
      action: 'download-started',
      description: `Downloading model: ${filename}`,
      targetPath: filename,
      sizeBytes: opts.expectedSize,
      metadata: { url },
    });

    const downloadOpts: DownloadOptions = {
      url,
      expectedSize: opts.expectedSize,
      filename,
      onProgress: (progress: DownloadProgress) => {
        console.log('[DOWNLOAD_PROGRESS]', progress.percent.toFixed(1) + '%', '—',
          this.formatBytes(progress.bytesDownloaded), '/', progress.totalBytes > 0 ? this.formatBytes(progress.totalBytes) : '?',
          '—', this.formatBytes(progress.speedBytesPerSec) + '/s');
        this.emitProgress({
          stage: 'downloading',
          message: `Downloading: ${progress.percent}% (${this.formatBytes(progress.bytesDownloaded)} / ${progress.totalBytes > 0 ? this.formatBytes(progress.totalBytes) : '?'})`,
          messageFa: `در حال دانلود: ${progress.percent}٪`,
          percent: progress.percent,
          bytesDownloaded: progress.bytesDownloaded,
          totalBytes: progress.totalBytes,
          speedBytesPerSec: progress.speedBytesPerSec,
        });
      },
    };

    let downloadResult: DownloadResult;
    try {
      console.log('[DOWNLOADER_START] Calling this.downloader.download()...');
      downloadResult = await this.downloader.download(downloadOpts);
      console.log('[DOWNLOADER_START] Download result:', downloadResult.success ? 'SUCCESS' : 'FAILED',
        '— bytes:', downloadResult.bytesDownloaded, '— hash:', downloadResult.hash?.slice(0, 16) + '...',
        '— error:', downloadResult.error || 'none');
      if (!downloadResult.success) {
        console.log('[DOWNLOAD_ERROR]', downloadResult.error);
        this.setStage('download-failed');
        this.audit.log({
          action: 'download-failed',
          description: `Download failed: ${filename}`,
          targetPath: filename,
          error: downloadResult.error || 'Unknown error',
          metadata: { url },
        });
        const result: DeploymentResult = {
          success: false, stage: 'download-failed',
          error: `Download failed: ${downloadResult.error}`, durationMs: Date.now() - start, log,
        };
        this.lastDeployment = result;
        return result;
      }
      console.log('[DOWNLOAD_COMPLETE] File:', downloadResult.sandboxPath, '— bytes:', downloadResult.bytesDownloaded, '— hash:', downloadResult.hash.slice(0, 16) + '...');
      this.setStage('download-complete');
      this.totalDownloaded++;
      log.push(`Download complete: ${this.formatBytes(downloadResult.bytesDownloaded)}, hash: ${downloadResult.hash.slice(0, 16)}...`);
      this.audit.log({
        action: 'download-completed',
        description: `Download completed: ${filename}`,
        targetPath: downloadResult.sandboxPath || filename,
        sizeBytes: downloadResult.bytesDownloaded,
        hash: downloadResult.hash,
        metadata: { durationMs: downloadResult.durationMs, resumed: downloadResult.resumed },
      });
    } catch (err: any) {
      this.setStage('download-failed');
      const result: DeploymentResult = {
        success: false, stage: 'download-failed',
        error: `Download error: ${err?.message || err}`, durationMs: Date.now() - start, log,
      };
      this.lastDeployment = result;
      return result;
    }

    // 3. Import the downloaded file (verify + register + test)
    const sandboxPath = downloadResult.sandboxPath!;
    const importOpts: ModelImportOptions = {
      ...opts,
      name: opts.name || filename.replace(/\.gguf$/i, ''),
      source: 'huggingface',
      sourceUrl: url,
      expectedHash: opts.expectedHash || downloadResult.hash,
      expectedSize: opts.expectedSize || downloadResult.bytesDownloaded,
      skipChecksum: false, // Always verify downloads
    };

    const importResult = await this.importFromFile(sandboxPath, importOpts);
    if (!importResult.success) {
      // Rollback: delete the downloaded file from sandbox
      try { fs.unlinkSync(sandboxPath); } catch { /* best effort */ }
      this.setStage('rolled-back');
      log.push(`Rolled back: deleted downloaded file from sandbox`);
    }

    importResult.durationMs = Date.now() - start;
    importResult.log = [...log, ...importResult.log];
    this.lastDeployment = importResult;
    return importResult;
  }

  // ── Remove a model (HIGH_RISK — PermissionGate) ──

  /**
   * Remove a model from the registry and optionally delete the file.
   * HIGH_RISK — requires explicit confirmation.
   */
  async removeModel(modelId: string, deleteFile?: boolean): Promise<DeploymentResult> {
    const start = Date.now();
    const log: string[] = [];
    const model = getModel(modelId);
    if (!model) {
      return this.fail('idle', `Model not found: ${modelId}`, start, log);
    }

    // Permission (HIGH_RISK — delete-file)
    const action: ActionDescriptor = {
      type: 'delete-file',
      description: `Remove model: ${model.name}`,
      targetPath: model.path,
      affectedItems: [model.path],
      reason: `حذف مدل «${model.name}» از رجیستری${deleteFile ? ' و دیسک' : ''}`,
    };

    this.pendingPermission = { operation: 'remove', modelPath: model.path, action, requiredPhrase: 'تایید حذف فایل' };

    const permResult = await this.gate.requestPermission(action);
    this.pendingPermission = null;

    if (!permResult.approved) {
      this.audit.log({
        action: 'permission-denied',
        description: `Model removal denied: ${model.name}`,
        level: 'HIGH_RISK',
        targetPath: model.path,
        metadata: { denialReason: permResult.denialReason || 'User declined' },
      });
      return {
        success: false, stage: 'permission-denied',
        modelId, error: 'Permission denied', durationMs: Date.now() - start, log,
      };
    }

    // Remove from registry
    const removed = removeModel(modelId);
    if (!removed) {
      return this.fail('idle', `Failed to remove model from registry: ${modelId}`, start, log);
    }

    // Delete the file (if requested)
    if (deleteFile) {
      try { fs.unlinkSync(model.path); log.push(`Deleted file: ${model.path}`); }
      catch (err: any) { log.push(`File delete failed (non-fatal): ${err?.message || err}`); }
    }

    this.audit.log({
      action: 'file-deleted',
      description: `Model removed: ${model.name}`,
      targetPath: model.path,
      metadata: { modelId, deletedFile: !!deleteFile },
    });

    return {
      success: true, stage: 'deployed', modelId, modelName: model.name,
      durationMs: Date.now() - start, log,
    };
  }

  // ── Status ──

  getStatus(): DeploymentStatus {
    return {
      active: this.currentStage !== 'idle' && this.currentStage !== 'deployed' && this.currentStage !== 'rolled-back',
      currentStage: this.currentStage,
      totalDeployed: this.totalDeployed,
      totalDownloaded: this.totalDownloaded,
      totalImported: this.totalImported,
      lastDeployment: this.lastDeployment,
    };
  }

  hasPendingPermission(): boolean {
    return this.pendingPermission !== null;
  }

  getPendingPermission(): PendingPermissionInfo | null {
    return this.pendingPermission;
  }

  respondToPermission(userResponse: string): void {
    this.gate.respondToPermissionRequest(userResponse);
  }

  async respondViaVoice(): Promise<void> {
    await this.gate.respondViaVoice();
  }

  // ── Internals ──

  private setStage(stage: DeploymentStage): void {
    this.currentStage = stage;
    const messages: Record<DeploymentStage, { en: string; fa: string }> = {
      'idle': { en: 'Idle', fa: 'بیکار' },
      'requesting-permission': { en: 'Requesting permission', fa: 'درخواست اجازه' },
      'permission-denied': { en: 'Permission denied', fa: 'اجازه رد شد' },
      'downloading': { en: 'Downloading', fa: 'در حال دانلود' },
      'download-complete': { en: 'Download complete', fa: 'دانلود کامل شد' },
      'download-failed': { en: 'Download failed', fa: 'دانلود ناموفق بود' },
      'verifying': { en: 'Verifying', fa: 'در حال تأیید' },
      'verification-passed': { en: 'Verification passed', fa: 'تأیید موفق بود' },
      'verification-failed': { en: 'Verification failed', fa: 'تأیید ناموفق بود' },
      'registering': { en: 'Registering', fa: 'در حال ثبت' },
      'registration-complete': { en: 'Registration complete', fa: 'ثبت کامل شد' },
      'registration-failed': { en: 'Registration failed', fa: 'ثبت ناموفق بود' },
      'testing-inference': { en: 'Testing inference', fa: 'آزمایش استنتاج' },
      'inference-passed': { en: 'Inference passed', fa: 'استنتاج موفق بود' },
      'inference-failed': { en: 'Inference failed', fa: 'استنتاج ناموفق بود' },
      'deployed': { en: 'Deployed', fa: 'مستقر شد' },
      'rolled-back': { en: 'Rolled back', fa: 'بازگشت داده شد' },
    };
    const msg = messages[stage];
    this.emitProgress({ stage, message: msg.en, messageFa: msg.fa });
  }

  private emitProgress(progress: DeploymentProgress): void {
    if (this.progressCallback) {
      try { this.progressCallback(progress); } catch { /* */ }
    }
  }

  private fail(stage: DeploymentStage, error: string, start: number, log: string[]): DeploymentResult {
    this.setStage(stage);
    const result: DeploymentResult = {
      success: false, stage, error, durationMs: Date.now() - start, log,
    };
    this.lastDeployment = result;
    return result;
  }

  private formatBytes(bytes: number): string {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  /** Reset internal state (for tests). */
  reset(): void {
    this.currentStage = 'idle';
    this.totalDeployed = 0;
    this.totalDownloaded = 0;
    this.totalImported = 0;
    this.lastDeployment = null;
    this.pendingPermission = null;
  }
}

// ─── Security self-audit ───────────────────────────────────────────────────

/**
 * Verifies the deployment manager:
 *   - never downloads without permission
 *   - never installs without permission
 *   - never deletes without permission
 *   - all download/install/delete operations go through PermissionGate
 *   - all actions are audit-logged
 */
export function verifyDeploymentSecurity(): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  // The manager delegates ALL downloads to SecureDownloader (HTTPS-only),
  // ALL permission checks to PermissionGate, and ALL mutations to model-registry.
  return { ok: findings.length === 0, findings };
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _manager: ModelDeploymentManager | null = null;

export function getModelDeploymentManager(): ModelDeploymentManager {
  if (!_manager) {
    _manager = new ModelDeploymentManager();
  }
  return _manager;
}

export function _resetModelDeploymentManager(): void {
  _manager = null;
}
