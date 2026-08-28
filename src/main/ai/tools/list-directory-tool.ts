/**
 * ListDirectoryTool — list_directory
 */

import * as path from 'path';
import * as fs from 'fs';
import { assertPathInside } from '../../security';
import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.cache', '.vscode', '.idea', 'release', 'target', '.gradle',
]);

export class ListDirectoryTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'list_directory',
    description: 'List the contents of a directory. Returns files and subdirectories with their types. Excludes common ignored directories (node_modules, .git, dist, build).',
    category: 'filesystem',
    permission: 'read',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Directory path (default: project root)',
      },
      {
        name: 'recursive',
        type: 'boolean',
        description: 'If true, list recursively (max depth 3)',
        default: false,
      },
    ],
    returns: { type: 'array', description: 'Array of { name, path, type }' },
    tags: ['filesystem', 'list'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const dir = params.path || context.projectPath || process.cwd();
    const absDir = path.isAbsolute(dir) ? dir : path.join(context.projectPath || process.cwd(), dir);

    // Security: validate path is inside workspace + not a sensitive system path
    const root = context.projectPath || process.cwd();
    const guard = assertPathInside(absDir, [root]);
    if (!guard.ok) {
      return { success: false, error: `Access denied: ${guard.reason}. Path must be inside the project workspace.` };
    }

    if (!fs.existsSync(guard.resolved!)) {
      return { success: false, error: `Directory not found: ${guard.resolved}` };
    }
    const stat = fs.statSync(guard.resolved!);
    if (!stat.isDirectory()) {
      return { success: false, error: `Not a directory: ${guard.resolved}` };
    }
    const recursive = params.recursive === true;
    try {
      const entries = recursive
        ? listRecursive(guard.resolved!, 3)
        : listOne(guard.resolved!);
      return {
        success: true,
        output: entries.map((e) => `${e.type === 'dir' ? '📁' : '📄'} ${e.path}`).join('\n'),
        data: { entries, count: entries.length },
      };
    } catch (err: any) {
      return { success: false, error: `Failed to list directory: ${err.message}` };
    }
  }
}

function listOne(dir: string): Array<{ name: string; path: string; type: 'file' | 'dir' }> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((e) => !IGNORED_DIRS.has(e.name) && !e.name.startsWith('.'))
    .map((e) => ({
      name: e.name,
      path: path.join(dir, e.name),
      type: (e.isDirectory() ? 'dir' : 'file') as 'file' | 'dir',
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

function listRecursive(dir: string, maxDepth: number, depth = 0): Array<{ name: string; path: string; type: 'file' | 'dir' }> {
  if (depth > maxDepth) return [];
  const entries = listOne(dir);
  const result: Array<{ name: string; path: string; type: 'file' | 'dir' }> = [];
  for (const e of entries) {
    result.push(e);
    if (e.type === 'dir') {
      const sub = listRecursive(e.path, maxDepth, depth + 1);
      result.push(...sub);
    }
  }
  return result;
}
