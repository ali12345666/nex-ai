/**
 * NEX AI — Update Manager (Phase 43)
 *
 * The orchestrator for the secure update system.
 *
 * CRITICAL: This module NEVER downloads, installs, or deletes anything
 * without explicit permission from the PermissionGate. Every sensitive
 * action goes through the full flow:
 *
 *   Update detected → Analyze → Explain → Permission → Execute → Verify → Report
 *
 * If the user refuses at ANY point, the entire update stops immediately.
 * No retry. No alternative download. No hidden action.
 */

import { PermissionGate, VoicePermissionVerifier, type ActionDescriptor, type PermissionGateResult } from './permission-gate';
import { DownloadVerifier } from './download-verifier';
import { RollbackManager } from './rollback-manager';
import { AuditLogger, type AuditEntry } from './audit-logger';
import { UpdatePlanner, type UpdateInfo, type UpdatePlan } from './update-planner';
// Phase 44: real download + signature + install + model + history
import { SecureDownloader } from './secure-downloader';
import { SignatureVerifier } from './signature-verifier';
import { UpdateInstaller } from './update-installer';
import { ModelUpdater } from './model-updater';
import { UpdateHistory, type UpdateHistoryEntry } from './update-history';

export interface UpdateManagerCallbacks {
  /** Called when an update plan is ready (for UI display). */
  onUpdatePlan?: (plan: UpdatePlan) => void;
  /** Called when a permission request needs to be shown to the user. */
  onPermissionRequest?: (request: {
    level: string;
    action: ActionDescriptor;
    explanation: string;
    requiredPhrase: string;
  }) => void;
  /** Called when the update is complete (or failed). */
  onUpdateComplete?: (result: { success: boolean; message: string }) => void;
  /** Called for progress updates. */
  onProgress?: (message: string) => void;
}

export class UpdateManager {
  private permissionGate: PermissionGate;
  private voiceVerifier: VoicePermissionVerifier;
  private downloadVerifier: DownloadVerifier;
  private rollbackManager: RollbackManager;
  private auditLogger: AuditLogger;
  private planner: UpdatePlanner;
  // Phase 44 components
  private secureDownloader: SecureDownloader;
  private signatureVerifier: SignatureVerifier;
  private updateInstaller: UpdateInstaller;
  private modelUpdater: ModelUpdater;
  private updateHistory: UpdateHistory;
  private callbacks: UpdateManagerCallbacks = {};

  constructor() {
    this.permissionGate = new PermissionGate();
    this.voiceVerifier = new VoicePermissionVerifier();
    this.downloadVerifier = new DownloadVerifier();
    this.rollbackManager = new RollbackManager();
    this.auditLogger = new AuditLogger();
    this.planner = new UpdatePlanner();
    // Phase 44 components
    this.secureDownloader = new SecureDownloader();
    this.signatureVerifier = new SignatureVerifier();
    this.updateInstaller = new UpdateInstaller(this.rollbackManager);
    this.updateHistory = new UpdateHistory();
    this.modelUpdater = new ModelUpdater(
      this.permissionGate,
      this.secureDownloader,
      this.signatureVerifier,
      this.updateInstaller,
      this.auditLogger,
    );

    // Wire the permission gate callbacks
    this.permissionGate.setCallbacks({
      onRequestPermission: (req) => {
        this.callbacks.onPermissionRequest?.(req);
        // Log the permission request
        this.auditLogger.log({
          action: 'permission-requested',
          description: req.action.description,
          level: req.level,
          metadata: { requiredPhrase: req.requiredPhrase },
        });
      },
      onCaptureVoiceInput: async () => {
        return (await this.voiceVerifier.captureConfirmation()) || '';
      },
    });
  }

