/**
 * NEX AI — Local Inference Engine
 *
 * Wraps node-llama-cpp to provide:
 *  - Model loading (lazy + cached)
 *  - Chat completion (full response)
 *  - Streaming chat completion (token-by-token)
 *  - Stop / abort inference
 *
 * Key design:
 *  - One model loaded at a time (loading multiple is expensive in RAM)
 *  - Switching models unloads the previous one
 *  - Inference runs on a separate worker thread (node-llama-cpp default)
 *  - CPU fallback is always available (Vulkan/CUDA may fail to init)
 *
 * This is the REAL local AI — no mocks, no stubs. It actually loads and runs
 * GGUF models via llama.cpp under the hood.
 */

/**
 * NEX AI — Local Inference Engine
 *
 * Wraps node-llama-cpp to provide:
 *  - Model loading (lazy + cached)
 *  - Chat completion (full response)
 *  - Streaming chat completion (token-by-token)
 *  - Stop / abort inference
 *
 * Key design:
 *  - One model loaded at a time (loading multiple is expensive in RAM)
 *  - Switching models unloads the previous one
 *  - Inference runs on a separate worker thread (node-llama-cpp default)
 *  - CPU fallback is always available (Vulkan/CUDA may fail to init)
 *
 * node-llama-cpp uses top-level await in its ESM exports, so we must
 * dynamically import it (not statically require it).
 */

import { touchModel, LocalModelInfo } from './model-registry';
// Phase 21 / P21-E: direct-path telemetry (cycle-free module)
import { noteInferenceStats, noteLoadedModel } from './runtime-telemetry';

