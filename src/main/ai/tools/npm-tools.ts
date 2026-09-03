/**
 * NPM tools — npm_build, npm_test
 *
 * Specialized wrappers around `npm run build` and `npm test` (or `npm run test`).
 * Uses safeExecFile.
 */

import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { safeExecFile } from '../../security/shell';

class NpmToolBase implements Tool {
  readonly definition!: ToolDefinition;
  async execute(_params: Record<string, any>, _context: ToolContext): Promise<ToolResult> {
    throw new Error('Not implemented');
  }
}

export class NpmBuildTool extends NpmToolBase {
  readonly definition: ToolDefinition = {
    name: 'npm_build',
    description: 'Run `npm run build` in the project directory. Captures output and exit code.',
    category: 'terminal',
    permission: 'execute',
    parameters: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: project root)',
      },
      {
        name: 'script',
        type: 'string',
        description: 'Custom npm script name (default: "build")',
        default: 'build',
      },
    ],
    returns: { type: 'object', description: '{ stdout, stderr, exitCode }' },
    tags: ['terminal', 'npm', 'build'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const cwd = params.cwd || context.projectPath || process.cwd();
    const script = params.script || 'build';
    try {
      const result = await safeExecFile('npm', ['run', script], { cwd, timeout: 300000, maxBuffer: 20 * 1024 * 1024 });
      return {
        success: result.success,
        output: result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : ''),
        data: { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode },
        error: result.success ? undefined : `npm run ${script} failed (exit ${result.exitCode})`,
      };
    } catch (err: any) {
      return { success: false, error: `npm run ${script} failed: ${err.message}`, output: err.message };
    }
  }
}

export class NpmTestTool extends NpmToolBase {
  readonly definition: ToolDefinition = {
    name: 'npm_test',
    description: 'Run `npm test` in the project directory. Captures output and exit code.',
    category: 'terminal',
    permission: 'execute',
    parameters: [
      {
        name: 'cwd',
        type: 'string',
        description: 'Working directory (default: project root)',
      },
    ],
    returns: { type: 'object', description: '{ stdout, stderr, exitCode }' },
    tags: ['terminal', 'npm', 'test'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const cwd = params.cwd || context.projectPath || process.cwd();
    try {
      const result = await safeExecFile('npm', ['test'], { cwd, timeout: 300000, maxBuffer: 20 * 1024 * 1024 });
      return {
        success: result.success,
        output: result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : ''),
        data: { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode },
        error: result.success ? undefined : `npm test failed (exit ${result.exitCode})`,
      };
    } catch (err: any) {
      return { success: false, error: `npm test failed: ${err.message}`, output: err.message };
    }
  }
}
