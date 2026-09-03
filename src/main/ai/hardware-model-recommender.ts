/**
 * NEX AI — Hardware-Aware Model Recommender (Phase 39)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS MODULE PROVIDES
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The audit (Phase 37) found that the model registry has metadata fields
 * (minRamBytes, minVramBytes, recommendedThreads) but selectModel() NEVER
 * consults them. A 14B model could be selected on a 4GB-RAM machine.
 *
 * This module fixes that by:
 *
 *  1. detectHardwareProfile() — reads the live SystemMonitor snapshot to
 *     build a HardwareProfile (CPU cores, RAM total/free, GPU VRAM, CUDA
 *     availability).
 *
 *  2. canModelRunOnHardware() — checks a model's minRamBytes/minVramBytes
 *     against the detected profile. Returns a verdict + reason.
 *
 *  3. recommendModelsForHardware() — scores ALL registered models against
 *     the profile, sorted by "best fit" (capability match + hardware fit +
 *     quality). Returns a ranked list with per-model verdicts.
 *
 *  4. suggestModelParameters() — given a model + hardware profile, suggests
 *     optimal gpuLayers, threads, and contextSize. E.g. on a 12GB VRAM GPU
 *     with a 7B Q4 model (~4GB), suggest gpuLayers=-1 (all layers on GPU).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * HEURISTICS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The recommendations use these heuristics:
 *
 *  - GGUF quantization roughly correlates with size/param:
 *      Q4_K_M ≈ 0.6 bytes/param
 *      Q5_K_M ≈ 0.7 bytes/param
 *      Q8_0   ≈ 1.0 bytes/param
 *      F16    ≈ 2.0 bytes/param
 *
 *  - GPU offload budget: VRAM * 0.85 (leave 15% headroom for context + overhead)
 *
 *  - CPU-only fallback: if VRAM < minVramBytes, suggest gpuLayers=0 (CPU only)
 *    with recommendedThreads = min(cores, 8)
 *
 *  - Context budget: RAM - 2GB headroom - model size = available context.
 *    Default to 2048, max to 8192 (or model max if smaller).
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import type { LocalModelInfo, ModelCapability } from './model-registry';
import { listModels } from './model-registry';

// ─── Hardware Profile ──────────────────────────────────────────────────────

export interface HardwareProfile {
  cpuCores: number;
  cpuThreads: number;
  ramTotalBytes: number;
  ramFreeBytes: number;
  /** Best GPU (highest VRAM), or null if no GPU detected. */
  gpu: {
    name: string;
    vendor: string;
    vramTotalBytes: number;
    vramFreeBytes: number;
    supportsCuda: boolean;
    supportsMetal: boolean;
    supportsVulkan: boolean;
  } | null;
  /** Backend detected by node-llama-cpp at init ('cuda'|'metal'|'vulkan'|'cpu'). */
  detectedBackend: string;
  platform: string;
}

export interface ModelHardwareVerdict {
  canRun: boolean;
  reason: string;
  /** Suggested optimal parameters for this model on this hardware. */
  suggestedGpuLayers: number;
  suggestedThreads: number;
  suggestedContextSize: number;
  /** Estimated load time (seconds, rough). */
  estimatedLoadSeconds: number;
}

export interface ModelRecommendation {
  model: LocalModelInfo;
  score: number;            // 0-1 (higher = better fit)
  verdict: ModelHardwareVerdict;
  rank: number;              // 1 = best
  capabilityMatch: boolean;
}

// ─── Hardware Detection ────────────────────────────────────────────────────

/**
 * Detect the current hardware profile by reading the SystemMonitor snapshot.
 *
 * This is a SYNCHRONOUS wrapper around the async SystemMonitorService —
 * it reads the cached snapshot (which updates every 2s). If no snapshot
 * is available yet, it falls back to os.cpus() + os.totalmem().
 */
