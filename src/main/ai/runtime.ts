/**
 * NEX AI — AI Runtime Abstraction
 *
 * Decouples NEX AI Core from any specific local AI backend.
 *
 * Currently backed by node-llama-cpp (LlamaCppRuntime), but the interface
 * is designed so future runtimes (ONNX, MLC, ExecuTorch, custom WASM, etc.)
 * can be added without touching Agent Core, Provider abstraction, or any
 * Tool that calls inference.
 *
 * Architecture:
 *
 *   Agent Core / Tools / ChatPanel
 *         ↓ (depends only on AIRuntime interface)
 *   AIRuntimeRegistry  (registers/looks up runtimes by name)
 *         ↓
 *   AIRuntime (interface)  ←── LlamaCppRuntime (current)
 *                         ←── [FutureRuntime]   (pluggable)
 *         ↓
 *   AIModel (loaded model, can chat/stream)
 *
 * Why this matters:
 *  - Today we use llama.cpp. Tomorrow we may use ONNX for vision models
 *    or a custom WASM runtime for embedded scenarios.
 *  - Agent Core should NEVER import `node-llama-cpp` directly.
 *  - Each runtime manages its own model lifecycle internally.
 */

import type { LocalModelInfo, ModelCapability } from './model-registry';

// ─── Core Interfaces ────────────────────────────────────────────────────────

export type RuntimeType = 'llamacpp' | 'onnx' | 'mlc' | 'wasm' | 'online' | 'custom';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  contextSize?: number;
  threads?: number;
  gpuLayers?: number;        // -1 = auto, 0 = CPU only
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  // Future: stop sequences, top-p, top-k, repeat penalty, etc.
  stopSequences?: string[];
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
}

export interface ChatResult {
  content: string;
  tokensGenerated: number;
  modelId: string;
  modelName: string;
  stopped: boolean;
  durationMs: number;
  // Future: promptTokens, completionTokens, finishReason, etc.
  promptTokens?: number;
  completionTokens?: number;
  finishReason?: 'stop' | 'length' | 'tool_call' | 'aborted';
}

export interface StreamChunk {
  content: string;
  done: boolean;
  error?: string;
  // Future: token-level metadata (logprobs, etc.)
}

export interface RuntimeStats {
  type: RuntimeType;
  loaded: boolean;
  loadedModelId: string | null;
  loadedModelName: string | null;
  ramUsageBytes?: number;
  vramUsageBytes?: number;
  gpuBackend?: 'cuda' | 'vulkan' | 'metal' | 'cpu' | 'none';
  threadsInUse?: number;
}

/**
 * The unified AI Runtime interface.
 *
 * Every runtime (llama.cpp, ONNX, etc.) implements this. Agent Core and
 * Tools depend only on this interface.
 *
 * A single runtime instance manages ONE loaded model at a time. To use
 * multiple models simultaneously (e.g. text + vision), instantiate
 * multiple runtime instances via AIRuntimeRegistry.create('llamacpp', ...).
 */
export interface AIRuntime {
  /** Runtime type identifier (e.g. 'llamacpp') */
  readonly type: RuntimeType;

  /** Capabilities supported by this runtime (text, vision, audio, etc.) */
  readonly capabilities: ReadonlySet<ModelCapability>;

  /**
   * Initialize the runtime backend. Called once before any model loading.
   * Idempotent.
   */
  init(): Promise<void>;

  /**
   * Load a model into memory. If a different model is already loaded,
   * unload it first.
   */
  loadModel(model: LocalModelInfo, opts?: ChatOptions): Promise<void>;

  /**
   * Unload the currently-loaded model, freeing RAM/VRAM.
   * The runtime itself stays initialized.
   */
  unloadModel(): Promise<void>;

  /**
   * Generate a full chat completion (not streamed).
   */
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;

  /**
   * Stream a chat completion token-by-token.
   */
  chatStream(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    opts?: ChatOptions
  ): Promise<ChatResult>;

  /**
   * Abort an in-progress inference.
   */
  abort(): void;

  /**
   * Get current stats (loaded model, RAM/VRAM usage, GPU backend).
   */
  getStats(): RuntimeStats;

  /**
   * Full shutdown: dispose backend resources.
   * Called once on app exit.
   */
  shutdown(): Promise<void>;
}

// ─── Runtime Registry ───────────────────────────────────────────────────────

import { LlamaCppRuntime } from './runtimes/llamacpp-runtime';

/**
 * Factory function type for creating a runtime instance.
 */
export type RuntimeFactory = () => AIRuntime;

