/**
 * NEX AI — Advanced Model Catalog (Phase 49)
 *
 * Extended from Phase 45 models-catalog with:
 *   - More models (DeepSeek, Mistral, Qwen2.5-VL)
 *   - Persian language support flag
 *   - Recommended hardware tier (low/medium/high)
 *   - Download info integration with Phase 46 component catalog
 */

export type HardwareTier = 'low' | 'medium' | 'high';
export type ModelType = 'llm' | 'vision' | 'voice-stt' | 'voice-tts' | 'embedding';

export interface AdvancedModelEntry {
  id: string;
  name: string;
  provider: string;
  type: ModelType;
  capabilities: string[];
  sizeGB: number;
  requiredRAM: number;       // GB
  requiredVRAM: number;     // GB (0 = CPU only)
  recommendedRAM: number;
  recommendedVRAM: number;
  quantization: string;
  parameterCount: string;
  contextSize: number;
  // Benchmark scores (0-100)
  qualityScore: number;
  speedScore: number;
  codingScore: number;
  reasoningScore: number;
  visionScore: number;
  voiceScore: number;
  // Language support
  persianSupport: boolean;
  multilingual: boolean;
  // Hardware tier recommendation
  recommendedTier: HardwareTier;
  // Download info (from Phase 46 component catalog)
  downloadUrl: string;
  checksum: string;
  filename: string;
  targetDir: string;
  // Display
  displayNameFa: string;    // Persian display name
  descriptionFa: string;   // Persian description
  isEssential: boolean;
}

