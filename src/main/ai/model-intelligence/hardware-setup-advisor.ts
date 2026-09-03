/**
 * NEX AI — Hardware Setup Advisor (Phase 49)
 *
 * Analyzes hardware and generates the optimal AI setup configuration.
 * Recommends a package of models based on the user's hardware tier:
 *   low → small/fast models (0.5B, Whisper Base, Piper)
 *   medium → 7B models (Qwen Coder 7B, Whisper Medium, LLaVA 7B)
 *   high → large models (14B/32B, Whisper Medium, LLaVA 13B)
 *
 * CRITICAL: Only RECOMMENDS — never downloads/installs.
 */

import { detectHardwareProfile, type HardwareProfile } from '../hardware-model-recommender';
import { getAdvancedCatalog, type AdvancedModelEntry, type HardwareTier } from './advanced-model-catalog';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface HardwareSetup {
  tier: HardwareTier;
  tierLabel: string;
  tierLabelFa: string;
  profile: HardwareProfile;
  recommendedPackage: ModelPackage;
  alternativePackages: ModelPackage[];
  totalDownloadSize: number;
  totalStorageRequired: number;
  canRun: boolean;
  warnings: string[];
}

export interface ModelPackage {
  id: string;
  name: string;
  nameFa: string;
  descriptionFa: string;
  models: AdvancedModelEntry[];
  totalSizeGB: number;
  tier: HardwareTier;
  isCustom: boolean;
}

export interface InstallPlan {
  package: ModelPackage;
  totalDownloadGB: number;
  totalStorageGB: number;
  components: Array<{
    name: string;
    nameFa: string;
    sizeGB: number;
    type: string;
    url: string;
    targetDir: string;
    filename: string;
  }>;
  permissionRequired: boolean;
}

// ─── Hardware Setup Advisor ────────────────────────────────────────────────

export class HardwareSetupAdvisor {
  /**
   * Analyze hardware and generate the optimal AI setup.
   */
  analyze(): HardwareSetup {
    const profile = detectHardwareProfile();
    const tier = this.classifyHardwareTier(profile);
    const recommendedPackage = this.generatePackage(tier);
    const alternativePackages = this.generateAlternativePackages(tier);

    const totalDownloadSize = recommendedPackage.models.reduce((sum, m) => sum + m.sizeGB, 0);
    // Storage = download + extraction overhead (~1.5x)
    const totalStorageRequired = totalDownloadSize * 1.5;

    const warnings: string[] = [];
    const ramGB = profile.ramTotalBytes / 1e9;
    if (ramGB < 8) warnings.push('RAM کمتر از ۸ گیگابایت است — مدل‌های بزرگ ممکن است کند اجرا شوند');
    if (!profile.gpu) warnings.push('GPU تشخیص داده نشد — فقط CPU استفاده می‌شود');
    if (profile.gpu && (profile.gpu.vramTotalBytes / 1e9) < 4) {
      warnings.push('VRAM کمتر از ۴ گیگابایت است — شاید نتوانید لایه‌های GPU را استفاده کنید');
    }

    return {
      tier,
      tierLabel: tier === 'low' ? 'Low-end' : tier === 'medium' ? 'Mid-range' : 'High-end',
      tierLabelFa: tier === 'low' ? 'سخت‌افزار سبک' : tier === 'medium' ? 'سخت‌افزار متوسط' : 'سخت‌افزار قدرتمند',
      profile,
      recommendedPackage,
      alternativePackages,
      totalDownloadSize,
      totalStorageRequired,
      canRun: true,
      warnings,
    };
  }

  /**
   * Classify hardware into low/medium/high tier.
   */
  classifyHardwareTier(profile: HardwareProfile): HardwareTier {
    const ramGB = profile.ramTotalBytes / 1e9;
    const vramGB = profile.gpu?.vramTotalBytes ? profile.gpu.vramTotalBytes / 1e9 : 0;

    // High: 32GB+ RAM + 8GB+ VRAM
    if (ramGB >= 32 && (vramGB >= 8 || !profile.gpu)) return 'high';
    // Medium: 8GB+ RAM + 4GB+ VRAM (or 16GB+ CPU-only)
    if (ramGB >= 8 && (vramGB >= 4 || ramGB >= 16)) return 'medium';
    // Low: anything below
    return 'low';
  }

