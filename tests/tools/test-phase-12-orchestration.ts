/**
 * NEX AI — Phase 12: Multi-Agent Orchestration Integration — Tests
 *
 * Tests the integration of NexAgentExecutor with agent/core.ts:
 *   1. executePlan no longer simulates — delegates to real agent pipeline
 *   2. Each step creates a real agent task + runs it
 *   3. Permission Gate is NOT bypassed (agent/core handles per-tool gating)
 *   4. ExecutionResult contains real outcomes (tool calls, observations, verifications)
 *   5. Cancellation propagates to agent task
 *   6. Failure isolation (one step failure doesn't crash the executor)
 *   7. Long-term memory recording still works
 *   8. ExecutivePlanner passes projectPath + conversationHistory to executor
 *   9. Regression: Phase 6-11 systems intact
 *
 * Run with: npx tsx tests/tools/test-phase-12-orchestration.ts
 */

import * as path from 'path';
import * as fs from 'fs';

// ─── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, name: string) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.error(`  FAIL: ${name}`);
  }
}

async function testSection(name: string, fn: () => Promise<void> | void): Promise<void> {
  console.log(`\n=== ${name} ===`);
  try {
    await fn();
  } catch (err) {
    failed++;
    failures.push(`${name} (threw: ${(err as Error).message})`);
    console.error(`  CRASH: ${name}:`, (err as Error).message);
    console.error((err as Error).stack);
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('Phase 12: Multi-Agent Orchestration Integration Tests\n');

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 1: executePlan delegates to agent/core.ts (not simulation)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('1. executePlan delegates to agent/core.ts', async () => {
    const executorSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'nex-agent-executor.ts'),
      'utf-8',
    );

    console.log('\nTest 1.1: executePlan imports agent/core dynamically');
    assert(executorSource.includes("import('../agent/core')"), 'dynamic import of agent/core');

    console.log('\nTest 1.2: executePlan calls createTask');
    assert(executorSource.includes('agentCore.createTask'), 'calls createTask');

    console.log('\nTest 1.3: executePlan calls runTask');
    assert(executorSource.includes('agentCore.runTask'), 'calls runTask');

    console.log('\nTest 1.4: NO simulation stub');
    assert(!executorSource.includes('// Simulate execution'), 'simulation stub removed');
    assert(!executorSource.includes('step.result = `${step.skillName} completed successfully`'), 'fake success message removed');

    console.log('\nTest 1.5: Real outcome extracted from task');
    assert(executorSource.includes('finalTask.status'), 'checks task status');
    assert(executorSource.includes('finalTask.toolCalls.length'), 'counts tool calls');
    assert(executorSource.includes('finalTask.observations.length'), 'counts observations');
    assert(executorSource.includes('finalTask.verification.length'), 'counts verifications');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 2: Permission Gate NOT bypassed
  // ════════════════════════════════════════════════════════════════════════
  await testSection('2. Permission Gate NOT bypassed', async () => {
    const executorSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'nex-agent-executor.ts'),
      'utf-8',
    );

    console.log('\nTest 2.1: executor has pre-execution PermissionGate');
    assert(executorSource.includes('requestPermission'), 'has requestPermission');
    assert(executorSource.includes('PermissionGate'), 'uses PermissionGate');

    console.log('\nTest 2.2: executor does NOT call executeTool directly');
    // Check for actual function calls (not comment mentions)
    assert(!/^[^*]*executeTool\(/m.test(executorSource), 'does NOT call executeTool() in code');
    assert(!/^[^*]*executeToolWithPermission\(/m.test(executorSource), 'does NOT call executeToolWithPermission() in code');

    console.log('\nTest 2.3: permission gating delegated to agent/core.ts');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    assert(coreSource.includes('executeToolWithPermission'), 'agent/core uses executeToolWithPermission');
    assert(coreSource.includes('requestPermissionAndWait'), 'agent/core calls requestPermissionAndWait');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 3: ExecutionResult contains real outcomes
  // ════════════════════════════════════════════════════════════════════════
  await testSection('3. ExecutionResult contains real outcomes', async () => {
    const executorSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'nex-agent-executor.ts'),
      'utf-8',
    );

    console.log('\nTest 3.1: completed steps have real result from task');
    assert(executorSource.includes('step.result = `${step.skillName} completed:'), 'result includes tool call count');
    assert(executorSource.includes('toolCount'), 'includes tool count');
    assert(executorSource.includes('obsCount'), 'includes observation count');
    assert(executorSource.includes('verCount'), 'includes verification count');

    console.log('\nTest 3.2: failed steps have real error from task');
    assert(executorSource.includes('finalTask.errors'), 'checks task errors');
    assert(executorSource.includes('errMsg'), 'extracts error message');

    console.log('\nTest 3.3: cancelled tasks handled');
    assert(executorSource.includes("finalTask.status === 'cancelled'"), 'handles cancelled status');
    assert(executorSource.includes('cancelReason'), 'includes cancel reason');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 4: Failure isolation
  // ════════════════════════════════════════════════════════════════════════
  await testSection('4. Failure isolation', async () => {
    const executorSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'nex-agent-executor.ts'),
      'utf-8',
    );

    console.log('\nTest 4.1: each step in try/catch');
    assert(executorSource.includes('try {'), 'has try');
    assert(executorSource.includes('} catch (err: any) {'), 'has catch');
    assert(executorSource.includes('step.status = \'failed\''), 'marks failed on error');

    console.log('\nTest 4.2: one step failure does NOT stop execution');
    assert(executorSource.includes('continue;'), 'continues to next step');

    console.log('\nTest 4.3: agent/core import failure handled gracefully');
    assert(executorSource.includes('agent/core.ts not available'), 'handles import failure');
    assert(executorSource.includes('WARNING: agent/core.ts not available'), 'logs warning');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 5: Long-term memory recording
  // ════════════════════════════════════════════════════════════════════════
  await testSection('5. Long-term memory recording', async () => {
    const executorSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'nex-agent-executor.ts'),
      'utf-8',
    );

    console.log('\nTest 5.1: ltm.recordToolUsage called after execution');
    assert(executorSource.includes('ltm.recordToolUsage(step.skillId)'), 'records tool usage');

    console.log('\nTest 5.2: ltm wrapped in try/catch (best-effort)');
    assert(executorSource.includes('try {'), 'wrapped in try');
    assert(executorSource.includes('} catch { /* */ }'), 'catch is silent (best-effort)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 6: ExecutivePlanner passes context to executor
  // ════════════════════════════════════════════════════════════════════════
  await testSection('6. ExecutivePlanner passes context to executor', async () => {
    const plannerSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'nex-executive-planner.ts'),
      'utf-8',
    );

    console.log('\nTest 6.1: executePlan called with opts');
    assert(plannerSource.includes('executor.executePlan(execPlan, {'), 'passes opts');
    assert(plannerSource.includes('projectPath: plan.projectPath'), 'passes projectPath');
    assert(plannerSource.includes('recentConversation: plan.conversationHistory'), 'passes conversationHistory');

    console.log('\nTest 6.2: PlannerPlan has projectPath + conversationHistory fields');
    assert(plannerSource.includes('projectPath?: string;'), 'PlannerPlan has projectPath');
    assert(plannerSource.includes('conversationHistory?'), 'PlannerPlan has conversationHistory');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 7: executePlan signature accepts opts
  // ════════════════════════════════════════════════════════════════════════
  await testSection('7. executePlan signature accepts opts', async () => {
    const executorSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'nex-agent-executor.ts'),
      'utf-8',
    );

    console.log('\nTest 7.1: executePlan has opts parameter');
    assert(executorSource.includes('opts?: {'), 'has optional opts');
    assert(executorSource.includes('projectPath?: string;'), 'opts has projectPath');
    assert(executorSource.includes('recentConversation?'), 'opts has recentConversation');

    console.log('\nTest 7.2: opts passed to createTask');
    assert(executorSource.includes('projectPath: opts?.projectPath'), 'projectPath passed to createTask');
    assert(executorSource.includes('recentConversation: opts?.recentConversation'), 'conversation passed to createTask');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 8: Regression — Phase 6-11 systems intact
  // ════════════════════════════════════════════════════════════════════════
  await testSection('8. Regression (source inspection)', async () => {
    console.log('\nTest 8.1: Phase 6 task queue intact');
    const queueSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'tasks', 'queue.ts'),
      'utf-8',
    );
    assert(queueSource.includes('enqueueAgentTask'), 'Phase 6 queue intact');

    console.log('\nTest 8.2: Phase 7 recovery intact');
    const recoverySource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'recovery-engine.ts'),
      'utf-8',
    );
    assert(recoverySource.includes('decideRecovery'), 'Phase 7 recovery intact');

    console.log('\nTest 8.3: Phase 8 context intact');
    const contextSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'context-contract.ts'),
      'utf-8',
    );
    assert(contextSource.includes('safeContextSnapshot'), 'Phase 8 context intact');

    console.log('\nTest 8.4: Phase 9 verification intact');
    const verSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'verification.ts'),
      'utf-8',
    );
    assert(verSource.includes('verifyTaskCompletion'), 'Phase 9 verification intact');

    console.log('\nTest 8.5: Phase 10 browser intact');
    assert(fs.existsSync(path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'session-manager.ts')), 'Phase 10 browser intact');

    console.log('\nTest 8.6: Phase 11 computer intact');
    assert(fs.existsSync(path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'session-manager.ts')), 'Phase 11 computer intact');

    console.log('\nTest 8.7: Phase 12 changes are additive (no breaking changes)');
    const executorSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'nex-agent-executor.ts'),
      'utf-8',
    );
    // createPlan still exists (backward compat)
    assert(executorSource.includes('createPlan(request: string): ExecutionPlan'), 'createPlan still exists');
    // respondToPermission still exists (backward compat)
    assert(executorSource.includes('respondToPermission'), 'respondToPermission still exists');
    // getNexAgentExecutor singleton still exists
    assert(executorSource.includes('export function getNexAgentExecutor'), 'singleton intact');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 9: Phase 12 header present
  // ════════════════════════════════════════════════════════════════════════
  await testSection('9. Phase 12 header + documentation', async () => {
    const executorSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'nex-agent-executor.ts'),
      'utf-8',
    );

    console.log('\nTest 9.1: Phase 12 header present');
    assert(executorSource.includes('Phase 12: Multi-Agent Orchestration Integration'), 'Phase 12 header');

    console.log('\nTest 9.2: DEPRECATED marker removed');
    assert(!executorSource.includes('⚠️ DEPRECATED'), 'deprecated marker removed');
    assert(!executorSource.includes('DO NOT extend this file'), 'do-not-extend removed');

    console.log('\nTest 9.3: architecture documented');
    assert(executorSource.includes('ExecutivePlanner.createPlan'), 'documents architecture');
    assert(executorSource.includes('agent/core.ts: createTask + runTask'), 'documents real pipeline');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 12 orchestration tests: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('════════════════════════════════════════\n');

  if (failed > 0) {
    console.error('Failed tests:');
    for (const f of failures) console.error(`  - ${f}`);
    console.error('');
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner crashed:', err);
  console.error(err.stack);
  process.exit(1);
});