export const ADVANCED_MODEL_CATALOG: AdvancedModelEntry[] = [
  // ── LLM: Qwen Family ──
  {
    id: 'qwen2.5-coder-7b-q5', name: 'Qwen2.5 Coder 7B Q5', provider: 'qwen', type: 'llm',
    capabilities: ['chat', 'coding'], sizeGB: 5.2, requiredRAM: 10, requiredVRAM: 6,
    recommendedRAM: 16, recommendedVRAM: 8, quantization: 'Q5_K_M', parameterCount: '7B', contextSize: 8192,
    qualityScore: 78, speedScore: 50, codingScore: 88, reasoningScore: 72, visionScore: 0, voiceScore: 0,
    persianSupport: true, multilingual: true, recommendedTier: 'medium',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q5_k_m.gguf',
    checksum: 'pending', filename: 'qwen2.5-coder-7b-q5_k_m.gguf', targetDir: 'models/llm',
    displayNameFa: 'کیون کادر ۷ میلیارد پارامتر', descriptionFa: 'بهترین مدل برای برنامه‌نویسی، دیباگ و بازسازی کد',
    isEssential: true,
  },
  {
    id: 'qwen2.5-7b-q4', name: 'Qwen2.5 7B Q4', provider: 'qwen', type: 'llm',
    capabilities: ['chat', 'coding'], sizeGB: 4.1, requiredRAM: 8, requiredVRAM: 5,
    recommendedRAM: 16, recommendedVRAM: 8, quantization: 'Q4_K_M', parameterCount: '7B', contextSize: 4096,
    qualityScore: 65, speedScore: 70, codingScore: 60, reasoningScore: 55, visionScore: 0, voiceScore: 0,
    persianSupport: true, multilingual: true, recommendedTier: 'medium',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf',
    checksum: 'pending', filename: 'qwen2.5-7b-q4_k_m.gguf', targetDir: 'models/llm',
    displayNameFa: 'کیون ۷ میلیارد پارامتر', descriptionFa: 'مدل عمومی برای گفتگو، کدنویسی و استدلال',
    isEssential: true,
  },
  {
    id: 'qwen2.5-0.5b-q4', name: 'Qwen2.5 0.5B Q4', provider: 'qwen', type: 'llm',
    capabilities: ['chat'], sizeGB: 0.4, requiredRAM: 1, requiredVRAM: 0,
    recommendedRAM: 4, recommendedVRAM: 0, quantization: 'Q4_K_M', parameterCount: '0.5B', contextSize: 2048,
    qualityScore: 35, speedScore: 95, codingScore: 20, reasoningScore: 25, visionScore: 0, voiceScore: 0,
    persianSupport: true, multilingual: true, recommendedTier: 'low',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    checksum: 'pending', filename: 'qwen2.5-0.5b-q4_k_m.gguf', targetDir: 'models/llm',
    displayNameFa: 'کیون ۰.۵ میلیارد پارامتر (سبک)', descriptionFa: 'مدل سبک و سریع برای سخت‌افزار ضعیف',
    isEssential: true,
  },
  {
    id: 'qwen2.5-coder-14b-q5', name: 'Qwen2.5 Coder 14B Q5', provider: 'qwen', type: 'llm',
    capabilities: ['chat', 'coding', 'reasoning'], sizeGB: 9.8, requiredRAM: 16, requiredVRAM: 10,
    recommendedRAM: 32, recommendedVRAM: 12, quantization: 'Q5_K_M', parameterCount: '14B', contextSize: 8192,
    qualityScore: 78, speedScore: 50, codingScore: 88, reasoningScore: 72, visionScore: 0, voiceScore: 0,
    persianSupport: true, multilingual: true, recommendedTier: 'high',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct-GGUF/resolve/main/qwen2.5-coder-14b-instruct-q5_k_m.gguf',
    checksum: 'pending', filename: 'qwen2.5-coder-14b-q5_k_m.gguf', targetDir: 'models/llm',
    displayNameFa: 'کیون کادر ۱۴ میلیارد پارامتر', descriptionFa: 'قدرتمندترین مدل کدنویسی برای پروژه‌های پیچیده',
    isEssential: false,
  },
  {
    id: 'qwen2.5-32b-q4', name: 'Qwen2.5 32B Q4', provider: 'qwen', type: 'llm',
    capabilities: ['chat', 'reasoning'], sizeGB: 18.5, requiredRAM: 32, requiredVRAM: 20,
    recommendedRAM: 64, recommendedVRAM: 24, quantization: 'Q4_K_M', parameterCount: '32B', contextSize: 8192,
    qualityScore: 85, speedScore: 35, codingScore: 75, reasoningScore: 90, visionScore: 0, voiceScore: 0,
    persianSupport: true, multilingual: true, recommendedTier: 'high',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-32B-Instruct-GGUF/resolve/main/qwen2.5-32b-instruct-q4_k_m.gguf',
    checksum: 'pending', filename: 'qwen2.5-32b-q4_k_m.gguf', targetDir: 'models/llm',
    displayNameFa: 'کیون ۳۲ میلیارد پارامتر', descriptionFa: 'قدرتمندترین مدل برای استدلال پیچیده',
    isEssential: false,
  },

  // ── LLM: DeepSeek ──
  {
    id: 'deepseek-coder-6.7b-q4', name: 'DeepSeek Coder 6.7B Q4', provider: 'deepseek', type: 'llm',
    capabilities: ['chat', 'coding'], sizeGB: 3.9, requiredRAM: 8, requiredVRAM: 5,
    recommendedRAM: 16, recommendedVRAM: 8, quantization: 'Q4_K_M', parameterCount: '6.7B', contextSize: 4096,
    qualityScore: 62, speedScore: 72, codingScore: 70, reasoningScore: 50, visionScore: 0, voiceScore: 0,
    persianSupport: false, multilingual: false, recommendedTier: 'medium',
    downloadUrl: 'https://huggingface.co/TheBloke/deepseek-coder-6.7B-instruct-GGUF/resolve/main/deepseek-coder-6.7b-instruct.Q4_K_M.gguf',
    checksum: 'pending', filename: 'deepseek-coder-6.7b-instruct.Q4_K_M.gguf', targetDir: 'models/llm',
    displayNameFa: 'دیپ‌سیک کادر ۶.۷ میلیارد', descriptionFa: 'مدل کدنویسی با تمرکز بر زبان‌های برنامه‌نویسی',
    isEssential: false,
  },

  // ── LLM: Llama ──
  {
    id: 'llama3.1-8b-q4', name: 'Llama 3.1 8B Q4', provider: 'llama', type: 'llm',
    capabilities: ['chat', 'reasoning'], sizeGB: 4.7, requiredRAM: 10, requiredVRAM: 6,
    recommendedRAM: 16, recommendedVRAM: 8, quantization: 'Q4_K_M', parameterCount: '8B', contextSize: 8192,
    qualityScore: 70, speedScore: 65, codingScore: 62, reasoningScore: 68, visionScore: 0, voiceScore: 0,
    persianSupport: false, multilingual: false, recommendedTier: 'medium',
    downloadUrl: 'https://huggingface.co/MaziyarPanahi/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct.Q4_K_M.gguf',
    checksum: 'pending', filename: 'Meta-Llama-3.1-8B-Instruct.Q4_K_M.gguf', targetDir: 'models/llm',
    displayNameFa: 'لاما ۳.۱ ۸ میلیارد', descriptionFa: 'مدل قدرتمند گوناگون برای گفتگو و استدلال',
    isEssential: false,
  },

  // ── LLM: Mistral ──
  {
    id: 'mistral-7b-q4', name: 'Mistral 7B Q4', provider: 'mistral', type: 'llm',
    capabilities: ['chat', 'coding'], sizeGB: 4.1, requiredRAM: 8, requiredVRAM: 5,
    recommendedRAM: 16, recommendedVRAM: 8, quantization: 'Q4_K_M', parameterCount: '7B', contextSize: 4096,
    qualityScore: 63, speedScore: 72, codingScore: 58, reasoningScore: 55, visionScore: 0, voiceScore: 0,
    persianSupport: false, multilingual: true, recommendedTier: 'medium',
    downloadUrl: 'https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf',
    checksum: 'pending', filename: 'mistral-7b-instruct-v0.2.Q4_K_M.gguf', targetDir: 'models/llm',
    displayNameFa: 'میسترال ۷ میلیارد', descriptionFa: 'مدل سبک و کارآمد برای گفتگو',
    isEssential: false,
  },

  // ── Vision ──
  {
    id: 'llava-7b-q4', name: 'LLaVA 7B Q4', provider: 'llava', type: 'vision',
    capabilities: ['chat', 'vision'], sizeGB: 4.5, requiredRAM: 10, requiredVRAM: 6,
    recommendedRAM: 16, recommendedVRAM: 8, quantization: 'Q4_K', parameterCount: '7B', contextSize: 4096,
    qualityScore: 60, speedScore: 55, codingScore: 30, reasoningScore: 45, visionScore: 75, voiceScore: 0,
    persianSupport: false, multilingual: false, recommendedTier: 'medium',
    downloadUrl: 'https://huggingface.co/mys/ggml_llava-v1.5-7b/resolve/main/ggml-model-q4_k.gguf',
    checksum: 'pending', filename: 'llava-7b-q4_k.gguf', targetDir: 'models/vision',
    displayNameFa: 'لاوا ۷ میلیارد (بینایی)', descriptionFa: 'تحلیل تصویر، OCR، درک اسکرین‌شات',
    isEssential: false,
  },
  {
    id: 'qwen2.5-vl-7b-q4', name: 'Qwen2.5-VL 7B Q4', provider: 'qwen', type: 'vision',
    capabilities: ['chat', 'vision'], sizeGB: 4.5, requiredRAM: 10, requiredVRAM: 6,
    recommendedRAM: 16, recommendedVRAM: 8, quantization: 'Q4_K_M', parameterCount: '7B', contextSize: 4096,
    qualityScore: 72, speedScore: 50, codingScore: 35, reasoningScore: 60, visionScore: 85, voiceScore: 0,
    persianSupport: true, multilingual: true, recommendedTier: 'medium',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct-GGUF/resolve/main/qwen2.5-vl-7b-instruct-q4_k_m.gguf',
    checksum: 'pending', filename: 'qwen2.5-vl-7b-instruct-q4_k_m.gguf', targetDir: 'models/vision',
    displayNameFa: 'کیون وی‌ال ۷ میلیارد (بینایی)', descriptionFa: 'مدل بینایی پیشرفته با پشتیبانی فارسی',
    isEssential: false,
  },

  // ── Voice STT (Whisper) ──
  {
    id: 'whisper-base-en', name: 'Whisper Base (English)', provider: 'whisper', type: 'voice-stt',
    capabilities: ['speech-to-text'], sizeGB: 0.14, requiredRAM: 1, requiredVRAM: 0,
    recommendedRAM: 2, recommendedVRAM: 1, quantization: 'F16', parameterCount: '0.07B', contextSize: 0,
    qualityScore: 50, speedScore: 85, codingScore: 0, reasoningScore: 0, visionScore: 0, voiceScore: 60,
    persianSupport: false, multilingual: false, recommendedTier: 'low',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    checksum: 'pending', filename: 'ggml-base.en.bin', targetDir: 'models/whisper',
    displayNameFa: 'ویسپر بیس (انگلیسی)', descriptionFa: 'تبدیل گفتار به متن انگلیسی (سریع)',
    isEssential: false,
  },
  {
    id: 'whisper-medium-q5', name: 'Whisper Medium Q5 (Multilingual)', provider: 'whisper', type: 'voice-stt',
    capabilities: ['speech-to-text'], sizeGB: 0.8, requiredRAM: 2, requiredVRAM: 1,
    recommendedRAM: 4, recommendedVRAM: 2, quantization: 'Q5_0', parameterCount: '0.77B', contextSize: 0,
    qualityScore: 70, speedScore: 60, codingScore: 0, reasoningScore: 0, visionScore: 0, voiceScore: 80,
    persianSupport: true, multilingual: true, recommendedTier: 'medium',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin',
    checksum: 'pending', filename: 'ggml-medium-q5_0.bin', targetDir: 'models/whisper',
    displayNameFa: 'ویسپر مدیوم (چندزبانه)', descriptionFa: 'تبدیل گفتار به متن چندزبانه با پشتیبانی فارسی',
    isEssential: false,
  },

  // ── Voice TTS (Piper) ──
  {
    id: 'piper-en-us-lessac-medium', name: 'Piper Voice (en-US)', provider: 'piper', type: 'voice-tts',
    capabilities: ['text-to-speech'], sizeGB: 0.063, requiredRAM: 1, requiredVRAM: 0,
    recommendedRAM: 2, recommendedVRAM: 0, quantization: 'N/A', parameterCount: 'N/A', contextSize: 0,
    qualityScore: 65, speedScore: 90, codingScore: 0, reasoningScore: 0, visionScore: 0, voiceScore: 70,
    persianSupport: false, multilingual: false, recommendedTier: 'low',
    downloadUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx',
    checksum: 'pending', filename: 'en_US-lessac-medium.onnx', targetDir: 'models/piper',
    displayNameFa: 'صوتی پایپر (انگلیسی)', descriptionFa: 'تولید گفتار طبیعی انگلیسی',
    isEssential: false,
  },
  {
    id: 'piper-fa-ir-gyro-medium', name: 'Piper Voice (fa-IR)', provider: 'piper', type: 'voice-tts',
    capabilities: ['text-to-speech'], sizeGB: 0.063, requiredRAM: 1, requiredVRAM: 0,
    recommendedRAM: 2, recommendedVRAM: 0, quantization: 'N/A', parameterCount: 'N/A', contextSize: 0,
    qualityScore: 60, speedScore: 88, codingScore: 0, reasoningScore: 0, visionScore: 0, voiceScore: 75,
    persianSupport: true, multilingual: false, recommendedTier: 'low',
    downloadUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/fa/fa_IR/gyro/medium/fa_IR-gyro-medium.onnx',
    checksum: 'pending', filename: 'fa_IR-gyro-medium.onnx', targetDir: 'models/piper',
    displayNameFa: 'صوتی پایپر (فارسی)', descriptionFa: 'تولید گفتار طبیعی فارسی',
    isEssential: false,
  },

  // ── Embedding ──
  {
    id: 'nomic-embed-137m', name: 'Nomic Embed 137M', provider: 'nomic', type: 'embedding',
    capabilities: ['embedding'], sizeGB: 0.27, requiredRAM: 1, requiredVRAM: 0,
    recommendedRAM: 2, recommendedVRAM: 0, quantization: 'F16', parameterCount: '0.137B', contextSize: 2048,
    qualityScore: 65, speedScore: 90, codingScore: 0, reasoningScore: 0, visionScore: 0, voiceScore: 0,
    persianSupport: true, multilingual: true, recommendedTier: 'low',
    downloadUrl: 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf',
    checksum: 'pending', filename: 'nomic-embed-text-v1.5.Q4_K_M.gguf', targetDir: 'models/embedding',
    displayNameFa: 'نومیک امبد (جستجوی معنایی)', descriptionFa: 'مدل embedding برای RAG و جستجوی معنایی',
    isEssential: false,
  },
];

export function getAdvancedCatalog(): AdvancedModelEntry[] {
  return ADVANCED_MODEL_CATALOG;
}

export function getAdvancedCatalogByType(type: ModelType): AdvancedModelEntry[] {
  return ADVANCED_MODEL_CATALOG.filter((m) => m.type === type);
}

export function getAdvancedCatalogEntry(id: string): AdvancedModelEntry | null {
  return ADVANCED_MODEL_CATALOG.find((m) => m.id === id) || null;
}

export function getModelsByHardwareTier(tier: HardwareTier): AdvancedModelEntry[] {
  return ADVANCED_MODEL_CATALOG.filter((m) => m.recommendedTier === tier);
}

export function getModelsByPersianSupport(): AdvancedModelEntry[] {
  return ADVANCED_MODEL_CATALOG.filter((m) => m.persianSupport);
}
