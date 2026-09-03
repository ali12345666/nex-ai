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
// Phase 39: versioning, hash, backup, portable path resolution
import {
  backupModelRegistry,
  resolveModelPath,
  normalizeModelPathForStorage,
  CURRENT_MODEL_SCHEMA_VERSION,
  type ModelIntegrityInfo,
} from './model-versioning';

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
  path: string;          // path to .gguf file (may be relative in portable mode)
  sizeBytes: number;
  contextSize: number;   // default 2048
  gpuLayers: number;     // -1 = auto, 0 = CPU only, >0 = N layers offloaded
  category: ModelCategory;
  addedAt: number;
  lastUsedAt?: number;
  fileExists: boolean;    // verified at load time (after path resolution)
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
  // Phase 39: integrity + versioning fields
  schemaVersion?: number;             // model registry schema version
  hash?: string;                      // SHA-256 of the .gguf file (hex)
  hashAlgorithm?: 'sha256';
  verifiedAt?: number;                // when the hash was last verified
  integrityStatus?: 'verified' | 'mismatch' | 'pending' | 'unknown';
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
 * Get all registered models. Verifies that each .gguf file still exists
 * (after resolving portable paths). Phase 39: resolves model paths for
 * portable mode compatibility.
 */
export function listModels(): LocalModelInfo[] {
  const state = loadState();
  const models = state.localModels || [];
  return models.map((m): LocalModelInfo => {
    const resolvedPath = resolveModelPath(m.path);
    return {
      ...m,
      // Phase 39: store the RESOLVED path so callers get an absolute path.
      // The ORIGINAL (possibly relative) path is preserved in the registry.
      path: resolvedPath,
      category: ((m.category as string) || 'general') as ModelCategory,
      capabilities: ((m.capabilities as any) || defaultCapabilitiesForCategory(((m.category as string) || 'general') as ModelCategory)) as ModelCapability[],
      source: ((m.source as string) || 'local') as 'huggingface' | 'local' | 'custom',
      fileExists: fs.existsSync(resolvedPath),
      // Phase 39: ensure integrity fields have defaults for v1 models
      schemaVersion: m.schemaVersion || CURRENT_MODEL_SCHEMA_VERSION,
      hashAlgorithm: (m.hashAlgorithm || 'sha256') as 'sha256',
      integrityStatus: (m.integrityStatus || 'unknown') as 'verified' | 'mismatch' | 'pending' | 'unknown',
    };
  });
}

/**
 * Add a .gguf file to the registry.
 * Returns the new model entry, or throws if the file doesn't exist or
 * isn't a .gguf file.
 *
 * Phase 39:
 *   - Creates a backup of the registry BEFORE the mutation (rollback safety).
 *   - Stores a portable-friendly path (relative if under app dir).
 *   - Sets schemaVersion = 2 and integrityStatus = 'pending' (hash computed
 *     async by a separate verify call).
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

  // Phase 78: Check if same path is already registered.
  // Instead of throwing an error, UPDATE the existing entry (upsert).
  // This fixes the "download completes to 100% but fails at install" bug
  // where the scanner already registered the file before addModel was called.
  const existing = listModels().find((m) => {
    const resolvedMPath = path.resolve(m.path);
    const resolvedAbsPath = path.resolve(absPath);
    // Compare both resolved paths and basename to handle portable path normalization
    return resolvedMPath === resolvedAbsPath ||
           m.path === absPath ||
           path.basename(m.path) === path.basename(absPath);
  });

  if (existing) {
    console.log(`[MODEL_REGISTRY] Model already registered as "${existing.name}" — updating metadata`);
    // Update the existing entry with new metadata
    const updated = updateModel(existing.id, {
      name,  // Update name in case it changed
      quantization: opts.quantization,
      architecture: opts.architecture,
      parameterCount: opts.parameterCount,
      capabilities: opts.capabilities || defaultCapabilitiesForCategory(opts.category || 'general'),
      source: opts.source || 'local',
      sourceUrl: opts.sourceUrl,
      sizeBytes: stat.size,
    });
    if (updated) return updated;
    // If update failed for some reason, return the existing entry
    return { ...existing, fileExists: true };
  }

  // Phase 39: backup before mutation
  backupModelRegistry();

  const model: LocalModelInfo = {
    id: crypto.randomUUID(),
    name,
    // Phase 39: store portable-friendly path
    path: normalizeModelPathForStorage(absPath),
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
    // Phase 39: integrity fields
    schemaVersion: CURRENT_MODEL_SCHEMA_VERSION,
    hashAlgorithm: 'sha256',
    integrityStatus: 'pending', // hash will be computed async by verify
  };

  const state = loadState();
  const models = state.localModels || [];
  models.push(model);
  updateState({ localModels: models });
  return model;
}

/**
 * Remove a model from the registry (does NOT delete the file on disk).
 * Phase 39: creates a backup before removal (rollback safety).
 */
