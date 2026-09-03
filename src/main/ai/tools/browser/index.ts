/**
 * NEX AI — Phase 10: Browser Automation — Public API
 *
 * Barrel + registration for browser tools.
 *
 * Browser tools are ONLY registered when the user has opted in (opt-in OFF
 * by default). The opt-in flag is checked at registration time + at runtime
 * (every tool checks isBrowserEnabled() before doing anything).
 */

import type { Tool } from '../../tool-registry';
import { registerTool } from '../../tool-registry';
import { isBrowserEnabled } from './session-manager';
import { BrowserNavigateTool } from './browser-navigate-tool';
import { BrowserClickTool } from './browser-click-tool';
import { BrowserTypeTool } from './browser-type-tool';
import { BrowserExtractTool } from './browser-extract-tool';
import { BrowserScreenshotTool } from './browser-screenshot-tool';
import { BrowserCloseTool } from './browser-close-tool';

/**
 * Register browser tools if (and only if) browser automation is enabled.
 * Called from ensureBuiltinToolsRegistered(). Safe to call multiple times
 * (the tool registry de-dupes by name).
 *
 * When the user toggles the opt-in setting at runtime, they need to restart
 * the app (or we re-call this). For simplicity, we re-register on every
 * ensureBuiltinToolsRegistered call — registerTool() is idempotent.
 */
export function registerBrowserTools(): void {
  if (!isBrowserEnabled()) {
    // Don't register — tools won't appear in the planner's tool list.
    return;
  }
  registerTool(new BrowserNavigateTool());
  registerTool(new BrowserClickTool());
  registerTool(new BrowserTypeTool());
  registerTool(new BrowserExtractTool());
  registerTool(new BrowserScreenshotTool());
  registerTool(new BrowserCloseTool());
}

/**
 * Get the list of browser tool definitions (for diagnostics). Always
 * returns the full list regardless of opt-in — useful for the settings
 * panel to show what's available.
 */
export function listBrowserToolDefinitions() {
  return [
    new BrowserNavigateTool().definition,
    new BrowserClickTool().definition,
    new BrowserTypeTool().definition,
    new BrowserExtractTool().definition,
    new BrowserScreenshotTool().definition,
    new BrowserCloseTool().definition,
  ];
}

// Re-export session manager for main.ts wiring
export {
  configureBrowserSessions,
  setBrowserEnabled,
  isBrowserEnabled,
  closeSession,
  closeAllSessions,
  cleanupOrphanedSessions,
  getSessionInfo,
  getSessionCount,
  getActiveSessionTaskIds,
  isUrlBlocked,
  isBrowserCrashError,
  type BrowserSession,
  type BrowserSessionInfo,
} from './session-manager';

export type BrowserTool = Tool;
