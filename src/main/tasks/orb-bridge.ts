/**
 * NEX AI — Phase 6: Task Queue → Orb Bridge
 *
 * Maps TaskQueueEvent → Orb state via the existing state machine.
 *
 * Mapping (per Phase 6 §8):
 *   task_enqueued  → (no change — keep idle/ready)
 *   task_started   → 'working'  (tool execution begins)
 *   task_progress  → 'working'  (still executing)
 *   task_completed → 'success'  (brief flash, then clear)
 *   task_failed    → 'error'    (brief flash, then clear)
 *   task_cancelled → 'cancelled' (brief flash, then clear)
 *   task_recovered → 'error'    (interrupted by crash — show error briefly)
 *   task_paused    → (no change)
 *
 * This module does NOT directly drive the Orb — it returns the desired state
 * and the caller (AppShell) calls voiceController.setCondition('queue', state).
 *
 * State machine duplication check (Phase 6 §8 "Duplicate نکن"):
 *   This module DOES NOT define its own state machine. It only maps events
 *   to existing NexOrbState values (working, success, error, cancelled).
 *   The transition validation in orb-state.ts remains the single source of
 *   truth for valid transitions.
 */

import type { TaskQueueEvent } from './types';

/**
 * The Orb state to set for a given task queue event.
 * Returns null if the event should not affect the Orb.
 */
export function orbStateForTaskEvent(event: TaskQueueEvent): {
  state: 'working' | 'success' | 'error' | 'cancelled' | null;
  /** Whether to clear the condition after a brief flash (terminal events). */
  clearAfterMs?: number;
} {
  switch (event.type) {
    case 'task_started':
    case 'task_progress':
      return { state: 'working' };
    case 'task_completed':
      return { state: 'success', clearAfterMs: 1500 };
    case 'task_failed':
      return { state: 'error', clearAfterMs: 1500 };
    case 'task_cancelled':
      return { state: 'cancelled', clearAfterMs: 1500 };
    case 'task_recovered':
      return { state: 'error', clearAfterMs: 2000 };
    case 'task_enqueued':
    case 'task_paused':
    case 'queue_state':
    default:
      return { state: null };
  }
}

/**
 * Returns true if any of the queue's items are running (active work in
 * progress). Used by the UI to keep the Orb in 'working' state while
 * multiple tasks are running.
 */
export function hasActiveQueueWork(event: TaskQueueEvent, allItems: { status: string }[]): boolean {
  if (event.type === 'task_started' || event.type === 'task_progress') return true;
  if (event.type === 'task_completed' || event.type === 'task_failed' || event.type === 'task_cancelled') {
    // Check if other tasks are still running
    return allItems.some((it) => it.status === 'running');
  }
  return false;
}
