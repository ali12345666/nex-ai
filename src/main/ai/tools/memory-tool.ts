/**
 * NEX AI — Memory Tool
 *
 * Agent tool for storing and retrieving memories.
 * Allows the agent to remember user preferences, project info, and
 * previous decisions across sessions.
 *
 * Tools:
 *   - remember: store a memory entry (user/project/task knowledge)
 *   - search_memory: search across all memory stores
 *   - forget: delete a specific memory entry
 */

import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

export class RememberTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'remember',
    description: 'Store a piece of information in long-term memory. Use for user preferences, project details, or important decisions that should persist across sessions.',
    category: 'memory',
    permission: 'write',
    parameters: [
      { name: 'key', type: 'string', description: 'A short identifier for the memory (e.g. "user_language", "project_framework")', required: true },
      { name: 'value', type: 'string', description: 'The information to remember', required: true },
      { name: 'store', type: 'string', description: 'Memory store type', default: 'user', enum: ['user', 'project', 'task', 'knowledge', 'session'] },
      { name: 'tags', type: 'array', description: 'Optional tags for categorization', items: { name: 'tag', type: 'string', description: 'Tag name' } },
    ],
    returns: { type: 'string', description: 'Confirmation message' },
    tags: ['memory', 'store', 'persist'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const key = params.key;
    const value = params.value;
    if (!key || !value) return { success: false, error: 'Missing required parameters: key and value' };

    const store = params.store || 'user';
    try {
      const { setMemory } = require('../../memory');
      const projectId = context.projectPath || undefined;
      setMemory(store, key, {
        value,
        tags: params.tags || [],
        timestamp: Date.now(),
      }, projectId);

      return {
        success: true,
        output: `Remembered: ${key} = ${value.substring(0, 80)}${value.length > 80 ? '...' : ''} (store: ${store})`,
        data: { key, store, projectId },
      };
    } catch (err: any) {
      return { success: false, error: `Failed to store memory: ${err.message}` };
    }
  }
}

export class SearchMemoryTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'search_memory',
    description: 'Search across all memory stores for relevant information. Returns matching entries from user, project, task, and knowledge memories.',
    category: 'memory',
    permission: 'read',
    parameters: [
      { name: 'query', type: 'string', description: 'Search query', required: true },
      { name: 'store', type: 'string', description: 'Specific store to search (default: all)', enum: ['user', 'project', 'task', 'knowledge', 'session'] },
      { name: 'limit', type: 'number', description: 'Max results (default: 10)', default: 10 },
    ],
    returns: { type: 'string', description: 'Matching memory entries' },
    tags: ['memory', 'search', 'recall'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const query = params.query;
    if (!query) return { success: false, error: 'Missing required parameter: query' };

    const limit = params.limit || 10;
    const projectId = context.projectPath || undefined;
    try {
      const { queryMemory, listMemory } = require('../../memory');
      const stores = params.store ? [params.store] : ['user', 'project', 'task', 'knowledge'];
      const allResults: any[] = [];

      for (const store of stores) {
        try {
          const results = queryMemory(store, { text: query, limit }, projectId);
          if (results && results.length > 0) {
            allResults.push(...results.map((r: any) => ({ ...r, store })));
          }
        } catch { /* store may not exist */ }
      }

      if (allResults.length === 0) {
        return { success: true, output: 'No matching memories found.', data: { query, results: [] } };
      }

      const sorted = allResults
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, limit);

      const formatted = sorted.map((r, i) => {
        const val = typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
        return `${i + 1}. [${r.store}] ${r.key}: ${val.substring(0, 100)}`;
      }).join('\n');

      return {
        success: true,
        output: formatted,
        data: { query, results: sorted },
      };
    } catch (err: any) {
      return { success: false, error: `Memory search failed: ${err.message}` };
    }
  }
}

export class ForgetTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'forget',
    description: 'Delete a specific memory entry. Use when the user asks to forget or remove stored information.',
    category: 'memory',
    permission: 'delete',
    parameters: [
      { name: 'key', type: 'string', description: 'The memory key to delete', required: true },
      { name: 'store', type: 'string', description: 'Memory store type', default: 'user', enum: ['user', 'project', 'task', 'knowledge', 'session'] },
    ],
    returns: { type: 'string', description: 'Confirmation message' },
    tags: ['memory', 'delete', 'forget'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const key = params.key;
    if (!key) return { success: false, error: 'Missing required parameter: key' };

    const store = params.store || 'user';
    try {
      const { deleteMemory } = require('../../memory');
      const projectId = context.projectPath || undefined;
      const deleted = deleteMemory(store, key, projectId);

      if (deleted) {
        return { success: true, output: `Forgot: ${key} (store: ${store})` };
      } else {
        return { success: false, error: `Memory not found: ${key} in store ${store}` };
      }
    } catch (err: any) {
      return { success: false, error: `Failed to forget: ${err.message}` };
    }
  }
}
