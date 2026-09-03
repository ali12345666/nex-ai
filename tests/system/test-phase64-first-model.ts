/**
 * Phase 64 — First Real Local AI Model Activation Tests
 *
 * Verifies:
 *   1. First-run wizard module structure + security
 *   2. Recommended model profile (Qwen2.5 0.5B)
 *   3. First-run state detection (needs model / brain ready)
 *   4. Install recommended model flow (download → verify → register → test → activate)
 *   5. Interaction test (local inference after activation)
 *   6. IPC handlers + preload bridges + type declarations
 *   7. UI panel + navigation
 *   8. Security (permission-gated download, offline, no cloud)
 *   9. Phase 51-63 preserved (regression)
 *
 * Run: npx tsx tests/system/test-phase64-first-model.ts
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
  // 1) First-Run Wizard Module Structure
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) First-Run Wizard Module Structure:');
  const wizSrc = read('../../src/main/ai/first-run-wizard.ts');

  assert('first-run-wizard.ts exists', wizSrc.length > 0);
  assert('RecommendedModel interface', wizSrc.includes('interface RecommendedModel'));
  assert('FirstRunState interface', wizSrc.includes('interface FirstRunState'));
  assert('ActivationResult interface', wizSrc.includes('interface ActivationResult'));
  assert('RECOMMENDED_FIRST_MODEL const', wizSrc.includes('export const RECOMMENDED_FIRST_MODEL'));
  assert('FirstRunWizard class', wizSrc.includes('export class FirstRunWizard'));
  assert('detectFirstRunState method', wizSrc.includes('detectFirstRunState()'));
  assert('getRecommendedModel method', wizSrc.includes('getRecommendedModel()'));
  assert('isBrainReady method', wizSrc.includes('isBrainReady()'));
  assert('installRecommendedModel method', wizSrc.includes('async installRecommendedModel('));
  assert('testInteraction method', wizSrc.includes('async testInteraction('));
  assert('getState method', wizSrc.includes('getState()'));
  assert('verifyFirstRunSecurity function', wizSrc.includes('export function verifyFirstRunSecurity'));
  assert('getFirstRunWizard singleton', wizSrc.includes('export function getFirstRunWizard'));
  assert('_resetFirstRunWizard for tests', wizSrc.includes('export function _resetFirstRunWizard'));

  // Imports
  assert('imports model-registry', wizSrc.includes("from './model-registry'"));
  assert('imports model-deployment-manager', wizSrc.includes("from './model-deployment-manager'"));
  assert('imports interaction-loop', wizSrc.includes("from './interaction-loop'"));

  // Security
  assert('SECURITY comment', wizSrc.includes('SECURITY'));
  assert('permission-gated comment', wizSrc.includes('PermissionGate') || wizSrc.includes('permission'));
  assert('no cloud comment', wizSrc.includes('No cloud') || wizSrc.includes('no cloud'));
  assert('no fetch() call', !wizSrc.includes('fetch('));
  assert('no net.request call', !wizSrc.split('\n').some((l: string) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && l.includes('net.request')));
  assert('no async download() method', !wizSrc.includes('async download('));
  assert('no async install() method directly', !wizSrc.split('\n').some((l: string) => l.trim().startsWith('async install(') && !l.includes('installRecommendedModel')));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Recommended Model Profile
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Recommended Model Profile:');
  const { getFirstRunWizard, _resetFirstRunWizard, verifyFirstRunSecurity, RECOMMENDED_FIRST_MODEL } = await import('../../src/main/ai/first-run-wizard');
  _resetFirstRunWizard();

  assert('RECOMMENDED_FIRST_MODEL exists', RECOMMENDED_FIRST_MODEL !== null && RECOMMENDED_FIRST_MODEL !== undefined);
  assert('recommended catalogId is qwen2.5-0.5b-q4', RECOMMENDED_FIRST_MODEL.catalogId === 'qwen2.5-0.5b-q4');
  assert('recommended name includes Qwen2.5', RECOMMENDED_FIRST_MODEL.name.includes('Qwen2.5'));
  assert('recommended nameFa includes کیون', RECOMMENDED_FIRST_MODEL.nameFa.includes('کیون'));
  assert('recommended provider is qwen', RECOMMENDED_FIRST_MODEL.provider === 'qwen');
  assert('recommended sizeGB is small (< 1)', RECOMMENDED_FIRST_MODEL.sizeGB < 1, `got ${RECOMMENDED_FIRST_MODEL.sizeGB}`);
  assert('recommended parameterCount is 0.5B', RECOMMENDED_FIRST_MODEL.parameterCount === '0.5B');
  assert('recommended quantization is Q4_K_M', RECOMMENDED_FIRST_MODEL.quantization === 'Q4_K_M');
  assert('recommended requiredRAM is 1', RECOMMENDED_FIRST_MODEL.requiredRAM === 1);
  assert('recommended requiredVRAM is 0 (CPU)', RECOMMENDED_FIRST_MODEL.requiredVRAM === 0);
  assert('recommended persianSupport is true', RECOMMENDED_FIRST_MODEL.persianSupport === true);
  assert('recommended recommendedTier is low', RECOMMENDED_FIRST_MODEL.recommendedTier === 'low');
  assert('recommended downloadUrl is HTTPS', RECOMMENDED_FIRST_MODEL.downloadUrl.startsWith('https://'));
  assert('recommended downloadUrl is HuggingFace', RECOMMENDED_FIRST_MODEL.downloadUrl.includes('huggingface.co'));
  assert('recommended has reasonFa', RECOMMENDED_FIRST_MODEL.reasonFa.length > 0);
  assert('recommended has descriptionFa', RECOMMENDED_FIRST_MODEL.descriptionFa.length > 0);

  // ═══════════════════════════════════════════════════════════════════════
  // 3) First-Run State Detection
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) First-Run State Detection:');
  _resetFirstRunWizard();
  const wizard = getFirstRunWizard();

  const state = wizard.detectFirstRunState();
  assert('state returns FirstRunState', state !== null);
  assert('state has needsModel boolean', typeof state.needsModel === 'boolean');
  assert('state has installing boolean', typeof state.installing === 'boolean');
  assert('state has brainReady boolean', typeof state.brainReady === 'boolean');
  assert('state has installedCount', typeof state.installedCount === 'number');
  assert('state has recommended', state.recommended !== null);
  assert('state recommended is Qwen 0.5B', state.recommended?.catalogId === 'qwen2.5-0.5b-q4');

  // In test environment, no model is installed → needsModel should be true
  assert('needsModel is true when no model installed', state.needsModel === true);
  assert('brainReady is false when no model', state.brainReady === false);
  assert('installedCount is 0', state.installedCount === 0);

  // isBrainReady
  assert('isBrainReady returns boolean', typeof wizard.isBrainReady() === 'boolean');
  assert('isBrainReady false when no model', wizard.isBrainReady() === false);

  // getRecommendedModel
  const rec = wizard.getRecommendedModel();
  assert('getRecommendedModel returns model', rec !== null);
  assert('getRecommendedModel catalogId', rec.catalogId === 'qwen2.5-0.5b-q4');

  // Security
  const sec = verifyFirstRunSecurity();
  assert('first-run security audit passes', sec.ok === true);

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Install Recommended Model Flow
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Install Recommended Model:');
  _resetFirstRunWizard();
  const wiz2 = getFirstRunWizard();

  // Auto-approve any pending permission (the download requires PermissionGate approval)
  const { getModelDeploymentManager: getDeployMgr } = await import('../../src/main/ai/model-deployment-manager');
  const approver = setInterval(() => {
    try { getDeployMgr().respondToPermission('تایید می‌کنم'); } catch { /* */ }
  }, 30);

  // Install will fail in test env (no real network/binary) but should return a result
  const result = await wiz2.installRecommendedModel();
  clearInterval(approver);
  assert('installRecommendedModel returns ActivationResult', result !== null);
  assert('install result has success boolean', typeof result.success === 'boolean');
  assert('install result has stage', typeof result.stage === 'string');
  assert('install result has durationMs', typeof result.durationMs === 'number');
  assert('install result has inferenceTested', typeof result.inferenceTested === 'boolean');
  assert('install result has modelId', result.modelId === null || typeof result.modelId === 'string');
  assert('install result has inferenceResponse', typeof result.inferenceResponse === 'string');

  // In test env, install should fail (no real download possible)
  assert('install fails in test env (expected)', result.success === false);
  assert('install result has error', result.error !== undefined);

  // After install attempt, state should reflect it
  const stateAfter = wiz2.getState();
  assert('state after install has lastActivation', stateAfter.lastActivation !== null);

  // Wizard source delegates to deployment manager
  assert('wizard source calls downloadFromUrl', wizSrc.includes('downloadFromUrl'));
  assert('wizard source calls touchModel', wizSrc.includes('touchModel'));
  assert('wizard source uses getModelDeploymentManager', wizSrc.includes('getModelDeploymentManager'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Interaction Test
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Interaction Test:');
  _resetFirstRunWizard();
  const wiz3 = getFirstRunWizard();

  // Test interaction with no model → should fail
  const interactionResult = await wiz3.testInteraction('سلام، خودت را معرفی کن.');
  assert('testInteraction returns result', interactionResult !== null);
  assert('testInteraction success=false (no model)', interactionResult.success === false);
  assert('testInteraction has error', interactionResult.error !== undefined);
  assert('testInteraction has language', typeof interactionResult.language === 'string');

  // Default test prompt is Persian
  assert('wizard source has Persian test prompt', wizSrc.includes('سلام، خودت را معرفی کن'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) IPC + Preload + Types
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) IPC + Preload + Types:');
  const mainSrc = read('../../src/main/main.ts');
  assert('main has Phase 64 block', mainSrc.includes('Phase 64: First Real Local AI Model Activation'));
  assert('main imports FirstRunWizard', mainSrc.includes("import('./ai/first-run-wizard')"));

  const ipcChannels = [
    'firstrun-state', 'firstrun-recommended-model', 'firstrun-install-recommended',
    'firstrun-test-interaction', 'firstrun-brain-ready', 'firstrun-security-audit',
  ];
  for (const ch of ipcChannels) {
    assert(`main registers ipc handler '${ch}'`, mainSrc.includes(`ipcMain.handle('${ch}'`));
  }

  // Preload
  const preloadSrc = read('../../src/main/preload.ts');
  assert('preload has Phase 64 section', preloadSrc.includes('Phase 64: First Real Local AI Model Activation'));
  const preloadMethods = [
    'firstrunState', 'firstrunRecommendedModel', 'firstrunInstallRecommended',
    'firstrunTestInteraction', 'firstrunBrainReady', 'firstrunSecurityAudit',
  ];
  for (const m of preloadMethods) {
    assert(`preload exposes '${m}'`, preloadSrc.includes(`${m}:`));
  }

  // Types
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('types has Phase 64 section', typesSrc.includes('Phase 64: First Real Local AI Model Activation'));
  for (const m of preloadMethods) {
    assert(`types declares '${m}'`, typesSrc.includes(`${m}:`));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 7) UI Panel + Navigation
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) UI Panel + Navigation:');
  const panelSrc = read('../../src/renderer/components/FirstRunWizardPanel.tsx');
  assert('FirstRunWizardPanel exists', panelSrc.length > 0);
  assert('panel default export', panelSrc.includes('export default function FirstRunWizardPanel'));
  assert('panel calls firstrunState', panelSrc.includes('firstrunState'));
  assert('panel calls firstrunRecommendedModel', panelSrc.includes('firstrunRecommendedModel'));
  assert('panel calls firstrunInstallRecommended', panelSrc.includes('firstrunInstallRecommended'));
  assert('panel calls firstrunTestInteraction', panelSrc.includes('firstrunTestInteraction'));
  assert('panel shows recommended model card', panelSrc.includes('recommended'));
  assert('panel shows model name', panelSrc.includes('nameFa'));
  assert('panel shows size', panelSrc.includes('sizeGB'));
  assert('panel shows RAM requirement', panelSrc.includes('requiredRAM'));
  assert('panel shows VRAM requirement', panelSrc.includes('requiredVRAM'));
  assert('panel shows Persian support', panelSrc.includes('persianSupport'));
  assert('panel has install button', panelSrc.includes('نصب مدل پیشنهادی') || panelSrc.includes('Install'));
  assert('panel shows activation result', panelSrc.includes('activationResult'));
  assert('panel shows interaction result', panelSrc.includes('interactionResult'));
  assert('panel shows brain ready state', panelSrc.includes('brainReady') || panelSrc.includes('NEX Brain Ready'));
  assert('panel shows needs model message', panelSrc.includes('needsModel') || panelSrc.includes('نیاز'));
  assert('panel has permission dialog', panelSrc.includes('showPermission') || panelSrc.includes('pendingPermission'));
  assert('panel has security note', panelSrc.includes('اجازه') || panelSrc.includes('HTTPS') || panelSrc.includes('permission'));
  assert('panel subscribes to permission requests', panelSrc.includes('onModelDeploymentPermissionRequest'));
  assert('panel shows inference test response', panelSrc.includes('response') || panelSrc.includes('پاسخ'));

  const navSrc = read('../../src/renderer/components/layout/NavigationRail.tsx');
  assert('nav has firstrun view', navSrc.includes("'firstrun'"));
  assert('nav has Zap icon', navSrc.includes('Zap'));
  assert('nav has First Run label', navSrc.includes("label: 'First Run'"));

  const appShellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
  assert('AppShell imports FirstRunWizardPanel', appShellSrc.includes('FirstRunWizardPanel'));
  assert('AppShell routes firstrun view', appShellSrc.includes("case 'firstrun'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Security
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Security:');
  assert('first-run security ok', verifyFirstRunSecurity().ok === true);

  // No cloud
  assert('wizard source no fetch()', !wizSrc.includes('fetch('));
  assert('wizard source no XMLHttpRequest', !wizSrc.includes('XMLHttpRequest'));
  assert('wizard source no async download() method', !wizSrc.includes('async download('));

  // Download goes through Phase 61 deployment manager (permission-gated)
  assert('wizard delegates to downloadFromUrl (permission-gated)', wizSrc.includes('downloadFromUrl'));
  assert('wizard uses getModelDeploymentManager', wizSrc.includes('getModelDeploymentManager'));
  assert('wizard uses touchModel to activate', wizSrc.includes('touchModel'));
  assert('wizard uses getInteractionLoopManager for test', wizSrc.includes('getInteractionLoopManager'));

  // Panel does not download directly
  assert('panel does not call fetch()', !panelSrc.includes('fetch('));
  assert('panel calls firstrunInstallRecommended (not direct download)', panelSrc.includes('firstrunInstallRecommended'));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Phase 51-63 Preserved (Regression)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Phase 51-63 Preserved:');
  assert('Phase 12 inference.ts exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/inference.ts')));
  assert('Phase 12 local-engine.ts exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/local-engine.ts')));
  assert('Phase 39 model-registry exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-registry.ts')));
  assert('Phase 43 permission-gate exists', fs.existsSync(path.join(__dirname, '../../src/main/update/permission-gate.ts')));
  assert('Phase 51 nex-brain-controller exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-brain-controller.ts')));
  assert('Phase 53 nex-expert-system exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-expert-system.ts')));
  assert('Phase 55 expert-knowledge-engine exists', fs.existsSync(path.join(__dirname, '../../src/main/knowledge/expert-knowledge-engine.ts')));
  assert('Phase 57 nex-executive-planner exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-executive-planner.ts')));
  assert('Phase 58 multi-model-runtime-manager exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/multi-model-runtime-manager.ts')));
  assert('Phase 58 local-model-provider exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/local-model-provider.ts')));
  assert('Phase 59 model-ecosystem-manager exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-intelligence/model-ecosystem-manager.ts')));
  assert('Phase 60 universal-knowledge-brain exists', fs.existsSync(path.join(__dirname, '../../src/main/knowledge/universal-knowledge-brain.ts')));
  assert('Phase 61 model-deployment-manager exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-deployment-manager.ts')));
  assert('Phase 61 model-verification exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-verification.ts')));
  assert('Phase 62 interaction-loop exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/interaction-loop.ts')));
  assert('Phase 62 language-foundation exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/language-foundation.ts')));
  assert('Phase 62 BasicInteractionPanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/BasicInteractionPanel.tsx')));
  assert('Phase 63 ModelDeploymentPanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/ModelDeploymentPanel.tsx')));
  assert('Phase 58 LocalRuntimePanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/LocalRuntimePanel.tsx')));

  // Existing subsystems still work
  const { getModelDeploymentManager } = await import('../../src/main/ai/model-deployment-manager');
  assert('Phase 61 deployment manager singleton still works', typeof getModelDeploymentManager === 'function');
  const { getInteractionLoopManager } = await import('../../src/main/ai/interaction-loop');
  assert('Phase 62 interaction loop singleton still works', typeof getInteractionLoopManager === 'function');
  const { getMultiModelRuntimeManager } = await import('../../src/main/ai/multi-model-runtime-manager');
  assert('Phase 58 runtime manager singleton still works', typeof getMultiModelRuntimeManager === 'function');
  const { getDefaultModel } = await import('../../src/main/ai/model-registry');
  assert('getDefaultModel still works', typeof getDefaultModel === 'function');
  const { getExpertProfiles } = await import('../../src/main/ai/nex-expert-system');
  assert('expert profiles still 6', getExpertProfiles().length === 6);

  // ═══════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 64 FIRST MODEL RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('FAILURES:', failures.join(' | '));
    process.exit(1);
  }
  console.log('PHASE 64 FIRST REAL LOCAL AI MODEL ACTIVATION: ALL PASS ✅');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
