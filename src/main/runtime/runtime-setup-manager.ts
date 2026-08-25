/**
 * NEX AI — Runtime Setup Manager (Phase 46)
 *
 * Detects installed components, recommends missing ones, and guides
 * the user through first-run setup. NEVER downloads/installs autonomously.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { detectHardwareProfile, type HardwareProfile } from '../ai/hardware-model-recommender';
import { listModels } from '../ai/model-registry';
import { findWhisperBinary, findFfmpegBinary } from '../voice/local-whisper-provider';
import { findPiperBinary } from '../voice/local-piper-provider';
import { findLlamaBinary } from '../vision/local-llava-provider';
import { getCatalog, type CatalogComponent } from './component-catalog';

// ─── Types ─────────────────────────────────────────────────────────────────

export type ComponentStatus = 'installed' | 'missing' | 'partial' | 'unknown';

export interface DetectedComponent {
  catalogId: string;
  name: string;
  type: string;
  status: ComponentStatus;
  /** Path where it was found (if installed). */
  path?: string;
  /** Size in bytes (if installed). */
  sizeBytes?: number;
  purpose: string;
  purposeFa: string;
  isEssential: boolean;
}

export interface RuntimeSetupState {
  os: string;
  isPortable: boolean;
  hardware: HardwareProfile;
  components: DetectedComponent[];
  essentialMissing: number;
  optionalMissing: number;
  totalInstalled: number;
  totalMissing: number;
  recommendations: ComponentRecommendation[];
}

export interface ComponentRecommendation {
  component: CatalogComponent;
  reason: string;
  reasonFa: string;
  canRun: boolean;
  hardwareFit: 'perfect' | 'good' | 'tight' | 'insufficient';
}

// ─── Runtime Setup Manager ──────────────────────────────────────────────────

export class RuntimeSetupManager {
  /**
   * Scan the system for all installed components.
   * This is a READ-ONLY operation — no downloads, no installs.
   */
  scanSystem(): RuntimeSetupState {
    const hw = detectHardwareProfile();
    const os_platform = process.platform;
    const isPortable = this.checkPortableMode();
    const components = this.detectAllComponents(hw);
    const recommendations = this.generateRecommendations(hw, components);

    const essentialMissing = components.filter((c) => c.isEssential && c.status !== 'installed').length;
    const optionalMissing = components.filter((c) => !c.isEssential && c.status !== 'installed').length;
    const totalInstalled = components.filter((c) => c.status === 'installed').length;
    const totalMissing = components.filter((c) => c.status !== 'installed').length;

    return {
      os: os_platform,
      isPortable,
      hardware: hw,
      components,
      essentialMissing,
      optionalMissing,
      totalInstalled,
      totalMissing,
      recommendations,
    };
  }

