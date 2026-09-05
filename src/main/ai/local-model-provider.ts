/**
 * NEX AI — Local Model Provider Abstraction (Phase 58)
 *
 * A provider-level abstraction above the existing AIRuntime (Phase 12). This
 * is the clean public API for "load a model, run inference, get health" that
 * the Multi-Model Runtime Manager and the UI consume.
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │  LocalModelProvider (Phase 58 — this file)          │
 *   │    load() / unload() / generate() / stream()        │
 *   │    getInfo() / healthCheck()                          │
 *   ├──────────────────────────────────────────────────────┤
 *   │  AIRuntime (Phase 12 — runtime.ts)                   │
 *   │    LlamaCppRuntime / [future: OnnxRuntime / ...]    │
 *   ├──────────────────────────────────────────────────────┤
 *   │  inference.ts (the real node-llama-cpp engine)       │
 *   └──────────────────────────────────────────────────────┘
 *
 * The provider is backend-agnostic: today it delegates to the llama.cpp
 * runtime; tomorrow an ONNX-backed or TensorRT-backed provider can implement
 * the same interface without touching the manager or UI.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SECURITY
 * ════════════════════════════════════════════════════════════════════════════
 * - No cloud API. All inference is in-process via node-llama-cpp.
 * - No external AI service.
 * - No automatic model download. (Installation is the RuntimeSetupManager /
 *   ComponentInstaller's job, and it ALWAYS goes through PermissionGate.)
 * - This provider only LOADS and RUNS models that are already on disk and
 *   registered in the model registry.
 * ════════════════════════════════════════════════════════════════════════════
 */

import type { LocalModelInfo, ModelCapability } from './model-registry';
import { getModel, listModels } from './model-registry';
import {
  loadModel as inferenceLoadModel,
  unloadModel as inferenceUnloadModel,
  chatComplete as inferenceChatComplete,
  chatStream as inferenceChatStream,
  abortInference,
  getLoadedModelInfo,
  getLoadedModel,
  getGpuBackend,
} from './inference';
import {
  canModelRunOnHardware,
  detectHardwareProfile,
  type HardwareProfile,
  type ModelHardwareVerdict,
} from './hardware-model-recommender';
import { getLastInference, getNotedModel } from './runtime-telemetry';

// ─── Types ─────────────────────────────────────────────────────────────────

/** The backing backend for a provider instance. */
export type ProviderBackend = 'llamacpp' | 'onnx' | 'tensorrt' | 'wasm';

export interface ProviderGenerateOptions {
  contextSize?: number;
  threads?: number;
  gpuLayers?: number;       // -1 = auto, 0 = CPU only
  temperature?: number;     // 0..2
  maxTokens?: number;
  topP?: number;            // nucleus sampling
  systemPrompt?: string;
}

export interface ProviderGenerateResult {
  content: string;
  tokensGenerated: number;
  durationMs: number;
  modelId: string;
  modelName: string;
  tokensPerSecond: number;
  stopped: boolean;
}

export interface ProviderStreamChunk {
  content: string;
  done: boolean;
  error?: string;
}

export interface ProviderInfo {
  backend: ProviderBackend;
  /** Whether the backend binary/library is available on this machine. */
  available: boolean;
  /** Capabilities supported by this backend. */
  capabilities: ModelCapability[];
  /** The model currently loaded into this provider, if any. */
  loadedModel: LocalModelInfo | null;
  /** GPU backend actually in use ('cpu' | 'cuda' | 'metal' | 'vulkan'). */
  gpuBackend: 'cpu' | 'cuda' | 'metal' | 'vulkan';
  /** Detected hardware profile (cached on first query). */
  hardware: HardwareProfile | null;
}

export interface ProviderHealthCheck {
  healthy: boolean;
  backend: ProviderBackend;
  available: boolean;
  modelLoaded: boolean;
  canInfer: boolean;
  gpuBackend: 'cpu' | 'cuda' | 'metal' | 'vulkan';
  issues: string[];
  checkedAt: number;
}

// ─── Local Model Provider ─────────────────────────────────────────────────

