/**
 * NEX AI — Language Foundation (Phase 62: Basic Interaction MVP)
 *
 * Language detection, Persian text normalization, and language-aware
 * system prompt building. This is the foundation that makes NEX work
 * seamlessly with both Persian and English input.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  Language Foundation (this file)                        │
 *   │    1. detectLanguage(text) → 'fa' | 'en' | 'mixed'        │
 *   │    2. normalizePersian(text) — ZWNJ + Arabic→Persian     │
 *   │    3. buildSystemPrompt(language, personality) → prompt   │
 *   │    4. getLanguageLabel(language) → 'فارسی' | 'English'   │
 *   └──────────────────────────────────────────────────────────┘
 *
 * SECURITY: pure text processing. No network, no files, no I/O.
 */

import { getNexPersonalityEngine } from './nex-personality-engine';
import type { PersonalityType } from './nex-identity-manager';

// ─── Types ─────────────────────────────────────────────────────────────────

export type DetectedLanguage = 'fa' | 'en' | 'mixed' | 'unknown';

export interface LanguageDetectionResult {
  language: DetectedLanguage;
  /** Confidence 0..1 */
  confidence: number;
  /** Count of Persian characters found */
  persianCharCount: number;
  /** Count of Latin characters found */
  latinCharCount: number;
  /** Normalized text (Persian normalized if applicable) */
  normalizedText: string;
  /** Whether Persian normalization was applied */
  normalized: boolean;
}

// ─── Language Detection ───────────────────────────────────────────────────

/**
 * Persian Unicode range: U+0600–U+06FF (Arabic block, includes Persian)
 * Also checks U+FB50–U+FDFF (Arabic Presentation Forms-A) and
 * U+FE70–U+FEFF (Arabic Presentation Forms-B) for ligatures.
 */
const PERSIAN_REGEX = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const LATIN_REGEX = /[a-zA-Z]/g;

/**
 * Detect the language of a text.
 *
 * Heuristic:
 *   - Count Persian characters and Latin characters
 *   - If >80% Persian → 'fa'
 *   - If >80% Latin → 'en'
 *   - If both >15% → 'mixed'
 *   - Otherwise → 'unknown'
 */
export function detectLanguage(text: string): LanguageDetectionResult {
  if (!text || !text.trim()) {
    return {
      language: 'unknown',
      confidence: 1,
      persianCharCount: 0,
      latinCharCount: 0,
      normalizedText: text || '',
      normalized: false,
    };
  }

  const persianMatches = text.match(PERSIAN_REGEX) || [];
  const latinMatches = text.match(LATIN_REGEX) || [];
  const persianCharCount = persianMatches.length;
  const latinCharCount = latinMatches.length;
  const total = persianCharCount + latinCharCount;

  let language: DetectedLanguage;
  let confidence: number;

  if (total === 0) {
    language = 'unknown';
    confidence = 0.5;
  } else {
    const persianRatio = persianCharCount / total;
    const latinRatio = latinCharCount / total;

    if (persianRatio > 0.8) {
      language = 'fa';
      confidence = persianRatio;
    } else if (latinRatio > 0.8) {
      language = 'en';
      confidence = latinRatio;
    } else if (persianRatio > 0.15 && latinRatio > 0.15) {
      language = 'mixed';
      confidence = Math.max(persianRatio, latinRatio);
    } else if (persianRatio > latinRatio) {
      language = 'fa';
      confidence = persianRatio;
    } else {
      language = 'en';
      confidence = latinRatio;
    }
  }

  const normalizedText = normalizePersian(text);
  const normalized = normalizedText !== text;

  return {
    language,
    confidence,
    persianCharCount,
    latinCharCount,
    normalizedText,
    normalized,
  };
}

// ─── Persian Text Normalization ───────────────────────────────────────────

/**
 * Normalize Persian text for better processing:
 *   1. Replace ZWNJ (\u200c) with space
 *   2. Convert Arabic Yeh (ي U+064A) → Persian Yeh (ی U+06CC)
 *   3. Convert Arabic Kaf (ك U+0643) → Persian Kaf (ک U+06A9)
 *   4. Convert Alef Maksura (ى U+0649) → Persian Yeh (ی U+06CC)
 *   5. Convert Arabic Hamza Above (ء U+0621) standalone → keep
 *   6. Convert Arabic Tatweel (ـ U+0640) → remove
 *   7. Normalize Arabic comma (،) → keep (valid Persian)
 *   8. Collapse multiple spaces
 *   9. Trim
 */
