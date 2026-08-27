/**
 * LlamaCppRuntime — AIRuntime implementation backed by node-llama-cpp.
 *
 * Phase 86 P0-3: _loadedModel field REMOVED. All model state is read from
 * inference.ts (single source of truth). This fixes the split-brain bug
 * where activation (via LocalModelProvider) set inference.ts singletons
 * but not LlamaCppRuntime._loadedModel.
 */

import type {
  AIRuntime, ChatMessage, ChatOptions, ChatResult,
  StreamChunk, RuntimeStats, RuntimeType,
} from '../runtime';
import type { LocalModelInfo, ModelCapability } from '../model-registry';
import {
  loadModel as _loadModel,
  unloadModel as _unloadModel,
  chatComplete as _chatComplete,
  chatStream as _chatStream,
  abortInference as _abortInference,
  getLoadedModelInfo as _getLoadedModelInfo,
  getLoadedModel as _getLoadedModel,
  shutdownLlama as _shutdownLlama,
  getGpuBackend as _getGpuBackend,
} from '../inference';
import { noteInferenceStats } from '../runtime';

export class LlamaCppRuntime implements AIRuntime {
  readonly type: RuntimeType = 'llamacpp';
  readonly capabilities: ReadonlySet<ModelCapability> = new Set<ModelCapability>([
    'chat', 'completion', 'coding', 'reasoning',
  ]);
  private _initialized = false;
  // Phase 86: _loadedModel REMOVED — reads from inference.ts getLoadedModel()

  async init(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;
  }

  async loadModel(model: LocalModelInfo, opts?: ChatOptions): Promise<void> {
    await this.init();
    await _loadModel(model, opts || {});
    // No longer storing locally — inference.ts is the single source of truth
  }

  async unloadModel(): Promise<void> {
    await _unloadModel();
  }

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult> {
    const loadedModel = _getLoadedModel();
    if (!loadedModel) {
      throw new Error('No model loaded. Call loadModel() first.');
    }
    const result = await _chatComplete(loadedModel, messages, opts || {});
    noteInferenceStats({
      tokensPerSecond: result.durationMs > 0 ? (result.tokensGenerated / (result.durationMs / 1000)) : undefined,
      promptTokens: (result as any).promptTokens,
      generatedTokens: ((result as any).completionTokens ?? result.tokensGenerated),
      durationMs: result.durationMs,
      active: false,
    });
    return result;
  }

  async chatStream(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    opts?: ChatOptions
  ): Promise<ChatResult> {
    const loadedModel = _getLoadedModel();
    if (!loadedModel) {
      throw new Error('No model loaded. Call loadModel() first.');
    }
    noteInferenceStats({ active: true });
    try {
      const result = await _chatStream(loadedModel, messages, onChunk, opts || {});
      noteInferenceStats({
        tokensPerSecond: result.durationMs > 0 ? (result.tokensGenerated / (result.durationMs / 1000)) : undefined,
        promptTokens: (result as any).promptTokens,
        generatedTokens: ((result as any).completionTokens ?? result.tokensGenerated),
        durationMs: result.durationMs,
        active: false,
      });
      return result;
    } catch (err) {
      noteInferenceStats({ active: false });
      throw err;
    }
  }

  abort(): void {
    _abortInference();
  }

  getStats(): RuntimeStats {
    const info = _getLoadedModelInfo();
    const loadedModel = _getLoadedModel();
    return {
      type: this.type,
      loaded: !!info,
      loadedModelId: info?.id || null,
      loadedModelName: loadedModel?.name || null,
      ramUsageBytes: undefined,
      vramUsageBytes: undefined,
      gpuBackend: _getGpuBackend(),
      threadsInUse: undefined,
    };
  }

  async shutdown(): Promise<void> {
    await _unloadModel();
    await _shutdownLlama();
    this._initialized = false;
  }
}
