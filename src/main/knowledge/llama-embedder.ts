/**
 * NEX AI — LlamaCpp Embedder (Phase 9 / P9-S2)
 *
 * implements the EXISTING `Embedder` interface backed by a LOCAL GGUF
 * embedding model via node-llama-cpp (already a project dependency —
 * used by the Phase 3 local inference engine). No new deps, no network.
 *
 * Architecture role: OPTIONAL upgrade path. The system default is the
 * offline HashEmbedder; when the user registers an embedding GGUF model
 * (e.g. nomic-embed / bge-small quantized), KnowledgeService swaps this
 * in behind the SAME interface — Agent Core and the retriever are unaware.
 *
 * Loading mirrors inference.ts: node-llama-cpp is ESM-only, so we use an
 * eval-guarded dynamic import exactly like the Phase 3 engine does.
 */

import type { Embedder } from '../ai/knowledge-types';

export interface LlamaEmbedderOptions {
  /** absolute path to the embedding GGUF model */
  modelPath: string;
  /** context window for embedding input (default 2048) */
  contextSize?: number;
  /** expected dimension — auto-detected after first embed if omitted */
  dimensionHint?: number;
}

export class LlamaCppEmbedder implements Embedder {
  readonly maxTokens = 8192;
  private _model: any = null;
  private _ctx: any = null;
  private _dimensionValue: number;
  private readonly opts: Required<Pick<LlamaEmbedderOptions, 'contextSize'>> & LlamaEmbedderOptions;
  private _loading: Promise<void> | null = null;

  constructor(opts: LlamaEmbedderOptions) {
    this.opts = { contextSize: opts.contextSize ?? 2048, ...opts };
    this._dimensionValue = opts.dimensionHint ?? 0;
  }

  get dimension(): number {
    if (this._dimensionValue > 0) return this._dimensionValue;
    throw new Error('LlamaCppEmbedder: dimension unknown until the model is loaded and one embed() runs');
  }

  /** eval-guarded dynamic import (same technique as ai/inference.ts). */
  private async getLlama(): Promise<any> {
    const importSrc = '(async (m) => await import(m))';
    const dynamicImport = (0, eval)(importSrc) as (m: string) => Promise<any>;
    const mod = await dynamicImport('node-llama-cpp');
    return mod.getLlama();
  }

  private async ensureLoaded(): Promise<void> {
    if (this._model) return;
    if (!this._loading) {
      this._loading = (async () => {
        const llama = await this.getLlama();
        this._model = await llama.loadModel({ modelPath: this.opts.modelPath });
        this._ctx = await this._model.createEmbeddingContext({ contextSize: this.opts.contextSize });
      })().catch((err) => {
        this._loading = null;
        throw err;
      });
    }
    await this._loading;
  }

  async embed(text: string): Promise<number[]> {
    await this.ensureLoaded();
    const res = await this._ctx.getEmbeddingFor(text);
    const arr = Array.from(res as Float32Array | number[]);
    if (this._dimensionValue === 0) this._dimensionValue = arr.length;
    return arr;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensureLoaded();
    const out: number[][] = [];
    for (const t of texts) out.push(await this.embed(t));
    return out;
  }

  /** Free model + context (called on shutdown / model switch). */
  async dispose(): Promise<void> {
    try { await this._ctx?.dispose?.(); } catch { /* ignore */ }
    try { await this._model?.dispose?.(); } catch { /* ignore */ }
    this._model = null;
    this._ctx = null;
    this._loading = null;
  }
}

/**
 * Factory helper: build the configured embedder WITHOUT hardcoding the
 * choice. Default = offline HashEmbedder; GGUF path → LlamaCppEmbedder.
 * (KnowledgeService calls this; tests stub it via the interface.)
 */
export async function createEmbedder(embeddingModelPath?: string): Promise<Embedder> {
  if (embeddingModelPath) {
    const { LlamaCppEmbedder: L } = await import('./llama-embedder');
    return new L({ modelPath: embeddingModelPath });
  }
  const { HashEmbedder: H } = await import('./hash-embedder');
  return new H();
}
