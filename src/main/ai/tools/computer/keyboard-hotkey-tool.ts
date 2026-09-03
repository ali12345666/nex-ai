/**
 * NEX AI — Phase 11: keyboard_hotkey tool
 *
 * Press a keyboard hotkey combination (e.g. "Ctrl+C", "Alt+Tab").
 * Validates the hotkey against an allow-list to prevent arbitrary input.
 *
 * Permission: 'computer'.
 * Security: hotkey string is validated (only allowed modifiers + keys).
 */

import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../../tool-registry';
import { acquireSession, withCrashRecovery, validateHotkeyString } from './helpers';

export class KeyboardHotkeyTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'keyboard_hotkey',
    description: 'Press a keyboard hotkey combination (e.g. "Ctrl+C", "Alt+Tab"). Validates the combination against an allow-list.',
    category: 'computer',
    permission: 'computer',
    requiresNetwork: false,
    destructive: false,
    parameters: [
      { name: 'hotkey', type: 'string', description: 'Hotkey combination (e.g. "Ctrl+C", "Alt+Tab", "Shift+F1"). Modifiers: Ctrl, Alt, Shift, Cmd. Keys: A-Z, 0-9, F1-F12, Enter, Tab, Escape, Space, arrows, etc.', required: true },
    ],
    returns: { type: 'object', description: 'Confirmation of the hotkey press' },
    tags: ['computer', 'keyboard'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const hotkey = params.hotkey;
    if (!hotkey) return { success: false, error: 'Missing required parameter: hotkey' };

    // Validate hotkey against allow-list
    const hotkeyCheck = validateHotkeyString(hotkey);
    if (!hotkeyCheck.ok) return hotkeyCheck.error;

    const acquire = await acquireSession(context);
    if ('error' in acquire) return acquire.error;
    const { session } = acquire;

    return withCrashRecovery(session.taskId, async () => {
      try {
        const nut = require('@nut-tree-fork/nut-js');
        const parts = hotkey.toLowerCase().split('+').map((p: string) => p.trim()).filter(Boolean);
        const key = parts[parts.length - 1];
        const modifiers = parts.slice(0, -1);

        // Map modifier names to nut-js Key constants
        const Key = nut.Key;
        const modifierMap: Record<string, any> = {
          ctrl: Key.LeftControl,
          alt: Key.LeftAlt,
          shift: Key.LeftShift,
          cmd: Key.LeftSuper,
          meta: Key.LeftSuper,
          super: Key.LeftSuper,
        };
        const keyMap: Record<string, any> = {
          a: Key.A, b: Key.B, c: Key.C, d: Key.D, e: Key.E, f: Key.F, g: Key.G,
          h: Key.H, i: Key.I, j: Key.J, k: Key.K, l: Key.L, m: Key.M, n: Key.N,
          o: Key.O, p: Key.P, q: Key.Q, r: Key.R, s: Key.S, t: Key.T, u: Key.U,
          v: Key.V, w: Key.W, x: Key.X, y: Key.Y, z: Key.Z,
          '0': Key.Num0, '1': Key.Num1, '2': Key.Num2, '3': Key.Num3, '4': Key.Num4,
          '5': Key.Num5, '6': Key.Num6, '7': Key.Num7, '8': Key.Num8, '9': Key.Num9,
          f1: Key.F1, f2: Key.F2, f3: Key.F3, f4: Key.F4, f5: Key.F5, f6: Key.F6,
          f7: Key.F7, f8: Key.F8, f9: Key.F9, f10: Key.F10, f11: Key.F11, f12: Key.F12,
          enter: Key.Enter, return: Key.Enter, tab: Key.Tab,
          escape: Key.Escape, esc: Key.Escape, space: Key.Space,
          backspace: Key.Backspace, delete: Key.Delete,
          home: Key.Home, end: Key.End, pageup: Key.PageUp, pagedown: Key.PageDown,
          up: Key.Up, down: Key.Down, left: Key.Left, right: Key.Right,
          insert: Key.Insert,
        };

        const nutKey = keyMap[key];
        if (!nutKey) {
          return { success: false, error: `Hotkey key "${key}" could not be mapped to nut-js Key` };
        }

        // Press modifiers + key, then release in reverse order
        const modifierKeys = modifiers.map((m: string) => modifierMap[m]).filter(Boolean);
        for (const mod of modifierKeys) {
          await nut.keyboard.pressKey(mod);
        }
        await nut.keyboard.pressKey(nutKey);
        await nut.keyboard.releaseKey(nutKey);
        for (let i = modifierKeys.length - 1; i >= 0; i--) {
          await nut.keyboard.releaseKey(modifierKeys[i]);
        }

        return {
          success: true,
          output: `Pressed hotkey: ${hotkey}`,
          data: { hotkey, modifiers: modifiers.length },
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Hotkey failed: ${err.message}`,
          data: { hotkey },
        };
      }
    });
  }
}
