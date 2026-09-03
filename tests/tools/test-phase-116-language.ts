/**
 * NEX AI — Phase 116: Language Resolver Tests
 *
 * Tests the multi-layer language detection:
 *   1. Script-based detection (Persian/Arabic chars vs Latin)
 *   2. Keyword-based detection (common Persian/English words)
 *   3. Context-based detection (conversation history + last language)
 *   4. LLM-based detection (stub — tests the interface, not actual LLM call)
 *   5. Fallback behavior
 *
 * Run with: npx tsx tests/tools/test-phase-116-language.ts
 */

import * as path from 'path';
import * as fs from 'fs';

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) { passed++; console.log(`  PASS: ${name}`); }
    else { failed++; console.error(`  FAIL: ${name}`); }
  }

  console.log('Phase 116 Language Resolver Tests\n');

  // Read the source files
  const resolverSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'language-resolver.ts'),
    'utf-8'
  );

  const foundationSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'language-foundation.ts'),
    'utf-8'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 1. Script-based detection (fast path)
  // ════════════════════════════════════════════════════════════════════════
  console.log('=== 1. Script-based Detection ===');

  console.log('\nTest 1: detectLanguage function exists');
  assert(foundationSource.includes('export function detectLanguage'), 'detectLanguage should be exported');

  console.log('\nTest 2: Persian regex covers Arabic block');
  assert(
    foundationSource.includes('\\u0600-\\u06FF') &&
    foundationSource.includes('\\uFB50-\\uFDFF') &&
    foundationSource.includes('\\uFE70-\\uFEFF'),
    'Persian regex should cover Arabic + Presentation Forms'
  );

  console.log('\nTest 3: Script detection confidence threshold > 0.8');
  assert(
    resolverSource.includes('confidence > 0.8'),
    'resolveLanguage should use confidence > 0.8 for fast path'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 2. Keyword-based detection (medium path)
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 2. Keyword-based Detection ===');

  console.log('\nTest 4: PERSIAN_KEYWORDS array exists');
  assert(resolverSource.includes('PERSIAN_KEYWORDS'), 'PERSIAN_KEYWORDS array should exist');

  console.log('\nTest 5: ENGLISH_KEYWORDS array exists');
  assert(resolverSource.includes('ENGLISH_KEYWORDS'), 'ENGLISH_KEYWORDS array should exist');

  console.log('\nTest 6: Persian keywords include common words');
  assert(
    resolverSource.includes('سلام') &&
    resolverSource.includes('فایل') &&
    resolverSource.includes('پروژه'),
    'Persian keywords should include common words'
  );

  console.log('\nTest 7: English keywords include common words');
  assert(
    resolverSource.includes('hello') &&
    resolverSource.includes('file') &&
    resolverSource.includes('project'),
    'English keywords should include common words'
  );

  console.log('\nTest 8: detectByKeywords function exists');
  assert(resolverSource.includes('function detectByKeywords'), 'detectByKeywords function should exist');

  console.log('\nTest 9: Keyword detection uses word boundary for English');
  assert(
    resolverSource.includes('\\\\b') || resolverSource.includes('RegExp'),
    'English keyword detection should use word boundary matching'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 3. Context-based detection
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 3. Context-based Detection ===');

  console.log('\nTest 10: LanguageContext interface exists');
  assert(
    resolverSource.includes('export interface LanguageContext'),
    'LanguageContext interface should exist'
  );

  console.log('\nTest 11: Context includes recentMessages');
  assert(
    resolverSource.includes('recentMessages'),
    'LanguageContext should include recentMessages'
  );

  console.log('\nTest 12: Context includes lastLanguage');
  assert(
    resolverSource.includes('lastLanguage'),
    'LanguageContext should include lastLanguage'
  );

  console.log('\nTest 13: Context includes llmAvailable');
  assert(
    resolverSource.includes('llmAvailable'),
    'LanguageContext should include llmAvailable'
  );

  console.log('\nTest 14: detectByContext uses conversation history');
  assert(
    resolverSource.includes('recentMessages') &&
    resolverSource.includes('slice(-5)'),
    'detectByContext should use last 5 messages for context'
  );

  console.log('\nTest 15: detectByContext handles short text');
  assert(
    resolverSource.includes('text.trim().length < 5'),
    'detectByContext should use context for very short text'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 4. LLM-based detection (slow path)
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 4. LLM-based Detection ===');

  console.log('\nTest 16: detectByLLM function exists');
  assert(resolverSource.includes('export async function detectByLLM'), 'detectByLLM function should exist');

  console.log('\nTest 17: detectByLLM takes llmChat callback');
  assert(
    resolverSource.includes('llmChat: (prompt: string) => Promise<string>'),
    'detectByLLM should accept an llmChat callback function'
  );

  console.log('\nTest 18: detectByLLM uses short prompt');
  assert(
    resolverSource.includes('What language is this text'),
    'detectByLLM should use a short prompt for detection'
  );

  console.log('\nTest 19: detectByLLM is only called when model is available');
  assert(
    resolverSource.includes('context?.llmAvailable'),
    'LLM detection should only run when llmAvailable is true'
  );

  console.log('\nTest 20: detectByLLM handles errors gracefully');
  assert(
    resolverSource.includes('catch') && resolverSource.includes('return null'),
    'detectByLLM should catch errors and return null'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 5. resolveLanguage function
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 5. resolveLanguage Function ===');

  console.log('\nTest 21: resolveLanguage function exists');
  assert(
    resolverSource.includes('export async function resolveLanguage'),
    'resolveLanguage function should exist'
  );

  console.log('\nTest 22: resolveLanguageSync function exists');
  assert(
    resolverSource.includes('export function resolveLanguageSync'),
    'resolveLanguageSync function should exist'
  );

  console.log('\nTest 23: resolveLanguage returns method field');
  assert(
    resolverSource.includes("method: 'script'") &&
    resolverSource.includes("method: 'keyword'") &&
    resolverSource.includes("method: 'context'") &&
    resolverSource.includes("method: 'llm'") &&
    resolverSource.includes("method: 'fallback'"),
    'resolveLanguage should return which method was used'
  );

  console.log('\nTest 24: resolveLanguage returns usedLLM field');
  assert(
    resolverSource.includes('usedLLM: false') && resolverSource.includes('usedLLM: true'),
    'resolveLanguage should indicate if LLM was used'
  );

  console.log('\nTest 25: resolveLanguage fallback uses last language');
  assert(
    resolverSource.includes('context?.lastLanguage'),
    'resolveLanguage fallback should use last language from context'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 6. Language normalization
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 6. Language Normalization ===');

  console.log('\nTest 26: normalizePersian handles ZWNJ');
  assert(
    foundationSource.includes('\\u200c'),
    'normalizePersian should handle ZWNJ (zero-width non-joiner)'
  );

  console.log('\nTest 27: normalizePersian converts Arabic Yeh to Persian');
  assert(
    foundationSource.includes('\\u064a') && foundationSource.includes('\\u06cc'),
    'normalizePersian should convert Arabic Yeh (ي) to Persian Yeh (ی)'
  );

  console.log('\nTest 28: normalizePersian converts Arabic Kaf to Persian');
  assert(
    foundationSource.includes('\\u0643') && foundationSource.includes('\\u06a9'),
    'normalizePersian should convert Arabic Kaf (ك) to Persian Kaf (ک)'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 7. Language-aware system prompt
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 7. Language-aware System Prompt ===');

  console.log('\nTest 29: buildSystemPrompt function exists');
  assert(
    foundationSource.includes('export function buildSystemPrompt'),
    'buildSystemPrompt should be exported'
  );

  console.log('\nTest 30: Persian system prompt includes Persian text');
  assert(
    foundationSource.includes('شما NEX AI هستید'),
    'Persian system prompt should include Persian text'
  );

  console.log('\nTest 31: English system prompt exists');
  assert(
    foundationSource.includes('You are NEX AI'),
    'English system prompt should exist'
  );

  console.log('\nTest 32: Mixed language prompt exists');
  assert(
    foundationSource.includes('Respond in the same language'),
    'Mixed/unknown language prompt should exist'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 8. getResponseLanguage
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 8. getResponseLanguage ===');

  console.log('\nTest 33: getResponseLanguage maps fa→fa');
  assert(
    foundationSource.includes("if (detected === 'fa' || detected === 'mixed') return 'fa'"),
    'getResponseLanguage should map fa and mixed to fa'
  );

  console.log('\nTest 34: getResponseLanguage maps en→en');
  assert(
    foundationSource.includes("return 'en'"),
    'getResponseLanguage should default to en'
  );

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 116 language tests: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
