/**
 * NEX AI — Component Catalog (Phase 46)
 *
 * Recommended components for the runtime setup center.
 * Each entry has download source, size, checksum, and hardware requirements.
 */

export type ComponentType = 'llm' | 'voice-stt' | 'voice-tts' | 'vision' | 'tool';

export interface CatalogComponent {
  id: string;
  name: string;
  type: ComponentType;
  purpose: string;
  purposeFa: string; // Persian description
  sizeBytes: number;
  downloadUrl: string;
  checksum: string; // SHA-256
  requiredRAM: number; // GB
  requiredVRAM: number; // GB (0 = CPU only)
  recommendedRAM: number; // GB
  recommendedVRAM: number; // GB
  targetDir: string;
  filename: string;
  quantization?: string;
  parameterCount?: string;
  isEssential: boolean; // true = required for basic operation
}

export const COMPONENT_CATALOG: CatalogComponent[] = [
  // ── LLM Models ──
  {
    id: 'qwen2.5-coder-7b-q5',
    name: 'Qwen2.5 Coder 7B Q5',
    type: 'llm',
    purpose: 'Code generation, debugging, refactoring',
    purposeFa: 'تولید کد، دیباگ، بازسازی کد',
    sizeBytes: 5.2 * 1e9,
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q5_k_m.gguf',
    checksum: 'pending',
    requiredRAM: 10,
    requiredVRAM: 6,
    recommendedRAM: 16,
    recommendedVRAM: 8,
    targetDir: 'models/llm',
    filename: 'qwen2.5-coder-7b-q5_k_m.gguf',
    quantization: 'Q5_K_M',
    parameterCount: '7B',
    isEssential: true,
  },
  {
    id: 'qwen2.5-7b-q4',
    name: 'Qwen2.5 7B Q4',
    type: 'llm',
    purpose: 'General chat, coding, reasoning',
    purposeFa: 'گفتگوی عمومی، کدنویسی، استدلال',
    sizeBytes: 4.1 * 1e9,
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf',
    checksum: 'pending',
    requiredRAM: 8,
    requiredVRAM: 5,
    recommendedRAM: 16,
    recommendedVRAM: 8,
    targetDir: 'models/llm',
    filename: 'qwen2.5-7b-q4_k_m.gguf',
    quantization: 'Q4_K_M',
    parameterCount: '7B',
    isEssential: true,
  },
  {
    id: 'qwen2.5-0.5b-q4',
    name: 'Qwen2.5 0.5B Q4',
    type: 'llm',
    purpose: 'Lightweight fast chat (low-end hardware)',
    purposeFa: 'گفتگوی سبک و سریع (سخت‌افزار ضعیف)',
    sizeBytes: 0.4 * 1e9,
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    checksum: 'pending',
    requiredRAM: 1,
    requiredVRAM: 0,
    recommendedRAM: 4,
    recommendedVRAM: 0,
    targetDir: 'models/llm',
    filename: 'qwen2.5-0.5b-q4_k_m.gguf',
    quantization: 'Q4_K_M',
    parameterCount: '0.5B',
    isEssential: true,
  },

  // ── Voice STT (Whisper) ──
  {
    id: 'whisper-base-en',
    name: 'Whisper Base (English)',
    type: 'voice-stt',
    purpose: 'Fast English speech-to-text',
    purposeFa: 'تبدیل گفتار به متن انگلیسی (سریع)',
    sizeBytes: 0.14 * 1e9,
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    checksum: 'pending',
    requiredRAM: 1,
    requiredVRAM: 0,
    recommendedRAM: 2,
    recommendedVRAM: 1,
    targetDir: 'models/whisper',
    filename: 'ggml-base.en.bin',
    isEssential: false,
  },
  {
    id: 'whisper-medium-q5',
    name: 'Whisper Medium Q5 (Multilingual)',
    type: 'voice-stt',
    purpose: 'High-quality multilingual speech-to-text',
    purposeFa: 'تبدیل گفتار به متن چندزبانه (باکیفیت)',
    sizeBytes: 0.8 * 1e9,
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin',
    checksum: 'pending',
    requiredRAM: 2,
    requiredVRAM: 1,
    recommendedRAM: 4,
    recommendedVRAM: 2,
    targetDir: 'models/whisper',
    filename: 'ggml-medium-q5_0.bin',
    quantization: 'Q5_0',
    isEssential: false,
  },

  // ── Voice TTS (Piper) ──
  {
    id: 'piper-en-us-lessac-medium',
    name: 'Piper Voice (en-US, lessac, medium)',
    type: 'voice-tts',
    purpose: 'Natural English text-to-speech',
    purposeFa: 'تبدیل متن به گفتار انگلیسی (طبیعی)',
    sizeBytes: 0.063 * 1e9,
    downloadUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx',
    checksum: 'pending',
    requiredRAM: 1,
    requiredVRAM: 0,
    recommendedRAM: 2,
    recommendedVRAM: 0,
    targetDir: 'models/piper',
    filename: 'en_US-lessac-medium.onnx',
    isEssential: false,
  },

  // ── Vision (LLaVA) ──
  {
    id: 'llava-7b-q4',
    name: 'LLaVA 7B Q4',
    type: 'vision',
    purpose: 'Image analysis, OCR, screenshot understanding',
    purposeFa: 'تحلیل تصویر، OCR، درک اسکرین‌شات',
    sizeBytes: 4.5 * 1e9,
    downloadUrl: 'https://huggingface.co/mys/ggml_llava-v1.5-7b/resolve/main/ggml-model-q4_k.gguf',
    checksum: 'pending',
    requiredRAM: 10,
    requiredVRAM: 6,
    recommendedRAM: 16,
    recommendedVRAM: 8,
    targetDir: 'models/vision',
    filename: 'llava-7b-q4_k.gguf',
    quantization: 'Q4_K',
    parameterCount: '7B',
    isEssential: false,
  },

  // ── Tools ──
  {
    id: 'llama-cpp',
    name: 'llama.cpp Runtime',
    type: 'tool',
    purpose: 'Local LLM inference engine (required for LLaVA vision)',
    purposeFa: 'موتور اجرای LLM محلی (لازم برای LLaVA)',
    sizeBytes: 0,
    downloadUrl: 'https://github.com/ggerganov/llama.cpp/releases',
    checksum: 'n/a',
    requiredRAM: 0,
    requiredVRAM: 0,
    recommendedRAM: 0,
    recommendedVRAM: 0,
    targetDir: 'bin',
    filename: 'llama-cli',
    isEssential: true,
  },
  {
    id: 'ffmpeg',
    name: 'FFmpeg',
    type: 'tool',
    purpose: 'Audio/video processing (required for whisper resampling)',
    purposeFa: 'پردازش صوت/تصویر (لازم برای resampling)',
    sizeBytes: 0,
    downloadUrl: 'https://ffmpeg.org/download.html',
    checksum: 'n/a',
    requiredRAM: 0,
    requiredVRAM: 0,
    recommendedRAM: 0,
    recommendedVRAM: 0,
    targetDir: 'bin',
    filename: 'ffmpeg',
    isEssential: false,
  },
];

export function getCatalog(): CatalogComponent[] {
  return COMPONENT_CATALOG;
}

export function getCatalogByType(type: ComponentType): CatalogComponent[] {
  return COMPONENT_CATALOG.filter((c) => c.type === type);
}

export function getCatalogEntry(id: string): CatalogComponent | null {
  return COMPONENT_CATALOG.find((c) => c.id === id) || null;
}

export function getEssentialComponents(): CatalogComponent[] {
  return COMPONENT_CATALOG.filter((c) => c.isEssential);
}
