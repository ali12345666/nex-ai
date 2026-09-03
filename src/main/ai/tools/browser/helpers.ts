/**
 * NEX AI — Phase 10: Browser Tool Helpers
 *
 * Shared utilities for browser tools: permission check, session access,
 * error classification, safe result building.
 *
 * Tools should NOT duplicate session logic — they all delegate to
 * session-manager.ts.
 */

import type { ToolResult, ToolContext } from '../../tool-registry';
import {
  getOrCreateSession,
  getSession,
  isBrowserEnabled,
  isUrlBlocked,
  isBrowserCrashError,
  markSessionDead,
  updateSessionState,
  type BrowserSession,
} from './session-manager';

/**
 * Get the task ID from a ToolContext. The agent core sets
 * context.metadata.taskId when executing a tool. For function-kind
 * tasks (Phase 6 queue), it's set in TaskExecutionContext.metadata.
 */
export function getTaskIdFromContext(context: ToolContext): string | undefined {
  const meta = context.metadata as any;
  return meta?.taskId || meta?.agentTaskId;
}

/**
 * Pre-flight check for every browser tool:
 *   1. Browser automation is enabled (opt-in)
 *   2. We have a task ID in context
 *   3. We can get/create a session
 *
 * Returns a session on success, or an error ToolResult on failure.
 */
export async function acquireSession(context: ToolContext): Promise<{ session: BrowserSession } | { error: ToolResult }> {
  if (!isBrowserEnabled()) {
    return {
      error: {
        success: false,
        error: 'Browser automation is disabled. Enable it in Settings → Browser Automation (opt-in).',
      },
    };
  }
  const taskId = getTaskIdFromContext(context);
  if (!taskId) {
    return {
      error: {
        success: false,
        error: 'Browser tools require a task ID in context.metadata (missing taskId).',
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
        error: `Failed to acquire browser session: ${err.message}`,
      },
    };
  }
}

/**
 * Validate a URL before navigation. Returns null if OK, or an error
 * ToolResult if blocked.
 */
export function validateUrl(url: string): { ok: true } | { ok: false; error: ToolResult } {
  const check = isUrlBlocked(url);
  if (check.blocked) {
    return {
      ok: false,
      error: {
        success: false,
        error: `URL validation failed: ${check.reason}`,
      },
    };
  }
  return { ok: true };
}

/**
 * Wrap a browser action in a try/catch that detects browser crashes
 * and marks the session as dead (so the next call creates a fresh session).
 *
 * Returns a ToolResult — either the action's result or a crash error.
 */
export async function withCrashRecovery<T extends ToolResult>(
  taskId: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (err: any) {
    if (isBrowserCrashError(err)) {
      markSessionDead(taskId);
      return {
        success: false,
        error: `Browser crashed: ${err.message}. Session marked dead — next call will create a fresh session.`,
      } as T;
    }
    throw err;  // re-throw non-crash errors for the tool to handle
  }
}

/**
 * Update session state (URL/title) after a successful navigation.
 */
export function recordNavigation(taskId: string, url: string, title?: string): void {
  updateSessionState(taskId, { url, title });
}
