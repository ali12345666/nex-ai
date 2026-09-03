/**
 * NEX AI — Phase 10: browser_navigate tool
 *
 * Navigate the browser session to a URL. Waits for the page to load.
 *
 * Permission: 'browser' (new permission — more powerful than 'network'
 * because it runs JS, stores cookies, can click).
 *
 * Security:
 *   - URL validation (blocks private IPs, localhost, file://, non-http(s))
 *   - Requires opt-in (browser automation enabled in settings)
 *   - Goes through Permission Gate (executeToolWithPermission)
 */

import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../../tool-registry';
import { acquireSession, validateUrl, withCrashRecovery, recordNavigation } from './helpers';

export class BrowserNavigateTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'browser_navigate',
    description: 'Navigate the browser session to a URL. Waits for the page to load. The session is shared across steps of the same task (navigate → click → type → extract).',
    category: 'browser',
    permission: 'browser',
    requiresNetwork: true,
    destructive: false,
    parameters: [
      { name: 'url', type: 'string', description: 'The URL to navigate to (must be http/https; private IPs and localhost are blocked)', required: true },
      { name: 'wait_until', type: 'string', description: 'When to consider navigation done: "load" (default), "domcontentloaded", or "networkidle"', required: false, enum: ['load', 'domcontentloaded', 'networkidle'], default: 'load' },
      { name: 'timeout', type: 'number', description: 'Navigation timeout in ms (default: 30000)', required: false, default: 30000 },
    ],
    returns: { type: 'object', description: 'The final URL + page title' },
    tags: ['browser', 'navigation'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const url = params.url;
    if (!url) return { success: false, error: 'Missing required parameter: url' };

    const urlCheck = validateUrl(url);
    if (!urlCheck.ok) return urlCheck.error;

    const acquire = await acquireSession(context);
    if ('error' in acquire) return acquire.error;
    const { session } = acquire;

    const waitUntil = params.wait_until || 'load';
    const timeout = params.timeout || 30000;

    return withCrashRecovery(session.taskId, async () => {
      try {
        await session.page.goto(url, { waitUntil, timeout });
        const finalUrl = session.page.url();
        const title = await session.page.title().catch(() => undefined);
        recordNavigation(session.taskId, finalUrl, title);
        return {
          success: true,
          output: `Navigated to ${finalUrl}${title ? ` (title: ${title})` : ''}`,
          data: { url: finalUrl, title },
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Navigation failed: ${err.message}`,
          data: { url },
        };
      }
    });
  }
}
