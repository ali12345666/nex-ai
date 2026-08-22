/**
 * NEX AI — State Machine
 *
 * Validates AgentTask status transitions to prevent illegal state changes
 * (e.g. completed → executing is not allowed).
 *
 * Also provides recovery logic for interrupted tasks (e.g. agent crashed
 * mid-execution — on startup we detect and transition them to 'failed').
 *
 * Legal transitions:
 *   pending → planning
 *   planning → awaiting_permission | executing | observing | verifying | failed | cancelled
 *   awaiting_permission → executing | cancelled | failed
 *   executing → observing | verifying | awaiting_diff_approval | failed | cancelled | awaiting_permission
 *   observing → verifying | executing | awaiting_permission | failed | cancelled
 *   verifying → completed | retrying | failed | cancelled | executing
 *   retrying → executing
 *   completed → (terminal — no transitions out)
 *   failed → (terminal — no transitions out)
 *   cancelled → (terminal — no transitions out)
 *   paused → executing | cancelled
 *   awaiting_diff_approval → executing | cancelled | failed
 */

import type { AgentTask, AgentTaskStatus } from './types';

const TRANSITIONS: Record<AgentTaskStatus, AgentTaskStatus[]> = {
  pending: ['planning'],
  planning: ['awaiting_permission', 'executing', 'observing', 'verifying', 'failed', 'cancelled'],
  awaiting_permission: ['executing', 'cancelled', 'failed'],
  executing: ['observing', 'verifying', 'awaiting_diff_approval', 'failed', 'cancelled', 'awaiting_permission'],
  observing: ['verifying', 'executing', 'awaiting_permission', 'failed', 'cancelled'],
  verifying: ['completed', 'retrying', 'failed', 'cancelled', 'executing'],
  retrying: ['executing'],
  completed: [],
  failed: [],
  cancelled: [],
  paused: ['executing', 'cancelled'],
  awaiting_diff_approval: ['executing', 'cancelled', 'failed'],
};

const TERMINAL_STATES: AgentTaskStatus[] = ['completed', 'failed', 'cancelled'];

/**
 * Check if a transition is legal.
 */
export function isValidTransition(from: AgentTaskStatus, to: AgentTaskStatus): boolean {
  if (from === to) return true;  // no-op transitions are always allowed
  const allowed = TRANSITIONS[from] || [];
  return allowed.includes(to);
}

/**
 * Transition a task to a new status. Throws if the transition is illegal.
 */
export function transitionTaskStatus(task: AgentTask, to: AgentTaskStatus): void {
  const from = task.status;
  if (!isValidTransition(from, to)) {
    throw new Error(`Illegal state transition: ${from} → ${to} (task ${task.id})`);
  }
  task.status = to;
}

/**
 * Check if a task is in a terminal state (cannot be modified further).
 */
export function isTerminalStatus(status: AgentTaskStatus): boolean {
  return TERMINAL_STATES.includes(status);
}

/**
 * On startup: detect tasks that were left in a non-terminal state when
 * the agent crashed. Transition them to 'failed' with a note.
 *
 * This prevents zombie tasks from staying in 'executing' forever.
 */
export function recoverInterruptedTask(task: AgentTask): { recovered: boolean; reason?: string } {
  if (isTerminalStatus(task.status)) {
    return { recovered: false };
  }
  // Force-transition to failed (terminal)
  const previousStatus = task.status;
  task.status = 'failed';
  task.completedAt = Date.now();
  task.errors.push({
    id: `err-recovery-${Date.now()}`,
    type: 'invalid_state',
    message: `Task was interrupted (was in '${previousStatus}' state at process exit). Recovered as 'failed' on startup.`,
    timestamp: Date.now(),
  });
  return {
    recovered: true,
    reason: `Recovered from interrupted state '${previousStatus}'`,
  };
}