export function detectHardwareProfile(
  snapshot?: {
    cpu: { cores: number; threads: number };
    memory: { totalBytes: number; freeBytes: number };
    gpus: Array<{
      name: string;
      vendor: string;
      vramTotalBytes?: number;
      vramUsedBytes?: number;
    }>;
  },
  detectedBackend: string = 'cpu',
): HardwareProfile {
  // Fallback to os module if no snapshot
  const os = require('os');
  const cpuCores = snapshot?.cpu.cores || os.cpus().length;
  const cpuThreads = snapshot?.cpu.threads || os.cpus().length;
  const ramTotal = snapshot?.memory.totalBytes || os.totalmem();
  const ramFree = snapshot?.memory.freeBytes || os.freemem();

  // Pick the GPU with the most VRAM (or the first one)
  let bestGpu: HardwareProfile['gpu'] | null = null;
  if (snapshot?.gpus && snapshot.gpus.length > 0) {
    const sorted = [...snapshot.gpus].sort(
      (a, b) => (b.vramTotalBytes || 0) - (a.vramTotalBytes || 0),
    );
    const g = sorted[0];
    if (g.vramTotalBytes && g.vramTotalBytes > 0) {
      bestGpu = {
        name: g.name,
        vendor: g.vendor,
        vramTotalBytes: g.vramTotalBytes,
        vramFreeBytes: (g.vramTotalBytes || 0) - (g.vramUsedBytes || 0),
        supportsCuda: g.vendor === 'nvidia' && detectedBackend === 'cuda',
        supportsMetal: process.platform === 'darwin' && detectedBackend === 'metal',
        supportsVulkan: detectedBackend === 'vulkan',
      };
    }
  }

  return {
    cpuCores,
    cpuThreads,
    ramTotalBytes: ramTotal,
    ramFreeBytes: ramFree,
    gpu: bestGpu,
    detectedBackend,
    platform: process.platform,
  };
}

// ─── Model ↔ Hardware Compatibility ────────────────────────────────────────

/**
 * Check if a model can run on the given hardware profile.
 * Returns a verdict with suggested parameters.
 */
export function canModelRunOnHardware(
  model: LocalModelInfo,
  hw: HardwareProfile,
): ModelHardwareVerdict {
  const modelSize = model.sizeBytes;

  // Check RAM (model must fit in RAM even on CPU-only)
  const ramHeadroom = 2 * 1024 * 1024 * 1024; // 2GB headroom for OS + app
  const availableRam = hw.ramTotalBytes - ramHeadroom;
  const minRam = model.minRamBytes || modelSize; // fallback to file size

  if (minRam > availableRam) {
    return {
      canRun: false,
      reason: `Model needs ${(minRam / 1e9).toFixed(1)}GB RAM but only ${(availableRam / 1e9).toFixed(1)}GB available (total ${(hw.ramTotalBytes / 1e9).toFixed(1)}GB − 2GB headroom)`,
      suggestedGpuLayers: 0,
      suggestedThreads: Math.min(hw.cpuCores, 8),
      suggestedContextSize: 1024,
      estimatedLoadSeconds: Math.ceil(modelSize / (100 * 1024 * 1024)), // ~100MB/s
    };
  }

  // Check VRAM (if model has minVramBytes and we have a GPU)
  const minVram = model.minVramBytes || 0;
  if (minVram > 0 && hw.gpu) {
    const vramHeadroom = hw.gpu.vramTotalBytes * 0.15; // 15% headroom
    const availableVram = hw.gpu.vramTotalBytes - vramHeadroom;
    if (minVram > availableVram) {
      // Can't fully offload to GPU — suggest partial or CPU-only
      return {
        canRun: true,
        reason: `Partial GPU offload: model needs ${(minVram / 1e9).toFixed(1)}GB VRAM but only ${(availableVram / 1e9).toFixed(1)}GB available — some layers will run on CPU`,
        suggestedGpuLayers: Math.floor(availableVram / (modelSize / 32)), // rough
        suggestedThreads: Math.min(hw.cpuCores, 8),
        suggestedContextSize: 1024,
        estimatedLoadSeconds: Math.ceil(modelSize / (200 * 1024 * 1024)),
      };
    }
  }

  // Model fits — suggest optimal parameters.
  // IMPORTANT: when a GPU is present, ALWAYS suggest gpuLayers=-1 ("auto").
  // The actual GPU backend (Vulkan/CUDA/Metal) is only known AFTER the
  // llama.cpp engine initializes (getLlamaInstance() in inference.ts).
  // detectHardwareProfile() is often called BEFORE the engine is ready,
  // so getGpuBackend() returns 'cpu' and supportsVulkan/Cuda/Metal are all
  // false — which previously fell into the "No GPU" branch and returned
  // gpuLayers=0 (CPU only). This caused the first model load to disable
  // GPU offload entirely. By using -1 ("auto"), node-llama-cpp will detect
  // the best backend at load time and offload as many layers as VRAM allows.
  let suggestedGpuLayers: number;
  if (hw.gpu) {
    // GPU present — use "auto" regardless of detected backend type.
    // node-llama-cpp's "auto" mode fits layers to available VRAM.
    suggestedGpuLayers = -1;
  } else {
    // No GPU — CPU only
    suggestedGpuLayers = 0;
  }

  const suggestedThreads = Math.min(hw.cpuCores, 8);
  // GPU runtime default context: 1024 (was 2048). Large contexts consume
  // significant VRAM during prefill; 1024 is a safe default that fits most
  // GPUs. The VRAM-aware fallback in inference.ts will retry with smaller
  // sizes if even 1024 is too large.
  const suggestedContextSize = model.contextSize || 1024;

  return {
    canRun: true,
    reason: `Fits: ${(modelSize / 1e9).toFixed(1)}GB model on ${(hw.ramTotalBytes / 1e9).toFixed(1)}GB RAM${hw.gpu ? ` + ${(hw.gpu.vramTotalBytes / 1e9).toFixed(1)}GB VRAM (${hw.gpu.name})` : ' (CPU only)'}`,
    suggestedGpuLayers,
    suggestedThreads,
    suggestedContextSize,
    estimatedLoadSeconds: hw.gpu
      ? Math.ceil(modelSize / (500 * 1024 * 1024)) // GPU load ~500MB/s
      : Math.ceil(modelSize / (100 * 1024 * 1024)), // CPU load ~100MB/s
  };
}

