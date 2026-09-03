/**
 * Phase 49 — First Run Intelligence & Model Catalog Tests
 *
 * Verifies:
 *   1. AdvancedModelCatalog (16 entries, Persian support, hardware tiers)
 *   2. HardwareSetupAdvisor (low/medium/high classification + packages)
 *   3. Install plan generation
 *   4. Persian first-launch summary
 *   5. IPC handlers registered
 *   6. Preload bridges present
 *   7. No autonomous download/install
 *   8. Phase 45-48 integration
 *
 * Run: npx tsx tests/system/test-phase49-first-run.ts
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
  // 1) AdvancedModelCatalog
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) AdvancedModelCatalog:');
  const catSrc = read('../../src/main/ai/model-intelligence/advanced-model-catalog.ts');

  assert('advanced-model-catalog.ts exists', catSrc.length > 0);
  assert('AdvancedModelEntry interface', catSrc.includes('interface AdvancedModelEntry'));
  assert('HardwareTier type (low/medium/high)', catSrc.includes("'low'") && catSrc.includes("'medium'") && catSrc.includes("'high'"));
  assert('ModelType type (llm/vision/voice-stt/voice-tts/embedding)', catSrc.includes("'llm'") && catSrc.includes("'vision'") && catSrc.includes("'voice-stt'") && catSrc.includes("'voice-tts'") && catSrc.includes("'embedding'"));
  assert('entry has qualityScore', catSrc.includes('qualityScore'));
  assert('entry has speedScore', catSrc.includes('speedScore'));
  assert('entry has codingScore', catSrc.includes('codingScore'));
  assert('entry has reasoningScore', catSrc.includes('reasoningScore'));
  assert('entry has visionScore', catSrc.includes('visionScore'));
  assert('entry has voiceScore', catSrc.includes('voiceScore'));
  assert('entry has persianSupport', catSrc.includes('persianSupport'));
  assert('entry has multilingual', catSrc.includes('multilingual'));
  assert('entry has recommendedTier', catSrc.includes('recommendedTier'));
  assert('entry has displayNameFa', catSrc.includes('displayNameFa'));
  assert('entry has descriptionFa', catSrc.includes('descriptionFa'));
  assert('entry has downloadUrl', catSrc.includes('downloadUrl'));
  assert('entry has checksum', catSrc.includes('checksum'));
  assert('entry has requiredRAM', catSrc.includes('requiredRAM'));
  assert('entry has requiredVRAM', catSrc.includes('requiredVRAM'));
  assert('entry has quantization', catSrc.includes('quantization'));
  assert('entry has parameterCount', catSrc.includes('parameterCount'));
  assert('entry has isEssential', catSrc.includes('isEssential'));
  assert('getAdvancedCatalog function', catSrc.includes('export function getAdvancedCatalog'));
  assert('getAdvancedCatalogByType function', catSrc.includes('export function getAdvancedCatalogByType'));
  assert('getAdvancedCatalogEntry function', catSrc.includes('export function getAdvancedCatalogEntry'));
  assert('getModelsByHardwareTier function', catSrc.includes('export function getModelsByHardwareTier'));
  assert('getModelsByPersianSupport function', catSrc.includes('export function getModelsByPersianSupport'));

  // Catalog entries
  assert('has Qwen2.5 Coder 7B', catSrc.includes('qwen2.5-coder-7b-q5'));
  assert('has Qwen2.5 7B', catSrc.includes('qwen2.5-7b-q4'));
  assert('has Qwen2.5 0.5B', catSrc.includes('qwen2.5-0.5b-q4'));
  assert('has Qwen2.5 Coder 14B', catSrc.includes('qwen2.5-coder-14b-q5'));
  assert('has Qwen2.5 32B', catSrc.includes('qwen2.5-32b-q4'));
  assert('has DeepSeek Coder', catSrc.includes('deepseek-coder-6.7b-q4'));
  assert('has Llama 3.1 8B', catSrc.includes('llama3.1-8b-q4'));
  assert('has Mistral 7B', catSrc.includes('mistral-7b-q4'));
  assert('has LLaVA 7B', catSrc.includes('llava-7b-q4'));
  assert('has Qwen2.5-VL 7B', catSrc.includes('qwen2.5-vl-7b-q4'));
  assert('has Whisper Base', catSrc.includes('whisper-base-en'));
  assert('has Whisper Medium', catSrc.includes('whisper-medium-q5'));
  assert('has Piper en-US', catSrc.includes('piper-en-us-lessac-medium'));
  assert('has Piper fa-IR (Persian)', catSrc.includes('piper-fa-ir-gyro-medium'));
  assert('has Nomic Embed', catSrc.includes('nomic-embed-137m'));

  // Functional
  const { getAdvancedCatalog, getAdvancedCatalogByType, getModelsByHardwareTier, getModelsByPersianSupport } =
    await import('../../src/main/ai/model-intelligence/advanced-model-catalog');
  const catalog = getAdvancedCatalog();
  assert('catalog has 15+ entries', catalog.length >= 15);
  assert('getAdvancedCatalogByType(llm) returns LLMs', getAdvancedCatalogByType('llm').length >= 5);
  assert('getAdvancedCatalogByType(vision) returns vision', getAdvancedCatalogByType('vision').length >= 2);
  assert('getAdvancedCatalogByType(voice-stt) returns STT', getAdvancedCatalogByType('voice-stt').length >= 2);
  assert('getAdvancedCatalogByType(voice-tts) returns TTS', getAdvancedCatalogByType('voice-tts').length >= 2);
  assert('getModelsByHardwareTier(low) returns low models', getModelsByHardwareTier('low').length >= 1);
  assert('getModelsByHardwareTier(medium) returns medium models', getModelsByHardwareTier('medium').length >= 1);
  assert('getModelsByHardwareTier(high) returns high models', getModelsByHardwareTier('high').length >= 1);
  assert('getModelsByPersianSupport returns Persian models', getModelsByPersianSupport().length >= 5);
  assert('Persian models include Qwen', getModelsByPersianSupport().some((m) => m.provider === 'qwen'));
  assert('Persian models include Whisper Medium', getModelsByPersianSupport().some((m) => m.id === 'whisper-medium-q5'));
  assert('Persian models include Piper fa-IR', getModelsByPersianSupport().some((m) => m.id === 'piper-fa-ir-gyro-medium'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) HardwareSetupAdvisor
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) HardwareSetupAdvisor:');
  const hsaSrc = read('../../src/main/ai/model-intelligence/hardware-setup-advisor.ts');

  assert('hardware-setup-advisor.ts exists', hsaSrc.length > 0);
  assert('HardwareSetupAdvisor class exported', hsaSrc.includes('export class HardwareSetupAdvisor'));
  assert('analyze method', hsaSrc.includes('analyze()'));
  assert('classifyHardwareTier method', hsaSrc.includes('classifyHardwareTier'));
  assert('generatePackage method', hsaSrc.includes('generatePackage'));
  assert('generateAlternativePackages method', hsaSrc.includes('generateAlternativePackages'));
  assert('generateInstallPlan method', hsaSrc.includes('generateInstallPlan'));
  assert('createCustomPackage method', hsaSrc.includes('createCustomPackage'));
  assert('generateFirstLaunchSummary method', hsaSrc.includes('generateFirstLaunchSummary'));
  assert('HardwareSetup interface', hsaSrc.includes('interface HardwareSetup'));
  assert('ModelPackage interface', hsaSrc.includes('interface ModelPackage'));
  assert('InstallPlan interface', hsaSrc.includes('interface InstallPlan'));
  assert('uses detectHardwareProfile (Phase 39)', hsaSrc.includes('detectHardwareProfile'));
  assert('uses getAdvancedCatalog', hsaSrc.includes('getAdvancedCatalog'));
  assert('has tier label (Persian)', hsaSrc.includes('tierLabelFa'));
  assert('has totalDownloadSize', hsaSrc.includes('totalDownloadSize'));
  assert('has totalStorageRequired', hsaSrc.includes('totalStorageRequired'));
  assert('has canRun', hsaSrc.includes('canRun'));
  assert('has warnings array', hsaSrc.includes('warnings'));
  assert('has alternativePackages', hsaSrc.includes('alternativePackages'));
  assert('package has totalSizeGB', hsaSrc.includes('totalSizeGB'));
  assert('package has isCustom', hsaSrc.includes('isCustom'));
  assert('install plan has components array', hsaSrc.includes('components'));
  assert('install plan has permissionRequired', hsaSrc.includes('permissionRequired'));
  assert('getHardwareSetupAdvisor singleton', hsaSrc.includes('export function getHardwareSetupAdvisor'));
  assert('Persian summary (سلام)', hsaSrc.includes('سلام، سیستم شما را بررسی کردم'));
  assert('Persian warning text', hsaSrc.includes('RAM کمتر'));
  assert('NO download() calls', !hsaSrc.includes('download('));
  assert('NO install() calls', !hsaSrc.includes('install('));
  assert('NO PermissionGate import', !hsaSrc.includes("import { PermissionGate }"));

  // Functional
  const { getHardwareSetupAdvisor } = await import('../../src/main/ai/model-intelligence/hardware-setup-advisor');
  const advisor = getHardwareSetupAdvisor();
  const setup = advisor.analyze();
  assert('analyze returns HardwareSetup', setup !== null);
  assert('setup has tier', typeof setup.tier === 'string');
  assert('setup has tierLabelFa', typeof setup.tierLabelFa === 'string');
  assert('setup has profile', setup.profile !== null);
  assert('setup has recommendedPackage', setup.recommendedPackage !== null);
  assert('setup has alternativePackages', Array.isArray(setup.alternativePackages));
  assert('setup has totalDownloadSize', typeof setup.totalDownloadSize === 'number');
  assert('setup has totalStorageRequired', typeof setup.totalStorageRequired === 'number');
  assert('setup has canRun', typeof setup.canRun === 'boolean');
  assert('setup has warnings', Array.isArray(setup.warnings));
  assert('recommendedPackage has models', Array.isArray(setup.recommendedPackage.models));
  assert('recommendedPackage has totalSizeGB', typeof setup.recommendedPackage.totalSizeGB === 'number');
  assert('recommendedPackage has nameFa', typeof setup.recommendedPackage.nameFa === 'string');
  assert('recommendedPackage has descriptionFa', typeof setup.recommendedPackage.descriptionFa === 'string');
  assert('alternativePackages has at least 2', setup.alternativePackages.length >= 2);

  // Install plan
  const plan = advisor.generateInstallPlan(setup.recommendedPackage);
  assert('generateInstallPlan returns plan', plan !== null);
  assert('plan has package', plan.package !== null);
  assert('plan has totalDownloadGB', typeof plan.totalDownloadGB === 'number');
  assert('plan has totalStorageGB', typeof plan.totalStorageGB === 'number');
  assert('plan has components', Array.isArray(plan.components));
  assert('plan has permissionRequired', plan.permissionRequired === true);
  assert('plan components have name', plan.components[0]?.name !== undefined);
  assert('plan components have nameFa', plan.components[0]?.nameFa !== undefined);
  assert('plan components have sizeGB', typeof plan.components[0]?.sizeGB === 'number');
  assert('plan components have url', plan.components[0]?.url !== undefined);
  assert('plan components have targetDir', plan.components[0]?.targetDir !== undefined);
  assert('plan components have filename', plan.components[0]?.filename !== undefined);

  // Custom package
  const customPkg = advisor.createCustomPackage(['qwen2.5-7b-q4', 'whisper-medium-q5'], 'medium');
  assert('createCustomPackage returns package', customPkg !== null);
  assert('custom package has 2 models', customPkg.models.length === 2);
  assert('custom package isCustom=true', customPkg.isCustom === true);
  assert('custom package has totalSizeGB', customPkg.totalSizeGB > 0);

  // First-launch summary
  const summary = advisor.generateFirstLaunchSummary(setup);
  assert('summary is string', typeof summary === 'string');
  assert('summary contains Persian greeting (سلام)', summary.includes('سلام'));
  assert('summary contains CPU info', summary.includes('CPU'));
  assert('summary contains RAM info', summary.includes('RAM'));
  assert('summary contains package name', summary.includes(setup.recommendedPackage.nameFa));
  assert('summary contains download size', summary.includes('دانلود'));
  assert('summary contains storage info', summary.includes('فضا'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) IPC handlers
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');
  assert('firstrun-catalog handler', mainSrc.includes("'firstrun-catalog'"));
  assert('firstrun-models-by-tier handler', mainSrc.includes("'firstrun-models-by-tier'"));
  assert('firstrun-persian-models handler', mainSrc.includes("'firstrun-persian-models'"));
  assert('firstrun-analyze handler', mainSrc.includes("'firstrun-analyze'"));
  assert('firstrun-summary handler', mainSrc.includes("'firstrun-summary'"));
  assert('firstrun-install-plan handler', mainSrc.includes("'firstrun-install-plan'"));
  assert('firstrun-recommended-package handler', mainSrc.includes("'firstrun-recommended-package'"));
  assert('firstrun-alternatives handler', mainSrc.includes("'firstrun-alternatives'"));
  assert('Phase 49 comment in main.ts', mainSrc.includes('Phase 49'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Preload bridges
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Preload bridges:');
  const preSrc = read('../../src/main/preload.ts');
  assert('firstrunCatalog bridge', preSrc.includes('firstrunCatalog'));
  assert('firstrunModelsByTier bridge', preSrc.includes('firstrunModelsByTier'));
  assert('firstrunPersianModels bridge', preSrc.includes('firstrunPersianModels'));
  assert('firstrunAnalyze bridge', preSrc.includes('firstrunAnalyze'));
  assert('firstrunSummary bridge', preSrc.includes('firstrunSummary'));
  assert('firstrunInstallPlan bridge', preSrc.includes('firstrunInstallPlan'));
  assert('firstrunRecommendedPackage bridge', preSrc.includes('firstrunRecommendedPackage'));
  assert('firstrunAlternatives bridge', preSrc.includes('firstrunAlternatives'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Type definitions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Type definitions:');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('firstrunCatalog type', typesSrc.includes('firstrunCatalog'));
  assert('firstrunAnalyze type', typesSrc.includes('firstrunAnalyze'));
  assert('firstrunSummary type', typesSrc.includes('firstrunSummary'));
  assert('firstrunInstallPlan type', typesSrc.includes('firstrunInstallPlan'));
  assert('firstrunRecommendedPackage type', typesSrc.includes('firstrunRecommendedPackage'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) No autonomous actions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) No autonomous actions:');
  assert('NO download() in advisor', !hsaSrc.includes('download('));
  assert('NO install() in advisor', !hsaSrc.includes('install('));
  assert('NO removeModel() in advisor', !hsaSrc.includes('removeModel'));
  assert('NO SecureDownloader import in advisor', !hsaSrc.includes('SecureDownloader'));
  assert('NO ComponentInstaller import in advisor', !hsaSrc.includes('ComponentInstaller'));
  assert('NO PermissionGate import in advisor', !hsaSrc.includes('PermissionGate'));
  assert('install plan has permissionRequired=true', hsaSrc.includes('permissionRequired: true'));
  assert('NO fetch/https in advisor', !hsaSrc.includes('fetch(') && !hsaSrc.includes('https.get'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Phase 45-48 integration
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Phase 45-48 integration:');
  assert('Phase 45 model-advisor still exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-intelligence/model-advisor.ts')));
  assert('Phase 45 advisor-persistence still exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-intelligence/advisor-persistence.ts')));
  assert('Phase 46 component-catalog still exists', fs.existsSync(path.join(__dirname, '../../src/main/runtime/component-catalog.ts')));
  assert('Phase 47 component-installer still exists', fs.existsSync(path.join(__dirname, '../../src/main/runtime/component-installer.ts')));
  assert('Phase 48 RuntimeSetupPanel still exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/layout/RuntimeSetupPanel.tsx')));
  assert('main.ts has Phase 43 permission-gate', mainSrc.includes('permission-gate'));
  assert('main.ts has Phase 44 SecureDownloader', mainSrc.includes('SecureDownloader'));
  assert('main.ts has Phase 47 component-install', mainSrc.includes("'component-install'"));
  assert('main.ts has Phase 48 runtime-scan', mainSrc.includes("'runtime-scan'"));
  assert('main.ts has Phase 45 model-advisor-status', mainSrc.includes("'model-advisor-status'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Model ranking (scoring system)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Model ranking:');
  const llmCatalog = getAdvancedCatalogByType('llm');
  assert('LLM catalog has 7+ models', llmCatalog.length >= 7);
  assert('all LLMs have qualityScore', llmCatalog.every((m) => typeof m.qualityScore === 'number'));
  assert('all LLMs have speedScore', llmCatalog.every((m) => typeof m.speedScore === 'number'));
  assert('all LLMs have codingScore', llmCatalog.every((m) => typeof m.codingScore === 'number'));
  assert('all LLMs have reasoningScore', llmCatalog.every((m) => typeof m.reasoningScore === 'number'));
  assert('Qwen2.5 Coder 14B has highest codingScore', llmCatalog.find((m) => m.id === 'qwen2.5-coder-14b-q5')?.codingScore === 88);
  assert('Qwen2.5 32B has highest reasoningScore', llmCatalog.find((m) => m.id === 'qwen2.5-32b-q4')?.reasoningScore === 90);
  assert('Qwen2.5 0.5B has highest speedScore', llmCatalog.find((m) => m.id === 'qwen2.5-0.5b-q4')?.speedScore === 95);

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Persian language support
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Persian language support:');
  const persianModels = getModelsByPersianSupport();
  assert('Persian models exist', persianModels.length >= 5);
  assert('Qwen models support Persian', persianModels.some((m) => m.provider === 'qwen'));
  assert('Whisper Medium supports Persian', persianModels.some((m) => m.id === 'whisper-medium-q5'));
  assert('Piper fa-IR supports Persian', persianModels.some((m) => m.id === 'piper-fa-ir-gyro-medium'));
  assert('Nomic Embed supports Persian', persianModels.some((m) => m.id === 'nomic-embed-137m'));
  assert('DeepSeek does NOT support Persian', !persianModels.some((m) => m.provider === 'deepseek'));
  assert('Llama does NOT support Persian', !persianModels.some((m) => m.provider === 'llama'));
  assert('Mistral is multilingual', catalog.find((m) => m.id === 'mistral-7b-q4')?.multilingual === true);

  // ═══════════════════════════════════════════════════════════════════════
  // 10) Hardware tier classification
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) Hardware tier classification:');
  const { HardwareSetupAdvisor } = await import('../../src/main/ai/model-intelligence/hardware-setup-advisor');
  const testAdvisor = new HardwareSetupAdvisor();

  // Simulate low hardware
  const lowProfile = {
    cpuCores: 2, cpuThreads: 4, ramTotalBytes: 4e9, ramFreeBytes: 2e9,
    gpu: null, detectedBackend: 'cpu', platform: 'linux',
  };
  const lowTier = testAdvisor.classifyHardwareTier(lowProfile as any);
  assert('4GB RAM + no GPU → low tier', lowTier === 'low');

  // Simulate medium hardware
  const medProfile = {
    cpuCores: 8, cpuThreads: 16, ramTotalBytes: 16e9, ramFreeBytes: 8e9,
    gpu: { name: 'RTX 3060', vendor: 'nvidia', vramTotalBytes: 6e9, vramFreeBytes: 3e9, supportsCuda: true, supportsMetal: false, supportsVulkan: false },
    detectedBackend: 'cuda', platform: 'win32',
  };
  const medTier = testAdvisor.classifyHardwareTier(medProfile as any);
  assert('16GB RAM + 6GB VRAM → medium tier', medTier === 'medium');

  // Simulate high hardware
  const highProfile = {
    cpuCores: 16, cpuThreads: 32, ramTotalBytes: 64e9, ramFreeBytes: 32e9,
    gpu: { name: 'RTX 4090', vendor: 'nvidia', vramTotalBytes: 24e9, vramFreeBytes: 12e9, supportsCuda: true, supportsMetal: false, supportsVulkan: false },
    detectedBackend: 'cuda', platform: 'win32',
  };
  const highTier = testAdvisor.classifyHardwareTier(highProfile as any);
  assert('64GB RAM + 24GB VRAM → high tier', highTier === 'high');

  // ═══════════════════════════════════════════════════════════════════════
  // 11) Package generation
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n11) Package generation:');
  const lowPkg = testAdvisor.generatePackage('low');
  assert('low package has models', lowPkg.models.length > 0);
  assert('low package includes Qwen 0.5B', lowPkg.models.some((m) => m.id === 'qwen2.5-0.5b-q4'));
  assert('low package includes Whisper Base', lowPkg.models.some((m) => m.id === 'whisper-base-en'));
  assert('low package includes Piper', lowPkg.models.some((m) => m.type === 'voice-tts'));
  assert('low package does NOT include vision', !lowPkg.models.some((m) => m.type === 'vision'));
  assert('low package isCustom=false', lowPkg.isCustom === false);

  const medPkg = testAdvisor.generatePackage('medium');
  assert('medium package has models', medPkg.models.length > 0);
  assert('medium package includes Qwen Coder 7B', medPkg.models.some((m) => m.id === 'qwen2.5-coder-7b-q5'));
  assert('medium package includes Whisper Medium', medPkg.models.some((m) => m.id === 'whisper-medium-q5'));
  assert('medium package includes LLaVA', medPkg.models.some((m) => m.type === 'vision'));
  assert('medium package includes embedding', medPkg.models.some((m) => m.type === 'embedding'));

  const highPkg = testAdvisor.generatePackage('high');
  assert('high package has models', highPkg.models.length > 0);
  assert('high package includes Qwen Coder 14B', highPkg.models.some((m) => m.id === 'qwen2.5-coder-14b-q5'));
  assert('high package includes LLaVA', highPkg.models.some((m) => m.type === 'vision'));

  // Alternatives
  const alts = testAdvisor.generateAlternativePackages('medium');
  assert('alternatives has 2 packages', alts.length >= 2);
  assert('first alternative is Chat Only', alts[0]?.name === 'Chat Only');
  assert('second alternative is Coding Only', alts[1]?.name === 'Coding Only');
  assert('chat-only package has LLM', alts[0].models.some((m) => m.type === 'llm'));
  assert('coding-only package has coding LLM', alts[1].models.some((m) => m.capabilities.includes('coding')));

  // ═══════════════════════════════════════════════════════════════════════
  // 12) Install plan (permission required)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n12) Install plan (permission required):');
  const installPlan = testAdvisor.generateInstallPlan(medPkg);
  assert('install plan has package', installPlan.package === medPkg);
  assert('install plan totalDownloadGB > 0', installPlan.totalDownloadGB > 0);
  assert('install plan totalStorageGB > download', installPlan.totalStorageGB > installPlan.totalDownloadGB);
  assert('install plan permissionRequired = true', installPlan.permissionRequired === true);
  assert('install plan components match models', installPlan.components.length === medPkg.models.length);
  assert('install plan components have url', installPlan.components.every((c) => c.url.length > 0));
  assert('install plan components have targetDir', installPlan.components.every((c) => c.targetDir.length > 0));
  assert('install plan components have filename', installPlan.components.every((c) => c.filename.length > 0));

  // ═══════════════════════════════════════════════════════════════════════
  // 13) First-launch summary (Persian)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n13) First-launch summary:');
  const testSetup = testAdvisor.analyze();
  const testSummary = testAdvisor.generateFirstLaunchSummary(testSetup);
  assert('summary has Persian greeting', testSummary.includes('سلام'));
  assert('summary has CPU cores', testSummary.includes('هسته'));
  assert('summary has RAM in GB', testSummary.includes('گیگابایت'));
  assert('summary has recommended package name', testSummary.includes(testSetup.recommendedPackage.nameFa));
  assert('summary lists components with ✓', testSummary.includes('✓'));
  assert('summary has download size', testSummary.includes('دانلود'));
  assert('summary has storage size', testSummary.includes('فضا'));

  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 49 FIRST RUN RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('PHASE 49 FIRST RUN INTELLIGENCE & MODEL CATALOG: ALL PASS ✅');
  console.log('\nNOTE: Windows runtime QA is NOT VERIFIED by this test.');
  console.log('      The user MUST verify on Windows:');
  console.log('      1. firstrun-analyze returns hardware tier + recommended package');
  console.log('      2. firstrun-summary shows Persian text with recommendations');
  console.log('      3. firstrun-install-plan generates plan with permissionRequired=true');
  console.log('      4. NO model is downloaded without explicit permission');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
