/**
 * OpenFileInEditorTool — open_file_in_editor
 *
 * Opens a file in the NEX AI Monaco Editor by sending an IPC event
 * to the renderer process. The renderer's Zustand store handles the
 * actual openFile() call.
 *
 * This tool bridges the Agent → UI gap: when the agent opens a file
 * (e.g. "باز کن"), the file appears in the editor automatically.
 *
 * Security: path must be inside the workspace (assertPathInside)
 */

import * as path from 'path';
import * as fs from 'fs';
import { assertPathInside } from '../../security';
import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

export class OpenFileInEditorTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'open_file_in_editor',
    description:
      'Open a file in the NEX AI Monaco Editor. ' +
      'Use this when the user says "باز کن", "open", "بالا بیار" — ' +
      'it makes the file visible in the editor UI. ' +
      'The file must exist on disk.',
    category: 'filesystem',
    permission: 'read',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Absolute or relative path to the file to open in the editor.',
        required: true,
      },
    ],
    returns: { type: 'string', description: 'Confirmation that the file was opened' },
    tags: ['filesystem', 'editor', 'open', 'ui'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const filePath = params.path;
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Missing or invalid parameter: path' };
    }

    const root = context.projectPath || process.cwd();
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);

    // Security: path must be inside workspace
    const guard = assertPathInside(absPath, [root]);
    if (!guard.ok) {
      return { success: false, error: `Access denied: ${guard.reason}` };
    }
    const safePath = guard.resolved!;

    // Verify file exists
    if (!fs.existsSync(safePath)) {
      return { success: false, error: `File not found: ${path.relative(root, safePath)}` };
    }
    const stat = fs.statSync(safePath);
    if (!stat.isFile()) {
      return { success: false, error: 'Path is not a file' };
    }

    // Send IPC to renderer to open the file in the editor
    try {
      const { BrowserWindow } = require('electron');
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        const win = windows[0];
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send('open-file-in-editor', { path: safePath });
          console.log(`[OPEN_FILE_IN_EDITOR] Sent open request for: ${safePath}`);
        }
      }

      return {
        success: true,
        output: `File opened in editor: ${path.relative(root, safePath)}`,
        data: {
          path: safePath,
          relativePath: path.relative(root, safePath),
          size: stat.size,
        },
        durationMs: 0,
      };
    } catch (err: any) {
      return { success: false, error: `Failed to open file in editor: ${err.message}` };
    }
  }
}
