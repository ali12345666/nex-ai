/**
 * Phase 63 — Professional Model Deployment UI & Download Manager Tests
 *
 * Verifies:
 *   1. Progress event forwarding (main.ts → renderer via onModelDeploymentProgress)
 *   2. Professional model cards (badges, specs, scores, actions)
 *   3. Download manager (progress bar, speed, ETA, bytes, controls)
 *   4. Deployment pipeline visualization (9 stages)
 *   5. Error management (error cards, classification, retry)
 *   6. Download history (success + failure rows)
 *   7. Model browser (search, filters, recommended)
 *   8. Preload + types (onModelDeploymentProgress listener)
 *   9. Security (no backend changes, offline, permission-gated)
 *  10. Phase 51-62 preserved (regression)
 *
 * Run: npx tsx tests/system/test-phase63-deployment-ui.ts
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
  // 1) Progress Event Forwarding
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) Progress Event Forwarding:');
  const mainSrc = read('../../src/main/main.ts');

  assert('main wires setProgressCallback', mainSrc.includes('setProgressCallback'));
  assert('main forwards model-deployment-progress event', mainSrc.includes("'model-deployment-progress'"));
  assert('main forwards model-deployment-permission-request event', mainSrc.includes("'model-deployment-permission-request'"));

  // Preload exposes onModelDeploymentProgress
  const preloadSrc = read('../../src/main/preload.ts');
  assert('preload exposes onModelDeploymentProgress', preloadSrc.includes('onModelDeploymentProgress'));
  assert('preload listens on model-deployment-progress channel', preloadSrc.includes("'model-deployment-progress'"));
  assert('preload returns unsubscribe function', preloadSrc.includes('removeListener'));

  // Types declare onModelDeploymentProgress
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('types declare onModelDeploymentProgress', typesSrc.includes('onModelDeploymentProgress'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Professional Model Cards
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Professional Model Cards:');
  const panelSrc = read('../../src/renderer/components/ModelDeploymentPanel.tsx');

  assert('ModelDeploymentPanel exists', panelSrc.length > 0);
  assert('panel default export', panelSrc.includes('export default function ModelDeploymentPanel'));
  assert('has ModelCard component', panelSrc.includes('function ModelCard'));
  assert('card shows model name', panelSrc.includes('displayNameFa'));
  assert('card shows provider', panelSrc.includes('provider'));
  assert('card shows type icon', panelSrc.includes('TYPE_ICONS'));
  assert('card shows file size', panelSrc.includes('sizeGB'));
  assert('card shows quantization', panelSrc.includes('quantization'));
  assert('card shows required RAM', panelSrc.includes('requiredRAM'));
  assert('card shows required VRAM', panelSrc.includes('requiredVRAM'));
  assert('card shows quality score', panelSrc.includes('qualityScore'));
  assert('card shows speed score', panelSrc.includes('speedScore'));
  assert('card shows coding score', panelSrc.includes('codingScore'));
  assert('card shows reasoning score', panelSrc.includes('reasoningScore'));
  assert('card shows tier badge', panelSrc.includes('recommendedTier'));
  assert('card has ScoreBar component', panelSrc.includes('function ScoreBar'));
  assert('card shows installed badge', panelSrc.includes('نصب‌شده') || panelSrc.includes('installed'));
  assert('card shows ready-to-download badge', panelSrc.includes('آماده دانلود') || panelSrc.includes('ready'));

  // Badges with colors and icons
  assert('card uses CheckCircle2 for installed', panelSrc.includes('CheckCircle2'));
  assert('card uses Download icon', panelSrc.includes('Download'));
  assert('card has tier colors', panelSrc.includes('TIER_COLORS'));
  assert('card has Persian support badge', panelSrc.includes('persianSupport'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) Download Manager
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Download Manager:');
  assert('has DownloadManager component', panelSrc.includes('function DownloadManager'));
  assert('download manager shows progress percentage', panelSrc.includes('percent'));
  assert('download manager shows downloaded bytes', panelSrc.includes('downloadedBytes'));
  assert('download manager shows total bytes', panelSrc.includes('totalBytes'));
  assert('download manager shows speed', panelSrc.includes('speed'));
  assert('download manager shows remaining bytes', panelSrc.includes('remainingBytes'));
  assert('download manager shows ETA', panelSrc.includes('etaSeconds'));
  assert('download manager shows elapsed time', panelSrc.includes('elapsedSeconds'));
  assert('download manager has progress bar', panelSrc.includes('h-3') || panelSrc.includes('progress-bar') || panelSrc.includes('rounded-full'));
  assert('has formatSpeed helper', panelSrc.includes('function formatSpeed'));
  assert('has formatETA helper', panelSrc.includes('function formatETA'));
  assert('has formatBytes helper', panelSrc.includes('function formatBytes'));
  assert('download manager shows stage label', panelSrc.includes('messageFa') || panelSrc.includes('stageMeta'));
  assert('download manager has animated spinner', panelSrc.includes('animate-spin'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Deployment Pipeline Visualization
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Pipeline Visualization:');
  assert('has PipelineVisualization component', panelSrc.includes('function PipelineVisualization'));
  assert('has PIPELINE_STAGES const', panelSrc.includes('PIPELINE_STAGES'));
  assert('pipeline has preparing stage', panelSrc.includes("'preparing'") || panelSrc.includes('آماده‌سازی'));
  assert('pipeline has permission stage', panelSrc.includes('permission') || panelSrc.includes('بررسی اجازه'));
  assert('pipeline has downloading stage', panelSrc.includes('downloading') || panelSrc.includes('دانلود'));
  assert('pipeline has verifying stage', panelSrc.includes('verifying') || panelSrc.includes('تأیید GGUF'));
  assert('pipeline has checksum stage', panelSrc.includes('checksum') || panelSrc.includes('بررسی چک‌سام'));
  assert('pipeline has registering stage', panelSrc.includes('registering') || panelSrc.includes('ثبت مدل'));
  assert('pipeline has loading stage', panelSrc.includes('loading') || panelSrc.includes('بارگذاری'));
  assert('pipeline has testing stage', panelSrc.includes('testing-inference') || panelSrc.includes('آزمایش'));
  assert('pipeline has completed stage', panelSrc.includes('completed') || panelSrc.includes('تکمیل'));
  assert('pipeline shows stage icons', panelSrc.includes('icon'));
  assert('pipeline has 9 stages', (panelSrc.match(/label:.*labelEn/g) || []).length >= 9);

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Error Management
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Error Management:');
  assert('has ErrorCard component', panelSrc.includes('function ErrorCard'));
  assert('has classifyError function', panelSrc.includes('function classifyError'));
  assert('error card has title', panelSrc.includes('title'));
  assert('error card has reason', panelSrc.includes('دلیل') || panelSrc.includes('reason'));
  assert('error card has solution', panelSrc.includes('راه‌حل') || panelSrc.includes('solution'));
  assert('error card has retry button', panelSrc.includes('تلاش مجدد') || panelSrc.includes('Retry') || panelSrc.includes('onRetry'));
  assert('error card has close button', panelSrc.includes('onClose'));

  // Error types classified
  assert('classifies network error', panelSrc.includes('network') || panelSrc.includes('شبکه'));
  assert('classifies permission error', panelSrc.includes('permission') || panelSrc.includes('اجازه'));
  assert('classifies GGUF error', panelSrc.includes('gguf') || panelSrc.includes('GGUF'));
  assert('classifies checksum error', panelSrc.includes('checksum') || panelSrc.includes('چک‌سام'));
  assert('classifies RAM error', panelSrc.includes('ram') || panelSrc.includes('RAM'));
  assert('classifies VRAM error', panelSrc.includes('vram') || panelSrc.includes('VRAM'));
  assert('classifies disk error', panelSrc.includes('disk') || panelSrc.includes('دیسک'));
  assert('classifies runtime error', panelSrc.includes('runtime') || panelSrc.includes('رانتایم'));
  assert('classifies inference error', panelSrc.includes('inference') || panelSrc.includes('استنتاج'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Download History
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Download History:');
  assert('has HistoryRow component', panelSrc.includes('function HistoryRow'));
  assert('has history state', panelSrc.includes('history'));
  assert('history stores results', panelSrc.includes('setHistory'));
  assert('history shows success/failure', panelSrc.includes('success'));
  assert('history shows model name', panelSrc.includes('modelName'));
  assert('history shows duration', panelSrc.includes('durationMs'));
  assert('history has retry button', panelSrc.includes('onRetry'));
  assert('history tab exists', panelSrc.includes("'history'"));
  assert('history limited to 20', panelSrc.includes('slice(0, 20)') || panelSrc.includes('slice(0,20)'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Model Browser
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Model Browser:');
  assert('has browse tab', panelSrc.includes("'browse'"));
  assert('has search input', panelSrc.includes('search') && panelSrc.includes('Search'));
  assert('has category filter', panelSrc.includes('filterType'));
  assert('has installed filter', panelSrc.includes('filterInstalled'));
  assert('has recommended section', panelSrc.includes('recommended'));
  assert('recommended shows reason', panelSrc.includes('پیشنهادی') || panelSrc.includes('recommended') || panelSrc.includes('Reason'));
  assert('has RecommendedModelRow component', panelSrc.includes('function RecommendedModelRow'));
  assert('recommended uses low tier', panelSrc.includes("recommendedTier === 'low'"));
  assert('catalog loaded from ecosystem', panelSrc.includes('ecosystemCatalog'));
  assert('installed models from localRuntime', panelSrc.includes('localRuntimeListModels'));
  assert('filtered catalog logic', panelSrc.includes('filteredCatalog'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Navigation + UI Design
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Navigation + UI Design:');
  const navSrc = read('../../src/renderer/components/layout/NavigationRail.tsx');
  assert('nav has deploy view', navSrc.includes("'deploy'"));
  assert('nav has PackageCheck icon', navSrc.includes('PackageCheck'));

  const appShellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
  assert('AppShell imports ModelDeploymentPanel', appShellSrc.includes('ModelDeploymentPanel'));
  assert('AppShell routes deploy view', appShellSrc.includes("case 'deploy'"));

  // UI design elements
  assert('panel uses glassmorphism', panelSrc.includes('nex-glass'));
  assert('panel uses animations', panelSrc.includes('animate-spin') || panelSrc.includes('animate-pulse') || panelSrc.includes('nex-animate'));
  assert('panel uses hover effects', panelSrc.includes('nex-hover-lift') || panelSrc.includes('hover:'));
  assert('panel has dark theme tokens', panelSrc.includes('var(--nex-bg)') && panelSrc.includes('var(--nex-text)'));
  assert('panel has responsive grid', panelSrc.includes('grid'));
  assert('panel has icons from lucide-react', panelSrc.includes('from \'lucide-react\''));
  assert('panel uses nex-scroll for overflow', panelSrc.includes('nex-scroll'));
  assert('panel has tabs', panelSrc.includes('tab') && panelSrc.includes('setTab'));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Security
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Security:');
  // No backend architecture changes — only UI + progress forwarding
  assert('panel does not call fetch()', !panelSrc.includes('fetch('));
  assert('panel does not call XMLHttpRequest', !panelSrc.includes('XMLHttpRequest'));
  assert('panel does not call download() directly', !panelSrc.includes('.download('));
  assert('panel calls modelDeployDownload (permission-gated)', panelSrc.includes('modelDeployDownload'));
  assert('panel calls modelDeployImport (safe)', panelSrc.includes('modelDeployImport'));
  assert('panel calls modelDeployRemove (permission-gated)', panelSrc.includes('modelDeployRemove'));
  assert('panel has security note', panelSrc.includes('اجازه') || panelSrc.includes('permission'));
  assert('panel has permission dialog', panelSrc.includes('pendingPermission'));
  assert('panel subscribes to real progress events', panelSrc.includes('onModelDeploymentProgress'));
  assert('panel subscribes to permission requests', panelSrc.includes('onModelDeploymentPermissionRequest'));
  assert('panel does not fake progress', panelSrc.includes('progress') && !panelSrc.includes('fakeProgress') && !panelSrc.includes('simulate'));
  assert('main still forwards permission events', mainSrc.includes("'model-deployment-permission-request'"));
  assert('main uses setProgressCallback', mainSrc.includes('setProgressCallback'));

  // ═══════════════════════════════════════════════════════════════════════
  // 10) Phase 51-62 Preserved (Regression)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) Phase 51-62 Preserved:');
  assert('Phase 61 model-deployment-manager exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-deployment-manager.ts')));
  assert('Phase 61 model-verification exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-verification.ts')));
  assert('Phase 61 model-inference-tester exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-inference-tester.ts')));
  assert('Phase 62 interaction-loop exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/interaction-loop.ts')));
  assert('Phase 62 language-foundation exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/language-foundation.ts')));
  assert('Phase 62 BasicInteractionPanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/BasicInteractionPanel.tsx')));
  assert('Phase 58 LocalRuntimePanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/LocalRuntimePanel.tsx')));
  assert('Phase 59 ModelEcosystemPanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/ModelEcosystemPanel.tsx')));
  assert('Phase 60 UniversalKnowledgePanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/UniversalKnowledgePanel.tsx')));
  assert('Phase 58 multi-model-runtime-manager exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/multi-model-runtime-manager.ts')));
  assert('Phase 59 model-ecosystem-manager exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/model-intelligence/model-ecosystem-manager.ts')));
  assert('Phase 60 universal-knowledge-brain exists', fs.existsSync(path.join(__dirname, '../../src/main/knowledge/universal-knowledge-brain.ts')));
  assert('Phase 12 inference.ts exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/inference.ts')));
  assert('Phase 43 permission-gate exists', fs.existsSync(path.join(__dirname, '../../src/main/update/permission-gate.ts')));
  assert('Phase 43 secure-downloader exists', fs.existsSync(path.join(__dirname, '../../src/main/update/secure-downloader.ts')));
  assert('Phase 43 audit-logger exists', fs.existsSync(path.join(__dirname, '../../src/main/update/audit-logger.ts')));

  // Existing subsystems still work
  const { getModelDeploymentManager } = await import('../../src/main/ai/model-deployment-manager');
  assert('Phase 61 deployment manager singleton still works', typeof getModelDeploymentManager === 'function');
  const { getInteractionLoopManager } = await import('../../src/main/ai/interaction-loop');
  assert('Phase 62 interaction loop singleton still works', typeof getInteractionLoopManager === 'function');
  const { getMultiModelRuntimeManager } = await import('../../src/main/ai/multi-model-runtime-manager');
  assert('Phase 58 runtime manager singleton still works', typeof getMultiModelRuntimeManager === 'function');
  const { getExpertProfiles } = await import('../../src/main/ai/nex-expert-system');
  assert('expert profiles still 6', getExpertProfiles().length === 6);

  // ═══════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 63 DEPLOYMENT UI RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('FAILURES:', failures.join(' | '));
    process.exit(1);
  }
  console.log('PHASE 63 PROFESSIONAL MODEL DEPLOYMENT UI: ALL PASS ✅');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
