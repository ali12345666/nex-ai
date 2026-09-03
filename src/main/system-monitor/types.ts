/**
 * NEX AI — System Monitor Types (Phase 12 / P12-A)
 *
 * Hardware/system telemetry contract. Consumers: the SystemMonitorService
 * (main), IPC snapshot (preload/renderer), HardwareMonitor UI.
 *
 * Honesty contract (critical): every metric is either a REAL measured
 * value or `undefined` — the UI renders `N/A` for missing values. No
 * fabricated numbers, no "estimated" values presented as real.
 *
 * Pure types — no imports.
 */

// ─── CPU ────────────────────────────────────────────────────────────────────

export interface CpuInfo {
  model: string;
  cores: number;            // physical cores
  threads: number;          // logical processors
  /** measured since last sample (0-100) */
  usagePercent?: number;
  /** per-core usage (0-100), length = threads, when available */
  perCore?: number[];
  frequencyMHz?: number;
  temperatureC?: number;
}

// ─── Memory ─────────────────────────────────────────────────────────────────

export interface MemoryInfo {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usagePercent: number;     // derived from measured values — always present
}

// ─── GPU ────────────────────────────────────────────────────────────────────

export interface GpuInfo {
  name: string;
  vendor: 'nvidia' | 'amd' | 'intel' | 'apple' | 'unknown';
  utilizationPercent?: number;
  vramTotalBytes?: number;
  vramUsedBytes?: number;
  vramPercent?: number;
  temperatureC?: number;
  powerWatts?: number;
  driverVersion?: string;
  /** which backend produced this info */
  source: 'nvidia-smi' | 'rocm-smi' | 'intel-gpu-tools' | 'windows-wmic' | 'runtime-stats' | 'unknown';
}

// ─── AI Runtime ─────────────────────────────────────────────────────────────

export interface AiRuntimeInfo {
  /** which runtime is active for the CURRENT session default */
  backend: 'local' | 'online' | 'none';
  runtimeType: string;           // 'llamacpp' | 'online' | 'none'
  activeModelName?: string;
  modelLoaded: boolean;
  inferenceActive: boolean;
  /** last completed/ongoing inference telemetry (best-effort) */
  lastTokensPerSecond?: number;
  lastPromptTokens?: number;
  lastGeneratedTokens?: number;
  lastInferenceDurationMs?: number;
  lastModelLoadMs?: number;
  /** context utilization of the ACTIVE agent task if any */
  contextUsedTokens?: number;
  contextMaxTokens?: number;
  gpuBackend?: 'cuda' | 'vulkan' | 'metal' | 'cpu' | 'none' | string;
}

// ─── Agent ──────────────────────────────────────────────────────────────────

export type AgentQueueState = 'idle' | 'running' | 'waiting-permission' | 'queued' | 'unknown';

export interface AgentInfo {
  currentTask?: string;
  currentStep?: string;
  stepProgress?: { current: number; total: number };
  activeTool?: string;
  toolDurationMs?: number;
  queueState: AgentQueueState;
  cancelled: boolean;
}

// ─── Snapshot ───────────────────────────────────────────────────────────────

export interface SystemSnapshot {
  timestamp: number;
  platform: NodeJS.Platform;
  cpu: CpuInfo;
  memory: MemoryInfo;
  gpus: GpuInfo[];
  aiRuntime: AiRuntimeInfo;
  agent: AgentInfo;
  /** sampler health: sources that failed (diagnostics for N/A display) */
  degradedSources: string[];
}

/** Sampling cadence guidance per subsystem (renderer picks one interval). */
export const RECOMMENDED_INTERVALS_MS = {
  cpu: 1500,
  memory: 2000,
  gpu: 2000,
  aiRuntime: 1000,
  agent: 800,
  /** one-shot/very-slow values */
  staticInfo: 60000,
} as const;
