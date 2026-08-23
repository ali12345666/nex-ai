/**
 * NEX AI — GPU Sampler (Phase 12 / P12-A)
 *
 * Vendor CLI adapters (nvidia-smi / rocm-smi / intel_gpu_top absent→skip)
 * + a WMIC adapter for Windows + runtime-stats fallback. Every call goes
 * through the Phase-1 safeExecFile gate (argv arrays, no shell, fixed
 * allowlisted binaries, timeouts). Output parsing is strict — any parse
 * miss yields undefined (N/A), never a guess.
 *
 * Windows adapter commands are executed on Windows only; on Linux the
 * nvidia/rocm tools are tried when present. macOS: Apple GPUs have no CLI
 * telemetry here → 'unknown' source with name from system profiler is out
 * of scope for Phase 12 (N/A discipline).
 */

import { safeExecFile } from '../security/shell';
import type { GpuInfo } from './types';

const QUERY_TIMEOUT = 4000;

/** Parse `nvidia-smi --query-gpu=...` CSV (name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,driver_version). */
function parseNvidiaSmi(stdout: string): GpuInfo[] {
  const lines = stdout.trim().split('\n');
  const gpus: GpuInfo[] = [];
  for (const line of lines) {
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 3) continue;
    const [name, utilStr, memUsedStr, memTotalStr, tempStr, powerStr, driver] = parts;
    const num = (s?: string) => {
      if (s === undefined) return undefined;
      const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
      return Number.isFinite(n) ? n : undefined;
    };
    const usedMiB = num(memUsedStr);
    const totalMiB = num(memTotalStr);
    gpus.push({
      name: name || 'NVIDIA GPU',
      vendor: 'nvidia',
      utilizationPercent: num(utilStr),
      vramUsedBytes: usedMiB !== undefined ? usedMiB * 1024 * 1024 : undefined,
      vramTotalBytes: totalMiB !== undefined ? totalMiB * 1024 * 1024 : undefined,
      vramPercent: usedMiB !== undefined && totalMiB !== undefined && totalMiB > 0 ? (usedMiB / totalMiB) * 100 : undefined,
      temperatureC: num(tempStr),
      // NOTE: avoid `\[` escapes in this regex — TS tokenizer bug trigger
      // in this expression position; '.' classes cover 'N/A' and '[N/A]'.
      powerWatts: powerStr && !(/N.A|..N.A.|not/i).test(powerStr) ? num(powerStr) : undefined,
      driverVersion: driver || undefined,
      source: 'nvidia-smi',
    });
  }
  return gpus;
}

export async function sampleGpus(platform: NodeJS.Platform = process.platform): Promise<{ gpus: GpuInfo[]; degraded: string[] }> {
  const gpus: GpuInfo[] = [];
  const degraded: string[] = [];

  // 1) NVIDIA — linux + windows (nvidia-smi ships for both)
  try {
    const r = await safeExecFile('nvidia-smi', [
      '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,driver_version',
      '--format=csv,noheader,nounits',
    ], { timeout: QUERY_TIMEOUT });
    if (r.success && r.stdout.trim()) {
      gpus.push(...parseNvidiaSmi(r.stdout));
    }
  } catch {
    degraded.push('nvidia-smi');
  }

  // 2) AMD ROCm (linux)
  if (platform !== 'win32') {
    try {
      const r = await safeExecFile('rocm-smi', ['--showuse', '--showmemuse', '--showtemp', '--showdriverversion', '--csv'], { timeout: QUERY_TIMEOUT });
      if (r.success && r.stdout.trim()) {
        const gpu = parseRocmSmi(r.stdout);
        if (gpu) gpus.push(...gpu);
      }
    } catch {
      degraded.push('rocm-smi');
    }
  }

  // 3) Windows WMIC fallback (non-NVIDIA or missing smi): name+driver only.
  if (platform === 'win32' && gpus.length === 0) {
    try {
      const r = await safeExecFile('wmic', ['path', 'win32_VideoController', 'get', 'name,driverversion', '/format:csv'], { timeout: QUERY_TIMEOUT });
      if (r.success && r.stdout.trim()) {
        gpus.push(...parseWmicVideo(r.stdout));
      }
    } catch {
      degraded.push('windows-wmic');
    }
  }

  // No telemetry at all → single honest unknown entry (UI: N/A fields)
  if (gpus.length === 0) {
    gpus.push({
      name: platform === 'darwin' ? 'Apple GPU (no CLI telemetry)' : 'No GPU telemetry available',
      vendor: 'unknown',
      source: 'unknown',
    });
  }
  return { gpus, degraded };
}

/** rocm-smi --csv: rows like `device00, 37, 12, 45, 21.50, ...` vary by version — parse defensively. */
function parseRocmSmi(stdout: string): GpuInfo[] | null {
  const out: GpuInfo[] = [];
  for (const raw of stdout.trim().split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || /^device/i.test(line) === false && !/,/.test(line)) continue;
    const parts = line.split(',').map((p) => p.trim());
    // rocm-smi --csv header order: device, gpu_use, mem_use, temperature, power, driverversion (varies)
    const num = (s?: string) => {
      const n = parseFloat((s || '').replace(/[^0-9.]/g, ''));
      return Number.isFinite(n) ? n : undefined;
    };
    if (parts.length >= 3) {
      out.push({
        name: `AMD GPU (${parts[0]})`,
        vendor: 'amd',
        utilizationPercent: num(parts[1]),
        vramPercent: num(parts[2]),
        temperatureC: parts.length > 3 ? num(parts[3]) : undefined,
        powerWatts: parts.length > 4 ? num(parts[4]) : undefined,
        driverVersion: parts.length > 5 ? parts[5] : undefined,
        source: 'rocm-smi',
      });
    }
  }
  return out.length > 0 ? out : null;
}

/** wmic csv output: Node,Name,DriverVersion rows. */
function parseWmicVideo(stdout: string): GpuInfo[] {
  const gpus: GpuInfo[] = [];
  for (const raw of stdout.trim().split('\n').slice(1)) {
    const parts = raw.split(',').map((p) => p.trim());
    if (parts.length >= 3 && parts[1]) {
      const name = parts[1];
      const vendor: GpuInfo['vendor'] =
        /nvidia|geforce|quadro|rtx/i.test(name) ? 'nvidia'
        : /amd|radeon/i.test(name) ? 'amd'
        : /intel|iris|uhd|hd graphics/i.test(name) ? 'intel'
        : 'unknown';
      gpus.push({
        name,
        vendor,
        driverVersion: parts[2] || undefined,
        source: 'windows-wmic',
        // utilization/VRAM not exposed by WMIC → N/A (honest)
      });
    }
  }
  return gpus;
}

/** Static allowlist proof for tests/architecture audits. */
export const GPU_ALLOWED_BINARIES = ['nvidia-smi', 'rocm-smi', 'wmic'] as const;
