/**
 * NEX AI — Phase 11: keyboard_type tool
 *
 * Type text via the keyboard. The text is NOT stored in the ToolResult
 * (only charCount) — it may contain credentials.
 *
 * Permission: 'computer'.
 * Security: raw text NEVER in events/logs/memory (only charCount).
 */

import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../../tool-registry';
import { acquireSession, withCrashRecovery } from './helpers';

export class KeyboardTypeTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'keyboard_type',
    description: 'Type text via the keyboard. The text is NOT stored in the result (only character count) — may contain credentials.',
    category: 'computer',
    permission: 'computer',
    requiresNetwork: false,
    destructive: false,
    parameters: [
      { name: 'text', type: 'string', description: 'The text to type', required: true },
    ],
    returns: { type: 'object', description: 'Confirmation of the type action (charCount only — NOT the raw text)' },
    tags: ['computer', 'keyboard'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const text = params.text;
    if (text === undefined || text === null) return { success: false, error: 'Missing required parameter: text' };

    const acquire = await acquireSession(context);
    if ('error' in acquire) return acquire.error;
    const { session } = acquire;

    return withCrashRecovery(session.taskId, async () => {
      try {
        const nut = require('@nut-tree-fork/nut-js');
        await nut.keyboard.type(String(text));
        // We do NOT echo back the typed text (it may be a credential).
        return {
          success: true,
          output: `Typed ${String(text).length} character(s)`,
          data: { charCount: String(text).length },
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Type failed: ${err.message}`,
        };
      }
    });
  }
}
