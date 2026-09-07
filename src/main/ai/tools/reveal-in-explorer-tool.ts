/**
 * RevealInExplorerTool — reveal_in_explorer
 *
 * Opens a file or folder in the system file manager (Windows Explorer,
 * macOS Finder, Linux xdg-open) and brings it to the foreground.
 *
 * This tool bridges the Agent → OS gap: when the user says
 * "پوشه را باز کن" / "open folder" / "reveal in explorer", the folder
 * opens in the native file manager — NOT in the NEX AI editor.
 *
 * Security: path must be inside the workspace (assertPathInside).
 * Uses safeExecFile (no shell interpolation) to launch the file manager.
 */

import * as path from 'path';
import * as fs from 'fs';
import { assertPathInside } from '../../security';
import { safeExecFile } from '../../security/shell';
import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

export class RevealInExplorerTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'reveal_in_explorer',
    description:
      'Open a file or folder in the system file manager (Windows Explorer, ' +
      'macOS Finder, Linux file manager) and bring it to the foreground. ' +
      'Use this when the user says "پوشه را باز کن", "open folder", ' +
      '"reveal in explorer", "بازش کن", "بیار جلوی صفحه" — ' +
      'it opens the native file manager, NOT the NEX AI editor.',
    category: 'filesystem',
    permission: 'read',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Absolute or relative path to the file or folder to reveal.',
        required: true,
      },
    ],
    returns: { type: 'string', description: 'Confirmation that the path was revealed' },
    tags: ['filesystem', 'explorer', 'open', 'ui', 'system'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const targetPath = params.path;
    if (!targetPath || typeof targetPath !== 'string') {
      return { success: false, error: 'Missing or invalid parameter: path' };
    }

    const root = context.projectPath || process.cwd();
    const absPath = path.isAbsolute(targetPath) ? targetPath : path.join(root, targetPath);

    // Security: path must be inside workspace
    const guard = assertPathInside(absPath, [root]);
    if (!guard.ok) {
      return { success: false, error: `Access denied: ${guard.reason}` };
    }
    const safePath = guard.resolved!;

    // Verify path exists
    if (!fs.existsSync(safePath)) {
      return { success: false, error: `Path not found: ${path.relative(root, safePath)}` };
    }

    const platform = process.platform;
    let binary: string;
    let args: string[];

    if (platform === 'win32') {
      // Windows: explorer.exe /select,"path" (for files) or explorer.exe "path" (for folders)
      const stat = fs.statSync(safePath);
      if (stat.isDirectory()) {
        binary = 'explorer.exe';
        args = [safePath];
      } else {
        // For files: /select opens Explorer with the file selected
        binary = 'explorer.exe';
        args = ['/select,', safePath];
      }
    } else if (platform === 'darwin') {
      // macOS: open -R "path" (Reveal in Finder) or open "path" (open folder)
      const stat = fs.statSync(safePath);
      if (stat.isDirectory()) {
        binary = 'open';
        args = [safePath];
      } else {
        binary = 'open';
        args = ['-R', safePath];
      }
    } else {
      // Linux: xdg-open "path" (opens the file manager)
      binary = 'xdg-open';
      args = [safePath];
    }

    try {
      const result = await safeExecFile(binary, args, {
        cwd: root,
        timeout: 10000,
      });

      if (result.exitCode !== 0 && result.exitCode !== null) {
        // explorer.exe on Windows often returns exit code 1 even on success
        // (it launches asynchronously). So we only fail on real errors.
        if (platform !== 'win32') {
          return {
            success: false,
            error: `Failed to open in file manager: exit code ${result.exitCode}`,
          };
        }
      }

      // Also bring the NEX AI window to foreground (if the user said "بیار جلوی صفحه")
      try {
        const { BrowserWindow } = require('electron');
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          const win = windows[0];
          if (!win.isDestroyed()) {
            if (win.isMinimized()) win.restore();
            win.focus();
          }
        }
      } catch { /* best-effort — not critical */ }

      return {
        success: true,
        output: `Revealed in file manager: ${path.relative(root, safePath)}`,
        data: {
          path: safePath,
          relativePath: path.relative(root, safePath),
          platform,
        },
        durationMs: 0,
      };
    } catch (err: any) {
      return { success: false, error: `Failed to open in file manager: ${err.message}` };
    }
  }
}
