/**
 * FileSystemTool — read_file
 *
 * Reads a file's content from disk.
 * Permission: 'read'
 * Security: assertPathInside(projectPath) — all paths jailed to workspace.
 */

import * as path from 'path';
import * as fs from 'fs';
import { assertPathInside } from '../../security';
import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

export class FileSystemTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'read_file',
    description: 'Read the content of a file. Returns the file content as text. For binary files, returns an error.',
    category: 'filesystem',
    permission: 'read',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Path to the file to read. Can be absolute or relative to the project root.',
        required: true,
      },
      {
        name: 'encoding',
        type: 'string',
        description: 'Text encoding (default: utf-8)',
        default: 'utf-8',
        enum: ['utf-8', 'ascii', 'base64'],
      },
    ],
    returns: { type: 'string', description: 'The file content' },
    tags: ['filesystem', 'read'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const filePath = params.path;
    if (!filePath) {
      return { success: false, error: 'Missing required parameter: path' };
    }
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(context.projectPath || process.cwd(), filePath);

    // Security: validate path is inside workspace + not a sensitive system path
    const root = context.projectPath || process.cwd();
    const guard = assertPathInside(absPath, [root]);
    if (!guard.ok) {
      return { success: false, error: `Access denied: ${guard.reason}. Path must be inside the project workspace.` };
    }

    if (!fs.existsSync(guard.resolved!)) {
      return { success: false, error: `File not found: ${guard.resolved}` };
    }
    const stat = fs.statSync(guard.resolved!);
    if (!stat.isFile()) {
      return { success: false, error: `Not a file: ${guard.resolved}` };
    }
    // Limit: 5MB to prevent huge file reads
    if (stat.size > 5 * 1024 * 1024) {
      return { success: false, error: `File too large (${(stat.size/1024/1024).toFixed(1)} MB). Max 5MB.` };
    }
    try {
      const encoding = params.encoding || 'utf-8';
      const content = fs.readFileSync(guard.resolved!, { encoding: encoding as BufferEncoding });
      return {
        success: true,
        output: content,
        data: { path: guard.resolved, size: stat.size, encoding },
      };
    } catch (err: any) {
      return { success: false, error: `Failed to read file: ${err.message}` };
    }
  }
}
