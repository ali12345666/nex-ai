/**
 * NEX AI — Phase 6: Background Task Queue — Public API
 *
 * Barrel module for the task queue subsystem.
 */

export type {
  TaskPriority,
  TaskQueueStatus,
  TaskKind,
  TaskQueueItem,
  TaskError,
  TaskExecutionContext,
  TaskFunction,
  TaskQueueEventType,
  TaskQueueEvent,
  TaskQueueEventListener,
  TaskQueueConfig,
  EnqueueOptions,
  PersistedQueueState,
} from './types';

export {
  PRIORITY_WEIGHT,
  ALL_PRIORITIES,
  DEFAULT_QUEUE_CONFIG,
  TERMINAL_STATUSES,
  PERSISTABLE_STATUSES,
  isTerminalStatus,
  isValidPriority,
} from './types';

export {
  initTaskQueue,
  shutdownTaskQueue,
  enqueueAgentTask,
  enqueueFunction,
  registerTaskFunction,
  cancelTask,
  cancelAllTasks,
  pauseTask,
  resumeTask,
  getTask,
  listTasks,
  getQueueState,
  updateConfig,
  getConfig,
  onTaskQueueEvent,
  emitStateSnapshot,
  pruneHistory,
  clearAllTasks,
} from './queue';

export {
  initTaskQueuePersistence,
  loadQueueState,
  saveQueueState,
  recoverQueueState,
  clearQueueState,
  loadQueueConfig,
  isPersistableStatus,
} from './persistence';

export { orbStateForTaskEvent, hasActiveQueueWork } from './orb-bridge';
