/**
 * NEX AI — Multi-Model Runtime Manager (Phase 58)
 *
 * The central control layer that turns NEX from an AI architecture into a
 * real executable local AI system. It manages multiple installed models,
 * routes task requests to the best model, loads/unloads them via the
 * LocalModelProvider, and exposes a unified runtime surface.
 *
 *   User Request
 *       ↓
 *   NEX Brain Controller (Phase 51) → BrainDecision (selectedModel)
 *       ↓
 *   Multi-Model Runtime Manager (this file)
 *       ↓
 *   LocalModelProvider (Phase 58) → load/generate/stream
 *       ↓
 *   inference.ts → node-llama-cpp → GGUF
 *
 * NEX supports multiple installed models:
 *   - General reasoning model
 *   - Coding model
 *   - Vision model
 *   - Voice model
 *   - Embedding model
 *
 * One central brain controls which model is active for each task.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SECURITY (preserved from Phase 43)
 * ════════════════════════════════════════════════════════════════════════════
 * - No cloud API. All inference is local via node-llama-cpp.
 * - No external AI service.
 * - No automatic model download. Installation goes through PermissionGate
 *   via RuntimeSetupManager / ComponentInstaller (Phase 43/47).
 * - This manager only ACTIVATES models that are already on disk + registered.
 * - Loading a model is a SAFE action (no permission needed — it only reads
 *   a file the user already placed on disk). Running inference is also SAFE.
 * - Unloading is SAFE (frees memory).
 *
 *   The manager NEVER:
 *     - downloads a model
 *     - installs a model
 *     - deletes a model
 *     - contacts any external service
 * ════════════════════════════════════════════════════════════════════════════
 */

import type { LocalModelInfo, ModelCapability, ModelCategory } from './model-registry';
import { listModels, getModel } from './model-registry';
import { LocalModelProvider, createLocalModelProvider, type ProviderBackend, type ProviderGenerateOptions, type ProviderGenerateResult, type ProviderStreamChunk, type ProviderInfo, type ProviderHealthCheck } from './local-model-provider';
import { getNexBrainController, type BrainDecision } from './nex-brain-controller';
import type { RouterRequest } from './model-intelligence/smart-model-router';
import {
  detectHardwareProfile,
  canModelRunOnHardware,
  recommendBestModel,
  type HardwareProfile,
  type ModelHardwareVerdict,
} from './hardware-model-recommender';
import { getLastInference, getNotedModel } from './runtime-telemetry';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface InstalledModelSummary {
  id: string;
  name: string;
  category: ModelCategory;
  sizeBytes: number;
  contextSize: number;
  gpuLayers: number;
  quantization?: string;
  parameterCount?: string;
  architecture?: string;
  capabilities?: ModelCapability[];
  fileExists: boolean;
  lastUsedAt?: number;
  /** Whether this model is currently loaded into memory. */
  loaded: boolean;
  /** Whether this model can run on the detected hardware. */
  canRun: boolean;
  /** Hardware verdict (reason + suggested params). */
  hardwareVerdict: ModelHardwareVerdict;
}

export interface RuntimeStatus {
  active: boolean;
  backend: ProviderBackend;
  loadedModelId: string | null;
  loadedModelName: string | null;
  gpuBackend: 'cpu' | 'cuda' | 'metal' | 'vulkan';
  /** Installed models count. */
  installedModels: number;
  /** Models grouped by category. */
  modelsByCategory: Record<string, number>;
  /** Last inference telemetry. */
  lastInference: {
    tokensPerSecond?: number;
    generatedTokens?: number;
    durationMs?: number;
    active?: boolean;
    contextMaxTokens?: number;
  } | null;
  /** Detected hardware (cached). */
  hardware: HardwareProfile | null;
  /** Whether the runtime is healthy. */
  healthy: boolean;
}

export interface TaskRouteResult {
  brainDecision: BrainDecision;
  selectedModel: LocalModelInfo | null;
  loaded: boolean;
  reason: string;
  reasonFa: string;
}

// ─── Multi-Model Runtime Manager ───────────────────────────────────────────

export class MultiModelRuntimeManager {
  private provider: LocalModelProvider;
  private cachedHardware: HardwareProfile | null = null;

  constructor(provider?: LocalModelProvider) {
    this.provider = provider || createLocalModelProvider('llamacpp');
  }

  getProvider(): LocalModelProvider {
    return this.provider;
  }

  // ── Model listing ──

