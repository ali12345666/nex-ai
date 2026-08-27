/**
 * NEX AI — Local Engine (Provider Abstraction)
 *
 * Wraps the inference module to provide a unified `chatCompletion` interface
 * that matches the OpenAI/Anthropic providers in ai-service.ts.
 *
 * This is what makes NEX AI "local-first": when ChatPanel calls aiChat with
 * provider='local', this module is invoked instead of any HTTP API.
 *
 * No external service is contacted. All inference happens in-process.
 */

import { LocalModelInfo, getModel, getDefaultModel, listModels } from './model-registry';
import { chatComplete, chatStream, abortInference, type InferenceResult, type StreamChunk } from './inference';
import { getSystemPrompt } from '../ai-service';

export interface LocalChatConfig {
  provider: 'local';
  localModelPath?: string;       // path to .gguf
  localModelId?: string;          // model registry id
  localContextSize?: number;
  localThreads?: number;
  localGpuLayers?: number;        // -1 auto, 0 CPU only
  localTemperature?: number;
  localMaxTokens?: number;
  // Pass-through to provider abstraction
  maxTokens: number;
  temperature: number;
}

export interface LocalMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LocalChatResult {
  success: boolean;
  content?: string;
  error?: string;
  tokens?: number;
  durationMs?: number;
  modelId?: string;
  modelName?: string;
}

/**
 * Resolve which model to use:
 *  1. If config has localModelId, use that
 *  2. Else if config has localModelPath, find registry entry by path
 *  3. Else fall back to default (most recently used)
 *  4. Phase 81: If no model in old registry, check AI Storage registry
 *
 * Phase 74: Exported so main.ts streaming handler can use it.
 * Phase 81: Also checks AI Storage Manager registry for .gguf models.
 */
export function resolveModel(config: LocalChatConfig): LocalModelInfo | null {
  // Phase 82: Check activeModelId from config first
  if (config.localModelId) {
    const model = getModel(config.localModelId);
    if (model) {
      console.log(`[MODEL_RESOLVE] Using model from config.localModelId: ${model.name}`);
      return model;
    }
  }

  // Phase 82: Check activeLocalModelId from persisted settings
  try {
    const { loadState } = require('../persistence');
    const state = loadState();
    const settings = state.settings || {};
    const activeId = (settings as any).activeLocalModelId;
    if (activeId) {
      const model = getModel(activeId);
      if (model) {
        console.log(`[MODEL_RESOLVE] Using active model from settings: ${model.name} (id=${activeId})`);
        return model;
      } else {
        console.log(`[MODEL_RESOLVE] activeLocalModelId=${activeId} not found in registry — falling through`);
      }
    }
  } catch (err: any) {
    console.error(`[MODEL_RESOLVE] Error reading activeLocalModelId from settings: ${err?.message}`);
  }

  if (config.localModelPath) {
    const all = listModels();
    const found = all.find((m) => m.path === config.localModelPath);
    if (found) return found;
  }

  // Phase 81: Check AI Storage registry if no model in old registry
  const defaultModel = getDefaultModel();
  if (defaultModel) return defaultModel;

  // Fall back to AI Storage: find the first valid .gguf LLM model
  try {
    const { readRegistry } = require('./ai-storage-manager');
    const assets = readRegistry() as any[];
    const llmAsset = assets.find(a =>
      a.fileExists &&
      a.format === 'gguf' &&
      (a.type === 'llm' || a.type === 'coder' || a.type === 'vision-llm')
    );
    if (llmAsset) {
      console.log(`[MODEL_RESOLVE] Found model in AI Storage: ${llmAsset.name} — ${llmAsset.path}`);
      // Convert AIAsset to LocalModelInfo format
      return {
        id: llmAsset.id,
        name: llmAsset.name,
        path: llmAsset.path,
        sizeBytes: llmAsset.size,
        contextSize: 2048,
        gpuLayers: -1,
        category: 'general',
        addedAt: llmAsset.detectedAt || Date.now(),
        fileExists: true,
        quantization: llmAsset.quantization,
        architecture: undefined,
        parameterCount: llmAsset.parameterCount,
        capabilities: llmAsset.capabilities || ['chat', 'completion'],
        source: 'local',
        schemaVersion: 2,
        hashAlgorithm: 'sha256',
        integrityStatus: 'unknown',
      } as any;
    }
  } catch (err: any) {
    console.error(`[MODEL_RESOLVE] Error checking AI Storage registry: ${err?.message}`);
  }

  return null;
}

