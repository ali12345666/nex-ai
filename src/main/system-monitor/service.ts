/**
 * NEX AI — System Monitor Service (Phase 12 / P12-A/B)
 *
 * Aggregates the pure samplers (cpu/memory/gpu) + AI-runtime stats (from
 * the AIRuntime registry — the SAME abstraction the agent uses) + agent
 * task state (via injected read-only accessor, keeping agent decoupled).
 *
 * Throttle-by-design: `snapshot()` caches per-subsystem by its recommended
 * interval — a renderer polling at 500ms costs almost nothing (cached
 * values return instantly; real sampling happens at 1.5-2s cadence; GPU
 * CLI calls at most every 2s).
 *
 * No shell beyond the allowlisted GPU binaries through Phase-1 safeExecFile.
 */

import * as os from 'os';
import { sampleCpu, resetCpuBaseline } from './cpu';
import { sampleMemory } from './memory';
import { sampleGpus } from './gpu';
import type { SystemSnapshot, AiRuntimeInfo, AgentInfo } from './types';
import { RECOMMENDED_INTERVALS_MS } from './types';

/** Read-only runtime stats accessor (duck-typed from AIRuntime.getStats). */
export interface RuntimeStatsSource {
  (): {
    defaultRuntimeType: string;
    stats: Array<{
      instanceId: string;
      type: string;
      loaded: boolean;
      loadedModelName: string | null;
      gpuBackend?: string;
    }>;
    lastInference?: {
      tokensPerSecond?: number;
      promptTokens?: number;
      generatedTokens?: number;
      durationMs?: number;
      modelLoadMs?: number;
      active?: boolean;
    };
  };
}

/** Read-only agent state accessor (duck-typed from agent/core getters). */
export interface AgentStateSource {
  (): {
    currentTask?: string;
    currentStep?: string;
    stepProgress?: { current: number; total: number };
    activeTool?: string;
    toolDurationMs?: number;
    queueState: AgentInfo['queueState'];
    cancelled: boolean;
    inferenceActive?: boolean;
    contextUsedTokens?: number;
    contextMaxTokens?: number;
    backend?: 'local' | 'online' | 'none';
  };
}

export interface SystemMonitorOptions {
  runtimeStats?: RuntimeStatsSource;
  agentState?: AgentStateSource;
  /** override intervals (tests) */
  intervals?: Partial<typeof RECOMMENDED_INTERVALS_MS>;
  platform?: NodeJS.Platform;
}

export class SystemMonitorService {
  private opts: SystemMonitorOptions;
  private cpuCache?: { at: number; cpu: ReturnType<typeof sampleCpu> };
  private memCache?: { at: number; mem: ReturnType<typeof sampleMemory> };
  private gpuCache?: { at: number; gpus: Awaited<ReturnType<typeof sampleGpus>> };
  private rtCache?: { at: number; info: AiRuntimeInfo; degraded: string[] };
  private agentCache?: { at: number; info: AgentInfo };
  private degraded = new Set<string>();

  constructor(opts: SystemMonitorOptions = {}) {
    this.opts = opts;
  }

