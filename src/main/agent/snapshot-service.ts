/**
 * NEX AI — File Snapshot Service (Phase 113/114/115)
 *
 * Persistent snapshot system for agent file modifications.
 * Before write_file/edit_file overwrites a file, the original content is
 * saved to <userData>/nex-snapshots/<taskId>/<timestamp>-<filename>.
 *
 * Phase 114 additions:
 *   - Retention policy: 7-day max age, 100/task max count, 500MB global max
 *   - Startup cleanup: old/excess snapshots pruned automatically
 *   - getSnapshotById: for restore API
 *
 * Phase 115 additions:
 *   - loadSnapshotIndex() + cleanupOldSnapshots() are now CALLED on startup
 *     (previously exported but never invoked — undo was broken after restart)
 *   - Periodic cleanup interval (every 24h) as a safety net
 *   - Lifecycle documented below
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SNAPSHOT LIFECYCLE (Phase 115)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   active task
 *   → snapshots retained (Undo available via agent message)
 *
 *   task completed
 *   → snapshots retained (Undo still available — user can click Undo
 *     on the completed agent message)
 *   → NOT immediately cleared (clearTaskSnapshots is NOT called on
 *     task_completed — this is intentional to preserve Undo)
 *
 *   Undo window expires (7-day retention)
 *   → cleanupOldSnapshots() prunes snapshots older than 7 days
 *   → also enforces 100/task max and 500MB global max
 *
 *   task failed / cancelled
 *   → snapshots retained for recovery (7-day retention applies)
 *
 *   app restart
 *   → loadSnapshotIndex() restores the in-memory Map from disk
 *   → cleanupOldSnapshots() prunes expired snapshots
 *   → Undo still works after restart (snapshots persist on disk)
 *
 *   periodic cleanup (every 24h)
 *   → cleanupOldSnapshots() runs as a safety net
 *
 * This lifecycle ensures:
 *   1. Undo is always available within the 7-day window
 *   2. Snapshots don't accumulate indefinitely
 *   3. Failed/cancelled tasks retain snapshots for recovery
 *   4. Restart doesn't break Undo
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Architecture:
 *   write_file/edit_file → snapshot existing → write new content
 *   restore              → read snapshot    → overwrite current with original
 *   list                 → show all snapshots for a task
 *   cleanup              → prune old/excess snapshots
 *
 * Security:
 *   - Snapshots stored OUTSIDE the workspace (in userData)
 *   - Path traversal prevented in snapshot naming
 *   - No executable content in snapshot directory
 *   - Renderer only sends snapshotId — never a filesystem path
 *   - Main process validates snapshot ownership before restore
 */

import * as fs from 'fs';
import * as path from 'path';
import { retryOnEpermSync } from '../security';

export interface SnapshotEntry {
  id: string;
  taskId: string;
  originalPath: string;
  snapshotPath: string;
  existedBefore: boolean;
  timestamp: number;
  size: number;
}

const snapshots = new Map<string, SnapshotEntry>();

// ─── Retention Policy (Phase 114) ──────────────────────────────────────────
const MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_SNAPSHOTS_PER_TASK = 100;
const MAX_GLOBAL_SNAPSHOT_SIZE = 500 * 1024 * 1024; // 500 MB