/**
 * Synchronous chat completion (waits for full response).
 * Used by the existing ai-chat IPC handler.
 *
 * Phase 74: Added [CHAT_REQUEST]/[LOCAL_RUNTIME]/[CHAT_RESPONSE] diagnostics.
 */
export async function localChatComplete(
  config: LocalChatConfig,
  messages: LocalMessage[]
): Promise<LocalChatResult> {
  const model = resolveModel(config);

  // Phase 74: Runtime diagnostics
  console.log(`[CHAT_REQUEST]`);
  console.log(`  panel=${messages.length > 0 ? 'chat' : 'unknown'}`);
  console.log(`  provider=local`);
  console.log(`  modelId=${model?.id || 'null'}`);
  console.log(`  modelPath=${model?.path || 'null'}`);
  console.log(`  messages=${messages.length}`);

  if (!model) {
    console.log(`[CHAT_RESPONSE] source=local error=No local model configured`);
    return {
      success: false,
      error: 'No local model configured. Add a .gguf file in Settings > Local AI to start using NEX AI locally.',
    };
  }
  if (!model.fileExists) {
    console.log(`[CHAT_RESPONSE] source=local error=Model file not found: ${model.path}`);
    return {
      success: false,
      error: `Model file not found: ${model.path}. The file may have been moved or deleted.`,
    };
  }

  try {
    const result = await chatComplete(model, messages, {
      contextSize: config.localContextSize,
      threads: config.localThreads,
      gpuLayers: config.localGpuLayers,
      temperature: config.localTemperature ?? config.temperature,
      maxTokens: config.localMaxTokens ?? config.maxTokens,
      systemPrompt: getSystemPrompt(),
    });

    console.log(`[LOCAL_RUNTIME]`);
    console.log(`  loaded=${result.modelId ? 'true' : 'false'}`);
    console.log(`  backend=node-llama-cpp`);
    console.log(`  contextSize=${config.localContextSize ?? 2048}`);
    console.log(`  tokensGenerated=${result.tokensGenerated || 0}`);

    console.log(`[CHAT_RESPONSE]`);
    console.log(`  source=local`);
    console.log(`  tokens=${result.tokensGenerated || 0}`);
    console.log(`  error=none`);

    return {
      success: true,
      content: result.content,
      tokens: result.tokensGenerated,
      durationMs: result.durationMs,
      modelId: result.modelId,
      modelName: result.modelName,
    };
  } catch (err: any) {
    console.log(`[CHAT_RESPONSE] source=local error=${err?.message}`);
    return {
      success: false,
      error: `Local inference failed: ${err.message}`,
    };
  }
}

/**
 * Streaming chat completion (calls onChunk for each token).
 * Used by the streaming IPC channel (Phase 23).
 *
 * Phase 74: Added [CHAT_REQUEST]/[LOCAL_RUNTIME]/[CHAT_RESPONSE] diagnostics.
 */
export async function localChatStream(
  config: LocalChatConfig,
  messages: LocalMessage[],
  onChunk: (chunk: StreamChunk) => void
): Promise<LocalChatResult> {
  const model = resolveModel(config);

  // Phase 74: Runtime diagnostics
  console.log(`[CHAT_REQUEST]`);
  console.log(`  panel=chat-stream`);
  console.log(`  provider=local`);
  console.log(`  modelId=${model?.id || 'null'}`);
  console.log(`  modelPath=${model?.path || 'null'}`);
  console.log(`  messages=${messages.length}`);

  if (!model) {
    console.log(`[CHAT_RESPONSE] source=local-stream error=No local model configured`);
    return {
      success: false,
      error: 'No local model configured.',
    };
  }
  if (!model.fileExists) {
    console.log(`[CHAT_RESPONSE] source=local-stream error=Model file not found: ${model.path}`);
    return {
      success: false,
      error: `Model file not found: ${model.path}`,
    };
  }

  try {
    const result = await chatStream(model, messages, onChunk, {
      contextSize: config.localContextSize,
      threads: config.localThreads,
      gpuLayers: config.localGpuLayers,
      temperature: config.localTemperature ?? config.temperature,
      maxTokens: config.localMaxTokens ?? config.maxTokens,
      systemPrompt: getSystemPrompt(),
    });
    return {
      success: true,
      content: result.content,
      tokens: result.tokensGenerated,
      durationMs: result.durationMs,
      modelId: result.modelId,
      modelName: result.modelName,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Local streaming failed: ${err.message}`,
    };
  }
}

/**
 * Abort in-progress local inference.
 */
export function localAbort(): void {
  abortInference();
}
