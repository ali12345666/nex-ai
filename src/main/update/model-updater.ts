/**
 * NEX AI — Model Updater (Phase 44)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Integrates model updates (GGUF, Whisper, Piper, Vision) with the Phase 39
 * Model Manager and Phase 43 PermissionGate.
 *
 * Before downloading a model, the user sees:
 *   "Model: Qwen
 *    Size: 7.2 GB
 *    Location: models/qwen.gguf
 *    آیا اجازه دانلود این مدل را می‌دهی؟"
 *
 * CRITICAL SECURITY:
 *   Model downloads go through the SAME PermissionGate as app updates.
 *   No model is downloaded without explicit user approval.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as path from 'path';
import { PermissionGate, formatBytes, type ActionDescriptor } from './permission-gate';
import { SecureDownloader } from './secure-downloader';
import { SignatureVerifier } from './signature-verifier';
import { UpdateInstaller } from './update-installer';
import { AuditLogger } from './audit-logger';

// ─── Types ─────────────────────────────────────────────────────────────────

export type ModelType = 'gguf' | 'whisper' | 'piper' | 'vision';

export interface ModelUpdateInfo {
  /** Model name (e.g. "Qwen 2.5 7B"). */
  name: string;
  /** Type of model. */
  type: ModelType;
  /** Download URL (HTTPS only). */
  url: string;
  /** File size in bytes. */
  sizeBytes: number;
  /** Expected SHA-256 hash. */
  expectedHash: string;
  /** Target directory (e.g. "models/"). */
  targetDir: string;
  /** Filename for the model. */
  filename: string;
  /** Optional signature for verification. */
  signature?: string;
}

export interface ModelUpdateResult {
  success: boolean;
  modelPath?: string;
  hash?: string;
  error?: string;
  durationMs: number;
}

// ─── Model Updater ──────────────────────────────────────────────────────────

export class ModelUpdater {
  private permissionGate: PermissionGate;
  private downloader: SecureDownloader;
  private verifier: SignatureVerifier;
  private installer: UpdateInstaller;
  private auditLogger: AuditLogger;

  constructor(
    permissionGate: PermissionGate,
    downloader: SecureDownloader,
    verifier: SignatureVerifier,
    installer: UpdateInstaller,
    auditLogger: AuditLogger,
  ) {
    this.permissionGate = permissionGate;
    this.downloader = downloader;
    this.verifier = verifier;
    this.installer = installer;
    this.auditLogger = auditLogger;
  }

  /**
   * Download and install a model.
   *
   * Flow:
   *   1. Request permission (shows model name + size + location to user)
   *   2. Download to sandbox (HTTPS only)
   *   3. Verify SHA-256 hash
   *   4. Install to target directory
   *
   * If ANY step fails → STOP. No retry. No hidden action.
   */
  async updateModel(info: ModelUpdateInfo): Promise<ModelUpdateResult> {
    const startMs = Date.now();

    // Step 1: Request permission
    const action: ActionDescriptor = {
      type: 'install-model',
      description: `Download model: ${info.name}`,
      sizeBytes: info.sizeBytes,
      reason: `Install ${info.type} model "${info.name}" (${formatBytes(info.sizeBytes)})`,
      affectedItems: [`${info.targetDir}/${info.filename}`],
    };

    this.auditLogger.log({
      action: 'permission-requested',
      description: action.description,
      level: 'REQUIRES_APPROVAL',
      metadata: {
        modelName: info.name,
        modelType: info.type,
        sizeBytes: info.sizeBytes,
        targetPath: `${info.targetDir}/${info.filename}`,
      },
    });

    const permResult = await this.permissionGate.requestPermission(action);

    this.auditLogger.log({
      action: permResult.approved ? 'permission-approved' : 'permission-denied',
      description: action.description,
      level: 'REQUIRES_APPROVAL',
      confirmationMethod: permResult.confirmationMethod,
      confirmationPhrase: permResult.confirmationPhrase,
      metadata: { denialReason: permResult.denialReason },
    });

    if (!permResult.approved) {
      return {
        success: false,
        error: 'Model download permission denied',
        durationMs: Date.now() - startMs,
      };
    }

    // Step 2: Download to sandbox
    this.auditLogger.log({
      action: 'download-started',
      description: `Downloading model: ${info.name}`,
      metadata: { url: info.url, sizeBytes: info.sizeBytes },
    });

    const downloadResult = await this.downloader.download({
      url: info.url,
      expectedSize: info.sizeBytes,
      filename: info.filename,
    });

    if (!downloadResult.success || !downloadResult.sandboxPath) {
      this.auditLogger.log({
        action: 'download-failed',
        description: `Model download failed: ${info.name}`,
        error: downloadResult.error,
      });
      return {
        success: false,
        error: downloadResult.error || 'Download failed',
        durationMs: Date.now() - startMs,
      };
    }

    this.auditLogger.log({
      action: 'download-completed',
      description: `Model downloaded: ${info.name}`,
      hash: downloadResult.hash,
      metadata: { bytesDownloaded: downloadResult.bytesDownloaded },
    });

    // Step 3: Verify SHA-256
    if (downloadResult.hash !== info.expectedHash) {
      this.auditLogger.log({
        action: 'download-failed',
        description: `Hash verification failed for model: ${info.name}`,
        hash: downloadResult.hash,
        error: `Expected ${info.expectedHash}, got ${downloadResult.hash}`,
      });
      return {
        success: false,
        error: `SHA-256 hash mismatch — file may be corrupted or tampered with`,
        durationMs: Date.now() - startMs,
      };
    }

    this.auditLogger.log({
      action: 'download-verified',
      description: `Model hash verified: ${info.name}`,
      hash: downloadResult.hash,
    });

    // Step 4: Install (copy to target directory)
    const installResult = await this.installer.install({
      method: 'model',
      sourcePath: downloadResult.sandboxPath,
      targetDir: info.targetDir,
      currentVersion: '0', // models don't have versions in the same way
      newVersion: info.name,
      createBackup: false, // models don't need backup (they're additive)
      verifyAfterInstall: true,
    });

    if (!installResult.success) {
      this.auditLogger.log({
        action: 'install-failed',
        description: `Model install failed: ${info.name}`,
        error: installResult.error,
      });
      return {
        success: false,
        error: installResult.error || 'Installation failed',
        durationMs: Date.now() - startMs,
      };
    }

    this.auditLogger.log({
      action: 'install-completed',
      description: `Model installed: ${info.name}`,
      targetPath: `${info.targetDir}/${info.filename}`,
      metadata: { modelType: info.type, hash: downloadResult.hash },
    });

    return {
      success: true,
      modelPath: path.join(info.targetDir, info.filename),
      hash: downloadResult.hash,
      durationMs: Date.now() - startMs,
    };
  }

  /**
   * Generate a human-readable explanation for a model update.
   */
  generateModelExplanation(info: ModelUpdateInfo): string {
    const lines: string[] = [];
    lines.push('NEX AI:');
    lines.push('');
    lines.push('Model:');
    lines.push(info.name);
    lines.push('');
    lines.push('Size:');
    lines.push(formatBytes(info.sizeBytes));
    lines.push('');
    lines.push('Location:');
    lines.push(`${info.targetDir}/${info.filename}`);
    lines.push('');
    lines.push('Type:');
    lines.push(info.type);
    lines.push('');
    lines.push('آیا اجازه دانلود این مدل را می‌دهی؟');
    return lines.join('\n');
  }
}
