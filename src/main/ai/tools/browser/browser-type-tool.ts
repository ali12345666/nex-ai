/**
 * NEX AI — Phase 10: browser_type tool
 *
 * Type text into an input element by selector. Clears the field first
 * by default, then types the text.
 *
 * Permission: 'browser'.
 * Security: the text being typed is NOT logged raw (it may contain
 * credentials — redaction applied by AgentLogger when the tool result
 * is emitted as an event).
 */

import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../../tool-registry';
import { acquireSession, withCrashRecovery } from './helpers';

export class BrowserTypeTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'browser_type',
    description: 'Type text into an input element by CSS selector. Clears the field first by default.',
    category: 'browser',
    permission: 'browser',
    requiresNetwork: true,
    destructive: false,
    parameters: [
      { name: 'selector', type: 'string', description: 'CSS selector for the input element', required: true },
      { name: 'text', type: 'string', description: 'The text to type into the field', required: true },
      { name: 'clear_first', type: 'boolean', description: 'Clear the field before typing (default: true)', required: false, default: true },
      { name: 'timeout', type: 'number', description: 'Wait timeout in ms (default: 30000)', required: false, default: 30000 },
    ],
    returns: { type: 'object', description: 'Confirmation of the type action' },
    tags: ['browser', 'interaction'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const selector = params.selector;
    const text = params.text;
    if (!selector) return { success: false, error: 'Missing required parameter: selector' };
    if (text === undefined || text === null) return { success: false, error: 'Missing required parameter: text' };

    const acquire = await acquireSession(context);
    if ('error' in acquire) return acquire.error;
    const { session } = acquire;

    const clearFirst = params.clear_first !== false;  // default true
    const timeout = params.timeout || 30000;

    return withCrashRecovery(session.taskId, async () => {
      try {
        await session.page.waitForSelector(selector, { state: 'visible', timeout });
        if (clearFirst) {
          await session.page.fill(selector, '', { timeout });
        }
        await session.page.type(selector, String(text), { timeout });
        // We do NOT echo back the typed text (it may be a credential).
        return {
          success: true,
          output: `Typed ${String(text).length} character(s) into ${selector}`,
          data: { selector, charCount: String(text).length },
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Type failed: ${err.message}`,
          data: { selector },
        };
      }
    });
  }
}
