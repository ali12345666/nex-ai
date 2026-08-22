/**
 * NEX AI — Local Model Registry
 *
 * Maintains the registry of user-added GGUF models. Each model is identified
 * by a UUID and stores metadata (path, size, context size, etc.).
 *
 * The registry is persisted in <userData>/config.json under the `localModels` key.
 *
 * Note: Model files themselves are NEVER copied or moved — the registry only
 * stores absolute paths. The user is responsible for keeping the files in place.
 * (If a file goes missing, the model is marked as "missing" at load time.)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { loadState, updateState } from '../persistence';

export type ModelCategory =
  | 'general'      // general-purpose chat
  | 'coding'       // code-focused
  | 'reasoning'    // larger reasoning models
  | 'fast'         // small/fast models
  | 'vision'       // image understanding
  | 'embedding'    // text embeddings for RAG
  | 'reranker'     // reranking models for RAG
  | 'speech'       // STT/TTS models
  | 'image';       // image generation

/**
 * Capabilities a model supports. Used by the runtime registry to pick
 * the right model for a given task (chat, vision, embedding, etc.).
 */
export type ModelCapability =
  | 'chat'         // conversational chat
  | 'completion'   // text completion
  | 'coding'       // code-focused
  | 'reasoning'    // chain-of-thought
  | 'vision'       // image input
  | 'embedding'    // vector embeddings
  | 'reranker'     // reranking
  | 'speech-to-text'
  | 'text-to-speech'
  | 'image-generation'
  | 'image-editing';

export interface LocalModelInfo {
  id: string;            // internal uuid
  name: string;          // user-friendly name
  path: string;          // absolute path to .gguf file
  sizeBytes: number;
  contextSize: number;   // default 2048
  gpuLayers: number;     // -1 = auto, 0 = CPU only, >0 = N layers offloaded
  category: ModelCategory;
  addedAt: number;
  lastUsedAt?: number;
  fileExists: boolean;    // verified at load time
  // Hardware requirements (estimated, user-editable)
  minRamBytes?: number;       // minimum RAM to load
  minVramBytes?: number;      // minimum VRAM (0 if CPU-only)
  recommendedThreads?: number;
  // Metadata
  quantization?: string;      // e.g. 'Q4_K_M', 'Q8_0', 'F16'
  architecture?: string;      // e.g. 'qwen2', 'llama', 'gemma'
  parameterCount?: string;    // e.g. '0.5B', '7B', '14B'
  // Capabilities (inferred from category, but user-overridable)
  capabilities?: ModelCapability[];
  // License
  license?: string;
  // Source
  source?: 'huggingface' | 'local' | 'custom';
  sourceUrl?: string;
}

export interface AddModelOptions {
  name?: string;
  contextSize?: number;
  gpuLayers?: number;
  category?: ModelCategory;
  // Phase 7 additions
  quantization?: string;
  architecture?: string;
  parameterCount?: string;
  capabilities?: ModelCapability[];
  license?: string;
  source?: 'huggingface' | 'local' | 'custom';
  sourceUrl?: string;
}

/**
 * Map a model category to its default capabilities.
 * Used when adding a model without explicitly setting capabilities.
 */
export function defaultCapabilitiesForCategory(category: ModelCategory): ModelCapability[] {
  switch (category) {
    case 'coding':    return ['chat', 'completion', 'coding'];
    case 'reasoning': return ['chat', 'completion', 'reasoning'];
    case 'fast':      return ['chat', 'completion'];
    case 'vision':   return ['chat', 'vision'];
    case 'embedding': return ['embedding'];
    case 'reranker':  return ['reranker'];
    case 'speech':    return ['speech-to-text', 'text-to-speech'];
    case 'image':     return ['image-generation'];
    case 'general':
    default:         return ['chat', 'completion'];
  }
}

/**
 * Get all registered models. Verifies that each .gguf file still exists.
 */
