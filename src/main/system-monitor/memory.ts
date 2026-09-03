/**
 * NEX AI — Memory Sampler (Phase 12 / P12-A)
 *
 * os.totalmem/freemem — real OS values only.
 */

import * as os from 'os';
import type { MemoryInfo } from './types';

export function sampleMemory(): MemoryInfo {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  return {
    totalBytes,
    usedBytes,
    freeBytes,
    usagePercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
  };
}
