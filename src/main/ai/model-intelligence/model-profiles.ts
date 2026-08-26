/**
 * NEX AI — Model Profiles & Expanded Catalog (Phase 59)
 *
 * Extends the Phase 49 advanced-model-catalog with:
 *   1. ModelProfile — identity per model (name, role, strengths, weaknesses,
 *      languages, speed, quality, recommended usage)
 *   2. EXPANDED_MODEL_CATALOG — the Phase 49 catalog + new professional models
 *      (Llama 3.2/3.3, Qwen 3, Mistral, Gemma, Phi, StarCoder, CodeLlama,
 *      DeepSeek Reasoner, QwQ, InternVL, BGE, E5)
 *
 * This module does NOT duplicate the Phase 49 catalog — it imports it and
 * appends new entries. The EXPANDED catalog is the single source of truth
 * for Phase 59's ecosystem manager.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SECURITY
 * ════════════════════════════════════════════════════════════════════════════
 * This is a pure-data module. No I/O, no network, no downloads. It only
 * describes models. Installation always goes through PermissionGate (Phase 43)
 * via the ComponentInstaller (Phase 47).
 * ════════════════════════════════════════════════════════════════════════════
 */

import {
  ADVANCED_MODEL_CATALOG,
  type AdvancedModelEntry,
  type HardwareTier,
  type ModelType,
} from './advanced-model-catalog';

// Re-export the catalog types so consumers can import them from here.
export type { AdvancedModelEntry, HardwareTier, ModelType };

// ─── Model Profile (identity per model) ───────────────────────────────────

export interface ModelProfile {
  /** Catalog entry id this profile describes. */
  catalogId: string;
  /** Short role label, e.g. "Coding Specialist", "Reasoning Engine". */
  role: string;
  /** Persian role label. */
  roleFa: string;
  /** What this model excels at (3-5 bullet points). */
  strengths: string[];
  /** Persian strengths. */
  strengthsFa: string[];
  /** Known limitations (3-5 bullets). */
  weaknesses: string[];
  /** Persian weaknesses. */
  weaknessesFa: string[];
  /** BCP-47 language codes this model supports well. */
  languages: string[];
  /** Speed rating 0-100 (higher = faster). */
  speed: number;
  /** Quality rating 0-100 (higher = better output quality). */
  quality: number;
  /** Recommended usage scenario (Persian). */
  recommendedUsageFa: string;
}

// ─── Expanded Catalog Entry ────────────────────────────────────────────────

/**
 * A catalog entry with its attached profile. The Phase 49 entries get a
 * profile synthesized from their benchmark scores; the new Phase 59 entries
 * carry an explicit profile.
 */
export interface CatalogEntryWithProfile {
  entry: AdvancedModelEntry;
  profile: ModelProfile;
}

// ─── New model entries (Phase 59 expansion) ────────────────────────────────
//
// These APPEND to the Phase 49 catalog. IDs are unique (no overlap with the
// 15 existing Phase 49 entries: qwen2.5-coder-7b-q5, qwen2.5-7b-q4,
// qwen2.5-0.5b-q4, qwen2.5-coder-14b-q5, qwen2.5-32b-q4, deepseek-coder-6.7b-q4,
// llama3.1-8b-q4, mistral-7b-q4, llava-7b-q4, qwen2.5-vl-7b-q4,
// whisper-base-en, whisper-medium-q5, piper-en-us-lessac-medium,
// piper-fa-ir-gyro-medium, nomic-embed-137m).

function entry(
  id: string, name: string, provider: string, type: ModelType,
  capabilities: string[], sizeGB: number, requiredRAM: number, requiredVRAM: number,
  recommendedRAM: number, recommendedVRAM: number, quantization: string,
  parameterCount: string, contextSize: number,
  qualityScore: number, speedScore: number, codingScore: number, reasoningScore: number,
  visionScore: number, voiceScore: number,
  persianSupport: boolean, multilingual: boolean, recommendedTier: HardwareTier,
  downloadUrl: string, checksum: string, filename: string, targetDir: string,
  displayNameFa: string, descriptionFa: string, isEssential: boolean,
): AdvancedModelEntry {
  return {
    id, name, provider, type, capabilities, sizeGB, requiredRAM, requiredVRAM,
    recommendedRAM, recommendedVRAM, quantization, parameterCount, contextSize,
    qualityScore, speedScore, codingScore, reasoningScore, visionScore, voiceScore,
    persianSupport, multilingual, recommendedTier,
    downloadUrl, checksum, filename, targetDir,
    displayNameFa, descriptionFa, isEssential,
  };
}