export interface InferenceOptions {
  contextSize?: number;
  threads?: number;
  gpuLayers?: number;        // -1 = auto, 0 = CPU only
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface InferenceResult {
  content: string;
  tokensGenerated: number;
  modelId: string;
  modelName: string;
  stopped: boolean;
  durationMs: number;
}

export interface StreamChunk {
  content: string;
  done: boolean;
  error?: string;
}

let _llama: any = null;
let _loadedModelId: string | null = null;
let _loadedModel: any = null;              // node-llama-cpp LlamaModel object
let _loadedModelInfo: LocalModelInfo | null = null;  // Phase 87: the LocalModelInfo that was passed to loadModel
let _loadedContext: any = null;
let _LlamaChatSession: any = null;
let _ctxSequence: any = null;
let _gpuBackend: 'cpu' | 'cuda' | 'metal' | 'vulkan' = 'cpu';

// Phase 90: Inference serialization — ONE active generation at a time
let _inFlightPromise: Promise<any> | null = null;

// Phase 90: Per-request abort (replaces global _abortFlag)
let _activeAbortController: AbortController | null = null;

async function getLlamaInstance() {
  if (!_llama) {
    console.log('[NEX AI Local] Initializing llama.cpp engine...');
    // node-llama-cpp is ESM-only and uses top-level await, so we must
    // dynamically import it. Direct `await import(...)` in our CJS-compiled
    // module gets rewritten by TypeScript to `require()`, which fails on
    // ESM-only deps. Use eval-based indirection to keep the `import()`
    // call as a true dynamic import at runtime.
    const importSrc = '(async (m) => await import(m))';
    const dynamicImport = (0, eval)(importSrc) as (m: string) => Promise<any>;
    const mod = await dynamicImport('node-llama-cpp');
    _llama = await mod.getLlama();
    _LlamaChatSession = mod.LlamaChatSession;
    // UI-03: capture the ACTUAL GPU backend reported by llama.cpp (was
    // previously hardcoded to 'cpu' in llamacpp-runtime.getStats — fake
    // telemetry when GPU offload is actually active).
    // node-llama-cpp v3 Llama.gpu returns: 'metal' | 'cuda' | 'vulkan' | false.
    try {
      const gpu = (_llama as any).gpu;
      if (gpu === 'metal' || gpu === 'cuda' || gpu === 'vulkan') {
        _gpuBackend = gpu;
      } else {
        _gpuBackend = 'cpu';
      }
    } catch {
      _gpuBackend = 'cpu';
    }
    console.log(`[NEX AI Local] Engine ready (GPU backend: ${_gpuBackend})`);
  }
  return _llama;
}

/**
 * UI-03: return the actual GPU backend in use by the llama.cpp engine.
 * Returns 'cpu' before the engine is initialized (safe default).
 */
export function getGpuBackend(): 'cpu' | 'cuda' | 'metal' | 'vulkan' {
  return _gpuBackend;
}

/**
 * Phase 90: Wait for any in-flight inference to complete before proceeding.
 * This prevents concurrent access to the shared context/sequence.
 */
async function waitForInFlight(): Promise<void> {
  while (_inFlightPromise) {
    try { await _inFlightPromise; } catch { /* ignore errors from previous request */ }
  }
}

/**
 * Phase 90: Mark inference as in-flight. Returns a function to clear it.
 */
function markInFlight<T>(promise: Promise<T>): () => void {
  _inFlightPromise = promise as Promise<any>;
  return () => { if (_inFlightPromise === promise) _inFlightPromise = null; };
}

/**
 * Load a GGUF model into memory. If a different model is already loaded,
 * unload it first. Subsequent inferences use this loaded model.
 */
export async function loadModel(model: LocalModelInfo, opts: InferenceOptions = {}): Promise<void> {
  // Phase 87: Assert model has a valid path before proceeding
  if (!model.path) {
    console.error('[MODEL_PATH_MISSING]', JSON.stringify({ id: model.id, name: model.name, path: model.path }));
    throw new Error(`Resolved model has no path: ${JSON.stringify({ id: model.id, name: model.name })}`);
  }
  // Phase 86 P1-6: Fix idempotency — check fileExists BEFORE the fast path
  if (!model.fileExists) {
    throw new Error(`Model file does not exist: ${model.path}`);
  }
  // Phase 86 P1-6: Single idempotency check (was duplicated at lines 129+135)
  if (_loadedModelId === model.id && _loadedContext && _loadedModel) {
    // Phase 87: Update the stored LocalModelInfo even on idempotent path
    _loadedModelInfo = model;
    return;
  }

  // Phase 90: Wait for any in-flight inference before unloading
  await waitForInFlight();

  // Unload previous model
  await unloadModel();

  const llama = await getLlamaInstance();
  console.log(`[NEX AI Local] Loading model: ${model.name} (${formatBytes(model.sizeBytes)})`);

  const modelOpts: any = {
    gpuLayers: opts.gpuLayers ?? model.gpuLayers ?? -1,
  };

  _loadedModel = await llama.loadModel({ modelPath: model.path, ...modelOpts });
  _loadedContext = await _loadedModel.createContext({
    contextSize: opts.contextSize ?? model.contextSize ?? 2048,
    threads: opts.threads ?? 4,
  });
  _ctxSequence = null; // new context → new sequence pool
  _loadedModelId = model.id;
  _loadedModelInfo = model;  // Phase 87: Store the LocalModelInfo for getLoadedModel()

  // Phase 74: Model load log
  console.log(`[MODEL_LOAD]`);
  console.log(`  path=${model.path}`);
  console.log(`  size=${model.sizeBytes}`);
  console.log(`  contextSize=${opts.contextSize ?? model.contextSize ?? 2048}`);
  console.log(`  gpuLayers=${opts.gpuLayers ?? model.gpuLayers ?? -1}`);
  console.log(`  modelId=${model.id}`);

  // Mark as last used
  touchModel(model.id);

  noteLoadedModel(model.name);
  // UI-03: surface the model's configured context window size so the UI
  // (BottomStatusBar / HardwareMonitor) can show context usage even for
  // direct chat (was previously only populated for agent tasks).
  noteInferenceStats({
    contextMaxTokens: opts.contextSize ?? model.contextSize ?? 2048,
  });
  console.log(`[NEX AI Local] Model loaded: ${model.name}`);
}

/**
 * Unload the currently-loaded model and free memory.
 * NOTE: This does NOT dispose the underlying llama.cpp engine (_llama).
 * Use `shutdownLlama()` for full teardown (e.g. before app.exit()).
 */
export async function unloadModel(): Promise<void> {
  // Phase 90: Wait for any in-flight inference before disposing
  await waitForInFlight();
  if (_ctxSequence) {
    try { (_ctxSequence as any).dispose?.(); } catch (e: any) { console.warn('[NEX AI Local] Sequence dispose warning:', e?.message); }
    _ctxSequence = null;
  }
  if (_loadedContext) {
    try { (_loadedContext as any).dispose?.(); } catch (e: any) { console.warn('[NEX AI Local] Context dispose warning:', e?.message); }
    _loadedContext = null;
  }
  if (_loadedModel) {
    try { (_loadedModel as any).dispose?.(); } catch (e: any) { console.warn('[NEX AI Local] Model dispose warning:', e?.message); }
    _loadedModel = null;
  }
  _loadedModelId = null;
  _loadedModelInfo = null;  // Phase 87: Clear the LocalModelInfo too
  noteLoadedModel(null);
  console.log('[NEX AI Local] Model unloaded');
}

/**
 * Full shutdown: unload model AND dispose the llama.cpp engine itself.
 *
 * CRITICAL: Call this before app.exit() / process.exit() — otherwise
 * node-llama-cpp's native AsyncWorkers may still be in-flight when the
 * JS env tears down, causing SIGABRT (exit 134).
 *
 * `app.quit()` works without this because Node emits `beforeExit` first,
 * but `app.exit()` skips `beforeExit` entirely.
 */
export async function shutdownLlama(): Promise<void> {
  await unloadModel();
  if (_llama) {
    try {
      console.log('[NEX AI Local] Disposing llama.cpp engine...');
      await _llama.dispose?.();
      console.log('[NEX AI Local] Engine disposed');
    } catch (err) {
      console.warn('[NEX AI Local] Engine dispose error:', (err as any)?.message || err);
    }
    _llama = null;
    _LlamaChatSession = null;
  }
}

/**
 * Get info about the currently-loaded model (if any).
 */
export function getLoadedModelInfo(): { id: string } | null {
  if (!_loadedModelId) return null;
  return { id: _loadedModelId };
}

/**
 * Phase 86 P0-3 / Phase 87: Get the full LocalModelInfo of the loaded model.
 * Returns the LocalModelInfo that was passed to loadModel() — NOT the
 * node-llama-cpp LlamaModel object (which is _loadedModel).
 * Returns null if no model is loaded.
 */
export function getLoadedModel(): LocalModelInfo | null {
  if (!_loadedModelId || !_loadedModelInfo) return null;
  return _loadedModelInfo;
}

/**
 * Phase 86 P0-3: Get the loaded context (if any).
 */
export function getLoadedContext(): any | null {
  return _loadedContext;
}

/**
 * Generate a chat completion (full response, not streamed).
 * The caller is responsible for loading the model first.
 *
 * Phase 74 FIX: Uses LlamaChatSession's native multi-turn API instead of
 * manually labeling messages with "User:/Assistant:/System:" strings.
 * This prevents the doubly-wrapped ChatML prompt that was causing low
 * quality responses on Qwen2.5.
 */
export async function chatComplete(
  model: LocalModelInfo,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts: InferenceOptions = {}
): Promise<InferenceResult> {
  if (!model.path) {
    console.error('[MODEL_PATH_MISSING] chatComplete — model:', JSON.stringify({ id: model.id, name: model.name }));
    throw new Error('Resolved model has no path — cannot perform inference');
  }

  // Phase 90: Wait for any in-flight inference
  await waitForInFlight();

  await loadModel(model, opts);
  if (!_loadedContext) throw new Error('Model context not initialized');
  await getLlamaInstance();

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) throw new Error('No user message in conversation');

