/**
 * NEX AI — Phase 11: Computer Tool Helpers
 *
 * Shared utilities for computer tools: permission check, session access,
 * coordinate validation, crash recovery, hotkey validation.
 *
 * Tools should NOT duplicate session logic — they all delegate to
 * session-manager.ts.
 */

import type { ToolResult, ToolContext } from '../../tool-registry';
import {
  getOrCreateSession,
  getSession,
  isComputerEnabled,
  validateCoordinates,
  validateHotkey,
  isSystemWindowBlocked,
  isComputerCrashError,
  markSessionDead,
  getScreenDimensions,
  updateSessionState,
  getConfirmationPolicy,
  type ComputerSession,
  type ScreenDimensions,
} from './session-manager';

/**
 * Get the task ID from a ToolContext. The agent core sets
 * context.metadata.taskId when executing a tool.
 */
export function getTaskIdFromContext(context: ToolContext): string | undefined {
  const meta = context.metadata as any;
  return meta?.taskId || meta?.agentTaskId;
}

/**
 * Pre-flight check for every computer tool:
 *   1. Computer control is enabled (opt-in)
 *   2. We have a task ID in context
 *   3. We can get/create a session
 *
 * Returns a session on success, or an error ToolResult on failure.
 */
export async function acquireSession(context: ToolContext): Promise<{ session: ComputerSession } | { error: ToolResult }> {
  if (!isComputerEnabled()) {
    return {
      error: {
        success: false,
        error: 'Computer control is disabled. Enable it in Settings → Computer Control (opt-in).',
      },
    };
  }
  const taskId = getTaskIdFromContext(context);
  if (!taskId) {
    return {
      error: {
        success: false,
        error: 'Computer tools require a task ID in context.metadata (missing taskId).',
      },
    };
  }
  try {
    const session = await getOrCreateSession(taskId);
    return { session };
  } catch (err: any) {
    return {
      error: {
        success: false,
        error: `Failed to acquire computer session: ${err.message}`,
      },
    };
  }
}

/**
 * Validate coordinates before a mouse action. Returns null if OK, or an
 * error ToolResult if out of bounds.
 */
export async function validateMouseCoordinates(x: number, y: number): Promise<{ ok: true; dims: ScreenDimensions } | { ok: false; error: ToolResult }> {
  const dims = await getScreenDimensions();
  const check = validateCoordinates(x, y, dims);
  if (!check.ok) {
    return {
      ok: false,
      error: {
        success: false,
        error: `Coordinate validation failed: ${check.reason}`,
      },
    };
  }
  return { ok: true, dims };
}

/**
 * Validate a hotkey string. Returns null if OK, or an error ToolResult.
 */
export function validateHotkeyString(hotkey: string): { ok: true } | { ok: false; error: ToolResult } {
  const check = validateHotkey(hotkey);
  if (!check.ok) {
    return {
      ok: false,
      error: {
        success: false,
        error: `Hotkey validation failed: ${check.reason}`,
      },
    };
  }
  return { ok: true };
}

/**
 * Wrap a computer action in a try/catch that detects native module crashes
 * and marks the session as dead (so the next call creates a fresh session).
 */
export async function withCrashRecovery<T extends ToolResult>(
  taskId: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (err: any) {
    if (isComputerCrashError(err)) {
      markSessionDead(taskId);
      return {
        success: false,
        error: `Computer native module crashed: ${err.message}. Session marked dead — next call will create a fresh session.`,
      } as T;
    }
    throw err;  // re-throw non-crash errors for the tool to handle
  }
}

/**
 * Update session state after a mouse action.
 */
export function recordMousePosition(taskId: string, x: number, y: number): void {
  updateSessionState(taskId, { mouseX: x, mouseY: y });
}

/**
 * Update session state after a screenshot.
 */
export function recordScreenshot(taskId: string): void {
  updateSessionState(taskId, { screenshotAt: Date.now() });
}

/**
 * Check if a window title should be blocked (system/security window).
 * Returns true if blocked — the caller should refuse to interact.
 */
export function checkWindowBlocked(windowTitle: string): boolean {
  return isSystemWindowBlocked(windowTitle);
}

/**
 * Get the current confirmation policy.
 */
export function getPolicy(): 'per-action' | 'session-wide' {
  return getConfirmationPolicy();
}