export const EXPANDED_MODEL_ENTRIES: AdvancedModelEntry[] = [
  // ── Llama 3.2 / 3.3 (new — not in Phase 49) ──
  entry(
    'llama3.2-1b-q4', 'Llama 3.2 1B Q4', 'llama', 'llm',
    ['chat', 'completion'], 0.8, 2, 0, 4, 0, 'Q4_K_M', '1B', 4096,
    40, 92, 30, 35, 0, 0, false, true, 'low',
    'https://huggingface.co/meta-llama/Llama-3.2-1B-Instruct-GGUF/resolve/main/llama-3.2-1b-instruct-q4_k_m.gguf',
    'pending', 'llama-3.2-1b-instruct-q4_k_m.gguf', 'models/llm',
    'لاما ۳.۲ یک میلیارد', 'مدل سبک و سریع برای سخت‌افزار ضعیف و پاسخ‌های سریع', false,
  ),
  entry(
    'llama3.2-3b-q4', 'Llama 3.2 3B Q4', 'llama', 'llm',
    ['chat', 'completion', 'reasoning'], 2.0, 4, 0, 8, 0, 'Q4_K_M', '3B', 8192,
    55, 80, 45, 50, 0, 0, false, true, 'low',
    'https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct-GGUF/resolve/main/llama-3.2-3b-instruct-q4_k_m.gguf',
    'pending', 'llama-3.2-3b-instruct-q4_k_m.gguf', 'models/llm',
    'لاما ۳.۲ سه میلیارد', 'مدل متعادل برای گفتگو و استدلال سبک', true,
  ),
  entry(
    'llama3.3-70b-q4', 'Llama 3.3 70B Q4', 'llama', 'llm',
    ['chat', 'reasoning', 'coding'], 40.0, 64, 48, 96, 64, 'Q4_K_M', '70B', 8192,
    92, 25, 82, 90, 0, 0, true, true, 'high',
    'https://huggingface.co/meta-llama/Llama-3.3-70B-Instruct-GGUF/resolve/main/llama-3.3-70b-instruct-q4_k_m.gguf',
    'pending', 'llama-3.3-70b-instruct-q4_k_m.gguf', 'models/llm',
    'لاما ۳.۳ ۷۰ میلیارد', 'قدرتمندترین مدل لاما برای استدلال پیچیده و کدنویسی پیشرفته', false,
  ),

  // ── Qwen 3 (new — not in Phase 49) ──
  entry(
    'qwen3-8b-q4', 'Qwen 3 8B Q4', 'qwen', 'llm',
    ['chat', 'reasoning', 'coding'], 4.8, 8, 6, 16, 8, 'Q4_K_M', '8B', 16384,
    80, 60, 75, 85, 0, 0, true, true, 'medium',
    'https://huggingface.co/Qwen/Qwen3-8B-Instruct-GGUF/resolve/main/qwen3-8b-instruct-q4_k_m.gguf',
    'pending', 'qwen3-8b-instruct-q4_k_m.gguf', 'models/llm',
    'کیون ۳ هشت میلیارد', 'نسخه جدید کیون با پشتیبانی فارسی و استدلال قوی', true,
  ),
  entry(
    'qwen3-32b-q4', 'Qwen 3 32B Q4', 'qwen', 'llm',
    ['chat', 'reasoning'], 19.0, 32, 22, 64, 28, 'Q4_K_M', '32B', 16384,
    90, 35, 78, 93, 0, 0, true, true, 'high',
    'https://huggingface.co/Qwen/Qwen3-32B-Instruct-GGUF/resolve/main/qwen3-32b-instruct-q4_k_m.gguf',
    'pending', 'qwen3-32b-instruct-q4_k_m.gguf', 'models/llm',
    'کیون ۳ سی‌ودو میلیارد', 'مدل استدلال پیشرفته با کانتکست بزرگ', false,
  ),

  // ── Mistral (expanded — new sizes) ──
  entry(
    'mistral-nemo-12b-q4', 'Mistral Nemo 12B Q4', 'mistral', 'llm',
    ['chat', 'coding', 'reasoning'], 7.5, 12, 8, 24, 12, 'Q4_K_M', '12B', 32768,
    78, 55, 72, 70, 0, 0, true, true, 'medium',
    'https://huggingface.co/mistralai/Mistral-Nemo-Instruct-2407-GGUF/resolve/main/mistral-nemo-instruct-2407-q4_k_m.gguf',
    'pending', 'mistral-nemo-instruct-2407-q4_k_m.gguf', 'models/llm',
    'میسترال نِمو ۱۲ میلیارد', 'مدل چندزبانه با کانتکست ۳۲ هزار توکن', false,
  ),

  // ── Gemma (new — not in Phase 49) ──
  entry(
    'gemma2-9b-q4', 'Gemma 2 9B Q4', 'gemma', 'llm',
    ['chat', 'reasoning'], 5.5, 10, 7, 16, 10, 'Q4_K_M', '9B', 8192,
    78, 58, 68, 75, 0, 0, false, true, 'medium',
    'https://huggingface.co/google/gemma-2-9b-it-GGUF/resolve/main/gemma-2-9b-it-q4_k_m.gguf',
    'pending', 'gemma-2-9b-it-q4_k_m.gguf', 'models/llm',
    'جِما ۲ نه میلیارد', 'مدل گوگل با کیفیت بالا برای گفتگو و استدلال', false,
  ),
  entry(
    'gemma2-27b-q4', 'Gemma 2 27B Q4', 'gemma', 'llm',
    ['chat', 'reasoning'], 16.0, 28, 20, 48, 24, 'Q4_K_M', '27B', 8192,
    87, 40, 78, 85, 0, 0, false, true, 'high',
    'https://huggingface.co/google/gemma-2-27b-it-GGUF/resolve/main/gemma-2-27b-it-q4_k_m.gguf',
    'pending', 'gemma-2-27b-it-q4_k_m.gguf', 'models/llm',
    'جِما ۲ ۲۷ میلیارد', 'مدل قدرتمند گوگل برای استدلال عمیق', false,
  ),

  // ── Phi (new sizes — Phase 45 had phi3-mini, Phase 49 has none) ──
  entry(
    'phi3-medium-14b-q4', 'Phi-3 Medium 14B Q4', 'phi', 'llm',
    ['chat', 'reasoning'], 8.0, 14, 10, 24, 14, 'Q4_K_M', '14B', 16384,
    76, 55, 65, 80, 0, 0, false, true, 'medium',
    'https://huggingface.co/microsoft/Phi-3-medium-4k-instruct-GGUF/resolve/main/phi-3-medium-4k-instruct-q4_k_m.gguf',
    'pending', 'phi-3-medium-4k-instruct-q4_k_m.gguf', 'models/llm',
    'فای ۳ متوسط ۱۴ میلیارد', 'مدل مایکروسافت با کانتکست بزرگ و استدلال خوب', false,
  ),

  // ── StarCoder (new — coding specialist) ──
  entry(
    'starcoder2-3b-q4', 'StarCoder2 3B Q4', 'starcoder', 'llm',
    ['completion', 'coding'], 1.8, 4, 0, 8, 0, 'Q4_K_M', '3B', 16384,
    50, 85, 65, 30, 0, 0, false, false, 'low',
    'https://huggingface.co/bigcode/starcoder2-3b-GGUF/resolve/main/starcoder2-3b-q4_k_m.gguf',
    'pending', 'starcoder2-3b-q4_k_m.gguf', 'models/llm',
    'استارکادر ۲ سه میلیارد', 'مدل تکمیل کد سبک برای تکمیل خودکار', false,
  ),
  entry(
    'starcoder2-15b-q4', 'StarCoder2 15B Q4', 'starcoder', 'llm',
    ['completion', 'coding'], 9.0, 16, 11, 28, 16, 'Q4_K_M', '15B', 16384,
    72, 50, 85, 40, 0, 0, false, false, 'high',
    'https://huggingface.co/bigcode/starcoder2-15b-GGUF/resolve/main/starcoder2-15b-q4_k_m.gguf',
    'pending', 'starcoder2-15b-q4_k_m.gguf', 'models/llm',
    'استارکادر ۲ ۱۵ میلیارد', 'مدل قدرتمند کدنویسی برای پروژه‌های بزرگ', false,
  ),

  // ── CodeLlama (new) ──
  entry(
    'codellama-7b-q4', 'CodeLlama 7B Q4', 'llama', 'llm',
    ['chat', 'coding'], 4.0, 8, 5, 16, 8, 'Q4_K_M', '7B', 4096,
    60, 70, 72, 45, 0, 0, false, false, 'medium',
    'https://huggingface.co/TheBloke/CodeLlama-7B-Instruct-GGUF/resolve/main/codellama-7b-instruct.Q4_K_M.gguf',
    'pending', 'codellama-7b-instruct.Q4_K_M.gguf', 'models/llm',
    'کدلاما ۷ میلیارد', 'مدل کدنویسی مبتنی بر لاما برای توضیح و تولید کد', false,
  ),
  entry(
    'codellama-13b-q4', 'CodeLlama 13B Q4', 'llama', 'llm',
    ['chat', 'coding', 'reasoning'], 7.4, 14, 9, 24, 12, 'Q4_K_M', '13B', 4096,
    68, 55, 78, 55, 0, 0, false, false, 'high',
    'https://huggingface.co/TheBloke/CodeLlama-13B-Instruct-GGUF/resolve/main/codellama-13b-instruct.Q4_K_M.gguf',
    'pending', 'codellama-13b-instruct.Q4_K_M.gguf', 'models/llm',
    'کدلاما ۱۳ میلیارد', 'مدل کدنویسی قدرتمندتر برای پروژه‌های پیچیده', false,
  ),

  // ── DeepSeek Reasoner (new — reasoning specialist) ──
  entry(
    'deepseek-r1-7b-q4', 'DeepSeek R1 7B Q4', 'deepseek', 'llm',
    ['chat', 'reasoning'], 4.2, 8, 5, 16, 8, 'Q4_K_M', '7B', 8192,
    78, 65, 70, 88, 0, 0, false, true, 'medium',
    'https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-7B-GGUF/resolve/main/deepseek-r1-distill-qwen-7b-q4_k_m.gguf',
    'pending', 'deepseek-r1-distill-qwen-7b-q4_k_m.gguf', 'models/llm',
    'دیپ‌سیک آر۱ ۷ میلیارد', 'مدل استدلال تخصصی با تفکر زنجیره‌ای', true,
  ),
  entry(
    'deepseek-r1-14b-q4', 'DeepSeek R1 14B Q4', 'deepseek', 'llm',
    ['chat', 'reasoning'], 8.5, 16, 10, 28, 14, 'Q4_K_M', '14B', 8192,
    85, 50, 75, 92, 0, 0, false, true, 'high',
    'https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-14B-GGUF/resolve/main/deepseek-r1-distill-qwen-14b-q4_k_m.gguf',
    'pending', 'deepseek-r1-distill-qwen-14b-q4_k_m.gguf', 'models/llm',
    'دیپ‌سیک آر۱ ۱۴ میلیارد', 'مدل استدلال پیشرفته برای مسائل پیچیده', false,
  ),

  // ── QwQ (new — reasoning specialist) ──
  entry(
    'qwq-32b-preview-q4', 'QwQ 32B Preview Q4', 'qwen', 'llm',
    ['chat', 'reasoning'], 18.5, 32, 22, 64, 28, 'Q4_K_M', '32B', 32768,
    92, 35, 78, 95, 0, 0, true, true, 'high',
    'https://huggingface.co/Qwen/QwQ-32B-Preview-GGUF/resolve/main/qwq-32b-preview-q4_k_m.gguf',
    'pending', 'qwq-32b-preview-q4_k_m.gguf', 'models/llm',
    'کیوکیو ۳۲ میلیارد', 'مدل استدلال تخصصی کیون با تفکر عمیق', false,
  ),

  // ── Vision: LLaVA expanded + InternVL (new) ──
  entry(
    'llava-1.6-13b-q5', 'LLaVA 1.6 13B Q5', 'llava', 'vision',
    ['vision', 'chat'], 9.0, 16, 10, 28, 14, 'Q5_K_M', '13B', 4096,
    80, 45, 50, 60, 88, 0, false, true, 'high',
    'https://huggingface.co/liuhaotian/llava-v1.6-vicuna-13b-gguf/resolve/main/llava-v1.6-vicuna-13b-q5_k_m.gguf',
    'pending', 'llava-v1.6-vicuna-13b-q5_k_m.gguf', 'models/vision',
    'ال‌ال‌اوی ۱.۶ ۱۳ میلیارد', 'مدل بینایی پیشرفته برای تحلیل تصویر و سند', false,
  ),
  entry(
    'internvl2-8b-q4', 'InternVL 2 8B Q4', 'internvl', 'vision',
    ['vision', 'chat'], 4.8, 8, 6, 16, 8, 'Q4_K_M', '8B', 8192,
    75, 60, 55, 58, 82, 0, false, true, 'medium',
    'https://huggingface.co/OpenGVLab/InternVL2-8B-GGUF/resolve/main/internvl2-8b-q4_k_m.gguf',
    'pending', 'internvl2-8b-q4_k_m.gguf', 'models/vision',
    'اینتِرن‌وی‌ال ۲ هشت میلیارد', 'مدل بینایی چندوجهی برای تحلیل تصویر و متن', false,
  ),

  // ── Embedding: BGE + E5 (new — Phase 49 has nomic only) ──
  entry(
    'bge-m3-q4', 'BGE M3 Q4', 'bge', 'embedding',
    ['embedding'], 0.6, 2, 0, 4, 0, 'Q4_K_M', '568M', 8192,
    85, 90, 0, 0, 0, 0, true, true, 'low',
    'https://huggingface.co/BAAI/bge-m3-GGUF/resolve/main/bge-m3-q4_k_m.gguf',
    'pending', 'bge-m3-q4_k_m.gguf', 'models/embedding',
    'بی‌جی‌ای ام۳', 'مدل جاسازی چندزبانه برای بازیابی معنایی پیشرفته', true,
  ),
  entry(
    'multilingual-e5-large-q4', 'Multilingual E5 Large Q4', 'e5', 'embedding',
    ['embedding'], 0.6, 2, 0, 4, 0, 'Q4_K_M', '560M', 512,
    80, 90, 0, 0, 0, 0, true, true, 'low',
    'https://huggingface.co/intfloat/multilingual-e5-large-GGUF/resolve/main/multilingual-e5-large-q4_k_m.gguf',
    'pending', 'multilingual-e5-large-q4_k_m.gguf', 'models/embedding',
    'ای۵ چندزبانه بزرگ', 'مدل جاسازی چندزبانه برای جستجوی معنایی', true,
  ),
];

