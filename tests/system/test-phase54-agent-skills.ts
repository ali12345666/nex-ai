/**
 * Phase 54 — Agent Skills & Tool Execution Layer Tests
 *
 * Verifies:
 *   1. Skill registry (16 skills, 6 domains, permissions)
 *   2. Agent executor (createPlan, executePlan, permission flow)
 *   3. Persian permission messages
 *   4. No autonomous execution (permission required)
 *   5. IPC handlers + preload + types
 *   6. Phase 38-53 preserved
 *
 * Run: npx tsx tests/system/test-phase54-agent-skills.ts
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
  // 1) Skill Registry
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) Skill Registry:');
  const srSrc = read('../../src/main/ai/agent-skill-registry.ts');

  assert('agent-skill-registry.ts exists', srSrc.length > 0);
  assert('AgentSkill interface', srSrc.includes('interface AgentSkill'));
  assert('SkillPermission type (safe/requires-approval/high-risk)', srSrc.includes("'safe'") && srSrc.includes("'requires-approval'") && srSrc.includes("'high-risk'"));
  assert('skill has id', srSrc.includes('id: string'));
  assert('skill has name', srSrc.includes('name: string'));
  assert('skill has nameFa', srSrc.includes('nameFa'));
  assert('skill has expertDomain', srSrc.includes('expertDomain:'));
  assert('skill has requiredPermission', srSrc.includes('requiredPermission:'));
  assert('skill has tools', srSrc.includes('tools:'));
  assert('skill has description', srSrc.includes('description:'));
  assert('skill has descriptionFa', srSrc.includes('descriptionFa'));
  assert('skill has actionDescription', srSrc.includes('actionDescription'));
  assert('skill has actionDescriptionFa', srSrc.includes('actionDescriptionFa'));
  assert('getSkillRegistry function', srSrc.includes('export function getSkillRegistry'));
  assert('getSkill function', srSrc.includes('export function getSkill'));
  assert('getSkillsByDomain function', srSrc.includes('export function getSkillsByDomain'));
  assert('getSkillsByPermission function', srSrc.includes('export function getSkillsByPermission'));

  // Skills exist
  assert('has code-generation skill', srSrc.includes("'code-generation'"));
  assert('has code-analysis skill', srSrc.includes("'code-analysis'"));
  assert('has debugging skill', srSrc.includes("'debugging'"));
  assert('has project-analysis skill', srSrc.includes("'project-analysis'"));
  assert('has file-editing skill', srSrc.includes("'file-editing'"));
  assert('has circuit-analysis skill', srSrc.includes("'circuit-analysis'"));
  assert('has pcb-assistance skill', srSrc.includes("'pcb-assistance'"));
  assert('has datasheet-analysis skill', srSrc.includes("'datasheet-analysis'"));
  assert('has component-selection skill', srSrc.includes("'component-selection'"));
  assert('has document-search skill', srSrc.includes("'document-search'"));
  assert('has pdf-analysis skill', srSrc.includes("'pdf-analysis'"));
  assert('has terminal-commands skill', srSrc.includes("'terminal-commands'"));
  assert('has system-diagnostics skill', srSrc.includes("'system-diagnostics'"));
  assert('has image-analysis skill', srSrc.includes("'image-analysis'"));

  // Persian names
  assert('code-generation Fa: تولید کد', srSrc.includes("'تولید کد'"));
  assert('terminal-commands Fa: دستورات ترمینال', srSrc.includes("'دستورات ترمینال'"));
  assert('image-analysis Fa: تحلیل تصویر', srSrc.includes("'تحلیل تصویر'"));

  // Permissions
  assert('code-analysis is safe', /'code-analysis'[\s\S]{0,500}permission: 'safe'/.test(srSrc) || /'code-analysis'[\s\S]{0,800}'safe'/.test(srSrc));
  assert('terminal-commands requires-approval', /'terminal-commands'[\s\S]{0,500}'requires-approval'/.test(srSrc));

  // Functional
  const { getSkillRegistry, getSkill, getSkillsByDomain } = await import('../../src/main/ai/agent-skill-registry');
  const skills = getSkillRegistry();
  assert('registry has 15+ skills', skills.length >= 15);
  assert('all skills have id', skills.every((s) => typeof s.id === 'string'));
  assert('all skills have name', skills.every((s) => typeof s.name === 'string'));
  assert('all skills have nameFa', skills.every((s) => typeof s.nameFa === 'string'));
  assert('all skills have tools', skills.every((s) => Array.isArray(s.tools)));
  assert('all skills have descriptionFa', skills.every((s) => typeof s.descriptionFa === 'string'));
  assert('getSkill returns skill', getSkill('code-generation') !== null);
  assert('getSkill returns null for unknown', getSkill('nonexistent') === null);
  assert('getSkillsByDomain(software) returns skills', getSkillsByDomain('software-engineering' as any).length >= 1);
  assert('getSkillsByDomain(electronics) returns skills', getSkillsByDomain('electronics-engineering' as any).length >= 1);

  // ═══════════════════════════════════════════════════════════════════════
  // 2) Agent Executor
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) Agent Executor:');
  const aeSrc = read('../../src/main/ai/nex-agent-executor.ts');

  assert('nex-agent-executor.ts exists', aeSrc.length > 0);
  assert('NexAgentExecutor class exported', aeSrc.includes('export class NexAgentExecutor'));
  assert('ExecutionPlan interface', aeSrc.includes('interface ExecutionPlan'));
  assert('ExecutionStep interface', aeSrc.includes('interface ExecutionStep'));
  assert('ExecutionResult interface', aeSrc.includes('interface ExecutionResult'));
  assert('createPlan method', aeSrc.includes('createPlan('));
  assert('executePlan method', aeSrc.includes('executePlan('));
  assert('requestPermission method', aeSrc.includes('requestPermission'));
  assert('respondToPermission method', aeSrc.includes('respondToPermission'));
  assert('respondViaVoice method', aeSrc.includes('respondViaVoice'));
  assert('getPendingPermission method', aeSrc.includes('getPendingPermission'));
  assert('hasPendingPermission method', aeSrc.includes('hasPendingPermission'));
  assert('generatePermissionMessageFa method', aeSrc.includes('generatePermissionMessageFa'));
  assert('getAllSkills method', aeSrc.includes('getAllSkills'));
  assert('getSkillsForDomain method', aeSrc.includes('getSkillsForDomain'));
  assert('uses PermissionGate (Phase 43)', aeSrc.includes('PermissionGate'));
  assert('uses getExpertRouter (Phase 53)', aeSrc.includes('getExpertRouter'));
  assert('uses getLongTermMemorySystem (Phase 52)', aeSrc.includes('getLongTermMemorySystem'));
  assert('uses getSkillsByDomain', aeSrc.includes('getSkillsByDomain'));
  assert('getNexAgentExecutor singleton', aeSrc.includes('export function getNexAgentExecutor'));

  // Plan structure
  assert('plan has steps array', aeSrc.includes('steps:'));
  assert('plan has totalSteps', aeSrc.includes('totalSteps:'));
  assert('plan has requiresPermission', aeSrc.includes('requiresPermission:'));
  assert('plan has summary', aeSrc.includes('summary:'));
  assert('plan has summaryFa', aeSrc.includes('summaryFa:'));
  assert('step has skillId', aeSrc.includes('skillId:'));
  assert('step has skillName', aeSrc.includes('skillName:'));
  assert('step has skillNameFa', aeSrc.includes('skillNameFa:'));
  assert('step has action', aeSrc.includes('action:'));
  assert('step has actionFa', aeSrc.includes('actionFa:'));
  assert('step has permission', aeSrc.includes('permission:'));
  assert('step has tools', aeSrc.includes('tools:'));
  assert('step has status', aeSrc.includes('status:'));
  assert('step status: pending/approved/executing/completed/failed/denied', aeSrc.includes("'pending'") && aeSrc.includes("'approved'") && aeSrc.includes("'executing'") && aeSrc.includes("'completed'") && aeSrc.includes("'denied'"));

  // Persian permission messages
  assert('Persian: run_command message', aeSrc.includes("'برای اجرای این دستور نیاز به اجازه شما دارم.'"));
  assert('Persian: write_file message', aeSrc.includes("'این فایل تغییر خواهد یابد. اجازه می‌دهید؟'"));
  assert('Persian: delete_file message', aeSrc.includes("'delete_file'") && aeSrc.includes('حذف'));
  assert('Persian: download message', aeSrc.includes("'download'") && aeSrc.includes('دانلود'));
  assert('Persian: install message', aeSrc.includes("'install'") && aeSrc.includes('نصب'));
  assert('Persian: generic fallback', aeSrc.includes("'برای این عملیات نیاز به اجازه شما دارم.'"));

  // Execution flow
  assert('flow: has createPlan method', aeSrc.includes('createPlan('));
  assert('flow: has executePlan method', aeSrc.includes('executePlan('));
  assert('flow: checks permission before executing', aeSrc.includes("permission !== 'safe'") && aeSrc.includes('requestPermission'));
  assert('flow: denied step continues (not abort)', /denied[\s\S]{0,200}continue/.test(aeSrc));
  assert('flow: records tool usage', aeSrc.includes('recordToolUsage'));
  assert('flow: returns ExecutionResult', aeSrc.includes('ExecutionResult'));
  assert('flow: result has messageFa', aeSrc.includes('messageFa'));
  assert('flow: result has log array', aeSrc.includes('log: string[]'));

  // Functional
  const { getNexAgentExecutor } = await import('../../src/main/ai/nex-agent-executor');
  const executor = getNexAgentExecutor();

  // createPlan
  const plan = executor.createPlan('fix a bug in the React component');
  assert('createPlan returns ExecutionPlan', plan !== null);
  assert('plan has steps', Array.isArray(plan.steps));
  assert('plan has totalSteps', typeof plan.totalSteps === 'number');
  assert('plan has requiresPermission', typeof plan.requiresPermission === 'boolean');
  assert('plan has summary', typeof plan.summary === 'string');
  assert('plan has summaryFa', typeof plan.summaryFa === 'string');
  assert('plan steps have skillId', plan.steps.every((s: any) => typeof s.skillId === 'string'));
  assert('plan steps have skillNameFa', plan.steps.every((s: any) => typeof s.skillNameFa === 'string'));
  assert('plan steps have permission', plan.steps.every((s: any) => typeof s.permission === 'string'));
  assert('plan steps have status=pending', plan.steps.every((s: any) => s.status === 'pending'));

  // executePlan with a simple plan (all safe steps)
  const safePlan: any = {
    id: 'test-plan',
    steps: [{ index: 1, skillId: 'code-analysis', skillName: 'Code Analysis', skillNameFa: 'تحلیل کد', action: 'Analyze code', actionFa: 'تحلیل کد', permission: 'safe', tools: ['read_file'], status: 'pending' }],
    totalSteps: 1,
    requiresPermission: false,
    summary: 'Test',
    summaryFa: 'تست',
  };
  const execResult = await executor.executePlan(safePlan);
  assert('executePlan returns ExecutionResult', execResult !== null);
  assert('safe plan → success', execResult.success === true);
  assert('completedSteps = 1', execResult.completedSteps === 1);
  assert('failedSteps = 0', execResult.failedSteps === 0);
  assert('deniedSteps = 0', execResult.deniedSteps === 0);
  assert('result has messageFa', typeof execResult.messageFa === 'string');
  assert('result has log array', Array.isArray(execResult.log));

  // executePlan with requires-approval → permission denial
  const permPlan: any = {
    id: 'test-perm-plan',
    steps: [{ index: 1, skillId: 'terminal-commands', skillName: 'Terminal', skillNameFa: 'ترمینال', action: 'Run command', actionFa: 'اجرای دستور', permission: 'requires-approval', tools: ['run_command'], status: 'pending' }],
    totalSteps: 1,
    requiresPermission: true,
    summary: 'Test perm',
    summaryFa: 'تست',
  };
  const permExecPromise = executor.executePlan(permPlan);
  setTimeout(() => executor.respondToPermission('نه'), 50);
  const permResult = await permExecPromise;
  assert('denied plan → deniedSteps = 1', permResult.deniedSteps === 1);
  assert('denied plan → completedSteps = 0', permResult.completedSteps === 0);

  // Permission message generation
  const msg1 = executor.generatePermissionMessageFa('run_command');
  assert('generatePermissionMessageFa(run_command) returns Persian', msg1.includes('اجرا'));
  const msg2 = executor.generatePermissionMessageFa('write_file');
  assert('generatePermissionMessageFa(write_file) returns Persian', msg2.includes('تغییر'));
  const msg3 = executor.generatePermissionMessageFa('delete_file');
  assert('generatePermissionMessageFa(delete_file) returns Persian', msg3.includes('حذف'));
  const msg4 = executor.generatePermissionMessageFa('unknown_action');
  assert('generatePermissionMessageFa(unknown) returns generic Persian', msg4.includes('اجازه'));

  // getAllSkills
  const allSkills = executor.getAllSkills();
  assert('getAllSkills returns array', Array.isArray(allSkills));
  assert('getAllSkills has 15+ skills', allSkills.length >= 15);

  // ═══════════════════════════════════════════════════════════════════════
  // 3) No autonomous execution
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) No autonomous execution:');
  assert('checks permission before executing', aeSrc.includes("permission !== 'safe'"));
  assert('NO auto-execution without permission', !/setTimeout[\s\S]{0,100}executeTool/i.test(aeSrc));
  assert('NO auto-download', !aeSrc.includes('download('));
  assert('NO auto-install', !/setTimeout[\s\S]{0,100}install/i.test(aeSrc));
  assert('NO removeModel', !aeSrc.includes('removeModel'));
  assert('NO modelAdd', !aeSrc.includes('modelAdd'));
  assert('NO SecureDownloader import', !aeSrc.includes('SecureDownloader'));
  assert('NO ComponentInstaller import', !aeSrc.includes('ComponentInstaller'));
  assert('NO fetch/https calls', !aeSrc.includes('fetch(') && !aeSrc.includes('https.get'));
  assert('executor asks before terminal', aeSrc.includes("'برای اجرای این دستور"));
  assert('executor asks before file modification', aeSrc.includes("'این فایل تغییر"));
  assert('executor asks before delete', aeSrc.includes("'این فایل حذف"));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) IPC handlers
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');
  assert('agent-create-plan handler', mainSrc.includes("'agent-create-plan'"));
  assert('agent-execute-plan handler', mainSrc.includes("'agent-execute-plan'"));
  assert('agent-respond-permission handler', mainSrc.includes("'agent-respond-permission'"));
  assert('agent-respond-voice handler', mainSrc.includes("'agent-respond-voice'"));
  assert('agent-pending-permission handler', mainSrc.includes("'agent-pending-permission'"));
  assert('agent-permission-message handler', mainSrc.includes("'agent-permission-message'"));
  assert('skill-all handler', mainSrc.includes("'skill-all'"));
  assert('skill-get handler', mainSrc.includes("'skill-get'"));
  assert('skill-by-domain handler', mainSrc.includes("'skill-by-domain'"));
  assert('Phase 54 comment in main.ts', mainSrc.includes('Phase 54'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Preload bridges
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Preload bridges:');
  const preSrc = read('../../src/main/preload.ts');
  assert('agentCreatePlan bridge', preSrc.includes('agentCreatePlan'));
  assert('agentExecutePlan bridge', preSrc.includes('agentExecutePlan'));
  assert('agentRespondPermission bridge', preSrc.includes('agentRespondPermission'));
  assert('agentRespondVoice bridge', preSrc.includes('agentRespondVoice'));
  assert('agentPendingPermission bridge', preSrc.includes('agentPendingPermission'));
  assert('agentPermissionMessage bridge', preSrc.includes('agentPermissionMessage'));
  assert('skillAll bridge', preSrc.includes('skillAll'));
  assert('skillGet bridge', preSrc.includes('skillGet'));
  assert('skillByDomain bridge', preSrc.includes('skillByDomain'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Type definitions
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Type definitions:');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('agentCreatePlan type', typesSrc.includes('agentCreatePlan'));
  assert('agentExecutePlan type', typesSrc.includes('agentExecutePlan'));
  assert('agentRespondPermission type', typesSrc.includes('agentRespondPermission'));
  assert('skillAll type', typesSrc.includes('skillAll'));
  assert('agentPermissionMessage type', typesSrc.includes('agentPermissionMessage'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) Phase 38-53 preserved
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) Phase 38-53 preserved:');
  assert('Phase 43 permission-gate in main.ts', mainSrc.includes('permission-gate'));
  assert('Phase 44 SecureDownloader in main.ts', mainSrc.includes('SecureDownloader'));
  assert('Phase 50 system-status in main.ts', mainSrc.includes("'system-status'"));
  assert('Phase 51 brain-decide in main.ts', mainSrc.includes("'brain-decide'"));
  assert('Phase 52 personality-get in main.ts', mainSrc.includes("'personality-get'"));
  assert('Phase 53 expert-route in main.ts', mainSrc.includes("'expert-route'"));
  assert('nex-brain-controller.ts exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-brain-controller.ts')));
  assert('nex-expert-system.ts exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-expert-system.ts')));
  assert('expert-router.ts exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/expert-router.ts')));
  assert('nex-personality-engine.ts exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/nex-personality-engine.ts')));
  assert('long-term-memory-system.ts exists', fs.existsSync(path.join(__dirname, '../../src/main/ai/long-term-memory-system.ts')));

  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 54 AGENT SKILLS RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('PHASE 54 AGENT SKILLS & TOOL EXECUTION LAYER: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