  /**
   * Generate the recommended package for a hardware tier.
   */
  generatePackage(tier: HardwareTier): ModelPackage {
    const catalog = getAdvancedCatalog();
    const models: AdvancedModelEntry[] = [];

    // LLM
    if (tier === 'low') {
      models.push(catalog.find((m) => m.id === 'qwen2.5-0.5b-q4')!);
    } else if (tier === 'medium') {
      models.push(catalog.find((m) => m.id === 'qwen2.5-coder-7b-q5')!);
    } else {
      models.push(catalog.find((m) => m.id === 'qwen2.5-coder-14b-q5')!);
    }

    // Voice STT
    if (tier === 'low') {
      models.push(catalog.find((m) => m.id === 'whisper-base-en')!);
    } else {
      models.push(catalog.find((m) => m.id === 'whisper-medium-q5')!);
    }

    // Voice TTS
    models.push(catalog.find((m) => m.id === 'piper-en-us-lessac-medium')!);
    // Persian TTS
    models.push(catalog.find((m) => m.id === 'piper-fa-ir-gyro-medium')!);

    // Vision (skip for low tier — too heavy)
    if (tier !== 'low') {
      models.push(catalog.find((m) => m.id === 'llava-7b-q4')!);
    }

    // Embedding
    models.push(catalog.find((m) => m.id === 'nomic-embed-137m')!);

    const totalSizeGB = models.reduce((sum, m) => sum + m.sizeGB, 0);

    const names: Record<HardwareTier, { name: string; nameFa: string; desc: string }> = {
      low: { name: 'Lightweight Setup', nameFa: 'نصب سبک', desc: 'مناسب برای سخت‌افزار ضعیف — مدل‌های کوچک و سریع' },
      medium: { name: 'Professional Coding Setup', nameFa: 'نصب حرفه‌ای برنامه‌نویسی', desc: 'بهترین ترکیب برای برنامه‌نویسی با مدل‌های ۷ میلیارد پارامتری' },
      high: { name: 'Power User Setup', nameFa: 'نصب حرفه‌ای پیشرفته', desc: 'قدرتمندترین مدل‌ها برای پروژه‌های پیچیده' },
    };

    return {
      id: `package-${tier}`,
      name: names[tier].name,
      nameFa: names[tier].nameFa,
      descriptionFa: names[tier].desc,
      models,
      totalSizeGB,
      tier,
      isCustom: false,
    };
  }

  /**
   * Generate alternative packages for the user to choose from.
   */
  generateAlternativePackages(tier: HardwareTier): ModelPackage[] {
    const alternatives: ModelPackage[] = [];

    // Chat-only package (no coding focus)
    const chatModels: AdvancedModelEntry[] = [];
    const chatLlm = tier === 'low' ? 'qwen2.5-0.5b-q4' : tier === 'medium' ? 'qwen2.5-7b-q4' : 'qwen2.5-32b-q4';
    chatModels.push(getAdvancedCatalog().find((m) => m.id === chatLlm)!);
    chatModels.push(getAdvancedCatalog().find((m) => m.id === 'nomic-embed-137m')!);
    alternatives.push({
      id: 'package-chat-only',
      name: 'Chat Only',
      nameFa: 'فقط گفتگو',
      descriptionFa: 'حداقل نصب برای گفتگو و سوالات عمومی',
      models: chatModels,
      totalSizeGB: chatModels.reduce((s, m) => s + m.sizeGB, 0),
      tier,
      isCustom: false,
    });

    // Coding-only package
    const codingModels: AdvancedModelEntry[] = [];
    const codingLlm = tier === 'low' ? 'qwen2.5-0.5b-q4' : tier === 'medium' ? 'qwen2.5-coder-7b-q5' : 'qwen2.5-coder-14b-q5';
    codingModels.push(getAdvancedCatalog().find((m) => m.id === codingLlm)!);
    codingModels.push(getAdvancedCatalog().find((m) => m.id === 'nomic-embed-137m')!);
    alternatives.push({
      id: 'package-coding-only',
      name: 'Coding Only',
      nameFa: 'فقط برنامه‌نویسی',
      descriptionFa: 'حداقل نصب برای برنامه‌نویسی',
      models: codingModels,
      totalSizeGB: codingModels.reduce((s, m) => s + m.sizeGB, 0),
      tier,
      isCustom: false,
    });

    return alternatives;
  }