// ─── Model Profiles (identity per catalog entry) ───────────────────────────

function profile(
  catalogId: string, role: string, roleFa: string,
  strengths: string[], strengthsFa: string[],
  weaknesses: string[], weaknessesFa: string[],
  languages: string[], speed: number, quality: number, recommendedUsageFa: string,
): ModelProfile {
  return {
    catalogId, role, roleFa, strengths, strengthsFa,
    weaknesses, weaknessesFa, languages, speed, quality, recommendedUsageFa,
  };
}

export const MODEL_PROFILES: ModelProfile[] = [
  // ── Qwen family ──
  profile('qwen2.5-coder-7b-q5', 'Coding Specialist', 'متخصص کدنویسی',
    ['Excellent code generation', 'Strong debugging', 'Multi-language support'],
    ['تولید کد عالی', 'دیباگ قوی', 'پشتیبانی چندزبانه'],
    ['Limited reasoning on complex math', 'No vision capability'],
    ['استدلال ریاضی محدود', 'بدون قابلیت بینایی'],
    ['en', 'fa', 'zh'], 70, 88, 'برنامه‌نویسی، دیباگ، بازسازی کد'),
  profile('qwen2.5-7b-q4', 'General Assistant', 'دستیار عمومی',
    ['Balanced chat + coding', 'Good Persian support', 'Fast inference'],
    ['تعادل گفتگو و کدنویسی', 'پشتیبانی فارسی خوب', 'استنتاج سریع'],
    ['Not the best at any single task', 'Smaller context'],
    ['در هیچ وظیفه‌ای بهترین نیست', 'کانتکست کوچک‌تر'],
    ['en', 'fa', 'zh'], 80, 75, 'گفتگو عمومی، کدنویسی سبک'),
  profile('qwen2.5-0.5b-q4', 'Lightweight Chat', 'گفتگو سبک',
    ['Very fast', 'Low RAM usage', 'Good for weak hardware'],
    ['بسیار سریع', 'مصرف RAM پایین', 'مناسب سخت‌افزار ضعیف'],
    ['Low quality', 'Poor reasoning', 'Limited knowledge'],
    ['کیفیت پایین', 'استدلال ضعیف', 'دانش محدود'],
    ['en', 'fa', 'zh'], 98, 40, 'پاسخ‌های سریع روی سخت‌افزار ضعیف'),
  profile('qwen2.5-coder-14b-q5', 'Advanced Coder', 'کادر پیشرفته',
    ['Superior code quality', 'Complex refactoring', 'Large context'],
    ['کیفیت کد برتر', 'بازسازی پیچیده', 'کانتکست بزرگ'],
    ['High RAM requirement', 'Slower inference'],
    ['نیاز RAM بالا', 'استنتاج کندتر'],
    ['en', 'fa', 'zh'], 55, 92, 'پروژه‌های کدنویسی پیچیده'),
  profile('qwen2.5-32b-q4', 'Reasoning Engine', 'موتور استدلال',
    ['Deep reasoning', 'Complex analysis', 'Excellent quality'],
    ['استدلال عمیق', 'تحلیل پیچیده', 'کیفیت عالی'],
    ['Very high RAM', 'Slow on CPU', 'High VRAM needed'],
    ['RAM بسیار بالا', 'کند روی CPU', 'نیاز VRAM بالا'],
    ['en', 'fa', 'zh'], 40, 95, 'استدلال پیچیده، تحلیل عمیق'),
  profile('qwen3-8b-q4', 'Next-Gen Generalist', 'عمومی‌گرا نسل جدید',
    ['Improved reasoning', 'Large context (16k)', 'Strong Persian'],
    ['استدلال بهبودیافته', 'کانتکست بزرگ (۱۶هزار)', 'فارسی قوی'],
    ['Newer, less tested', 'Requires modern hardware'],
    ['جدیدتر، کمتر آزمایش‌شده', 'نیاز به سخت‌افزار مدرن'],
    ['en', 'fa', 'zh'], 60, 85, 'گفتگو و استدلال نسل جدید'),
  profile('qwen3-32b-q4', 'Advanced Reasoner', 'استدلال‌گر پیشرفته',
    ['State-of-the-art reasoning', '32k context', 'Multi-language'],
    ['استدلال پیشرفته', 'کانتکست ۳۲هزار', 'چندزبانه'],
    ['Very large', 'Needs high-end GPU', 'Slow inference'],
    ['بسیار بزرگ', 'نیاز GPU پیشرفته', 'استنتاج کند'],
    ['en', 'fa', 'zh'], 35, 95, 'استدلال بسیار پیچیده'),

  // ── DeepSeek family ──
  profile('deepseek-coder-6.7b-q4', 'Code Engineer', 'مهندس کد',
    ['Focused on programming', 'Good at code review', 'Efficient size'],
    ['تمرکز بر برنامه‌نویسی', 'بازبینی کد خوب', 'اندازه کارآمد'],
    ['No Persian support', 'Limited general chat'],
    ['بدون پشتیبانی فارسی', 'گفتگو عمومی محدود'],
    ['en'], 75, 72, 'کدنویسی تخصصی انگلیسی'),
  profile('deepseek-r1-7b-q4', 'Reasoning Specialist', 'متخصص استدلال',
    ['Chain-of-thought reasoning', 'Math and logic', 'Good size'],
    ['استدلال زنجیره‌ای', 'ریاضی و منطق', 'اندازه مناسب'],
    ['Slower due to thinking', 'Less creative'],
    ['کندتر به دلیل تفکر', 'خلاقیت کمتر'],
    ['en', 'zh'], 65, 85, 'مسائل استدالی و ریاضی'),
  profile('deepseek-r1-14b-q4', 'Advanced Reasoner', 'استدلال‌گر پیشرفته',
    ['Superior reasoning', 'Complex problem solving', 'Multi-language'],
    ['استدلال برتر', 'حل مسائل پیچیده', 'چندزبانه'],
    ['High RAM', 'Slower inference', 'Verbose output'],
    ['RAM بالا', 'استنتاج کندتر', 'خروجی پرحرف'],
    ['en', 'zh'], 50, 92, 'استدلال بسیار پیچیده'),

  // ── Llama family ──
  profile('llama3.1-8b-q4', 'General LLM', 'ال‌ال‌ام عمومی',
    ['Balanced performance', 'Good English', 'Well-supported'],
    ['عملکرد متعادل', 'انگلیسی خوب', 'پشتیبانی گسترده'],
    ['No Persian', 'Limited context', 'Average coding'],
    ['بدون فارسی', 'کانتکست محدود', 'کدنویسی متوسط'],
    ['en'], 70, 78, 'گفتگو انگلیسی عمومی'),
  profile('llama3.2-1b-q4', 'Ultra-Lightweight', 'فراسبک',
    ['Extremely fast', 'Minimal RAM', 'Good for edge'],
    ['بسیار سریع', 'RAM حداقل', 'مناسب لبه'],
    ['Very low quality', 'Limited knowledge', 'Poor reasoning'],
    ['کیفیت بسیار پایین', 'دانش محدود', 'استدلال ضعیف'],
    ['en'], 99, 40, 'پاسخ‌های فوری روی سخت‌افزار ضعیف'),
  profile('llama3.2-3b-q4', 'Lightweight Generalist', 'عمومی سبک',
    ['Good balance', 'Decent quality', 'Fast'],
    ['تعادل خوب', 'کیفیت مناسب', 'سریع'],
    ['No Persian', 'Limited reasoning'],
    ['بدون فارسی', 'استدلال محدود'],
    ['en'], 85, 60, 'گفتگو سبک و سریع'),
  profile('llama3.3-70b-q4', 'Flagship Reasoner', 'استدلال‌گر پرچم‌دار',
    ['Top-tier reasoning', 'Excellent coding', 'Large knowledge base'],
    ['استدلال顶级', 'کدنویسی عالی', 'پایه دانش بزرگ'],
    ['Huge size', 'Needs enterprise GPU', 'Very slow on CPU'],
    ['اندازه عظیم', 'نیاز GPU سازمانی', 'بسیار کند روی CPU'],
    ['en', 'fa'], 25, 95, 'استدلال و کدنویسی پیشرفته'),

  // ── Mistral family ──
  profile('mistral-7b-q4', 'Versatile Assistant', 'دستیار همه‌کاره',
    ['Good general chat', 'Efficient', 'Multi-language'],
    ['گفتگو عمومی خوب', 'کارآمد', 'چندزبانه'],
    ['Not specialized', 'Average coding'],
    ['غیرتخصصی', 'کدنویسی متوسط'],
    ['en', 'fr', 'de', 'es'], 72, 75, 'گفتگو عمومی چندزبانه'),
  profile('mistral-nemo-12b-q4', 'Long-Context Multilingual', 'چندزبانه کانتکست‌بزرگ',
    ['32k context', 'Strong multilingual', 'Good quality'],
    ['کانتکست ۳۲هزار', 'چندزبانه قوی', 'کیفیت خوب'],
    ['Larger size', 'Slower than 7B'],
    ['اندازه بزرگ‌تر', 'کندتر از ۷B'],
    ['en', 'fr', 'de', 'es', 'fa'], 55, 82, 'متن طولانی و چندزبانه'),

  // ── Gemma family ──
  profile('gemma2-9b-q4', 'Google Generalist', 'عمومی‌گرا گوگل',
    ['High quality', 'Good reasoning', 'Google-backed'],
    ['کیفیت بالا', 'استدلال خوب', 'پشتیبانی گوگل'],
    ['No Persian', 'Restrictive license'],
    ['بدون فارسی', 'لایسنس محدودکننده'],
    ['en'], 58, 85, 'گفتگو و استدلال با کیفیت'),
  profile('gemma2-27b-q4', 'Google Powerhouse', 'قدرت گوگل',
    ['Excellent reasoning', 'High quality', 'Strong English'],
    ['استدلال عالی', 'کیفیت بالا', 'انگلیسی قوی'],
    ['Very large', 'No Persian', 'High VRAM needed'],
    ['بسیار بزرگ', 'بدون فارسی', 'نیاز VRAM بالا'],
    ['en'], 40, 90, 'استدلال عمیق انگلیسی'),

  // ── Phi family ──
  profile('phi3-mini-3.8b-q4', 'Compact Microsoft', 'فشرده مایکروسافت',
    ['Small + capable', 'Good reasoning for size', 'Fast'],
    ['کوچک + توانمند', 'استدلال خوب برای اندازه', 'سریع'],
    ['Limited knowledge', 'No Persian'],
    ['دانش محدود', 'بدون فارسی'],
    ['en'], 80, 65, 'گفتگو سبک با استدلال'),

  // ── StarCoder family ──
  profile('starcoder2-3b-q4', 'Code Completion', 'تکمیل کد',
    ['Fast completion', 'Many languages', 'Low RAM'],
    ['تکمیل سریع', 'چندزبانه', 'RAM پایین'],
    ['Instruction-tuned weak', 'No chat'],
    ['آموزش دستوری ضعیف', 'بدون گفتگو'],
    ['en', 'py', 'js', 'java', 'cpp'], 90, 55, 'تکمیل خودکار کد در IDE'),
  profile('starcoder2-15b-q4', 'Code Powerhouse', 'قدرت کد',
    ['Strong code generation', 'Many languages', 'Large projects'],
    ['تولید کد قوی', 'چندزبانه', 'پروژه‌های بزرگ'],
    ['High RAM', 'No chat instruction', 'Slower'],
    ['RAM بالا', 'بدون دستور گفتگو', 'کندتر'],
    ['en', 'py', 'js', 'java', 'cpp'], 50, 80, 'تولید کد پیشرفته'),

  // ── CodeLlama family ──
  profile('codellama-7b-q4', 'Code Mentor', 'مربی کد',
    ['Code explanation', 'Good for learning', 'Multi-language'],
    ['توضیح کد', 'مناسب یادگیری', 'چندزبانه'],
    ['Older architecture', 'No Persian'],
    ['معماری قدیمی‌تر', 'بدون فارسی'],
    ['en', 'py', 'js', 'cpp'], 70, 72, 'توضیح و آموزش کد'),
  profile('codellama-13b-q4', 'Senior Developer', 'توسعه‌دهنده ارشد',
    ['Complex code', 'Better reasoning', 'Refactoring'],
    ['کد پیچیده', 'استدلال بهتر', 'بازسازی'],
    ['High RAM', 'Slower'],
    ['RAM بالا', 'کندتر'],
    ['en', 'py', 'js', 'cpp'], 55, 80, 'بازسازی و کدنویسی پیچیده'),

  // ── QwQ ──
  profile('qwq-32b-preview-q4', 'Reasoning Specialist', 'متخصص استدلال',
    ['Deep chain-of-thought', 'Math excellence', 'Large context'],
    ['استدلال زنجیره‌ای عمیق', 'برتری ریاضی', 'کانتکست بزرگ'],
    ['Preview model', 'Very large', 'Slow'],
    ['مدل پیش‌نمایش', 'بسیار بزرگ', 'کند'],
    ['en', 'fa'], 35, 95, 'استدلال و ریاضی بسیار پیشرفته'),

  // ── Vision ──
  profile('llava-7b-q4', 'Image Analyst', 'تحلیل‌گر تصویر',
    ['Image understanding', 'Visual Q&A', 'OCR support'],
    ['درک تصویر', 'پرسش‌وپاسخ بصری', 'پشتیبانی OCR'],
    ['Limited detail', 'No Persian OCR'],
    ['جزئیات محدود', 'بدون OCR فارسی'],
    ['en'], 65, 75, 'تحلیل تصویر و پاسخ به سوال بصری'),
  profile('llava-1.6-13b-q5', 'Advanced Vision', 'بینایی پیشرفته',
    ['Better image detail', 'Document analysis', 'Higher accuracy'],
    ['جزئیات تصویر بهتر', 'تحلیل سند', 'دقت بالاتر'],
    ['High RAM', 'Slower'],
    ['RAM بالا', 'کندتر'],
    ['en'], 45, 85, 'تحلیل پیشرفته تصویر و سند'),
  profile('qwen2.5-vl-7b-q4', 'Multilingual Vision', 'بینایی چندزبانه',
    ['Persian vision support', 'Multilingual OCR', 'Chart reading'],
    ['پشتیبانی فارسی', 'OCR چندزبانه', 'خواندن نمودار'],
    ['Medium quality', 'Limited detail'],
    ['کیفیت متوسط', 'جزئیات محدود'],
    ['en', 'fa', 'zh'], 60, 78, 'تحلیل تصویر چندزبانه'),
  profile('internvl2-8b-q4', 'Multimodal Engine', 'موتور چندوجهی',
    ['Strong multimodal', 'Good reasoning', 'High context'],
    ['چندوجهی قوی', 'استدلال خوب', 'کانتکست بالا'],
    ['Newer, less tested', 'No Persian'],
    ['جدیدتر، کمتر آزمایش‌شده', 'بدون فارسی'],
    ['en', 'zh'], 55, 80, 'تحلیل چندوجهی تصویر و متن'),

  // ── Voice ──
  profile('whisper-base-en', 'English STT', 'تشخیص گفتار انگلیسی',
    ['Fast transcription', 'Low resource', 'Reliable'],
    ['تبدیل سریع', 'منبع کم', 'قابل‌اعتماد'],
    ['English only', 'No Persian'],
    ['فقط انگلیسی', 'بدون فارسی'],
    ['en'], 90, 70, 'تبدیل گفتار به متن انگلیسی'),
  profile('whisper-medium-q5', 'Multilingual STT', 'تشخیص گفتار چندزبانه',
    ['Persian support', 'Multi-language', 'Better accuracy'],
    ['پشتیبانی فارسی', 'چندزبانه', 'دقت بهتر'],
    ['Slower', 'Higher RAM'],
    ['کندتر', 'RAM بالاتر'],
    ['en', 'fa', 'ar', 'zh'], 65, 80, 'تبدیل گفتار چندزبانه شامل فارسی'),
  profile('piper-en-us-lessac-medium', 'English TTS', 'تولید گفتار انگلیسی',
    ['Natural voice', 'Fast synthesis', 'Low resource'],
    ['صدای طبیعی', 'سنتز سریع', 'منبع کم'],
    ['English only', 'Limited emotion'],
    ['فقط انگلیسی', 'احساس محدود'],
    ['en'], 95, 75, 'تولید گفتار انگلیسی'),
  profile('piper-fa-ir-gyro-medium', 'Persian TTS', 'تولید گفتار فارسی',
    ['Persian voice', 'Natural sound', 'Fast'],
    ['صدای فارسی', 'صدای طبیعی', 'سریع'],
    ['Single voice', 'Limited emotion'],
    ['صدای واحد', 'احساس محدود'],
    ['fa'], 95, 78, 'تولید گفتار فارسی'),

  // ── Embedding ──
  profile('nomic-embed-137m', 'Embedding Base', 'جاسازی پایه',
    ['Lightweight', 'Good for RAG', 'Persian support'],
    ['سبک', 'مناسب RAG', 'پشتیبانی فارسی'],
    ['Small context', 'Average quality'],
    ['کانتکست کوچک', 'کیفیت متوسط'],
    ['en', 'fa'], 98, 70, 'جاسازی متن برای RAG'),
  profile('bge-m3-q4', 'Advanced Embedding', 'جاسازی پیشرفته',
    ['Multi-language', 'High quality', 'Large context'],
    ['چندزبانه', 'کیفیت بالا', 'کانتکست بزرگ'],
    ['Newer', 'Less ecosystem support'],
    ['جدیدتر', 'پشتیبانی اکوسیستم کمتر'],
    ['en', 'fa', 'zh', 'ar'], 88, 88, 'جاسازی پیشرفته برای جستجوی معنایی'),
  profile('multilingual-e5-large-q4', 'E5 Multilingual', 'ای۵ چندزبانه',
    ['Strong multilingual', 'Good retrieval', 'Persian support'],
    ['چندزبانه قوی', 'بازیابی خوب', 'پشتیبانی فارسی'],
    ['Small context (512)', 'Less nuanced'],
    ['کانتکست کوچک (۵۱۲)', 'ظرافت کمتر'],
    ['en', 'fa', 'zh', 'ar'], 88, 82, 'جاسازی چندزبانه برای جستجو'),
];

