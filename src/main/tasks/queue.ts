/**
 * NEX AI — Phase 6: Task Queue — Core Implementation
 *
 * Priority queue + concurrency-limited worker pool.
 *
 * Lifecycle of a TaskQueueItem:
 *
 *   enqueue()      → status='queued', emit task_enqueued, persist
 *   worker picks  → status='running', emit task_started, persist
 *                  → run task (agent: runTask + wait terminal; function: call fn)
 *                  → on success: status='completed', emit task_completed
 *                  → on failure (retryable, retries left): status='queued', retryCount++
 *                  → on failure (no retries): status='failed', emit task_failed
 *                  → on cancel: status='cancelled', emit task_cancelled
 *   cancelTask()  → set token; if running, propagate to agent/worker; status='cancelled'
 *   pauseTask()   → status='paused' (only valid for 'queued' items — never running)
 *   resumeTask()  → status='queued' (re-enqueue at original priority)
 *
 * Concurrency:
 *   At most `maxConcurrent` items run simultaneously. Workers are spawned
 *   lazily when items are enqueued and exit when the queue is drained.
 *
 * Cancellation propagation:
 *   - kind='agent': cancelTask(agentTaskId) is called — the agent core
 *     cancels its loop and any in-progress tool (via the tool's cancellationToken).
 *   - kind='function': the function's CancellationToken is set. The function
 *     MUST check `cancellationToken.cancelled` or call `throwIfCancelled`
 *     at safe points. If the function ignores the token, the worker waits
 *     for it to finish naturally (cooperative cancellation, not force-kill).
 *
 * Failure isolation:
 *   Each task runs in its own try/catch. A failure (even an unhandled
 *   rejection) marks only THAT task as 'failed' — the worker pool continues
 *   processing other items. The worker itself never crashes.
 */

import * as crypto from 'crypto';
import {
  DEFAULT_QUEUE_CONFIG,
  PRIORITY_WEIGHT,
  isTerminalStatus,
  isValidPriority,
  type EnqueueOptions,
  type TaskExecutionContext,
  type TaskFunction,
  type TaskQueueConfig,
  type TaskQueueEvent,
  type TaskQueueEventListener,
  type TaskQueueItem,
  type TaskQueueStatus,
  type TaskKind,
} from './types';
import { createCancellationToken, type CancellationToken } from '../agent/types';
import {
  initTaskQueuePersistence,
  loadQueueConfig,
  recoverQueueState,
  saveQueueState,
} from './persistence';

// ─── Module State ────────────────────────────────────────────────────────────

const _items = new Map<string, TaskQueueItem>();
const _queue: TaskQueueItem[] = [];          // pending items (queued/paused), priority-sorted
const _running = new Map<string, TaskQueueItem>();  // taskId → running item
const _cancellationTokens = new Map<string, CancellationToken>();
const _listeners = new Set<TaskQueueEventListener>();
const _registeredFunctions = new Map<string, TaskFunction>();

let _config: TaskQueueConfig = { ...DEFAULT_QUEUE_CONFIG };
let _workerCount = 0;
let _persistenceInitialized = false;
let _recoverInterruptedHandler: ((taskId: string) => void) | null = null;
let _agentRunTaskFn: ((taskId: string) => Promise<unknown>) | null = null;
let _agentCancelTaskFn: ((taskId: string, reason?: string) => boolean) | null = null;
let _agentGetTaskStatusFn: ((taskId: string) => string | null) | null = null;
let _agentOnEventUnsub: (() => void) | null = null;
let _memoryRecordFn: ((item: TaskQueueItem) => void) | null = null;
let _persistDebounce: NodeJS.Timeout | null = null;

// ─── Initialization ───────────────────────────────────────────────────────────

/**
 * Initialize the task queue. Call once on app startup (after initPersistence).
 *
 * Wires agent integration callbacks and recovers persisted state.
 */
