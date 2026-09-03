/**
 * LongRunningTestTool — for deterministic cancellation testing.
 *
 * Sleeps for N seconds, periodically checking the cancellation token.
 * Returns either:
 *  - success: completed normally (was not cancelled)
 *  - failure: cancelled mid-execution
 *
 * This tool is registered only during tests, not in production.
 */

import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

export class LongRunningTestTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'long_running_test_tool',
    description: 'A test tool that sleeps for a configurable duration. Used to verify cancellation works during tool execution. Pass "duration" in seconds (default 10).',
    category: 'system',
    permission: 'read',
    parameters: [
      {
        name: 'duration',
        type: 'number',
        description: 'Sleep duration in seconds (default 10, max 60)',
        default: 10,
      },
      {
        name: 'intervalMs',
        type: 'number',
        description: 'How often to check for cancellation in ms (default 100)',
        default: 100,
      },
    ],
    returns: { type: 'object', description: '{ completed, cancelled, elapsedMs }' },
    tags: ['test', 'long-running'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const duration = Math.max(1, Math.min(60, params.duration || 10));
    const intervalMs = Math.max(10, Math.min(1000, params.intervalMs || 100));
    const start = Date.now();
    const totalMs = duration * 1000;
    let cancelled = false;
    let ticks = 0;

    return new Promise((resolve) => {
      const interval = setInterval(() => {
        ticks++;
        // Check cancellation token via context
        const token = (context.metadata?.cancellationToken) as any;
        if (token && token.cancelled) {
          cancelled = true;
          clearInterval(interval);
          resolve({
            success: false,
            error: `Cancelled after ${Date.now() - start}ms (${ticks} ticks)`,
            data: {
              completed: false,
              cancelled: true,
              elapsedMs: Date.now() - start,
              ticks,
            },
          });
          return;
        }
        if (Date.now() - start >= totalMs) {
          clearInterval(interval);
          resolve({
            success: true,
            output: `Completed after ${(Date.now() - start) / 1000}s`,
            data: {
              completed: true,
              cancelled: false,
              elapsedMs: Date.now() - start,
              ticks,
            },
          });
        }
      }, intervalMs);
    });
  }
}