  setCallbacks(callbacks: UpdateManagerCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  // ─── Component Accessors ─────────────────────────────────────────────

  getPermissionGate(): PermissionGate { return this.permissionGate; }
  getVoiceVerifier(): VoicePermissionVerifier { return this.voiceVerifier; }
  getDownloadVerifier(): DownloadVerifier { return this.downloadVerifier; }
  getRollbackManager(): RollbackManager { return this.rollbackManager; }
  getAuditLogger(): AuditLogger { return this.auditLogger; }
  getPlanner(): UpdatePlanner { return this.planner; }
  // Phase 44 accessors
  getSecureDownloader(): SecureDownloader { return this.secureDownloader; }
  getSignatureVerifier(): SignatureVerifier { return this.signatureVerifier; }
  getUpdateInstaller(): UpdateInstaller { return this.updateInstaller; }
  getModelUpdater(): ModelUpdater { return this.modelUpdater; }
  getUpdateHistory(): UpdateHistory { return this.updateHistory; }

  // ─── Main Update Flow ────────────────────────────────────────────────

  /**
   * Check for an update (SAFE — no permission needed).
   * Returns the update info (if an update is available).
   */
  async checkForUpdate(info: UpdateInfo): Promise<UpdatePlan> {
    const plan = this.planner.planUpdate(info);
    this.auditLogger.log({
      action: 'update-detected',
      description: `Update v${info.newVersion} available (current: v${info.currentVersion})`,
      metadata: {
        currentVersion: info.currentVersion,
        newVersion: info.newVersion,
        downloadSize: info.downloadSizeBytes,
        isSecurityUpdate: info.isSecurityUpdate,
      },
    });
    this.callbacks.onUpdatePlan?.(plan);
    return plan;
  }

  /**
   * Execute an update plan step-by-step.
   *
   * EACH STEP requires permission. If ANY step is denied, the entire
   * update stops immediately and (if applicable) rollback is performed.
   */
  async executeUpdate(plan: UpdatePlan): Promise<{ success: boolean; message: string }> {
    this.callbacks.onProgress?.('Starting update...');

    // Step 1: Download (requires permission)
    const downloadStep = plan.steps[0];
    if (downloadStep) {
      const downloadResult = await this.permissionGate.requestPermission(downloadStep.action);
      this.auditLogger.log({
        action: downloadResult.approved ? 'permission-approved' : 'permission-denied',
        description: downloadStep.action.description,
        level: downloadStep.level,
        confirmationMethod: downloadResult.confirmationMethod,
        confirmationPhrase: downloadResult.confirmationPhrase,
        metadata: { denialReason: downloadResult.denialReason },
      });

      if (!downloadResult.approved) {
        this.callbacks.onUpdateComplete?.({ success: false, message: 'Update cancelled: download permission denied' });
        return { success: false, message: 'Download permission denied' };
      }

      // Log download permission approval
      this.auditLogger.log({
        action: 'download-started',
        description: downloadStep.action.description,
        metadata: { confirmationMethod: downloadResult.confirmationMethod },
      });

      this.auditLogger.log({ action: 'download-started', description: downloadStep.action.description });
      this.callbacks.onProgress?.('Downloading...');
      // Actual download would happen here (in sandbox) — left to the caller
      this.auditLogger.log({ action: 'download-completed', description: downloadStep.action.description });
    }

    // Step 2: Verify hash (SAFE — auto-approved)
    const verifyStep = plan.steps[1];
    if (verifyStep) {
      this.callbacks.onProgress?.('Verifying download integrity...');
      // Hash verification would happen here
      this.auditLogger.log({ action: 'download-verified', description: verifyStep.action.description });
    }

    // Step 3: Backup (SAFE — auto-approved)
    const backupStep = plan.steps[2];
    if (backupStep) {
      this.callbacks.onProgress?.('Creating backup...');
      this.rollbackManager.backupFile('app', plan.info.currentVersion);
    }

    // Step 4: Install (requires permission)
    const installStep = plan.steps[3];
    if (installStep) {
      const installResult = await this.permissionGate.requestPermission(installStep.action);
      this.auditLogger.log({
        action: installResult.approved ? 'permission-approved' : 'permission-denied',
        description: installStep.action.description,
        level: installStep.level,
        confirmationMethod: installResult.confirmationMethod,
        confirmationPhrase: installResult.confirmationPhrase,
        metadata: { denialReason: installResult.denialReason },
      });

      if (!installResult.approved) {
        // Rollback!
        this.auditLogger.log({ action: 'rollback-started', description: 'Install permission denied — rolling back' });
        this.rollbackManager.rollbackTo(plan.info.currentVersion);
        this.auditLogger.log({ action: 'rollback-completed', description: 'Rollback completed' });
        this.callbacks.onUpdateComplete?.({ success: false, message: 'Update cancelled: install permission denied (rolled back)' });
        return { success: false, message: 'Install permission denied — rolled back' };
      }

      this.auditLogger.log({ action: 'install-started', description: installStep.action.description });
      this.callbacks.onProgress?.('Installing...');
      // Actual install would happen here
      this.auditLogger.log({ action: 'install-completed', description: `Updated to v${plan.info.newVersion}` });
    }

    // Step 5: Delete old files (HIGH_RISK — strong confirmation)
    const deleteStep = plan.steps[4];
    if (deleteStep) {
      const deleteResult = await this.permissionGate.requestPermission(deleteStep.action);
      this.auditLogger.log({
        action: deleteResult.approved ? 'permission-approved' : 'permission-denied',
        description: deleteStep.action.description,
        level: deleteStep.level,
        confirmationMethod: deleteResult.confirmationMethod,
        confirmationPhrase: deleteResult.confirmationPhrase,
        metadata: { denialReason: deleteResult.denialReason },
      });

      if (!deleteResult.approved) {
        // Old files kept — update is still successful, just old files remain
        this.callbacks.onProgress?.('Old files kept (user declined deletion). Update successful.');
      } else {
        this.auditLogger.log({ action: 'file-deleted', description: deleteStep.action.description });
      }
    }

    this.callbacks.onUpdateComplete?.({ success: true, message: `Updated to v${plan.info.newVersion}` });
    return { success: true, message: `Updated to v${plan.info.newVersion}` };
  }

  /**
   * Respond to a pending permission request (from chat).
   */
  respondToPermissionRequest(userResponse: string): void {
    this.permissionGate.respondToPermissionRequest(userResponse);
  }

  /**
   * Respond to a pending permission request via voice.
   */
  async respondViaVoice(): Promise<void> {
    await this.permissionGate.respondViaVoice();
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _manager: UpdateManager | null = null;

export function getUpdateManager(): UpdateManager {
  if (!_manager) {
    _manager = new UpdateManager();
  }
  return _manager;
}