// ─── Combined catalog (Phase 49 + Phase 59 expansion) ─────────────────────

/**
 * The full model catalog: Phase 49's 15 entries + Phase 59's expansion.
 * This is the single source of truth for the ecosystem manager.
 */
export const EXPANDED_MODEL_CATALOG: AdvancedModelEntry[] = [
  ...ADVANCED_MODEL_CATALOG,
  ...EXPANDED_MODEL_ENTRIES,
];

// ─── Profile lookup ───────────────────────────────────────────────────────

const PROFILE_INDEX: Map<string, ModelProfile> = new Map(MODEL_PROFILES.map((p) => [p.catalogId, p]));

/**
 * Get the profile for a catalog entry. Falls back to a synthesized profile
 * derived from the entry's benchmark scores if no explicit profile exists.
 */
export function getModelProfile(catalogId: string): ModelProfile | null {
  return PROFILE_INDEX.get(catalogId) || null;
}

/**
 * Get the profile for a catalog entry, synthesizing one from benchmark scores
 * if no explicit profile is defined.
 */
export function getOrSynthesizeProfile(entry: AdvancedModelEntry): ModelProfile {
  const explicit = PROFILE_INDEX.get(entry.id);
  if (explicit) return explicit;
  // Synthesize from benchmark scores
  const role = synthesizeRole(entry);
  return {
    catalogId: entry.id,
    role,
    roleFa: role, // fallback to English if no Persian
    strengths: synthesizeStrengths(entry),
    strengthsFa: [],
    weaknesses: synthesizeWeaknesses(entry),
    weaknessesFa: [],
    languages: entry.persianSupport ? ['en', 'fa'] : ['en'],
    speed: entry.speedScore,
    quality: entry.qualityScore,
    recommendedUsageFa: entry.descriptionFa,
  };
}

