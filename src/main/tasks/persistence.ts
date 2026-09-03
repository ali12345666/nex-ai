/**
 * NEX AI — Phase 6: Task Queue Persistence
 *
 * Persists queue state to <userData>/task-queue.json so long-running tasks
 * survive a UI reload / app restart.
 *
 * Crash recovery rules (Phase 6 requirement §6):
 *   - queued   → re-enqueue (preserve enqueuedAt for FIFO within priority)
 *   - paused   → re-enqueue as paused (still not started)
 *   - running  → mark 'failed' with reason "Interrupted by process restart".
 *                NEVER fake completion — the work did not finish.
 *   - completed/failed/cancelled → load into history (capped at historyLimit)
 *
 * The persistence layer is intentionally simple (JSON file, synchronous write).
 * The queue is small (typically <100 items) so we don't need a DB.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_QUEUE_CONFIG,
  PERSISTABLE_STATUSES,
  TERMINAL_STATUSES,
  type PersistedQueueState,
  type TaskQueueConfig,
  type TaskQueueItem,
  type TaskQueueStatus,
} from './types';

const QUEUE_FILE = 'task-queue.json';

let _userDataDir = '';

/**
 * Initialize the persistence layer with the app's userData directory.
 * Called from main.ts during startup (after initPersistence).
 */
export function initTaskQueuePersistence(userDataDir: string): void {
  _userDataDir = userDataDir;
  if (!fs.existsSync(_userDataDir)) {
    try { fs.mkdirSync(_userDataDir, { recursive: true }); } catch { /* best effort */ }
  }
}

function queueFilePath(): string {
  // If initTaskQueuePersistence wasn't called (unit tests, embedded contexts),
  // fall back to a per-process temp dir — NEVER the process CWD (which would
  // leak config into whatever dir the process happened to start in).
  if (_userDataDir) return path.join(_userDataDir, QUEUE_FILE);
  const fb = path.join(require('os').tmpdir(), `nex-ai-tq-fallback-${process.pid}`);
  try { fs.mkdirSync(fb, { recursive: true }); } catch { /* best effort */ }
  return path.join(fb, QUEUE_FILE);
}

/**
 * Load the persisted queue state from disk.
 * Returns null if the file doesn't exist or is corrupt.
 */
export function loadQueueState(): PersistedQueueState | null {
  try {
    const fp = queueFilePath();
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedQueueState;
    if (parsed.version !== 1) return null;
    if (!Array.isArray(parsed.items)) return null;
    return parsed;
  } catch (err) {
    console.warn('[NEX TaskQueue] Failed to load persisted state:', (err as Error).message);
    return null;
  }
}

/**
 * Save the queue state to disk. Only persists:
 *   - queued / paused / running (for crash recovery)
 *   - completed / failed / cancelled (capped at historyLimit — for UI history)
 *
 * Function references are NEVER persisted (only functionKey strings) —
 * functions must be re-registered on startup via registerTaskFunction().
 */
export function saveQueueState(
  items: TaskQueueItem[],
  config: Pick<TaskQueueConfig, 'maxConcurrent' | 'historyLimit'>
): void {
  try {
    const persistable = items.filter((it) =>
      PERSISTABLE_STATUSES.includes(it.status) || TERMINAL_STATUSES.includes(it.status)
    );
    // Cap terminal-status history (most recent first by completedAt).
    const terminal = persistable
      .filter((it) => TERMINAL_STATUSES.includes(it.status))
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
      .slice(0, config.historyLimit);
    const nonTerminal = persistable.filter((it) => !TERMINAL_STATUSES.includes(it.status));
    const final = [...nonTerminal, ...terminal];

    const state: PersistedQueueState = {
      version: 1,
      items: final,
      config,
      savedAt: Date.now(),
    };
    const fp = queueFilePath();
    // Atomic write: write to temp + rename (avoid partial-write corruption)
    const tmp = `${fp}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, fp);
  } catch (err) {
    console.warn('[NEX TaskQueue] Failed to save state:', (err as Error).message);
  }
}

/**
 * Recover the queue state after a process restart.
 *
 * For each persisted item:
 *   - queued   → keep as 'queued' (will be re-enqueued)
 *   - paused   → keep as 'paused' (still not started)
 *   - running  → transition to 'failed' with error "Interrupted by process restart"
 *                (NEVER fake completion — the work did not finish)
 *   - terminal → keep (UI history)
 *
 * Returns the recovered items + a list of recovered (interrupted) task IDs
 * for telemetry / event emission.
 */
export function recoverQueueState(): {
  items: TaskQueueItem[];
  recoveredInterruptedIds: string[];
} {
  const persisted = loadQueueState();
  if (!persisted) return { items: [], recoveredInterruptedIds: [] };

  const recoveredInterruptedIds: string[] = [];
  const items: TaskQueueItem[] = [];

  for (const item of persisted.items) {
    if (item.status === 'running') {
      // Crash recovery: this item was running when the process died.
      // Mark as failed — DO NOT fake completion.
      const recovered: TaskQueueItem = {
        ...item,
        status: 'failed',
        completedAt: Date.now(),
        error: {
          message: 'Interrupted by process restart — task was running when the process exited.',
          code: 'TASK_INTERRUPTED',
          retryable: true,
        },
      };
      items.push(recovered);
      recoveredInterruptedIds.push(item.id);
    } else {
      items.push(item);
    }
  }

  return { items, recoveredInterruptedIds };
}

/**
 * Clear all persisted state (for tests / reset).
 */
export function clearQueueState(): void {
  try {
    const fp = queueFilePath();
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch { /* best effort */ }
}

/**
 * Get the configured maxConcurrent from persisted state, or the default.
 */
export function loadQueueConfig(): Pick<TaskQueueConfig, 'maxConcurrent' | 'historyLimit'> {
  const persisted = loadQueueState();
  if (persisted) {
    return {
      maxConcurrent: persisted.config.maxConcurrent || DEFAULT_QUEUE_CONFIG.maxConcurrent,
      historyLimit: persisted.config.historyLimit || DEFAULT_QUEUE_CONFIG.historyLimit,
    };
  }
  return {
    maxConcurrent: DEFAULT_QUEUE_CONFIG.maxConcurrent,
    historyLimit: DEFAULT_QUEUE_CONFIG.historyLimit,
  };
}

/**
 * Check if a status is persistable (for tests).
 */
export function isPersistableStatus(status: TaskQueueStatus): boolean {
  return PERSISTABLE_STATUSES.includes(status) || TERMINAL_STATUSES.includes(status);
}
