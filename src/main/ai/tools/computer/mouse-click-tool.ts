/**
 * NEX AI — Phase 11: mouse_click tool
 *
 * Click the mouse at specified coordinates. Validates coordinates against
 * screen dimensions before clicking.
 *
 * Permission: 'computer'.
 * Security: coordinate bounds checking, goes through Permission Gate.
 */

import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../../tool-registry';
import { acquireSession, withCrashRecovery, validateMouseCoordinates, recordMousePosition } from './helpers';

export class MouseClickTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'mouse_click',
    description: 'Click the mouse at coordinates (x, y). Validates coordinates against screen dimensions first.',
    category: 'computer',
    permission: 'computer',
    requiresNetwork: false,
    destructive: false,
    parameters: [
      { name: 'x', type: 'number', description: 'X coordinate (pixels, 0-based from top-left)', required: true },
      { name: 'y', type: 'number', description: 'Y coordinate (pixels, 0-based from top-left)', required: true },
      { name: 'button', type: 'string', description: 'Mouse button: "left" (default), "right", or "middle"', required: false, enum: ['left', 'right', 'middle'], default: 'left' },
    ],
    returns: { type: 'object', description: 'Confirmation of the click' },
    tags: ['computer', 'mouse'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const x = params.x;
    const y = params.y;
    if (x === undefined || x === null) return { success: false, error: 'Missing required parameter: x' };
    if (y === undefined || y === null) return { success: false, error: 'Missing required parameter: y' };

    const button = params.button || 'left';
    if (!['left', 'right', 'middle'].includes(button)) {
      return { success: false, error: `Invalid button: ${button} (must be left/right/middle)` };
    }

    const acquire = await acquireSession(context);
    if ('error' in acquire) return acquire.error;
    const { session } = acquire;

    // Validate coordinates before clicking
    const coordCheck = await validateMouseCoordinates(x, y);
    if (!coordCheck.ok) return coordCheck.error;

    return withCrashRecovery(session.taskId, async () => {
      try {
        const nut = require('@nut-tree-fork/nut-js');
        // Move to coordinates + click
        await nut.mouse.setPosition({ x, y });
        const Button = nut.Button;
        const buttonMap: Record<string, any> = {
          left: Button.LEFT,
          right: Button.RIGHT,
          middle: Button.MIDDLE,
        };
        await nut.mouse.leftClick();  // nut-js has leftClick/rightClick/middleClick helpers
        // If right/middle, use the specific click
        if (button === 'right') {
          await nut.mouse.rightClick();
        } else if (button === 'middle') {
          // nut-js doesn't have middleClick helper — use click + Button.MIDDLE
          await nut.mouse.click(buttonMap.middle);
        }
        recordMousePosition(session.taskId, x, y);
        return {
          success: true,
          output: `Clicked ${button} at (${x}, ${y})`,
          data: { x, y, button },
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Click failed: ${err.message}`,
          data: { x, y, button },
        };
      }
    });
  }
}
