/**
 * NEX AI — Update Planner (Phase 43)
 *
 * Analyzes available updates and generates human-readable explanations.
 * NEVER downloads or installs anything — just plans and explains.
 */

import type { ActionDescriptor, PermissionLevel } from './permission-gate';
import { classifyAction, formatBytes } from './permission-gate';

export interface UpdateInfo {
  currentVersion: string;
  newVersion: string;
  downloadSizeBytes: number;
  changelog: string[];
  /** URL to download (for display only — actual download requires permission). */
  downloadUrl?: string;
  /** Expected SHA-256 hash of the download. */
  expectedHash?: string;
  /** Whether this is a security update. */
  isSecurityUpdate: boolean;
  /** Whether the update is optional. */
  isOptional: boolean;
}

export interface UpdatePlan {
  info: UpdateInfo;
  /** Human-readable explanation of what the update will do. */
  explanation: string;
  /** Steps that will be executed (each requires permission). */
  steps: Array<{
    action: ActionDescriptor;
    level: PermissionLevel;
    description: string;
  }>;
  /** Whether a backup will be created before the update. */
  requiresBackup: boolean;
  /** Whether a rollback is possible. */
  rollbackPossible: boolean;
}

export class UpdatePlanner {
  /**
   * Generate an update plan from UpdateInfo.
   * This does NOT execute anything — it just plans the steps.
   */
  planUpdate(info: UpdateInfo): UpdatePlan {
    const steps: UpdatePlan['steps'] = [];

    // Step 1: Download (REQUIRES_APPROVAL)
    steps.push({
      action: {
        type: 'download',
        description: `Download update v${info.newVersion}`,
        sizeBytes: info.downloadSizeBytes,
        reason: `Update from v${info.currentVersion} to v${info.newVersion}`,
        affectedItems: [info.downloadUrl || '(internal URL)'],
      },
      level: classifyAction({ type: 'download', description: '' }),
      description: `Download ${formatBytes(info.downloadSizeBytes)} for v${info.newVersion}`,
    });

    // Step 2: Verify hash (SAFE — no side effects)
    steps.push({
      action: {
        type: 'show-size',
        description: `Verify SHA-256 hash of downloaded file`,
        reason: 'Ensure the download is not corrupted or tampered with',
      },
      level: 'SAFE',
      description: 'Verify download integrity (SHA-256)',
    });

    // Step 3: Backup current version (SAFE — read-only copy)
    steps.push({
      action: {
        type: 'show-changelog',
        description: `Create backup of current version (v${info.currentVersion})`,
        reason: 'Enable rollback if the update fails',
      },
      level: 'SAFE',
      description: 'Create backup for rollback',
    });

    // Step 4: Install (REQUIRES_APPROVAL)
    steps.push({
      action: {
        type: 'install',
        description: `Install update v${info.newVersion}`,
        sizeBytes: info.downloadSizeBytes,
        reason: `Replace v${info.currentVersion} with v${info.newVersion}`,
        affectedItems: info.changelog.slice(0, 5),
      },
      level: classifyAction({ type: 'install', description: '' }),
      description: `Install v${info.newVersion}`,
    });

    // Step 5: Delete old files (HIGH_RISK) — only if needed
    if (info.downloadSizeBytes > 0) {
      steps.push({
        action: {
          type: 'delete-file',
          description: `Remove old version files (v${info.currentVersion})`,
          reason: `Clean up files from v${info.currentVersion} after successful install of v${info.newVersion}`,
        },
        level: 'HIGH_RISK',
        description: `Delete old version files (requires strong confirmation)`,
      });
    }

    return {
      info,
      explanation: this.generateExplanation(info),
      steps,
      requiresBackup: true,
      rollbackPossible: true,
    };
  }

  /**
   * Generate a human-readable explanation of the update.
   */
  private generateExplanation(info: UpdateInfo): string {
    const lines: string[] = [];
    lines.push(`یک آپدیت جدید پیدا کردم.`);
    lines.push('');
    lines.push(`نسخه فعلی:`);
    lines.push(`v${info.currentVersion}`);
    lines.push('');
    lines.push(`نسخه جدید:`);
    lines.push(`v${info.newVersion}`);
    lines.push('');
    lines.push(`حجم دانلود:`);
    lines.push(formatBytes(info.downloadSizeBytes));
    lines.push('');
    if (info.changelog.length > 0) {
      lines.push(`تغییرات:`);
      for (const change of info.changelog) {
        lines.push(`- ${change}`);
      }
      lines.push('');
    }
    if (info.isSecurityUpdate) {
      lines.push(`⚠️ این یک آپدیت امنیتی است.`);
    }
    if (info.isOptional) {
      lines.push(`این آپدیت اختیاری است.`);
    }
    lines.push('');
    lines.push(`آیا اجازه می‌دهی دانلود و نصب کنم؟`);
    lines.push('');
    lines.push(`لطفاً بگو:`);
    lines.push(`'تایید می‌کنم'`);
    lines.push(`یا در چت تایید کن.`);
    return lines.join('\n');
  }

  /**
   * Generate a deletion explanation for a specific file.
   */
  generateDeleteExplanation(filePath: string, reason: string, sizeBytes: number): string {
    const lines: string[] = [];
    lines.push(`NEX AI:`);
    lines.push('');
    lines.push(`برای نصب این نسخه نیاز است فایل قدیمی:`);
    lines.push('');
    lines.push(filePath);
    lines.push('');
    lines.push(`حذف شود.`);
    lines.push('');
    lines.push(`دلیل:`);
    lines.push(reason);
    lines.push('');
    lines.push(`حجم:`);
    lines.push(formatBytes(sizeBytes));
    lines.push('');
    lines.push(`آیا اجازه حذف می‌دهی؟`);
    lines.push('');
    lines.push(`(برای تایید، عبارت "تایید حذف فایل" را تایپ کنید)`);
    return lines.join('\n');
  }
}
