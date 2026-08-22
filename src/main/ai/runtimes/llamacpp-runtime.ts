/**
 * LlamaCppRuntime — AIRuntime implementation backed by node-llama-cpp.
 *
 * This is a thin wrapper around the existing inference.ts module. The
 * wrapper exists so that Agent Core and Tools can depend on the AIRuntime
 * interface instead of importing inference.ts directly.
 *
 * Future runtimes (ONNX, MLC, etc.) will implement the same interface.
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
  shutdownLlama as _shutdownLlama,
} from '../inference';

export class LlamaCppRuntime implements AIRuntime {
  readonly type: RuntimeType = 'llamacpp';
  readonly capabilities: ReadonlySet<ModelCapability> = new Set<ModelCapability>([
    'chat', 'completion', 'coding', 'reasoning',
  ]);
  private _initialized = false;
  private _loadedModel: LocalModelInfo | null = null;

  async init(): Promise<void> {
    if (this._initialized) return;
    // Lazy: actual llama.cpp init happens on first loadModel
    this._initialized = true;
  }

  async loadModel(model: LocalModelInfo, opts?: ChatOptions): Promise<void> {
    await this.init();
    await _loadModel(model, opts || {});
    this._loadedModel = model;
  }

  async unloadModel(): Promise<void> {
    await _unloadModel();
    this._loadedModel = null;
  }

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult> {
    if (!this._loadedModel) {
      throw new Error('No model loaded. Call loadModel() first.');
    }
    return _chatComplete(this._loadedModel, messages, opts || {});
  }

  async chatStream(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    opts?: ChatOptions
  ): Promise<ChatResult> {
    if (!this._loadedModel) {
      throw new Error('No model loaded. Call loadModel() first.');
    }
    return _chatStream(this._loadedModel, messages, onChunk, opts || {});
  }

  abort(): void {
    _abortInference();
  }

  getStats(): RuntimeStats {
    const info = _getLoadedModelInfo();
    return {
      type: this.type,
      loaded: !!info,
      loadedModelId: info?.id || null,
      loadedModelName: this._loadedModel?.name || null,
      // RAM/VRAM stats not exposed by node-llama-cpp v3 by default
      ramUsageBytes: undefined,
      vramUsageBytes: undefined,
      gpuBackend: 'cpu', // will be 'vulkan' / 'cuda' when GPU works
      threadsInUse: undefined,
    };
  }

  async shutdown(): Promise<void> {
    await _unloadModel();
    await _shutdownLlama();
    this._initialized = false;
    this._loadedModel = null;
  }
}