export function initTaskQueue(opts?: {
  userDataDir?: string;
  config?: Partial<TaskQueueConfig>;
  agentRunTask?: (taskId: string) => Promise<unknown>;
  agentCancelTask?: (taskId: string, reason?: string) => boolean;
  agentGetTaskStatus?: (taskId: string) => string | null;
  agentOnEvent?: (listener: (event: { type: string; taskId: string }) => void) => () => void;
  onInterruptedRecovery?: (taskId: string) => void;
  memoryRecord?: (item: TaskQueueItem) => void;
}): void {
  if (opts?.userDataDir) {
    initTaskQueuePersistence(opts.userDataDir);
    _persistenceInitialized = true;
  }
  if (opts?.config) {
    _config = { ...DEFAULT_QUEUE_CONFIG, ...opts.config };
  } else {
    const persisted = loadQueueConfig();
    _config = { ...DEFAULT_QUEUE_CONFIG, ...persisted };
  }

  // Wire agent integration
  _agentRunTaskFn = opts?.agentRunTask || null;
  _agentCancelTaskFn = opts?.agentCancelTask || null;
  _agentGetTaskStatusFn = opts?.agentGetTaskStatus || null;
  _recoverInterruptedHandler = opts?.onInterruptedRecovery || null;
  _memoryRecordFn = opts?.memoryRecord || null;

  // Subscribe to agent events to detect when agent-kind tasks finish.
  // This is the bridge between agent core's event stream and the queue.
  if (opts?.agentOnEvent) {
    _agentOnEventUnsub = opts.agentOnEvent((event) => {
      handleAgentEvent(event);
    });
  }

  // Recover persisted state
  const { items, recoveredInterruptedIds } = recoverQueueState();
  for (const item of items) {
    _items.set(item.id, item);
    // Re-create cancellation tokens for non-terminal items (queued/paused/running).
    // Running items are marked failed by recovery (so they won't need a token),
    // but queued/paused items need fresh tokens for when they run.
    // Terminal items don't need tokens (they're done).
    if (!isTerminalStatus(item.status)) {
      _cancellationTokens.set(item.cancellationKey, createCancellationToken());
    }
    if (item.status === 'queued') {
      _queue.push(item);
    } else if (item.status === 'paused') {
      // Paused items stay in _items but are NOT in _queue (until resumed)
    }
    // terminal items (completed/failed/cancelled) stay in _items for history
  }
  // Re-sort the queue by priority (stable: preserve enqueuedAt for FIFO within priority)
  _queue.sort((a, b) => comparePriority(a, b));

  // Emit recovery events for interrupted items
  for (const id of recoveredInterruptedIds) {
    emit({
      type: 'task_recovered',
      taskId: id,
      data: { reason: 'interrupted_by_restart' },
    });
    _recoverInterruptedHandler?.(id);
  }

  // Persist initial state
  schedulePersist();

  // Start workers if there are queued items
  if (_queue.length > 0) spawnWorkers();
}

/**
 * Shut down the task queue. Cancels all running tasks and saves state.
 * Called on app quit / before-quit.
 */
export function shutdownTaskQueue(): void {
  // Cancel all running tasks
  for (const [taskId, item] of _running) {
    const token = _cancellationTokens.get(item.cancellationKey);
    token?.cancel('Task queue shutdown');
    if (item.kind === 'agent' && item.agentTaskId) {
      _agentCancelTaskFn?.(item.agentTaskId, 'Task queue shutdown');
    }
  }
  // Unsubscribe from agent events
  _agentOnEventUnsub?.();
  _agentOnEventUnsub = null;
  // Flush pending persist
  if (_persistDebounce) {
    clearTimeout(_persistDebounce);
    _persistDebounce = null;
  }
  saveQueueState(Array.from(_items.values()), _config);
}

// ─── Public API: Enqueue ────────────────────────────────────────────────────

/**
 * Enqueue an existing AgentTask for background execution.
 * The task must already be created via createTask() (status='pending').
 * The queue will call runTask(agentTaskId) when a worker is free.
 */
