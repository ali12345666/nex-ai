/**
 * NEX AI — Audit Logger (Phase 43)
 *
 * Logs ALL permission requests (approved + rejected) and update actions.
 * This is a permanent audit trail — never deleted automatically.
 *
 * Storage: <userData>/audit/audit-log.jsonl (JSON Lines format)
 */

import * as fs from 'fs';
import * as path from 'path';
import { getUserDataDir } from '../persistence';

export type AuditAction =
  | 'permission-requested'
  | 'permission-approved'
  | 'permission-denied'
  | 'update-detected'
  | 'download-started'
  | 'download-completed'
  | 'download-verified'
  | 'download-failed'
  | 'install-started'
  | 'install-completed'
  | 'install-failed'
  | 'rollback-started'
  | 'rollback-completed'
  | 'rollback-failed'
  | 'file-deleted'
  | 'file-modified'
  | 'config-changed';

export interface AuditEntry {
  id: string;
  timestamp: number;
  action: AuditAction;
  /** What the action was about (e.g. "update v1.1.0"). */
  description: string;
  /** Permission level (if a permission request). */
  level?: string;
  /** How the user confirmed (chat/voice/denied). */
  confirmationMethod?: string;
  /** The phrase the user used (if confirmed). */
  confirmationPhrase?: string;
  /** Target path (if applicable). */
  targetPath?: string;
  /** Size (if applicable). */
  sizeBytes?: number;
  /** SHA-256 hash (if applicable). */
  hash?: string;
  /** Error message (if the action failed). */
  error?: string;
  /** Additional metadata. */
  metadata?: Record<string, any>;
}

export class AuditLogger {
  private logPath: string;

  constructor() {
    const auditDir = path.join(getUserDataDir(), 'audit');
    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }
    this.logPath = path.join(auditDir, 'audit-log.jsonl');
  }

  /**
   * Append an audit entry to the log.
   * Uses append mode (atomic per-line writes, crash-safe).
   */
  log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void {
    const fullEntry: AuditEntry = {
      ...entry,
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    };
    try {
      fs.appendFileSync(this.logPath, JSON.stringify(fullEntry) + '\n', 'utf-8');
    } catch {
      // best-effort — don't crash the app if audit logging fails
    }
  }

  /**
   * Read the last N audit entries.
   */
  readRecent(limit: number = 50): AuditEntry[] {
    try {
      if (!fs.existsSync(this.logPath)) return [];
      const data = fs.readFileSync(this.logPath, 'utf-8');
      const lines = data.trim().split('\n').filter(Boolean);
      const entries: AuditEntry[] = [];
      for (const line of lines) {
        try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
      return entries.slice(-limit).reverse();
    } catch {
      return [];
    }
  }

  /**
   * Read all entries of a specific action type.
   */
  readByAction(action: AuditAction, limit: number = 50): AuditEntry[] {
    return this.readRecent(1000).filter((e) => e.action === action).slice(0, limit);
  }

  /**
   * Get update history (all update-related entries).
   */
  getUpdateHistory(): AuditEntry[] {
    const updateActions: AuditAction[] = [
      'update-detected', 'download-started', 'download-completed',
      'download-verified', 'download-failed', 'install-started',
      'install-completed', 'install-failed', 'rollback-started',
      'rollback-completed', 'rollback-failed',
    ];
    return this.readRecent(500).filter((e) => updateActions.includes(e.action));
  }

  /**
   * Get permission history (all approved + rejected).
   */
  getPermissionHistory(): AuditEntry[] {
    return this.readRecent(500).filter((e) =>
      e.action === 'permission-approved' || e.action === 'permission-denied'
    );
  }

  get logFilePath(): string {
    return this.logPath;
  }
}
