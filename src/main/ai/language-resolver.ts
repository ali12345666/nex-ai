/**
 * NEX AI — Language Resolver (Phase 116 JARVIS)
 *
 * Extends the existing language-foundation.ts detectLanguage() with:
 *   - Context-aware language detection (uses conversation history)
 *   - Keyword-based detection (common Persian/English words)
 *   - Script-based detection (existing regex approach — fast path)
 *   - LLM-based detection (fallback for ambiguous cases — only if model is loaded)
 *
 * All detection methods are LOCAL — no external API calls.
 * LLM-based detection uses the already-loaded local Qwen3 model, so it
 * adds zero network dependency and minimal latency (only for ambiguous cases).
 *
 * Architecture:
 *   resolveLanguage(text, context)
 *     → fastPath: script-based detection (Persian/Arabic chars vs Latin)
 *     → mediumPath: keyword-based detection (common words)
 *     → slowPath: LLM-based detection (only if model is loaded + ambiguous)
 *     → fallback: context-based (use last detected language)
 */

import { detectLanguage, type DetectedLanguage, type LanguageDetectionResult } from './language-foundation';

export interface LanguageContext {
  /** Previous messages in the conversation (for context-based detection) */
  recentMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Last detected language (for continuity) */
  lastLanguage?: DetectedLanguage;
  /** Whether the local LLM is loaded and available */
  llmAvailable?: boolean;
}

export interface LanguageResolutionResult extends LanguageDetectionResult {
  /** Which detection method was used */
  method: 'script' | 'keyword' | 'context' | 'llm' | 'fallback';
  /** Whether LLM was used for this detection */
  usedLLM: boolean;
}

// ─── Keyword-based detection ────────────────────────────────────────────────

// Common Persian words/phrases that indicate the user is speaking Persian
const PERSIAN_KEYWORDS = [
  // Greetings
  'سلام', 'درود', 'خسته', 'صبح', 'شب',
  // Common words
  'چطور', 'چیست', 'چیست؟', 'کجاست', 'کی', 'کجا', 'چرا', 'چگونه',
  'می‌خوام', 'می‌کنم', 'می‌شود', 'کنید', 'کن', 'بساز', 'بخوان', 'باز',
  'پوشه', 'فایل', 'پروژه', 'کد', 'نصب', 'اجرا', 'تست', 'دیباگ',
  'تغییر', 'اصلاح', 'ایجاد', 'حذف', 'نمایش', 'نشون', 'بگو', 'ببین',
  'یادت', 'باشد', 'باشه', 'فراموش', 'مرسی', 'ممنون', 'خداحافظ',
  'خوبی', 'چطوری', 'حال', 'درباره', 'برای', 'یک', 'این', 'اون',
  // Agent commands
  'بساز', 'بخوان', 'بازش', 'نشون', 'محتویات', 'تغییر', 'اصلاح',
  'بسته', 'پوشه', 'فایل', 'بنویس', 'پیدا', 'جستجو', 'اینترنت',
];

// Common English words/phrases
const ENGLISH_KEYWORDS = [
  'hello', 'hi', 'hey', 'how', 'what', 'where', 'when', 'why', 'who',
  'please', 'thanks', 'thank', 'create', 'read', 'write', 'edit', 'delete',
  'file', 'folder', 'project', 'code', 'install', 'build', 'run', 'test',
  'debug', 'fix', 'change', 'update', 'search', 'find', 'open', 'show',
  'help', 'can', 'you', 'the', 'this', 'that', 'with', 'for', 'from',
  'remember', 'forget', 'yes', 'no', 'ok', 'sure', 'done', 'completed',
  'error', 'failed', 'success', 'cancel', 'stop', 'start', 'close',
];

/**
 * Keyword-based language detection.
 * Counts how many Persian vs English keywords appear in the text.
 * Returns null if no keywords found (inconclusive).
 */
function detectByKeywords(text: string): DetectedLanguage | null {
  const lower = text.toLowerCase();
  let persianCount = 0;
  let englishCount = 0;

  for (const kw of PERSIAN_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      persianCount++;
    }
  }

  for (const kw of ENGLISH_KEYWORDS) {
    // Word boundary check for English
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    if (regex.test(lower)) {
      englishCount++;
    }
  }

  if (persianCount === 0 && englishCount === 0) return null;

  if (persianCount > englishCount * 1.5) return 'fa';
  if (englishCount > persianCount * 1.5) return 'en';
  if (persianCount > 0 && englishCount > 0) return 'mixed';

  return null; // inconclusive
}

/**
 * Context-based language detection.
 * Uses the last detected language as a fallback when the current text is
 * ambiguous (e.g. short, no script indicators, no keywords).
 */
function detectByContext(text: string, context: LanguageContext): DetectedLanguage | null {
  // If text is very short and has no script indicators, use context
  if (text.trim().length < 5) {
    return context.lastLanguage || null;
  }

  // Check if the recent conversation was predominantly in one language
  if (context.recentMessages && context.recentMessages.length > 0) {
    let persianMessages = 0;
    let englishMessages = 0;

    for (const msg of context.recentMessages.slice(-5)) {
      const result = detectLanguage(msg.content);
      if (result.language === 'fa') persianMessages++;
      else if (result.language === 'en') englishMessages++;
    }

    if (persianMessages > englishMessages * 2) return 'fa';
    if (englishMessages > persianMessages * 2) return 'en';
  }

  return context.lastLanguage || null;
}