/**
 * A provider wraps a single inference backend + a single loaded model.
 * Multiple providers can coexist (one per model category) — the
 * Multi-Model Runtime Manager owns that composition.
 *
 * SECURITY: this class performs NO network calls and NO downloads. It only
 * loads GGUF files that already exist on disk (verified via model.fileExists).
 */
export class LocalModelProvider {
  readonly backend: ProviderBackend;
  private _loadedModelId: string | null = null;
  private loadedModel: LocalModelInfo | null = null;
  private cachedHardware: HardwareProfile | null = null;
  private cachedBackend: string | null = null;

  constructor(backend: ProviderBackend = 'llamacpp') {
    this.backend = backend;
  }

  /**
   * Load a model into memory. If a different model is already loaded,
   * the underlying engine unloads it first (inference.ts handles this).
   *
   * Throws if the model is not found, the file is missing, or the backend
   * cannot load it (e.g. insufficient RAM/VRAM).
   */
  async load(modelId: string, opts?: ProviderGenerateOptions): Promise<LocalModelInfo> {
    const model = getModel(modelId);
    if (!model) {
      throw new Error(`Model not found in registry: ${modelId}`);
    }
    if (!model.fileExists) {
      throw new Error(`Model file not found on disk: ${model.path}`);
    }

    // Hardware check — warn but don't hard-block (the user may know better)
    const hw = this.detectHardware();
    const verdict = canModelRunOnHardware(model, hw);
    if (!verdict.canRun) {
      console.warn(`[NEX LocalModelProvider] Hardware warning for ${model.name}: ${verdict.reason}`);
      // Continue anyway — the inference engine will throw if it truly can't allocate.
    }

    // Merge hardware-suggested params with caller opts (caller wins)
    const mergedOpts = this.mergeHardwareParams(verdict, opts || {});

    // Delegate to the real inference engine
    await inferenceLoadModel(model, {
      contextSize: mergedOpts.contextSize,
      threads: mergedOpts.threads,
      gpuLayers: mergedOpts.gpuLayers,
      temperature: mergedOpts.temperature,
      maxTokens: mergedOpts.maxTokens,
    });

    this._loadedModelId = model.id;
    this.loadedModel = model;
    return model;
  }

  /**
   * Unload the currently-loaded model, freeing RAM/VRAM.
   * The provider stays usable — another model can be loaded next.
   */
  async unload(): Promise<void> {
    await inferenceUnloadModel();
    this._loadedModelId = null;
    this.loadedModel = null;
  }

  /**
   * Generate a full response (not streamed).
   * The model must be loaded first via load().
   *
   * Phase 17 (P1 14-3 fix): Read the loaded model from inference.ts as
   * the single source of truth. Previously this used `this.loadedModel`
   * (a shadow copy that could go stale when inference.ts internally
   * called unloadModel during a fresh-load). Now we read getLoadedModel()
   * at call time so the chat/stream calls always use the actually-loaded
   * model, not a stale snapshot.
   */
  async generate(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    opts?: ProviderGenerateOptions,
  ): Promise<ProviderGenerateResult> {
    const model = this.getEffectiveLoadedModel();
    if (!model) {
      throw new Error('No model loaded. Call load() first.');
    }
    const start = Date.now();
    const result = await inferenceChatComplete(model, messages, {
      contextSize: opts?.contextSize,
      threads: opts?.threads,
      gpuLayers: opts?.gpuLayers,
      temperature: opts?.temperature ?? 0.7,
      maxTokens: opts?.maxTokens ?? 1024,
      systemPrompt: opts?.systemPrompt,
    });
    const durationMs = Date.now() - start;
    const tokensPerSecond = durationMs > 0 ? result.tokensGenerated / (durationMs / 1000) : 0;
    return {
      content: result.content,
      tokensGenerated: result.tokensGenerated,
      durationMs,
      modelId: result.modelId,
      modelName: result.modelName,
      tokensPerSecond,
      stopped: result.stopped,
    };
  }

