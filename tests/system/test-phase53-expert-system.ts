/**
 * Phase 53 — Universal Expert System Tests
 *
 * Verifies:
 *   1. Expert profiles (6 domains, Persian, abilities, tools)
 *   2. Expert router (keyword matching, confidence, Persian keywords)
 *   3. IPC handlers + preload + types
 *   4. No autonomous actions
 *   5. Phase 38-52 preserved
 *
 * Run: npx tsx tests/system/test-phase53-expert-system.ts
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
  // 1) Expert System (nex-expert-system.ts)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) Expert System:');
  const esSrc = read('../../src/main/ai/nex-expert-system.ts');

  assert('nex-expert-system.ts exists', esSrc.length > 0);
  assert('ExpertDomain type (6 domains)', esSrc.includes("'software-engineering'") && esSrc.includes("'electronics-engineering'") && esSrc.includes("'science'") && esSrc.includes("'business'") && esSrc.includes("'creative'") && esSrc.includes("'general'"));
  assert('ExpertProfile interface', esSrc.includes('interface ExpertProfile'));
  assert('profile has id', esSrc.includes('id: string'));
  assert('profile has name', esSrc.includes('name: string'));
  assert('profile has nameFa', esSrc.includes('nameFa'));
  assert('profile has abilities', esSrc.includes('abilities:'));
  assert('profile has abilitiesFa', esSrc.includes('abilitiesFa'));
  assert('profile has preferredModels', esSrc.includes('preferredModels'));
  assert('profile has tools', esSrc.includes('tools:'));
  assert('profile has knowledgeAreas', esSrc.includes('knowledgeAreas'));
  assert('profile has knowledgeAreasFa', esSrc.includes('knowledgeAreasFa'));
  assert('profile has limitations', esSrc.includes('limitations:'));
  assert('profile has limitationsFa', esSrc.includes('limitationsFa'));
  assert('profile has keywords', esSrc.includes('keywords:'));
  assert('profile has keywordsFa', esSrc.includes('keywordsFa'));
  assert('getExpertProfiles function', esSrc.includes('export function getExpertProfiles'));
  assert('getExpertProfile function', esSrc.includes('export function getExpertProfile'));
  assert('getExpertsByDomain function', esSrc.includes('export function getExpertsByDomain'));

  // Expert profiles exist
  assert('has software-engineering profile', esSrc.includes("'software-engineering'"));
  assert('has electronics-engineering profile', esSrc.includes("'electronics-engineering'"));
  assert('has science profile', esSrc.includes("'science'"));
  assert('has business profile', esSrc.includes("'business'"));
  assert('has creative profile', esSrc.includes("'creative'"));
  assert('has general profile', esSrc.includes("'general'"));

  // Persian names
  assert('software Fa: متخصص مهندسی نرم‌افزار', esSrc.includes('متخصص مهندسی نرم‌افزار'));
  assert('electronics Fa: متخصص مهندسی الکترونیک', esSrc.includes('متخصص مهندسی الکترونیک'));
  assert('science Fa: متخصص علوم', esSrc.includes('متخصص علوم'));
  assert('business Fa: متخصص کسب‌وکار', esSrc.includes('متخصص کسب‌وکار'));
  assert('creative Fa: متخصص خلاقیت', esSrc.includes('متخصص خلاقیت'));
  assert('general Fa: متخصص دانش عمومی', esSrc.includes('متخصص دانش عمومی'));

  // Sub-domains
  assert('software has frontend sub-domain', esSrc.includes("'frontend'"));
  assert('software has backend sub-domain', esSrc.includes("'backend'"));
  assert('software has ai-development sub-domain', esSrc.includes("'ai-development'"));
  assert('software has cybersecurity sub-domain', esSrc.includes("'cybersecurity'"));
  assert('software has databases sub-domain', esSrc.includes("'databases'"));
  assert('software has devops sub-domain', esSrc.includes("'devops'"));
  assert('electronics has embedded-systems', esSrc.includes("'embedded-systems'"));
  assert('electronics has pcb-design', esSrc.includes("'pcb-design'"));
  assert('electronics has robotics', esSrc.includes("'robotics'"));
  assert('science has mathematics', esSrc.includes("'mathematics'"));
  assert('science has physics', esSrc.includes("'physics'"));
  assert('science has chemistry', esSrc.includes("'chemistry'"));
  assert('science has biology', esSrc.includes("'biology'"));

  // Functional
  const { getExpertProfiles, getExpertProfile } = await import('../../src/main/ai/nex-expert-system');
  const profiles = getExpertProfiles();
  assert('getExpertProfiles returns 6', profiles.length === 6);
  assert('all have id', profiles.every((e) => typeof e.id === 'string'));
  assert('all have name', profiles.every((e) => typeof e.name === 'string'));
  assert('all have nameFa', profiles.every((e) => typeof e.nameFa === 'string'));
  assert('all have abilities array', profiles.every((e) => Array.isArray(e.abilities)));
  assert('all have abilitiesFa array', profiles.every((e) => Array.isArray(e.abilitiesFa)));
  assert('all have preferredModels', profiles.every((e) => Array.isArray(e.preferredModels)));
  assert('all have tools', profiles.every((e) => Array.isArray(e.tools)));
  assert('all have keywords', profiles.every((e) => Array.isArray(e.keywords)));
  assert('all have keywordsFa', profiles.every((e) => Array.isArray(e.keywordsFa)));
  assert('getExpertProfile returns profile', getExpertProfile('software-engineering') !== null);
  assert('getExpertProfile returns null for unknown', getExpertProfile('nonexistent') === null);

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Expert Router (expert-router.ts)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Expert Router:');
  const erSrc = read('../../src/main/ai/expert-router.ts');

  assert('expert-router.ts exists', erSrc.length > 0);
  assert('ExpertRouter class exported', erSrc.includes('export class ExpertRouter'));
  assert('ExpertRouteResult interface', erSrc.includes('interface ExpertRouteResult'));
  assert('route method', erSrc.includes('route('));
  assert('getAllDomains method', erSrc.includes('getAllDomains'));
  assert('getExpert method', erSrc.includes('getExpert('));
  assert('getExpertiseDescriptionFa method', erSrc.includes('getExpertiseDescriptionFa'));
  assert('getExpertiseDescription method', erSrc.includes('getExpertiseDescription'));
  assert('getExpertRouter singleton', erSrc.includes('export function getExpertRouter'));
  assert('result has expert', erSrc.includes('expert:'));
  assert('result has domain', erSrc.includes('domain:'));
  assert('result has confidence', erSrc.includes('confidence:'));
  assert('result has reason', erSrc.includes('reason:'));
  assert('result has reasonFa', erSrc.includes('reasonFa:'));
  assert('result has matchedKeywords', erSrc.includes('matchedKeywords:'));
  assert('result has matchedKeywordsFa', erSrc.includes('matchedKeywordsFa:'));
  assert('NO download() calls', !erSrc.includes('download('));
  assert('NO install() calls', !erSrc.includes('install('));
  assert('NO PermissionGate import', !erSrc.includes('PermissionGate'));

  // Functional: route requests
  const { getExpertRouter } = await import('../../src/main/ai/expert-router');
  const router = getExpertRouter();

  // Software engineering
  const codeResult = router.route('write a React component with TypeScript');
  assert('React code → software-engineering', codeResult.domain === 'software-engineering');
  assert('code result has expert', codeResult.expert !== null);
  assert('code result has confidence (0-1)', codeResult.confidence >= 0 && codeResult.confidence <= 1);
  assert('code result has reason', typeof codeResult.reason === 'string');
  assert('code result has reasonFa', typeof codeResult.reasonFa === 'string');
  assert('code result has matchedKeywords', Array.isArray(codeResult.matchedKeywords));

  // Electronics
  const elecResult = router.route('design a power supply circuit with voltage regulator');
  assert('circuit design → electronics-engineering', elecResult.domain === 'electronics-engineering');

  // Science
  const sciResult = router.route('calculate the integral of x squared');
  assert('math integral → science', sciResult.domain === 'science');

  // Business
  const bizResult = router.route('create a project plan with budget and milestones');
  assert('project plan → business', bizResult.domain === 'business');

  // Creative
  const creativeResult = router.route('write a story about space exploration');
  assert('story writing → creative', creativeResult.domain === 'creative');

  // Persian keywords
  const persianCode = router.route('کد React بنویس');
  assert('Persian "کد" → software-engineering', persianCode.domain === 'software-engineering');

  const persianElec = router.route('مدار تغذیه طراحی کن');
  assert('Persian "مدار" → electronics-engineering', persianElec.domain === 'electronics-engineering');

  // All domains
  const domains = router.getAllDomains();
  assert('getAllDomains returns 6', domains.length === 6);
  assert('domains include software-engineering', domains.includes('software-engineering'));
  assert('domains include electronics-engineering', domains.includes('electronics-engineering'));
  assert('domains include science', domains.includes('science'));

  // Expertise description
  const descFa = router.getExpertiseDescriptionFa();
  assert('getExpertiseDescriptionFa returns string', typeof descFa === 'string');
  assert('Persian description mentions NEX AI', descFa.includes('NEX AI'));
  assert('Persian description mentions مهندسی نرم‌افزار', descFa.includes('مهندسی نرم‌افزار'));
  assert('Persian description mentions مهندسی الکترونیک', descFa.includes('مهندسی الکترونیک'));

  const descEn = router.getExpertiseDescription();
  assert('getExpertiseDescription returns string', typeof descEn === 'string');
  assert('English description mentions NEX AI', descEn.includes('NEX AI'));
  assert('English description mentions Software Engineering', descEn.includes('Software Engineering'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) IPC handlers
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');
  assert('expert-route handler', mainSrc.includes("'expert-route'"));
  assert('expert-all handler', mainSrc.includes("'expert-all'"));
  assert('expert-get handler', mainSrc.includes("'expert-get'"));
  assert('expert-description handler', mainSrc.includes("'expert-description'"));
  assert('expert-domains handler', mainSrc.includes("'expert-domains'"));
  assert('Phase 53 comment in main.ts', mainSrc.includes('Phase 53'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Preload bridges
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Preload bridges:');
  const preSrc = read('../../src/main/preload.ts');
  assert('expertRoute bridge', preSrc.includes('expertRoute'));
  assert('expertAll bridge', preSrc.includes('expertAll'));
  assert('expertGet bridge', preSrc.includes('expertGet'));
  assert('expertDescription bridge', preSrc.includes('expertDescription'));
  assert('expertDomains bridge', preSrc.includes('expertDomains'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Type definitions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Type definitions:');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('expertRoute type', typesSrc.includes('expertRoute'));
  assert('expertAll type', typesSrc.includes('expertAll'));
  assert('expertGet type', typesSrc.includes('expertGet'));
  assert('expertDescription type', typesSrc.includes('expertDescription'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) No autonomous actions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) No autonomous actions:');
  assert('NO download() in expert system', !esSrc.includes('download('));
  assert('NO install() in expert system', !esSrc.includes('install('));
  assert('NO removeModel() in expert system', !esSrc.includes('removeModel'));
  assert('NO modelAdd() in expert system', !esSrc.includes('modelAdd'));
  assert('NO updateDownload in expert system', !esSrc.includes('updateDownload'));
  assert('NO SecureDownloader import', !esSrc.includes('SecureDownloader'));
  assert('NO ComponentInstaller import', !esSrc.includes('ComponentInstaller'));
  assert('NO PermissionGate import', !esSrc.includes('PermissionGate'));
  assert('NO fetch/https calls', !esSrc.includes('fetch(') && !esSrc.includes('https.get'));
  assert('expert system only SELECTS', esSrc.includes('SELECTS') || erSrc.includes('only SELECTS'));
  assert('router only routes', erSrc.includes('route(') && !erSrc.includes('download('));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Phase 38-52 preserved
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Phase 38-52 preserved:');
  assert('Phase 43 permission-gate in main.ts', mainSrc.includes('permission-gate'));
  assert('Phase 44 SecureDownloader in main.ts', mainSrc.includes('SecureDownloader'));
  assert('Phase 50 system-status in main.ts', mainSrc.includes("'system-status'"));
  assert('Phase 51 brain-decide in main.ts', mainSrc.includes("'brain-decide'"));
  assert('Phase 52 personality-get in main.ts', mainSrc.includes("'personality-get'"));
  assert('Phase 52 ltm-store in main.ts', mainSrc.includes("'ltm-store'"));
  assert('nex-brain-controller.ts exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-brain-controller.ts')));
  assert('nex-identity-manager.ts exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-identity-manager.ts')));
  assert('nex-personality-engine.ts exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-personality-engine.ts')));
  assert('long-term-memory-system.ts exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/long-term-memory-system.ts')));
  assert('user-profile-manager.ts exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/user-profile-manager.ts')));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Expert profile details
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Expert profile details:');
  const swExpert = getExpertProfile('software-engineering')!;
  assert('software expert has 8+ abilities', swExpert.abilities.length >= 8);
  assert('software expert has 8+ abilitiesFa', swExpert.abilitiesFa.length >= 8);
  assert('software expert has preferredModels', swExpert.preferredModels.length >= 1);
  assert('software expert has tools', swExpert.tools.length >= 1);
  assert('software expert has knowledgeAreas', swExpert.knowledgeAreas.length >= 1);
  assert('software expert has keywords', swExpert.keywords.length >= 10);
  assert('software expert has keywordsFa', swExpert.keywordsFa.length >= 5);
  assert('software expert has limitations', swExpert.limitations.length >= 1);

  const elecExpert = getExpertProfile('electronics-engineering')!;
  assert('electronics expert has 8+ abilities', elecExpert.abilities.length >= 8);
  assert('electronics expert mentions PCB', elecExpert.subDomains.includes('pcb-design'));
  assert('electronics expert mentions Arduino', elecExpert.abilities.some((a) => a.includes('Arduino')));

  const sciExpert = getExpertProfile('science')!;
  assert('science expert has math', sciExpert.subDomains.includes('mathematics'));
  assert('science expert has physics', sciExpert.subDomains.includes('physics'));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Persian routing tests
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Persian routing:');
  const p1 = router.route('برنامه پروژه و استراتژی بازار');
  assert('Persian business keywords → business', p1.domain === 'business');

  const p2 = router.route('مدار الکترونیکی');
  assert('Persian "مدار" → electronics', p2.domain === 'electronics-engineering');

  const p3 = router.route('توضیح بده چیست');
  assert('Persian "توضیح" → general', p3.domain === 'general' || p3.domain === 'science');

  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 53 EXPERT SYSTEM RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('PHASE 53 UNIVERSAL EXPERT SYSTEM: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
