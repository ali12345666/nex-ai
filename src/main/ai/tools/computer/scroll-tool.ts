/**
 * NEX AI — Phase 11: scroll tool
 *
 * Scroll the mouse wheel at specified coordinates or at the current
 * mouse position. Validates coordinates if provided.
 *
 * Permission: 'computer'.
 * Security: coordinate bounds checking, goes through Permission Gate.
 */

import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../../tool-registry';
import { acquireSession, withCrashRecovery, validateMouseCoordinates } from './helpers';

export class ScrollTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'scroll',
    description: 'Scroll the mouse wheel. Can scroll at current position or move to coordinates first.',
    category: 'computer',
    permission: 'computer',
    requiresNetwork: false,
    destructive: false,
    parameters: [
      { name: 'x', type: 'number', description: 'X coordinate to scroll at (optional — scrolls at current position if omitted)', required: false },
      { name: 'y', type: 'number', description: 'Y coordinate to scroll at (optional — scrolls at current position if omitted)', required: false },
      { name: 'direction', type: 'string', description: 'Scroll direction: "up" (default) or "down"', required: false, enum: ['up', 'down'], default: 'up' },
      { name: 'amount', type: 'number', description: 'Scroll amount (number of notches, default: 3)', required: false, default: 3 },
    ],
    returns: { type: 'object', description: 'Confirmation of the scroll' },
    tags: ['computer', 'mouse'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const direction = params.direction || 'up';
    if (!['up', 'down'].includes(direction)) {
      return { success: false, error: `Invalid direction: ${direction} (must be up/down)` };
    }
    const amount = Math.max(1, Math.min(20, params.amount || 3));  // clamp 1-20

    const acquire = await acquireSession(context);
    if ('error' in acquire) return acquire.error;
    const { session } = acquire;

    // Validate coordinates if provided
    if (params.x !== undefined && params.y !== undefined) {
      const coordCheck = await validateMouseCoordinates(params.x, params.y);
      if (!coordCheck.ok) return coordCheck.error;
    }

    return withCrashRecovery(session.taskId, async () => {
      try {
        const nut = require('@nut-tree-fork/nut-js');
        // Move to coordinates if provided
        if (params.x !== undefined && params.y !== undefined) {
          await nut.mouse.setPosition({ x: params.x, y: params.y });
        }
        // Scroll — nut-js uses scrollDown/scrollUp with amount
        if (direction === 'down') {
          await nut.mouse.scrollDown(amount);
        } else {
          await nut.mouse.scrollUp(amount);
        }
        return {
          success: true,
          output: `Scrolled ${direction} ${amount} notch(es)${params.x !== undefined ? ` at (${params.x}, ${params.y})` : ''}`,
          data: { direction, amount, x: params.x, y: params.y },
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Scroll failed: ${err.message}`,
          data: { direction, amount },
        };
      }
    });
  }
}
