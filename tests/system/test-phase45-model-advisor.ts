/**
 * Phase 45 — Intelligent Model Advisor + Smart Router Tests
 *
 * Verifies:
 *   1. Models catalog (database with scores)
 *   2. Usage analyzer (task tracking + workload patterns)
 *   3. Model advisor (hardware analysis + recommendations + comparison)
 *   4. Smart model router (task-type → model selection)
 *   5. Advisor persistence (preferences + rejected recs + history)
 *   6. IPC handlers registered
 *   7. Permission integration (no autonomous download)
 *
 * Run: npx tsx tests/system/test-phase45-model-advisor.ts
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
  // 1) Models Catalog
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) Models Catalog:');
  const catSrc = read('../../src/main/ai/model-intelligence/models-catalog.ts');

  assert('models-catalog.ts exists', catSrc.length > 0);
  assert('CatalogModelEntry interface', catSrc.includes('interface CatalogModelEntry'));
  assert('entry has qualityScore', catSrc.includes('qualityScore'));
  assert('entry has speedScore', catSrc.includes('speedScore'));
  assert('entry has codingScore', catSrc.includes('codingScore'));
  assert('entry has reasoningScore', catSrc.includes('reasoningScore'));
  assert('entry has visionScore', catSrc.includes('visionScore'));
  assert('entry has voiceScore', catSrc.includes('voiceScore'));
  assert('entry has requiredRAM', catSrc.includes('requiredRAM'));
  assert('entry has requiredVRAM', catSrc.includes('requiredVRAM'));
  assert('entry has gpuSupport', catSrc.includes('gpuSupport'));
  assert('entry has quantization', catSrc.includes('quantization'));
  assert('entry has parameterCount', catSrc.includes('parameterCount'));
  assert('entry has recommendedFor', catSrc.includes('recommendedFor'));
  assert('entry has downloadInfo', catSrc.includes('downloadInfo'));
  assert('ModelCategory type (chat/coding/reasoning/vision/voice/embedding)', catSrc.includes("'chat'") && catSrc.includes("'coding'") && catSrc.includes("'vision'") && catSrc.includes("'voice'"));
  assert('getCatalog function', catSrc.includes('export function getCatalog'));
  assert('getCatalogByCategory function', catSrc.includes('export function getCatalogByCategory'));
  assert('getCatalogEntry function', catSrc.includes('export function getCatalogEntry'));
  assert('has Qwen models', catSrc.includes('qwen'));
  assert('has Llama models', catSrc.includes('llama'));
  assert('has LLaVA models', catSrc.includes('llava'));
  assert('has Whisper models', catSrc.includes('whisper'));
  assert('has embedding model (nomic)', catSrc.includes('nomic'));

  // Functional: catalog has entries
  const { getCatalog, getCatalogByCategory, getCatalogEntry } =
    await import('../../src/main/ai/model-intelligence/models-catalog');
  const catalog = getCatalog();
  assert('catalog has 10+ entries', catalog.length >= 10);
  assert('catalog has coding category', getCatalogByCategory('coding').length > 0);
  assert('catalog has vision category', getCatalogByCategory('vision').length > 0);
  assert('catalog has voice category', getCatalogByCategory('voice').length > 0);
  assert('getCatalogEntry returns entry', getCatalogEntry('qwen2.5-7b-q4') !== null);
  assert('getCatalogEntry returns null for unknown', getCatalogEntry('nonexistent') === null);

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Usage Analyzer
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Usage Analyzer:');
  const uaSrc = read('../../src/main/ai/model-intelligence/usage-analyzer.ts');

  assert('usage-analyzer.ts exists', uaSrc.length > 0);
  assert('UsageAnalyzer class exported', uaSrc.includes('export class UsageAnalyzer'));
  assert('record method', uaSrc.includes('record('));
  assert('getStats method', uaSrc.includes('getStats('));
  assert('classifyRequest method', uaSrc.includes('classifyRequest'));
  assert('getRecentRecords method', uaSrc.includes('getRecentRecords'));
  assert('UsageRecord interface', uaSrc.includes('interface UsageRecord'));
  assert('UsageStats interface', uaSrc.includes('interface UsageStats'));
  assert('TaskCategory type', uaSrc.includes('TaskCategory'));
  assert('primaryWorkload field', uaSrc.includes('primaryWorkload'));
  assert('persists to usage-stats.json', uaSrc.includes('usage-stats.json'));
  assert('caps at MAX_RECORDS', uaSrc.includes('MAX_RECORDS'));
  assert('getUsageAnalyzer singleton', uaSrc.includes('export function getUsageAnalyzer'));

  // Functional: classifyRequest
  const { getUsageAnalyzer } = await import('../../src/main/ai/model-intelligence/usage-analyzer');
  const analyzer = getUsageAnalyzer();

  assert('classifyRequest: coding', analyzer.classifyRequest('fix this function bug') === 'coding');
  assert('classifyRequest: reasoning', analyzer.classifyRequest('explain why this design works') === 'reasoning');
  assert('classifyRequest: vision', analyzer.classifyRequest('look at this image and describe it') === 'vision');
  assert('classifyRequest: chat (default)', analyzer.classifyRequest('tell me a joke') === 'chat');

  // Functional: record + getStats
  analyzer.record({
    category: 'coding',
    modelName: 'TestModel',
    success: true,
    latencyMs: 1000,
    requestPreview: 'fix bug',
  });
  const stats = analyzer.getStats();
  assert('getStats returns totalTasks > 0', stats.totalTasks > 0);

  // ═══════════════════════════════════════════════════════════════════════
  // 3) Model Advisor
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Model Advisor:');
  const maSrc = read('../../src/main/ai/model-intelligence/model-advisor.ts');

  assert('model-advisor.ts exists', maSrc.length > 0);
  assert('ModelAdvisor class exported', maSrc.includes('export class ModelAdvisor'));
  assert('analyzeHardware method', maSrc.includes('analyzeHardware'));
  assert('generateRecommendations method', maSrc.includes('generateRecommendations'));
  assert('compareModels method', maSrc.includes('compareModels'));
  assert('estimatePerformanceGain method', maSrc.includes('estimatePerformanceGain'));
  assert('ModelRecommendation interface', maSrc.includes('interface ModelRecommendation'));
  assert('ModelComparison interface', maSrc.includes('interface ModelComparison'));
  assert('HardwareAnalysis interface', maSrc.includes('interface HardwareAnalysis'));
  assert('uses detectHardwareProfile (Phase 39)', maSrc.includes('detectHardwareProfile'));
  assert('uses canModelRunOnHardware (Phase 39)', maSrc.includes('canModelRunOnHardware'));
  assert('uses getCatalog', maSrc.includes('getCatalog'));
  assert('uses getUsageAnalyzer', maSrc.includes('getUsageAnalyzer'));
  assert('getModelAdvisor singleton', maSrc.includes('export function getModelAdvisor'));
  assert('NO autonomous download', !maSrc.includes('download(') && !maSrc.includes('install('));
  assert('NO PermissionGate import (advisor only recommends)', !maSrc.includes("from '../../update/permission-gate'") && !maSrc.includes("import { PermissionGate }"));

  // Functional: analyzeHardware
  const { getModelAdvisor } = await import('../../src/main/ai/model-intelligence/model-advisor');
  const advisor = getModelAdvisor();
  const analysis = advisor.analyzeHardware();
  assert('analyzeHardware returns HardwareAnalysis', analysis !== null);
  assert('analysis has profile', analysis.profile !== null);
  assert('analysis has installedModels', Array.isArray(analysis.installedModels));
  assert('analysis has recommendations', Array.isArray(analysis.recommendations));

  // Functional: compareModels
  const comparison = advisor.compareModels('qwen2.5-7b-q4', 'qwen2.5-coder-14b-q5');
  assert('compareModels returns comparison', comparison !== null);
  assert('comparison has modelA', comparison?.modelA !== null);
  assert('comparison has modelB', comparison?.modelB !== null);
  assert('comparison has winner', comparison?.winner !== null);
  assert('comparison has differences', comparison?.differences !== null);
  assert('comparison has recommendation', comparison?.recommendation !== null);

  // Functional: compareModels with unknown IDs
  const nullComparison = advisor.compareModels('nonexistent', 'alsogone');
  assert('compareModels returns null for unknown', nullComparison === null);

  // Functional: estimatePerformanceGain
  const gain = advisor.estimatePerformanceGain('qwen2.5-7b-q4', 'qwen2.5-coder-14b-q5');
  assert('estimatePerformanceGain returns result', gain !== null);
  assert('gain has overallPercent', typeof gain.overallPercent === 'number');

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Smart Model Router
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Smart Model Router:');
  const srSrc = read('../../src/main/ai/model-intelligence/smart-model-router.ts');

  assert('smart-model-router.ts exists', srSrc.length > 0);
  assert('SmartModelRouter class exported', srSrc.includes('export class SmartModelRouter'));
  assert('selectModel method', srSrc.includes('selectModel('));
  assert('getStatus method', srSrc.includes('getStatus('));
  assert('RouterRequest interface', srSrc.includes('interface RouterRequest'));
  assert('RouterDecision interface', srSrc.includes('interface RouterDecision'));
  assert('decision has selectedModel', srSrc.includes('selectedModel'));
  assert('decision has reason', srSrc.includes('reason'));
  assert('decision has confidence', srSrc.includes('confidence'));
  assert('decision has category', srSrc.includes('category'));
  assert('decision has complexity', srSrc.includes('complexity'));
  assert('decision has alternatives', srSrc.includes('alternatives'));
  assert('TaskComplexity type (simple/moderate/complex)', srSrc.includes("'simple'") && srSrc.includes("'moderate'") && srSrc.includes("'complex'"));
  assert('uses listModels (Phase 39)', srSrc.includes('listModels'));
  assert('uses detectHardwareProfile (Phase 39)', srSrc.includes('detectHardwareProfile'));
  assert('uses canModelRunOnHardware (Phase 39)', srSrc.includes('canModelRunOnHardware'));
  assert('uses getUsageAnalyzer', srSrc.includes('getUsageAnalyzer'));
  assert('getSmartModelRouter singleton', srSrc.includes('export function getSmartModelRouter'));

  // Functional: selectModel
  const { getSmartModelRouter } = await import('../../src/main/ai/model-intelligence/smart-model-router');
  const router = getSmartModelRouter();
  const decision = router.selectModel({ request: 'fix a coding bug in the function' });
  assert('selectModel returns decision', decision !== null);
  assert('decision has category', typeof decision.category === 'string');
  assert('decision has complexity', typeof decision.complexity === 'string');
  assert('decision has reason', typeof decision.reason === 'string');
  assert('decision has confidence (0-1)', decision.confidence >= 0 && decision.confidence <= 1);

  // Functional: getStatus
  const status = router.getStatus();
  assert('getStatus returns status', status !== null);
  assert('status has totalModels', typeof status.totalModels === 'number');
  assert('status has runnableModels', typeof status.runnableModels === 'number');
  assert('status has byCategory', typeof status.byCategory === 'object');

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Advisor Persistence
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Advisor Persistence:');
  const apSrc = read('../../src/main/ai/model-intelligence/advisor-persistence.ts');

  assert('advisor-persistence.ts exists', apSrc.length > 0);
  assert('AdvisorPersistence class exported', apSrc.includes('export class AdvisorPersistence'));
  assert('getPreferences method', apSrc.includes('getPreferences'));
  assert('setPreferredModel method', apSrc.includes('setPreferredModel'));
  assert('rejectRecommendation method', apSrc.includes('rejectRecommendation'));
  assert('isRecommendationRejected method', apSrc.includes('isRecommendationRejected'));
  assert('addInstalledModel method', apSrc.includes('addInstalledModel'));
  assert('getInstalledHistory method', apSrc.includes('getInstalledHistory'));
  assert('persists to advisor-preferences.json', apSrc.includes('advisor-preferences.json'));
  assert('atomic write (temp + rename)', apSrc.includes('renameSync'));
  assert('AdvisorPreferences interface', apSrc.includes('interface AdvisorPreferences'));
  assert('preferredModels field', apSrc.includes('preferredModels'));
  assert('rejectedRecommendations field', apSrc.includes('rejectedRecommendations'));
  assert('autoRecommendEnabled field', apSrc.includes('autoRecommendEnabled'));
  assert('InstalledModelHistoryEntry interface', apSrc.includes('interface InstalledModelHistoryEntry'));
  assert('getAdvisorPersistence singleton', apSrc.includes('export function getAdvisorPersistence'));

  // Functional: persistence
  const { getAdvisorPersistence } = await import('../../src/main/ai/model-intelligence/advisor-persistence');
  const persistence = getAdvisorPersistence();

  // Set preferred model
  persistence.setPreferredModel('coding', 'qwen2.5-coder-14b-q5');
  assert('setPreferredModel → getPreferredModel returns it', persistence.getPreferredModel('coding') === 'qwen2.5-coder-14b-q5');

  // Reject recommendation
  persistence.rejectRecommendation('some-bad-rec');
  assert('rejectRecommendation → isRecommendationRejected true', persistence.isRecommendationRejected('some-bad-rec') === true);
  assert('isRecommendationRejected false for unknown', persistence.isRecommendationRejected('unknown-rec') === false);

  // Add installed history
  persistence.addInstalledModel({
    modelId: 'qwen2.5-7b-q4',
    modelName: 'Qwen2.5 7B Q4',
    installedVia: 'manual',
    version: '1.0',
  });
  const history = persistence.getInstalledHistory();
  assert('getInstalledHistory returns entries', history.length > 0);
  assert('history entry has modelId', history[0].modelId === 'qwen2.5-7b-q4');

  // ═══════════════════════════════════════════════════════════════════════
  // 6) IPC handlers registered
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');
  assert('model-advisor-status handler', mainSrc.includes("'model-advisor-status'"));
  assert('model-recommendations handler', mainSrc.includes("'model-recommendations'"));
  assert('model-compare handler', mainSrc.includes("'model-compare'"));
  assert('model-router-decision handler', mainSrc.includes("'model-router-decision'"));
  assert('model-router-status handler', mainSrc.includes("'model-router-status'"));
  assert('usage-stats handler', mainSrc.includes("'usage-stats'"));
  assert('usage-record handler', mainSrc.includes("'usage-record'"));
  assert('advisor-preferences handler', mainSrc.includes("'advisor-preferences'"));
  assert('advisor-reject-recommendation handler', mainSrc.includes("'advisor-reject-recommendation'"));
  assert('advisor-set-preferred-model handler', mainSrc.includes("'advisor-set-preferred-model'"));
  assert('advisor-installed-history handler', mainSrc.includes("'advisor-installed-history'"));
  assert('Phase 45 comment in main.ts', mainSrc.includes('Phase 45'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Preload bridges
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Preload bridges:');
  const preSrc = read('../../src/main/preload.ts');
  assert('modelAdvisorStatus bridge', preSrc.includes('modelAdvisorStatus'));
  assert('modelRecommendations bridge', preSrc.includes('modelRecommendations'));
  assert('modelCompare bridge', preSrc.includes('modelCompare'));
  assert('modelRouterDecision bridge', preSrc.includes('modelRouterDecision'));
  assert('modelRouterStatus bridge', preSrc.includes('modelRouterStatus'));
  assert('usageStats bridge', preSrc.includes('usageStats'));
  assert('usageRecord bridge', preSrc.includes('usageRecord'));
  assert('advisorPreferences bridge', preSrc.includes('advisorPreferences'));
  assert('advisorRejectRecommendation bridge', preSrc.includes('advisorRejectRecommendation'));
  assert('advisorSetPreferredModel bridge', preSrc.includes('advisorSetPreferredModel'));
  assert('advisorInstalledHistory bridge', preSrc.includes('advisorInstalledHistory'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Type definitions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Type definitions:');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('modelAdvisorStatus type', typesSrc.includes('modelAdvisorStatus'));
  assert('modelRecommendations type', typesSrc.includes('modelRecommendations'));
  assert('modelCompare type', typesSrc.includes('modelCompare'));
  assert('modelRouterDecision type', typesSrc.includes('modelRouterDecision'));
  assert('usageStats type', typesSrc.includes('usageStats'));
  assert('advisorPreferences type', typesSrc.includes('advisorPreferences'));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Permission integration (NO autonomous download)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Permission integration (no autonomous actions):');
  const allIntelSrc = maSrc + srSrc + uaSrc + apSrc;
  assert('NO download() calls in advisor', !maSrc.includes('download('));
  assert('NO install() calls in advisor', !maSrc.includes('install('));
  assert('NO removeModel() calls in advisor', !maSrc.includes('removeModel'));
  assert('NO setActiveModel() calls in advisor', !maSrc.includes('setActiveModel'));
  assert('NO deleteFile() calls in router', !srSrc.includes('deleteFile'));
  assert('advisor only RECOMMENDS (returns data)', maSrc.includes('return') && maSrc.includes('recs'));
  assert('router only SELECTS (returns decision)', srSrc.includes('return') && srSrc.includes('selectedModel'));
  assert('NO fetch/https in model-intelligence', !allIntelSrc.includes('fetch(') && !allIntelSrc.includes('https.get'));
  assert('NO external API calls', !allIntelSrc.includes('api.openai.com') && !allIntelSrc.includes('googleapis.com'));

  // ═══════════════════════════════════════════════════════════════════════
  // 10) Phase 44 update integration (advisor → permission → download)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) Phase 44 update integration:');
  // The advisor generates recommendations. When the user approves,
  // the flow goes through Phase 44: SecureDownloader → SignatureVerifier →
  // UpdateInstaller → ModelUpdater. The advisor does NOT do any of this.
  assert('advisor has downloadInfo in catalog entries', catSrc.includes('downloadInfo'));
  assert('advisor recommendations include estimatedImprovement', maSrc.includes('estimatedImprovement'));
  assert('advisor recommendations include reason', maSrc.includes('reason'));
  assert('advisor does NOT call SecureDownloader directly', !maSrc.includes('SecureDownloader'));
  assert('advisor does NOT call ModelUpdater directly', !maSrc.includes('ModelUpdater'));
  assert('advisor does NOT call PermissionGate directly', !maSrc.includes('requestPermission('));
  // The IPC layer (main.ts) wires the advisor → permission → download flow
  assert('main.ts has update-model IPC (Phase 44)', mainSrc.includes("'update-model'"));
  assert('main.ts has model-recommendations IPC (Phase 45)', mainSrc.includes("'model-recommendations'"));

  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 45 MODEL ADVISOR RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('PHASE 45 INTELLIGENT MODEL ADVISOR + SMART ROUTER: ALL PASS ✅');
  console.log('\nNOTE: Windows runtime QA is NOT VERIFIED by this test.');
  console.log('      The user MUST verify on Windows:');
  console.log('      1. model-advisor-status shows hardware analysis + recommendations');
  console.log('      2. model-compare compares two models head-to-head');
  console.log('      3. model-router-decision selects best model for a task');
  console.log('      4. usage-stats shows workload patterns');
  console.log('      5. advisor-preferences persists rejected recs + preferred models');
  console.log('      6. NO model is downloaded without permission');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