function getSnapshotsDir(): string {
  let base: string;
  try {
    const { app } = require('electron');
    base = app.getPath('userData');
  } catch {
    base = require('os').tmpdir();
  }
  const dir = path.join(base, 'nex-snapshots');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function sanitizeForFilename(input: string): string {
  // Phase 115: Strip '/' from the whitelist (path-injection vector).
  // Also cap at 80 chars (was 200) to avoid Windows MAX_PATH (260) issues
  // when combined with the userData path + taskId + timestamp prefix.
  return input.replace(/[^a-zA-Z0-9_\-.]/g, '_').substring(0, 80);
}

/**
 * Create a snapshot of a file before it is modified.
 * If the file does not exist, records a "file did not exist" entry.
 * Returns the snapshot entry for restore.
 */
export function createSnapshot(taskId: string, filePath: string): SnapshotEntry | null {
  try {
    const timestamp = Date.now();
    const id = `${taskId}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
    const taskDir = path.join(getSnapshotsDir(), sanitizeForFilename(taskId));
    if (!fs.existsSync(taskDir)) {
      fs.mkdirSync(taskDir, { recursive: true });
    }

    const existedBefore = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    let snapshotPath: string;
    let size = 0;

    if (existedBefore) {
      // Copy the original file to the snapshot directory
      const originalName = path.basename(filePath);
      const safeName = `${timestamp}-${sanitizeForFilename(originalName)}`;
      snapshotPath = path.join(taskDir, safeName);
      fs.copyFileSync(filePath, snapshotPath);
      size = fs.statSync(snapshotPath).size;
    } else {
      // File didn't exist — record a marker
      snapshotPath = path.join(taskDir, `${timestamp}-NEW_FILE_MARKER`);
      fs.writeFileSync(snapshotPath, '', 'utf-8');
    }

    const entry: SnapshotEntry = {
      id,
      taskId,
      originalPath: filePath,
      snapshotPath,
      existedBefore,
      timestamp,
      size,
    };
    snapshots.set(id, entry);

    // Persist the index
    persistIndex(taskId);

    return entry;
  } catch (err: any) {
    console.warn(`[SNAPSHOT] Failed to create snapshot: ${err.message}`);
    return null;
  }
}

/**
 * Restore a file from its snapshot.
 * If the file was newly created (existedBefore=false), the file is deleted.
 * If the file was overwritten, the original content is restored.
 */
export function restoreSnapshot(snapshotId: string): { success: boolean; error?: string; restoredPath?: string } {
  const entry = snapshots.get(snapshotId);
  if (!entry) {
    return { success: false, error: 'Snapshot not found' };
  }

  try {
    if (!entry.existedBefore) {
      // File was newly created — delete it to restore original state
      if (fs.existsSync(entry.originalPath)) {
        fs.unlinkSync(entry.originalPath);
      }
      return { success: true, restoredPath: entry.originalPath };
    }

    // File was overwritten — restore original content
    if (!fs.existsSync(entry.snapshotPath)) {
      return { success: false, error: 'Snapshot file not found on disk' };
    }

    // Atomic restore: copy to temp then rename
    // Phase 115: Use retryOnEpermSync for Windows AV/indexer lock resilience
    const tmpPath = entry.originalPath + '.restore-tmp';
    fs.copyFileSync(entry.snapshotPath, tmpPath);
    retryOnEpermSync(() => fs.renameSync(tmpPath, entry.originalPath));

    return { success: true, restoredPath: entry.originalPath };
  } catch (err: any) {
    return { success: false, error: `Restore failed: ${err.message}` };
  }
}

/**
 * List all snapshots for a given task.
 */
export function listSnapshots(taskId: string): SnapshotEntry[] {
  const result: SnapshotEntry[] = [];
  for (const entry of snapshots.values()) {
    if (entry.taskId === taskId) {
      result.push(entry);
    }
  }
  return result.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Persist the snapshot index for a task to disk.
 * Allows recovery after app restart.
 */
function persistIndex(taskId: string): void {
  try {
    const taskDir = path.join(getSnapshotsDir(), sanitizeForFilename(taskId));
    if (!fs.existsSync(taskDir)) return;
    const entries = listSnapshots(taskId);
    const indexPath = path.join(taskDir, 'index.json');
    fs.writeFileSync(indexPath, JSON.stringify(entries, null, 2), 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Load snapshot index from disk on startup.
 * Called once during app initialization.
 */
export function loadSnapshotIndex(): void {
  try {
    const baseDir = getSnapshotsDir();
    const taskDirs = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const taskDir of taskDirs) {
      const indexPath = path.join(baseDir, taskDir, 'index.json');
      if (fs.existsSync(indexPath)) {
        try {
          const entries: SnapshotEntry[] = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
          for (const entry of entries) {
            snapshots.set(entry.id, entry);
          }
        } catch { /* corrupted index — skip */ }
      }
    }
    console.log(`[SNAPSHOT] Loaded ${snapshots.size} snapshot(s) from disk`);
  } catch {
    // Snapshots dir doesn't exist yet — normal on first run
  }
}

/**
 * Clear all snapshots for a task (after successful commit or task completion).
 */
export function clearTaskSnapshots(taskId: string): void {
  const toDelete: string[] = [];
  for (const [id, entry] of snapshots.entries()) {
    if (entry.taskId === taskId) {
      toDelete.push(id);
      try { fs.unlinkSync(entry.snapshotPath); } catch { /* */ }
    }
  }
  for (const id of toDelete) {
    snapshots.delete(id);
  }
  // Remove the task directory
  try {
    const taskDir = path.join(getSnapshotsDir(), sanitizeForFilename(taskId));
    if (fs.existsSync(taskDir)) {
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
  } catch { /* best-effort */ }
}

// ─── Phase 114: Retention / Disk Safety ────────────────────────────────────

/**
 * Get a single snapshot by ID (for restore API).
 */
export function getSnapshotById(snapshotId: string): SnapshotEntry | null {
  return snapshots.get(snapshotId) || null;
}

/**
 * Phase 114: Run retention cleanup.
 * - Delete snapshots older than 7 days
 * - Enforce max 100 snapshots per task (delete oldest)
 * - Enforce max 500MB global snapshot storage (delete oldest)
 * - Never crashes — all errors caught and logged
 *
 * Should be called on startup and periodically.
 */
export function cleanupOldSnapshots(): { deleted: number; reason: string } {
  let deleted = 0;
  const now = Date.now();

  try {
    // 1. Delete snapshots older than MAX_SNAPSHOT_AGE_MS
    const toDeleteByAge: string[] = [];
    for (const [id, entry] of snapshots.entries()) {
      if (now - entry.timestamp > MAX_SNAPSHOT_AGE_MS) {
        toDeleteByAge.push(id);
      }
    }
    for (const id of toDeleteByAge) {
      deleteSnapshot(id);
      deleted++;
    }

    // 2. Enforce max snapshots per task
    const taskCounts = new Map<string, SnapshotEntry[]>();
    for (const entry of snapshots.values()) {
      if (!taskCounts.has(entry.taskId)) taskCounts.set(entry.taskId, []);
      taskCounts.get(entry.taskId)!.push(entry);
    }
    for (const [taskId, entries] of taskCounts) {
      if (entries.length > MAX_SNAPSHOTS_PER_TASK) {
        // Sort by timestamp ascending (oldest first), delete excess
        entries.sort((a, b) => a.timestamp - b.timestamp);
        const excess = entries.slice(0, entries.length - MAX_SNAPSHOTS_PER_TASK);
        for (const entry of excess) {
          deleteSnapshot(entry.id);
          deleted++;
        }
      }
    }

    // 3. Enforce global size limit
    let totalSize = 0;
    for (const entry of snapshots.values()) {
      totalSize += entry.size;
    }
    if (totalSize > MAX_GLOBAL_SNAPSHOT_SIZE) {
      // Sort all by timestamp ascending (oldest first)
      const all = Array.from(snapshots.values()).sort((a, b) => a.timestamp - b.timestamp);
      for (const entry of all) {
        if (totalSize <= MAX_GLOBAL_SNAPSHOT_SIZE) break;
        deleteSnapshot(entry.id);
        totalSize -= entry.size;
        deleted++;
      }
    }

    // 4. Clean up empty task directories
    const baseDir = getSnapshotsDir();
    try {
      const taskDirs = fs.readdirSync(baseDir, { withFileTypes: true })
        .filter(d => d.isDirectory());
      for (const d of taskDirs) {
        const taskDir = path.join(baseDir, d.name);
        const files = fs.readdirSync(taskDir);
        if (files.length === 0) {
          fs.rmdirSync(taskDir);
        }
      }
    } catch { /* best-effort */ }

    if (deleted > 0) {
      console.log(`[SNAPSHOT] Cleanup: deleted ${deleted} old/excess snapshot(s)`);
    }
    return { deleted, reason: deleted > 0 ? `${deleted} snapshots pruned` : 'no cleanup needed' };
  } catch (err: any) {
    console.warn(`[SNAPSHOT] Cleanup failed: ${err.message}`);
    return { deleted, reason: `cleanup error: ${err.message}` };
  }
}

/**
 * Delete a single snapshot (internal helper).
 */
function deleteSnapshot(id: string): void {
  const entry = snapshots.get(id);
  if (!entry) return;
  try { fs.unlinkSync(entry.snapshotPath); } catch { /* */ }
  snapshots.delete(id);
}

// ─── Phase 115: Periodic Cleanup ────────────────────────────────────────────

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
let _cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Phase 115: Start the periodic snapshot cleanup interval.
 * Runs cleanupOldSnapshots() every 24 hours as a safety net.
 * The timer is unref'd so it doesn't keep the process alive.
 *
 * Called once on app startup (from main.ts app.whenReady).
 */
export function startSnapshotCleanupInterval(): void {
  if (_cleanupTimer) return; // already started
  _cleanupTimer = setInterval(() => {
    try {
      const result = cleanupOldSnapshots();
      if (result.deleted > 0) {
        console.log(`[SNAPSHOT] Periodic cleanup: deleted ${result.deleted} snapshot(s)`);
      }
    } catch (err: any) {
      console.warn(`[SNAPSHOT] Periodic cleanup failed: ${err.message}`);
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't keep the process alive just for this timer
  if (_cleanupTimer.unref) _cleanupTimer.unref();
  console.log('[SNAPSHOT] Periodic cleanup interval started (24h)');
}

/**
 * Phase 115: Stop the periodic cleanup interval.
 * Called on app shutdown (best-effort).
 */
export function stopSnapshotCleanupInterval(): void {
  if (_cleanupTimer) {
    clearInterval(_cleanupTimer);
    _cleanupTimer = null;
  }
}