export function listModels(): LocalModelInfo[] {
  const state = loadState();
  const models = state.localModels || [];
  return models.map((m): LocalModelInfo => ({
    ...m,
    category: ((m.category as string) || 'general') as ModelCategory,
    capabilities: ((m.capabilities as any) || defaultCapabilitiesForCategory(((m.category as string) || 'general') as ModelCategory)) as ModelCapability[],
    source: ((m.source as string) || 'local') as 'huggingface' | 'local' | 'custom',
    fileExists: fs.existsSync(m.path),
  }));
}

/**
 * Add a .gguf file to the registry.
 * Returns the new model entry, or throws if the file doesn't exist or
 * isn't a .gguf file.
 */
export function addModel(filePath: string, opts: AddModelOptions = {}): LocalModelInfo {
  if (!filePath) throw new Error('File path is required');
  if (!filePath.toLowerCase().endsWith('.gguf')) {
    throw new Error('Model file must be a .gguf file');
  }
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }
  const stat = fs.statSync(absPath);

  // Derive name from filename if not provided
  const name = opts.name || path.basename(absPath, '.gguf');

  // Check if same path is already registered
  const existing = listModels().find((m) => m.path === absPath);
  if (existing) {
    throw new Error(`Model already registered as "${existing.name}"`);
  }

  const model: LocalModelInfo = {
    id: crypto.randomUUID(),
    name,
    path: absPath,
    sizeBytes: stat.size,
    contextSize: opts.contextSize ?? 2048,
    gpuLayers: opts.gpuLayers ?? -1,  // auto
    category: opts.category || 'general',
    addedAt: Date.now(),
    fileExists: true,
    // New fields (all optional)
    quantization: opts.quantization,
    architecture: opts.architecture,
    parameterCount: opts.parameterCount,
    capabilities: opts.capabilities || defaultCapabilitiesForCategory(opts.category || 'general'),
    license: opts.license,
    source: opts.source || 'local',
    sourceUrl: opts.sourceUrl,
  };

  const state = loadState();
  const models = state.localModels || [];
  models.push(model);
  updateState({ localModels: models });
  return model;
}

/**
 * Remove a model from the registry (does NOT delete the file on disk).
 */
export function removeModel(id: string): boolean {
  const state = loadState();
  const models = state.localModels || [];
  const idx = models.findIndex((m) => m.id === id);
  if (idx === -1) return false;
  models.splice(idx, 1);
  updateState({ localModels: models });
  return true;
}

/**
 * Update a model's metadata (name, contextSize, gpuLayers, category).
 */
export function updateModel(id: string, patch: Partial<Omit<LocalModelInfo, 'id' | 'path' | 'sizeBytes' | 'addedAt'>>): LocalModelInfo | null {
  const state = loadState();
  const models = state.localModels || [];
  const idx = models.findIndex((m) => m.id === id);
  if (idx === -1) return null;
  models[idx] = { ...models[idx], ...patch } as any;
  updateState({ localModels: models });
  return { ...models[idx], fileExists: fs.existsSync(models[idx].path) } as LocalModelInfo;
}

/**
 * Mark a model as last-used (called when inference starts).
 */
export function touchModel(id: string): void {
  const state = loadState();
  const models = state.localModels || [];
  const idx = models.findIndex((m) => m.id === id);
  if (idx === -1) return;
  models[idx].lastUsedAt = Date.now();
  updateState({ localModels: models });
}

/**
 * Get a single model by id.
 */
export function getModel(id: string): LocalModelInfo | null {
  const models = listModels();
  return models.find((m) => m.id === id) || null;
}

/**
 * Get the "default" model — the most recently used, or the first one.
 * Returns null if no models are registered.
 */
export function getDefaultModel(): LocalModelInfo | null {
  const models = listModels().filter((m) => m.fileExists);
  if (models.length === 0) return null;
  // Sort: lastUsedAt desc, then addedAt desc
  models.sort((a, b) => {
    const aT = a.lastUsedAt || a.addedAt;
    const bT = b.lastUsedAt || b.addedAt;
    return bT - aT;
  });
  return models[0];
}
