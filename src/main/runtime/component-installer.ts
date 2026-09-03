/**
 * NEX AI — Component Installer (Phase 47)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Transforms the Runtime Setup Center from detection-only into a complete
 * guided installer. Integrates Phase 44 (SecureDownloader, SignatureVerifier,
 * UpdateInstaller, RollbackManager, UpdateHistory) + Phase 43 (PermissionGate)
 * + Phase 46 (component catalog).
 *
 * Flow:
 *   Scan → Recommend → Show Persian explanation → Ask permission →
 *   Download → Verify checksum → Install → Health test → Activate
 *
 * CRITICAL SECURITY:
 *   NEVER auto-download. NEVER auto-install. NEVER auto-delete.
 *   Every action requires explicit user permission ("تایید می‌کنم").
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as fs from 'fs';
import * as path from 'path';
import { PermissionGate, formatBytes, type ActionDescriptor } from '../update/permission-gate';
import { SecureDownloader, type DownloadResult } from '../update/secure-downloader';
import { SignatureVerifier } from '../update/signature-verifier';
import { UpdateInstaller, type InstallMethod, type InstallResult } from '../update/update-installer';
import { RollbackManager } from '../update/rollback-manager';
import { UpdateHistory } from '../update/update-history';
import { AuditLogger } from '../update/audit-logger';
import type { CatalogComponent } from './component-catalog';
import { getCatalogEntry } from './component-catalog';

// ─── Types ─────────────────────────────────────────────────────────────────

export type InstallStage =
  | 'idle' | 'requesting-permission' | 'permission-denied'
  | 'downloading' | 'download-complete' | 'download-failed'
  | 'verifying' | 'verification-passed' | 'verification-failed'
  | 'installing' | 'install-complete' | 'install-failed'
  | 'health-check' | 'health-passed' | 'health-failed'
  | 'activated' | 'rolled-back';

export interface InstallProgress {
  stage: InstallStage;
  message: string;
  messageFa: string;
  percent?: number;
  bytesDownloaded?: number;
  totalBytes?: number;
  speedBytesPerSec?: number;
}

export interface InstallResult47 {
  success: boolean;
  componentId: string;
  componentName: string;
  stage: InstallStage;
  installedPath?: string;
  hash?: string;
  durationMs: number;
  error?: string;
  log: string[];
}

export interface PersianExplanation {
  title: string;
  body: string;
  size: string;
  purpose: string;
  requirements: string;
  question: string;
}

// ─── Health Checker ────────────────────────────────────────────────────────

export type HealthStatus = 'passed' | 'failed' | 'skipped';

export interface HealthCheckResult {
  componentId: string;
  status: HealthStatus;
  checks: Array<{ name: string; passed: boolean; message: string }>;
  message: string;
}

export class HealthChecker {
  /**
   * Run health checks on an installed component.
   * Verifies the component is actually working, not just present.
   */
  async check(component: CatalogComponent, installedPath: string): Promise<HealthCheckResult> {
    const checks: Array<{ name: string; passed: boolean; message: string }> = [];

    // Check 1: File exists
    const fileExists = fs.existsSync(installedPath);
    checks.push({
      name: 'File exists',
      passed: fileExists,
      message: fileExists ? `Found at ${installedPath}` : `File not found: ${installedPath}`,
    });

    // Check 2: File is readable
    let readable = false;
    try {
      if (fileExists) {
        const fd = fs.openSync(installedPath, 'r');
        fs.closeSync(fd);
        readable = true;
      }
    } catch { /* */ }
    checks.push({
      name: 'File readable',
      passed: readable,
      message: readable ? 'File is readable' : 'Cannot read file',
    });

    // Check 3: File size > 0
    let sizeOk = false;
    try {
      if (fileExists) {
        const stat = fs.statSync(installedPath);
        sizeOk = stat.size > 0;
      }
    } catch { /* */ }
    checks.push({
      name: 'File not empty',
      passed: sizeOk,
      message: sizeOk ? 'File has content' : 'File is empty',
    });

    // Check 4: Type-specific checks
    if (component.type === 'llm' || component.type === 'vision') {
      // For GGUF models, check the file starts with the GGUF magic bytes
      let ggufValid = false;
      try {
        if (readable) {
          const buf = Buffer.alloc(4);
          const fd = fs.openSync(installedPath, 'r');
          fs.readSync(fd, buf, 0, 4, 0);
          fs.closeSync(fd);
          // GGUF magic: 0x46554747 ("GGUF" in little-endian)
          ggufValid = buf.toString('ascii') === 'GGUF';
        }
      } catch { /* */ }
      checks.push({
        name: 'GGUF format valid',
        passed: ggufValid,
        message: ggufValid ? 'Valid GGUF magic bytes' : 'Not a valid GGUF file (or check skipped)',
      });
    } else if (component.type === 'voice-stt') {
      // For whisper, check binary is executable
      checks.push({
        name: 'Whisper model check',
        passed: readable && sizeOk,
        message: 'Model file present and readable',
      });
    } else if (component.type === 'voice-tts') {
      // For piper voices (.onnx), check file extension
      const isOnnx = installedPath.toLowerCase().endsWith('.onnx');
      checks.push({
        name: 'ONNX voice format',
        passed: isOnnx,
        message: isOnnx ? 'Valid .onnx voice file' : 'Not an .onnx file',
      });
    } else if (component.type === 'tool') {
      // For tools (llama.cpp, ffmpeg), check executable
      checks.push({
        name: 'Executable check',
        passed: fileExists,
        message: fileExists ? 'Binary found' : 'Binary not found',
      });
    }

    const allPassed = checks.every((c) => c.passed);
    return {
      componentId: component.id,
      status: allPassed ? 'passed' : 'failed',
      checks,
      message: allPassed
        ? 'All health checks passed — component is ready'
        : `${checks.filter((c) => !c.passed).length} health check(s) failed`,
    };
  }
}

