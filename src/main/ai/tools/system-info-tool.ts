/**
 * SystemInfoTool — system_info
 *
 * Returns system information (platform, CPU, memory, GPU).
 * Read-only — no destructive ops.
 */

import * as os from 'os';
import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

export class SystemInfoTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'system_info',
    description: 'Get system information: platform, architecture, CPU count, total/free memory, hostname. Useful for diagnosing performance issues.',
    category: 'system',
    permission: 'system',
    parameters: [],
    returns: { type: 'object', description: '{ platform, arch, cpus, totalMemory, freeMemory, hostname }' },
    tags: ['system', 'info'],
  };

  async execute(_params: Record<string, any>, _context: ToolContext): Promise<ToolResult> {
    const cpus = os.cpus();
    const info = {
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      hostname: os.hostname(),
      cpus: cpus.length,
      cpuModel: cpus[0]?.model || 'unknown',
      cpuSpeedGHz: cpus[0]?.speed || 0,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      uptime: os.uptime(),
      userInfo: {
        username: os.userInfo().username,
        homedir: os.userInfo().homedir,
      },
    };
    const memUsedPct = ((info.totalMemory - info.freeMemory) / info.totalMemory * 100).toFixed(1);
    return {
      success: true,
      output: `Platform: ${info.platform} ${info.arch}\nCPU: ${info.cpuModel} (${info.cpus} cores @ ${info.cpuSpeedGHz} GHz)\nMemory: ${(info.totalMemory/1024/1024/1024).toFixed(1)} GB total, ${memUsedPct}% used\nHostname: ${info.hostname}\nUptime: ${(info.uptime/3600).toFixed(1)} hours`,
      data: info,
    };
  }
}