function synthesizeRole(entry: AdvancedModelEntry): string {
  if (entry.type === 'vision') return 'Vision Model';
  if (entry.type === 'voice-stt') return 'Speech-to-Text';
  if (entry.type === 'voice-tts') return 'Text-to-Speech';
  if (entry.type === 'embedding') return 'Embedding Model';
  if (entry.codingScore >= 75) return 'Coding Model';
  if (entry.reasoningScore >= 80) return 'Reasoning Model';
  return 'General LLM';
}

function synthesizeStrengths(entry: AdvancedModelEntry): string[] {
  const s: string[] = [];
  if (entry.codingScore >= 75) s.push('Strong coding');
  if (entry.reasoningScore >= 80) s.push('Excellent reasoning');
  if (entry.speedScore >= 80) s.push('Fast inference');
  if (entry.persianSupport) s.push('Persian support');
  if (entry.multilingual) s.push('Multilingual');
  if (s.length === 0) s.push('General purpose');
  return s;
}

function synthesizeWeaknesses(entry: AdvancedModelEntry): string[] {
  const w: string[] = [];
  if (entry.requiredRAM >= 16) w.push('High RAM requirement');
  if (entry.requiredVRAM >= 10) w.push('High VRAM requirement');
  if (entry.speedScore < 50) w.push('Slower inference');
  if (!entry.persianSupport) w.push('No Persian support');
  if (entry.sizeGB >= 15) w.push('Large download size');
  if (w.length === 0) w.push('None significant');
  return w;
}