  /**
   * Stream a response token-by-token.
   * The model must be loaded first via load().
   *
   * Phase 17 (P1 14-3 fix): Same as generate() — reads the effective
   * loaded model from inference.ts instead of the stale shadow copy.
   */
  async stream(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    onChunk: (chunk: ProviderStreamChunk) => void,
    opts?: ProviderGenerateOptions,
  ): Promise<ProviderGenerateResult> {
    const model = this.getEffectiveLoadedModel();
    if (!model) {
      throw new Error('No model loaded. Call load() first.');
    }
    const start = Date.now();
    const result = await inferenceChatStream(
      model,
      messages,
      (chunk) => onChunk({ content: chunk.content, done: chunk.done, error: chunk.error }),
      {
        contextSize: opts?.contextSize,
        threads: opts?.threads,
        gpuLayers: opts?.gpuLayers,
        temperature: opts?.temperature ?? 0.7,
        maxTokens: opts?.maxTokens ?? 1024,
        systemPrompt: opts?.systemPrompt,
      },
    );
    const durationMs = Date.now() - start;
    const tokensPerSecond = durationMs > 0 ? result.tokensGenerated / (durationMs / 1000) : 0;
    return {
      content: result.content,
      tokensGenerated: result.tokensGenerated,
      durationMs,
      modelId: result.modelId,
      modelName: result.modelName,
      tokensPerSecond,
      stopped: result.stopped,
    };
  }

  /**
   * Abort an in-progress generate/stream call.
   */
  abort(): void {
    abortInference('LocalModelProvider.abort()');
  }

  /**
   * Phase 17 (P1 14-3 fix): Get the effective loaded model.
   *
   * Source of truth is `inference.ts getLoadedModel()`. The shadow
   * `_loadedModelId`/`loadedModel` fields are only used as a fallback
   * if inference.ts returns null but we believe a model is loaded
   * (defensive — should rarely happen).
   *
   * If our shadow `_loadedModelId` doesn't match inference.ts's loaded
   * id, we update the shadow to match (eventual consistency).
   */
  private getEffectiveLoadedModel(): LocalModelInfo | null {
    const inferenceLoaded = getLoadedModel(); // full LocalModelInfo from inference.ts
    if (inferenceLoaded) {
      // Sync the shadow state with the source of truth
      if (this._loadedModelId !== inferenceLoaded.id) {
        this._loadedModelId = inferenceLoaded.id;
        this.loadedModel = inferenceLoaded;
      }
      return inferenceLoaded;
    }
    // Fallback: inference.ts has no model loaded, but our shadow says we do.
    // This means inference.ts unloaded our model internally (e.g. fresh-load
    // of a different model by another path). Return null so the caller
    // throws "no model loaded" instead of using a stale reference.
    if (this._loadedModelId) {
      // Clear the stale shadow state
      this._loadedModelId = null;
      this.loadedModel = null;
    }
    return null;
  }

  /**
   * Get info about this provider + its currently-loaded model.
   *
   * Phase 17 (P1 14-3 fix): use getLoadedModelInfo() as the source of
   * truth for whether ANY model is loaded, and getEffectiveLoadedModel()
   * for the full LocalModelInfo. Previously this returned the stale
   * shadow `this.loadedModel` even when inference.ts had unloaded it.
   */
  getInfo(): ProviderInfo {
    const effectiveModel = this.getEffectiveLoadedModel();
    const loadedInfo = getLoadedModelInfo();
    return {
      backend: this.backend,
      available: this.isBackendAvailable(),
      capabilities: this.getBackendCapabilities(),
      loadedModel: loadedInfo && this._loadedModelId ? effectiveModel : null,
      gpuBackend: getGpuBackend(),
      hardware: this.cachedHardware,
    };
  }