  const chatHistory = messages
    .filter(m => m.role !== 'system')
    .slice(0, -1)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  // Phase 90: Per-request AbortController
  const abortController = new AbortController();
  _activeAbortController = abortController;

  const session = new _LlamaChatSession({
    contextSequence: getSharedSequence(),
    systemPrompt: opts.systemPrompt,
    chatHistory: chatHistory.length > 0 ? chatHistory : undefined,
  });

  const start = Date.now();
  let response = '';

  // Phase 90: Wrap in serialization
  const inferencePromise = (async () => {
    try {
      const _t0 = Date.now();
      response = await session.prompt(lastUserMsg.content, {
        maxTokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.7,
        signal: abortController.signal,
      });
      const genMs = Date.now() - _t0;
      const genTokens = estimateTokens(response);
      console.log(`[INFERENCE_METRICS] model=${model.name} backend=${_gpuBackend} gpuLayers=${opts.gpuLayers ?? model.gpuLayers ?? -1} context=${opts.contextSize ?? model.contextSize ?? 2048} generatedTokens=${genTokens} generationMs=${genMs} tokensPerSecond=${(genTokens / Math.max(0.001, genMs / 1000)).toFixed(1)} totalMs=${Date.now() - start}`);
      noteInferenceStats({
        tokensPerSecond: genTokens / Math.max(0.001, genMs / 1000),
        generatedTokens: genTokens,
        durationMs: genMs,
        active: false,
      });
    } finally {
      try { (session as any).dispose?.(); } catch (e: any) { console.warn('[NEX AI Local] Session dispose warning:', e?.message); }
      if (_activeAbortController === abortController) _activeAbortController = null;
    }
  })();

  const clearInFlight = markInFlight(inferencePromise);
  try {
    await inferencePromise;
  } finally {
    clearInFlight();
  }

