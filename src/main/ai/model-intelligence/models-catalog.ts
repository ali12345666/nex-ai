/**
 * NEX AI — Models Catalog (Phase 45)
 *
 * A curated database of known local models with benchmark scores.
 * Used by the ModelAdvisor to recommend better models.
 *
 * This is NOT a download manifest — it's metadata for recommendation.
 * Actual downloads go through Phase 44 SecureDownloader + PermissionGate.
 */

export type ModelCategory = 'chat' | 'coding' | 'reasoning' | 'vision' | 'voice' | 'embedding';
export type GpuSupport = 'cuda' | 'metal' | 'vulkan' | 'cpu-only' | 'any';

export interface CatalogModelEntry {
  id: string;
  name: string;
  provider: string;           // 'qwen' | 'llama' | 'mistral' | 'gemma' | 'phi' | 'llava' | 'whisper' | 'piper'
  category: ModelCategory;
  capabilities: string[];     // 'chat' | 'coding' | 'reasoning' | 'vision' | 'embedding'
  sizeGB: number;
  requiredRAM: number;         // GB
  requiredVRAM: number;        // GB (0 = CPU only)
  gpuSupport: GpuSupport;
  quantization: string;       // 'Q4_K_M' | 'Q5_K_M' | 'Q8_0' | 'F16'
  parameterCount: string;     // '0.5B' | '7B' | '14B' | '32B'
  contextSize: number;         // tokens
  // Benchmark scores (0-100, higher = better)
  qualityScore: number;        // general quality
  speedScore: number;          // inference speed
  codingScore: number;         // code generation
  reasoningScore: number;      // reasoning / chain-of-thought
  visionScore: number;         // image understanding (0 if not vision)
  voiceScore: number;          // STT/TTS quality (0 if not voice)
  recommendedFor: string[];   // ['coding', 'general-chat', 'reasoning']
  downloadInfo?: {
    url: string;
    expectedHash: string;
    filename: string;
  };
}