export function enqueueAgentTask(
  agentTaskId: string,
  opts?: EnqueueOptions
): TaskQueueItem {
  const id = crypto.randomUUID();
  const cancellationKey = id;
  _cancellationTokens.set(cancellationKey, createCancellationToken());

  const item: TaskQueueItem = {
    id,
    name: opts?.name || `Agent task ${agentTaskId.slice(0, 8)}`,
    description: opts?.description,
    priority: opts?.priority || _config.defaultPriority,
    status: 'queued',
    kind: 'agent',
    agentTaskId,
    enqueuedAt: Date.now(),
    progress: 0,
    cancellationKey,
    tags: opts?.tags,
    metadata: opts?.metadata,
    maxRetries: opts?.maxRetries ?? _config.defaultMaxRetries,
    retryCount: 0,
    estimatedDurationMs: opts?.estimatedDurationMs,
  };

  _items.set(id, item);
  _queue.push(item);
  _queue.sort((a, b) => comparePriority(a, b));

  emit({
    type: 'task_enqueued',
    taskId: id,
    data: { kind: 'agent', agentTaskId, priority: item.priority },
  });

  schedulePersist();
  spawnWorkers();
  return item;
}

/**
 * Enqueue a function for background execution.
 * The function must be registered via registerTaskFunction(key, fn) first.
 */
export function enqueueFunction(
  functionKey: string,
  opts?: EnqueueOptions
): TaskQueueItem {
  if (!_registeredFunctions.has(functionKey)) {
    throw new Error(`Task function not registered: ${functionKey}`);
  }
  const id = crypto.randomUUID();
  const cancellationKey = id;
  _cancellationTokens.set(cancellationKey, createCancellationToken());

  const item: TaskQueueItem = {
    id,
    name: opts?.name || functionKey,
    description: opts?.description,
    priority: opts?.priority || _config.defaultPriority,
    status: 'queued',
    kind: 'function',
    functionKey,
    enqueuedAt: Date.now(),
    progress: 0,
    cancellationKey,
    tags: opts?.tags,
    metadata: opts?.metadata,
    maxRetries: opts?.maxRetries ?? _config.defaultMaxRetries,
    retryCount: 0,
    estimatedDurationMs: opts?.estimatedDurationMs,
  };

  _items.set(id, item);
  _queue.push(item);
  _queue.sort((a, b) => comparePriority(a, b));

  emit({
    type: 'task_enqueued',
    taskId: id,
    data: { kind: 'function', functionKey, priority: item.priority },
  });

  schedulePersist();
  spawnWorkers();
  return item;
}

/**
 * Register a task function (for kind='function' tasks).
 * Must be called on startup before enqueueFunction() can reference it.
 */
export function registerTaskFunction(key: string, fn: TaskFunction): void {
  _registeredFunctions.set(key, fn);
}

// ─── Public API: Cancellation ────────────────────────────────────────────────

/**
 * Cancel a queued or running task.
 * - queued  → removed from queue, status='cancelled'
 * - running → cancellation token set; for agent tasks, cancelTask(agentTaskId) called
 * - paused  → status='cancelled' (never started)
 * - terminal → no-op (already done)
 *
 * Returns true if the task was cancelled by this call (i.e. it was not
 * already in a terminal state).
 */
export function cancelTask(taskId: string, reason?: string): boolean {
  const item = _items.get(taskId);
  if (!item) return false;
  if (isTerminalStatus(item.status)) return false;

  // Set the cancellation token (propagates to function-kind tasks immediately;
  // for agent tasks, also call cancelTask() to interrupt the agent loop).
  const token = _cancellationTokens.get(item.cancellationKey);
  token?.cancel(reason || 'Cancelled by user');

  if (item.kind === 'agent' && item.agentTaskId && _agentCancelTaskFn) {
    _agentCancelTaskFn(item.agentTaskId, reason);
  }

  // Remove from queue if queued
  const qIdx = _queue.findIndex((q) => q.id === taskId);
  if (qIdx >= 0) _queue.splice(qIdx, 1);

  // Remove from running map (the worker will detect cancellation and exit)
  _running.delete(taskId);

  item.status = 'cancelled';
  item.completedAt = Date.now();
  item.cancelReason = reason || 'Cancelled by user';
  item.progress = Math.max(item.progress, 0);

  emit({
    type: 'task_cancelled',
    taskId,
    data: { reason: item.cancelReason },
  });

  schedulePersist();
  spawnWorkers(); // spawn replacement worker for any freed slot
  return true;
}

