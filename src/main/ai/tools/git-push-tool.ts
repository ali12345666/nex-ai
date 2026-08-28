/**
 * GitPushTool — git_push
 *
 * Pushes commits to a remote repository.
 * Security: rejects --force and --force-with-lease. Uses safeExecFile.
 * Permission: 'git'
 */

import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { safeExecFile } from '../../security/shell';

const FORBIDDEN_ARGS = ['--force', '--force-with-lease', '-f', '--delete', '--tags'];

export class GitPushTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'git_push',
    description:
      'Push local commits to the remote repository. ' +
      'Does NOT force push. Uses the default remote and branch unless specified. ' +
      'Requires that commits have already been created (git_commit).',
    category: 'git',
    permission: 'git',
    destructive: false,
    parameters: [
      {
        name: 'remote',
        type: 'string',
        description: 'Remote name to push to (default: "origin")',
        default: 'origin',
      },
      {
        name: 'branch',
        type: 'string',
        description: 'Branch to push (default: current branch)',
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: project root)',
      },
    ],
    returns: { type: 'string', description: 'Push result or error' },
    tags: ['git', 'push', 'remote'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const started = Date.now();
    const cwd = params.cwd || context.projectPath || process.cwd();
    const remote = params.remote || 'origin';
    const branch = params.branch;

    // Validate remote and branch arguments — reject forbidden patterns
    if (typeof remote !== 'string' || FORBIDDEN_ARGS.some(a => remote.includes(a))) {
      return { success: false, error: 'Invalid or forbidden remote argument' };
    }
    if (branch && (typeof branch !== 'string' || FORBIDDEN_ARGS.some(a => branch.includes(a)))) {
      return { success: false, error: 'Invalid or forbidden branch argument' };
    }

    try {
      // Verify we're in a git repository
      const repoCheck = await safeExecFile('git', ['rev-parse', '--is-inside-work-tree'], { cwd, timeout: 5000 });
      if (!repoCheck.success || repoCheck.stdout.trim() !== 'true') {
        return { success: false, error: 'Not inside a git repository' };
      }

      // Check if remote exists
      const remoteCheck = await safeExecFile('git', ['remote'], { cwd, timeout: 5000 });
      if (!remoteCheck.success || !remoteCheck.stdout.trim().split('\n').includes(remote)) {
        return { success: false, error: `Remote "${remote}" not found. Available: ${remoteCheck.stdout.trim() || 'none'}` };
      }

      // Get current branch if not specified
      let pushBranch = branch;
      if (!pushBranch) {
        const branchResult = await safeExecFile('git', ['branch', '--show-current'], { cwd, timeout: 5000 });
        pushBranch = branchResult.stdout.trim();
        if (!pushBranch) {
          return { success: false, error: 'Could not determine current branch' };
        }
      }

      // Push
      const pushArgs = ['push', remote, pushBranch];
      const pushResult = await safeExecFile('git', pushArgs, {
        cwd,
        timeout: 60000, // 60s — network operations can be slow
        maxBuffer: 2 * 1024 * 1024,
      });

      if (!pushResult.success) {
        const stderr = pushResult.stderr || '';
        let errorMsg = 'Git push failed';
        if (stderr.includes('Permission denied') || stderr.includes('authentication')) {
          errorMsg = 'Authentication failed. Check your git credentials.';
        } else if (stderr.includes('Could not resolve host') || stderr.includes('network')) {
          errorMsg = 'Network error. Check your internet connection.';
        } else if (stderr.includes('rejected') || stderr.includes('non-fast-forward')) {
          errorMsg = 'Push rejected (non-fast-forward). Pull first or rebase.';
        } else if (stderr.includes('timeout')) {
          errorMsg = 'Push timed out (60s)';
        } else {
          errorMsg = `Push failed: ${stderr.trim() || pushResult.error || 'unknown'}`;
        }
        return {
          success: false,
          error: errorMsg,
          output: stderr,
          durationMs: Date.now() - started,
        };
      }

      return {
        success: true,
        output: `Pushed ${pushBranch} to ${remote}\n${pushResult.stdout.trim() || pushResult.stderr.trim()}`,
        data: {
          remote,
          branch: pushBranch,
          output: pushResult.stdout,
        },
        durationMs: Date.now() - started,
      };
    } catch (err: any) {
      return { success: false, error: `Git push failed: ${err.message}`, durationMs: Date.now() - started };
    }
  }
}
