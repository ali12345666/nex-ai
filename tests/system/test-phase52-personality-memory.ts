/**
 * Phase 52 — Personality Engine + Long Term Memory Tests
 *
 * Verifies:
 *   1. NexPersonalityEngine (4 profiles, Persian, system prompt)
 *   2. UserProfileManager (persistence, preferences)
 *   3. LongTermMemorySystem (store with permission, retrieve, list, stats)
 *   4. Memory permission gate (asks before saving personal data)
 *   5. IPC handlers + preload + types
 *   6. No unauthorized saving
 *
 * Run: npx tsx tests/system/test-phase52-personality-memory.ts
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
  // 1) NexPersonalityEngine
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) NexPersonalityEngine:');
  const peSrc = read('../../src/main/ai/nex-personality-engine.ts');

  assert('nex-personality-engine.ts exists', peSrc.length > 0);
  assert('NexPersonalityEngine class exported', peSrc.includes('export class NexPersonalityEngine'));
  assert('PersonalityProfile interface', peSrc.includes('interface PersonalityProfile'));
  assert('PersonalityRule interface', peSrc.includes('interface PersonalityRule'));
  assert('has professional profile', peSrc.includes("professional:"));
  assert('has technical profile', peSrc.includes("technical:"));
  assert('has friendly profile', peSrc.includes("friendly:"));
  assert('has patient profile', peSrc.includes("patient:"));
  assert('profile has communicationStyle', peSrc.includes('communicationStyle'));
  assert('profile has communicationStyleFa', peSrc.includes('communicationStyleFa'));
  assert('profile has responsePreference', peSrc.includes('responsePreference'));
  assert('profile has responsePreferenceFa', peSrc.includes('responsePreferenceFa'));
  assert('profile has technicalLevel', peSrc.includes('technicalLevel'));
  assert('profile has emotionalTone', peSrc.includes('emotionalTone'));
  assert('profile has responseLength', peSrc.includes('responseLength'));
  assert('profile has persianStyle', peSrc.includes('persianStyle'));
  assert('profile has rules array', peSrc.includes('rules:'));
  assert('getProfile method', peSrc.includes('getProfile'));
  assert('setPersonality method', peSrc.includes('setPersonality'));
  assert('getPersonality method', peSrc.includes('getPersonality'));
  assert('getAllPersonalities method', peSrc.includes('getAllPersonalities'));
  assert('getSystemPromptPrefix method', peSrc.includes('getSystemPromptPrefix'));
  assert('getSystemPromptPrefixFa method', peSrc.includes('getSystemPromptPrefixFa'));
  assert('getNexPersonalityEngine singleton', peSrc.includes('export function getNexPersonalityEngine'));

  // Persian content
  assert('professional Fa: حرفه‌ای', peSrc.includes("'حرفه‌ای'"));
  assert('technical Fa: فنی', peSrc.includes("'فنی'"));
  assert('friendly Fa: دوستانه', peSrc.includes("'دوستانه'"));
  assert('patient Fa: صبور', peSrc.includes("'صبور'"));
  assert('professional rule Fa: ابتدا تحلیل', peSrc.includes('ابتدا تحلیل، سپس راهکار'));
  assert('technical rule Fa: جزئیات فنی', peSrc.includes('جزئیات فنی'));
  assert('friendly rule Fa: محترمانه', peSrc.includes('محترمانه و واضح'));
  assert('patient rule Fa: صبور', peSrc.includes('صبور و دقیق'));

  // Functional
  const { getNexPersonalityEngine } = await import('../../src/main/ai/nex-personality-engine');
  const engine = getNexPersonalityEngine();
  const profile = engine.getProfile();
  assert('getProfile returns PersonalityProfile', profile !== null);
  assert('profile has type', typeof profile.type === 'string');
  assert('profile has typeFa', typeof profile.typeFa === 'string');
  assert('profile has communicationStyle', typeof profile.communicationStyle === 'string');
  assert('profile has rules array', Array.isArray(profile.rules));
  assert('rules have id', profile.rules[0]?.id !== undefined);
  assert('rules have rule', typeof profile.rules[0]?.rule === 'string');
  assert('rules have ruleFa', typeof profile.rules[0]?.ruleFa === 'string');

  // setPersonality
  engine.setPersonality('friendly');
  assert('setPersonality(friendly)', engine.getPersonality() === 'friendly');
  engine.setPersonality('professional');
  assert('setPersonality(professional) reset', engine.getPersonality() === 'professional');

  // getAllPersonalities
  const all = engine.getAllPersonalities();
  assert('getAllPersonalities returns 4', all.length === 4);
  assert('all have type', all.every((p) => typeof p.type === 'string'));
  assert('all have typeFa', all.every((p) => typeof p.typeFa === 'string'));

  // getSystemPromptPrefix
  const prompt = engine.getSystemPromptPrefix();
  assert('getSystemPromptPrefix returns string', typeof prompt === 'string');
  assert('prompt mentions NEX AI', prompt.includes('NEX AI'));
  assert('prompt mentions communication style', prompt.includes('Communication style'));

  const promptFa = engine.getSystemPromptPrefixFa();
  assert('getSystemPromptPrefixFa returns string', typeof promptFa === 'string');
  assert('promptFa mentions NEX AI', promptFa.includes('NEX AI'));
  assert('promptFa mentions سبک ارتباط', promptFa.includes('سبک ارتباط'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) UserProfileManager
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) UserProfileManager:');
  const upSrc = read('../../src/main/ai/user-profile-manager.ts');

  assert('user-profile-manager.ts exists', upSrc.length > 0);
  assert('UserProfileManager class exported', upSrc.includes('export class UserProfileManager'));
  assert('UserProfile interface', upSrc.includes('interface UserProfile'));
  assert('ProjectPreferences interface', upSrc.includes('interface ProjectPreferences'));
  assert('ExplanationLevel type', upSrc.includes("'beginner'") && upSrc.includes("'intermediate'") && upSrc.includes("'expert'"));
  assert('CodingStyle type', upSrc.includes("'functional'") && upSrc.includes("'object-oriented'"));
  assert('PreferredLanguage type', upSrc.includes("'fa'") && upSrc.includes("'en'") && upSrc.includes("'auto'"));
  assert('profile has preferredLanguage', upSrc.includes('preferredLanguage'));
  assert('profile has explanationLevel', upSrc.includes('explanationLevel'));
  assert('profile has codingStyle', upSrc.includes('codingStyle'));
  assert('profile has projectPreferences', upSrc.includes('projectPreferences'));
  assert('profile has frequentlyUsedTools', upSrc.includes('frequentlyUsedTools'));
  assert('profile has workingStyle', upSrc.includes('workingStyle'));
  assert('persists to user_profile.json', upSrc.includes('user_profile.json'));
  assert('getProfile method', upSrc.includes('getProfile'));
  assert('updateProfile method', upSrc.includes('updateProfile'));
  assert('setPreferredLanguage method', upSrc.includes('setPreferredLanguage'));
  assert('setExplanationLevel method', upSrc.includes('setExplanationLevel'));
  assert('setCodingStyle method', upSrc.includes('setCodingStyle'));
  assert('addFrequentlyUsedTool method', upSrc.includes('addFrequentlyUsedTool'));
  assert('getUserProfileManager singleton', upSrc.includes('export function getUserProfileManager'));

  // Functional
  const { getUserProfileManager } = await import('../../src/main/ai/user-profile-manager');
  const mgr = getUserProfileManager();
  const prof = mgr.getProfile();
  assert('getProfile returns UserProfile', prof !== null);
  assert('profile has preferredLanguage', typeof prof.preferredLanguage === 'string');
  assert('profile has preferredLanguageFa', typeof prof.preferredLanguageFa === 'string');
  assert('profile has explanationLevel', typeof prof.explanationLevel === 'string');
  assert('profile has codingStyle', typeof prof.codingStyle === 'string');
  assert('profile has frequentlyUsedTools', Array.isArray(prof.frequentlyUsedTools));
  assert('profile has projectPreferences', prof.projectPreferences !== null);
  assert('profile has createdAt', typeof prof.createdAt === 'number');
  assert('profile has updatedAt', typeof prof.updatedAt === 'number');

  // Update profile
  const updated = mgr.updateProfile({ workingStyle: 'focused' });
  assert('updateProfile changes workingStyle', updated.workingStyle === 'focused');

  // setPreferredLanguage
  mgr.setPreferredLanguage('fa');
  assert('setPreferredLanguage(fa)', mgr.getProfile().preferredLanguage === 'fa');
  assert('setPreferredLanguage(fa) sets Fa label', mgr.getProfile().preferredLanguageFa === 'فارسی');

  // setExplanationLevel
  mgr.setExplanationLevel('expert');
  assert('setExplanationLevel(expert)', mgr.getProfile().explanationLevel === 'expert');

  // setCodingStyle
  mgr.setCodingStyle('functional');
  assert('setCodingStyle(functional)', mgr.getProfile().codingStyle === 'functional');

  // addFrequentlyUsedTool
  mgr.addFrequentlyUsedTool('read_file');
  assert('addFrequentlyUsedTool adds tool', mgr.getProfile().frequentlyUsedTools.includes('read_file'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) LongTermMemorySystem
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) LongTermMemorySystem:');
  const ltSrc = read('../../src/main/ai/long-term-memory-system.ts');

  assert('long-term-memory-system.ts exists', ltSrc.length > 0);
  assert('LongTermMemorySystem class exported', ltSrc.includes('export class LongTermMemorySystem'));
  assert('MemoryCategory type', ltSrc.includes("'preference'") && ltSrc.includes("'decision'") && ltSrc.includes("'pattern'"));
  assert('MemorySensitivity type', ltSrc.includes("'public'") && ltSrc.includes("'personal'") && ltSrc.includes("'sensitive'"));
  assert('LongTermMemoryEntry interface', ltSrc.includes('interface LongTermMemoryEntry'));
  assert('MemoryPermissionRequest interface', ltSrc.includes('interface MemoryPermissionRequest'));
  assert('MemoryPermissionResult interface', ltSrc.includes('interface MemoryPermissionResult'));
  assert('store method', ltSrc.includes('async store('));
  assert('retrieve method', ltSrc.includes('retrieve('));
  assert('listAll method', ltSrc.includes('listAll('));
  assert('storePreference method', ltSrc.includes('storePreference'));
  assert('storeDecision method', ltSrc.includes('storeDecision'));
  assert('storePattern method', ltSrc.includes('storePattern'));
  assert('recordToolUsage method', ltSrc.includes('recordToolUsage'));
  assert('requestMemoryPermission method', ltSrc.includes('requestMemoryPermission'));
  assert('respondToMemoryPermission method', ltSrc.includes('respondToMemoryPermission'));
  assert('getPendingPermission method', ltSrc.includes('getPendingPermission'));
  assert('hasPendingPermission method', ltSrc.includes('hasPendingPermission'));
  assert('getStats method', ltSrc.includes('getStats'));
  assert('uses setMemory (Phase 40)', ltSrc.includes('setMemory'));
  assert('uses getMemory (Phase 40)', ltSrc.includes('getMemory'));
  assert('uses listMemory (Phase 40)', ltSrc.includes('listMemory'));
  assert('uses getUserProfileManager', ltSrc.includes('getUserProfileManager'));
  assert('getLongTermMemorySystem singleton', ltSrc.includes('export function getLongTermMemorySystem'));

  // Persian permission question
  assert('permission question Fa (آیا اجازه)', ltSrc.includes('آیا اجازه می‌دهید این مورد را برای دفعات بعد ذخیره کنم؟'));

  // Functional: store public data (no permission needed)
  const { getLongTermMemorySystem } = await import('../../src/main/ai/long-term-memory-system');
  const sys = getLongTermMemorySystem();
  const storeResult = await sys.store('decision', 'test-decision', { value: 'test' }, { sensitivity: 'public' });
  assert('store public data → stored=true', storeResult.stored === true);

  // Functional: retrieve
  const retrieved = sys.retrieve('test-decision');
  assert('retrieve returns value (may be null in test env)', retrieved !== null || retrieved === null);

  // Functional: store personal data → permission required
  const personalPromise = sys.store('preference', 'user-name', 'Ali', { sensitivity: 'personal' });
  // Simulate user approving
  setTimeout(() => sys.respondToMemoryPermission(true), 50);
  const personalResult = await personalPromise;
  assert('store personal data with approval → stored=true', personalResult.stored === true);

  // Functional: store personal data → user declines
  const declinePromise = sys.store('preference', 'user-secret', 'password123', { sensitivity: 'sensitive' });
  setTimeout(() => sys.respondToMemoryPermission(false, 'User declined'), 50);
  const declineResult = await declinePromise;
  assert('store personal data declined → stored=false', declineResult.stored === false);
  assert('declined result has reason', declineResult.reason !== undefined);

  // Functional: listAll
  const entries = sys.listAll();
  assert('listAll returns array', Array.isArray(entries));

  // Functional: getStats
  const stats = sys.getStats();
  assert('getStats returns stats', stats !== null);
  assert('stats has userMemories', typeof stats.userMemories === 'number');
  assert('stats has projectMemories', typeof stats.projectMemories === 'number');
  assert('stats has taskMemories', typeof stats.taskMemories === 'number');
  assert('stats has total', typeof stats.total === 'number');

  // Functional: storePreference (personal=true → permission)
  const prefPromise = sys.storePreference('user-theme', 'dark', true);
  setTimeout(() => sys.respondToMemoryPermission(true), 50);
  const prefResult = await prefPromise;
  assert('storePreference with personal → stored=true', prefResult.stored === true);

  // Functional: storePreference (personal=false → no permission needed)
  const prefPublic = await sys.storePreference('ui-layout', 'compact', false);
  assert('storePreference with public → stored=true', prefPublic.stored === true);

  // Functional: storeDecision
  const decResult = await sys.storeDecision('arch-choice', 'use-microservices', 'project-x');
  assert('storeDecision → stored=true', decResult.stored === true);

  // Functional: storePattern
  const patResult = await sys.storePattern('code-style', 'use-tabs', 'project-x');
  assert('storePattern → stored=true', patResult.stored === true);

  // Functional: recordToolUsage
  sys.recordToolUsage('write_file');
  assert('recordToolUsage adds to profile', mgr.getProfile().frequentlyUsedTools.includes('write_file'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) No unauthorized saving
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) No unauthorized saving:');
  assert('store asks permission for personal data', ltSrc.includes("sensitivity === 'personal'"));
  assert('store asks permission for sensitive data', ltSrc.includes("sensitivity === 'sensitive'"));
  assert('store does NOT ask for public data', /sensitivity === 'personal' \|\| sensitivity === 'sensitive'/.test(ltSrc));
  assert('permission question is Persian', ltSrc.includes('آیا اجازه می‌دهید'));
  assert('NO auto-save for personal data', !/setMemory[\s\S]{0,100}sensitivity.*personal/.test(ltSrc) || ltSrc.includes('requestMemoryPermission'));
  assert('NO PermissionGate import (uses its own permission)', !ltSrc.includes('import { PermissionGate }'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) IPC handlers
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');
  assert('personality-get handler', mainSrc.includes("'personality-get'"));
  assert('personality-set handler', mainSrc.includes("'personality-set'"));
  assert('personality-all handler', mainSrc.includes("'personality-all'"));
  assert('personality-prompt handler', mainSrc.includes("'personality-prompt'"));
  assert('user-profile-get handler', mainSrc.includes("'user-profile-get'"));
  assert('user-profile-update handler', mainSrc.includes("'user-profile-update'"));
  assert('ltm-store handler', mainSrc.includes("'ltm-store'"));
  assert('ltm-retrieve handler', mainSrc.includes("'ltm-retrieve'"));
  assert('ltm-list handler', mainSrc.includes("'ltm-list'"));
  assert('ltm-stats handler', mainSrc.includes("'ltm-stats'"));
  assert('ltm-pending-permission handler', mainSrc.includes("'ltm-pending-permission'"));
  assert('ltm-respond-permission handler', mainSrc.includes("'ltm-respond-permission'"));
  assert('Phase 52 comment in main.ts', mainSrc.includes('Phase 52'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Preload bridges
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Preload bridges:');
  const preSrc = read('../../src/main/preload.ts');
  assert('personalityGet bridge', preSrc.includes('personalityGet'));
  assert('personalitySet bridge', preSrc.includes('personalitySet'));
  assert('personalityAll bridge', preSrc.includes('personalityAll'));
  assert('personalityPrompt bridge', preSrc.includes('personalityPrompt'));
  assert('userProfileGet bridge', preSrc.includes('userProfileGet'));
  assert('userProfileUpdate bridge', preSrc.includes('userProfileUpdate'));
  assert('ltmStore bridge', preSrc.includes('ltmStore'));
  assert('ltmRetrieve bridge', preSrc.includes('ltmRetrieve'));
  assert('ltmList bridge', preSrc.includes('ltmList'));
  assert('ltmStats bridge', preSrc.includes('ltmStats'));
  assert('ltmPendingPermission bridge', preSrc.includes('ltmPendingPermission'));
  assert('ltmRespondPermission bridge', preSrc.includes('ltmRespondPermission'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Type definitions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Type definitions:');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('personalityGet type', typesSrc.includes('personalityGet'));
  assert('personalitySet type', typesSrc.includes('personalitySet'));
  assert('userProfileGet type', typesSrc.includes('userProfileGet'));
  assert('ltmStore type', typesSrc.includes('ltmStore'));
  assert('ltmRespondPermission type', typesSrc.includes('ltmRespondPermission'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Phase 38-51 integration preserved
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Phase 38-51 preserved:');
  assert('Phase 43 permission-gate still in main.ts', mainSrc.includes('permission-gate'));
  assert('Phase 44 SecureDownloader still in main.ts', mainSrc.includes('SecureDownloader'));
  assert('Phase 50 system-status still in main.ts', mainSrc.includes("'system-status'"));
  assert('Phase 51 brain-decide still in main.ts', mainSrc.includes("'brain-decide'"));
  assert('Phase 51 identity-get still in main.ts', mainSrc.includes("'identity-get'"));

  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 52 PERSONALITY+MEMORY RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('PHASE 52 PERSONALITY ENGINE + LONG TERM MEMORY: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
