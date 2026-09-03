/**
 * NEX AI — Phase 11: mouse_move tool
 *
 * Move the mouse to specified coordinates. Validates coordinates first.
 *
 * Permission: 'computer'.
 * Security: coordinate bounds checking, goes through Permission Gate.
 */

import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../../tool-registry';
import { acquireSession, withCrashRecovery, validateMouseCoordinates, recordMousePosition } from './helpers';

export class MouseMoveTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'mouse_move',
    description: 'Move the mouse to coordinates (x, y). Validates coordinates against screen dimensions first. Does NOT click.',
    category: 'computer',
    permission: 'computer',
    requiresNetwork: false,
    destructive: false,
    parameters: [
      { name: 'x', type: 'number', description: 'X coordinate (pixels, 0-based from top-left)', required: true },
      { name: 'y', type: 'number', description: 'Y coordinate (pixels, 0-based from top-left)', required: true },
    ],
    returns: { type: 'object', description: 'Confirmation of the move' },
    tags: ['computer', 'mouse'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const x = params.x;
    const y = params.y;
    if (x === undefined || x === null) return { success: false, error: 'Missing required parameter: x' };
    if (y === undefined || y === null) return { success: false, error: 'Missing required parameter: y' };

    const acquire = await acquireSession(context);
    if ('error' in acquire) return acquire.error;
    const { session } = acquire;

    const coordCheck = await validateMouseCoordinates(x, y);
    if (!coordCheck.ok) return coordCheck.error;

    return withCrashRecovery(session.taskId, async () => {
      try {
        const nut = require('@nut-tree-fork/nut-js');
        await nut.mouse.setPosition({ x, y });
        recordMousePosition(session.taskId, x, y);
        return {
          success: true,
          output: `Moved mouse to (${x}, ${y})`,
          data: { x, y },
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Move failed: ${err.message}`,
          data: { x, y },
        };
      }
    });
  }
}
