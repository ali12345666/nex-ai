/**
 * NEX AI — Configured Embedder Resolution (Phase 10 / P10-E)
 *
 * Single source of truth for "which embedder does knowledge use right now":
 *   settings.embeddingModelId === null  → HashEmbedder (offline default)
 *   settings.embeddingModelId === <id>  → LlamaCppEmbedder over that GGUF
 *                                         (from the existing Model Registry)
 *
 * The embedding model is INDEPENDENT from the chat model
 * (activeLocalModelId) — selecting one never changes the other.
 *
 * Pure-ish: persistence/registry accessed via injectable getters for tests;
 * real wiring uses dynamic imports (main.ts stays decoupled).
 */

import type { Embedder } from '../ai/knowledge-types';
import { HashEmbedder } from './hash-embedder';
import { LlamaCppEmbedder } from './llama-embedder';

export interface EmbedderResolution {
  embedder: Embedder;
  backend: 'hash' | 'llamacpp';
  /** set when a model id was configured but unusable (fallback reason) */
  fallbackReason?: string;
  modelId?: string;
  modelPath?: string;
}

export interface EmbedderConfigSource {
  /** configured embedding model id (null = hash default) */
  embeddingModelId(): string | null | undefined;
  /** registry lookup: returns {path, fileExists, category} or null */
  getModel(id: string): { path: string; fileExists: boolean; category: string } | null;
}

/** Resolve the configured embedder (never throws; falls back to hash). */
export function resolveConfiguredEmbedder(src: EmbedderConfigSource): EmbedderResolution {
  const id = src.embeddingModelId();
  if (!id) {
    return { embedder: new HashEmbedder(), backend: 'hash' };
  }
  const model = src.getModel(id);
  if (!model) {
    return {
      embedder: new HashEmbedder(),
      backend: 'hash',
      fallbackReason: `Configured embedding model "${id}" not found in registry — using offline hash embedder`,
    };
  }
  if (!model.fileExists) {
    return {
      embedder: new HashEmbedder(),
      backend: 'hash',
      fallbackReason: `Embedding model file missing on disk — using offline hash embedder`,
      modelId: id,
    };
  }
  return {
    embedder: new LlamaCppEmbedder({ modelPath: model.path }),
    backend: 'llamacpp',
    modelId: id,
    modelPath: model.path,
  };
}

/**
 * Whether switching embedders invalidates stored vectors: hash=256d vs a
 * GGUF embedder (any other dimension) → stored embeddings are incompatible
 * with new queries → REBUILD REQUIRED before retrieval is meaningful.
 */
export function needsRebuildAfterSwitch(oldBackend: string, newBackend: string): boolean {
  return oldBackend !== newBackend;
}

/**
 * Default wiring used by main.ts: reads real persistence + registry via
 * dynamic imports (electron-safe, no static coupling).
 */
export async function createConfiguredEmbedder(): Promise<EmbedderResolution> {
  const { loadState } = await import('../persistence');
  const { getModel } = await import('../ai/model-registry');
  return resolveConfiguredEmbedder({
    embeddingModelId: () => (loadState().settings as any)?.embeddingModelId ?? null,
    getModel: (id) => {
      const m = getModel(id);
      return m ? { path: m.path, fileExists: m.fileExists, category: m.category } : null;
    },
  });
}
