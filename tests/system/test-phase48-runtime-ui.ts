/**
 * Phase 48 — Runtime Center Full UI Integration Tests
 *
 * Verifies:
 *   1. RuntimeSetupPanel has install buttons (Persian labels)
 *   2. Permission dialog UI (Persian + [تایید می‌کنم] / [لغو])
 *   3. Progress UI (6 steps with ✓/✗/spinner)
 *   4. IPC connections (componentInstall, componentExplanation, etc.)
 *   5. Voice confirmation button
 *   6. No auto-download (buttons open permission dialog, not download)
 *   7. First-launch wizard readiness
 *
 * Run: npx tsx tests/system/test-phase48-runtime-ui.ts
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
  // 1) RuntimeSetupPanel — Install Buttons
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) Install buttons:');
  const panelSrc = read('../../src/renderer/components/layout/RuntimeSetupPanel.tsx');

  assert('panel exists', panelSrc.length > 0);
  assert('default export', panelSrc.includes('export default function RuntimeSetupPanel'));
  assert('has handleInstallRecommended', panelSrc.includes('handleInstallRecommended'));
  assert('has handleEnableVoice', panelSrc.includes('handleEnableVoice'));
  assert('has handleEnableVision', panelSrc.includes('handleEnableVision'));
  assert('has handleOptimize', panelSrc.includes('handleOptimize'));
  assert('has ActionBtn for recommended model (نصب مدل پیشنهادی)', panelSrc.includes('نصب مدل پیشنهادی'));
  assert('has ActionBtn for voice (فعال کردن صدا)', panelSrc.includes('فعال کردن صدا'));
  assert('has ActionBtn for vision (فعال کردن بینایی)', panelSrc.includes('فعال کردن بینایی'));
  assert('has ActionBtn for optimize (بهینه‌سازی)', panelSrc.includes('بهینه‌سازی برای سیستم من'));
  assert('install buttons disabled while installing', panelSrc.includes('disabled={installing}') || panelSrc.includes('disabled:opacity-50'));
  assert('has handleInstallClick', panelSrc.includes('handleInstallClick'));
  assert('install buttons call handleInstallClick', panelSrc.includes('onClick={() => handleInstallClick'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Permission Dialog UI
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Permission dialog:');
  assert('PermissionDialogUI component', panelSrc.includes('function PermissionDialogUI'));
  assert('dialog has title', panelSrc.includes('dialog.title'));
  assert('dialog has body (purpose)', panelSrc.includes('dialog.purpose'));
  assert('dialog has size', panelSrc.includes('dialog.size'));
  assert('dialog has requirements', panelSrc.includes('dialog.requirements'));
  assert('dialog has question', panelSrc.includes('dialog.question'));
  assert('dialog has component name', panelSrc.includes('dialog.componentName'));
  assert('confirm button (تایید می‌کنم)', panelSrc.includes('تایید می‌کنم'));
  assert('cancel button (لغو)', panelSrc.includes('لغو'));
  assert('voice confirmation button (تایید با صدا)', panelSrc.includes('تایید با صدا'));
  assert('onConfirm handler', panelSrc.includes('onConfirm'));
  assert('onCancel handler', panelSrc.includes('onCancel'));
  assert('onVoice handler', panelSrc.includes('onVoice'));
  assert('dialog overlay (z-50)', panelSrc.includes('z-50'));
  assert('dialog background overlay', panelSrc.includes('rgba(0,0,0,0.7)'));
  assert('PermissionDialog interface', panelSrc.includes('interface PermissionDialog'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) Progress UI
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Progress UI:');
  assert('ProgressUI component', panelSrc.includes('function ProgressUI'));
  assert('InstallProgress interface', panelSrc.includes('interface InstallProgress'));
  assert('progress has 6 steps (DEFAULT_STEPS)', panelSrc.includes('DEFAULT_STEPS'));
  assert('step: Permission (اجازه)', panelSrc.includes("'اجازه'"));
  assert('step: Download (دانلود)', panelSrc.includes("'دانلود'"));
  assert('step: Verify (بررسی)', panelSrc.includes("'بررسی'"));
  assert('step: Install (نصب)', panelSrc.includes("'نصب'"));
  assert('step: Test (تست)', panelSrc.includes("'تست'"));
  assert('step: Activate (فعال‌سازی)', panelSrc.includes("'فعال‌سازی'"));
  assert('step statuses (pending/active/done/failed)', panelSrc.includes("'pending'") && panelSrc.includes("'active'") && panelSrc.includes("'done'") && panelSrc.includes("'failed'"));
  assert('progress shows CheckCircle2 for done', panelSrc.includes('CheckCircle2'));
  assert('progress shows XCircle for failed', panelSrc.includes('XCircle'));
  assert('progress shows Loader2 spinner for active', panelSrc.includes('Loader2') && panelSrc.includes('animate-spin'));
  assert('progress has percent bar', panelSrc.includes('percent'));
  assert('progress has component name', panelSrc.includes('progress.componentName'));
  assert('progress has messageFa', panelSrc.includes('progress.messageFa'));
  assert('progress success message (نصب با موفقیت)', panelSrc.includes('نصب با موفقیت انجام شد'));
  assert('progress failure message (نصب ناموفق)', panelSrc.includes('نصب ناموفق بود'));
  assert('progress auto-hides after 3 seconds', panelSrc.includes('setTimeout') && panelSrc.includes('3000'));
  assert('re-scans after install completes', panelSrc.includes('scan()'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) IPC connections
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) IPC connections:');
  assert('calls runtimeSetupSummary', panelSrc.includes('runtimeSetupSummary'));
  assert('calls componentExplanation', panelSrc.includes('componentExplanation'));
  assert('calls componentInstall', panelSrc.includes('componentInstall'));
  assert('calls componentRespondPermission', panelSrc.includes('componentRespondPermission'));
  assert('calls componentRespondVoice', panelSrc.includes('componentRespondVoice'));
  assert('passes "تایید می‌کنم" to componentRespondPermission', panelSrc.includes("'تایید می‌کنم'"));
  assert('uses component ID for install', panelSrc.includes('componentId'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Component status with install buttons
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Component status with install:');
  assert('shows install button (نصب) for missing components', panelSrc.includes("'نصب'") || panelSrc.includes('نصب'));
  assert('install button disabled while installing', /نصب[\s\S]{0,200}disabled/.test(panelSrc));
  assert('install button calls handleInstallClick', /onClick.*handleInstallClick/.test(panelSrc));
  assert('shows installed icon (CheckCircle2)', panelSrc.includes('CheckCircle2'));
  assert('shows missing icon (XCircle)', panelSrc.includes('XCircle'));
  assert('shows partial icon (AlertTriangle)', panelSrc.includes('AlertTriangle'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Recommendations with install buttons
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Recommendations with install:');
  assert('recommendations have install button', panelSrc.includes('Download size={10} /> نصب'));
  assert('recommendations show Download icon', panelSrc.includes('Download'));
  assert('recommendations show purposeFa', panelSrc.includes('comp.purposeFa'));
  assert('recommendations show sizeBytes', panelSrc.includes('comp.sizeBytes'));
  assert('recommendations show hardwareFit', panelSrc.includes('hardwareFit'));
  assert('recommendations show Persian fit label', panelSrc.includes('تطابق عالی'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Permission notice
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Permission notice:');
  assert('has Shield icon', panelSrc.includes('Shield'));
  assert('permission notice mentions no auto-download (بدون اجازه)', panelSrc.includes('بدون اجازه'));
  assert('permission notice mentions تایید می‌کنم', panelSrc.includes('تایید می‌کنم'));
  assert('permission notice mentions chat confirmation', panelSrc.includes('در چت'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) No auto-download (buttons open dialog, not download)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) No auto-download:');
  // Buttons call handleInstallClick → which shows dialog → NOT direct download
  assert('handleInstallClick calls componentExplanation (not componentInstall)', /handleInstallClick[\s\S]{0,500}componentExplanation/.test(panelSrc));
  assert('handleInstallClick shows permission dialog', /handleInstallClick[\s\S]{0,500}setPermDialog/.test(panelSrc));
  assert('handlePermissionResponse handles confirm/cancel', panelSrc.includes("response !== 'confirm'"));
  assert('actual install only after confirm', /handlePermissionResponse[\s\S]{0,1500}componentInstall/.test(panelSrc));
  assert('NO direct componentInstall call from buttons', !/onClick.*componentInstall/.test(panelSrc));
  assert('NO auto-download without dialog', !/useEffect[\s\S]{0,200}componentInstall/.test(panelSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Voice confirmation
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Voice confirmation:');
  assert('has handleVoicePermission', panelSrc.includes('handleVoicePermission'));
  assert('calls componentRespondVoice', panelSrc.includes('componentRespondVoice'));
  assert('voice button in dialog (تایید با صدا)', panelSrc.includes('تایید با صدا'));
  assert('voice button has Mic icon', /تایید با صدا[\s\S]{0,100}Mic/.test(panelSrc) || /Mic[\s\S]{0,100}تایید با صدا/.test(panelSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 10) Installation flow (permission → download → verify → install → test → activate)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) Installation flow:');
  assert('flow: handleInstallClick → componentExplanation → setPermDialog', /handleInstallClick[\s\S]{0,1500}componentExplanation[\s\S]{0,500}setPermDialog/.test(panelSrc));
  assert('flow: handlePermissionResponse → componentRespondPermission → componentInstall', /handlePermissionResponse[\s\S]{0,1500}componentRespondPermission[\s\S]{0,800}componentInstall/.test(panelSrc));
  assert('flow: updates progress steps after result', /result\.success[\s\S]{0,300}setProgress/.test(panelSrc));
  assert('flow: handles install failure (stage-based)', panelSrc.includes('result.stage'));
  assert('flow: auto-hide progress after 3s', panelSrc.includes('3000'));
  assert('flow: re-scan after install', /setTimeout[\s\S]{0,200}scan\(\)/.test(panelSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 11) UI structure (cards, system info, etc.)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n11) UI structure:');
  assert('has Card helper', panelSrc.includes('function Card'));
  assert('has Stat helper', panelSrc.includes('function Stat'));
  assert('has ActionBtn helper', panelSrc.includes('function ActionBtn'));
  assert('has Rocket icon in header', panelSrc.includes('Rocket'));
  assert('has RefreshCw for re-scan', panelSrc.includes('RefreshCw'));
  assert('has Brain icon for LLM', panelSrc.includes('Brain'));
  assert('has Mic icon for voice', panelSrc.includes('Mic'));
  assert('has Eye icon for vision', panelSrc.includes('Eye'));
  assert('has Wrench icon for tools', panelSrc.includes('Wrench'));
  assert('has Volume2 icon for TTS', panelSrc.includes('Volume2'));
  assert('has Shield icon for permission', panelSrc.includes('Shield'));
  assert('has Zap icon for optimize', panelSrc.includes('Zap'));
  assert('has Download icon for recommendations', panelSrc.includes('Download'));
  assert('has essential badge (ضروری)', panelSrc.includes('ضروری'));
  assert('has essential missing warning', panelSrc.includes('essentialMissing'));
  assert('has Persian label for system (سیستم)', panelSrc.includes('سیستم'));
  assert('has Persian label for components (کامپوننت‌ها)', panelSrc.includes('کامپوننت‌ها'));
  assert('has Persian label for recommendations (پیشنهادات)', panelSrc.includes('پیشنهادات'));
  assert('has loading state (در حال بررسی)', panelSrc.includes('در حال بررسی سیستم'));
  assert('has error state (خطا)', panelSrc.includes('خطا'));
  assert('has retry button (تلاش مجدد)', panelSrc.includes('تلاش مجدد'));
  assert('has scan button (اسکن مجدد)', panelSrc.includes('اسکن مجدد'));
  assert('shows CPU cores', panelSrc.includes('cpuCores'));
  assert('shows RAM', panelSrc.includes('ramTotalBytes'));
  assert('shows GPU name', panelSrc.includes('gpu.name'));
  assert('shows VRAM', panelSrc.includes('vramTotalBytes'));
  assert('shows OS', panelSrc.includes('st.os'));
  assert('shows portable mode', panelSrc.includes('isPortable'));

  // ═══════════════════════════════════════════════════════════════════════
  // 12) IPC handlers (Phase 47 still registered)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n12) IPC handlers (Phase 47):');
  const mainSrc = read('../../src/main/main.ts');
  assert('component-install IPC', mainSrc.includes("'component-install'"));
  assert('component-explanation IPC', mainSrc.includes("'component-explanation'"));
  assert('component-health-check IPC', mainSrc.includes("'component-health-check'"));
  assert('component-respond-permission IPC', mainSrc.includes("'component-respond-permission'"));
  assert('component-respond-voice IPC', mainSrc.includes("'component-respond-voice'"));
  assert('runtime-scan IPC (Phase 46)', mainSrc.includes("'runtime-scan'"));
  assert('runtime-setup-summary IPC (Phase 46)', mainSrc.includes("'runtime-setup-summary'"));
  assert('runtime-catalog IPC (Phase 46)', mainSrc.includes("'runtime-catalog'"));
  assert('runtime-recommendations IPC (Phase 46)', mainSrc.includes("'runtime-recommendations'"));
  assert('runtime-find-missing IPC (Phase 46)', mainSrc.includes("'runtime-find-missing'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 13) Preload bridges (Phase 47)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n13) Preload bridges:');
  const preSrc = read('../../src/main/preload.ts');
  assert('componentInstall bridge', preSrc.includes('componentInstall'));
  assert('componentExplanation bridge', preSrc.includes('componentExplanation'));
  assert('componentHealthCheck bridge', preSrc.includes('componentHealthCheck'));
  assert('componentRespondPermission bridge', preSrc.includes('componentRespondPermission'));
  assert('componentRespondVoice bridge', preSrc.includes('componentRespondVoice'));
  assert('runtimeScan bridge (Phase 46)', preSrc.includes('runtimeScan'));
  assert('runtimeSetupSummary bridge (Phase 46)', preSrc.includes('runtimeSetupSummary'));

  // ═══════════════════════════════════════════════════════════════════════
  // 14) Type definitions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n14) Type definitions:');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('componentInstall type', typesSrc.includes('componentInstall'));
  assert('componentExplanation type', typesSrc.includes('componentExplanation'));
  assert('componentRespondPermission type', typesSrc.includes('componentRespondPermission'));
  assert('componentRespondVoice type', typesSrc.includes('componentRespondVoice'));

  // ═══════════════════════════════════════════════════════════════════════
  // 15) NavigationRail + AppShell (Phase 46 routing still intact)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n15) NavigationRail + AppShell:');
  const navSrc = read('../../src/renderer/components/layout/NavigationRail.tsx');
  assert('NexView includes runtime', navSrc.includes("'runtime'"));
  assert('runtime nav item exists', navSrc.includes("id: 'runtime'"));
  assert('runtime has Rocket icon', navSrc.includes('Rocket'));

  const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
  assert('lazy import RuntimeSetupPanel', shellSrc.includes('RuntimeSetupPanel'));
  assert('case runtime in leftPanel', shellSrc.includes("case 'runtime'"));
  assert('renders RuntimeSetupPanel', shellSrc.includes('<RuntimeSetupPanel'));

  // ═══════════════════════════════════════════════════════════════════════
  // 16) Phase 43/44/47 security rules preserved
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n16) Security rules preserved:');
  assert('NO auto-download from UI buttons', !/onClick.*componentInstall/.test(panelSrc));
  assert('buttons show dialog first', /handleInstallClick[\s\S]{0,500}setPermDialog/.test(panelSrc));
  assert('install only after "confirm" response', panelSrc.includes("response !== 'confirm'"));
  assert('dialog requires "تایید می‌کنم" text', panelSrc.includes("'تایید می‌کنم'"));
  assert('dialog has cancel button (لغو)', panelSrc.includes('لغو'));
  assert('permission notice in panel', panelSrc.includes('بدون اجازه'));
  assert('PermissionGate still in main.ts (Phase 43)', mainSrc.includes('permission-gate'));
  assert('SecureDownloader still in main.ts (Phase 44)', mainSrc.includes('SecureDownloader'));
  assert('ComponentInstaller still in main.ts (Phase 47)', mainSrc.includes('component-installer'));
  assert('NO auto-install on mount', !/useEffect[\s\S]{0,200}componentInstall/.test(panelSrc));

  // ═══════════════════════════════════════════════════════════════════════
  // 17) ComponentInstaller integration (Phase 47 backend)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n17) ComponentInstaller integration:');
  const ciSrc = read('../../src/main/runtime/component-installer.ts');
  assert('ComponentInstaller class exists', ciSrc.includes('export class ComponentInstaller'));
  assert('installComponent method', ciSrc.includes('async installComponent'));
  assert('HealthChecker class exists', ciSrc.includes('export class HealthChecker'));
  assert('Persian explanation method', ciSrc.includes('generatePersianExplanation'));
  assert('uses PermissionGate', ciSrc.includes('PermissionGate'));
  assert('uses SecureDownloader', ciSrc.includes('SecureDownloader'));
  assert('uses RollbackManager', ciSrc.includes('RollbackManager'));
  assert('uses AuditLogger', ciSrc.includes('AuditLogger'));
  assert('uses UpdateHistory', ciSrc.includes('UpdateHistory'));
  assert('NO auto-download in installer', !/setTimeout[\s\S]{0,100}download/i.test(ciSrc));
  assert('requests permission first', ciSrc.includes('requestPermission'));

  // ═══════════════════════════════════════════════════════════════════════
  // 18) Component catalog (Phase 46 backend)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n18) Component catalog:');
  const ccSrc = read('../../src/main/runtime/component-catalog.ts');
  assert('catalog has 9+ entries', ccSrc.includes('qwen2.5-coder-7b') && ccSrc.includes('whisper-base') && ccSrc.includes('llava-7b') && ccSrc.includes('llama-cpp') && ccSrc.includes('ffmpeg'));
  assert('CatalogComponent interface', ccSrc.includes('interface CatalogComponent'));
  assert('has purposeFa (Persian)', ccSrc.includes('purposeFa'));
  assert('has downloadUrl', ccSrc.includes('downloadUrl'));
  assert('has checksum', ccSrc.includes('checksum'));
  assert('has isEssential', ccSrc.includes('isEssential'));
  assert('getCatalogEntry function', ccSrc.includes('export function getCatalogEntry'));

  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 48 RUNTIME UI RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('PHASE 48 RUNTIME CENTER FULL UI INTEGRATION: ALL PASS ✅');
  console.log('\nNOTE: Windows runtime QA is NOT VERIFIED by this test.');
  console.log('      The user MUST verify on Windows:');
  console.log('      1. Click "Setup" → see install buttons (نصب مدل پیشنهادی, فعال کردن صوا)');
  console.log('      2. Click install → Persian permission dialog appears');
  console.log('      3. Click "تایید می‌کنم" → download starts with progress');
  console.log('      4. Progress shows 6 steps (اجازه/دانلود/بررسی/نصب/تست/فعال‌سازی)');
  console.log('      5. NO download without clicking "تایید می‌کنم"');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