export function removeModel(id: string): boolean {
  const state = loadState();
  const models = state.localModels || [];
  const idx = models.findIndex((m) => m.id === id);
  if (idx === -1) return false;
  // Phase 39: backup before mutation
  backupModelRegistry();
  models.splice(idx, 1);
  updateState({ localModels: models });
  return true;
}

/**
 * Update a model's metadata (name, contextSize, gpuLayers, category).
 * Phase 39: creates a backup before update (rollback safety).
 * Phase 78: allow sizeBytes update (for upsert after re-download).
 */
export function updateModel(id: string, patch: Partial<Omit<LocalModelInfo, 'id' | 'path' | 'addedAt'>>): LocalModelInfo | null {
  const state = loadState();
  const models = state.localModels || [];
  const idx = models.findIndex((m) => m.id === id);
  if (idx === -1) return null;
  // Phase 39: backup before mutation
  backupModelRegistry();
  models[idx] = { ...models[idx], ...patch } as any;
  updateState({ localModels: models });
  const resolved = resolveModelPath(models[idx].path);
  return { ...models[idx], path: resolved, fileExists: fs.existsSync(resolved) } as LocalModelInfo;
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

// ─── Phase 73: Filesystem Scanner ──────────────────────────────────────────────

/**
 * Recursively scan a directory for .gguf files.
 * Returns absolute paths to all .gguf files found.
 */
function findGgufFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden directories (like .downloads)
        if (entry.name.startsWith('.')) continue;
        results.push(...findGgufFiles(fullPath));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gguf')) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory read error — return what we have
  }
  return results;
}

export interface ScanResult {
  scanned: number;
  registered: number;
  alreadyRegistered: number;
  skipped: number;
  newModels: LocalModelInfo[];
  errors: string[];
}

/**
 * Phase 73: Scan the models directory for .gguf files and auto-register
 * any that aren't in the registry yet.
 *
 * Scans:
 *   <userData>/models/        (recursive — includes llm/, vision/, etc.)
 *
 * For each .gguf file found:
 *   1. Check if it's already registered (by path)
 *   2. If not, validate GGUF magic bytes
 *   3. If valid, register in the model registry
 *   4. If invalid, skip (don't delete — user may want to inspect)
 *
 * Returns a summary of what was scanned and registered.
 */
export function scanAndRegisterModels(modelsDir: string): ScanResult {
  const result: ScanResult = {
    scanned: 0,
    registered: 0,
    alreadyRegistered: 0,
    skipped: 0,
    newModels: [],
    errors: [],
  };

  console.log(`[MODEL_SCAN] Scanning: ${modelsDir}`);

  const ggufFiles = findGgufFiles(modelsDir);
  result.scanned = ggufFiles.length;
  console.log(`[MODEL_SCAN] Found ${ggufFiles.length} .gguf files`);

  const existing = listModels();
  const existingPaths = new Set(existing.map(m => path.resolve(m.path)));

  for (const filePath of ggufFiles) {
    const absPath = path.resolve(filePath);

    // Skip if already registered
    if (existingPaths.has(absPath)) {
      result.alreadyRegistered++;
      continue;
    }

    try {
      // Validate GGUF magic bytes
      const fd = fs.openSync(absPath, 'r');
      const buf = Buffer.alloc(4);
      fs.readSync(fd, buf, 0, 4, 0);
      fs.closeSync(fd);
      const magic = buf.toString('ascii');

      if (magic !== 'GGUF') {
        console.log(`[MODEL_SCAN] Skipping (invalid magic): ${absPath}`);
        result.skipped++;
        result.errors.push(`Invalid GGUF magic: ${path.basename(absPath)}`);
        continue;
      }

      // Get file size
      const stat = fs.statSync(absPath);

      // Derive name from filename
      const name = path.basename(absPath, '.gguf');

      // Register the model
      const model: LocalModelInfo = {
        id: crypto.randomUUID(),
        name,
        path: normalizeModelPathForStorage(absPath),
        sizeBytes: stat.size,
        contextSize: 2048,
        gpuLayers: -1,
        category: 'general',
        addedAt: Date.now(),
        fileExists: true,
        capabilities: ['chat', 'completion'],
        source: 'local',
        schemaVersion: CURRENT_MODEL_SCHEMA_VERSION,
        hashAlgorithm: 'sha256',
        integrityStatus: 'pending',
      };

      backupModelRegistry();
      const state = loadState();
      const models = state.localModels || [];
      models.push(model);
      updateState({ localModels: models });

      result.registered++;
      result.newModels.push(model);
      console.log(`[MODEL_SCAN] Registered: ${name} — ${stat.size} bytes — ${model.id}`);
    } catch (err: any) {
      console.log(`[MODEL_SCAN] Error registering ${absPath}: ${err?.message}`);
      result.skipped++;
      result.errors.push(`Error: ${path.basename(absPath)} — ${err?.message || err}`);
    }
  }

  console.log(`[MODEL_SCAN] Done — scanned: ${result.scanned}, registered: ${result.registered}, already: ${result.alreadyRegistered}, skipped: ${result.skipped}`);
  return result;
}