/**
 * Cancel all tasks (queued + running). Returns the count of cancelled tasks.
 */
export function cancelAllTasks(reason?: string): number {
  let count = 0;
  for (const item of Array.from(_items.values())) {
    if (!isTerminalStatus(item.status)) {
      if (cancelTask(item.id, reason || 'Cancel all')) count++;
    }
  }
  return count;
}

// ─── Public API: Pause / Resume ──────────────────────────────────────────────

/**
 * Pause a queued task. Only 'queued' items can be paused (running items
 * cannot be paused — cancel them instead).
 */
export function pauseTask(taskId: string): boolean {
  const item = _items.get(taskId);
  if (!item) return false;
  if (item.status !== 'queued') return false;

  item.status = 'paused';
  const qIdx = _queue.findIndex((q) => q.id === taskId);
  if (qIdx >= 0) _queue.splice(qIdx, 1);

  emit({
    type: 'task_paused',
    taskId,
    data: {},
  });
  schedulePersist();
  return true;
}

/**
 * Resume a paused task (re-enqueue at original priority).
 */
export function resumeTask(taskId: string): boolean {
  const item = _items.get(taskId);
  if (!item) return false;
  if (item.status !== 'paused') return false;

  item.status = 'queued';
  _queue.push(item);
  _queue.sort((a, b) => comparePriority(a, b));

  emit({
    type: 'task_enqueued',
    taskId,
    data: { resumed: true, priority: item.priority },
  });
  schedulePersist();
  spawnWorkers();
  return true;
}

// ─── Public API: Queries ─────────────────────────────────────────────────────

export function getTask(taskId: string): TaskQueueItem | null {
  return _items.get(taskId) || null;
}

export function listTasks(filter?: {
  status?: TaskQueueStatus | TaskQueueStatus[];
  kind?: TaskKind;
}): TaskQueueItem[] {
  let items = Array.from(_items.values());
  if (filter?.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    items = items.filter((it) => statuses.includes(it.status));
  }
  if (filter?.kind) {
    items = items.filter((it) => it.kind === filter.kind);
  }
  // Sort: queued/running/paused first (by priority), then terminal (by completedAt desc)
  items.sort((a, b) => {
    const aActive = !isTerminalStatus(a.status);
    const bActive = !isTerminalStatus(b.status);
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    if (aActive && bActive) return comparePriority(a, b);
    return (b.completedAt || 0) - (a.completedAt || 0);
  });
  return items;
}

export function getQueueState(): {
  config: TaskQueueConfig;
  counts: Record<TaskQueueStatus, number>;
  items: TaskQueueItem[];
} {
  const counts: Record<TaskQueueStatus, number> = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    paused: 0,
  };
  for (const item of _items.values()) {
    counts[item.status]++;
  }
  return {
    config: _config,
    counts,
    items: listTasks(),
  };
}

export function updateConfig(patch: Partial<TaskQueueConfig>): TaskQueueConfig {
  _config = { ..._config, ...patch };
  schedulePersist();
  // If maxConcurrent increased, spawn more workers
  spawnWorkers();
  return _config;
}

export function getConfig(): TaskQueueConfig {
  return _config;
}

// ─── Public API: Events ──────────────────────────────────────────────────────