const _factories = new Map<RuntimeType, RuntimeFactory>();
const _instances = new Map<string, AIRuntime>(); // keyed by `${type}:${instanceId}`

function registerRuntime(type: RuntimeType, factory: RuntimeFactory): void {
  _factories.set(type, factory);
}

/**
 * Get or create a runtime instance.
 *
 * @param type Runtime type ('llamacpp', 'onnx', etc.)
 * @param instanceId Optional instance identifier. Use the same id to get
 *                   the same instance (e.g. for shared text model across
 *                   ChatPanel and Agent). Use a fresh id for parallel models.
 */
export function getRuntime(type: RuntimeType = 'llamacpp', instanceId: string = 'default'): AIRuntime {
  const key = `${type}:${instanceId}`;
  let instance = _instances.get(key);
  if (!instance) {
    const factory = _factories.get(type);
    if (!factory) {
      throw new Error(`Unknown AI runtime type: ${type}. Register it first via registerRuntime().`);
    }
    instance = factory();
    _instances.set(key, instance);
  }
  return instance;
}

/**
 * Get the default runtime (LlamaCppRuntime, single shared instance).
 * This is the convenience accessor most code should use.
 */
export function getDefaultRuntime(): AIRuntime {
  return getRuntime('llamacpp', 'default');
}

/**
 * List all registered runtime types.
 */
export function listRuntimeTypes(): RuntimeType[] {
  return Array.from(_factories.keys());
}

// ─── Phase 12 / P12-B: monitoring-grade stats aggregation ──────────────────
// Phase 21 / P21-E: state lives in runtime-telemetry.ts (cycle-free import
// for inference.ts); this module keeps the public API + freshness policy.

export { noteInferenceStats } from './runtime-telemetry';
import { getLastInference, getNotedModel, telemetryNoteIsFresh } from './runtime-telemetry';

export interface RuntimeInstanceStats {
  instanceId: string;
  type: RuntimeType;
  loaded: boolean;
  loadedModelName: string | null;
  gpuBackend?: string;
}

/**
 * Monitoring snapshot of every live runtime instance + last inference.
 * (System Monitor consumes this — the SAME registry the agent uses.)
 */
export function getRuntimeMonitorStats(): {
  defaultRuntimeType: RuntimeType;
  stats: RuntimeInstanceStats[];
  lastInference?: {
    tokensPerSecond?: number;
    promptTokens?: number;
    generatedTokens?: number;
    durationMs?: number;
    modelLoadMs?: number;
    active?: boolean;
  };
} {
  const stats: RuntimeInstanceStats[] = [];
  for (const [key, inst] of _instances) {
    const s = inst.getStats();
    const instanceId = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
    stats.push({
      instanceId,
      type: inst.type,
      loaded: s.loaded,
      loadedModelName: s.loadedModelName,
      gpuBackend: s.gpuBackend,
    });
  }
  // Phase 21 / P21-E: the DIRECT inference path (non-stream local chat)
  // doesn't create a registry instance — surface its noted model so the
  // System Monitor reflects reality on every path.
  const noted = getNotedModel();
  if (noted && !stats.some((e) => e.loadedModelName === noted)) {
    stats.push({ instanceId: 'inference-direct', type: 'llamacpp', loaded: true, loadedModelName: noted, gpuBackend: 'cpu' });
  }

  // drop stale inference records (> 5 min old, not active)
  const fresh = telemetryNoteIsFresh(5 * 60 * 1000) ? getLastInference() ?? undefined : undefined;
  delete (fresh as any)?.at;
  return { defaultRuntimeType: 'llamacpp', stats, lastInference: fresh };
}

/**
 * Shut down ALL runtime instances. Called on app exit.
 */
export async function shutdownAllRuntimes(): Promise<void> {
  const instances = Array.from(_instances.values());
  _instances.clear();
  for (const inst of instances) {
    try { await inst.shutdown(); } catch (err) {
      console.warn(`[NEX AI] Runtime ${inst.type} shutdown error:`, err);
    }
  }
}

// ─── Register built-in runtimes ─────────────────────────────────────────────

registerRuntime('llamacpp', () => new LlamaCppRuntime());

// Phase 8 / P8-B: online runtime (provider abstraction → GLM 5.3 by default).
// online-transport.ts is electron-free at import time (dynamic imports only),
// so this registration is safe in tests and in the renderer toolchain.
import { createDefaultOnlineRuntime } from './runtimes/online-transport';
registerRuntime('online', () => createDefaultOnlineRuntime());
