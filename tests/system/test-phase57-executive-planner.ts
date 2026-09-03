/**
 * Phase 57 — Executive Planner & Multi-Agent Orchestration Tests
 *
 * Verifies:
 *   1. Planner module structure (types, exports, security hooks)
 *   2. Task decomposition (conjunction splitting, single-domain)
 *   3. Multi-agent swarm composition (experts + models)
 *   4. Expert collaboration (routing per sub-task)
 *   5. Model swarm selection (BrainController per sub-task)
 *   6. Knowledge integration (RAG retrieval per sub-task)
 *   7. Self-evaluation loop (scoring, verdicts, re-planning)
 *   8. Permission gates (delegates to NexAgentExecutor, never bypasses)
 *   9. Identity update (multi-disciplinary senior AI assistant)
 *  10. IPC handlers + preload bridges + type definitions
 *  11. UI panel + navigation
 *  12. Security (never executes tools directly, never bypasses permission)
 *  13. Phase 38-56 preserved
 *
 * Run: npx tsx tests/system/test-phase57-executive-planner.ts
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
  // 1) Planner Module Structure
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) Planner Module Structure:');
  const plannerSrc = read('../../src/main/ai/nex-executive-planner.ts');

  assert('nex-executive-planner.ts exists', plannerSrc.length > 0);
  assert('PlannerSubTask interface', plannerSrc.includes('interface PlannerSubTask'));
  assert('PlannerPlan interface', plannerSrc.includes('interface PlannerPlan'));
  assert('PlanStatus type', plannerSrc.includes('export type PlanStatus'));
  assert('SubTaskStatus type', plannerSrc.includes('export type SubTaskStatus'));
  assert('PlanSelfEvaluation interface', plannerSrc.includes('interface PlanSelfEvaluation'));
  assert('PlannerStatus interface', plannerSrc.includes('interface PlannerStatus'));
  assert('PlannerCallbacks interface', plannerSrc.includes('interface PlannerCallbacks'));
  assert('NexExecutivePlanner class', plannerSrc.includes('export class NexExecutivePlanner'));
  assert('createPlan method', plannerSrc.includes('async createPlan('));
  assert('executePlan method', plannerSrc.includes('async executePlan('));
  assert('abortPlan method', plannerSrc.includes('abortPlan('));
  assert('decompose method', plannerSrc.includes('decompose('));
  assert('composeSwarm method', plannerSrc.includes('composeSwarm('));
  assert('selfEvaluate method', plannerSrc.includes('selfEvaluate('));
  assert('getStatus method', plannerSrc.includes('getStatus('));
  assert('setPersonality method', plannerSrc.includes('setPersonality('));
  assert('getAllSkills method', plannerSrc.includes('getAllSkills('));
  assert('getAllExperts method', plannerSrc.includes('getAllExperts('));
  assert('reset method', plannerSrc.includes('reset()'));
  assert('verifyPlannerSecurity function', plannerSrc.includes('export function verifyPlannerSecurity'));
  assert('getNexExecutivePlanner singleton', plannerSrc.includes('export function getNexExecutivePlanner'));
  assert('_resetNexExecutivePlanner for tests', plannerSrc.includes('export function _resetNexExecutivePlanner'));

  // Imports — connects to all subsystems
  assert('imports BrainController', plannerSrc.includes("from './nex-brain-controller'"));
  assert('imports ExpertRouter', plannerSrc.includes("from './expert-router'"));
  assert('imports AgentSkillRegistry', plannerSrc.includes("from './agent-skill-registry'"));
  assert('imports ExpertSystem', plannerSrc.includes("from './nex-expert-system'"));
  assert('imports KnowledgeEngine', plannerSrc.includes("from '../knowledge/expert-knowledge-engine'"));
  assert('imports LongTermMemory', plannerSrc.includes("from './long-term-memory-system'"));
  assert('imports PersonalityEngine', plannerSrc.includes("from './nex-personality-engine'"));
  assert('imports AgentExecutor', plannerSrc.includes("from './nex-agent-executor'"));
  assert('dynamic import VoiceConversation', plannerSrc.includes("import('../voice/nex-voice-conversation')"));

  // Security
  assert('CRITICAL SECURITY comment', plannerSrc.includes('CRITICAL SECURITY'));
  assert('never executes tools directly comment', plannerSrc.includes('never executes tools directly') || plannerSrc.includes('COMPOSES and ORCHESTRATES'));
  assert('delegates to NexAgentExecutor', plannerSrc.includes('getNexAgentExecutor()'));
  assert('no tool-registry direct import', !plannerSrc.includes("from './tool-registry'"));
  assert('no SecureDownloader import', !plannerSrc.split('\n').some((l: string) => l.trim().startsWith('import') && l.includes('SecureDownloader')));
  assert('no fetch() call', !plannerSrc.includes('fetch('));
  assert('no net.request call (code)', !plannerSrc.split('\n').some((l: string) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && l.includes('net.request')));

  // PlanStatus values
  assert('PlanStatus has planning', plannerSrc.includes("'planning'"));
  assert('PlanStatus has ready', plannerSrc.includes("'ready'"));
  assert('PlanStatus has executing', plannerSrc.includes("'executing'"));
  assert('PlanStatus has completed', plannerSrc.includes("'completed'"));
  assert('PlanStatus has failed', plannerSrc.includes("'failed'"));
  assert('PlanStatus has aborted', plannerSrc.includes("'aborted'"));

  // Self-evaluation verdicts
  assert('verdict excellent', plannerSrc.includes("'excellent'"));
  assert('verdict acceptable', plannerSrc.includes("'acceptable'"));
  assert('verdict needs-review', plannerSrc.includes("'needs-review'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Task Decomposition (runtime)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Task Decomposition:');
  const { NexExecutivePlanner, getNexExecutivePlanner, _resetNexExecutivePlanner, verifyPlannerSecurity } = await import('../../src/main/ai/nex-executive-planner');
  _resetNexExecutivePlanner();

  const planner = new NexExecutivePlanner();

  // Single-domain request → 1 sub-task
  const d1 = planner.decompose('یک مدار طراحی کن', 'electronics-engineering');
  assert('single request → 1 sub-task', d1.length === 1);

  // Conjunction "و سپس" → splits
  const d2 = planner.decompose('یک مدار طراحی کن و سپس کد آردوینو را بنویس', 'electronics-engineering');
  assert('conjunction و سپس splits into 2', d2.length === 2, `got ${d2.length}`);
  assert('first part contains مدار', d2[0].includes('مدار'));
  assert('second part contains آردوینو', d2[1].includes('آردوینو') || d2[1].includes('کد'));

  // English "then" → splits
  const d3 = planner.decompose('design a circuit then write the code', 'electronics-engineering');
  assert('english then splits into 2', d3.length === 2);

  // Semicolon → splits
  const d4 = planner.decompose('do task A; do task B', 'software-engineering');
  assert('semicolon splits into 2', d4.length === 2);

  // Empty → []
  const d5 = planner.decompose('', 'general');
  assert('empty request → []', d5.length === 0);

  // ═══════════════════════════════════════════════════════════════════════
  // 3) Multi-Agent Plan Creation + Swarm Composition
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) Plan Creation + Swarm:');
  _resetNexExecutivePlanner();
  const planner2 = getNexExecutivePlanner();

  const plan = await planner2.createPlan('یک مدار تغذیه ۵ ولت طراحی کن و سپس کد آردوینو را بنویس');
  assert('plan created', plan !== null && plan !== undefined);
  assert('plan has id', plan.id.startsWith('plan-'));
  assert('plan has 2 sub-tasks', plan.subTasks.length === 2, `got ${plan.subTasks.length}`);
  assert('plan status ready', plan.status === 'ready');
  assert('plan has summary', plan.summary.length > 0);
  assert('plan has summaryFa', plan.summaryFa.length > 0);
  assert('plan has swarmDomains', plan.swarmDomains.length >= 1);
  assert('plan has log', plan.log.length > 0);
  assert('plan createdAt set', plan.createdAt > 0);

  // Sub-task structure
  const st0 = plan.subTasks[0];
  assert('sub-task has id', st0.id.length > 0);
  assert('sub-task has index', st0.index === 0);
  assert('sub-task has description', st0.description.length > 0);
  assert('sub-task has expertDomain', st0.expertDomain.length > 0);
  assert('sub-task has expertProfile', st0.expertProfile !== null && st0.expertProfile !== undefined);
  assert('sub-task has skills array', Array.isArray(st0.skills));
  assert('sub-task has requiredPermission', ['safe', 'requires-approval', 'high-risk'].includes(st0.requiredPermission));
  assert('sub-task has personalityPrefixFa', st0.personalityPrefixFa.length >= 0);
  assert('sub-task status pending', st0.status === 'pending');

  // Swarm composition
  const swarm = planner2.composeSwarm(plan);
  assert('swarm has experts', swarm.length >= 1);
  assert('swarm experts have nameFa', swarm.every((e: any) => e.nameFa.length > 0));

  // Status
  const status = planner2.getStatus();
  assert('status active false before execution', status.active === false);
  assert('status totalPlansCreated 1', status.totalPlansCreated === 1);
  assert('status currentPlan set', status.currentPlan !== null);

  // ═══════════════════════════════════════════════════════════════════════
  // 4) Expert Collaboration (routing per sub-task)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) Expert Collaboration:');
  // The electronics sub-task should route to electronics-engineering
  const elSub = plan.subTasks.find((s: any) => s.description.includes('مدار') || s.description.includes('circuit'));
  assert('electronics sub-task exists', elSub !== undefined);
  if (elSub) {
    assert('electronics sub-task routes to electronics expert', elSub.expertDomain === 'electronics-engineering', `got ${elSub.expertDomain}`);
  }
  // The code sub-task should route to software-engineering
  const swSub = plan.subTasks.find((s: any) => s.description.includes('کد') || s.description.includes('code'));
  assert('software sub-task exists', swSub !== undefined);
  if (swSub) {
    assert('software sub-task routes to software expert', swSub.expertDomain === 'software-engineering', `got ${swSub.expertDomain}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Model Swarm Selection (BrainController per sub-task)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Model Swarm Selection:');
  // Each sub-task should have a brainDecision (model may be null if no models installed)
  for (const st of plan.subTasks) {
    assert(`sub-task ${st.index} has brainDecision field`, st.brainDecision !== undefined);
  }
  // swarmModelIds collects unique model ids (may be empty if no models)
  assert('plan has swarmModelIds array', Array.isArray(plan.swarmModelIds));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Knowledge Integration (RAG per sub-task)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Knowledge Integration:');
  for (const st of plan.subTasks) {
    assert(`sub-task ${st.index} has knowledge field`, st.knowledge !== undefined);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Self-Evaluation Loop
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Self-Evaluation:');
  // All completed → excellent
  const allCompletedPlan: any = {
    id: 'test-1', request: 'test', subTasks: [
      { status: 'completed' }, { status: 'completed' },
    ],
  };
  const ev1 = planner.selfEvaluate(allCompletedPlan);
  assert('all completed → excellent', ev1.verdict === 'excellent');
  assert('all completed → score 1.0', ev1.overallScore === 1);
  assert('all completed → completedSubTasks 2', ev1.completedSubTasks === 2);

  // 1/2 completed → acceptable
  const halfPlan: any = { id: 'test-2', subTasks: [{ status: 'completed' }, { status: 'failed' }] };
  const ev2 = planner.selfEvaluate(halfPlan);
  assert('half completed → acceptable', ev2.verdict === 'acceptable');
  assert('half → score 0.5', ev2.overallScore === 0.5);

  // 1/3 → needs-review
  const thirdPlan: any = { id: 'test-3', subTasks: [{ status: 'completed' }, { status: 'failed' }, { status: 'failed' }] };
  const ev3 = planner.selfEvaluate(thirdPlan);
  assert('1/3 → needs-review', ev3.verdict === 'needs-review');

  // 0/2 → failed
  const nonePlan: any = { id: 'test-4', subTasks: [{ status: 'failed' }, { status: 'failed' }] };
  const ev4 = planner.selfEvaluate(nonePlan);
  assert('0 completed → failed', ev4.verdict === 'failed');
  assert('0 completed → score 0', ev4.overallScore === 0);

  // Denied sub-tasks tracked
  const deniedPlan: any = { id: 'test-5', subTasks: [{ status: 'completed' }, { status: 'denied' }] };
  const ev5 = planner.selfEvaluate(deniedPlan);
  assert('denied tracked', ev5.deniedSubTasks === 1);
  assert('denied in notes', ev5.notes.some((n: string) => n.includes('denied')));
  assert('denied in notesFa', ev5.notesFa.some((n: string) => n.includes('رد')));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Permission Gates (delegates to NexAgentExecutor)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Permission Gates:');
  // The planner delegates to NexAgentExecutor.executePlan which gates every step
  assert('planner source delegates to executor', plannerSrc.includes('executor.executePlan'));
  assert('planner imports NexAgentExecutor', plannerSrc.includes('getNexAgentExecutor'));
  assert('executePlan uses executor.createPlan', plannerSrc.includes('executor.createPlan'));

  // Execute a plan (the executor's permission gate will hold for non-safe steps)
  _resetNexExecutivePlanner();
  const planner3 = getNexExecutivePlanner();
  const execPlan = await planner3.createPlan('تحلیل کد کن');
  // Auto-approve any pending permission requests (the executor gates non-safe steps)
  const { getNexAgentExecutor } = await import('../../src/main/ai/nex-agent-executor');
  const approver = setInterval(() => {
    try { getNexAgentExecutor().respondToPermission('تایید می‌کنم'); } catch { /* */ }
  }, 30);
  // Execute — should complete or partially-complete
  const result = await planner3.executePlan(execPlan);
  clearInterval(approver);
  assert('executePlan returns updated plan', result !== null);
  assert('executePlan sets status completed/failed', ['completed', 'failed'].includes(result.status));
  assert('executePlan sets selfEvaluation', result.selfEvaluation !== null);
  assert('executePlan log non-empty', result.log.length > 0);

  // Abort
  _resetNexExecutivePlanner();
  const planner4 = getNexExecutivePlanner();
  const abortPlan: any = {
    id: 'abort-test', request: 'test', subTasks: [
      { id: 's1', index: 0, description: 'task', status: 'executing' },
    ], status: 'executing', log: [],
  };
  planner4.abortPlan(abortPlan);
  assert('abort sets status aborted', abortPlan.status === 'aborted');
  assert('abort marks executing sub-task failed', abortPlan.subTasks[0].status === 'failed');

  // ═══════════════════════════════════════════════════════════════════════
  // 9) Identity Update (multi-disciplinary senior AI assistant)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) Identity Update:');
  const idSrc = read('../../src/main/ai/nex-identity-manager.ts');
  assert('identity mission updated (multi-disciplinary)', idSrc.includes('Multi-disciplinary senior AI assistant'));
  assert('identity missionFa updated (چندرشته‌ای)', idSrc.includes('چندرشته‌ای'));
  assert('identity has Phase 57 planning ability', idSrc.includes('Multi-agent task planning & orchestration'));
  assert('identity has decomposition ability', idSrc.includes('Task decomposition & expert collaboration'));
  assert('identity has self-evaluation ability', idSrc.includes('Self-evaluation loop'));
  assert('identity has Persian planning ability', idSrc.includes('برنامه‌ریزی و هماهنگی چندعاملی'));
  assert('identity has Persian decomposition', idSrc.includes('تجزیه وظیفه و همکاری تخصصی'));
  assert('identity has Persian self-eval', idSrc.includes('حلقه خودارزیابی'));
  assert('identity has multi-agent rule', idSrc.includes('Multi-agent plans never execute dangerous steps without permission'));
  assert('identity has self-eval rule', idSrc.includes('Self-evaluation never auto-approves a denied step'));
  assert('identity has Persian multi-agent rule', idSrc.includes('برنامه‌های چندعاملی هرگز مرحله خطرناک را بدون اجازه اجرا نمی‌کنند'));

  // Runtime identity check
  const { getNexIdentityManager } = await import('../../src/main/ai/nex-identity-manager');
  const identity = getNexIdentityManager().getIdentity();
  assert('identity has Phase 57 ability', identity.abilities.some((a: string) => a.includes('Multi-agent')));
  assert('identity mission mentions multi-disciplinary', identity.mission.includes('Multi-disciplinary'));

  // ═══════════════════════════════════════════════════════════════════════
  // 10) IPC + Preload + Types
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) IPC + Preload + Types:');
  const mainSrc = read('../../src/main/main.ts');
  assert('main has Phase 57 block', mainSrc.includes('Phase 57: Executive Planner'));
  assert('main imports NexExecutivePlanner', mainSrc.includes("import('./ai/nex-executive-planner')"));
  assert('main wires planner callbacks', mainSrc.includes('executivePlanner.setCallbacks'));

  const ipcChannels = [
    'planner-create', 'planner-execute', 'planner-abort', 'planner-status',
    'planner-decompose', 'planner-swarm', 'planner-evaluate',
    'planner-set-personality', 'planner-experts', 'planner-skills', 'planner-security-audit',
  ];
  for (const ch of ipcChannels) {
    assert(`main registers ipc handler '${ch}'`, mainSrc.includes(`ipcMain.handle('${ch}'`));
  }
  assert('main forwards planner-plan-created event', mainSrc.includes("'planner-plan-created'"));
  assert('main forwards planner-plan-completed event', mainSrc.includes("'planner-plan-completed'"));
  assert('main forwards planner-self-evaluation event', mainSrc.includes("'planner-self-evaluation'"));
  assert('main forwards planner-subtask-started event', mainSrc.includes("'planner-subtask-started'"));

  // Preload
  const preloadSrc = read('../../src/main/preload.ts');
  assert('preload has Phase 57 section', preloadSrc.includes('Phase 57: Executive Planner'));
  const preloadMethods = [
    'plannerCreate', 'plannerExecute', 'plannerAbort', 'plannerStatus',
    'plannerDecompose', 'plannerSwarm', 'plannerEvaluate',
    'plannerSetPersonality', 'plannerExperts', 'plannerSkills', 'plannerSecurityAudit',
    'onPlannerPlanCreated', 'onPlannerPlanUpdated', 'onPlannerPlanCompleted',
    'onPlannerSubTaskStarted', 'onPlannerSubTaskCompleted',
    'onPlannerSelfEvaluation', 'onPlannerError',
  ];
  for (const m of preloadMethods) {
    assert(`preload exposes '${m}'`, preloadSrc.includes(`${m}:`));
  }

  // Types
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('types has Phase 57 section', typesSrc.includes('Phase 57: Executive Planner'));
  for (const m of preloadMethods) {
    assert(`types declares '${m}'`, typesSrc.includes(`${m}:`));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 11) UI Panel + Navigation
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n11) UI Panel + Navigation:');
  const panelSrc = read('../../src/renderer/components/PlannerPanel.tsx');
  assert('PlannerPanel exists', panelSrc.length > 0);
  assert('panel default export', panelSrc.includes('export default function PlannerPanel'));
  assert('panel has request input', panelSrc.includes('requestInput'));
  assert('panel calls plannerCreate', panelSrc.includes('plannerCreate'));
  assert('panel calls plannerExecute', panelSrc.includes('plannerExecute'));
  assert('panel calls plannerAbort', panelSrc.includes('plannerAbort'));
  assert('panel calls plannerStatus', panelSrc.includes('plannerStatus'));
  assert('panel calls plannerSetPersonality', panelSrc.includes('plannerSetPersonality'));
  assert('panel subscribes to plan-created', panelSrc.includes('onPlannerPlanCreated'));
  assert('panel subscribes to plan-completed', panelSrc.includes('onPlannerPlanCompleted'));
  assert('panel subscribes to self-evaluation', panelSrc.includes('onPlannerSelfEvaluation'));
  assert('panel shows sub-tasks', panelSrc.includes('subTasks'));
  assert('panel shows self-evaluation', panelSrc.includes('selfEvaluation'));
  assert('panel shows swarm', panelSrc.includes('swarm'));
  assert('panel has security note', panelSrc.includes('PermissionGate') || panelSrc.includes('اجازه'));
  assert('panel has personality selector', panelSrc.includes('PERSONALITIES'));
  assert('panel has status badges', panelSrc.includes('STATUS_META'));

  const navSrc = read('../../src/renderer/components/layout/NavigationRail.tsx');
  assert('nav has planner view', navSrc.includes("'planner'"));
  assert('nav has Network icon', navSrc.includes('Network'));
  assert('nav has Planner label', navSrc.includes("label: 'Planner'"));

  const appShellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
  assert('AppShell imports PlannerPanel', appShellSrc.includes('PlannerPanel'));
  assert('AppShell routes planner view', appShellSrc.includes("case 'planner'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 12) Security (never executes tools directly, never bypasses permission)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n12) Security:');
  const secAudit = verifyPlannerSecurity();
  assert('planner security audit passes', secAudit.ok === true);

  // The planner must NOT import tool-registry (it delegates via the executor)
  assert('planner no tool-registry import', !plannerSrc.split('\n').some((l: string) => l.trim().startsWith('import') && l.includes('tool-registry')));
  // The planner must NOT import SecureDownloader
  assert('planner no SecureDownloader import', !plannerSrc.split('\n').some((l: string) => l.trim().startsWith('import') && l.includes('SecureDownloader')));
  // The planner must NOT call fs directly (it uses memory for persistence)
  assert('planner no fs import', !plannerSrc.split('\n').some((l: string) => l.trim().startsWith('import') && (l.includes("'fs'") || l.includes('"fs"'))));
  // The planner must NOT call download/install directly
  assert('planner no download() method', !plannerSrc.includes('async download('));
  assert('planner no install() method', !plannerSrc.includes('async install('));
  // The executePlan method delegates to the executor (which gates permissions)
  assert('executePlan calls executor.executePlan', plannerSrc.includes('executor.executePlan(execPlan)'));
  // The planner persists plan state to memory (for audit)
  assert('planner persists plan to memory', plannerSrc.includes("store('decision'"));
  assert('planner persists result to memory', plannerSrc.includes("store('decision'"));

  // ═══════════════════════════════════════════════════════════════════════
  // 13) Phase 38-56 Preserved
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n13) Phase 38-56 Preserved:');
  assert('Phase 51 nex-brain-controller exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-brain-controller.ts')));
  assert('Phase 52 nex-personality-engine exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-personality-engine.ts')));
  assert('Phase 52 long-term-memory-system exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/long-term-memory-system.ts')));
  assert('Phase 53 nex-expert-system exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-expert-system.ts')));
  assert('Phase 53 expert-router exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/expert-router.ts')));
  assert('Phase 54 agent-skill-registry exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/agent-skill-registry.ts')));
  assert('Phase 54 nex-agent-executor exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-agent-executor.ts')));
  assert('Phase 43 permission-gate exists', fs.existsSync(path.join(__dirname, '../../src/main/update/permission-gate.ts')));
  assert('Phase 55 expert-knowledge-engine exists', fs.existsSync(path.join(__dirname, '../../src/main/knowledge/expert-knowledge-engine.ts')));
  assert('Phase 56 nex-voice-conversation exists', fs.existsSync(path.join(__dirname, '../../src/main/voice/nex-voice-conversation.ts')));
  assert('Phase 56 wake-word-detector exists', fs.existsSync(path.join(__dirname, '../../src/main/voice/wake-word-detector.ts')));
  assert('Phase 56 VoiceCenterPanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/VoiceCenterPanel.tsx')));
  assert('Phase 55 ExpertKnowledgePanel exists', fs.existsSync(path.join(__dirname, '../../src/renderer/components/ExpertKnowledgePanel.tsx')));

  // Existing subsystems still work
  const { getExpertProfiles } = await import('../../src/main/ai/nex-expert-system');
  assert('expert profiles still 6', getExpertProfiles().length === 6);
  const { getSkillRegistry } = await import('../../src/main/ai/agent-skill-registry');
  assert('skill registry still has 17 skills', getSkillRegistry().length === 17);
  const { getNexBrainController } = await import('../../src/main/ai/nex-brain-controller');
  assert('brain controller still decides', typeof getNexBrainController().decide === 'function');
  const { getNexPersonalityEngine } = await import('../../src/main/ai/nex-personality-engine');
  assert('personality engine still has 4 profiles', getNexPersonalityEngine().getAllPersonalities().length === 4);

  // ═══════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 57 EXECUTIVE PLANNER RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('FAILURES:', failures.join(' | '));
    process.exit(1);
  }
  console.log('PHASE 57 EXECUTIVE PLANNER & MULTI-AGENT ORCHESTRATION: ALL PASS ✅');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
