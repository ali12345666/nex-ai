/**
 * NEX AI — Phase 10: browser_close tool
 *
 * Close the browser session for the current task. Safe to call even if
 * the session is already closed or doesn't exist.
 *
 * After close, the next browser tool call will create a fresh session
 * (clean cookies, storage, etc.).
 *
 * Permission: 'browser'.
 */

import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../../tool-registry';
import { closeSession, isBrowserEnabled, getTaskIdFromContext } from './helpers';

export class BrowserCloseTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'browser_close',
    description: 'Close the browser session for the current task. Safe to call even if already closed.',
    category: 'browser',
    permission: 'browser',
    requiresNetwork: false,
    destructive: false,
    parameters: [],
    returns: { type: 'object', description: 'Confirmation of close' },
    tags: ['browser', 'session'],
  };

  async execute(_params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    if (!isBrowserEnabled()) {
      return {
        success: false,
        error: 'Browser automation is disabled. Enable it in Settings → Browser Automation (opt-in).',
      };
    }
    const taskId = getTaskIdFromContext(context);
    if (!taskId) {
      return {
        success: false,
        error: 'Browser tools require a task ID in context.metadata (missing taskId).',
      };
    }
    try {
      await closeSession(taskId);
      return {
        success: true,
        output: `Browser session closed for task ${taskId}`,
        data: { taskId },
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Close failed: ${err.message}`,
      };
    }
  }
}
