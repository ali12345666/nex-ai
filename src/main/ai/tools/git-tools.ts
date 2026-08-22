/**
 * Git tools — git_status, git_log, git_diff
 *
 * Uses safeExecFile('git', [...]) — no shell interpolation.
 */

import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { safeExecFile } from '../../security/shell';

class GitToolBase implements Tool {
  readonly definition!: ToolDefinition;
  async execute(_params: Record<string, any>, _context: ToolContext): Promise<ToolResult> {
    throw new Error('Not implemented — override in subclass');
  }
}

export class GitStatusTool extends GitToolBase {
  readonly definition: ToolDefinition = {
    name: 'git_status',
    description: 'Show the working tree status. Returns changed files with their status codes (M=modified, A=added, D=deleted, ??=untracked, etc.) and the current branch name.',
    category: 'git',
    permission: 'git',
    parameters: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: project root)',
      },
    ],
    returns: { type: 'object', description: '{ branch, files: [{ status, path }] }' },
    tags: ['git', 'status'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const cwd = params.cwd || context.projectPath || process.cwd();
    const statusResult = await safeExecFile('git', ['status', '--porcelain'], { cwd, timeout: 5000 });
    const branchResult = await safeExecFile('git', ['branch', '--show-current'], { cwd, timeout: 5000 });
    if (!statusResult.success) {
      return { success: false, error: statusResult.error || statusResult.stderr };
    }
    const files = statusResult.stdout.split('\n').filter(Boolean).map((line) => ({
      status: line.substring(0, 2).trim(),
      path: line.substring(3),
    }));
    const branch = branchResult.stdout.trim();
    return {
      success: true,
      output: `Branch: ${branch}\n${files.length} file(s) changed:\n${files.map((f) => `  ${f.status}  ${f.path}`).join('\n')}`,
      data: { branch, files, count: files.length },
    };
  }
}

export class GitLogTool extends GitToolBase {
  readonly definition: ToolDefinition = {
    name: 'git_log',
    description: 'Show recent commit history.',
    category: 'git',
    permission: 'git',
    parameters: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: project root)',
      },
      {
        name: 'count',
        type: 'number',
        description: 'Number of commits to show (default: 10, max: 100)',
        default: 10,
      },
    ],
    returns: { type: 'array', description: 'Array of { hash, message }' },
    tags: ['git', 'log'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const cwd = params.cwd || context.projectPath || process.cwd();
    const safeCount = Math.max(1, Math.min(100, Math.floor(params.count || 10)));
    const result = await safeExecFile('git', ['log', '--oneline', '-n', String(safeCount)], { cwd, timeout: 5000 });
    if (!result.success) return { success: false, error: result.error };
    const commits = result.stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [hash, ...rest] = line.split(' ');
      return { hash, message: rest.join(' ') };
    });
    return {
      success: true,
      output: commits.map((c) => `${c.hash} ${c.message}`).join('\n'),
      data: { commits, count: commits.length },
    };
  }
}

export class GitDiffTool extends GitToolBase {
  readonly definition: ToolDefinition = {
    name: 'git_diff',
    description: 'Show unstaged changes (git diff) or staged changes (git diff --cached).',
    category: 'git',
    permission: 'git',
    parameters: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: project root)',
      },
      {
        name: 'staged',
        type: 'boolean',
        description: 'If true, show staged changes (--cached). Default: false.',
        default: false,
      },
      {
        name: 'file',
        type: 'string',
        description: 'Optional: only show diff for a specific file',
      },
    ],
    returns: { type: 'string', description: 'The diff output (unified format)' },
    tags: ['git', 'diff'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const cwd = params.cwd || context.projectPath || process.cwd();
    const args = ['diff'];
    if (params.staged) args.push('--cached');
    if (params.file) args.push('--', params.file);
    const result = await safeExecFile('git', args, { cwd, timeout: 10000, maxBuffer: 5 * 1024 * 1024 });
    if (!result.success) return { success: false, error: result.error };
    const diff = result.stdout;
    if (!diff.trim()) {
      return {
        success: true,
        output: params.staged ? 'No staged changes.' : 'No unstaged changes.',
        data: { diff: '', empty: true },
      };
    }
    return {
      success: true,
      output: diff,
      data: { diff, lineCount: diff.split('\n').length },
    };
  }
}