  /**
   * Generate an installation plan from a selected package.
   */
  generateInstallPlan(pkg: ModelPackage): InstallPlan {
    const totalDownloadGB = pkg.totalSizeGB;
    const totalStorageGB = totalDownloadGB * 1.5;
    return {
      package: pkg,
      totalDownloadGB,
      totalStorageGB,
      components: pkg.models.map((m) => ({
        name: m.name,
        nameFa: m.displayNameFa,
        sizeGB: m.sizeGB,
        type: m.type,
        url: m.downloadUrl,
        targetDir: m.targetDir,
        filename: m.filename,
      })),
      permissionRequired: true,
    };
  }

  /**
   * Create a custom package from user-selected model IDs.
   */
  createCustomPackage(modelIds: string[], tier: HardwareTier): ModelPackage {
    const catalog = getAdvancedCatalog();
    const models = modelIds
      .map((id) => catalog.find((m) => m.id === id))
      .filter((m): m is AdvancedModelEntry => m !== undefined);
    return {
      id: 'package-custom',
      name: 'Custom Setup',
      nameFa: 'نصب سفارشی',
      descriptionFa: 'انتخاب دستی کامپوننت‌ها',
      models,
      totalSizeGB: models.reduce((s, m) => s + m.sizeGB, 0),
      tier,
      isCustom: true,
    };
  }

  /**
   * Generate a Persian first-launch summary.
   */
  generateFirstLaunchSummary(setup: HardwareSetup): string {
    const lines: string[] = [];
    lines.push('سلام، سیستم شما را بررسی کردم');
    lines.push('');
    lines.push(`سخت‌افزار: ${setup.tierLabelFa}`);
    lines.push(`CPU: ${setup.profile.cpuCores} هسته`);
    lines.push(`RAM: ${(setup.profile.ramTotalBytes / 1e9).toFixed(1)} گیگابایت`);
    if (setup.profile.gpu) {
      lines.push(`GPU: ${setup.profile.gpu.name}`);
      lines.push(`VRAM: ${(setup.profile.gpu.vramTotalBytes / 1e9).toFixed(1)} گیگابایت`);
    } else {
      lines.push('GPU: ندارد (فقط CPU)');
    }
    lines.push('');
    lines.push(`پیشنهاد: ${setup.recommendedPackage.nameFa}`);
    lines.push(setup.recommendedPackage.descriptionFa);
    lines.push('');
    lines.push('کامپوننت‌های پیشنهادی:');
    for (const m of setup.recommendedPackage.models) {
      lines.push(`  ✓ ${m.displayNameFa} (${m.sizeGB.toFixed(1)} GB)`);
    }
    lines.push('');
    lines.push(`حجم کل دانلود: ${setup.totalDownloadSize.toFixed(1)} گیگابایت`);
    lines.push(`فضای مورد نیاز: ${setup.totalStorageRequired.toFixed(1)} گیگابایت`);
    if (setup.warnings.length > 0) {
      lines.push('');
      lines.push('هشدارها:');
      for (const w of setup.warnings) {
        lines.push(`  ⚠️ ${w}`);
      }
    }
    return lines.join('\n');
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _advisor: HardwareSetupAdvisor | null = null;

export function getHardwareSetupAdvisor(): HardwareSetupAdvisor {
  if (!_advisor) {
    _advisor = new HardwareSetupAdvisor();
  }
  return _advisor;
}
