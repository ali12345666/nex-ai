/**
 * RunCommandTool — run_command
 *
 * Runs a shell command in the project directory.
 * Uses safeSpawn with arg array (no shell interpolation).
 *
 * Permission: 'execute' (default) or 'admin' (for destructive commands).
 *
 * Allow-listed binaries only. The renderer cannot pass arbitrary shell strings.
 */

import * as path from 'path';
import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { safeExecFile } from '../../security/shell';

/**
 * Allow-list of binaries the agent can run without admin permission.
 * Anything not on this list requires 'admin' permission.
 */
const SAFE_BINARIES = new Set([
  'npm', 'npx', 'yarn', 'pnpm', 'node', 'tsc', 'eslint', 'prettier',
  'git', 'cargo', 'go', 'rustc', 'python', 'python3', 'pip', 'pip3',
  'gradle', 'mvn', 'make', 'cmake',
]);

const DESTRUCTIVE_BINARIES = new Set([
  'rm', 'rmdir', 'del', 'erase', 'format', 'fdisk', 'mkfs',
  'sudo', 'apt', 'apt-get', 'yum', 'dnf', 'pacman',
  'reg', 'regedit', 'sc', 'netsh', 'powershell', 'cmd',
]);

export class RunCommandTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'run_command',
    description: 'Run a shell command (allow-listed binaries only: npm, npx, yarn, pnpm, node, tsc, eslint, prettier, git, cargo, go, python, etc.). The command and args are passed as an array — no shell interpolation. Output is captured (stdout + stderr). Timeout: 60s.',
    category: 'terminal',
    permission: 'execute',
    parameters: [
      {
        name: 'binary',
        type: 'string',
        description: 'The binary to run (e.g. "npm", "git", "python")',
        required: true,
      },
      {
        name: 'args',
        type: 'array',
        description: 'Array of arguments (e.g. ["run", "build"])',
        items: { name: '', type: 'string', description: 'A single argument' },
        default: [],
      },
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: project root)',
      },
      {
        name: 'timeout',
        type: 'number',
        description: 'Timeout in ms (default: 60000, max: 300000)',
        default: 60000,
      },
    ],
    returns: { type: 'object', description: '{ stdout, stderr, exitCode }' },
    tags: ['terminal', 'execute'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const binary = params.binary;
    if (!binary) {
      return { success: false, error: 'Missing required parameter: binary' };
    }
    // Validate binary
    if (DESTRUCTIVE_BINARIES.has(binary.toLowerCase())) {
      return {
        success: false,
        error: `Binary "${binary}" is destructive and requires admin permission. Use the dedicated destructive tool instead.`,
      };
    }
    if (!SAFE_BINARIES.has(binary.toLowerCase())) {
      return {
        success: false,
        error: `Binary "${binary}" is not in the allow-list. Allow-listed: ${Array.from(SAFE_BINARIES).join(', ')}`,
      };
    }
    const args = Array.isArray(params.args) ? params.args.map(String) : [];
    const cwd = params.cwd || context.projectPath || process.cwd();
    const timeout = Math.min(300000, Math.max(1000, params.timeout || 60000));

    const result = await safeExecFile(binary, args, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 });
    return {
      success: result.success,
      output: result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : ''),
      data: {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      },
      error: result.success ? undefined : `Command failed (exit ${result.exitCode}): ${result.error || result.stderr}`,
    };
  }
}
