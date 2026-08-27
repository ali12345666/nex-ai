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
// Phase 86 P2-8: _currentSession removed (was dead code — never held a real session)
let _ctxSequence: any = null;
let _abortFlag: boolean = false;
let _gpuBackend: 'cpu' | 'cuda' | 'metal' | 'vulkan' = 'cpu';

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
    // (the model object from registry may have been updated)
    _loadedModelInfo = model;
    return;
  }

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
  // Phase 86 P2-8: _currentSession is dead code, removed
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
  // Phase 87: Assert model path before inference
  if (!model.path) {
    console.error('[MODEL_PATH_MISSING] chatComplete — model:', JSON.stringify({ id: model.id, name: model.name }));
    throw new Error('Resolved model has no path — cannot perform inference');
  }
  await loadModel(model, opts);

  if (!_loadedContext) {
    throw new Error('Model context not initialized');
  }

  await getLlamaInstance();

  // Phase 86 P0-1/P0-2: Use chatHistory constructor option instead of
  // broken maxTokens:0 replay loop. This properly includes assistant turns
  // and avoids phantom generation / hangs.
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) {
    throw new Error('No user message in conversation');
  }

  // Build chatHistory: all messages except the final user message (which
  // will be sent via session.prompt()). System messages are handled by
  // the systemPrompt option, not chatHistory.
  const chatHistory = messages
    .filter(m => m.role !== 'system')
    .slice(0, -1) // exclude the final user message
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  const session = new _LlamaChatSession({
    contextSequence: getSharedSequence(),
    systemPrompt: opts.systemPrompt,
    chatHistory: chatHistory.length > 0 ? chatHistory : undefined,
  });

  _abortFlag = false;
  const start = Date.now();

  // Generate response for the final user message
  let response = '';
  try {
    const _t0 = Date.now();
    response = await session.prompt(lastUserMsg.content, {
      maxTokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.7,
    });
    noteInferenceStats({
      tokensPerSecond: estimateTokens(response) / Math.max(0.001, (Date.now() - _t0) / 1000),
      generatedTokens: estimateTokens(response),
      durationMs: Date.now() - _t0,
      active: false,
    });
  } finally {
    try { (session as any).dispose?.(); } catch (e: any) { console.warn('[NEX AI Local] Session dispose warning:', e?.message); }
  }

  return {
    content: response,
    tokensGenerated: estimateTokens(response),
    modelId: model.id,
    modelName: model.name,
    stopped: _abortFlag,
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
  // Phase 87: Assert model path before inference
  if (!model.path) {
    console.error('[MODEL_PATH_MISSING] chatStream — model:', JSON.stringify({ id: model.id, name: model.name }));
    throw new Error('Resolved model has no path — cannot perform inference');
  }
  await loadModel(model, opts);

  if (!_loadedContext) {
    throw new Error('Model context not initialized');
  }

  await getLlamaInstance();

  // Phase 86 P0-1/P0-2: Use chatHistory constructor option instead of
  // broken maxTokens:0 replay loop.
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) {
    throw new Error('No user message in conversation');
  }

  const chatHistory = messages
    .filter(m => m.role !== 'system')
    .slice(0, -1)
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  const session = new _LlamaChatSession({
    contextSequence: getSharedSequence(),
    systemPrompt: opts.systemPrompt,
    chatHistory: chatHistory.length > 0 ? chatHistory : undefined,
  });

  _abortFlag = false;
  const start = Date.now();
  let fullResponse = '';
  noteInferenceStats({ active: true });

  try {
    const response = await session.prompt(lastUserMsg.content, {
      maxTokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.7,
      onTextChunk: (chunk: string) => {
        if (_abortFlag) return;
        fullResponse += chunk;
        onChunk({ content: chunk, done: false });
      },
    });
    void response;
    if (response && !fullResponse.endsWith(response.slice(-50))) {
      fullResponse = response;
    }
    onChunk({ content: '', done: true });
    noteInferenceStats({
      tokensPerSecond: estimateTokens(fullResponse) / Math.max(0.001, (Date.now() - start) / 1000),
      generatedTokens: estimateTokens(fullResponse),
      durationMs: Date.now() - start,
      active: false,
    });
    return {
      content: fullResponse,
      tokensGenerated: estimateTokens(fullResponse),
      modelId: model.id,
      modelName: model.name,
      stopped: _abortFlag,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    noteInferenceStats({ active: false });
    onChunk({ content: '', done: true, error: err.message });
    throw err;
  } finally {
    try { (session as any).dispose?.(); } catch (e: any) { console.warn('[NEX AI Local] Session dispose warning:', e?.message); }
  }
}

/**
 * Abort an in-progress inference.
 * Note: node-llama-cpp v3 doesn't have great abort support; this sets a flag
 * that prevents further onTextChunk calls but the underlying generation
 * continues until max_tokens is reached or the model stops naturally.
 */
export function abortInference(): void {
  _abortFlag = true;
  console.log('[NEX AI Local] Inference abort requested');
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