export function onTaskQueueEvent(listener: TaskQueueEventListener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/**
 * Emit a full state snapshot (used by UI to sync on connect).
 */
export function emitStateSnapshot(): void {
  emit({
    type: 'queue_state',
    taskId: '',
    data: getQueueState() as unknown as Record<string, unknown>,
  });
}

// ─── Worker Pool ─────────────────────────────────────────────────────────────

/**
 * Spawn workers until maxConcurrent is reached or the queue is empty.
 * Idempotent — safe to call repeatedly.
 */
function spawnWorkers(): void {
  while (_workerCount < _config.maxConcurrent && _queue.length > 0) {
    const item = dequeue();
    if (!item) break;
    _workerCount++;
    runItem(item).finally(() => {
      _workerCount--;
      spawnWorkers(); // spawn next worker if queue still has items
    });
  }
}

/**
 * Dequeue the highest-priority queued item. Returns null if queue is empty.
 */
function dequeue(): TaskQueueItem | null {
  if (_queue.length === 0) return null;
  // The queue is kept sorted on push; pop the first item.
  return _queue.shift() || null;
}

/**
 * Run a single item. Handles agent and function kinds, retries, and
 * failure isolation.
 */
async function runItem(item: TaskQueueItem): Promise<void> {
  item.status = 'running';
  item.startedAt = Date.now();
  item.progress = 0;
  _running.set(item.id, item);

  emit({
    type: 'task_started',
    taskId: item.id,
    data: { kind: item.kind, agentTaskId: item.agentTaskId, functionKey: item.functionKey },
  });
  schedulePersist();

  try {
    if (item.kind === 'agent') {
      await runAgentItem(item);
    } else if (item.kind === 'function') {
      await runFunctionItem(item);
    }
    // If we got here and the item isn't terminal, the agent loop completed
    // without emitting a terminal event — mark completed.
    if (!isTerminalStatus(item.status)) {
      completeItem(item, undefined);
    }
  } catch (err) {
    handleItemError(item, err);
  } finally {
    _running.delete(item.id);
  }
}

/**
 * Run an agent-kind item by calling runTask(agentTaskId) and waiting for
 * the agent's terminal event (task_completed/failed/cancelled).
 */
async function runAgentItem(item: TaskQueueItem): Promise<void> {
  if (!item.agentTaskId) throw new Error('Agent item missing agentTaskId');
  if (!_agentRunTaskFn) throw new Error('Agent runTask not wired (initTaskQueue.agentRunTask)');

  // Check cancellation before starting
  const token = _cancellationTokens.get(item.cancellationKey);
  token?.throwIfCancelled();

  // Watch for the agent's terminal event. We register a one-shot listener
  // that resolves/rejects the promise below.
  const finished = new Promise<void>((resolve, reject) => {
    const checkEvent = (event: { type: string; taskId: string }) => {
      if (event.taskId !== item.agentTaskId) return;
      if (event.type === 'task_completed') {
        cleanup();
        resolve();
      } else if (event.type === 'task_failed') {
        cleanup();
        reject(Object.assign(new Error('Agent task failed'), { code: 'AGENT_FAILED' }));
      } else if (event.type === 'task_cancelled') {
        cleanup();
        // Mark cancelled via handleAgentEvent — but also resolve so the
        // worker doesn't double-handle.
        resolve();
      }
    };
    const cleanup = () => {
      const listeners = _agentEventListeners.get(item.agentTaskId!);
      if (listeners) {
        listeners.delete(checkEvent);
        if (listeners.size === 0) _agentEventListeners.delete(item.agentTaskId!);
      }
    };
    if (!_agentEventListeners.has(item.agentTaskId!)) {
      _agentEventListeners.set(item.agentTaskId!, new Set());
    }
    _agentEventListeners.get(item.agentTaskId!)!.add(checkEvent);
  });

  // Run the agent (async — events will fire via handleAgentEvent)
  _agentRunTaskFn(item.agentTaskId).catch((err) => {
    // If runTask throws, the agent loop crashed. Mark failed.
    handleItemError(item, err);
  });

  // Wait for the terminal event (or cancellation token)
  const cancelCheck = new Promise<void>((resolve) => {
    token?.onCancel(() => resolve());
    if (!token) resolve();
  });

  await Promise.race([finished, cancelCheck]);

  // If cancelled, the cancelTask() call already set status='cancelled'.
  // If finished, check the agent task status to confirm.
  if (!isTerminalStatus(item.status)) {
    const agentStatus = _agentGetTaskStatusFn?.(item.agentTaskId);
    if (agentStatus === 'completed') {
      completeItem(item, undefined);
    } else if (agentStatus === 'failed') {
      throw new Error('Agent task failed');
    } else if (agentStatus === 'cancelled') {
      item.status = 'cancelled';
      item.completedAt = Date.now();
      item.cancelReason = item.cancelReason || 'Agent task cancelled';
      emit({
        type: 'task_cancelled',
        taskId: item.id,
        data: { reason: item.cancelReason },
      });
      schedulePersist();
    } else {
      // Agent status unknown or still running — but the finished promise
      // resolved, so the agent must have emitted a terminal event. Mark
      // completed as a safe default (the agent event handler set the
      // status already if it was failed/cancelled).
      if (!isTerminalStatus(item.status)) completeItem(item, undefined);
    }
  }
}

/**
 * Run a function-kind item.
 */
async function runFunctionItem(item: TaskQueueItem): Promise<void> {
  if (!item.functionKey) throw new Error('Function item missing functionKey');
  const fn = _registeredFunctions.get(item.functionKey);
  if (!fn) throw new Error(`Task function not registered: ${item.functionKey}`);

  const token = _cancellationTokens.get(item.cancellationKey);
  if (!token) throw new Error(`Missing cancellation token for task ${item.id}`);

  const ctx: TaskExecutionContext = {
    taskId: item.id,
    cancellationToken: token,
    reportProgress: (percent: number, _message?: string) => {
      item.progress = Math.max(0, Math.min(100, percent));
      emit({
        type: 'task_progress',
        taskId: item.id,
        data: { progress: item.progress },
      });
    },
    metadata: item.metadata || {},
  };

  const result = await fn(ctx);
  if (token.cancelled) {
    // Function completed after cancellation — treat as cancelled.
    item.status = 'cancelled';
    item.completedAt = Date.now();
    item.cancelReason = item.cancelReason || 'Cancelled during function execution';
    emit({
      type: 'task_cancelled',
      taskId: item.id,
      data: { reason: item.cancelReason },
    });
    schedulePersist();
    return;
  }
  completeItem(item, result);
}

/**
 * Handle an error during item execution. Implements the retry policy:
 *   - If retries remaining AND error is retryable → re-enqueue with retryCount++
 *   - Else → mark failed
 */
function handleItemError(item: TaskQueueItem, err: unknown): void {
  // If the item was cancelled, don't override the cancelled status.
  if (item.status === 'cancelled') return;

  const errMsg = err instanceof Error ? err.message : String(err);
  const errStack = err instanceof Error ? err.stack : undefined;
  const errCode = (err as { code?: string })?.code;

  // Check retry eligibility
  const canRetry = item.retryCount < item.maxRetries && errCode !== 'AGENT_CANCELLED';
  if (canRetry) {
    item.retryCount++;
    item.status = 'queued';
    item.progress = 0;
    item.startedAt = undefined;
    _queue.push(item);
    _queue.sort((a, b) => comparePriority(a, b));
    emit({
      type: 'task_enqueued',
      taskId: item.id,
      data: { retry: true, retryCount: item.retryCount, error: errMsg },
    });
    schedulePersist();
    return;
  }

  item.status = 'failed';
  item.completedAt = Date.now();
  item.error = {
    message: errMsg,
    code: errCode,
    stack: errStack,
    retryable: false,
  };
  emit({
    type: 'task_failed',
    taskId: item.id,
    data: { error: item.error },
  });
  schedulePersist();
}

/**
 * Mark an item as completed successfully.
 */
function completeItem(item: TaskQueueItem, result: unknown): void {
  if (item.status === 'cancelled') return;
  item.status = 'completed';
  item.completedAt = Date.now();
  item.progress = 100;
  item.result = result as never;
  emit({
    type: 'task_completed',
    taskId: item.id,
    data: { result: result as Record<string, unknown> },
  });
  // Record important task results to memory (only agent + function with tag)
  if (_memoryRecordFn) {
    try { _memoryRecordFn(item); } catch { /* best effort */ }
  }
  schedulePersist();
}

// ─── Agent Event Bridge ─────────────────────────────────────────────────────

/**
 * Map of agentTaskId → listeners waiting for that agent's terminal event.
 */
const _agentEventListeners = new Map<string, Set<(event: { type: string; taskId: string }) => void>>();

/**
 * Handle an agent event from the agent core. Used to detect when agent-kind
 * queue items finish (the agent emits task_completed/failed/cancelled events).
 *
 * Also forwards progress events: step_started → progress=10%, step_completed →
 * progress = (stepIndex/totalSteps)*100, etc.
 */
function handleAgentEvent(event: { type: string; taskId: string }): void {
  // Notify any listeners waiting on this agentTaskId
  const listeners = _agentEventListeners.get(event.taskId);
  if (listeners) {
    for (const listener of listeners) {
      try { listener(event); } catch { /* best effort */ }
    }
  }

  // Find the queue item tracking this agent task
  let queueItem: TaskQueueItem | undefined;
  for (const item of _items.values()) {
    if (item.kind === 'agent' && item.agentTaskId === event.taskId && item.status === 'running') {
      queueItem = item;
      break;
    }
  }
  if (!queueItem) return;

  // Map agent step events → progress
  if (event.type === 'planning_started') {
    queueItem.progress = 5;
    emitProgress(queueItem);
  } else if (event.type === 'planning_completed') {
    queueItem.progress = 15;
    emitProgress(queueItem);
  } else if (event.type === 'step_started') {
    // Approximate progress based on step index
    const stepIdx = (event as { step?: { index?: number } }).step?.index ?? 0;
    const totalSteps = queueItem.metadata?.totalSteps as number || 10;
    queueItem.progress = Math.min(95, 15 + Math.round((stepIdx / totalSteps) * 80));
    emitProgress(queueItem);
  } else if (event.type === 'step_completed') {
    const stepIdx = (event as { step?: { index?: number } }).step?.index ?? 0;
    const totalSteps = queueItem.metadata?.totalSteps as number || 10;
    queueItem.progress = Math.min(95, 20 + Math.round(((stepIdx + 1) / totalSteps) * 75));
    emitProgress(queueItem);
  }
}

function emitProgress(item: TaskQueueItem): void {
  emit({
    type: 'task_progress',
    taskId: item.id,
    data: { progress: item.progress },
  });
}

// ─── Event Emission ──────────────────────────────────────────────────────────

function emit(event: Omit<TaskQueueEvent, 'timestamp'>): void {
  const fullEvent: TaskQueueEvent = { ...event, timestamp: Date.now() };
  for (const listener of _listeners) {
    try { listener(fullEvent); } catch { /* best effort — never crash the queue */ }
  }
}

// ─── Persistence (debounced) ──────────────────────────────────────────────────

function schedulePersist(): void {
  if (!_persistenceInitialized) return;
  if (_persistDebounce) clearTimeout(_persistDebounce);
  _persistDebounce = setTimeout(() => {
    _persistDebounce = null;
    saveQueueState(Array.from(_items.values()), _config);
  }, 200);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compare two items for priority queue ordering.
 * Lower priority weight first; ties broken by earlier enqueuedAt (FIFO).
 */
function comparePriority(a: TaskQueueItem, b: TaskQueueItem): number {
  const pa = PRIORITY_WEIGHT[a.priority] ?? PRIORITY_WEIGHT.normal;
  const pb = PRIORITY_WEIGHT[b.priority] ?? PRIORITY_WEIGHT.normal;
  if (pa !== pb) return pa - pb;
  return a.enqueuedAt - b.enqueuedAt;
}

/**
 * Prune terminal items beyond the history limit. Called periodically.
 */
export function pruneHistory(): number {
  const terminal = Array.from(_items.values()).filter((it) => isTerminalStatus(it.status));
  if (terminal.length <= _config.historyLimit) return 0;
  // Sort by completedAt desc, keep the most recent historyLimit items
  terminal.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const toRemove = terminal.slice(_config.historyLimit);
  for (const item of toRemove) {
    _items.delete(item.id);
    _cancellationTokens.delete(item.cancellationKey);
  }
  schedulePersist();
  return toRemove.length;
}

/**
 * Clear all items (for tests / reset).
 */
export function clearAllTasks(): void {
  _items.clear();
  _queue.length = 0;
  _running.clear();
  _cancellationTokens.clear();
  schedulePersist();
}
