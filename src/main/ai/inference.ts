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
let _loadedModel: any = null;
let _loadedContext: any = null;
let _LlamaChatSession: any = null;
let _currentSession: any = null;
let _abortFlag: boolean = false;

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
    console.log('[NEX AI Local] Engine ready');
  }
  return _llama;
}

/**
 * Load a GGUF model into memory. If a different model is already loaded,
 * unload it first. Subsequent inferences use this loaded model.
 */
export async function loadModel(model: LocalModelInfo, opts: InferenceOptions = {}): Promise<void> {
  if (!model.fileExists) {
    throw new Error(`Model file does not exist: ${model.path}`);
  }
  if (_loadedModelId === model.id && _loadedModel && _loadedContext) {
    // Same model already loaded — just reset session
    _currentSession = null;
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
  _currentSession = null;
  _loadedModelId = model.id;

  // Mark as last used
  touchModel(model.id);

  console.log(`[NEX AI Local] Model loaded: ${model.name}`);
}

/**
 * Unload the currently-loaded model and free memory.
 * NOTE: This does NOT dispose the underlying llama.cpp engine (_llama).
 * Use `shutdownLlama()` for full teardown (e.g. before app.exit()).
 */
export async function unloadModel(): Promise<void> {
  if (_currentSession) {
    try { (_currentSession as any).dispose?.(); } catch {}
    _currentSession = null;
  }
  if (_loadedContext) {
    try { (_loadedContext as any).dispose?.(); } catch {}
    _loadedContext = null;
  }
  if (_loadedModel) {
    try { (_loadedModel as any).dispose?.(); } catch {}
    _loadedModel = null;
  }
  _loadedModelId = null;
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
 * Generate a chat completion (full response, not streamed).
 * The caller is responsible for loading the model first.
 */
export async function chatComplete(
  model: LocalModelInfo,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts: InferenceOptions = {}
): Promise<InferenceResult> {
  await loadModel(model, opts);

  if (!_loadedContext) {
    throw new Error('Model context not initialized');
  }

  // Create a fresh chat session for each completion
  // (node-llama-cpp v3 LlamaChatSession uses a default system prompt)
  await getLlamaInstance();
  const session = new _LlamaChatSession({
    contextSequence: _loadedContext.getSequence(),
    systemPrompt: opts.systemPrompt,
  });

  // Build the conversation in user/assistant turn format
  // node-llama-cpp expects the messages as a back-and-forth
  // We send the LAST user message and rely on session history for prior context
  // For Phase 3 MVP we send only the last user message
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) {
    throw new Error('No user message in conversation');
  }

  _abortFlag = false;
  const start = Date.now();

  // For multi-turn: replay prior conversation
  let prompt: string;
  if (messages.length === 1) {
    prompt = lastUserMsg.content;
  } else {
    const parts: string[] = [];
    if (opts.systemPrompt) parts.push(`System: ${opts.systemPrompt}`);
    for (const m of messages) {
      if (m.role === 'system') continue;
      const label = m.role === 'user' ? 'User' : 'Assistant';
      parts.push(`${label}: ${m.content}`);
    }
    parts.push('Assistant:');
    prompt = parts.join('\n\n');
  }

  const response = await session.prompt(prompt, {
    maxTokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.7,
  });

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
 */
export async function chatStream(
  model: LocalModelInfo,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  onChunk: (chunk: StreamChunk) => void,
  opts: InferenceOptions = {}
): Promise<InferenceResult> {
  await loadModel(model, opts);

  if (!_loadedContext) {
    throw new Error('Model context not initialized');
  }

  await getLlamaInstance();
  const session = new _LlamaChatSession({
    contextSequence: _loadedContext.getSequence(),
    systemPrompt: opts.systemPrompt,
  });

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) {
    throw new Error('No user message in conversation');
  }

  _abortFlag = false;
  const start = Date.now();
  let fullResponse = '';

  let prompt: string;
  if (messages.length === 1) {
    prompt = lastUserMsg.content;
  } else {
    const parts: string[] = [];
    if (opts.systemPrompt) parts.push(`System: ${opts.systemPrompt}`);
    for (const m of messages) {
      if (m.role === 'system') continue;
      const label = m.role === 'user' ? 'User' : 'Assistant';
      parts.push(`${label}: ${m.content}`);
    }
    parts.push('Assistant:');
    prompt = parts.join('\n\n');
  }

  try {
    const response = await session.prompt(prompt, {
      maxTokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.7,
      onTextChunk: (chunk: string) => {
        if (_abortFlag) return;
        fullResponse += chunk;
        onChunk({ content: chunk, done: false });
      },
    });
    void response; // response == accumulated chunks; we use fullResponse
    // In case onTextChunk missed some final text
    if (response && !fullResponse.endsWith(response.slice(-50))) {
      fullResponse = response;
    }
    onChunk({ content: '', done: true });
    return {
      content: fullResponse,
      tokensGenerated: estimateTokens(fullResponse),
      modelId: model.id,
      modelName: model.name,
      stopped: _abortFlag,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    onChunk({ content: '', done: true, error: err.message });
    throw err;
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
