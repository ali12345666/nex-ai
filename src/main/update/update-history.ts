/**
 * NEX AI — Update History (Phase 44)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Stores a permanent record of all updates (successful + failed + rolled back).
 *
 * Storage: <userData>/update-history.json
 *
 * Records:
 *   - version (from → to)
 *   - date
 *   - user approval method (voice / text)
 *   - files changed
 *   - result (success / failure / rollback)
 *   - rollback status
 *
 * This is SEPARATE from the AuditLogger — the audit log is a low-level
 * event trail (every permission request, every download start/stop).
 * The update history is a high-level summary (one entry per update).
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as fs from 'fs';
import * as path from 'path';
import { getUserDataDir } from '../persistence';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface UpdateHistoryEntry {
  /** Unique ID for this update attempt. */
  id: string;
  /** When the update was attempted (ISO timestamp). */
  date: string;
  /** Previous version. */
  fromVersion: string;
  /** Target version. */
  toVersion: string;
  /** How the user approved (voice / text / denied). */
  approvalMethod: 'voice' | 'text' | 'denied';
  /** The exact confirmation phrase (if approved). */
  confirmationPhrase?: string;
  /** Files that were changed. */
  filesChanged: string[];
  /** Result of the update. */
  result: 'success' | 'failure' | 'rollback';
  /** Whether a rollback was performed. */
  rollbackStatus: 'not-needed' | 'completed' | 'failed';
  /** Error message (if failed). */
  error?: string;
  /** Duration in milliseconds. */
  durationMs: number;
  /** SHA-256 hash of the downloaded file (if applicable). */
  hash?: string;
  /** Size of the download in bytes. */
  downloadSizeBytes?: number;
}

export interface UpdateHistoryFile {
  entries: UpdateHistoryEntry[];
  lastUpdated: string;
}

// ─── Update History Manager ────────────────────────────────────────────────

export class UpdateHistory {
  private historyPath: string;

  constructor() {
    this.historyPath = path.join(getUserDataDir(), 'update-history.json');
  }

  /**
   * Add an entry to the update history.
   */
  addEntry(entry: Omit<UpdateHistoryEntry, 'id' | 'date'>): UpdateHistoryEntry {
    const fullEntry: UpdateHistoryEntry = {
      ...entry,
      id: `upd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: new Date().toISOString(),
    };

    const history = this.readHistory();
    history.entries.push(fullEntry);
    history.lastUpdated = new Date().toISOString();
    this.writeHistory(history);

    return fullEntry;
  }

  /**
   * Get all update history entries (newest first).
   */
  getEntries(): UpdateHistoryEntry[] {
    return this.readHistory().entries.reverse();
  }

  /**
   * Get the last N entries.
   */
  getRecent(limit: number = 10): UpdateHistoryEntry[] {
    return this.getEntries().slice(0, limit);
  }

  /**
   * Get the last successful update.
   */
  getLastSuccessfulUpdate(): UpdateHistoryEntry | null {
    const entries = this.getEntries();
    return entries.find((e) => e.result === 'success') || null;
  }

  /**
   * Get all failed updates (for diagnostics).
   */
  getFailedUpdates(): UpdateHistoryEntry[] {
    return this.getEntries().filter((e) => e.result === 'failure' || e.result === 'rollback');
  }

  /**
   * Get all updates approved via voice.
   */
  getVoiceApprovedUpdates(): UpdateHistoryEntry[] {
    return this.getEntries().filter((e) => e.approvalMethod === 'voice');
  }

  /**
   * Clear all history (admin operation — requires user confirmation).
   */
  clearHistory(): boolean {
    try {
      const empty: UpdateHistoryFile = { entries: [], lastUpdated: new Date().toISOString() };
      this.writeHistory(empty);
      return true;
    } catch {
      return false;
    }
  }

  // ─── Persistence ──────────────────────────────────────────────────────

  private readHistory(): UpdateHistoryFile {
    try {
      if (!fs.existsSync(this.historyPath)) {
        return { entries: [], lastUpdated: new Date().toISOString() };
      }
      const data = JSON.parse(fs.readFileSync(this.historyPath, 'utf-8'));
      if (!Array.isArray(data.entries)) {
        return { entries: [], lastUpdated: new Date().toISOString() };
      }
      return data;
    } catch {
      return { entries: [], lastUpdated: new Date().toISOString() };
    }
  }

  private writeHistory(history: UpdateHistoryFile): void {
    try {
      // Atomic write (temp + rename)
      const tmpPath = this.historyPath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(history, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.historyPath);
    } catch {
      // best-effort
    }
  }

  get historyFilePath(): string {
    return this.historyPath;
  }
}
