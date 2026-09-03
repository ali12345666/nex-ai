/**
 * SearchFilesTool — search_files
 *
 * Searches file contents using the secure searchFileContents function
 * (no shell command — pure Node implementation).
 * Permission: 'read'
 */

import * as path from 'path';
import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { searchFileContents } from '../../security/shell';

export class SearchFilesTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'search_files',
    description: 'Search file contents in a directory for a query string. Returns matching lines with file paths and line numbers. Searches up to 100 matches.',
    category: 'filesystem',
    permission: 'read',
    parameters: [
      {
        name: 'query',
        type: 'string',
        description: 'The search query (case-insensitive)',
        required: true,
      },
      {
        name: 'dir',
        type: 'string',
        description: 'Directory to search in (default: project root)',
      },
      {
        name: 'maxResults',
        type: 'number',
        description: 'Maximum number of matches (default: 100)',
        default: 100,
      },
    ],
    returns: { type: 'array', description: 'Array of { file, line, content }' },
    tags: ['filesystem', 'search'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const query = params.query;
    if (!query) {
      return { success: false, error: 'Missing required parameter: query' };
    }
    const dir = params.dir || context.projectPath || process.cwd();
    const absDir = path.isAbsolute(dir) ? dir : path.join(context.projectPath || process.cwd(), dir);
    const maxResults = Math.max(1, Math.min(500, params.maxResults || 100));

    try {
      const results = await searchFileContents(absDir, query, { maxResults });
      return {
        success: true,
        output: results.length === 0
          ? `No matches found for "${query}" in ${absDir}`
          : `Found ${results.length} match(es):\n` + results.map((r) => `${r.file}:${r.line}: ${r.content.trim()}`).join('\n'),
        data: { results, count: results.length, query, dir: absDir },
      };
    } catch (err: any) {
      return { success: false, error: `Search failed: ${err.message}` };
    }
  }
}
