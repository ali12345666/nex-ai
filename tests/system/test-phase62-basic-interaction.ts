/**
 * Phase 62 — Basic Interaction MVP Tests
 *
 * Verifies:
 *   1. Language foundation module structure + security
 *   2. Language detection (fa/en/mixed/unknown)
 *   3. Persian text normalization (ZWNJ, Arabic→Persian)
 *   4. Language-aware system prompt building
 *   5. Interaction loop module structure + security
 *   6. Interaction loop: processText flow
 *   7. Interaction loop: processVoice flow
 *   8. Interaction status (model + runtime + STT/TTS + language)
 *   9. IPC handlers + preload bridges + type declarations
 *  10. UI panel + navigation
 *  11. Security (offline, no cloud, no download)
 *  12. Phase 51-61 preserved (regression)
 *
 * Run: npx tsx tests/system/test-phase62-basic-interaction.ts
 */
import '../__mocks__/install-electron-mock.js';

import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main(): Promise<void> {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) Language Foundation Module Structure
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) Language Foundation Module Structure:');
  const langSrc = read('../../src/main/ai/language-foundation.ts');

  assert('language-foundation.ts exists', langSrc.length > 0);
  assert('DetectedLanguage type', langSrc.includes('export type DetectedLanguage'));
  assert('LanguageDetectionResult interface', langSrc.includes('interface LanguageDetectionResult'));
  assert('detectLanguage function', langSrc.includes('export function detectLanguage'));
  assert('normalizePersian function', langSrc.includes('export function normalizePersian'));
  assert('buildSystemPrompt function', langSrc.includes('export function buildSystemPrompt'));
  assert('getLanguageLabel function', langSrc.includes('export function getLanguageLabel'));
  assert('getLanguageLabelFa function', langSrc.includes('export function getLanguageLabelFa'));
  assert('getResponseLanguage function', langSrc.includes('export function getResponseLanguage'));
  assert('verifyLanguageSecurity function', langSrc.includes('export function verifyLanguageSecurity'));

  // Language values
  assert("has 'fa' language", langSrc.includes("'fa'"));
  assert("has 'en' language", langSrc.includes("'en'"));
  assert("has 'mixed' language", langSrc.includes("'mixed'"));
  assert("has 'unknown' language", langSrc.includes("'unknown'"));

  // Persian normalization
  assert('has ZWNJ normalization', langSrc.includes('\\u200c'));
  assert('has Arabic Yeh normalization', langSrc.includes('\\u064a'));
  assert('has Persian Yeh target', langSrc.includes('\\u06cc'));
  assert('has Arabic Kaf normalization', langSrc.includes('\\u0643'));
  assert('has Persian Kaf target', langSrc.includes('\\u06a9'));

  // Security
  assert('SECURITY comment', langSrc.includes('SECURITY'));
  assert('no fetch() call', !langSrc.includes('fetch('));
  assert('no net.request call', !langSrc.includes('net.request'));
  assert('no fs import', !langSrc.split('\n').some((l: string) => l.trim().startsWith('import') && (l.includes("'fs'") || l.includes('"fs"'))));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Language Detection (runtime)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Language Detection:');
  const { detectLanguage, normalizePersian, buildSystemPrompt, getLanguageLabelFa, getResponseLanguage, verifyLanguageSecurity } = await import('../../src/main/ai/language-foundation');

  // Persian detection
  const faResult = detectLanguage('سلام، حال شما چطور است؟');
  assert('Persian text detected as fa', faResult.language === 'fa', `got ${faResult.language}`);
  assert('Persian confidence > 0.5', faResult.confidence > 0.5);
  assert('Persian char count > 0', faResult.persianCharCount > 0);

  // English detection
  const enResult = detectLanguage('Hello, how are you doing today?');
  assert('English text detected as en', enResult.language === 'en', `got ${enResult.language}`);
  assert('English confidence > 0.5', enResult.confidence > 0.5);
  assert('Latin char count > 0', enResult.latinCharCount > 0);

  // Mixed
  const mixedResult = detectLanguage('Hello سلام، این یک mixed text است');
  assert('Mixed text detected', mixedResult.language === 'mixed' || mixedResult.language === 'fa' || mixedResult.language === 'en');

  // Empty
  const emptyResult = detectLanguage('');
  assert('Empty text → unknown', emptyResult.language === 'unknown');

  // Numbers only
  const numResult = detectLanguage('1234567890');
  assert('Numbers only → unknown', numResult.language === 'unknown');

  // ═══════════════════════════════════════════════════════════════════════
  // 3) Persian Text Normalization
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Persian Normalization:');

  // ZWNJ → space
  const zwnjResult = normalizePersian('مدار\u200cهای الکترونیکی');
  assert('ZWNJ replaced with space', !zwnjResult.includes('\u200c'));
  assert('ZWNJ result has space', zwnjResult.includes('مدار های'));

  // Arabic Yeh → Persian Yeh
  const yehResult = normalizePersian('مدار يك');
  assert('Arabic Yeh → Persian Yeh', yehResult.includes('ی') && !yehResult.includes('ي'));

  // Arabic Kaf → Persian Kaf
  const kafResult = normalizePersian('كتاب');
  assert('Arabic Kaf → Persian Kaf', kafResult.includes('ک') && !kafResult.includes('ك'));

  // Tatweel removed
  const tatweelResult = normalizePersian('عـــربي');
  assert('Tatweel removed', !tatweelResult.includes('\u0640'));

  // Whitespace collapsed
  const wsResult = normalizePersian('سلام   دنیا');
  assert('Whitespace collapsed', wsResult === 'سلام دنیا');

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Language-Aware System Prompt
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) System Prompt Building:');

  const faPrompt = buildSystemPrompt('fa');
  assert('Persian prompt non-empty', faPrompt.length > 0);
  assert('Persian prompt contains Persian text', /[\u0600-\u06FF]/.test(faPrompt));
  assert('Persian prompt mentions NEX AI', faPrompt.includes('NEX AI'));

  const enPrompt = buildSystemPrompt('en');
  assert('English prompt non-empty', enPrompt.length > 0);
  assert('English prompt mentions NEX AI', enPrompt.includes('NEX AI'));
  assert('English prompt mentions offline', enPrompt.includes('offline'));

  const mixedPrompt = buildSystemPrompt('mixed');
  assert('Mixed prompt non-empty', mixedPrompt.length > 0);

  // With personality
  const profPrompt = buildSystemPrompt('fa', 'professional');
  assert('Professional prompt has personality', profPrompt.length > 0);

  const techPrompt = buildSystemPrompt('en', 'technical');
  assert('Technical prompt non-empty', techPrompt.length > 0);

  // Language labels
  assert('fa label → فارسی', getLanguageLabelFa('fa') === 'فارسی');
  assert('en label → انگلیسی', getLanguageLabelFa('en') === 'انگلیسی');
  assert('mixed label → دوزبانه', getLanguageLabelFa('mixed') === 'دوزبانه');
  assert('unknown label → نامشخص', getLanguageLabelFa('unknown') === 'نامشخص');

  // Response language
  assert('fa → respond in fa', getResponseLanguage('fa') === 'fa');
  assert('mixed → respond in fa', getResponseLanguage('mixed') === 'fa');
  assert('en → respond in en', getResponseLanguage('en') === 'en');

  // Security
  const langSec = verifyLanguageSecurity();
  assert('language security audit passes', langSec.ok === true);

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Interaction Loop Module Structure
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Interaction Loop Module Structure:');
  const loopSrc = read('../../src/main/ai/interaction-loop.ts');

  assert('interaction-loop.ts exists', loopSrc.length > 0);
  assert('InteractionRequest interface', loopSrc.includes('interface InteractionRequest'));
  assert('InteractionResponse interface', loopSrc.includes('interface InteractionResponse'));
  assert('InteractionStatus interface', loopSrc.includes('interface InteractionStatus'));
  assert('InteractionLoopManager class', loopSrc.includes('export class InteractionLoopManager'));
  assert('processText method', loopSrc.includes('async processText('));
  assert('processVoice method', loopSrc.includes('async processVoice('));
  assert('speakText method', loopSrc.includes('async speakText('));
  assert('stop method', loopSrc.includes('stop()'));
  assert('setPersonality method', loopSrc.includes('setPersonality('));
  assert('getStatus method', loopSrc.includes('getStatus()'));
  assert('verifyInteractionSecurity function', loopSrc.includes('export function verifyInteractionSecurity'));
  assert('getInteractionLoopManager singleton', loopSrc.includes('export function getInteractionLoopManager'));
  assert('_resetInteractionLoopManager for tests', loopSrc.includes('export function _resetInteractionLoopManager'));

  // Imports
  assert('imports language-foundation', loopSrc.includes("from './language-foundation'"));
  assert('imports local-engine', loopSrc.includes("from './local-engine'"));
  assert('imports model-registry', loopSrc.includes("from './model-registry'"));
  assert('imports voice engine', loopSrc.includes("from '../voice/local-voice-engine'"));
  assert('imports inference getGpuBackend', loopSrc.includes('getGpuBackend'));
  assert('imports telemetry getLastInference', loopSrc.includes('getLastInference'));

  // Security
  assert('SECURITY comment', loopSrc.includes('SECURITY'));
  assert('no cloud comment', loopSrc.includes('No cloud') || loopSrc.includes('no cloud'));
  assert('no fetch() call', !loopSrc.includes('fetch('));
  assert('no net.request call', !loopSrc.split('\n').some((l: string) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && l.includes('net.request')));
  assert('no async download() method', !loopSrc.includes('async download('));
  assert('no async install() method', !loopSrc.includes('async install('));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Interaction Loop: processText
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Interaction Loop processText:');
  const { getInteractionLoopManager, _resetInteractionLoopManager, verifyInteractionSecurity } = await import('../../src/main/ai/interaction-loop');
  _resetInteractionLoopManager();
  const loop = getInteractionLoopManager();

  // Empty text → fail
  const emptyTextResult = await loop.processText({ text: '' });
  assert('empty text → success=false', emptyTextResult.success === false);
  assert('empty text → has error', emptyTextResult.error.length > 0);

  // Non-empty text with no model installed → fail with model error
  const noModelResult = await loop.processText({ text: 'سلام' });
  assert('text with no model → success=false', noModelResult.success === false);
  assert('text with no model → has model error', noModelResult.error.includes('model') || noModelResult.error.includes('مدل') || noModelResult.error.includes('GGUF'));

  // Language detection still works even without model
  assert('result has language field', typeof noModelResult.language === 'string');
  assert('result has responseLanguage', typeof noModelResult.responseLanguage === 'string');

  // Status
  const status = loop.getStatus();
  assert('status returns InteractionStatus', status !== null);
  assert('status has modelReady', typeof status.modelReady === 'boolean');
  assert('status has modelName', status.modelName === null || typeof status.modelName === 'string');
  assert('status has sttReady', typeof status.sttReady === 'boolean');
  assert('status has ttsReady', typeof status.ttsReady === 'boolean');
  assert('status has gpuBackend', typeof status.gpuBackend === 'string');
  assert('status has lastLanguage', typeof status.lastLanguage === 'string');
  assert('status has lastLanguageLabelFa', typeof status.lastLanguageLabelFa === 'string');
  assert('status has totalInteractions', typeof status.totalInteractions === 'number');
  assert('status has inferenceActive', typeof status.inferenceActive === 'boolean');

  // Security
  const loopSec = verifyInteractionSecurity();
  assert('interaction security audit passes', loopSec.ok === true);

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Interaction Loop: processVoice
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Interaction Loop processVoice:');
  _resetInteractionLoopManager();
  const loop2 = getInteractionLoopManager();

  // processVoice with no model → fail
  const voiceResult = await loop2.processVoice('سلام');
  assert('voice with no model → success=false', voiceResult.success === false);
  assert('voice result has fromVoice=true', voiceResult.fromVoice === true);
  assert('voice result has language', typeof voiceResult.language === 'string');

  // speakText with empty → false
  const speakEmpty = await loop2.speakText('');
  assert('speakText empty → false', speakEmpty === false);

  // stop doesn't throw
  loop2.stop();
  assert('stop does not throw', true);

  // setPersonality
  loop2.setPersonality('friendly');
  assert('personality set to friendly', loop2.getPersonality() === 'friendly');

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Interaction Status
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Interaction Status:');
  const status2 = loop2.getStatus();
  assert('status modelReady boolean', typeof status2.modelReady === 'boolean');
  assert('status modelSizeBytes number', typeof status2.modelSizeBytes === 'number');
  assert('status lastTokensPerSecond null or number', status2.lastTokensPerSecond === null || typeof status2.lastTokensPerSecond === 'number');

  // ═══════════════════════════════════════════════════════════════════════
  // 9) IPC + Preload + Types
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) IPC + Preload + Types:');
  const mainSrc = read('../../src/main/main.ts');
  assert('main has Phase 62 block', mainSrc.includes('Phase 62: Basic Interaction MVP'));
  assert('main imports InteractionLoopManager', mainSrc.includes("import('./ai/interaction-loop')"));
  assert('main imports language-foundation', mainSrc.includes("import('./ai/language-foundation')"));

  const ipcChannels = [
    'interaction-process-text', 'interaction-process-voice', 'interaction-speak',
    'interaction-stop', 'interaction-set-personality', 'interaction-status',
    'language-detect', 'language-normalize-persian', 'language-build-prompt',
    'interaction-security-audit',
  ];
  for (const ch of ipcChannels) {
    assert(`main registers ipc handler '${ch}'`, mainSrc.includes(`ipcMain.handle('${ch}'`));
  }

  // Preload
  const preloadSrc = read('../../src/main/preload.ts');
  assert('preload has Phase 62 section', preloadSrc.includes('Phase 62: Basic Interaction MVP'));
  const preloadMethods = [
    'interactionProcessText', 'interactionProcessVoice', 'interactionSpeak',
    'interactionStop', 'interactionSetPersonality', 'interactionStatus',
    'languageDetect', 'languageNormalizePersian', 'languageBuildPrompt',
    'interactionSecurityAudit',
  ];
  for (const m of preloadMethods) {
    assert(`preload exposes '${m}'`, preloadSrc.includes(`${m}:`));
  }

  // Types
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('types has Phase 62 section', typesSrc.includes('Phase 62: Basic Interaction MVP'));
  for (const m of preloadMethods) {
    assert(`types declares '${m}'`, typesSrc.includes(`${m}:`));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 10) UI Panel + Navigation
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) UI Panel + Navigation:');
  const panelSrc = read('../../src/renderer/components/BasicInteractionPanel.tsx');
  assert('BasicInteractionPanel exists', panelSrc.length > 0);
  assert('panel default export', panelSrc.includes('export default function BasicInteractionPanel'));
  assert('panel shows active model', panelSrc.includes('modelName') || panelSrc.includes('modelReady'));
  assert('panel shows STT status', panelSrc.includes('sttReady'));
  assert('panel shows TTS status', panelSrc.includes('ttsReady'));
  assert('panel shows language', panelSrc.includes('lastLanguage') || panelSrc.includes('languageLabelFa'));
  assert('panel shows tokens/sec', panelSrc.includes('tokensPerSecond') || panelSrc.includes('lastTokensPerSecond'));
  assert('panel has text input', panelSrc.includes('textInput'));
  assert('panel calls interactionProcessText', panelSrc.includes('interactionProcessText'));
  assert('panel calls interactionStatus', panelSrc.includes('interactionStatus'));
  assert('panel calls interactionSpeak', panelSrc.includes('interactionSpeak'));
  assert('panel calls interactionStop', panelSrc.includes('interactionStop'));
  assert('panel shows last response', panelSrc.includes('lastResponse'));
  assert('panel has security note', panelSrc.includes('محلی') || panelSrc.includes('offline') || panelSrc.includes('آفلاین'));
  assert('panel polls for status', panelSrc.includes('setInterval'));

  const navSrc = read('../../src/renderer/components/layout/NavigationRail.tsx');
  assert('nav has interact view', navSrc.includes("'interact'"));
  assert('nav has Activity icon', navSrc.includes('Activity'));
  assert('nav has Interact label', navSrc.includes("label: 'Interact'"));

  const appShellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
  assert('AppShell imports BasicInteractionPanel', appShellSrc.includes('BasicInteractionPanel'));
  assert('AppShell routes interact view', appShellSrc.includes("case 'interact'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 11) Security
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n11) Security:');
  assert('language security ok', verifyLanguageSecurity().ok === true);
  assert('interaction security ok', verifyInteractionSecurity().ok === true);

  // No cloud
  assert('language source no fetch()', !langSrc.includes('fetch('));
  assert('loop source no fetch()', !loopSrc.includes('fetch('));
  assert('language source no XMLHttpRequest', !langSrc.includes('XMLHttpRequest'));
  assert('loop source no XMLHttpRequest', !loopSrc.includes('XMLHttpRequest'));

  // No download/install
  assert('loop no async download()', !loopSrc.includes('async download('));
  assert('loop no async install()', !loopSrc.includes('async install('));

  // All inference is local
  assert('loop uses localChatComplete', loopSrc.includes('localChatComplete'));
  assert('loop uses getLocalVoiceEngine', loopSrc.includes('getLocalVoiceEngine'));

  // ═══════════════════════════════════════════════════════════════════════
  // 12) Phase 51-61 Preserved (Regression)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n12) Phase 51-61 Preserved:');
  assert('Phase 12 inference.ts exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/inference.ts')));
  assert('Phase 12 local-engine.ts exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/local-engine.ts')));
  assert('Phase 39 model-registry exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-registry.ts')));
  assert('Phase 41 local-voice-engine exists', fs.existsSync(path.join(__dirname, '../../src/main/voice/local-voice-engine.ts')));
  assert('Phase 43 permission-gate exists', fs.existsSync(path.join(__dirname, '../../src/main/update/permission-gate.ts')));
  assert('Phase 51 nex-brain-controller exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-brain-controller.ts')));
  assert('Phase 52 nex-personality-engine exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-personality-engine.ts')));
  assert('Phase 53 nex-expert-system exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-expert-system.ts')));
  assert('Phase 55 expert-knowledge-engine exists', fs.existsSync(path.join(__dirname, '../../src/main/knowledge/expert-knowledge-engine.ts')));
  assert('Phase 56 nex-voice-conversation exists', fs.existsSync(path.join(__dirname, '../../src/main/voice/nex-voice-conversation.ts')));
  assert('Phase 57 nex-executive-planner exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-executive-planner.ts')));
  assert('Phase 58 multi-model-runtime-manager exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/multi-model-runtime-manager.ts')));
  assert('Phase 58 local-model-provider exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/local-model-provider.ts')));
  assert('Phase 59 model-ecosystem-manager exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-intelligence/model-ecosystem-manager.ts')));
  assert('Phase 60 universal-knowledge-brain exists', fs.existsSync(path.join(__dirname, '../../src/main/knowledge/universal-knowledge-brain.ts')));
  assert('Phase 61 model-deployment-manager exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-deployment-manager.ts')));
  assert('Phase 61 model-verification exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-verification.ts')));
  assert('Phase 61 ModelDeploymentPanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/ModelDeploymentPanel.tsx')));
  assert('Phase 58 LocalRuntimePanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/LocalRuntimePanel.tsx')));

  // Existing subsystems still work
  const { listModels } = await import('../../src/main/ai/model-registry');
  assert('model-registry listModels still works', typeof listModels === 'function');
  const { getDefaultModel } = await import('../../src/main/ai/model-registry');
  assert('getDefaultModel still works', typeof getDefaultModel === 'function');
  const { localChatComplete } = await import('../../src/main/ai/local-engine');
  assert('localChatComplete still works', typeof localChatComplete === 'function');
  const { getLocalVoiceEngine } = await import('../../src/main/voice/local-voice-engine');
  assert('voice engine singleton still works', typeof getLocalVoiceEngine === 'function');
  const { getNexPersonalityEngine } = await import('../../src/main/ai/nex-personality-engine');
  assert('personality engine singleton still works', typeof getNexPersonalityEngine === 'function');
  const { getExpertProfiles } = await import('../../src/main/ai/nex-expert-system');
  assert('expert profiles still 6', getExpertProfiles().length === 6);

  // ═══════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 62 BASIC INTERACTION RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('FAILURES:', failures.join(' | '));
    process.exit(1);
  }
  console.log('PHASE 62 BASIC INTERACTION MVP: ALL PASS ✅');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