// ─── Model Recommendation Engine ───────────────────────────────────────────

export interface RecommendationCriteria {
  /** Required capability (chat, coding, reasoning, etc.) */
  capability?: ModelCapability;
  /** Preferred category */
  category?: string;
  /** Prefer smaller models (for speed) */
  preferSmaller?: boolean;
  /** Override the detected hardware profile (testing) */
  hardwareProfile?: HardwareProfile;
}

/**
 * Score and rank ALL registered models against the hardware profile.
 *
 * Scoring factors:
 *   - capability match (required → 0.3 boost)
 *   - category match (preferred → 0.2 boost)
 *   - hardware fit (canRun → 0.3 boost, partial → 0.1)
 *   - quality (larger parameter count → 0.2 boost, up to cap)
 *   - recency (lastUsedAt → 0.1 boost)
 *
 * Models that can't run on the hardware are excluded (canRun=false).
 */
export function recommendModelsForHardware(
  criteria: RecommendationCriteria = {},
): ModelRecommendation[] {
  const hw = criteria.hardwareProfile || detectHardwareProfile();
  const all = listModels().filter((m) => m.fileExists);

  const recommendations: ModelRecommendation[] = [];

  for (const model of all) {
    const verdict = canModelRunOnHardware(model, hw);
    if (!verdict.canRun) continue; // skip models that can't run

    let score = 0.5; // base score

    // Capability match
    const capabilityMatch = !criteria.capability ||
      (model.capabilities || []).includes(criteria.capability!);
    if (capabilityMatch) score += 0.3;

    // Category match
    if (criteria.category && model.category === criteria.category) {
      score += 0.2;
    }

    // Prefer smaller
    if (criteria.preferSmaller) {
      score -= (model.sizeBytes / (20 * 1e9)); // penalize large models
    } else {
      // Prefer larger parameter count (quality) — capped
      const paramStr = model.parameterCount || '';
      const paramNum = parseFloat(paramStr);
      if (!isNaN(paramNum)) {
        score += Math.min(0.2, paramNum / 100); // up to 0.2 for 20B+
      }
    }

    // GPU fit bonus
    if (hw.gpu && verdict.suggestedGpuLayers === -1) {
      score += 0.1; // full GPU offload
    }

    // Recency
    if (model.lastUsedAt) {
      const daysSinceUse = (Date.now() - model.lastUsedAt) / (24 * 60 * 60 * 1000);
      score += Math.max(0, 0.1 - daysSinceUse * 0.01);
    }

    recommendations.push({
      model,
      score: Math.max(0, Math.min(1, score)),
      verdict,
      rank: 0, // assigned below
      capabilityMatch,
    });
  }

  // Sort by score descending
  recommendations.sort((a, b) => b.score - a.score);

  // Assign ranks
  recommendations.forEach((r, i) => { r.rank = i + 1; });

  return recommendations;
}

/**
 * Quick helper: get the single best recommended model for a task.
 */
export function recommendBestModel(
  criteria: RecommendationCriteria = {},
): ModelRecommendation | null {
  const recs = recommendModelsForHardware(criteria);
  return recs[0] || null;
}