  /**
   * Detect all installed components (LLM models, whisper, piper, llama.cpp, ffmpeg).
   */
  private detectAllComponents(hw: HardwareProfile): DetectedComponent[] {
    const detected: DetectedComponent[] = [];
    const catalog = getCatalog();

    // ── Detect installed LLM models ──
    const installedModels = listModels();
    for (const cat of catalog.filter((c) => c.type === 'llm')) {
      const match = installedModels.find((m) =>
        m.name.toLowerCase().includes(cat.name.toLowerCase().split(' q')[0]) ||
        m.path.toLowerCase().includes(cat.filename.toLowerCase().split('.')[0])
      );
      detected.push({
        catalogId: cat.id,
        name: cat.name,
        type: cat.type,
        status: match ? 'installed' : 'missing',
        path: match?.path,
        sizeBytes: match?.sizeBytes,
        purpose: cat.purpose,
        purposeFa: cat.purposeFa,
        isEssential: cat.isEssential,
      });
    }

    // ── Detect whisper binary ──
    const whisperBin = findWhisperBinary();
    detected.push({
      catalogId: 'whisper-base-en',
      name: 'Whisper Base (English)',
      type: 'voice-stt',
      status: whisperBin ? 'installed' : 'missing',
      path: whisperBin || undefined,
      purpose: 'Fast English speech-to-text',
      purposeFa: 'تبدیل گفتار به متن انگلیسی (سریع)',
      isEssential: false,
    });

    // ── Detect whisper model files ──
    const whisperModelPaths = this.findModelFiles('models/whisper', ['.bin']);
    const whisperMedium = whisperModelPaths.some((p) => p.includes('medium'));
    detected.push({
      catalogId: 'whisper-medium-q5',
      name: 'Whisper Medium Q5 (Multilingual)',
      type: 'voice-stt',
      status: whisperMedium ? 'installed' : (whisperBin ? 'partial' : 'missing'),
      purpose: 'High-quality multilingual speech-to-text',
      purposeFa: 'تبدیل گفتار به متن چندزبانه (باکیفیت)',
      isEssential: false,
    });

    // ── Detect piper binary ──
    const piperBin = findPiperBinary();
    const piperVoices = this.findModelFiles('models/piper', ['.onnx']);
    detected.push({
      catalogId: 'piper-en-us-lessac-medium',
      name: 'Piper Voice (en-US, lessac, medium)',
      type: 'voice-tts',
      status: (piperBin && piperVoices.length > 0) ? 'installed' : (piperBin ? 'partial' : 'missing'),
      path: piperBin || undefined,
      purpose: 'Natural English text-to-speech',
      purposeFa: 'تبدیل متن به گفتار انگلیسی (طبیعی)',
      isEssential: false,
    });

    // ── Detect llama.cpp binary ──
    const llamaBin = findLlamaBinary();
    detected.push({
      catalogId: 'llama-cpp',
      name: 'llama.cpp Runtime',
      type: 'tool',
      status: llamaBin ? 'installed' : 'missing',
      path: llamaBin || undefined,
      purpose: 'Local LLM inference engine (required for LLaVA vision)',
      purposeFa: 'موتور اجرای LLM محلی (لازم برای LLaVA)',
      isEssential: true,
    });

    // ── Detect LLaVA vision model ──
    const visionModels = this.findModelFiles('models/vision', ['.gguf']);
    detected.push({
      catalogId: 'llava-7b-q4',
      name: 'LLaVA 7B Q4',
      type: 'vision',
      status: visionModels.length > 0 ? 'installed' : 'missing',
      purpose: 'Image analysis, OCR, screenshot understanding',
      purposeFa: 'تحلیل تصویر، OCR، درک اسکرین‌شات',
      isEssential: false,
    });

    // ── Detect ffmpeg ──
    const ffmpegBin = findFfmpegBinary();
    detected.push({
      catalogId: 'ffmpeg',
      name: 'FFmpeg',
      type: 'tool',
      status: ffmpegBin ? 'installed' : 'missing',
      path: ffmpegBin || undefined,
      purpose: 'Audio/video processing (required for whisper resampling)',
      purposeFa: 'پردازش صوت/تصویر (لازم برای resampling)',
      isEssential: false,
    });

    return detected;
  }

  /**
   * Generate recommendations for missing components based on hardware.
   */
  private generateRecommendations(hw: HardwareProfile, components: DetectedComponent[]): ComponentRecommendation[] {
    const catalog = getCatalog();
    const recs: ComponentRecommendation[] = [];

    for (const cat of catalog) {
      // Skip if already installed
      const installed = components.find((c) => c.catalogId === cat.id && c.status === 'installed');
      if (installed) continue;

      // Check hardware fit
      const ramTotalGB = hw.ramTotalBytes / 1e9;
      const vramTotalGB = hw.gpu?.vramTotalBytes ? hw.gpu.vramTotalBytes / 1e9 : 0;

      let fit: 'perfect' | 'good' | 'tight' | 'insufficient' = 'insufficient';
      if (ramTotalGB >= cat.recommendedRAM && (cat.requiredVRAM === 0 || vramTotalGB >= cat.recommendedVRAM)) {
        fit = 'perfect';
      } else if (ramTotalGB >= cat.requiredRAM && (cat.requiredVRAM === 0 || vramTotalGB >= cat.requiredVRAM)) {
        fit = 'good';
      } else if (ramTotalGB >= cat.requiredRAM * 0.8) {
        fit = 'tight';
      }

      const canRun = ramTotalGB >= cat.requiredRAM && (cat.requiredVRAM === 0 || vramTotalGB >= cat.requiredVRAM);

      if (!canRun) continue; // skip if hardware insufficient

      const reasonFa = this.generateReasonFa(cat, hw, fit);
      const reason = this.generateReason(cat, hw, fit);

      recs.push({
        component: cat,
        reason,
        reasonFa,
        canRun,
        hardwareFit: fit,
      });
    }

    return recs;
  }

