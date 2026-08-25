/**
 * Phase 51 — NEX Brain Core + Identity System Tests
 *
 * Verifies:
 *   1. NexBrainController (multi-model orchestrator)
 *   2. NexIdentityManager (self-awareness + nex_identity.json)
 *   3. Smart model routing (auto-decision)
 *   4. Model cooperation (multiple models by task)
 *   5. No autonomous installation (permission preserved)
 *   6. IPC handlers + preload + types
 *
 * Run: npx tsx tests/system/test-phase51-brain-core.ts
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
  // 1) NexBrainController
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) NexBrainController:');
  const bcSrc = read('../../src/main/ai/nex-brain-controller.ts');

  assert('nex-brain-controller.ts exists', bcSrc.length > 0);
  assert('NexBrainController class exported', bcSrc.includes('export class NexBrainController'));
  assert('BrainMode type (auto/coding/reasoning/vision/voice/chat)', bcSrc.includes("'auto'") && bcSrc.includes("'coding'") && bcSrc.includes("'vision'") && bcSrc.includes("'voice'"));
  assert('BrainDecision interface', bcSrc.includes('interface BrainDecision'));
  assert('BrainStatus interface', bcSrc.includes('interface BrainStatus'));
  assert('decide method', bcSrc.includes('decide('));
  assert('getStatus method', bcSrc.includes('getStatus'));
  assert('setMode method', bcSrc.includes('setMode'));
  assert('getMode method', bcSrc.includes('getMode'));
  assert('getLastDecision method', bcSrc.includes('getLastDecision'));
  assert('getModelsByTask method', bcSrc.includes('getModelsByTask'));
  assert('uses getSmartModelRouter (Phase 45)', bcSrc.includes('getSmartModelRouter'));
  assert('uses listModels (Phase 39)', bcSrc.includes('listModels'));
  assert('uses getNexIdentityManager', bcSrc.includes('getNexIdentityManager'));
  assert('getNexBrainController singleton', bcSrc.includes('export function getNexBrainController'));
  assert('BrainDecision has selectedModel', bcSrc.includes('selectedModel'));
  assert('BrainDecision has task', bcSrc.includes('task:'));
  assert('BrainDecision has taskFa (Persian)', bcSrc.includes('taskFa'));
  assert('BrainDecision has reason', bcSrc.includes('reason:'));
  assert('BrainDecision has reasonFa (Persian)', bcSrc.includes('reasonFa'));
  assert('BrainDecision has confidence', bcSrc.includes('confidence'));
  assert('BrainDecision has alternatives', bcSrc.includes('alternatives'));
  assert('BrainDecision has brainMode', bcSrc.includes('brainMode'));
  assert('BrainStatus has activeModel', bcSrc.includes('activeModel'));
  assert('BrainStatus has totalModels', bcSrc.includes('totalModels'));
  assert('BrainStatus has modelsByCategory', bcSrc.includes('modelsByCategory'));
  assert('BrainStatus has brainMode', bcSrc.includes('brainMode'));
  assert('BrainStatus has identity', bcSrc.includes('identity'));
  assert('BrainStatus has capabilities', bcSrc.includes('capabilities'));
  assert('BrainStatus has selfAwareness', bcSrc.includes('selfAwareness'));
  assert('translates task to Persian', bcSrc.includes('برنامه‌نویسی') && bcSrc.includes('استدلال') && bcSrc.includes('بینایی') && bcSrc.includes('صدا'));
  assert('NO download() calls', !bcSrc.includes('download('));
  assert('NO install() calls', !bcSrc.includes('install('));
  assert('NO PermissionGate import', !bcSrc.includes('PermissionGate'));
  assert('NO SecureDownloader import', !bcSrc.includes('SecureDownloader'));

  // Functional: decide
  const { getNexBrainController } = await import('../../src/main/ai/nex-brain-controller');
  const brain = getNexBrainController();
  const decision = brain.decide({ request: 'fix this function bug' });
  assert('decide returns BrainDecision', decision !== null);
  assert('decision has task', typeof decision.task === 'string');
  assert('decision has taskFa', typeof decision.taskFa === 'string');
  assert('decision has complexity', typeof decision.complexity === 'string');
  assert('decision has reason', typeof decision.reason === 'string');
  assert('decision has reasonFa', typeof decision.reasonFa === 'string');
  assert('decision has confidence (0-1)', decision.confidence >= 0 && decision.confidence <= 1);
  assert('decision has brainMode', typeof decision.brainMode === 'string');
  assert('decision alternatives is array', Array.isArray(decision.alternatives));

  // Functional: getStatus
  const status = await brain.getStatus();
  assert('getStatus returns BrainStatus', status !== null);
  assert('status has brainMode', typeof status.brainMode === 'string');
  assert('status has modelsByCategory', typeof status.modelsByCategory === 'object');
  assert('status has identity', status.identity !== null);
  assert('status has identity.name', typeof status.identity.name === 'string');
  assert('status has identity.version', typeof status.identity.version === 'string');
  assert('status has capabilities', Array.isArray(status.capabilities));

  // Functional: setMode / getMode
  brain.setMode('coding');
  assert('setMode(coding) → getMode returns coding', brain.getMode() === 'coding');
  brain.setMode('auto');
  assert('setMode(auto) → getMode returns auto', brain.getMode() === 'auto');

  // Functional: getLastDecision
  const lastDec = brain.getLastDecision();
  assert('getLastDecision returns decision', lastDec !== null);

  // Functional: getModelsByTask
  const modelsByTask = brain.getModelsByTask();
  assert('getModelsByTask returns object', typeof modelsByTask === 'object');
  assert('getModelsByTask has coding key', Array.isArray(modelsByTask.coding));
  assert('getModelsByTask has reasoning key', Array.isArray(modelsByTask.reasoning));
  assert('getModelsByTask has vision key', Array.isArray(modelsByTask.vision));
  assert('getModelsByTask has voice key', Array.isArray(modelsByTask.voice));
  assert('getModelsByTask has chat key', Array.isArray(modelsByTask.chat));

  // Functional: decide with different requests
  const codingDec = brain.decide({ request: 'implement a sorting algorithm' });
  assert('coding request → task is coding', codingDec.task === 'coding');
  const visionDec = brain.decide({ request: 'look at this screenshot and describe the image' });
  assert('vision request → task is vision', visionDec.task === 'vision');

  // ═══════════════════════════════════════════════════════════════════════
  // 2) NexIdentityManager
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) NexIdentityManager:');
  const imSrc = read('../../src/main/ai/nex-identity-manager.ts');

  assert('nex-identity-manager.ts exists', imSrc.length > 0);
  assert('NexIdentityManager class exported', imSrc.includes('export class NexIdentityManager'));
  assert('NexIdentity interface', imSrc.includes('interface NexIdentity'));
  assert('NexSelfAwareness interface', imSrc.includes('interface NexSelfAwareness'));
  assert('PersonalityType (professional/technical/friendly/patient)', imSrc.includes("'professional'") && imSrc.includes("'technical'") && imSrc.includes("'friendly'") && imSrc.includes("'patient'"));
  assert('identity has name', imSrc.includes('name: string'));
  assert('identity has version', imSrc.includes('version: string'));
  assert('identity has mission', imSrc.includes('mission: string'));
  assert('identity has missionFa (Persian)', imSrc.includes('missionFa'));
  assert('identity has abilities', imSrc.includes('abilities:'));
  assert('identity has abilitiesFa (Persian)', imSrc.includes('abilitiesFa'));
  assert('identity has limitations', imSrc.includes('limitations:'));
  assert('identity has limitationsFa (Persian)', imSrc.includes('limitationsFa'));
  assert('identity has rules', imSrc.includes('rules:'));
  assert('identity has rulesFa (Persian)', imSrc.includes('rulesFa'));
  assert('identity has personality', imSrc.includes('personality:'));
  assert('identity has personalityFa (Persian)', imSrc.includes('personalityFa'));
  assert('persists to nex_identity.json', imSrc.includes('nex_identity.json'));
  assert('getIdentity method', imSrc.includes('getIdentity'));
  assert('updateIdentity method', imSrc.includes('updateIdentity'));
  assert('setPersonality method', imSrc.includes('setPersonality'));
  assert('getSelfAwareness method', imSrc.includes('getSelfAwareness'));
  assert('getNexIdentityManager singleton', imSrc.includes('export function getNexIdentityManager'));
  assert('uses listModels (Phase 39)', imSrc.includes('listModels'));
  assert('uses getLocalVoiceEngine (Phase 41)', imSrc.includes('getLocalVoiceEngine'));
  assert('uses getMemoryRetrievalEngine (Phase 40)', imSrc.includes('getMemoryRetrievalEngine'));

  // Default identity values
  assert('default name is NEX AI', imSrc.includes("'NEX AI'"));
  assert('default mission mentions local', imSrc.includes('Local intelligent assistant'));
  assert('default missionFa mentions آفلاین', imSrc.includes('آفلاین'));
  assert('rules include never download', imSrc.includes('Never download without permission'));
  assert('rulesFa include بدون اجازه', imSrc.includes('بدون اجازه'));
  assert('abilities include Programming', imSrc.includes('Programming'));
  assert('abilitiesFa include برنامه‌نویسی', imSrc.includes('برنامه‌نویسی'));
  assert('abilities include Voice', imSrc.includes('Voice'));
  assert('abilities include Vision', imSrc.includes('Vision'));
  assert('abilities include Knowledge retrieval', imSrc.includes('Knowledge retrieval'));
  assert('limitations include cannot download', imSrc.includes('Cannot download'));
  assert('limitations include cannot delete', imSrc.includes('Cannot delete'));
  assert('limitationsFa include بدون اجازه دانلود', imSrc.includes('بدون اجازه دانلود'));

  // SelfAwareness fields
  assert('selfAwareness has installedModels', imSrc.includes('installedModels'));
  assert('selfAwareness has availableTools', imSrc.includes('availableTools'));
  assert('selfAwareness has capabilities', imSrc.includes('capabilities'));
  assert('selfAwareness has capabilitiesFa', imSrc.includes('capabilitiesFa'));
  assert('selfAwareness has cannotDo', imSrc.includes('cannotDo'));
  assert('selfAwareness has cannotDoFa', imSrc.includes('cannotDoFa'));
  assert('selfAwareness has activeBrain', imSrc.includes('activeBrain'));
  assert('selfAwareness has memoryStatus', imSrc.includes('memoryStatus'));
  assert('selfAwareness has knowledgeStatus', imSrc.includes('knowledgeStatus'));
  assert('selfAwareness has voiceStatus', imSrc.includes('voiceStatus'));
  assert('selfAwareness has visionStatus', imSrc.includes('visionStatus'));
  assert('selfAwareness has systemSummary', imSrc.includes('systemSummary'));
  assert('selfAwareness has systemSummaryFa', imSrc.includes('systemSummaryFa'));

  // Functional
  const { getNexIdentityManager } = await import('../../src/main/ai/nex-identity-manager');
  const idMgr = getNexIdentityManager();
  const identity = idMgr.getIdentity();
  assert('getIdentity returns NexIdentity', identity !== null);
  assert('identity.name is NEX AI', identity.name === 'NEX AI');
  assert('identity has version', typeof identity.version === 'string');
  assert('identity has mission', typeof identity.mission === 'string');
  assert('identity has missionFa', typeof identity.missionFa === 'string');
  assert('identity has abilities array', Array.isArray(identity.abilities));
  assert('identity has abilitiesFa array', Array.isArray(identity.abilitiesFa));
  assert('identity has limitations array', Array.isArray(identity.limitations));
  assert('identity has limitationsFa array', Array.isArray(identity.limitationsFa));
  assert('identity has rules array', Array.isArray(identity.rules));
  assert('identity has rulesFa array', Array.isArray(identity.rulesFa));
  assert('identity has personality', typeof identity.personality === 'string');
  assert('identity has personalityFa', typeof identity.personalityFa === 'string');
  assert('identity has 10+ abilities', identity.abilities.length >= 10);
  assert('identity has 5+ limitations', identity.limitations.length >= 5);
  assert('identity has 5+ rules', identity.rules.length >= 5);

  // updateIdentity
  const updated = idMgr.updateIdentity({ version: '2.0.0' });
  assert('updateIdentity changes version', updated.version === '2.0.0');
  // Reset
  idMgr.updateIdentity({ version: '1.0.0' });

  // setPersonality
  idMgr.setPersonality('friendly');
  assert('setPersonality(friendly)', idMgr.getIdentity().personality === 'friendly');
  idMgr.setPersonality('professional');
  assert('setPersonality(professional) resets', idMgr.getIdentity().personality === 'professional');

  // getSelfAwareness
  const awareness = await idMgr.getSelfAwareness();
  assert('getSelfAwareness returns NexSelfAwareness', awareness !== null);
  assert('awareness has installedModels', Array.isArray(awareness.installedModels));
  assert('awareness has availableTools', Array.isArray(awareness.availableTools));
  assert('awareness has capabilities', Array.isArray(awareness.capabilities));
  assert('awareness has capabilitiesFa', Array.isArray(awareness.capabilitiesFa));
  assert('awareness has cannotDo', Array.isArray(awareness.cannotDo));
  assert('awareness has cannotDoFa', Array.isArray(awareness.cannotDoFa));
  assert('awareness has activeBrain', typeof awareness.activeBrain === 'string');
  assert('awareness has memoryStatus', awareness.memoryStatus !== null);
  assert('awareness has knowledgeStatus', awareness.knowledgeStatus !== null);
  assert('awareness has voiceStatus', awareness.voiceStatus !== null);
  assert('awareness has visionStatus', awareness.visionStatus !== null);
  assert('awareness has systemSummary', typeof awareness.systemSummary === 'string');
  assert('awareness has systemSummaryFa', typeof awareness.systemSummaryFa === 'string');

  // ═══════════════════════════════════════════════════════════════════════
  // 3) IPC handlers
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');
  assert('brain-decide handler', mainSrc.includes("'brain-decide'"));
  assert('brain-status handler', mainSrc.includes("'brain-status'"));
  assert('brain-set-mode handler', mainSrc.includes("'brain-set-mode'"));
  assert('brain-last-decision handler', mainSrc.includes("'brain-last-decision'"));
  assert('brain-models-by-task handler', mainSrc.includes("'brain-models-by-task'"));
  assert('identity-get handler', mainSrc.includes("'identity-get'"));
  assert('identity-update handler', mainSrc.includes("'identity-update'"));
  assert('identity-set-personality handler', mainSrc.includes("'identity-set-personality'"));
  assert('identity-self-awareness handler', mainSrc.includes("'identity-self-awareness'"));
  assert('Phase 51 comment in main.ts', mainSrc.includes('Phase 51'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Preload bridges
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Preload bridges:');
  const preSrc = read('../../src/main/preload.ts');
  assert('brainDecide bridge', preSrc.includes('brainDecide'));
  assert('brainStatus bridge', preSrc.includes('brainStatus'));
  assert('brainSetMode bridge', preSrc.includes('brainSetMode'));
  assert('brainLastDecision bridge', preSrc.includes('brainLastDecision'));
  assert('brainModelsByTask bridge', preSrc.includes('brainModelsByTask'));
  assert('identityGet bridge', preSrc.includes('identityGet'));
  assert('identityUpdate bridge', preSrc.includes('identityUpdate'));
  assert('identitySetPersonality bridge', preSrc.includes('identitySetPersonality'));
  assert('identitySelfAwareness bridge', preSrc.includes('identitySelfAwareness'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Type definitions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Type definitions:');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('brainDecide type', typesSrc.includes('brainDecide'));
  assert('brainStatus type', typesSrc.includes('brainStatus'));
  assert('brainSetMode type', typesSrc.includes('brainSetMode'));
  assert('identityGet type', typesSrc.includes('identityGet'));
  assert('identitySelfAwareness type', typesSrc.includes('identitySelfAwareness'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) No autonomous installation (permission preserved)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) No autonomous installation:');
  assert('NO download() in brain controller', !bcSrc.includes('download('));
  assert('NO install() in brain controller', !bcSrc.includes('install('));
  assert('NO removeModel() in brain controller', !bcSrc.includes('removeModel'));
  assert('NO modelAdd() in brain controller', !bcSrc.includes('modelAdd'));
  assert('NO updateDownload in brain controller', !bcSrc.includes('updateDownload'));
  assert('NO updateInstall in brain controller', !bcSrc.includes('updateInstall'));
  assert('NO SecureDownloader import', !bcSrc.includes('SecureDownloader'));
  assert('NO ComponentInstaller import', !bcSrc.includes('ComponentInstaller'));
  assert('NO PermissionGate import', !bcSrc.includes('PermissionGate'));
  assert('NO fetch/https calls', !bcSrc.includes('fetch(') && !bcSrc.includes('https.get'));
  assert('brain only SELECTS (decide method)', bcSrc.includes('decide('));
  assert('brain only RECOMMENDS (returns decision)', bcSrc.includes('return') && bcSrc.includes('BrainDecision'));
  assert('identity rules include never download', imSrc.includes('Never download without permission'));
  assert('identity rulesFa include بدون اجازه', imSrc.includes('بدون اجازه'));
  assert('main.ts still has Phase 43 permission IPCs', mainSrc.includes("'update-respond-permission'"));
  assert('main.ts still has Phase 44 download IPCs', mainSrc.includes("'update-download'"));
  assert('main.ts still has Phase 50 system-status IPC', mainSrc.includes("'system-status'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Model catalog expanded (Phase 49 advanced catalog still exists)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Model catalog:');
  const catSrc = read('../../src/main/ai/model-intelligence/advanced-model-catalog.ts');
  assert('has DeepSeek Coder', catSrc.includes('deepseek-coder'));
  assert('has Llama', catSrc.includes('llama3.1'));
  assert('has Mistral', catSrc.includes('mistral-7b'));
  assert('has Qwen Coder', catSrc.includes('qwen2.5-coder'));
  assert('has LLaVA (vision)', catSrc.includes('llava-7b'));
  assert('has Qwen2.5-VL (vision)', catSrc.includes('qwen2.5-vl'));
  assert('has Whisper (voice)', catSrc.includes('whisper'));
  assert('has Piper (voice)', catSrc.includes('piper'));
  assert('has Persian support flag', catSrc.includes('persianSupport'));
  assert('has multilingual flag', catSrc.includes('multilingual'));

  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 51 BRAIN CORE RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('PHASE 51 NEX BRAIN CORE + IDENTITY SYSTEM: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