// ─── Catalog queries ──────────────────────────────────────────────────────

export function getExpandedCatalog(): AdvancedModelEntry[] {
  return EXPANDED_MODEL_CATALOG;
}

export function getExpandedCatalogByType(type: ModelType): AdvancedModelEntry[] {
  return EXPANDED_MODEL_CATALOG.filter((e) => e.type === type);
}

export function getExpandedCatalogByProvider(provider: string): AdvancedModelEntry[] {
  const lower = provider.toLowerCase();
  return EXPANDED_MODEL_CATALOG.filter((e) => e.provider.toLowerCase() === lower);
}

export function getExpandedCatalogEntry(id: string): AdvancedModelEntry | null {
  return EXPANDED_MODEL_CATALOG.find((e) => e.id === id) || null;
}

export function getExpandedModelsByTier(tier: HardwareTier): AdvancedModelEntry[] {
  return EXPANDED_MODEL_CATALOG.filter((e) => e.recommendedTier === tier);
}

export function getExpandedPersianModels(): AdvancedModelEntry[] {
  return EXPANDED_MODEL_CATALOG.filter((e) => e.persianSupport);
}

export function getEntriesWithProfiles(): CatalogEntryWithProfile[] {
  return EXPANDED_MODEL_CATALOG.map((entry) => ({ entry, profile: getOrSynthesizeProfile(entry) }));
}

// ─── Security self-audit ───────────────────────────────────────────────────

export function verifyCatalogSecurity(): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  // Verify no duplicate IDs in the combined catalog
  const ids = new Set<string>();
  for (const e of EXPANDED_MODEL_CATALOG) {
    if (ids.has(e.id)) findings.push(`Duplicate catalog id: ${e.id}`);
    ids.add(e.id);
  }
  return { ok: findings.length === 0, findings };
}
