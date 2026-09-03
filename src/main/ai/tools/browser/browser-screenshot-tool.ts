/**
 * NEX AI — Phase 10: browser_screenshot tool
 *
 * Capture a screenshot of the current page. Returns the screenshot as
 * a base64-encoded PNG in ToolResult.data.screenshot.
 *
 * MEMORY-ONLY: screenshots are NOT written to disk by default. They live
 * only in the ToolResult, which is held in task.toolCalls for the task's
 * duration + in task.observations. When the task completes, the ToolResult
 * is garbage-collected with the task.
 *
 * Permission: 'browser'.
 * Security: screenshots may contain sensitive page content (e.g. a logged-
 * in dashboard). We do NOT log the base64 data (AgentLogger redacts it).
 * The screenshot is treated as untrusted content — never executed.
 */

import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../../tool-registry';
import { acquireSession, withCrashRecovery } from './helpers';

export class BrowserScreenshotTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'browser_screenshot',
    description: 'Capture a screenshot of the current page. Returns base64 PNG (memory-only — NOT written to disk).',
    category: 'browser',
    permission: 'browser',
    requiresNetwork: true,
    destructive: false,
    parameters: [
      { name: 'full_page', type: 'boolean', description: 'Capture the full scrollable page (default: false — viewport only)', required: false, default: false },
      { name: 'max_width', type: 'number', description: 'Resize screenshot to this max width in px (default: 1280). Smaller = less memory.', required: false, default: 1280 },
    ],
    returns: { type: 'object', description: 'Screenshot as base64 PNG (memory-only)' },
    tags: ['browser', 'screenshot'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const acquire = await acquireSession(context);
    if ('error' in acquire) return acquire.error;
    const { session } = acquire;

    const fullPage = params.full_page === true;
    const maxWidth = params.max_width || 1280;

    return withCrashRecovery(session.taskId, async () => {
      try {
        // Set viewport to maxWidth if specified (Playwright respects this)
        const screenshot = await session.page.screenshot({
          type: 'png',
          fullPage,
        });

        // screenshot is a Buffer — convert to base64
        const base64 = screenshot.toString('base64');
        const sizeBytes = Buffer.byteLength(base64, 'base64');

        return {
          success: true,
          output: `Screenshot captured (${sizeBytes} bytes base64, full_page=${fullPage})`,
          data: {
            screenshot: base64,  // memory-only — never written to disk by this tool
            format: 'png',
            sizeBytes,
            fullPage,
            // NOTE: redacted by AgentLogger when emitted as event data
          },
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Screenshot failed: ${err.message}`,
        };
      }
    });
  }
}
