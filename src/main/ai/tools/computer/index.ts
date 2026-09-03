/**
 * NEX AI — Phase 11: Computer Control — Public API
 *
 * Barrel + registration for computer tools.
 *
 * Computer tools are ONLY registered when the user has opted in (opt-in OFF
 * by default). The opt-in flag is checked at registration time + at runtime
 * (every tool checks isComputerEnabled() before doing anything).
 */

import type { Tool } from '../../tool-registry';
import { registerTool } from '../../tool-registry';
import { isComputerEnabled } from './session-manager';
import { ScreenshotDesktopTool } from './screenshot-desktop-tool';
import { MouseClickTool } from './mouse-click-tool';
import { MouseMoveTool } from './mouse-move-tool';
import { KeyboardTypeTool } from './keyboard-type-tool';
import { KeyboardHotkeyTool } from './keyboard-hotkey-tool';
import { ScrollTool } from './scroll-tool';

/**
 * Register computer tools if (and only if) computer control is enabled.
 * Called from ensureBuiltinToolsRegistered(). Safe to call multiple times
 * (the tool registry de-dupes by name).
 */
export function registerComputerTools(): void {
  if (!isComputerEnabled()) {
    // Don't register — tools won't appear in the planner's tool list.
    return;
  }
  registerTool(new ScreenshotDesktopTool());
  registerTool(new MouseClickTool());
  registerTool(new MouseMoveTool());
  registerTool(new KeyboardTypeTool());
  registerTool(new KeyboardHotkeyTool());
  registerTool(new ScrollTool());
}

/**
 * Get the list of computer tool definitions (for diagnostics). Always
 * returns the full list regardless of opt-in — useful for the settings
 * panel to show what's available.
 */
export function listComputerToolDefinitions() {
  return [
    new ScreenshotDesktopTool().definition,
    new MouseClickTool().definition,
    new MouseMoveTool().definition,
    new KeyboardTypeTool().definition,
    new KeyboardHotkeyTool().definition,
    new ScrollTool().definition,
  ];
}

// Re-export session manager for main.ts wiring
export {
  configureComputerSessions,
  setComputerEnabled,
  setConfirmationPolicy,
  isComputerEnabled,
  getConfirmationPolicy,
  closeSession,
  closeAllSessions,
  cleanupOrphanedSessions,
  getSessionInfo,
  getSessionCount,
  getActiveSessionTaskIds,
  isSystemWindowBlocked,
  addToBlocklist,
  removeFromBlocklist,
  getBlocklist,
  validateCoordinates,
  validateHotkey,
  isComputerCrashError,
  getScreenDimensions,
  type ComputerSession,
  type ComputerSessionInfo,
  type ScreenDimensions,
} from './session-manager';

export type ComputerTool = Tool;
