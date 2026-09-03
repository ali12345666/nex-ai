/**
 * Phase 59 — Advanced Model Ecosystem Tests
 *
 * Verifies:
 *   1. Model profiles module structure + catalog expansion (no duplicate IDs)
 *   2. Model ecosystem manager module structure + security
 *   3. Catalog queries (by type, provider, tier, Persian)
 *   4. Model profiles (identity: role, strengths, weaknesses, languages, speed, quality)
 *   5. Catalog ↔ installed matching (gap analysis)
 *   6. Intelligent model advisor (task → best model recommendation)
 *   7. Multi-model collaboration (role assignments)
 *   8. Model comparison engine
 *   9. Hardware tier fit + hardware verdicts
 *  10. Runtime integration (ecosystem → runtime manager → brain)
 *  11. Identity update (multi-model self-awareness)
 *  12. IPC handlers + preload bridges + type declarations
 *  13. UI panel + navigation
 *  14. Security (no auto-download, no cloud, permission required)
 *  15. Phase 51-58 preserved (regression)
 *
 * Run: npx tsx tests/system/test-phase59-model-ecosystem.ts
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) Model Profiles Module Structure + Catalog Expansion
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) Model Profiles Module Structure:');
  const profilesSrc = read('../../src/main/ai/model-intelligence/model-profiles.ts');

  assert('model-profiles.ts exists', profilesSrc.length > 0);
  assert('ModelProfile interface', profilesSrc.includes('interface ModelProfile'));
  assert('CatalogEntryWithProfile interface', profilesSrc.includes('interface CatalogEntryWithProfile'));
  assert('EXPANDED_MODEL_ENTRIES const', profilesSrc.includes('export const EXPANDED_MODEL_ENTRIES'));
  assert('MODEL_PROFILES const', profilesSrc.includes('export const MODEL_PROFILES'));
  assert('EXPANDED_MODEL_CATALOG const', profilesSrc.includes('export const EXPANDED_MODEL_CATALOG'));
  assert('getModelProfile function', profilesSrc.includes('export function getModelProfile'));
  assert('getOrSynthesizeProfile function', profilesSrc.includes('export function getOrSynthesizeProfile'));
  assert('getExpandedCatalog function', profilesSrc.includes('export function getExpandedCatalog'));
  assert('getExpandedCatalogByType function', profilesSrc.includes('export function getExpandedCatalogByType'));
  assert('getExpandedCatalogByProvider function', profilesSrc.includes('export function getExpandedCatalogByProvider'));
  assert('getExpandedCatalogEntry function', profilesSrc.includes('export function getExpandedCatalogEntry'));
  assert('getExpandedModelsByTier function', profilesSrc.includes('export function getExpandedModelsByTier'));
  assert('getExpandedPersianModels function', profilesSrc.includes('export function getExpandedPersianModels'));
  assert('getEntriesWithProfiles function', profilesSrc.includes('export function getEntriesWithProfiles'));
  assert('verifyCatalogSecurity function', profilesSrc.includes('export function verifyCatalogSecurity'));
  assert('re-exports AdvancedModelEntry type', profilesSrc.includes("export type { AdvancedModelEntry"));

  // ModelProfile fields
  assert('profile has catalogId', profilesSrc.includes('catalogId'));
  assert('profile has role', profilesSrc.includes('role: string'));
  assert('profile has roleFa', profilesSrc.includes('roleFa'));
  assert('profile has strengths', profilesSrc.includes('strengths:'));
  assert('profile has weaknesses', profilesSrc.includes('weaknesses:'));
  assert('profile has languages', profilesSrc.includes('languages:'));
  assert('profile has speed', profilesSrc.includes('speed: number'));
  assert('profile has quality', profilesSrc.includes('quality: number'));
  assert('profile has recommendedUsageFa', profilesSrc.includes('recommendedUsageFa'));

  // Phase 59 expansion: new model families present
  assert('has Llama 3.2 entry', profilesSrc.includes("'llama3.2-"));
  assert('has Llama 3.3 entry', profilesSrc.includes("'llama3.3-"));
  assert('has Qwen 3 entry', profilesSrc.includes("'qwen3-"));
  assert('has Mistral Nemo entry', profilesSrc.includes("'mistral-nemo-"));
  assert('has Gemma 2 entry', profilesSrc.includes("'gemma2-"));
  assert('has Phi 3 medium entry', profilesSrc.includes("'phi3-medium-"));
  assert('has StarCoder2 entry', profilesSrc.includes("'starcoder2-"));
  assert('has CodeLlama entry', profilesSrc.includes("'codellama-"));
  assert('has DeepSeek R1 entry', profilesSrc.includes("'deepseek-r1-"));
  assert('has QwQ entry', profilesSrc.includes("'qwq-32b-"));
  assert('has LLaVA 1.6 entry', profilesSrc.includes("'llava-1.6-"));
  assert('has InternVL entry', profilesSrc.includes("'internvl2-"));
  assert('has BGE entry', profilesSrc.includes("'bge-m3-"));
  assert('has E5 entry', profilesSrc.includes("'multilingual-e5-"));

  // Runtime: catalog + no duplicate IDs
  const { getExpandedCatalog, verifyCatalogSecurity, getModelProfile, getOrSynthesizeProfile, getExpandedCatalogByType, getExpandedCatalogByProvider, getExpandedCatalogEntry, getExpandedModelsByTier, getExpandedPersianModels, getEntriesWithProfiles } = await import('../../src/main/ai/model-intelligence/model-profiles');
  const catalog = getExpandedCatalog();
  assert('expanded catalog has > 20 entries', catalog.length > 20, `got ${catalog.length}`);
  assert('expanded catalog has > 30 entries', catalog.length >= 30, `got ${catalog.length}`);

  // No duplicate IDs
  const ids = new Set<string>();
  let dupCount = 0;
  for (const e of catalog) { if (ids.has(e.id)) dupCount++; ids.add(e.id); }
  assert('no duplicate catalog IDs', dupCount === 0);

  const sec = verifyCatalogSecurity();
  assert('catalog security audit passes', sec.ok === true);

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Model Ecosystem Manager Module Structure + Security
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Ecosystem Manager Module Structure:');
  const mgrSrc = read('../../src/main/ai/model-intelligence/model-ecosystem-manager.ts');

  assert('model-ecosystem-manager.ts exists', mgrSrc.length > 0);
  assert('EcosystemRecommendation interface', mgrSrc.includes('interface EcosystemRecommendation'));
  assert('MultiModelCollaboration interface', mgrSrc.includes('interface MultiModelCollaboration'));
  assert('RoleAssignment interface', mgrSrc.includes('interface RoleAssignment'));
  assert('EcosystemComparison interface', mgrSrc.includes('interface EcosystemComparison'));
  assert('EcosystemStatus interface', mgrSrc.includes('interface EcosystemStatus'));
  assert('RecommendationReason type', mgrSrc.includes('export type RecommendationReason'));
  assert('ModelEcosystemManager class', mgrSrc.includes('export class ModelEcosystemManager'));
  assert('getCatalog method', mgrSrc.includes('getCatalog()'));
  assert('getCatalogByType method', mgrSrc.includes('getCatalogByType('));
  assert('getCatalogByProvider method', mgrSrc.includes('getCatalogByProvider('));
  assert('getCatalogEntry method', mgrSrc.includes('getCatalogEntry('));
  assert('getModelsByTier method', mgrSrc.includes('getModelsByTier('));
  assert('getPersianModels method', mgrSrc.includes('getPersianModels()'));
  assert('getProfiles method', mgrSrc.includes('getProfiles()'));
  assert('getProfile method', mgrSrc.includes('getProfile('));
  assert('matchCatalogToInstalled method', mgrSrc.includes('matchCatalogToInstalled('));
  assert('getInstalledWithCatalog method', mgrSrc.includes('getInstalledWithCatalog()'));
  assert('recommendForTask method', mgrSrc.includes('async recommendForTask('));
  assert('composeCollaboration method', mgrSrc.includes('async composeCollaboration('));
  assert('compareModels method', mgrSrc.includes('compareModels('));
  assert('recommendByTierFit method', mgrSrc.includes('recommendByTierFit('));
  assert('canRun method', mgrSrc.includes('canRun('));
  assert('getStatus method', mgrSrc.includes('getStatus()'));
  assert('detectHardware method', mgrSrc.includes('detectHardware()'));
  assert('verifyEcosystemSecurity function', mgrSrc.includes('export function verifyEcosystemSecurity'));
  assert('getModelEcosystemManager singleton', mgrSrc.includes('export function getModelEcosystemManager'));
  assert('_resetModelEcosystemManager for tests', mgrSrc.includes('export function _resetModelEcosystemManager'));

  // Imports — connects to all subsystems
  assert('imports model-profiles', mgrSrc.includes("from './model-profiles'"));
  assert('imports model-registry', mgrSrc.includes("from '../model-registry'"));
  assert('imports BrainController', mgrSrc.includes("from '../nex-brain-controller'"));
  assert('imports hardware recommender', mgrSrc.includes("from '../hardware-model-recommender'"));

  // Security
  assert('SECURITY comment', mgrSrc.includes('SECURITY'));
  assert('never downloads comment', mgrSrc.includes('never downloads') || mgrSrc.includes('No automatic downloads'));
  assert('no cloud comment', mgrSrc.includes('No cloud AI') || mgrSrc.includes('no cloud'));
  assert('no fetch() call', !mgrSrc.includes('fetch('));
  assert('no net.request call (code)', !mgrSrc.split('\n').some((l: string) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && l.includes('net.request')));
  assert('no SecureDownloader import', !mgrSrc.split('\n').some((l: string) => l.trim().startsWith('import') && l.includes('SecureDownloader')));
  assert('no async download() method', !mgrSrc.includes('async download('));
  assert('no async install() method', !mgrSrc.includes('async install('));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) Catalog Queries
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Catalog Queries:');
  const { getModelEcosystemManager, _resetModelEcosystemManager, verifyEcosystemSecurity } = await import('../../src/main/ai/model-intelligence/model-ecosystem-manager');
  _resetModelEcosystemManager();
  const mgr = getModelEcosystemManager();

  const fullCatalog = mgr.getCatalog();
  assert('getCatalog returns expanded catalog', fullCatalog.length === catalog.length);

  const llms = mgr.getCatalogByType('llm');
  assert('getCatalogByType(llm) returns LLMs', llms.length > 0);
  assert('all llm entries have type llm', llms.every((e: any) => e.type === 'llm'));

  const visionModels = mgr.getCatalogByType('vision');
  assert('getCatalogByType(vision) returns vision models', visionModels.length >= 2);

  const embeddingModels = mgr.getCatalogByType('embedding');
  assert('getCatalogByType(embedding) returns embedding models', embeddingModels.length >= 2);

  const qwenModels = mgr.getCatalogByProvider('qwen');
  assert('getCatalogByProvider(qwen) returns Qwen models', qwenModels.length >= 5);

  const deepseekModels = mgr.getCatalogByProvider('deepseek');
  assert('getCatalogByProvider(deepseek) returns DeepSeek models', deepseekModels.length >= 2);

  const entry = mgr.getCatalogEntry('qwen3-8b-q4');
  assert('getCatalogEntry returns entry', entry !== null);
  assert('catalog entry has name', entry!.name.length > 0);
  assert('catalog entry has displayNameFa', entry!.displayNameFa.length > 0);

  const missing = mgr.getCatalogEntry('nonexistent-model');
  assert('getCatalogEntry returns null for missing', missing === null);

  const lowTier = mgr.getModelsByTier('low');
  assert('getModelsByTier(low) returns models', lowTier.length > 0);
  assert('all low-tier models are low', lowTier.every((e: any) => e.recommendedTier === 'low'));

  const highTier = mgr.getModelsByTier('high');
  assert('getModelsByTier(high) returns models', highTier.length > 0);

  const persianModels = mgr.getPersianModels();
  assert('getPersianModels returns Persian-capable models', persianModels.length > 0);
  assert('all Persian models have persianSupport', persianModels.every((e: any) => e.persianSupport));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Model Profiles (identity)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Model Profiles:');
  const profiles = mgr.getProfiles();
  assert('getProfiles returns all entries with profiles', profiles.length === catalog.length);

  for (const p of profiles.slice(0, 3)) {
    assert(`profile for ${p.entry.id} has role`, p.profile.role.length > 0);
    assert(`profile for ${p.entry.id} has strengths`, p.profile.strengths.length > 0);
    assert(`profile for ${p.entry.id} has weaknesses`, p.profile.weaknesses.length > 0);
    assert(`profile for ${p.entry.id} has languages`, p.profile.languages.length > 0);
    assert(`profile for ${p.entry.id} has speed`, typeof p.profile.speed === 'number');
    assert(`profile for ${p.entry.id} has quality`, typeof p.profile.quality === 'number');
  }

  // Explicit profile lookup
  const coderProfile = mgr.getProfile('qwen2.5-coder-7b-q5');
  assert('explicit profile for coder exists', coderProfile !== null);
  assert('coder profile has role', coderProfile!.role.length > 0);
  assert('coder profile roleFa is Persian', /[\u0600-\u06FF]/.test(coderProfile!.roleFa));

  // Synthesized profile for an entry without explicit profile
  const synthEntry = { ...catalog[0], id: 'synth-test-' + Date.now() };
  const synthProfile = getOrSynthesizeProfile(synthEntry);
  assert('synthesized profile has role', synthProfile.role.length > 0);
  assert('synthesized profile has strengths', synthProfile.strengths.length > 0);

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Catalog ↔ Installed Matching (gap analysis)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Catalog ↔ Installed Matching:');
  const installed = mgr.getInstalledWithCatalog();
  assert('getInstalledWithCatalog returns array', Array.isArray(installed));

  // matchCatalogToInstalled for a known catalog entry
  const match = mgr.matchCatalogToInstalled(catalog[0]);
  assert('matchCatalogToInstalled returns LocalModelInfo or null', match === null || typeof match === 'object');

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Intelligent Model Advisor (task → best model)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Intelligent Model Advisor:');
  _resetModelEcosystemManager();
  const mgr2 = getModelEcosystemManager();

  // Coding task
  const codingRec = await mgr2.recommendForTask({ request: 'برنامه نویسی پایتون', intent: 'coding' });
  assert('coding task returns recommendation', codingRec !== null && codingRec !== undefined);
  assert('coding recommendation has catalogEntry', codingRec.catalogEntry !== null);
  assert('coding recommendation has profile', codingRec.profile !== null);
  assert('coding recommendation has reason', codingRec.reasonText.length > 0);
  assert('coding recommendation has reasonFa', codingRec.reasonFa.length > 0);
  assert('coding recommendation has reason type', ['installed-and-best', 'not-installed-recommended', 'hardware-insufficient', 'installed-but-better-available', 'no-suitable-model'].includes(codingRec.reason));
  assert('coding recommendation has alreadyInstalled boolean', typeof codingRec.alreadyInstalled === 'boolean');
  assert('coding recommendation has canRun boolean', typeof codingRec.canRun === 'boolean');

  // Vision task
  const visionRec = await mgr2.recommendForTask({ request: 'تحلیل تصویر', hasImage: true });
  assert('vision task returns recommendation', visionRec !== null);
  assert('vision recommendation is a vision model', visionRec.catalogEntry.type === 'vision');

  // Reasoning task
  const reasoningRec = await mgr2.recommendForTask({ request: 'استدلال پیچیده', intent: 'reasoning' });
  assert('reasoning task returns recommendation', reasoningRec !== null);

  // Persian task should prefer Persian-capable models
  const persianRec = await mgr2.recommendForTask({ request: 'یک مدار طراحی کن' });
  assert('Persian task returns recommendation', persianRec !== null);

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Multi-Model Collaboration
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Multi-Model Collaboration:');
  _resetModelEcosystemManager();
  const mgr3 = getModelEcosystemManager();

  const collab = await mgr3.composeCollaboration({ request: 'این تصویر را تحلیل کن و کد آن را بنویس', hasImage: true });
  assert('composeCollaboration returns collaboration', collab !== null);
  assert('collaboration has request', collab.request.length > 0);
  assert('collaboration has primaryDecision', collab.primaryDecision !== null);
  assert('collaboration has roleAssignments array', Array.isArray(collab.roleAssignments));
  assert('collaboration has installedCount', typeof collab.installedCount === 'number');
  assert('collaboration has missingCount', typeof collab.missingCount === 'number');
  assert('collaboration has summaryFa', collab.summaryFa.length > 0);

  // Role assignments include primary
  const primaryRole = collab.roleAssignments.find((r: any) => r.role === 'primary');
  assert('collaboration has primary role', primaryRole !== undefined);

  // Vision task → vision role
  const visionRole = collab.roleAssignments.find((r: any) => r.role === 'vision');
  assert('image task includes vision role', visionRole !== undefined);

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Model Comparison Engine
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Model Comparison Engine:');
  const cmp = mgr.compareModels('qwen2.5-7b-q4', 'qwen2.5-coder-7b-q5');
  assert('compareModels returns comparison', cmp !== null);
  assert('comparison has modelA', cmp.modelA !== null);
  assert('comparison has modelB', cmp.modelB !== null);
  assert('comparison has differences', Object.keys(cmp.differences).length > 0);
  assert('comparison has overallWinner', ['A', 'B', 'tie'].includes(cmp.overallWinner));
  assert('comparison has recommendationFa', cmp.recommendationFa.length > 0);
  assert('comparison includes qualityScore diff', 'qualityScore' in cmp.differences);
  assert('comparison includes codingScore diff', 'codingScore' in cmp.differences);
  assert('comparison includes sizeGB diff', 'sizeGB' in cmp.differences);

  // Compare nonexistent
  const cmpNull = mgr.compareModels('nonexistent-a', 'nonexistent-b');
  assert('compareModels returns null for missing', cmpNull === null);

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Hardware Tier Fit + Hardware Verdicts
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Hardware Tier Fit:');
  const lowFit = mgr.recommendByTierFit('low');
  assert('recommendByTierFit(low) returns recs', lowFit.length > 0);
  for (const r of lowFit.slice(0, 2)) {
    assert(`tier-fit rec has catalogEntry`, r.catalogEntry !== null);
    assert(`tier-fit rec has profile`, r.profile !== null);
    assert(`tier-fit rec has reason`, r.reasonText.length > 0);
  }

  // Hardware verdict for a catalog entry
  const verdict = mgr.canRun(catalog[0]);
  assert('canRun returns verdict or null', verdict === null || (typeof verdict.canRun === 'boolean' && typeof verdict.reason === 'string'));

  // Hardware detection
  const hw = mgr.detectHardware();
  assert('detectHardware returns HardwareProfile', hw !== null);
  assert('hardware has cpuCores', typeof hw.cpuCores === 'number' && hw.cpuCores > 0);
  assert('hardware has ramTotalBytes', typeof hw.ramTotalBytes === 'number' && hw.ramTotalBytes > 0);

  // ═══════════════════════════════════════════════════════════════════════
  // 10) Runtime Integration (ecosystem → runtime manager → brain)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) Runtime Integration:');
  // The ecosystem manager connects to the Brain Controller via recommendForTask
  assert('manager source imports getNexBrainController', mgrSrc.includes('getNexBrainController'));
  assert('manager source calls brain.decide', mgrSrc.includes('brain.decide(request)'));
  // recommendForTask delegates to the brain
  assert('recommendForTask is async', mgrSrc.includes('async recommendForTask'));

  // Status includes ecosystem + hardware info
  const status = mgr.getStatus();
  assert('getStatus returns EcosystemStatus', status !== null);
  assert('status has totalCatalogModels', typeof status.totalCatalogModels === 'number');
  assert('status has installedModels', typeof status.installedModels === 'number');
  assert('status has byType', typeof status.byType === 'object');
  assert('status has byTier', typeof status.byTier === 'object');
  assert('status has hardware', status.hardware !== null);
  assert('status has catalogSecurityOk', typeof status.catalogSecurityOk === 'boolean');

  // ═══════════════════════════════════════════════════════════════════════
  // 11) Identity Update (multi-model self-awareness)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n11) Identity Update:');
  const idSrc = read('../../src/main/ai/nex-identity-manager.ts');
  assert('identity has Phase 59 ecosystem ability', idSrc.includes('Advanced model ecosystem management'));
  assert('identity has multi-model collaboration ability', idSrc.includes('Multi-model collaboration'));
  assert('identity has advisor ability', idSrc.includes('Intelligent model advisor & comparison'));
  assert('identity has Persian ecosystem ability', idSrc.includes('مدیریت اکوسیستم پیشرفته مدل‌ها'));
  assert('identity has Persian collaboration ability', idSrc.includes('همکاری چندمدلی تحت یک مغز'));
  assert('identity has multi-model-use rule', idSrc.includes('I can use multiple specialized AI models together'));
  assert('identity has best-model-from-catalog rule', idSrc.includes('I select the best model for each task from the catalog'));
  assert('identity has Persian multi-model-use rule', idSrc.includes('چندین مدل تخصصی هوش مصنوعی به‌صورت مشترک'));

  // Runtime identity check
  const { getNexIdentityManager } = await import('../../src/main/ai/nex-identity-manager');
  const identity = getNexIdentityManager().getIdentity();
  assert('identity has Phase 59 ability', identity.abilities.some((a: string) => a.includes('Advanced model ecosystem')));
  assert('identity has multi-model-use rule', identity.rules.some((r: string) => r.includes('multiple specialized AI models')));

  // ═══════════════════════════════════════════════════════════════════════
  // 12) IPC + Preload + Types
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n12) IPC + Preload + Types:');
  const mainSrc = read('../../src/main/main.ts');
  assert('main has Phase 59 block', mainSrc.includes('Phase 59: Advanced Model Ecosystem'));
  assert('main imports ModelEcosystemManager', mainSrc.includes("import('./ai/model-intelligence/model-ecosystem-manager')"));
  assert('main imports model-profiles', mainSrc.includes("import('./ai/model-intelligence/model-profiles')"));

  const ipcChannels = [
    'ecosystem-catalog', 'ecosystem-catalog-by-type', 'ecosystem-catalog-by-provider',
    'ecosystem-catalog-entry', 'ecosystem-models-by-tier', 'ecosystem-persian-models',
    'ecosystem-profiles', 'ecosystem-profile', 'ecosystem-recommend', 'ecosystem-collaboration',
    'ecosystem-compare', 'ecosystem-installed-with-catalog', 'ecosystem-tier-fit',
    'ecosystem-can-run', 'ecosystem-status', 'ecosystem-security-audit',
  ];
  for (const ch of ipcChannels) {
    assert(`main registers ipc handler '${ch}'`, mainSrc.includes(`ipcMain.handle('${ch}'`));
  }

  // Preload
  const preloadSrc = read('../../src/main/preload.ts');
  assert('preload has Phase 59 section', preloadSrc.includes('Phase 59: Advanced Model Ecosystem'));
  const preloadMethods = [
    'ecosystemCatalog', 'ecosystemCatalogByType', 'ecosystemCatalogByProvider',
    'ecosystemCatalogEntry', 'ecosystemModelsByTier', 'ecosystemPersianModels',
    'ecosystemProfiles', 'ecosystemProfile', 'ecosystemRecommend', 'ecosystemCollaboration',
    'ecosystemCompare', 'ecosystemInstalledWithCatalog', 'ecosystemTierFit',
    'ecosystemCanRun', 'ecosystemStatus', 'ecosystemSecurityAudit',
  ];
  for (const m of preloadMethods) {
    assert(`preload exposes '${m}'`, preloadSrc.includes(`${m}:`));
  }

  // Types
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('types has Phase 59 section', typesSrc.includes('Phase 59: Advanced Model Ecosystem'));
  for (const m of preloadMethods) {
    assert(`types declares '${m}'`, typesSrc.includes(`${m}:`));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 13) UI Panel + Navigation
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n13) UI Panel + Navigation:');
  const panelSrc = read('../../src/renderer/components/ModelEcosystemPanel.tsx');
  assert('ModelEcosystemPanel exists', panelSrc.length > 0);
  assert('panel default export', panelSrc.includes('export default function ModelEcosystemPanel'));
  assert('panel has tabs (catalog/installed/advisor/compare)', panelSrc.includes("'catalog'") && panelSrc.includes("'advisor'") && panelSrc.includes("'compare'"));
  assert('panel calls ecosystemCatalog', panelSrc.includes('ecosystemCatalog'));
  assert('panel calls ecosystemStatus', panelSrc.includes('ecosystemStatus'));
  assert('panel calls ecosystemRecommend', panelSrc.includes('ecosystemRecommend'));
  assert('panel calls ecosystemCollaboration', panelSrc.includes('ecosystemCollaboration'));
  assert('panel calls ecosystemCompare', panelSrc.includes('ecosystemCompare'));
  assert('panel calls ecosystemInstalledWithCatalog', panelSrc.includes('ecosystemInstalledWithCatalog'));
  assert('panel shows catalog', panelSrc.includes('catalog'));
  assert('panel shows profiles', panelSrc.includes('profiles') || panelSrc.includes('profile'));
  assert('panel has search', panelSrc.includes('search'));
  assert('panel has filter', panelSrc.includes('filterType'));
  assert('panel has security note', panelSrc.includes('اجازه') || panelSrc.includes('PermissionGate') || panelSrc.includes('permission'));

  const navSrc = read('../../src/renderer/components/layout/NavigationRail.tsx');
  assert('nav has ecosystem view', navSrc.includes("'ecosystem'"));
  assert('nav has Boxes icon', navSrc.includes('Boxes'));
  assert('nav has Models label', navSrc.includes("label: 'Models'"));

  const appShellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
  assert('AppShell imports ModelEcosystemPanel', appShellSrc.includes('ModelEcosystemPanel'));
  assert('AppShell routes ecosystem view', appShellSrc.includes("case 'ecosystem'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 14) Security (no auto-download, no cloud, permission required)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n14) Security:');
  const ecoSec = verifyEcosystemSecurity();
  assert('ecosystem security audit passes', ecoSec.ok === true);
  assert('catalog security audit passes', verifyCatalogSecurity().ok === true);

  // No cloud imports
  assert('profiles source no fetch()', !profilesSrc.includes('fetch('));
  assert('manager source no fetch()', !mgrSrc.includes('fetch('));
  assert('profiles source no XMLHttpRequest', !profilesSrc.includes('XMLHttpRequest'));
  assert('manager source no XMLHttpRequest', !mgrSrc.includes('XMLHttpRequest'));

  // No download/install/delete methods
  assert('manager no async download() method', !mgrSrc.includes('async download('));
  assert('manager no async install() method', !mgrSrc.includes('async install('));
  assert('manager no async delete() method', !mgrSrc.includes('async delete('));

  // The manager only ANALYZES and RECOMMENDS — execution is delegated
  assert('manager never calls runtime.loadModel directly', !mgrSrc.includes('runtime.loadModel'));
  assert('manager never calls inference directly', !mgrSrc.includes("from '../inference'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 15) Phase 51-58 Preserved (Regression)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n15) Phase 51-58 Preserved:');
  assert('Phase 39 model-registry exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-registry.ts')));
  assert('Phase 39 hardware-model-recommender exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/hardware-model-recommender.ts')));
  assert('Phase 45 models-catalog exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-intelligence/models-catalog.ts')));
  assert('Phase 45 model-advisor exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-intelligence/model-advisor.ts')));
  assert('Phase 45 smart-model-router exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-intelligence/smart-model-router.ts')));
  assert('Phase 49 advanced-model-catalog exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-intelligence/advanced-model-catalog.ts')));
  assert('Phase 51 nex-brain-controller exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-brain-controller.ts')));
  assert('Phase 52 nex-personality-engine exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-personality-engine.ts')));
  assert('Phase 52 long-term-memory-system exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/long-term-memory-system.ts')));
  assert('Phase 53 nex-expert-system exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-expert-system.ts')));
  assert('Phase 54 nex-agent-executor exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-agent-executor.ts')));
  assert('Phase 55 expert-knowledge-engine exists', fs.existsSync(path.join(__dirname, '../../src/main/knowledge/expert-knowledge-engine.ts')));
  assert('Phase 56 nex-voice-conversation exists', fs.existsSync(path.join(__dirname, '../../src/main/voice/nex-voice-conversation.ts')));
  assert('Phase 57 nex-executive-planner exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-executive-planner.ts')));
  assert('Phase 58 multi-model-runtime-manager exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/multi-model-runtime-manager.ts')));
  assert('Phase 58 local-model-provider exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/local-model-provider.ts')));
  assert('Phase 58 LocalRuntimePanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/LocalRuntimePanel.tsx')));
  assert('Phase 57 PlannerPanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/PlannerPanel.tsx')));

  // Existing subsystems still work
  const { getAdvancedCatalog } = await import('../../src/main/ai/model-intelligence/advanced-model-catalog');
  assert('Phase 49 advanced catalog still returns entries', getAdvancedCatalog().length > 0);
  const { getNexBrainController } = await import('../../src/main/ai/nex-brain-controller');
  assert('brain controller still decides', typeof getNexBrainController().decide === 'function');
  const { getMultiModelRuntimeManager } = await import('../../src/main/ai/multi-model-runtime-manager');
  assert('Phase 58 runtime manager singleton still works', typeof getMultiModelRuntimeManager === 'function');
  const { getExpertProfiles } = await import('../../src/main/ai/nex-expert-system');
  assert('expert profiles still 6', getExpertProfiles().length === 6);

  // ═══════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 59 MODEL ECOSYSTEM RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('FAILURES:', failures.join(' | '));
    process.exit(1);
  }
  console.log('PHASE 59 ADVANCED MODEL ECOSYSTEM: ALL PASS ✅');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