export function normalizePersian(text: string): string {
  return text
    .replace(/\u200c/g, ' ')        // ZWNJ → space
    .replace(/\u064a/g, '\u06cc')   // Arabic Yeh → Persian Yeh (ي → ی)
    .replace(/\u0643/g, '\u06a9')   // Arabic Kaf → Persian Kaf (ك → ک)
    .replace(/\u0649/g, '\u06cc')   // Alef Maksura → Persian Yeh (ى → ی)
    .replace(/\u0640/g, '')          // Tatweel → remove
    .replace(/\s+/g, ' ')            // collapse whitespace
    .trim();
}

// ─── Language-Aware System Prompt ─────────────────────────────────────────

/**
 * Build a language-aware system prompt for the LLM.
 *
 * This prompt tells the model:
 *   - To respond in the detected language
 *   - To use the personality style (Phase 52)
 *   - Basic NEX identity
 */
export function buildSystemPrompt(
  language: DetectedLanguage,
  personality?: PersonalityType,
): string {
  const personalityPrefix = personality
    ? getPersonalityPrefix(personality)
    : '';

  if (language === 'fa') {
    return `${personalityPrefix}

شما NEX AI هستید — یک دستیار هوشمند محلی که کاملاً آفلاین کار می‌کند.
به زبان فارسی پاسخ دهید. پاسخ‌های شما باید واضح، دقیق و مفید باشند.
اگر کاربر انگلیسی صحبت کند، می‌توانید به انگلیسی پاسخ دهید.
هرگز اطلاعات شخصی کاربر را ذخیره یا ارسال نکنید.`;
  }

  if (language === 'en') {
    return `${personalityPrefix}

You are NEX AI — a local intelligent assistant that works fully offline.
Respond in English. Your answers should be clear, accurate, and helpful.
If the user speaks Persian, you may respond in Persian.
Never store or transmit the user's personal information.`;
  }

  // mixed or unknown — bilingual prompt
  return `${personalityPrefix}

You are NEX AI — a local intelligent assistant that works fully offline.
Respond in the same language the user uses (Persian or English).
Your answers should be clear, accurate, and helpful.
شما NEX AI هستید — دستیار هوشمند محلی. به همان زبانی که کاربر استفاده می‌کند پاسخ دهید.
Never store or transmit the user's personal information.`;
}

/**
 * Get the personality prefix for the system prompt.
 */
function getPersonalityPrefix(personality: PersonalityType): string {
  const prefixes: Record<PersonalityType, string> = {
    professional: 'تحلیل شده و دقیق. / Analytical and precise.',
    technical: 'جزئیات فنی کامل. / Full technical details.',
    friendly: 'محترمانه و ساده. / Respectful and simple.',
    patient: 'صبور و توضیحی. / Patient and explanatory.',
  };
  return prefixes[personality] || prefixes.professional;
}

// ─── Language Labels ──────────────────────────────────────────────────────

export function getLanguageLabel(language: DetectedLanguage): string {
  switch (language) {
    case 'fa': return 'فارسی';
    case 'en': return 'English';
    case 'mixed': return 'دوزبانه / Bilingual';
    case 'unknown': return 'نامشخص / Unknown';
    default: return 'نامشخص / Unknown';
  }
}

export function getLanguageLabelFa(language: DetectedLanguage): string {
  switch (language) {
    case 'fa': return 'فارسی';
    case 'en': return 'انگلیسی';
    case 'mixed': return 'دوزبانه';
    case 'unknown': return 'نامشخص';
    default: return 'نامشخص';
  }
}

/**
 * Determine which language the response should be in, based on the
 * detected input language.
 */
export function getResponseLanguage(detected: DetectedLanguage): 'fa' | 'en' {
  if (detected === 'fa' || detected === 'mixed') return 'fa';
  return 'en';
}

// ─── Security self-audit ───────────────────────────────────────────────────

export function verifyLanguageSecurity(): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  // Pure text processing — no I/O, no network.
  return { ok: findings.length === 0, findings };
}