  /** Full snapshot (per-subsystem cached at its own cadence). */
  async snapshot(force = false): Promise<SystemSnapshot> {
    const iv = { ...RECOMMENDED_INTERVALS_MS, ...(this.opts.intervals || {}) };
    const now = Date.now();
    const degraded: string[] = [];

    // CPU
    if (force || !this.cpuCache || now - this.cpuCache.at >= iv.cpu) {
      this.cpuCache = { at: now, cpu: sampleCpu() };
    }
    // Memory
    if (force || !this.memCache || now - this.memCache.at >= iv.memory) {
      this.memCache = { at: now, mem: sampleMemory() };
    }
    // GPU (async, allowlisted CLIs)
    if (force || !this.gpuCache || now - this.gpuCache.at >= iv.gpu) {
      try {
        this.gpuCache = { at: now, gpus: await sampleGpus(this.opts.platform) };
      } catch {
        this.gpuCache = { at: now, gpus: { gpus: [{ name: 'No GPU telemetry available', vendor: 'unknown', source: 'unknown' }], degraded: ['gpu-sampler'] } };
      }
    }
    if (this.gpuCache.gpus.degraded.length > 0) degraded.push(...this.gpuCache.gpus.degraded);
    degraded.push(...this.degraded);

    // AI runtime + agent at their own cadences (fast polls = zero source cost)
    if (force || !this.rtCache || now - this.rtCache.at >= iv.aiRuntime) {
      const rtDegraded: string[] = [];
      const info = this.aiRuntimeInfo(rtDegraded);
      this.rtCache = { at: now, info, degraded: rtDegraded };
      degraded.push(...rtDegraded);
    }
    if (force || !this.agentCache || now - this.agentCache.at >= iv.agent) {
      this.agentCache = { at: now, info: this.agentInfo() };
    }

    const aiRuntime = this.rtCache.info;
    const agent = this.agentCache.info;

    return {
      timestamp: now,
      platform: this.opts.platform ?? process.platform,
      cpu: this.cpuCache.cpu,
      memory: this.memCache.mem,
      gpus: this.gpuCache.gpus.gpus,
      aiRuntime,
      agent,
      degradedSources: [...new Set(degraded)],
    };
  }

  private aiRuntimeInfo(degraded: string[]): AiRuntimeInfo {
    const src = this.opts.runtimeStats;
    if (!src) {
      degraded.push('runtime-stats');
      return { backend: 'none', runtimeType: 'none', modelLoaded: false, inferenceActive: false };
    }
    try {
      const data = src();
      const primary = data.stats.find((s) => s.loaded) || data.stats[0];
      return {
        backend: primary?.type === 'online' ? 'online' : primary?.loaded ? 'local' : 'none',
        runtimeType: primary?.type || data.defaultRuntimeType || 'none',
        activeModelName: primary?.loadedModelName || undefined,
        modelLoaded: !!primary?.loaded,
        inferenceActive: !!data.lastInference?.active,
        lastTokensPerSecond: data.lastInference?.tokensPerSecond,
        lastPromptTokens: data.lastInference?.promptTokens,
        lastGeneratedTokens: data.lastInference?.generatedTokens,
        lastInferenceDurationMs: data.lastInference?.durationMs,
        lastModelLoadMs: data.lastInference?.modelLoadMs,
        gpuBackend: primary?.gpuBackend,
      };
    } catch {
      degraded.push('runtime-stats');
      return { backend: 'none', runtimeType: 'none', modelLoaded: false, inferenceActive: false };
    }
  }

  private agentInfo(): AgentInfo {
    const src = this.opts.agentState;
    if (!src) {
      return { queueState: 'unknown', cancelled: false };
    }
    try {
      const d = src();
      this.lastAgent = {
        currentTask: d.currentTask,
        currentStep: d.currentStep,
        stepProgress: d.stepProgress,
        activeTool: d.activeTool,
        toolDurationMs: d.toolDurationMs,
        queueState: d.queueState,
        cancelled: d.cancelled,
      };
      // inference/context fields ride along on runtime when agent is mid-task
      this.lastAgentRuntime = {
        inferenceActive: d.inferenceActive,
        contextUsedTokens: d.contextUsedTokens,
        contextMaxTokens: d.contextMaxTokens,
        backend: d.backend,
      };
      return this.lastAgent;
    } catch {
      return this.lastAgent || { queueState: 'unknown', cancelled: false };
    }
  }

  private lastAgent: AgentInfo = { queueState: 'unknown', cancelled: false };
  private lastAgentRuntime: { inferenceActive?: boolean; contextUsedTokens?: number; contextMaxTokens?: number; backend?: 'local' | 'online' | 'none' } = {};

  /** Exposed so the wiring layer can enrich aiRuntime with agent context. */
  get lastAgentRuntimeExtras() { return this.lastAgentRuntime; }

  /** Test/ops helper. */
  resetBaselines(): void {
    resetCpuBaseline();
    this.cpuCache = undefined;
    this.memCache = undefined;
    this.gpuCache = undefined;
    this.rtCache = undefined;
    this.agentCache = undefined;
  }
}
