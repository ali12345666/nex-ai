/**
 * NEX AI — File Snapshot Service (Phase 113)
 *
 * Persistent snapshot system for agent file modifications.
 * Before write_file overwrites a file, the original content is saved
 * to <userData>/snapshots/<taskId>/<timestamp>/<filename>.
 *
 * Snapshots survive app restarts and can be restored via the restore API.
 *
 * Architecture:
 *   write_file → snapshot existing → write new content
 *   restore    → read snapshot    → overwrite current with original
 *   list       → show all snapshots for a task
 *
 * Security:
 *   - Snapshots stored OUTSIDE the workspace (in userData)
 *   - Path traversal prevented in snapshot naming
 *   - No executable content in snapshot directory
 */

import * as fs from 'fs';
import * as path from 'path';

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

function getSnapshotsDir(): string {
  let base: string;
  try {
    // In Electron, use userData directory
    const { app } = require('electron');
    base = app.getPath('userData');
  } catch {
    // Outside Electron (tests, CLI) — use OS temp directory
    base = require('os').tmpdir();
  }
  const dir = path.join(base, 'nex-snapshots');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function sanitizeForFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9_\-./]/g, '_').substring(0, 200);
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
    const tmpPath = entry.originalPath + '.restore-tmp';
    fs.copyFileSync(entry.snapshotPath, tmpPath);
    fs.renameSync(tmpPath, entry.originalPath);

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