export const MODELS_CATALOG: CatalogModelEntry[] = [
  // ── Qwen Family ──
  {
    id: 'qwen2.5-0.5b-q4',
    name: 'Qwen2.5 0.5B Q4',
    provider: 'qwen',
    category: 'chat',
    capabilities: ['chat'],
    sizeGB: 0.4,
    requiredRAM: 1,
    requiredVRAM: 0,
    gpuSupport: 'cpu-only',
    quantization: 'Q4_K_M',
    parameterCount: '0.5B',
    contextSize: 2048,
    qualityScore: 35,
    speedScore: 95,
    codingScore: 20,
    reasoningScore: 25,
    visionScore: 0,
    voiceScore: 0,
    recommendedFor: ['fast-chat', 'lightweight'],
  },
  {
    id: 'qwen2.5-7b-q4',
    name: 'Qwen2.5 7B Q4',
    provider: 'qwen',
    category: 'chat',
    capabilities: ['chat', 'coding'],
    sizeGB: 4.1,
    requiredRAM: 8,
    requiredVRAM: 5,
    gpuSupport: 'any',
    quantization: 'Q4_K_M',
    parameterCount: '7B',
    contextSize: 4096,
    qualityScore: 65,
    speedScore: 70,
    codingScore: 60,
    reasoningScore: 55,
    visionScore: 0,
    voiceScore: 0,
    recommendedFor: ['general-chat', 'coding'],
  },
  {
    id: 'qwen2.5-coder-7b-q5',
    name: 'Qwen2.5 Coder 7B Q5',
    provider: 'qwen',
    category: 'coding',
    capabilities: ['chat', 'coding'],
    sizeGB: 5.2,
    requiredRAM: 10,
    requiredVRAM: 6,
    gpuSupport: 'any',
    quantization: 'Q5_K_M',
    parameterCount: '7B',
    contextSize: 8192,
    qualityScore: 68,
    speedScore: 65,
    codingScore: 80,
    reasoningScore: 58,
    visionScore: 0,
    voiceScore: 0,
    recommendedFor: ['coding', 'code-review'],
  },
  {
    id: 'qwen2.5-coder-14b-q5',
    name: 'Qwen2.5 Coder 14B Q5',
    provider: 'qwen',
    category: 'coding',
    capabilities: ['chat', 'coding', 'reasoning'],
    sizeGB: 9.8,
    requiredRAM: 16,
    requiredVRAM: 10,
    gpuSupport: 'any',
    quantization: 'Q5_K_M',
    parameterCount: '14B',
    contextSize: 8192,
    qualityScore: 78,
    speedScore: 50,
    codingScore: 88,
    reasoningScore: 72,
    visionScore: 0,
    voiceScore: 0,
    recommendedFor: ['coding', 'complex-coding', 'architecture'],
  },
  {
    id: 'qwen2.5-32b-q4',
    name: 'Qwen2.5 32B Q4',
    provider: 'qwen',
    category: 'reasoning',
    capabilities: ['chat', 'reasoning'],
    sizeGB: 18.5,
    requiredRAM: 32,
    requiredVRAM: 20,
    gpuSupport: 'any',
    quantization: 'Q4_K_M',
    parameterCount: '32B',
    contextSize: 8192,
    qualityScore: 85,
    speedScore: 35,
    codingScore: 75,
    reasoningScore: 90,
    visionScore: 0,
    voiceScore: 0,
    recommendedFor: ['reasoning', 'complex-analysis'],
  },

  // ── Llama Family ──
  {
    id: 'llama3.2-3b-q4',
    name: 'Llama 3.2 3B Q4',
    provider: 'llama',
    category: 'chat',
    capabilities: ['chat'],
    sizeGB: 2.0,
    requiredRAM: 4,
    requiredVRAM: 3,
    gpuSupport: 'any',
    quantization: 'Q4_K_M',
    parameterCount: '3B',
    contextSize: 4096,
    qualityScore: 55,
    speedScore: 80,
    codingScore: 45,
    reasoningScore: 48,
    visionScore: 0,
    voiceScore: 0,
    recommendedFor: ['general-chat', 'fast-chat'],
  },
  {
    id: 'llama3.1-8b-q4',
    name: 'Llama 3.1 8B Q4',
    provider: 'llama',
    category: 'chat',
    capabilities: ['chat', 'reasoning'],
    sizeGB: 4.7,
    requiredRAM: 10,
    requiredVRAM: 6,
    gpuSupport: 'any',
    quantization: 'Q4_K_M',
    parameterCount: '8B',
    contextSize: 8192,
    qualityScore: 70,
    speedScore: 65,
    codingScore: 62,
    reasoningScore: 68,
    visionScore: 0,
    voiceScore: 0,
    recommendedFor: ['general-chat', 'reasoning'],
  },

  // ── Vision Models ──
  {
    id: 'llava-7b-q4',
    name: 'LLaVA 7B Q4',
    provider: 'llava',
    category: 'vision',
    capabilities: ['chat', 'vision'],
    sizeGB: 4.5,
    requiredRAM: 10,
    requiredVRAM: 6,
    gpuSupport: 'any',
    quantization: 'Q4_K_M',
    parameterCount: '7B',
    contextSize: 4096,
    qualityScore: 60,
    speedScore: 55,
    codingScore: 30,
    reasoningScore: 45,
    visionScore: 75,
    voiceScore: 0,
    recommendedFor: ['vision', 'image-analysis', 'ocr'],
  },
  {
    id: 'llava-13b-q5',
    name: 'LLaVA 13B Q5',
    provider: 'llava',
    category: 'vision',
    capabilities: ['chat', 'vision', 'reasoning'],
    sizeGB: 9.2,
    requiredRAM: 16,
    requiredVRAM: 10,
    gpuSupport: 'any',
    quantization: 'Q5_K_M',
    parameterCount: '13B',
    contextSize: 4096,
    qualityScore: 72,
    speedScore: 40,
    codingScore: 35,
    reasoningScore: 60,
    visionScore: 85,
    voiceScore: 0,
    recommendedFor: ['vision', 'complex-image-analysis', 'screenshot-analysis'],
  },

  // ── Voice Models (Whisper) ──
  {
    id: 'whisper-base-en',
    name: 'Whisper Base (English)',
    provider: 'whisper',
    category: 'voice',
    capabilities: ['speech-to-text'],
    sizeGB: 0.14,
    requiredRAM: 1,
    requiredVRAM: 0,
    gpuSupport: 'cpu-only',
    quantization: 'F16',
    parameterCount: '0.07B',
    contextSize: 0,
    qualityScore: 50,
    speedScore: 85,
    codingScore: 0,
    reasoningScore: 0,
    visionScore: 0,
    voiceScore: 60,
    recommendedFor: ['stt-english', 'fast-transcription'],
  },
  {
    id: 'whisper-medium-q5',
    name: 'Whisper Medium Q5 (Multilingual)',
    provider: 'whisper',
    category: 'voice',
    capabilities: ['speech-to-text'],
    sizeGB: 0.8,
    requiredRAM: 2,
    requiredVRAM: 1,
    gpuSupport: 'any',
    quantization: 'Q5_K_M',
    parameterCount: '0.77B',
    contextSize: 0,
    qualityScore: 70,
    speedScore: 60,
    codingScore: 0,
    reasoningScore: 0,
    visionScore: 0,
    voiceScore: 80,
    recommendedFor: ['stt-multilingual', 'high-quality-transcription'],
  },

  // ── Embedding Models ──
  {
    id: 'nomic-embed-137m',
    name: 'Nomic Embed 137M',
    provider: 'nomic',
    category: 'embedding',
    capabilities: ['embedding'],
    sizeGB: 0.27,
    requiredRAM: 1,
    requiredVRAM: 0,
    gpuSupport: 'cpu-only',
    quantization: 'F16',
    parameterCount: '0.137B',
    contextSize: 2048,
    qualityScore: 65,
    speedScore: 90,
    codingScore: 0,
    reasoningScore: 0,
    visionScore: 0,
    voiceScore: 0,
    recommendedFor: ['rag-embeddings', 'semantic-search'],
  },

  // ── Phi Family ──
  {
    id: 'phi3-mini-3.8b-q4',
    name: 'Phi-3 Mini 3.8B Q4',
    provider: 'phi',
    category: 'chat',
    capabilities: ['chat', 'reasoning'],
    sizeGB: 2.3,
    requiredRAM: 4,
    requiredVRAM: 3,
    gpuSupport: 'any',
    quantization: 'Q4_K_M',
    parameterCount: '3.8B',
    contextSize: 4096,
    qualityScore: 60,
    speedScore: 75,
    codingScore: 50,
    reasoningScore: 62,
    visionScore: 0,
    voiceScore: 0,
    recommendedFor: ['general-chat', 'reasoning', 'edge'],
  },
];

/**
 * Get all catalog entries.
 */
export function getCatalog(): CatalogModelEntry[] {
  return MODELS_CATALOG;
}

/**
 * Get catalog entries by category.
 */
export function getCatalogByCategory(category: ModelCategory): CatalogModelEntry[] {
  return MODELS_CATALOG.filter((m) => m.category === category);
}

/**
 * Get a catalog entry by ID.
 */
export function getCatalogEntry(id: string): CatalogModelEntry | null {
  return MODELS_CATALOG.find((m) => m.id === id) || null;
}

/**
 * Find catalog entries that match a provider (e.g. 'qwen').
 */
export function getCatalogByProvider(provider: string): CatalogModelEntry[] {
  return MODELS_CATALOG.filter((m) => m.provider === provider.toLowerCase());
}