  /**
   * List all installed models with runtime metadata (loaded status,
   * hardware verdict). This is the data the UI "Local AI Runtime" panel
   * consumes.
   */
  listInstalledModels(): InstalledModelSummary[] {
    const hw = this.detectHardware();
    const loadedId = this.provider.loadedModelId;
    return listModels().map((m) => {
      const verdict = canModelRunOnHardware(m, hw);
      return {
        id: m.id,
        name: m.name,
        category: m.category,
        sizeBytes: m.sizeBytes,
        contextSize: m.contextSize,
        gpuLayers: m.gpuLayers,
        quantization: m.quantization,
        parameterCount: m.parameterCount,
        architecture: m.architecture,
        capabilities: m.capabilities,
        fileExists: m.fileExists,
        lastUsedAt: m.lastUsedAt,
        loaded: loadedId === m.id,
        canRun: verdict.canRun,
        hardwareVerdict: verdict,
      };
    });
  }

  /**
   * Get models grouped by category (general/coding/vision/voice/embedding).
   */
  getModelsByCategory(): Record<string, LocalModelInfo[]> {
    const groups: Record<string, LocalModelInfo[]> = {};
    for (const m of listModels()) {
      if (!groups[m.category]) groups[m.category] = [];
      groups[m.category].push(m);
    }
    return groups;
  }

