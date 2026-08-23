/**
 * OnlineRuntime — AIRuntime implementation backed by an online provider
 * (GLM 5.3 by default, Phase 8 / P8-B).
 *
 * ARCHITECTURE (critical): this runtime is just another AIRuntime. Agent Core
 * depends only on the AIRuntime interface — it never learns that "online"
 * means GLM, OpenAI, or anything else. The provider details are supplied by
 * an injected ChatTransport (see ./online-transport.ts), which routes through
 * the SAME provider abstraction (routeChat) used by ChatPanel.
 *
 *   Agent Core
 *      ↓ AIRuntime (interface)
 *   OnlineRuntime ──(injected transport)──▶ provider.routeChat ──▶ GLM 5.3 / OpenAI / Claude
 *
 * The transport is injectable so unit tests can pass a fake with zero
 * network, zero electron, zero secrets.
 */

import type {
  AIRuntime, ChatMessage, ChatOptions, ChatResult,
  StreamChunk, RuntimeStats, RuntimeType,
} from '../runtime';
import type { LocalModelInfo, ModelCapability } from '../model-registry';

/**
 * A transport performs one full (non-streamed) chat round-trip.
 * Implementations: online-transport.ts (real), tests (fake).
 */
export type OnlineChatTransport = (
  messages: ChatMessage[],
  opts: ChatOptions
) => Promise<ChatResult>;

export interface OnlineRuntimeOptions {
  /** Human-facing model name reported in results/stats (e.g. 'GLM 5.3'). */
  modelName: string;
  /** Stable id for the model (e.g. 'glm-5.3'). */
  modelId: string;
  /** Capabilities advertised by the online model. */
  capabilities?: ModelCapability[];
  /** The chat round-trip implementation. */
  transport: OnlineChatTransport;
}

export class OnlineRuntime implements AIRuntime {
  readonly type: RuntimeType = 'online';
  readonly capabilities: ReadonlySet<ModelCapability>;
  private _opts: OnlineRuntimeOptions;
  private _loaded = false;
  private _aborted = false;
  private _inFlight: Promise<ChatResult> | null = null;

  constructor(opts: OnlineRuntimeOptions) {
    this._opts = opts;
    this.capabilities = new Set<ModelCapability>(
      opts.capabilities || ['chat', 'completion', 'coding', 'reasoning']
    );
  }

  async init(): Promise<void> {
    // Nothing to initialize — the transport owns its own lifecycle.
  }

  /**
   * "Loading" an online model is a no-op bookkeeping step: we accept the
   * LocalModelInfo-shaped argument for interface compatibility (the registry
   * may hand us a synthetic entry) but never touch a GGUF file.
   */
  async loadModel(_model: LocalModelInfo, _opts?: ChatOptions): Promise<void> {
    this._loaded = true;
    this._aborted = false;
  }

  async unloadModel(): Promise<void> {
    this._loaded = false;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    if (!this._loaded) {
      throw new Error('OnlineRuntime: no model loaded. Call loadModel() first.');
    }
    this._aborted = false;
    this._inFlight = this._opts.transport(messages, opts);
    try {
      const result = await this._inFlight;
      return {
        ...result,
        stopped: this._aborted ? false : result.stopped,
        finishReason: this._aborted ? 'aborted' : result.finishReason,
      };
    } finally {
      this._inFlight = null;
    }
  }

  /**
   * Streamed chat. The current transport contract is request→full-response,
   * so streaming is emulated: the full result is awaited, then delivered as
   * line-granular chunks followed by a final done chunk. This preserves the
   * Agent-facing streaming API today and allows a true SSE transport later
   * without any caller changes.
   */
  async chatStream(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    opts: ChatOptions = {}
  ): Promise<ChatResult> {
    const result = await this.chat(messages, opts);
    const lines = result.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (this._aborted) break;
      const piece = i < lines.length - 1 ? lines[i] + '\n' : lines[i];
      if (piece) onChunk({ content: piece, done: false });
    }
    onChunk({ content: '', done: true, error: this._aborted ? 'aborted' : undefined });
    return result;
  }

  abort(): void {
    this._aborted = true;
    // The transport itself is a single HTTP round-trip; flag-based abort is
    // the best we can do without SSE. In-flight result is still returned but
    // marked aborted.
  }

  getStats(): RuntimeStats {
    return {
      type: this.type,
      loaded: this._loaded,
      loadedModelId: this._loaded ? this._opts.modelId : null,
      loadedModelName: this._loaded ? this._opts.modelName : null,
      ramUsageBytes: 0,
      vramUsageBytes: 0,
      gpuBackend: 'none',
      threadsInUse: 0,
    };
  }

  async shutdown(): Promise<void> {
    this._loaded = false;
    this._aborted = false;
  }
}
