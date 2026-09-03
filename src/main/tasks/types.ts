/**
 * NEX AI — Phase 6: Background Task Queue Types
 *
 * The task queue manages long-running Agent tasks and arbitrary async
 * functions in the background, without blocking the UI or conversation.
 *
 * Architecture:
 *
 *   User Request
 *     → Intent
 *     → Agent Planner
 *     → TaskQueue.enqueue(kind='agent')
 *     → Worker Pool (concurrency-limited)
 *     → Tool Execution (via Agent Core — goes through Permission Gate)
 *     → Observation
 *     → Verification
 *     → Retry/Replan
 *     → Completion
 *     → Memory/Event (only important results persisted)
 *     → UI/Orb Notification (via task-queue-event IPC + Orb condition)
 *
 * Design principles:
 *   - The queue WRAPS AgentTask IDs and async functions — it does NOT
 *     duplicate the agent state machine. Lifecycle is the queue's own
 *     (queued → running → completed/failed/cancelled/paused).
 *   - The queue REUSES the existing CancellationToken from agent/types.ts
 *     for cancellation propagation.
 *   - The queue REUSES the existing Orb state machine (orb-state.ts) via
 *     the voiceController condition system — condition key 'queue'.
 *   - The queue NEVER bypasses the Permission Gate. Agent tasks still
 *     call executeToolWithPermission internally; function tasks must
 *     call the permission API themselves.
 *   - Persistence: queued/paused/running items survive process restart.
 *     Running items after a crash are marked 'failed' with reason
 *     "Interrupted by process restart" — NEVER fake completion.
 */

// ─── Priority ────────────────────────────────────────────────────────────────

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

/** Lower number = higher priority (used by the priority heap). */
export const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export const ALL_PRIORITIES: TaskPriority[] = ['critical', 'high', 'normal', 'low'];

export function isValidPriority(p: unknown): p is TaskPriority {
  return p === 'critical' || p === 'high' || p === 'normal' || p === 'low';
}

// ─── Status ──────────────────────────────────────────────────────────────────

export type TaskQueueStatus =
  | 'queued'      // waiting in the priority queue
  | 'running'     // being executed by a worker
  | 'completed'   // finished successfully
  | 'failed'      // finished with error (after retries exhausted)
  | 'cancelled'   // user cancelled
  | 'paused';     // user paused (not yet running — only valid for queued items)

export const TERMINAL_STATUSES: TaskQueueStatus[] = ['completed', 'failed', 'cancelled'];
export const PERSISTABLE_STATUSES: TaskQueueStatus[] = ['queued', 'running', 'paused'];

export function isTerminalStatus(status: TaskQueueStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

// ─── Task Kind ───────────────────────────────────────────────────────────────

/**
 * 'agent'    — runs an existing AgentTask (created via createTask). The worker
 *              calls runTask(agentTaskId) and waits for the agent's terminal
 *              event. Cancellation propagates via cancelTask().
 * 'function' — runs an arbitrary async function. The function receives a
 *              TaskExecutionContext with a CancellationToken and progress
 *              callback. Used for non-agent background work (e.g. indexing,
 *              git fetch, model warmup).
 */
export type TaskKind = 'agent' | 'function';

// ─── Task Queue Item ─────────────────────────────────────────────────────────

export interface TaskQueueItem<T = unknown> {
  /** UUID — unique across the queue lifetime. */
  id: string;
  /** Human-readable name (shown in UI). */
  name: string;
  /** Optional longer description. */
  description?: string;
  /** Priority — determines dequeue order within the queue. */
  priority: TaskPriority;
  /** Current lifecycle status. */
  status: TaskQueueStatus;

  /** What to run. */
  kind: TaskKind;
  /** For kind='agent': the AgentTask ID to run. */
  agentTaskId?: string;
  /** For kind='function': a registered function key (looked up at runtime). */
  functionKey?: string;

  /** Lifecycle timestamps (epoch ms). */
  enqueuedAt: number;
  startedAt?: number;
  completedAt?: number;

  /** Progress 0..100 (updated by the running task). */
  progress: number;

  /** Result (set on completion). */
  result?: T;
  /** Error (set on failure). */
  error?: TaskError;
  /** Cancellation reason (set on cancel). */
  cancelReason?: string;

  /** Cancellation token key (into the queue's token map). */
  cancellationKey: string;

  /** Tags for filtering / memory consolidation. */
  tags?: string[];
  /** Free-form metadata (persisted). */
  metadata?: Record<string, unknown>;

  /** Retry policy. */
  maxRetries: number;
  retryCount: number;

  /** Estimated duration in ms (for UI display; 0 = unknown). */
  estimatedDurationMs?: number;
}

export interface TaskError {
  message: string;
  code?: string;
  stack?: string;
  /** Retryable (transient error like timeout/network). */
  retryable?: boolean;
}

// ─── Task Execution Context (passed to function-kind tasks) ──────────────────

export interface TaskExecutionContext {
  taskId: string;
  /** CancellationToken — check `cancelled` / call `throwIfCancelled` / register `onCancel`. */
  cancellationToken: import('../agent/types').CancellationToken;
  /** Update progress (0..100). */
  reportProgress: (percent: number, message?: string) => void;
  /** Read-only item metadata. */
  metadata: Record<string, unknown>;
}

/** A registered async function (kind='function'). */
export type TaskFunction = (ctx: TaskExecutionContext) => Promise<unknown>;

// ─── Queue Events ─────────────────────────────────────────────────────────────

export type TaskQueueEventType =
  | 'task_enqueued'        // item added to the queue
  | 'task_started'         // worker picked up the item
  | 'task_progress'        // progress update
  | 'task_completed'        // finished successfully
  | 'task_failed'           // finished with error
  | 'task_cancelled'        // user cancelled
  | 'task_paused'           // user paused
  | 'task_recovered'        // recovered after crash (running → failed)
  | 'queue_state';          // full state snapshot (for UI sync on connect)

export interface TaskQueueEvent {
  type: TaskQueueEventType;
  taskId: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export type TaskQueueEventListener = (event: TaskQueueEvent) => void;

// ─── Queue Configuration ──────────────────────────────────────────────────────

export interface TaskQueueConfig {
  /** Maximum concurrent running tasks (default 2). */
  maxConcurrent: number;
  /** Max items to keep in completed/failed/cancelled history (default 50). */
  historyLimit: number;
  /** Default retry count for items without explicit maxRetries (default 1). */
  defaultMaxRetries: number;
  /** Default priority (default 'normal'). */
  defaultPriority: TaskPriority;
}

export const DEFAULT_QUEUE_CONFIG: TaskQueueConfig = {
  maxConcurrent: 2,
  historyLimit: 50,
  defaultMaxRetries: 1,
  defaultPriority: 'normal',
};

// ─── Enqueue Options ──────────────────────────────────────────────────────────

export interface EnqueueOptions {
  priority?: TaskPriority;
  name?: string;
  description?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  maxRetries?: number;
  estimatedDurationMs?: number;
}

// ─── Persistence Schema ──────────────────────────────────────────────────────

export interface PersistedQueueState {
  version: 1;
  items: TaskQueueItem[];        // queued/paused/running + recent history
  config: Pick<TaskQueueConfig, 'maxConcurrent' | 'historyLimit'>;
  savedAt: number;
}