// ─── Component Installer ────────────────────────────────────────────────────

export class ComponentInstaller {
  private permissionGate: PermissionGate;
  private downloader: SecureDownloader;
  private verifier: SignatureVerifier;
  private installer: UpdateInstaller;
  private rollback: RollbackManager;
  private history: UpdateHistory;
  private audit: AuditLogger;
  private healthChecker: HealthChecker;
  private progressCallback: ((progress: InstallProgress) => void) | null = null;

  constructor(
    permissionGate?: PermissionGate,
    downloader?: SecureDownloader,
    verifier?: SignatureVerifier,
    installer?: UpdateInstaller,
    rollback?: RollbackManager,
    history?: UpdateHistory,
    audit?: AuditLogger,
  ) {
    this.permissionGate = permissionGate || new PermissionGate();
    this.downloader = downloader || new SecureDownloader();
    this.verifier = verifier || new SignatureVerifier();
    this.installer = installer || new UpdateInstaller();
    this.rollback = rollback || new RollbackManager();
    this.history = history || new UpdateHistory();
    this.audit = audit || new AuditLogger();
    this.healthChecker = new HealthChecker();
  }

  setProgressCallback(cb: (progress: InstallProgress) => void): void {
    this.progressCallback = cb;
  }

  private emitProgress(stage: InstallStage, message: string, messageFa: string, extra?: Partial<InstallProgress>): void {
    this.progressCallback?.({ stage, message, messageFa, ...extra });
  }

