/**
 * NEX AI — Downloadable Model Catalog (Phase 72)
 *
 * Catalog of models with multi-source support. Each model can have multiple
 * verified download sources. When one source fails (e.g. HuggingFace CDN
 * blocked), the downloader automatically falls back to the next source.
 *
 * IMPORTANT: Only verified, real URLs are listed here. No fake mirrors.
 *
 * Sources verified in sandbox:
 *   - HuggingFace: works but redirects to us.aws.cdn.hf.co (blocked on some networks)
 *   - ModelScope: serves directly, no redirect, supports Range/resume
 *
 * Both serve the SAME file (491,400,032 bytes for Qwen2.5-0.5B Q4_K_M).
 */
import type { DownloadableModel } from './model-download-manager';

export const DOWNLOADABLE_MODELS: DownloadableModel[] = [
  {
    id: 'qwen2.5-0.5b-q4',
    name: 'Qwen2.5 0.5B Instruct Q4',
    nameFa: 'کیون ۲.۵ ۰.۵ میلیارد (سبک)',
    provider: 'qwen',
    parameterCount: '0.5B',
    quantization: 'Q4_K_M',
    architecture: 'qwen2',
    category: 'general',
    requiredRAM: 1,
    requiredVRAM: 0,
    persianSupport: true,
    filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    installationSubdir: 'llm',  // Phase 78: install to models/llm/
    description: 'Small, fast, CPU-compatible, Persian-capable — perfect for first run',
    descriptionFa: 'مدل سبک و سریع برای سخت‌افزار ضعیف — پشتیبانی فارسی',
    sources: [
      {
        type: 'huggingface',
        url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
        priority: 1,
        label: 'HuggingFace',
        expectedSize: 491400032,
      },
      {
        type: 'modelscope',
        url: 'https://modelscope.cn/api/v1/models/Qwen/Qwen2.5-0.5B-Instruct-GGUF/repo?Revision=master&FilePath=qwen2.5-0.5b-instruct-q4_k_m.gguf',
        priority: 2,
        label: 'ModelScope (Alibaba)',
        expectedSize: 491400032,
      },
    ],
  },
];

/**
 * Get a downloadable model by ID.
 */
export function getDownloadableModel(modelId: string): DownloadableModel | undefined {
  return DOWNLOADABLE_MODELS.find(m => m.id === modelId);
}

/**
 * Get the recommended first model (for first-run wizard).
 */
export function getRecommendedModel(): DownloadableModel {
  return DOWNLOADABLE_MODELS[0];
}