  return {
    content: response,
    tokensGenerated: estimateTokens(response),
    modelId: model.id,
    modelName: model.name,
    stopped: abortController.signal.aborted,
    durationMs: Date.now() - start,
  };
}

/**
 * Stream a chat completion token-by-token.
 * The onChunk callback is called from a worker thread.
 *
 * Phase 74 FIX: Uses LlamaChatSession's native multi-turn API (same fix
 * as chatComplete). No more manual "User:/Assistant:" labeling.
 */
export async function chatStream(
  model: LocalModelInfo,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  onChunk: (chunk: StreamChunk) => void,
  opts: InferenceOptions = {}
): Promise<InferenceResult> {
  if (!model.path) {
    console.error('[MODEL_PATH_MISSING] chatStream — model:', JSON.stringify({ id: model.id, name: model.name }));
    throw new Error('Resolved model has no path — cannot perform inference');
  }

  // Phase 90: Wait for any in-flight inference
  await waitForInFlight();

  await loadModel(model, opts);
  if (!_loadedContext) throw new Error('Model context not initialized');
  await getLlamaInstance();

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) throw new Error('No user message in conversation');

  const chatHistory = messages
    .filter(m => m.role !== 'system')
    .slice(0, -1)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  // Phase 90: Per-request AbortController
  const abortController = new AbortController();
  _activeAbortController = abortController;

  const session = new _LlamaChatSession({
    contextSequence: getSharedSequence(),
    systemPrompt: opts.systemPrompt,
    chatHistory: chatHistory.length > 0 ? chatHistory : undefined,
  });

  const start = Date.now();
  let fullResponse = '';
  let firstTokenMs = 0;
  noteInferenceStats({ active: true });

  const inferencePromise = (async () => {
    try {
      const response = await session.prompt(lastUserMsg.content, {
        maxTokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.7,
        signal: abortController.signal,
        onTextChunk: (chunk: string) => {
          if (abortController.signal.aborted) return;
          if (!firstTokenMs) firstTokenMs = Date.now() - start;
          fullResponse += chunk;
          onChunk({ content: chunk, done: false });
        },
      });
      void response;
      if (response && !fullResponse.endsWith(response.slice(-50))) {
        fullResponse = response;
      }
      onChunk({ content: '', done: true });
      const genMs = Date.now() - start;
      const genTokens = estimateTokens(fullResponse);
      console.log(`[INFERENCE_METRICS] model=${model.name} backend=${_gpuBackend} gpuLayers=${opts.gpuLayers ?? model.gpuLayers ?? -1} context=${opts.contextSize ?? model.contextSize ?? 2048} firstTokenMs=${firstTokenMs} generatedTokens=${genTokens} generationMs=${genMs} tokensPerSecond=${(genTokens / Math.max(0.001, genMs / 1000)).toFixed(1)} totalMs=${genMs}`);
      noteInferenceStats({
        tokensPerSecond: genTokens / Math.max(0.001, genMs / 1000),
        generatedTokens: genTokens,
        durationMs: genMs,
        active: false,
      });
      return {
        content: fullResponse,
        tokensGenerated: genTokens,
        modelId: model.id,
        modelName: model.name,
        stopped: abortController.signal.aborted,
        durationMs: genMs,
      };
    } catch (err: any) {
      noteInferenceStats({ active: false });
      onChunk({ content: '', done: true, error: err.message });
      throw err;
    } finally {
      try { (session as any).dispose?.(); } catch (e: any) { console.warn('[NEX AI Local] Session dispose warning:', e?.message); }
      if (_activeAbortController === abortController) _activeAbortController = null;
    }
  })();

  const clearInFlight = markInFlight(inferencePromise);
  try {
    return await inferencePromise;
  } finally {
    clearInFlight();
  }
}

/**
 * Phase 90: Abort the currently-active inference request.
 * Uses per-request AbortController — only aborts the active request,
 * not future ones.
 */
export function abortInference(): void {
  if (_activeAbortController) {
    console.log('[NEX AI Local] Aborting active inference request');
    _activeAbortController.abort();
    _activeAbortController = null;
  } else {
    console.log('[NEX AI Local] No active inference to abort');
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Claim (once) and reuse the context sequence for the loaded model. */
function getSharedSequence(): any {
  if (!_ctxSequence && _loadedContext) {
    _ctxSequence = (_loadedContext as any).getSequence();
  }
  return _ctxSequence;
}

function estimateTokens(text: string): number {
  // Rough estimate: 1 token ~= 4 chars in English, ~1 char in Chinese
  // Used for display only; actual token count requires tokenizer
  return Math.ceil(text.length / 4);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