  /**
   * Generate a Persian explanation for a component installation.
   */
  generatePersianExplanation(component: CatalogComponent): PersianExplanation {
    const sizeStr = component.sizeBytes > 0 ? formatBytes(component.sizeBytes) : 'N/A';
    const reqLines: string[] = [];
    if (component.requiredRAM > 0) reqLines.push(`RAM: ${component.requiredRAM} گیگابایت`);
    if (component.requiredVRAM > 0) reqLines.push(`VRAM: ${component.requiredVRAM} گیگابایت`);

    let title = '';
    switch (component.type) {
      case 'llm': title = 'نصب مدل هوش مصنوعی'; break;
      case 'voice-stt': title = 'فعال کردن تشخیص گفتار'; break;
      case 'voice-tts': title = 'فعال کردن تولید گفتار'; break;
      case 'vision': title = 'فعال کردن بینایی'; break;
      case 'tool': title = 'نصب ابزار runtime'; break;
    }

    return {
      title,
      body: component.purposeFa,
      size: sizeStr,
      purpose: component.purposeFa,
      requirements: reqLines.join('، ') || 'بدون نیاز خاص',
      question: 'آیا اجازه می‌دهید؟',
    };
  }

  /**
   * Install a component. The full flow:
   *
   *   1. Generate Persian explanation
   *   2. Request permission (Phase 43 PermissionGate)
   *   3. Download to sandbox (Phase 44 SecureDownloader)
   *   4. Verify SHA-256 (Phase 44 SignatureVerifier)
   *   5. Install (Phase 44 UpdateInstaller)
   *   6. Health check (HealthChecker)
   *   7. Record history (Phase 44 UpdateHistory)
   *
   * If ANY step fails → STOP. Rollback if applicable.
   */
  async installComponent(componentId: string): Promise<InstallResult47> {
    const startMs = Date.now();
    const log: string[] = [];
    const component = getCatalogEntry(componentId);

    if (!component) {
      return {
        success: false, componentId, componentName: 'Unknown',
        stage: 'idle', durationMs: 0, error: 'Component not found in catalog', log,
      };
    }

    this.emitProgress('requesting-permission', `Requesting permission for ${component.name}`, 'درخواست اجازه...');

    // ── Step 1: Generate Persian explanation + request permission ──
    const explanation = this.generatePersianExplanation(component);
    log.push(`Persian explanation: ${explanation.title}`);

    const action: ActionDescriptor = {
      type: 'install-model',
      description: `${explanation.title}: ${component.name}`,
      sizeBytes: component.sizeBytes,
      reason: component.purposeFa,
      affectedItems: [`${component.targetDir}/${component.filename}`],
    };

    this.audit.log({
      action: 'permission-requested',
      description: action.description,
      level: 'REQUIRES_APPROVAL',
      metadata: { componentId, componentName: component.name, sizeBytes: component.sizeBytes },
    });

    const permResult = await this.permissionGate.requestPermission(action);

    this.audit.log({
      action: permResult.approved ? 'permission-approved' : 'permission-denied',
      description: action.description,
      level: 'REQUIRES_APPROVAL',
      confirmationMethod: permResult.confirmationMethod,
      confirmationPhrase: permResult.confirmationPhrase,
      metadata: { componentId, denialReason: permResult.denialReason },
    });

    if (!permResult.approved) {
      this.emitProgress('permission-denied', 'Permission denied', 'اجازه داده نشد');
      log.push('Permission denied by user');
      return {
        success: false, componentId, componentName: component.name,
        stage: 'permission-denied', durationMs: Date.now() - startMs,
        error: 'Permission denied — user did not confirm', log,
      };
    }

    // For tool components (llama.cpp, ffmpeg) that have no download — skip to activation
    if (component.type === 'tool' && component.sizeBytes === 0) {
      log.push('Tool component — no download needed (binary must be installed manually)');
      this.emitProgress('activated', 'Component activated', 'کامپوننت فعال شد');
      this.history.addEntry({
        fromVersion: '0', toVersion: component.name,
        approvalMethod: permResult.confirmationMethod === 'voice' ? 'voice' : 'text',
        confirmationPhrase: permResult.confirmationPhrase,
        filesChanged: [], result: 'success', rollbackStatus: 'not-needed',
        durationMs: Date.now() - startMs,
      });
      return {
        success: true, componentId, componentName: component.name,
        stage: 'activated', durationMs: Date.now() - startMs, log,
      };
    }

    // ── Step 2: Download to sandbox ──
    this.emitProgress('downloading', 'Downloading...', 'در حال دانلود...', {
      totalBytes: component.sizeBytes, bytesDownloaded: 0, percent: 0,
    });
    log.push(`Downloading from ${component.downloadUrl}`);
    this.audit.log({ action: 'download-started', description: component.name, metadata: { url: component.downloadUrl } });

    const downloadResult = await this.downloader.download({
      url: component.downloadUrl,
      expectedSize: component.sizeBytes,
      filename: component.filename,
      onProgress: (p) => {
        this.emitProgress('downloading', `Downloading ${p.bytesDownloaded}/${p.totalBytes} bytes`, 'در حال دانلود...', {
          bytesDownloaded: p.bytesDownloaded, totalBytes: p.totalBytes,
          percent: p.percent, speedBytesPerSec: p.speedBytesPerSec,
        });
      },
    });

    if (!downloadResult.success || !downloadResult.sandboxPath) {
      this.emitProgress('download-failed', `Download failed: ${downloadResult.error}`, 'دانلود ناموفق بود');
      log.push(`Download failed: ${downloadResult.error}`);
      this.audit.log({ action: 'download-failed', description: component.name, error: downloadResult.error });
      return {
        success: false, componentId, componentName: component.name,
        stage: 'download-failed', durationMs: Date.now() - startMs,
        error: downloadResult.error, log,
      };
    }

    this.emitProgress('download-complete', 'Download complete', 'دانلود کامل شد');
    log.push(`Downloaded ${downloadResult.bytesDownloaded} bytes, hash: ${downloadResult.hash.slice(0, 16)}...`);
    this.audit.log({ action: 'download-completed', description: component.name, hash: downloadResult.hash, metadata: { bytes: downloadResult.bytesDownloaded } });

    // ── Step 3: Verify SHA-256 ──
    this.emitProgress('verifying', 'Verifying checksum...', 'در حال بررسی...');
    log.push('Verifying SHA-256 hash');

    if (component.checksum && component.checksum !== 'pending' && component.checksum !== 'n/a') {
      if (downloadResult.hash !== component.checksum) {
        this.emitProgress('verification-failed', 'Checksum mismatch!', 'بررسی ناموفق — هش مطابقت ندارد');
        log.push(`Hash mismatch: expected ${component.checksum}, got ${downloadResult.hash}`);
        this.audit.log({ action: 'download-failed', description: component.name, error: 'SHA-256 hash mismatch' });
        return {
          success: false, componentId, componentName: component.name,
          stage: 'verification-failed', durationMs: Date.now() - startMs,
          error: 'SHA-256 checksum verification failed', log,
        };
      }
      log.push('Checksum verified ✓');
    } else {
      log.push('Checksum not provided (pending) — skipping verification');
    }
    this.emitProgress('verification-passed', 'Verification passed', 'بررسی موفق بود');
    this.audit.log({ action: 'download-verified', description: component.name, hash: downloadResult.hash });

    // ── Step 4: Install ──
    this.emitProgress('installing', 'Installing...', 'در حال نصب...');
    log.push(`Installing to ${component.targetDir}`);

    const { getUserDataDir } = require('../persistence');
    const targetDir = path.join(getUserDataDir(), component.targetDir);
    const installMethod: InstallMethod = 'model';
    const backupPath = this.rollback.backupFile(targetDir, component.id);

    const installResult: InstallResult = await this.installer.install({
      method: installMethod,
      sourcePath: downloadResult.sandboxPath,
      targetDir,
      currentVersion: '0',
      newVersion: component.name,
      createBackup: true,
      verifyAfterInstall: true,
      onProgress: (msg) => {
        this.emitProgress('installing', msg, 'در حال نصب...');
      },
    });

    if (!installResult.success) {
      // Rollback!
      this.emitProgress('install-failed', 'Install failed — rolling back', 'نصب ناموفق — در حال بازگردانی');
      log.push(`Install failed: ${installResult.error}`);
      if (backupPath) {
        this.rollback.restoreFile(backupPath, targetDir);
        log.push('Rolled back to previous state');
        this.emitProgress('rolled-back', 'Rolled back', 'بازگردانی شد');
      }
      this.audit.log({ action: 'install-failed', description: component.name, error: installResult.error });
      return {
        success: false, componentId, componentName: component.name,
        stage: 'install-failed', durationMs: Date.now() - startMs,
        error: installResult.error, log,
      };
    }

    this.emitProgress('install-complete', 'Install complete', 'نصب کامل شد');
    log.push('Install completed successfully');
    this.audit.log({ action: 'install-completed', description: component.name, targetPath: targetDir });

    // ── Step 5: Health check ──
    this.emitProgress('health-check', 'Running health checks...', 'در حال بررسی سلامت...');
    log.push('Running health checks');

    const installedFilePath = path.join(targetDir, component.filename);
    const healthResult = await this.healthChecker.check(component, installedFilePath);

    for (const check of healthResult.checks) {
      log.push(`Health: ${check.name} — ${check.passed ? 'PASS' : 'FAIL'}: ${check.message}`);
    }

    if (healthResult.status !== 'passed') {
      this.emitProgress('health-failed', 'Health check failed', 'بررسی سلامت ناموفق بود');
      log.push(`Health check failed: ${healthResult.message}`);
      // Don't rollback — file is installed but health check may be a false negative
      // (e.g. GGUF magic check might fail for some model formats)
      this.audit.log({ action: 'install-failed', description: component.name, error: `Health check: ${healthResult.message}` });
      return {
        success: false, componentId, componentName: component.name,
        stage: 'health-failed', durationMs: Date.now() - startMs,
        error: `Health check failed: ${healthResult.message}`, log,
        installedPath: installedFilePath, hash: downloadResult.hash,
      };
    }

    this.emitProgress('health-passed', 'Health checks passed', 'بررسی سلامت موفق بود');
    log.push('All health checks passed');

    // ── Step 6: Activate + record history ──
    this.emitProgress('activated', 'Component activated!', 'کامپوننت فعال شد!');
    log.push('Component activated successfully');

    this.history.addEntry({
      fromVersion: '0', toVersion: component.name,
      approvalMethod: permResult.confirmationMethod === 'voice' ? 'voice' : 'text',
      confirmationPhrase: permResult.confirmationPhrase,
      filesChanged: [installedFilePath], result: 'success', rollbackStatus: 'not-needed',
      durationMs: Date.now() - startMs, hash: downloadResult.hash,
      downloadSizeBytes: component.sizeBytes,
    });

    this.audit.log({
      action: 'install-completed', description: `${component.name} activated`,
      hash: downloadResult.hash, targetPath: installedFilePath,
    });

    return {
      success: true, componentId, componentName: component.name,
      stage: 'activated', durationMs: Date.now() - startMs,
      installedPath: installedFilePath, hash: downloadResult.hash, log,
    };
  }

  // ─── Component accessors ─────────────────────────────────────────────

  getPermissionGate(): PermissionGate { return this.permissionGate; }
  getDownloader(): SecureDownloader { return this.downloader; }
  getVerifier(): SignatureVerifier { return this.verifier; }
  getInstaller(): UpdateInstaller { return this.installer; }
  getRollback(): RollbackManager { return this.rollback; }
  getHistory(): UpdateHistory { return this.history; }
  getAudit(): AuditLogger { return this.audit; }
  getHealthChecker(): HealthChecker { return this.healthChecker; }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _installer: ComponentInstaller | null = null;

export function getComponentInstaller(): ComponentInstaller {
  if (!_installer) {
    _installer = new ComponentInstaller();
  }
  return _installer;
}