  private generateReasonFa(cat: CatalogComponent, hw: HardwareProfile, fit: string): string {
    const lines: string[] = [];
    lines.push(`پیشنهاد: ${cat.name}`);
    lines.push(`دلیل: ${cat.purposeFa}`);
    lines.push(`حجم: ${(cat.sizeBytes / 1e9).toFixed(1)} گیگابایت`);
    if (cat.requiredVRAM > 0 && hw.gpu) {
      lines.push(`نیاز VRAM: ${cat.requiredVRAM} گیگابایت (شما: ${(hw.gpu.vramTotalBytes / 1e9).toFixed(1)} گیگابایت)`);
    }
    lines.push(`تطابق سخت‌افزار: ${fit === 'perfect' ? 'عالی' : fit === 'good' ? 'خوب' : 'حداقل'}`);
    return lines.join('\n');
  }

  private generateReason(cat: CatalogComponent, hw: HardwareProfile, fit: string): string {
    const lines: string[] = [];
    lines.push(`Recommended: ${cat.name}`);
    lines.push(`Reason: ${cat.purpose}`);
    lines.push(`Size: ${(cat.sizeBytes / 1e9).toFixed(1)} GB`);
    if (cat.requiredVRAM > 0 && hw.gpu) {
      lines.push(`VRAM needed: ${cat.requiredVRAM} GB (you have: ${(hw.gpu.vramTotalBytes / 1e9).toFixed(1)} GB)`);
    }
    lines.push(`Hardware fit: ${fit}`);
    return lines.join('\n');
  }

  /**
   * Find model files in a directory (relative to userData).
   */
  private findModelFiles(relDir: string, extensions: string[]): string[] {
    try {
      const { getUserDataDir } = require('../persistence');
      const baseDir = path.join(getUserDataDir(), relDir);
      if (!fs.existsSync(baseDir)) return [];
      const files = fs.readdirSync(baseDir);
      return files
        .filter((f: string) => extensions.some((ext) => f.toLowerCase().endsWith(ext)))
        .map((f: string) => path.join(baseDir, f));
    } catch {
      return [];
    }
  }

  /**
   * Check if the app is running in portable mode.
   */
  private checkPortableMode(): boolean {
    try {
      const appDir = path.dirname(process.execPath);
      const marker = path.join(appDir, 'portable.txt');
      return fs.existsSync(marker);
    } catch {
      return false;
    }
  }

  /**
   * Generate a human-readable setup summary (Persian).
   */
  generateSetupSummary(state: RuntimeSetupState): string {
    const lines: string[] = [];
    lines.push('سلام، NEX AI را برای اولین اجرا آماده می‌کنیم');
    lines.push('');
    lines.push('سیستم:');
    lines.push(`CPU: ${state.hardware.cpuCores} هسته`);
    lines.push(`RAM: ${(state.hardware.ramTotalBytes / 1e9).toFixed(1)} گیگابایت`);
    if (state.hardware.gpu) {
      lines.push(`GPU: ${state.hardware.gpu.name}`);
      lines.push(`VRAM: ${(state.hardware.gpu.vramTotalBytes / 1e9).toFixed(1)} گیگابایت`);
    } else {
      lines.push('GPU: ندارد (فقط CPU)');
    }
    lines.push(`OS: ${state.os}`);
    lines.push(`Portable: ${state.isPortable ? 'بله' : 'خیر'}`);
    lines.push('');
    lines.push('وضعیت کامپوننت‌ها:');
    for (const c of state.components) {
      const icon = c.status === 'installed' ? '✓' : c.status === 'partial' ? '~' : '✗';
      lines.push(`${icon} ${c.name} — ${c.purposeFa}`);
    }
    lines.push('');
    if (state.essentialMissing > 0) {
      lines.push(`⚠️ ${state.essentialMissing} کامپوننت ضروری نصب نشده است`);
    } else {
      lines.push('✓ تمام کامپوننت‌های ضروری نصب شده‌اند');
    }
    if (state.optionalMissing > 0) {
      lines.push(`${state.optionalMissing} کامپوننت اختیاری در دسترس است`);
    }
    return lines.join('\n');
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _manager: RuntimeSetupManager | null = null;

export function getRuntimeSetupManager(): RuntimeSetupManager {
  if (!_manager) {
    _manager = new RuntimeSetupManager();
  }
  return _manager;
}