/**
 * LLM-based language detection.
 * Only called when:
 *   1. The local model is loaded (llmAvailable === true)
 *   2. Script-based and keyword-based detection both failed
 *   3. Context doesn't provide a clear answer
 *
 * This is a very short LLM call — just "What language is this? Reply fa/en/mixed/unknown"
 * It uses the already-loaded local Qwen3 model, so no network dependency.
 *
 * NOTE: This function is a stub — the actual LLM call is made by the
 * interaction-loop or main.ts when needed. This keeps the language-resolver
 * pure (no direct imports of inference.ts to avoid circular dependencies).
 */
export async function detectByLLM(
  text: string,
  llmChat: (prompt: string) => Promise<string>,
): Promise<DetectedLanguage | null> {
  if (!text || text.trim().length < 3) return null;

  try {
    const prompt = `What language is this text written in? Reply with ONLY one word: fa, en, mixed, or unknown.\n\nText: ${text.substring(0, 200)}`;
    const response = await llmChat(prompt);
    const result = response.trim().toLowerCase();

    if (result.includes('fa')) return 'fa';
    if (result.includes('en')) return 'en';
    if (result.includes('mixed')) return 'mixed';

    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the language of a text using a multi-layer approach.
 *
 * Priority:
 *   1. Script-based detection (fastest — just counts Unicode characters)
 *   2. Keyword-based detection (medium — counts common words)
 *   3. Context-based detection (uses conversation history)
 *   4. LLM-based detection (slowest — only for ambiguous cases, only if model loaded)
 *   5. Fallback to last detected language
 *
 * @param text The text to detect the language of
 * @param context Optional context (recent messages, last language, LLM availability)
 * @param llmChat Optional LLM chat function (for slow-path detection)
 */
export async function resolveLanguage(
  text: string,
  context?: LanguageContext,
  llmChat?: (prompt: string) => Promise<string>,
): Promise<LanguageResolutionResult> {
  // Layer 1: Script-based detection (fast path)
  const scriptResult = detectLanguage(text);

  // If script-based detection is confident, use it
  if (scriptResult.confidence > 0.8 && scriptResult.language !== 'unknown' && scriptResult.language !== 'mixed') {
    return {
      ...scriptResult,
      method: 'script',
      usedLLM: false,
    };
  }

  // Layer 2: Keyword-based detection (medium path)
  const keywordResult = detectByKeywords(text);
  if (keywordResult) {
    return {
      ...scriptResult,
      language: keywordResult,
      method: 'keyword',
      usedLLM: false,
    };
  }

  // Layer 3: Context-based detection
  if (context) {
    const contextResult = detectByContext(text, context);
    if (contextResult) {
      return {
        ...scriptResult,
        language: contextResult,
        method: 'context',
        usedLLM: false,
      };
    }
  }

  // Layer 4: LLM-based detection (slow path — only if model is loaded)
  if (llmChat && context?.llmAvailable) {
    const llmResult = await detectByLLM(text, llmChat);
    if (llmResult) {
      return {
        ...scriptResult,
        language: llmResult,
        method: 'llm',
        usedLLM: true,
      };
    }
  }

  // Layer 5: Fallback — use script result (even if low confidence) or last language
  const fallbackLanguage = scriptResult.language !== 'unknown'
    ? scriptResult.language
    : (context?.lastLanguage || 'en');

  return {
    ...scriptResult,
    language: fallbackLanguage,
    method: 'fallback',
    usedLLM: false,
  };
}

/**
 * Synchronous version of resolveLanguage (without LLM fallback).
 * Uses only layers 1-3 (script, keyword, context).
 */
export function resolveLanguageSync(
  text: string,
  context?: LanguageContext,
): LanguageResolutionResult {
  // Layer 1: Script-based detection
  const scriptResult = detectLanguage(text);

  if (scriptResult.confidence > 0.8 && scriptResult.language !== 'unknown' && scriptResult.language !== 'mixed') {
    return { ...scriptResult, method: 'script', usedLLM: false };
  }

  // Layer 2: Keyword-based detection
  const keywordResult = detectByKeywords(text);
  if (keywordResult) {
    return { ...scriptResult, language: keywordResult, method: 'keyword', usedLLM: false };
  }

  // Layer 3: Context-based detection
  if (context) {
    const contextResult = detectByContext(text, context);
    if (contextResult) {
      return { ...scriptResult, language: contextResult, method: 'context', usedLLM: false };
    }
  }

  // Fallback
  const fallbackLanguage = scriptResult.language !== 'unknown'
    ? scriptResult.language
    : (context?.lastLanguage || 'en');

  return { ...scriptResult, language: fallbackLanguage, method: 'fallback', usedLLM: false };
}
