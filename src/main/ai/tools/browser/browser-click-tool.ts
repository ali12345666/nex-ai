/**
 * NEX AI — Phase 10: browser_click tool
 *
 * Click an element on the page by selector. Waits for the element to
 * be visible + actionable before clicking.
 *
 * Permission: 'browser'.
 * Security: goes through Permission Gate. The page content is UNTRUSTED —
 * we never execute page-provided selectors as agent commands (the selector
 * comes from the agent plan, not the page).
 */

import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../../tool-registry';
import { acquireSession, withCrashRecovery } from './helpers';

export class BrowserClickTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'browser_click',
    description: 'Click an element on the page by CSS selector. Waits for the element to be visible + actionable.',
    category: 'browser',
    permission: 'browser',
    requiresNetwork: true,
    destructive: false,
    parameters: [
      { name: 'selector', type: 'string', description: 'CSS selector for the element to click', required: true },
      { name: 'timeout', type: 'number', description: 'Wait timeout in ms (default: 30000)', required: false, default: 30000 },
    ],
    returns: { type: 'object', description: 'Confirmation of the click' },
    tags: ['browser', 'interaction'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const selector = params.selector;
    if (!selector) return { success: false, error: 'Missing required parameter: selector' };

    const acquire = await acquireSession(context);
    if ('error' in acquire) return acquire.error;
    const { session } = acquire;

    const timeout = params.timeout || 30000;

    return withCrashRecovery(session.taskId, async () => {
      try {
        await session.page.waitForSelector(selector, { state: 'visible', timeout });
        await session.page.click(selector, { timeout });
        return {
          success: true,
          output: `Clicked element: ${selector}`,
          data: { selector },
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Click failed: ${err.message}`,
          data: { selector },
        };
      }
    });
  }
}
