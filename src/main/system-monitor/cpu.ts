/**
 * NEX AI — CPU Sampler (Phase 12 / P12-A)
 *
 * Pure Node: os.cpus() deltas for usage/per-core; model/cores/threads from
 * os. Temperature/frequency ONLY when the OS genuinely exposes them —
 * otherwise undefined (UI shows N/A). Zero processes spawned, zero deps.
 */

import * as os from 'os';
import type { CpuInfo } from './types';

let lastSample: { idle: number; total: number; per: Array<{ idle: number; total: number }> } | null = null;

type CpuTimesLike = ReturnType<typeof os.cpus>[number]['times'];

function tick(c: CpuTimesLike): { idle: number; total: number } {
  const idle = c.idle;
  const total = idle + c.user + c.nice + c.sys + c.irq;
  return { idle, total };
}

/**
 * Sample CPU usage since the previous call (first call returns no usage —
 * deltas need two points; honest behavior).
 */
export function sampleCpu(): CpuInfo {
  const cpus = os.cpus();
  const per = cpus.map((c) => tick(c.times));
  const idle = per.reduce((a, p) => a + p.idle, 0);
  const total = per.reduce((a, p) => a + p.total, 0);

  let usagePercent: number | undefined;
  let perCore: number[] | undefined;
  if (lastSample) {
    const dIdle = idle - lastSample.idle;
    const dTotal = total - lastSample.total;
    if (dTotal > 0) {
      usagePercent = Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100));
      perCore = per.map((p, i) => {
        const prev = lastSample!.per[i];
        if (!prev) return 0;
        const dI = p.idle - prev.idle;
        const dT = p.total - prev.total;
        return dT > 0 ? Math.max(0, Math.min(100, (1 - dI / dT) * 100)) : 0;
      });
    }
  }
  lastSample = { idle, total, per };

  const threads = cpus.length || os.availableParallelism();
  return {
    model: cpus[0]?.model?.trim() || 'Unknown CPU',
    cores: Math.max(1, Math.floor(threads / 2)), // logical/2 ≈ physical when SMT; honest fallback
    threads,
    usagePercent,
    perCore,
    frequencyMHz: cpus[0]?.speed && cpus[0].speed > 0 ? cpus[0].speed : undefined,
    temperatureC: undefined, // not exposed by Node/os on any platform — N/A unless a GPU/OS adapter supplies it
  };
}

/** Reset delta baseline (used by tests / session restarts). */
export function resetCpuBaseline(): void {
  lastSample = null;
}