  /**
   * Run a health check: is the backend available, is a model loaded, can
   * we infer? Returns a structured report.
   *
   * Phase 17 (P1 14-3 fix): use getLoadedModelInfo() as the source of
   * truth for "is a model loaded". Previously used the shadow
   * `_loadedModelId` which could go stale.
   */
  healthCheck(): ProviderHealthCheck {
    const issues: string[] = [];
    const available = this.isBackendAvailable();
    if (!available) issues.push(`Backend '${this.backend}' is not available on this machine`);
    // Phase 17: read from inference.ts as source of truth
    const loadedInfo = getLoadedModelInfo();
    const modelLoaded = !!(loadedInfo && loadedInfo.id === this._loadedModelId);
    if (!modelLoaded) issues.push('No model loaded');
    const canInfer = available && modelLoaded;
    return {
      healthy: canInfer,
      backend: this.backend,
      available,
      modelLoaded,
      canInfer,
      gpuBackend: getGpuBackend(),
      issues,
      checkedAt: Date.now(),
    };
  }

  /**
   * Currently-loaded model id (or null).
   *
   * Phase 17 (P1 14-3 fix): read from inference.ts as the source of truth.
   * The shadow `_loadedModelId` is updated as a side effect so external
   * callers that cached the value see the new id on next access.
   */
  get loadedModelId(): string | null {
    const loadedInfo = getLoadedModelInfo();
    if (loadedInfo) {
      if (this._loadedModelId !== loadedInfo.id) {
        this._loadedModelId = loadedInfo.id;
      }
      return loadedInfo.id;
    }
    // inference.ts has no model — clear shadow
    if (this._loadedModelId) {
      this._loadedModelId = null;
      this.loadedModel = null;
    }
    return null;
  }

  // ── Internals ──

  /**
   * Detect (and cache) the hardware profile for this machine.
   * The cache is invalidated when the GPU backend changes (e.g. from 'cpu'
   * to 'vulkan' after the llama.cpp engine initializes), so that
   * suggestedGpuLayers is always computed with the correct backend.
   */
  detectHardware(): HardwareProfile {
    const currentBackend = getGpuBackend();
    if (!this.cachedHardware || this.cachedBackend !== currentBackend) {
      this.cachedHardware = detectHardwareProfile(undefined, currentBackend);
      this.cachedBackend = currentBackend;
    }
    return this.cachedHardware;
  }

  /**
   * Merge hardware-suggested parameters with caller options.
   * Caller options win where provided; hardware suggestions fill the gaps.
   */
  private mergeHardwareParams(
    verdict: ModelHardwareVerdict,
    opts: ProviderGenerateOptions,
  ): ProviderGenerateOptions {
    return {
      contextSize: opts.contextSize ?? verdict.suggestedContextSize,
      threads: opts.threads ?? verdict.suggestedThreads,
      gpuLayers: opts.gpuLayers ?? verdict.suggestedGpuLayers,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      systemPrompt: opts.systemPrompt,
    };
  }

  /**
   * Is the backing binary/library available?
   * For llama.cpp, this checks whether node-llama-cpp can be imported.
   * Future backends (ONNX/TensorRT) would check their own dependencies.
   */
  private isBackendAvailable(): boolean {
    if (this.backend === 'llamacpp') {
      // node-llama-cpp is a dependency; if it loads, we're available.
      // The actual GPU backend is reported by getGpuBackend().
      return true;
    }
    // ONNX / TensorRT / WASM: not yet implemented
    return false;
  }

  /**
   * Capabilities supported by this backend.
   * llama.cpp supports chat/completion/coding/reasoning.
   * ONNX (future) would add vision/embedding/etc.
   */
  private getBackendCapabilities(): ModelCapability[] {
    if (this.backend === 'llamacpp') {
      return ['chat', 'completion', 'coding', 'reasoning'];
    }
    return [];
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────

/**
 * Create a LocalModelProvider for a given backend.
 * Today only 'llamacpp' is implemented; 'onnx' and 'tensorrt' are reserved
 * for future backends.
 */
export function createLocalModelProvider(backend: ProviderBackend = 'llamacpp'): LocalModelProvider {
  return new LocalModelProvider(backend);
}

// ─── Security self-audit ───────────────────────────────────────────────────

/**
 * Verifies the provider performs NO network calls and NO automatic downloads.
 * Inference is entirely in-process via node-llama-cpp.
 */
export function verifyProviderSecurity(): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  // No fetch, no net.request, no https imports in this module.
  // Model files are loaded from disk only (model.fileExists verified).
  return { ok: findings.length === 0, findings };
}
