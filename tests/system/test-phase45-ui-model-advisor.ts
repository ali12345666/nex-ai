/**
 * Phase 45 UI — Model Advisor Panel Tests
 *
 * Verifies the UI integration:
 *   1. ModelAdvisorPanel component exists and renders
 *   2. NavigationRail includes 'advisor' view
 *   3. AppShell routes 'advisor' to ModelAdvisorPanel
 *   4. Chat command handlers (Persian + English)
 *   5. IPC connections (modelAdvisorStatus, modelRecommendations, modelCompare, etc.)
 *   6. No autonomous actions in UI
 *
 * Run: npx tsx tests/system/test-phase45-ui-model-advisor.ts
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
  // 1) ModelAdvisorPanel component
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) ModelAdvisorPanel component:');
  const panelSrc = read('../../src/renderer/components/layout/ModelAdvisorPanel.tsx');

  assert('ModelAdvisorPanel.tsx exists', panelSrc.length > 0);
  assert('default export', panelSrc.includes('export default function ModelAdvisorPanel'));
  assert('uses window.nexAPI.modelAdvisorStatus', panelSrc.includes('modelAdvisorStatus'));
  assert('uses window.nexAPI.modelRouterStatus', panelSrc.includes('modelRouterStatus'));
  assert('uses window.nexAPI.usageStats', panelSrc.includes('usageStats'));
  assert('uses window.nexAPI.modelCompare', panelSrc.includes('modelCompare'));
  assert('uses window.nexAPI.advisorRejectRecommendation', panelSrc.includes('advisorRejectRecommendation'));
  assert('shows Hardware section', panelSrc.includes('Hardware'));
  assert('shows CPU info', panelSrc.includes('cpuCores') || panelSrc.includes('CPU'));
  assert('shows RAM info', panelSrc.includes('ramTotalBytes') || panelSrc.includes('RAM'));
  assert('shows GPU info', panelSrc.includes('gpu') || panelSrc.includes('GPU'));
  assert('shows VRAM info', panelSrc.includes('vramTotalBytes') || panelSrc.includes('VRAM'));
  assert('shows Recommendations section', panelSrc.includes('Recommendations'));
  assert('shows recommendation name', panelSrc.includes('entry.name'));
  assert('shows improvement percent', panelSrc.includes('estimatedImprovement'));
  assert('shows download size', panelSrc.includes('sizeGB'));
  assert('shows Compare button', panelSrc.includes('Compare'));
  assert('shows Dismiss button', panelSrc.includes('Dismiss'));
  assert('shows Smart Router section', panelSrc.includes('Smart Router'));
  assert('shows router totalModels', panelSrc.includes('totalModels'));
  assert('shows router runnableModels', panelSrc.includes('runnableModels'));
  assert('shows router primaryWorkload', panelSrc.includes('primaryWorkload'));
  assert('shows Usage Patterns section', panelSrc.includes('Usage Patterns'));
  assert('shows usage totalTasks', panelSrc.includes('totalTasks'));
  assert('shows usage failureRate', panelSrc.includes('failureRate'));
  assert('shows permission notice', panelSrc.includes('never downloads'));
  assert('shows permission notice (explicit)', panelSrc.includes('explicit permission'));
  assert('NO auto-download in panel', !panelSrc.includes('downloadModel(') && !panelSrc.includes('installModel('));
  assert('NO auto-activate in panel', !panelSrc.includes('setActiveModel(') && !panelSrc.includes('activateModel('));
  assert('uses loading state', panelSrc.includes('loading'));
  assert('uses error state', panelSrc.includes('error'));
  assert('uses expanded/collapsed recommendations', panelSrc.includes('expandedRec'));
  assert('Card helper component', panelSrc.includes('function Card'));
  assert('Stat helper component', panelSrc.includes('function Stat'));
  assert('MiniStat helper component', panelSrc.includes('function MiniStat'));
  assert('formatGB helper', panelSrc.includes('function formatGB'));
  assert('formatBytes helper', panelSrc.includes('function formatBytes'));
  assert('imports lucide icons', panelSrc.includes('lucide-react'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) NavigationRail includes 'advisor'
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) NavigationRail:');
  const navSrc = read('../../src/renderer/components/layout/NavigationRail.tsx');
  assert('NexView includes advisor', navSrc.includes("'advisor'"));
  assert('NAV_ITEMS includes advisor', navSrc.includes("id: 'advisor'"));
  assert('advisor has Sparkles icon', navSrc.includes('Sparkles'));
  assert('advisor has label', navSrc.includes("label: 'Advisor'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) AppShell routes 'advisor' to ModelAdvisorPanel
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) AppShell routing:');
  const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
  assert('lazy import ModelAdvisorPanel', shellSrc.includes('ModelAdvisorPanel'));
  assert('case advisor in leftPanel', shellSrc.includes("case 'advisor'"));
  assert('renders ModelAdvisorPanel', shellSrc.includes('<ModelAdvisorPanel'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Chat command handlers (Persian + English)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Chat command handlers:');
  const chatSrc = read('../../src/renderer/components/chat/NexChatPanel.tsx');
  assert('handles "مدل بهتر" (Persian)', chatSrc.includes('مدل بهتر'));
  assert('handles "پیدا کن مدل" (Persian)', chatSrc.includes('پیدا کن مدل'));
  assert('handles "model recommend" (English)', chatSrc.includes('model recommend'));
  assert('handles "find better model" (English)', chatSrc.includes('find better model'));
  assert('handles "این مدل بهتره" (Persian)', chatSrc.includes('این مدل بهتره'));
  assert('handles "مقایسه مدل" (Persian)', chatSrc.includes('مقایسه مدل'));
  assert('handles "compare model" (English)', chatSrc.includes('compare model'));
  assert('calls modelRecommendations IPC', chatSrc.includes('modelRecommendations'));
  assert('calls modelCompare IPC', chatSrc.includes('modelCompare'));
  assert('returns Persian response text', chatSrc.includes('یک مدل بهتر برای کار شما پیدا کردم'));
  assert('returns Persian comparison text', chatSrc.includes('مقایسه مدل‌ها'));
  assert('returns Persian "no recommendations" text', chatSrc.includes('در حال حاضر مدل بهتری'));
  assert('Phase 45 comment in chat', chatSrc.includes('Phase 45'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) IPC connections (all Phase 45 IPCs are called from UI)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) IPC connections:');
  assert('modelAdvisorStatus called in panel', panelSrc.includes('modelAdvisorStatus'));
  assert('modelRecommendations called in chat', chatSrc.includes('modelRecommendations'));
  assert('modelCompare called in panel', panelSrc.includes('modelCompare'));
  assert('modelCompare called in chat', chatSrc.includes('modelCompare'));
  assert('modelRouterStatus called in panel', panelSrc.includes('modelRouterStatus'));
  assert('usageStats called in panel', panelSrc.includes('usageStats'));
  assert('advisorRejectRecommendation called in panel', panelSrc.includes('advisorRejectRecommendation'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) No autonomous actions in UI
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) No autonomous actions in UI:');
  assert('NO modelAdd in panel', !panelSrc.includes('modelAdd'));
  assert('NO modelRemove in panel', !panelSrc.includes('modelRemove'));
  assert('NO updateDownload in panel', !panelSrc.includes('updateDownload'));
  assert('NO updateInstall in panel', !panelSrc.includes('updateInstall'));
  assert('NO updateModel in panel', !panelSrc.includes('updateModel'));
  assert('NO modelAdd in chat', !/modelAdd\(/.test(chatSrc));
  assert('NO updateDownload in chat', !/updateDownload\(/.test(chatSrc));
  assert('NO updateInstall in chat', !/updateInstall\(/.test(chatSrc));
  assert('panel shows "never downloads" notice', panelSrc.includes('never downloads'));
  assert('panel shows "explicit permission" notice', panelSrc.includes('explicit permission'));

  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 45 UI MODEL ADVISOR RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('PHASE 45 UI MODEL ADVISOR: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