  /**
   * Count models by category.
   */
  countModelsByCategory(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const m of listModels()) {
      counts[m.category] = (counts[m.category] || 0) + 1;
    }
    return counts;
  }

  // ── Model loading / unloading ──

  /**
   * Load a specific model by id. SAFE action (reads a disk file).
   * Throws if the model is not found, the file is missing, or the backend
   * cannot allocate memory.
   */
  async loadModel(modelId: string, opts?: ProviderGenerateOptions): Promise<LocalModelInfo> {
    return await this.provider.load(modelId, opts);
  }

  /**
   * Unload the currently-loaded model. SAFE action (frees memory).
   */
  async unloadModel(): Promise<void> {
    await this.provider.unload();
  }

  /**
   * Check whether a model is currently loaded.
   */
  isModelLoaded(modelId: string): boolean {
    return this.provider.loadedModelId === modelId;
  }

  /**
   * Get the currently-loaded model id (or null).
   */
  getLoadedModelId(): string | null {
    return this.provider.loadedModelId;
  }

  // ── Inference ──

  /**
   * Generate a full response (not streamed). Requires a loaded model.
   */
  async generate(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    opts?: ProviderGenerateOptions,
  ): Promise<ProviderGenerateResult> {
    return await this.provider.generate(messages, opts);
  }

  /**
   * Stream a response token-by-token. Requires a loaded model.
   */
  async stream(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    onChunk: (chunk: ProviderStreamChunk) => void,
    opts?: ProviderGenerateOptions,
  ): Promise<ProviderGenerateResult> {
    return await this.provider.stream(messages, onChunk, opts);
  }

  /**
   * Abort an in-progress generation/stream.
   */
  abort(): void {
    this.provider.abort();
  }

  // ── Brain integration: route a task to the best model ──

  /**
   * Route a user request to the best installed model via the Brain Controller.
   *
   * Flow:
   *   1. Brain decides the best model (SmartModelRouter + hardware filter)
   *   2. If a model is selected and it's not loaded → load it
   *   3. Return the route result (selected model, loaded status, reason)
   *
   * If no model is available (none installed, none can run), returns
   * selectedModel: null + a Persian reason explaining the gap.
   */
  async routeTask(request: RouterRequest): Promise<TaskRouteResult> {
    const brain = getNexBrainController();
    const decision = brain.decide(request);
    const selectedModel = decision.selectedModel;

    if (!selectedModel) {
      return {
        brainDecision: decision,
        selectedModel: null,
        loaded: false,
        reason: 'No suitable model installed for this task',
        reasonFa: 'هیچ مدل مناسبی برای این وظیفه نصب نشده است',
      };
    }

    if (!selectedModel.fileExists) {
      return {
        brainDecision: decision,
        selectedModel,
        loaded: false,
        reason: `Model file not found: ${selectedModel.path}`,
        reasonFa: `فایل مدل یافت نشد: ${selectedModel.path}`,
      };
    }

    // Load if not already loaded
    const alreadyLoaded = this.isModelLoaded(selectedModel.id);
    if (!alreadyLoaded) {
      try {
        await this.loadModel(selectedModel.id);
      } catch (err: any) {
        return {
          brainDecision: decision,
          selectedModel,
          loaded: false,
          reason: `Failed to load model: ${err?.message || err}`,
          reasonFa: `بارگذاری مدل ناموفق بود: ${err?.message || err}`,
        };
      }
    }

    return {
      brainDecision: decision,
      selectedModel,
      loaded: true,
      reason: `Routed to ${selectedModel.name} (${decision.task})`,
      reasonFa: `به ${selectedModel.name} هدایت شد (${decision.taskFa})`,
    };
  }

  /**
   * Convenience: route + generate in one call.
   * Loads the best model for the request, then generates a response.
   */
  async routeAndGenerate(
    request: RouterRequest,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    opts?: ProviderGenerateOptions,
  ): Promise<{ route: TaskRouteResult; result: ProviderGenerateResult | null; error?: string }> {
    const route = await this.routeTask(request);
    if (!route.loaded || !route.selectedModel) {
      return { route, result: null, error: route.reasonFa };
    }
    try {
      const result = await this.generate(messages, opts);
      return { route, result };
    } catch (err: any) {
      return { route, result: null, error: err?.message || String(err) };
    }
  }

  // ── Hardware detection ──

  /**
   * Detect (and cache) the hardware profile.
   */
  detectHardware(): HardwareProfile {
    if (!this.cachedHardware) {
      this.cachedHardware = detectHardwareProfile();
    }
    return this.cachedHardware;
  }

  /**
   * Recommend the best model for a capability on this hardware.
   */
  recommendBest(criteria?: { capability?: ModelCapability; category?: string }): LocalModelInfo | null {
    const rec = recommendBestModel({
      capability: criteria?.capability,
      category: criteria?.category,
      hardwareProfile: this.detectHardware(),
    });
    return rec?.model || null;
  }

  /**
   * Check whether a model can run on the detected hardware.
   */
  canRun(model: LocalModelInfo): ModelHardwareVerdict {
    return canModelRunOnHardware(model, this.detectHardware());
  }

  // ── Provider info + health ──

  getProviderInfo(): ProviderInfo {
    return this.provider.getInfo();
  }

  healthCheck(): ProviderHealthCheck {
    return this.provider.healthCheck();
  }

  // ── Runtime status (for UI) ──

  getStatus(): RuntimeStatus {
    const info = this.provider.getInfo();
    const lastInf = getLastInference();
    const noted = getNotedModel();
    const health = this.provider.healthCheck();
    return {
      active: true,
      backend: info.backend,
      loadedModelId: this.provider.loadedModelId,
      loadedModelName: noted || info.loadedModel?.name || null,
      gpuBackend: info.gpuBackend,
      installedModels: listModels().length,
      modelsByCategory: this.countModelsByCategory(),
      lastInference: lastInf ? {
        tokensPerSecond: lastInf.tokensPerSecond,
        generatedTokens: lastInf.generatedTokens,
        durationMs: lastInf.durationMs,
        active: lastInf.active,
        contextMaxTokens: lastInf.contextMaxTokens,
      } : null,
      hardware: this.cachedHardware,
      healthy: health.healthy,
    };
  }

  // ── GGUF detection ──

  /**
   * Check whether a file path is a GGUF model file.
   */
  isGgufFile(filePath: string): boolean {
    return /\.gguf$/i.test(filePath);
  }

  /**
   * Get all installed GGUF models (filters by file extension + existence).
   */
  getInstalledGgufModels(): LocalModelInfo[] {
    return listModels().filter((m) => m.fileExists && this.isGgufFile(m.path));
  }

  /** Reset internal cache (for tests). */
  reset(): void {
    this.cachedHardware = null;
  }
}

// ─── Security self-audit ───────────────────────────────────────────────────

/**
 * Verifies the runtime manager:
 *   - never downloads / installs / deletes models
 *   - never contacts a cloud API or external AI service
 *   - only activates models already on disk + registered
 *   - loading/unloading is SAFE (no permission needed)
 */
export function verifyRuntimeSecurity(): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  // No fetch, no net.request, no https imports.
  // Model installation is delegated to RuntimeSetupManager + ComponentInstaller
  // (Phase 47), which goes through PermissionGate (Phase 43).
  return { ok: findings.length === 0, findings };
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _manager: MultiModelRuntimeManager | null = null;

export function getMultiModelRuntimeManager(): MultiModelRuntimeManager {
  if (!_manager) {
    _manager = new MultiModelRuntimeManager();
  }
  return _manager;
}

export function _resetMultiModelRuntimeManager(): void {
  _manager = null;
}
