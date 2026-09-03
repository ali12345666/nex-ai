/**
 * Git tools — git_status, git_log, git_diff, git_commit
 *
 * Uses safeExecFile('git', [...]) — no shell interpolation.
 */

import * as path from 'path';
import * as fs from 'fs';
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

export class GitCommitTool extends GitToolBase {
  readonly definition: ToolDefinition = {
    name: 'git_commit',
    description:
      'Stage all changes and create a git commit. ' +
      'Stages all modified files (git add -A), then commits with the provided message. ' +
      'Does NOT push to remote. The commit message should be descriptive and follow conventional commits format.',
    category: 'git',
    permission: 'git',
    destructive: false, // commits are reversible (git revert)
    parameters: [
      {
        name: 'message',
        type: 'string',
        description: 'The commit message. Should be descriptive (e.g. "fix: resolve null pointer in parser").',
        required: true,
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: project root)',
      },
      {
        name: 'add_all',
        type: 'boolean',
        description: 'If true (default), stage all changes before committing (git add -A). If false, only already-staged changes are committed.',
        default: true,
      },
    ],
    returns: { type: 'string', description: 'Commit hash and summary' },
    tags: ['git', 'commit', 'write'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const started = Date.now();
    const cwd = params.cwd || context.projectPath || process.cwd();
    const message = params.message;
    const addAll = params.add_all !== false; // default true

    // ── Parameter validation ──
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return { success: false, error: 'Missing or empty commit message' };
    }

    // Limit commit message length
    if (message.length > 500) {
      return { success: false, error: 'Commit message too long (max 500 characters)' };
    }

    // ── Verify we're in a git repository ──
    const repoCheck = await safeExecFile('git', ['rev-parse', '--is-inside-work-tree'], { cwd, timeout: 5000 });
    if (!repoCheck.success || repoCheck.stdout.trim() !== 'true') {
      return { success: false, error: 'Not inside a git repository. Initialize one with "git init" first.' };
    }

    try {
      // ── Stage changes if requested ──
      if (addAll) {
        const addResult = await safeExecFile('git', ['add', '-A'], { cwd, timeout: 10000 });
        if (!addResult.success) {
          return { success: false, error: `Failed to stage changes: ${addResult.error || addResult.stderr}` };
        }
      }

      // ── Check if there are changes to commit ──
      const statusResult = await safeExecFile('git', ['status', '--porcelain'], { cwd, timeout: 5000 });
      if (statusResult.success && statusResult.stdout.trim().length === 0) {
        return { success: false, error: 'No changes to commit (working tree is clean)' };
      }

      // ── Commit ──
      // Use -m with the message directly (safeExecFile uses arg array, no shell injection)
      const commitResult = await safeExecFile('git', ['commit', '-m', message], {
        cwd,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });

      if (!commitResult.success) {
        return {
          success: false,
          error: `Git commit failed: ${commitResult.error || commitResult.stderr}`,
          output: commitResult.stderr || commitResult.stdout,
        };
      }

      // ── Get the commit hash ──
      const hashResult = await safeExecFile('git', ['rev-parse', 'HEAD'], { cwd, timeout: 5000 });
      const commitHash = hashResult.success ? hashResult.stdout.trim().substring(0, 12) : 'unknown';

      return {
        success: true,
        output: `Committed: ${commitHash}\n${message}\n${commitResult.stdout.trim()}`,
        data: {
          hash: commitHash,
          message,
          output: commitResult.stdout,
        },
        durationMs: Date.now() - started,
      };
    } catch (err: any) {
      return { success: false, error: `Git commit failed: ${err.message}`, durationMs: Date.now() - started };
    }
  }
}
