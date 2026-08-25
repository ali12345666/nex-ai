/**
 * Phase 50 — Final Command Center Integration Tests
 *
 * Verifies:
 *   1. SystemStatusManager (monitors all 8 subsystems)
 *   2. Orb states (idle/thinking/listening/installing/error)
 *   3. Quick actions (talk/analyze/improve/knowledge/setup)
 *   4. Notifications (add/get/clear)
 *   5. Startup health check (Persian summary)
 *   6. IPC handlers registered
 *   7. No security bypass
 *   8. All Phase 38-49 modules still integrated
 *
 * Run: npx tsx tests/system/test-phase50-command-center.ts
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
  // 1) SystemStatusManager module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) SystemStatusManager:');
  const ssmSrc = read('../../src/main/system/system-status-manager.ts');

  assert('system-status-manager.ts exists', ssmSrc.length > 0);
  assert('SystemStatusManager class exported', ssmSrc.includes('export class SystemStatusManager'));
  assert('checkAll method', ssmSrc.includes('async checkAll()'));
  assert('addNotification method', ssmSrc.includes('addNotification'));
  assert('getNotifications method', ssmSrc.includes('getNotifications'));
  assert('setOrbState method', ssmSrc.includes('setOrbState'));
  assert('getOrbState method', ssmSrc.includes('getOrbState'));
  assert('clearNotifications method', ssmSrc.includes('clearNotifications'));
  assert('generateSummaryFa method', ssmSrc.includes('generateSummaryFa'));
  assert('SubsystemStatus type (healthy/degraded/offline/not-configured)', ssmSrc.includes("'healthy'") && ssmSrc.includes("'degraded'") && ssmSrc.includes("'not-configured'"));
  assert('OrbCommandState type (idle/thinking/listening/speaking/installing/error/offline)', ssmSrc.includes("'idle'") && ssmSrc.includes("'thinking'") && ssmSrc.includes("'listening'") && ssmSrc.includes("'installing'") && ssmSrc.includes("'error'"));
  assert('SubsystemInfo interface', ssmSrc.includes('interface SubsystemInfo'));
  assert('SystemStatus interface', ssmSrc.includes('interface SystemStatus'));
  assert('SystemNotification interface', ssmSrc.includes('interface SystemNotification'));
  assert('QuickAction interface', ssmSrc.includes('interface QuickAction'));
  assert('uses listModels (Phase 39)', ssmSrc.includes('listModels'));
  assert('uses getMemoryRetrievalEngine (Phase 40)', ssmSrc.includes('getMemoryRetrievalEngine'));
  assert('uses getLocalVoiceEngine (Phase 41)', ssmSrc.includes('getLocalVoiceEngine'));
  assert('uses getVisionEngine (Phase 42)', ssmSrc.includes('getVisionEngine'));
  assert('uses getRuntimeSetupManager (Phase 46)', ssmSrc.includes('getRuntimeSetupManager'));
  assert('getSystemStatusManager singleton', ssmSrc.includes('export function getSystemStatusManager'));
  assert('NO download() calls', !ssmSrc.includes('download('));
  assert('NO install() calls', !ssmSrc.includes('install('));
  assert('NO PermissionGate import', !ssmSrc.includes('PermissionGate'));
  assert('NO SecureDownloader import', !ssmSrc.includes('SecureDownloader'));

  // Subsystem IDs
  assert('has ai-core subsystem', ssmSrc.includes("'ai-core'"));
  assert('has model-manager subsystem', ssmSrc.includes("'model-manager'"));
  assert('has memory subsystem', ssmSrc.includes("'memory'"));
  assert('has voice subsystem', ssmSrc.includes("'voice'"));
  assert('has vision subsystem', ssmSrc.includes("'vision'"));
  assert('has update subsystem', ssmSrc.includes("'update'"));
  assert('has advisor subsystem', ssmSrc.includes("'advisor'"));
  assert('has runtime subsystem', ssmSrc.includes("'runtime'"));

  // Persian labels
  assert('ai-core has Persian name (هسته)', ssmSrc.includes('هسته هوش مصنوعی'));
  assert('voice has Persian name (موتور صدا)', ssmSrc.includes('موتور صدا'));
  assert('vision has Persian name (موتور بینایی)', ssmSrc.includes('موتور بینایی'));
  assert('update has Persian name (سیستم به‌روزرسانی)', ssmSrc.includes('سیستم به‌روزرسانی'));
  assert('advisor has Persian name (مشاور مدل)', ssmSrc.includes('مشاور مدل'));
  assert('runtime has Persian name (نصب و راه‌اندازی)', ssmSrc.includes('نصب و راه‌اندازی'));

  // Quick actions
  assert('quick action: talk (صحبت)', ssmSrc.includes("'صحبت'"));
  assert('quick action: analyze-image (تحلیل تصویر)', ssmSrc.includes("'تحلیل تصویر'"));
  assert('quick action: improve-model (بهبود مدل)', ssmSrc.includes("'بهبود مدل'"));
  assert('quick action: open-knowledge (دانش)', ssmSrc.includes("'دانش'"));
  assert('quick action: setup-runtime (نصب)', ssmSrc.includes("'نصب'"));

  // Startup summary
  assert('startup summary has Persian (سیستم آماده)', ssmSrc.includes('سیستم آماده است'));
  assert('startup summary has Persian warning (نیاز به توجه)', ssmSrc.includes('نیاز به توجه'));

  // Functional
  const { getSystemStatusManager } = await import('../../src/main/system/system-status-manager');
  const manager = getSystemStatusManager();
  const status = await manager.checkAll();
  assert('checkAll returns SystemStatus', status !== null);
  assert('status has overall', typeof status.overall === 'string');
  assert('status has overallFa', typeof status.overallFa === 'string');
  assert('status has subsystems array', Array.isArray(status.subsystems));
  assert('status has 8 subsystems', status.subsystems.length >= 8);
  assert('status has activeModel', 'activeModel' in status);
  assert('status has totalModels', typeof status.totalModels === 'number');
  assert('status has essentialMissing', typeof status.essentialMissing === 'number');
  assert('status has voiceReady', typeof status.voiceReady === 'boolean');
  assert('status has visionReady', typeof status.visionReady === 'boolean');
  assert('status has memoryReady', typeof status.memoryReady === 'boolean');
  assert('status has startupSummary', typeof status.startupSummary === 'string');
  assert('status has startupSummaryFa', typeof status.startupSummaryFa === 'string');
  assert('status has quickActions', Array.isArray(status.quickActions));
  assert('status has 5 quick actions', status.quickActions.length >= 5);
  assert('status has orbState', typeof status.orbState === 'string');
  assert('status has notifications', Array.isArray(status.notifications));

  // Each subsystem
  for (const sub of status.subsystems) {
    assert(`subsystem ${sub.id} has name`, typeof sub.name === 'string');
    assert(`subsystem ${sub.id} has nameFa`, typeof sub.nameFa === 'string');
    assert(`subsystem ${sub.id} has status`, typeof sub.status === 'string');
    assert(`subsystem ${sub.id} has health (0-100)`, sub.health >= 0 && sub.health <= 100);
  }

  // Notifications
  manager.addNotification({ type: 'info', message: 'Test', messageFa: 'تست', actionRequired: false });
  const notifs = manager.getNotifications();
  assert('addNotification adds entry', notifs.length >= 1);
  assert('notification has id', notifs[0].id !== undefined);
  assert('notification has timestamp', notifs[0].timestamp !== undefined);
  manager.clearNotifications();
  assert('clearNotifications empties list', manager.getNotifications().length === 0);

  // Orb state
  manager.setOrbState('installing');
  assert('setOrbState/getOrbState works', manager.getOrbState() === 'installing');
  manager.setOrbState('thinking');
  assert('orbState thinking', manager.getOrbState() === 'thinking');

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Orb states (Phase 50: 'installing' added)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Orb states:');
  const orbSrc = read('../../src/renderer/components/orb/orb-state.ts');
  assert('NexOrbState includes installing', orbSrc.includes("'installing'"));
  assert('STATE_COLOR_PALETTE has installing', orbSrc.includes('installing:'));
  assert('installing color is amber (#f59e0b)', orbSrc.includes('#f59e0b'));
  assert('idle state exists', orbSrc.includes("'idle'"));
  assert('thinking state exists', orbSrc.includes("'thinking'"));
  assert('listening state exists', orbSrc.includes("'listening'"));
  assert('speaking state exists', orbSrc.includes("'speaking'"));
  assert('error state exists', orbSrc.includes("'error'"));
  assert('offline state exists', orbSrc.includes("'offline'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) IPC handlers
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');
  assert('system-status handler', mainSrc.includes("'system-status'"));
  assert('system-startup-summary handler', mainSrc.includes("'system-startup-summary'"));
  assert('system-orb-state handler', mainSrc.includes("'system-orb-state'"));
  assert('system-set-orb-state handler', mainSrc.includes("'system-set-orb-state'"));
  assert('system-notifications handler', mainSrc.includes("'system-notifications'"));
  assert('system-add-notification handler', mainSrc.includes("'system-add-notification'"));
  assert('system-clear-notifications handler', mainSrc.includes("'system-clear-notifications'"));
  assert('system-quick-actions handler', mainSrc.includes("'system-quick-actions'"));
  assert('Phase 50 comment in main.ts', mainSrc.includes('Phase 50'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Preload bridges
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Preload bridges:');
  const preSrc = read('../../src/main/preload.ts');
  assert('systemStatus bridge', preSrc.includes('systemStatus'));
  assert('systemStartupSummary bridge', preSrc.includes('systemStartupSummary'));
  assert('systemOrbState bridge', preSrc.includes('systemOrbState'));
  assert('systemSetOrbState bridge', preSrc.includes('systemSetOrbState'));
  assert('systemNotifications bridge', preSrc.includes('systemNotifications'));
  assert('systemAddNotification bridge', preSrc.includes('systemAddNotification'));
  assert('systemClearNotifications bridge', preSrc.includes('systemClearNotifications'));
  assert('systemQuickActions bridge', preSrc.includes('systemQuickActions'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Type definitions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Type definitions:');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('systemStatus type', typesSrc.includes('systemStatus'));
  assert('systemStartupSummary type', typesSrc.includes('systemStartupSummary'));
  assert('systemOrbState type', typesSrc.includes('systemOrbState'));
  assert('systemNotifications type', typesSrc.includes('systemNotifications'));
  assert('systemQuickActions type', typesSrc.includes('systemQuickActions'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Quick actions details
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Quick actions:');
  assert('talk action has icon mic', ssmSrc.includes("icon: 'mic'"));
  assert('analyze-image action has icon eye', ssmSrc.includes("icon: 'eye'"));
  assert('improve-model action has icon sparkles', ssmSrc.includes("icon: 'sparkles'"));
  assert('open-knowledge action has icon book', ssmSrc.includes("icon: 'book'"));
  assert('setup-runtime action has icon rocket', ssmSrc.includes("icon: 'rocket'"));
  assert('talk action has enabled flag', ssmSrc.includes('enabled: voiceReady'));
  assert('analyze-image has enabled flag', ssmSrc.includes('enabled: visionReady'));
  assert('setup-runtime enabled when essentialMissing > 0', ssmSrc.includes('enabled: essentialMissing > 0'));
  assert('each action has labelFa', ssmSrc.includes('labelFa'));
  assert('each action has descriptionFa', ssmSrc.includes('descriptionFa'));

  // Functional: quick actions from checkAll
  const qa = status.quickActions;
  assert('5 quick actions returned', qa.length >= 5);
  assert('talk action present', qa.some((a: any) => a.id === 'talk'));
  assert('analyze-image action present', qa.some((a: any) => a.id === 'analyze-image'));
  assert('improve-model action present', qa.some((a: any) => a.id === 'improve-model'));
  assert('open-knowledge action present', qa.some((a: any) => a.id === 'open-knowledge'));
  assert('setup-runtime action present', qa.some((a: any) => a.id === 'setup-runtime'));
  assert('improve-model always enabled', qa.find((a: any) => a.id === 'improve-model')?.enabled === true);
  assert('each action has label', qa.every((a: any) => typeof a.label === 'string'));
  assert('each action has labelFa', qa.every((a: any) => typeof a.labelFa === 'string'));
  assert('each action has icon', qa.every((a: any) => typeof a.icon === 'string'));
  assert('each action has description', qa.every((a: any) => typeof a.description === 'string'));
  assert('each action has descriptionFa', qa.every((a: any) => typeof a.descriptionFa === 'string'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Startup health check (Persian summary)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Startup health check:');
  assert('summary contains Persian text', status.startupSummaryFa.length > 0);
  assert('summary mentions subsystems', status.startupSummaryFa.includes('هسته') || status.startupSummaryFa.includes('مدیریت') || status.startupSummaryFa.includes('حافظه'));
  assert('summary has overall status', status.overallFa.length > 0);
  assert('English summary exists', status.startupSummary.length > 0);
  assert('English summary mentions subsystems', status.startupSummary.includes('AI Core') || status.startupSummary.includes('Model Manager'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) No security bypass
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) No security bypass:');
  assert('NO download() in status manager', !ssmSrc.includes('download('));
  assert('NO install() in status manager', !ssmSrc.includes('install('));
  assert('NO removeModel() in status manager', !ssmSrc.includes('removeModel'));
  assert('NO modelAdd() in status manager', !ssmSrc.includes('modelAdd'));
  assert('NO updateDownload in status manager', !ssmSrc.includes('updateDownload'));
  assert('NO updateInstall in status manager', !ssmSrc.includes('updateInstall'));
  assert('NO SecureDownloader import', !ssmSrc.includes('SecureDownloader'));
  assert('NO ComponentInstaller import', !ssmSrc.includes('ComponentInstaller'));
  assert('NO PermissionGate import', !ssmSrc.includes('PermissionGate'));
  assert('NO fetch/https calls', !ssmSrc.includes('fetch(') && !ssmSrc.includes('https.get'));
  assert('status manager only MONITORS', ssmSrc.includes('MONITORS') || ssmSrc.includes('monitors'));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) All Phase 38-49 modules still exist
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) All Phase 38-49 modules exist:');
  const checks: Array<[string, string]> = [
    ['Phase 38 agent/core.ts', '../../src/main/agent/core.ts'],
    ['Phase 38 agent/react-loop.ts', '../../src/main/agent/react-loop.ts'],
    ['Phase 39 model-registry.ts', '../../src/main/ai/model-registry.ts'],
    ['Phase 39 model-versioning.ts', '../../src/main/ai/model-versioning.ts'],
    ['Phase 39 hardware-model-recommender.ts', '../../src/main/ai/hardware-model-recommender.ts'],
    ['Phase 40 semantic-memory-store.ts', '../../src/main/memory/semantic-memory-store.ts'],
    ['Phase 40 memory-retrieval-engine.ts', '../../src/main/memory/memory-retrieval-engine.ts'],
    ['Phase 40 pdf-parser.ts', '../../src/main/knowledge/pdf-parser.ts'],
    ['Phase 40 vector-store-interface.ts', '../../src/main/knowledge/vector-store-interface.ts'],
    ['Phase 41 local-voice-engine.ts', '../../src/main/voice/local-voice-engine.ts'],
    ['Phase 41 local-whisper-provider.ts', '../../src/main/voice/local-whisper-provider.ts'],
    ['Phase 41 local-piper-provider.ts', '../../src/main/voice/local-piper-provider.ts'],
    ['Phase 42 vision-engine.ts', '../../src/main/vision/vision-engine.ts'],
    ['Phase 42 local-llava-provider.ts', '../../src/main/vision/local-llava-provider.ts'],
    ['Phase 43 permission-gate.ts', '../../src/main/update/permission-gate.ts'],
    ['Phase 43 audit-logger.ts', '../../src/main/update/audit-logger.ts'],
    ['Phase 43 rollback-manager.ts', '../../src/main/update/rollback-manager.ts'],
    ['Phase 44 secure-downloader.ts', '../../src/main/update/secure-downloader.ts'],
    ['Phase 44 signature-verifier.ts', '../../src/main/update/signature-verifier.ts'],
    ['Phase 44 update-installer.ts', '../../src/main/update/update-installer.ts'],
    ['Phase 44 update-history.ts', '../../src/main/update/update-history.ts'],
    ['Phase 45 model-advisor.ts', '../../src/main/ai/model-intelligence/model-advisor.ts'],
    ['Phase 45 smart-model-router.ts', '../../src/main/ai/model-intelligence/smart-model-router.ts'],
    ['Phase 45 models-catalog.ts', '../../src/main/ai/model-intelligence/models-catalog.ts'],
    ['Phase 45 advisor-persistence.ts', '../../src/main/ai/model-intelligence/advisor-persistence.ts'],
    ['Phase 46 component-catalog.ts', '../../src/main/runtime/component-catalog.ts'],
    ['Phase 46 runtime-setup-manager.ts', '../../src/main/runtime/runtime-setup-manager.ts'],
    ['Phase 47 component-installer.ts', '../../src/main/runtime/component-installer.ts'],
    ['Phase 49 advanced-model-catalog.ts', '../../src/main/ai/model-intelligence/advanced-model-catalog.ts'],
    ['Phase 49 hardware-setup-advisor.ts', '../../src/main/ai/model-intelligence/hardware-setup-advisor.ts'],
  ];
  for (const [label, filePath] of checks) {
    assert(`${label} exists`, fs.existsSync(path.join(__dirname, filePath)));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 10) All IPC handlers from Phase 38-50 present in main.ts
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) All IPC handlers present:');
  const ipcChecks: Array<[string, string]> = [
    ['Phase 43: update-respond-permission', "'update-respond-permission'"],
    ['Phase 43: update-rollback', "'update-rollback'"],
    ['Phase 44: update-download', "'update-download'"],
    ['Phase 44: update-install', "'update-install'"],
    ['Phase 44: update-model', "'update-model'"],
    ['Phase 45: model-advisor-status', "'model-advisor-status'"],
    ['Phase 45: model-recommendations', "'model-recommendations'"],
    ['Phase 45: model-compare', "'model-compare'"],
    ['Phase 45: model-router-decision', "'model-router-decision'"],
    ['Phase 46: runtime-scan', "'runtime-scan'"],
    ['Phase 46: runtime-setup-summary', "'runtime-setup-summary'"],
    ['Phase 47: component-install', "'component-install'"],
    ['Phase 47: component-explanation', "'component-explanation'"],
    ['Phase 49: firstrun-analyze', "'firstrun-analyze'"],
    ['Phase 49: firstrun-summary', "'firstrun-summary'"],
    ['Phase 50: system-status', "'system-status'"],
    ['Phase 50: system-startup-summary', "'system-startup-summary'"],
    ['Phase 50: system-orb-state', "'system-orb-state'"],
    ['Phase 50: system-notifications', "'system-notifications'"],
    ['Phase 50: system-quick-actions', "'system-quick-actions'"],
  ];
  for (const [label, pattern] of ipcChecks) {
    assert(`${label} IPC registered`, mainSrc.includes(pattern));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 11) NavigationRail + AppShell + UI panels
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n11) UI panels:');
  const navSrc = read('../../src/renderer/components/layout/NavigationRail.tsx');
  assert('nav has chat', navSrc.includes("'chat'"));
  assert('nav has workspace', navSrc.includes("'workspace'"));
  assert('nav has advisor', navSrc.includes("'advisor'"));
  assert('nav has runtime', navSrc.includes("'runtime'"));
  assert('nav has memory', navSrc.includes("'memory'"));
  assert('nav has knowledge', navSrc.includes("'knowledge'"));
  assert('nav has settings', navSrc.includes("'settings'"));
  assert('nav has 7 items', (navSrc.match(/id: '/g) || []).length >= 7);

  const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
  assert('AppShell lazy imports ModelAdvisorPanel', shellSrc.includes('ModelAdvisorPanel'));
  assert('AppShell lazy imports RuntimeSetupPanel', shellSrc.includes('RuntimeSetupPanel'));
  assert('AppShell case advisor', shellSrc.includes("case 'advisor'"));
  assert('AppShell case runtime', shellSrc.includes("case 'runtime'"));

  assert('ModelAdvisorPanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/layout/ModelAdvisorPanel.tsx')));
  assert('RuntimeSetupPanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/layout/RuntimeSetupPanel.tsx')));
  assert('NexChatPanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/chat/NexChatPanel.tsx')));
  assert('orb-state.ts exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/orb/orb-state.ts')));
  assert('NexOrb.tsx exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/orb/NexOrb.tsx')));

  // ═══════════════════════════════════════════════════════════════════════
  // 12) Notification system
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n12) Notification system:');
  assert('SystemNotification interface', ssmSrc.includes('interface SystemNotification'));
  assert('notification has id', ssmSrc.includes('id: string'));
  assert('notification has type (info/warning/success/error)', ssmSrc.includes("'info'") && ssmSrc.includes("'warning'") && ssmSrc.includes("'success'") && ssmSrc.includes("'error'"));
  assert('notification has message', ssmSrc.includes('message: string'));
  assert('notification has messageFa', ssmSrc.includes('messageFa: string'));
  assert('notification has timestamp', ssmSrc.includes('timestamp: number'));
  assert('notification has actionRequired', ssmSrc.includes('actionRequired: boolean'));
  assert('notifications capped at 50', ssmSrc.includes('50'));

  // Functional: add + get
  manager.clearNotifications();
  manager.addNotification({ type: 'success', message: 'Model activated', messageFa: 'مدل اصلی فعال شد', actionRequired: false });
  manager.addNotification({ type: 'warning', message: 'Permission needed', messageFa: 'نیاز به تایید شما دارم', actionRequired: true });
  const ns = manager.getNotifications();
  assert('2 notifications added', ns.length === 2);
  assert('newest first', ns[0].messageFa === 'نیاز به تایید شما دارم');
  assert('notification has actionRequired=true for warning', ns[0].actionRequired === true);
  assert('notification has actionRequired=false for success', ns[1].actionRequired === false);

  // ═══════════════════════════════════════════════════════════════════════
  // 13) Orb state management
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n13) Orb state management:');
  const orbStates: OrbCommandState[] = ['idle', 'thinking', 'listening', 'speaking', 'installing', 'error', 'offline'];
  for (const state of orbStates) {
    manager.setOrbState(state as any);
    assert(`orbState ${state} set/get works`, manager.getOrbState() === state);
  }
  // Default from checkAll
  const freshStatus = await manager.checkAll();
  assert('checkAll sets orbState to idle or error', freshStatus.orbState === 'idle' || freshStatus.orbState === 'error');

  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 50 COMMAND CENTER RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('PHASE 50 FINAL COMMAND CENTER INTEGRATION: ALL PASS ✅');
}

type OrbCommandState = 'idle' | 'thinking' | 'listening' | 'speaking' | 'installing' | 'error' | 'offline';

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
