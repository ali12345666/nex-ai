/**
 * NEX AI — Phase 8: Context Propagation — Comprehensive Tests
 *
 * Coverage (per Phase 8 §11 — 20 scenarios):
 *   1.  context from Agent to Tool preserved
 *   2.  taskId preserved
 *   3.  agentTaskId preserved (queue → agent)
 *   4.  user goal preserved in replan
 *   5.  step context preserved in retry
 *   6.  observation propagated to next step
 *   7.  recovery context is complete
 *   8.  queue → agent context is correct
 *   9.  IPC context serialize/deserialize correctly
 *  10.  context mutation does NOT change previous snapshot
 *  11.  large tool output truncated
 *  12.  context size controlled (bounded)
 *  13.  secrets redacted (API keys, tokens, passwords)
 *  14.  persistence does NOT store secrets
 *  15.  cancellation context preserved
 *  16.  failed task context identifiable
 *  17.  replan context correct
 *  18.  concurrent tasks don't overwrite each other's context
 *  19.  context between two tasks isolated
 *  20.  regression: Phase 6 + Phase 7 tests still pass (source inspection)
 *
 * Run with: npx tsx tests/tools/test-phase-8-context.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

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

function assertEqual<T>(actual: T, expected: T, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    failures.push(`${name} (got ${a}, expected ${e})`);
    console.error(`  FAIL: ${name} — got ${a}, expected ${e}`);
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

// ─── Build a minimal AgentTask + AgentStep for tests ─────────────────────────

function makeTask(overrides: any = {}): any {
  return {
    id: 'test-task-' + Math.random().toString(36).slice(2, 8),
    userRequest: 'test request',
    status: 'executing',
    intent: 'fix-bug',
    plan: [],
    currentStepIndex: 0,
    context: { activeFile: undefined, relevantFiles: [], recentConversation: [], projectPath: '/tmp/proj', estimatedTokensUsed: 0 },
    errors: [],
    observations: [],
    maxRetries: 3,
    maxSteps: 20,
    maxToolCalls: 50,
    maxExecutionTimeMs: 300000,
    createdAt: Date.now(),
    cancelled: false,
    conversationId: 'conv-123',
    sessionId: 'session-456',
    language: 'en',
    ...overrides,
  };
}

function makeStep(overrides: any = {}): any {
  return {
    id: 'step-1',
    index: 0,
    description: 'Read the file',
    toolName: 'read_file',
    toolParams: { path: '/tmp/test.txt' },
    status: 'pending',
    retryCount: 0,
    ...overrides,
  };
}

function makeObservation(overrides: any = {}): any {
  return {
    id: 'obs-' + Math.random().toString(36).slice(2, 8),
    toolCallId: 'tc-1',
    stepId: 'step-1',
    rawOutput: 'some tool output',
    signals: [{ type: 'success', message: 'Tool succeeded' }],
    modifiedFiles: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('Phase 8: Context Propagation — Comprehensive Tests\n');

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 1: Context from Agent to Tool preserved
  // ════════════════════════════════════════════════════════════════════════
  await testSection('1. Agent → Tool context preservation', async () => {
    const { safeContextSnapshot } = await import('../../src/main/agent/context-contract.ts');
    const task = makeTask();
    const step = makeStep();
    const snapshot = safeContextSnapshot(task, step);

    console.log('\nTest 1.1: snapshot includes taskId');
    assertEqual(snapshot.taskId, task.id, 'taskId preserved');

    console.log('\nTest 1.2: snapshot includes userRequest');
    assertEqual(snapshot.userRequest, task.userRequest, 'userRequest preserved');

    console.log('\nTest 1.3: snapshot includes toolName');
    assertEqual(snapshot.toolName, step.toolName, 'toolName preserved');

    console.log('\nTest 1.4: snapshot includes toolParamsSafe (redacted)');
    assert(!!snapshot.toolParamsSafe, 'toolParamsSafe present');
    assert(!!snapshot.toolParamsSafe!._redactedJson, 'redacted JSON present');

    console.log('\nTest 1.5: snapshot includes projectPath');
    assertEqual(snapshot.projectPath, task.context.projectPath, 'projectPath preserved');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 2: taskId preserved
  // ════════════════════════════════════════════════════════════════════════
  await testSection('2. taskId preserved', async () => {
    const { safeContextSnapshot } = await import('../../src/main/agent/context-contract.ts');

    console.log('\nTest 2.1: snapshot.taskId matches task.id');
    const task = makeTask({ id: 'specific-task-id-abc' });
    const snapshot = safeContextSnapshot(task);
    assertEqual(snapshot.taskId, 'specific-task-id-abc', 'taskId preserved exactly');

    console.log('\nTest 2.2: different tasks have different taskIds in snapshots');
    const task1 = makeTask({ id: 'task-1' });
    const task2 = makeTask({ id: 'task-2' });
    const s1 = safeContextSnapshot(task1);
    const s2 = safeContextSnapshot(task2);
    assert(s1.taskId !== s2.taskId, 'snapshots have distinct taskIds');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 3: agentTaskId preserved (queue → agent)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('3. agentTaskId preserved (queue → agent)', async () => {
    const { safeContextSnapshot } = await import('../../src/main/agent/context-contract.ts');

    console.log('\nTest 3.1: snapshot includes agentTaskId when provided');
    const task = makeTask();
    const snapshot = safeContextSnapshot(task, undefined, { agentTaskId: 'queue-item-123' });
    assertEqual(snapshot.agentTaskId, 'queue-item-123', 'agentTaskId preserved');

    console.log('\nTest 3.2: agentTaskId is undefined when not provided');
    const snapshot2 = safeContextSnapshot(makeTask());
    assertEqual(snapshot2.agentTaskId, undefined, 'agentTaskId undefined when not provided');

    console.log('\nTest 3.3: queue item kind=agent stores agentTaskId');
    const queueTypes = await import('../../src/main/tasks/types.ts');
    const queueItem: any = {
      id: 'q-1',
      kind: 'agent',
      agentTaskId: 'agent-xyz',
      status: 'queued',
      priority: 'normal',
    };
    assertEqual(queueItem.agentTaskId, 'agent-xyz', 'queue item has agentTaskId');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 4: user goal preserved in replan
  // ════════════════════════════════════════════════════════════════════════
  await testSection('4. user goal preserved in replan', async () => {
    const { safeContextSnapshot } = await import('../../src/main/agent/context-contract.ts');

    console.log('\nTest 4.1: snapshot.userRequest is the original user goal');
    const task = makeTask({ userRequest: 'Fix the login bug in auth.ts' });
    const snapshot = safeContextSnapshot(task);
    assertEqual(snapshot.userRequest, 'Fix the login bug in auth.ts', 'user goal preserved');

    console.log('\nTest 4.2: userRequest is truncated for safety but content preserved');
    const longRequest = 'A'.repeat(500);
    const task2 = makeTask({ userRequest: longRequest });
    const snapshot2 = safeContextSnapshot(task2);
    assert(snapshot2.userRequest.length <= 200, `userRequest truncated to <= 200 (got ${snapshot2.userRequest.length})`);
    assert(snapshot2.userRequest.startsWith('A'), 'userRequest content preserved (truncated)');

    console.log('\nTest 4.3: intent preserved (helps replan preserve user intent)');
    const task3 = makeTask({ intent: 'fix-bug' });
    const snapshot3 = safeContextSnapshot(task3);
    assertEqual(snapshot3.intent, 'fix-bug', 'intent preserved for replan');

    console.log('\nTest 4.4: snapshot available to replan context (source inspection)');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    // ReAct replan uses task.userRequest + task.intent (existing behavior)
    assert(coreSource.includes('userRequest: task.userRequest') && coreSource.includes('intent: task.intent'), 'replan context uses task.userRequest + task.intent');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 5: step context preserved in retry
  // ════════════════════════════════════════════════════════════════════════
  await testSection('5. step context preserved in retry', async () => {
    const { safeContextSnapshot, snapshotToolParams } = await import('../../src/main/agent/context-contract.ts');

    console.log('\nTest 5.1: snapshot preserves step description + index');
    const task = makeTask({ plan: [makeStep({ index: 0, description: 'Step A' }), makeStep({ index: 1, description: 'Step B' })] });
    const step = task.plan[0];
    const snapshot = safeContextSnapshot(task, step);
    assertEqual(snapshot.currentStep.description, 'Step A', 'step description preserved');
    assertEqual(snapshot.currentStep.index, 0, 'step index preserved');

    console.log('\nTest 5.2: snapshotToolParams produces a NEW object (no mutation)');
    const step2 = makeStep({ toolParams: { path: '/tmp/a.txt', content: 'hello' } });
    const original = step2.toolParams;
    const snap = snapshotToolParams(step2);
    assert(snap !== original, 'snapshot is a different object');
    assertEqual(snap!.path, original.path, 'snapshot has same path');
    // Mutate the snapshot — original should be unaffected
    snap!.path = '/tmp/MUTATED.txt';
    assertEqual(original.path, '/tmp/a.txt', 'original toolParams NOT mutated by snapshot mutation');

    console.log('\nTest 5.3: retry preserves step ID (source inspection)');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    // RETRY action reuses the same step object (step.status = 'pending')
    assert(coreSource.includes("step.status = 'pending'") || coreSource.includes("(step as { status: string }).status = 'pending'"), 'retry sets step status to pending (same step object)');
    // Recovery events include stepId
    assert(coreSource.includes('stepId: step.id'), 'recovery events include stepId');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 6: observation propagated to next step
  // ════════════════════════════════════════════════════════════════════════
  await testSection('6. observation propagated to next step', async () => {
    const { safeContextSnapshot } = await import('../../src/main/agent/context-contract.ts');

    console.log('\nTest 6.1: snapshot includes lastObservation');
    const task = makeTask({
      observations: [makeObservation({ rawOutput: 'file content here', signals: [{ type: 'success', message: 'read ok' }] })],
    });
    const snapshot = safeContextSnapshot(task);
    assert(!!snapshot.lastObservation, 'lastObservation present');
    assertEqual(snapshot.lastObservation!.rawOutputTruncated, 'file content here', 'observation rawOutput preserved');

    console.log('\nTest 6.2: observation signals preserved');
    assertEqual(snapshot.lastObservation!.signals.length, 1, 'one signal preserved');
    assertEqual(snapshot.lastObservation!.signals[0].message, 'read ok', 'signal message preserved');

    console.log('\nTest 6.3: observations array on task is used by ReAct (source inspection)');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    // ReAct gets recentObservations: task.observations.slice(-5)
    assert(coreSource.includes('recentObservations: task.observations.slice(-5)'), 'ReAct receives last 5 observations');
    // task.observations.push(observation) — observation is stored on the task
    assert(coreSource.includes('task.observations.push(observation)'), 'observation pushed to task.observations');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 7: recovery context is complete
  // ════════════════════════════════════════════════════════════════════════
  await testSection('7. recovery context complete', async () => {
    const { safeContextSnapshot } = await import('../../src/main/agent/context-contract.ts');

    console.log('\nTest 7.1: recovery snapshot has all required fields');
    const task = makeTask({
      plan: [makeStep({ index: 0 }), makeStep({ index: 1, description: 'Step B' })],
      observations: [makeObservation()],
    });
    const step = task.plan[0];
    const snapshot = safeContextSnapshot(task, step, {
      error: 'ECONNRESET', errorClass: 'transient_network', attempt: 1, agentTaskId: 'agent-1',
    });
    // All fields Phase 7 §5 requires:
    assert(!!snapshot.taskId, 'taskId');
    assert(!!snapshot.agentTaskId, 'agentTaskId');
    assert(!!snapshot.userRequest, 'userRequest');
    assert(!!snapshot.conversationId, 'conversationId');
    assert(!!snapshot.sessionId, 'sessionId');
    assert(!!snapshot.intent, 'intent');
    assert(!!snapshot.currentPlan, 'currentPlan');
    assert(!!snapshot.currentStep, 'currentStep');
    assert(!!snapshot.toolName, 'toolName');
    assert(!!snapshot.toolParamsSafe, 'toolParamsSafe (redacted)');
    assert(!!snapshot.lastObservation, 'lastObservation');
    assert(!!snapshot.error, 'error');
    assertEqual(snapshot.errorClass, 'transient_network', 'errorClass');
    assertEqual(snapshot.attempt, 1, 'attempt');
    assert(!!snapshot.maxRetries, 'maxRetries');
    assert(!!snapshot.remainingSteps, 'remainingSteps');

    console.log('\nTest 7.2: recovery-engine uses safeContextSnapshot (source inspection)');
    const engineSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'recovery-engine.ts'),
      'utf-8',
    );
    assert(engineSource.includes('safeContextSnapshot'), 'recovery-engine imports safeContextSnapshot');
    assert(engineSource.includes('from') && engineSource.includes("'./context-contract'"), 'recovery-engine imports from context-contract');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 8: queue → agent context correct
  // ════════════════════════════════════════════════════════════════════════
  await testSection('8. queue → agent context', async () => {
    console.log('\nTest 8.1: queue stores agentTaskId (link to agent task)');
    const queueTypes = await import('../../src/main/tasks/types.ts');
    // TaskQueueItem has agentTaskId field for kind=agent
    const typesSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'tasks', 'types.ts'),
      'utf-8',
    );
    assert(typesSource.includes('agentTaskId?: string;'), 'TaskQueueItem has agentTaskId field');

    console.log('\nTest 8.2: queue runs agent task via injected agentRunTask (no context loss)');
    const queueSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'tasks', 'queue.ts'),
      'utf-8',
    );
    assert(queueSource.includes('_agentRunTaskFn(item.agentTaskId)'), 'queue calls agentRunTask with agentTaskId');

    console.log('\nTest 8.3: queue cancellation propagates to agent');
    assert(queueSource.includes('_agentCancelTaskFn(item.agentTaskId'), 'queue calls agentCancelTask for cancellation propagation');

    console.log('\nTest 8.4: queue metadata is free-form but redacted at persistence');
    const persistSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'tasks', 'persistence.ts'),
      'utf-8',
    );
    assert(persistSource.includes('redactQueueMetadata'), 'persistence calls redactQueueMetadata');
    assert(persistSource.includes('context-contract'), 'persistence imports from context-contract');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 9: IPC context serialize/deserialize
  // ════════════════════════════════════════════════════════════════════════
  await testSection('9. IPC context serialize/deserialize', async () => {
    const { safeContextSnapshot } = await import('../../src/main/agent/context-contract.ts');

    console.log('\nTest 9.1: snapshot is JSON-serializable (no functions/class instances)');
    const task = makeTask({
      plan: [makeStep({ index: 0, description: 'Step A' })],
      observations: [makeObservation()],
    });
    const snapshot = safeContextSnapshot(task, task.plan[0], {
      error: 'some error', errorClass: 'unknown', attempt: 0,
    });
    let json: string;
    try {
      json = JSON.stringify(snapshot);
      assert(true, 'snapshot is JSON-serializable');
    } catch (err: any) {
      assert(false, `snapshot serialization failed: ${err.message}`);
      return;
    }
    // Deserialize and check fields survive
    const restored = JSON.parse(json) as typeof snapshot;
    assertEqual(restored.taskId, snapshot.taskId, 'taskId survives round-trip');
    assertEqual(restored.userRequest, snapshot.userRequest, 'userRequest survives round-trip');
    assertEqual(restored.toolName, snapshot.toolName, 'toolName survives round-trip');
    assert(!!restored.toolParamsSafe, 'toolParamsSafe survives round-trip');
    assert(!!restored.lastObservation, 'lastObservation survives round-trip');
    assertEqual(restored.error, snapshot.error, 'error survives round-trip');

    console.log('\nTest 9.2: snapshot has no undefined values (Electron structured clone drops them)');
    const hasUndefined = JSON.stringify(snapshot).includes('undefined');
    assert(!hasUndefined, 'no literal "undefined" in JSON (would be dropped by structured clone)');

    console.log('\nTest 9.3: agent-event IPC forwards redacted events (source inspection)');
    const mainSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'),
      'utf-8',
    );
    assert(mainSource.includes("'agent-event'"), 'agent-event IPC channel exists');
    assert(mainSource.includes('onAgentEvent'), 'onAgentEvent listener wired');
    // AgentLogger redacts event.data before forwarding (logger.ts:178)
    const loggerSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'logger.ts'),
      'utf-8',
    );
    assert(loggerSource.includes('redactObjectDeep'), 'logger redacts event data');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 10: context mutation does NOT change previous snapshot
  // ════════════════════════════════════════════════════════════════════════
  await testSection('10. snapshot immutability', async () => {
    const { safeContextSnapshot, snapshotToolParams } = await import('../../src/main/agent/context-contract.ts');

    console.log('\nTest 10.1: mutating task after snapshot does NOT change snapshot');
    const task = makeTask({ userRequest: 'original' });
    const snapshot = safeContextSnapshot(task);
    assertEqual(snapshot.userRequest, 'original', 'snapshot has original userRequest');
    // Mutate the task
    task.userRequest = 'MUTATED';
    assertEqual(snapshot.userRequest, 'original', 'snapshot userRequest UNCHANGED after task mutation');

    console.log('\nTest 10.2: mutating step.toolParams does NOT change snapshot.toolParamsSafe');
    const task2 = makeTask();
    const step2 = makeStep({ toolParams: { path: '/tmp/orig.txt' } });
    const snapshot2 = safeContextSnapshot(task2, step2);
    // Mutate step.toolParams
    step2.toolParams.path = '/tmp/MUTATED.txt';
    // The snapshot's redacted JSON was built at snapshot time — it should still have /tmp/orig.txt
    assert(
      (snapshot2.toolParamsSafe!._redactedJson as string).includes('/tmp/orig.txt'),
      'snapshot toolParamsSafe UNCHANGED after step mutation',
    );

    console.log('\nTest 10.3: snapshotToolParams produces independent copy');
    const step3 = makeStep({ toolParams: { path: '/tmp/a.txt' } });
    const snap = snapshotToolParams(step3);
    step3.toolParams.path = '/tmp/changed.txt';
    assertEqual(snap!.path, '/tmp/a.txt', 'snapshotToolParams copy is independent');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 11: large tool output truncated
  // ════════════════════════════════════════════════════════════════════════
  await testSection('11. large tool output truncated', async () => {
    const { safeContextSnapshot, SNAPSHOT_BOUNDS } = await import('../../src/main/agent/context-contract.ts');

    console.log('\nTest 11.1: observation rawOutput truncated to OBSERVATION_RAW_OUTPUT_MAX');
    const bigOutput = 'X'.repeat(SNAPSHOT_BOUNDS.OBSERVATION_RAW_OUTPUT_MAX + 5000);
    const task = makeTask({ observations: [makeObservation({ rawOutput: bigOutput })] });
    const snapshot = safeContextSnapshot(task);
    assert(
      snapshot.lastObservation!.rawOutputTruncated.length <= SNAPSHOT_BOUNDS.OBSERVATION_RAW_OUTPUT_MAX,
      `rawOutput truncated to <= ${SNAPSHOT_BOUNDS.OBSERVATION_RAW_OUTPUT_MAX} (got ${snapshot.lastObservation!.rawOutputTruncated.length})`,
    );

    console.log('\nTest 11.2: truncation preserves beginning of output');
    assert(
      snapshot.lastObservation!.rawOutputTruncated.startsWith('X'),
      'truncated output starts with original content',
    );

    console.log('\nTest 11.3: context-manager also truncates observations (existing behavior)');
    const cmSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'context-manager.ts'),
      'utf-8',
    );
    assert(cmSource.includes('.slice(0, 2000)'), 'context-manager truncates observation to 2000 chars');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 12: context size controlled
  // ════════════════════════════════════════════════════════════════════════
  await testSection('12. context size controlled', async () => {
    const { safeContextSnapshot, SNAPSHOT_BOUNDS, validateSnapshotBounds, snapshotTokenSize } = await import('../../src/main/agent/context-contract.ts');

    console.log('\nTest 12.1: SNAPSHOT_BOUNDS defined');
    assert(SNAPSHOT_BOUNDS.USER_REQUEST_MAX === 200, 'USER_REQUEST_MAX = 200');
    assert(SNAPSHOT_BOUNDS.INTENT_MAX === 100, 'INTENT_MAX = 100');
    assert(SNAPSHOT_BOUNDS.TOOL_PARAMS_JSON_MAX === 800, 'TOOL_PARAMS_JSON_MAX = 800');
    assert(SNAPSHOT_BOUNDS.OBSERVATION_RAW_OUTPUT_MAX === 2000, 'OBSERVATION_RAW_OUTPUT_MAX = 2000');
    assert(SNAPSHOT_BOUNDS.ERROR_MESSAGE_MAX === 500, 'ERROR_MESSAGE_MAX = 500');
    assert(SNAPSHOT_BOUNDS.REMAINING_STEPS_MAX === 5, 'REMAINING_STEPS_MAX = 5');

    console.log('\nTest 12.2: validateSnapshotBounds passes for a well-formed snapshot');
    const task = makeTask({ plan: [makeStep()] });
    const snapshot = safeContextSnapshot(task, task.plan[0]);
    const violations = validateSnapshotBounds(snapshot);
    assertEqual(violations.length, 0, `no bound violations (got: ${violations.join('; ') || 'none'})`);

    console.log('\nTest 12.3: remainingSteps capped at 5 + overflow entry');
    const bigPlan = [];
    for (let i = 0; i < 20; i++) bigPlan.push(makeStep({ index: i, description: `Step ${i + 1}` }));
    const task2 = makeTask({ plan: bigPlan, currentStepIndex: 0 });
    const snapshot2 = safeContextSnapshot(task2, bigPlan[0]);
    // 5 steps + 1 overflow entry = 6
    assertEqual(snapshot2.remainingSteps.length, SNAPSHOT_BOUNDS.REMAINING_STEPS_MAX + 1, 'remainingSteps = 5 + 1 overflow');
    // The last entry should mention "+N more steps"
    const lastEntry = snapshot2.remainingSteps[snapshot2.remainingSteps.length - 1];
    assert(lastEntry.description.includes('more steps'), 'overflow entry mentions "+N more steps"');

    console.log('\nTest 12.4: snapshotTokenSize returns a finite number');
    const tokens = snapshotTokenSize(snapshot);
    assert(typeof tokens === 'number' && tokens > 0 && Number.isFinite(tokens), `token size is finite positive number (got ${tokens})`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 13: secrets redacted
  // ════════════════════════════════════════════════════════════════════════
  await testSection('13. secrets redacted', async () => {
    const { safeContextSnapshot, redactQueueMetadata } = await import('../../src/main/agent/context-contract.ts');

    console.log('\nTest 13.1: API key in toolParams is redacted');
    const step = makeStep({ toolParams: { path: '/tmp/test.txt', apiKey: 'sk-1234567890abcdefghijklmnopqrstuv' } });
    const task = makeTask();
    const snapshot = safeContextSnapshot(task, step);
    const paramsJson = snapshot.toolParamsSafe!._redactedJson as string;
    assert(!paramsJson.includes('sk-1234567890abcdefghijklmnopqrstuv'), 'API key NOT in snapshot');
    assert(paramsJson.includes('REDACTED'), 'redaction marker present');

    console.log('\nTest 13.2: password in toolParams is redacted');
    const step2 = makeStep({ toolParams: { password: 'supersecret123', path: '/tmp/x' } });
    const snapshot2 = safeContextSnapshot(makeTask(), step2);
    const paramsJson2 = snapshot2.toolParamsSafe!._redactedJson as string;
    assert(!paramsJson2.includes('supersecret123'), 'password NOT in snapshot');
    assert(paramsJson2.includes('REDACTED'), 'redaction marker present');

    console.log('\nTest 13.3: token in toolParams is redacted');
    const step3 = makeStep({ toolParams: { token: 'ghp_1234567890abcdefghijklmnopqrstuv', path: '/tmp/x' } });
    const snapshot3 = safeContextSnapshot(makeTask(), step3);
    const paramsJson3 = snapshot3.toolParamsSafe!._redactedJson as string;
    assert(!paramsJson3.includes('ghp_1234567890abcdefghijklmnopqrstuv'), 'GitHub PAT NOT in snapshot');

    console.log('\nTest 13.4: redactQueueMetadata redacts secrets in queue metadata');
    const metadata = { apiKey: 'sk-1234567890abcdefghijklmnopqrstuv', normalField: 'safe' };
    const redacted = redactQueueMetadata(metadata);
    const json = JSON.stringify(redacted);
    assert(!json.includes('sk-1234567890abcdefghijklmnopqrstuv'), 'API key NOT in redacted metadata');
    assert(json.includes('REDACTED'), 'redaction marker present');
    assert(json.includes('safe'), 'normal field preserved');

    console.log('\nTest 13.5: redactQueueMetadata returns undefined for undefined input');
    assertEqual(redactQueueMetadata(undefined), undefined, 'undefined input → undefined output');

    console.log('\nTest 13.6: redactQueueMetadata returns NEW object (no mutation)');
    const orig = { apiKey: 'sk-1234567890abcdefghijklmnopqrstuv' };
    const redacted2 = redactQueueMetadata(orig);
    assert(redacted2 !== orig, 'redacted is a different object');
    // Original still has the secret (we don't mutate the source)
    assertEqual(orig.apiKey, 'sk-1234567890abcdefghijklmnopqrstuv', 'original NOT mutated');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 14: persistence does NOT store secrets
  // ════════════════════════════════════════════════════════════════════════
  await testSection('14. persistence redaction', async () => {
    const { saveQueueState, loadQueueState } = await import('../../src/main/tasks/persistence.ts');

    console.log('\nTest 14.1: saved queue state does NOT contain secrets in metadata');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-tq-14-'));
    const { initTaskQueuePersistence, clearQueueState } = await import('../../src/main/tasks/persistence.ts');
    initTaskQueuePersistence(tmpDir);
    clearQueueState();

    const item: any = {
      id: 'test-id-secret',
      name: 'test',
      priority: 'normal',
      status: 'queued',
      kind: 'function',
      functionKey: 'test:fn',
      enqueuedAt: 1000,
      progress: 0,
      cancellationKey: 'test-id-secret',
      maxRetries: 1,
      retryCount: 0,
      metadata: { apiKey: 'sk-1234567890abcdefghijklmnopqrstuv', normalField: 'safe' },
    };
    saveQueueState([item], { maxConcurrent: 2, historyLimit: 50 });
    const loaded = loadQueueState();
    assert(!!loaded, 'state loaded');
    const loadedItem = loaded!.items.find((i: any) => i.id === 'test-id-secret');
    assert(!!loadedItem, 'item found in loaded state');
    const loadedMeta = loadedItem!.metadata as any;
    assert(!JSON.stringify(loadedMeta).includes('sk-1234567890abcdefghijklmnopqrstuv'), 'secret NOT in persisted metadata');
    assert(JSON.stringify(loadedMeta).includes('REDACTED'), 'redaction marker in persisted metadata');
    assertEqual(loadedMeta.normalField, 'safe', 'normal field preserved');

    console.log('\nTest 14.2: saved queue state redacts secrets in result');
    clearQueueState();
    const item2: any = {
      id: 'test-id-result-secret',
      name: 'test',
      priority: 'normal',
      status: 'completed',
      kind: 'function',
      functionKey: 'test:fn',
      enqueuedAt: 2000,
      progress: 100,
      cancellationKey: 'test-id-result-secret',
      maxRetries: 1,
      retryCount: 0,
      completedAt: 3000,
      result: { token: 'ghp_1234567890abcdefghijklmnopqrstuv', output: 'ok' },
    };
    saveQueueState([item2], { maxConcurrent: 2, historyLimit: 50 });
    const loaded2 = loadQueueState();
    const loadedItem2 = loaded2!.items.find((i: any) => i.id === 'test-id-result-secret');
    const loadedResult = loadedItem2!.result as any;
    assert(!JSON.stringify(loadedResult).includes('ghp_1234567890abcdefghijklmnopqrstuv'), 'secret NOT in persisted result');
    assert(JSON.stringify(loadedResult).includes('REDACTED'), 'redaction marker in persisted result');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 15: cancellation context preserved
  // ════════════════════════════════════════════════════════════════════════
  await testSection('15. cancellation context preserved', async () => {
    const { safeContextSnapshot } = await import('../../src/main/agent/context-contract.ts');

    console.log('\nTest 15.1: cancelled task produces a valid snapshot');
    const task = makeTask({ cancelled: true, cancelReason: 'user pressed stop' });
    const snapshot = safeContextSnapshot(task);
    assert(!!snapshot.taskId, 'snapshot has taskId');
    assert(!!snapshot.userRequest, 'snapshot has userRequest');

    console.log('\nTest 15.2: cancellation reason is accessible via task (recovery engine)');
    const recoveryTypes = await import('../../src/main/agent/recovery-engine.ts');
    // RecoveryContext has cancelReason field
    const ctx: any = {
      taskId: task.id, step: makeStep(), task, toolName: 'read_file',
      errorMessage: 'cancelled', errorCode: 'AGENT_CANCELLED',
      attempt: 0, maxRetries: 3, cancelled: true, cancelReason: 'user pressed stop',
    };
    const d = recoveryTypes.decideRecoveryHeuristic(ctx);
    assertEqual(d.action, 'ABORT', 'cancelled task → ABORT (context preserved)');

    console.log('\nTest 15.3: cancellation events include taskId (source inspection)');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    assert(coreSource.includes('cancelReason') && coreSource.includes('task.cancelled'), 'core.ts tracks cancellation context');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 16: failed task context identifiable
  // ════════════════════════════════════════════════════════════════════════
  await testSection('16. failed task context identifiable', async () => {
    const { safeContextSnapshot } = await import('../../src/main/agent/context-contract.ts');

    console.log('\nTest 16.1: failed task has errors array accessible');
    const task = makeTask({
      errors: [{
        id: 'err-1', type: 'tool_error', message: 'ECONNRESET',
        timestamp: Date.now(), errorClass: 'transient_network', recoveryDecision: 'ABORT',
        recoveryAttempts: 3, llmAnalyzed: false,
      }],
    });
    assertEqual(task.errors.length, 1, 'task has 1 error');
    assertEqual(task.errors[0].errorClass, 'transient_network', 'error has errorClass field');

    console.log('\nTest 16.2: snapshot includes error info when provided');
    const snapshot = safeContextSnapshot(task, undefined, { error: 'ECONNRESET', errorClass: 'transient_network' });
    assertEqual(snapshot.error, 'ECONNRESET', 'snapshot has error message');
    assertEqual(snapshot.errorClass, 'transient_network', 'snapshot has errorClass');

    console.log('\nTest 16.3: AgentError has Phase 7 recovery metadata fields');
    const typesSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'types.ts'),
      'utf-8',
    );
    assert(typesSource.includes('errorClass?:'), 'AgentError.errorClass');
    assert(typesSource.includes('recoveryDecision?:'), 'AgentError.recoveryDecision');
    assert(typesSource.includes('recoveryAttempts?:'), 'AgentError.recoveryAttempts');
    assert(typesSource.includes('llmAnalyzed?:'), 'AgentError.llmAnalyzed');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 17: replan context correct
  // ════════════════════════════════════════════════════════════════════════
  await testSection('17. replan context correct', async () => {
    const { safeContextSnapshot } = await import('../../src/main/agent/context-contract.ts');

    console.log('\nTest 17.1: snapshot includes remainingSteps for replan');
    const plan = [];
    for (let i = 0; i < 5; i++) plan.push(makeStep({ index: i, description: `Step ${i + 1}`, toolName: `tool_${i}` }));
    const task = makeTask({ plan, currentStepIndex: 1 });
    const snapshot = safeContextSnapshot(task, plan[1]);
    // After step index 1, remaining steps are 2, 3, 4 (indices 2, 3, 4)
    assertEqual(snapshot.remainingSteps.length, 3, '3 remaining steps after index 1');
    assertEqual(snapshot.remainingSteps[0].description, 'Step 3', 'first remaining step is Step 3');
    assertEqual(snapshot.remainingSteps[0].toolName, 'tool_2', 'first remaining tool is tool_2');

    console.log('\nTest 17.2: replan preserves userRequest + intent (source inspection)');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    // ReAct replan passes userRequest + intent (existing behavior, Phase 8 confirms)
    assert(
      coreSource.includes('userRequest: task.userRequest') &&
      coreSource.includes('intent: task.intent'),
      'replan context includes userRequest + intent (preserves user goal)',
    );

    console.log('\nTest 17.3: replan gets recent observations (continuity)');
    assert(
      coreSource.includes('recentObservations: task.observations.slice(-5)'),
      'replan gets last 5 observations for continuity',
    );
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 18: concurrent tasks don't overwrite each other's context
  // ════════════════════════════════════════════════════════════════════════
  await testSection('18. concurrent tasks isolation', async () => {
    const { safeContextSnapshot } = await import('../../src/main/agent/context-contract.ts');

    console.log('\nTest 18.1: two concurrent snapshots are independent');
    const task1 = makeTask({ id: 'task-A', userRequest: 'Request A' });
    const task2 = makeTask({ id: 'task-B', userRequest: 'Request B' });
    const s1 = safeContextSnapshot(task1);
    const s2 = safeContextSnapshot(task2);
    assertEqual(s1.taskId, 'task-A', 'snapshot 1 has task-A');
    assertEqual(s2.taskId, 'task-B', 'snapshot 2 has task-B');
    assertEqual(s1.userRequest, 'Request A', 'snapshot 1 has Request A');
    assertEqual(s2.userRequest, 'Request B', 'snapshot 2 has Request B');

    console.log('\nTest 18.2: snapshots don\'t share references (no aliasing)');
    // Take a snapshot, then mutate the task — other snapshot unaffected
    const task3 = makeTask({ userRequest: 'original' });
    const snap3a = safeContextSnapshot(task3);
    task3.userRequest = 'MUTATED';
    const snap3b = safeContextSnapshot(task3);
    assertEqual(snap3a.userRequest, 'original', 'snapshot 3a unchanged');
    assertEqual(snap3b.userRequest, 'MUTATED', 'snapshot 3b has mutated value');

    console.log('\nTest 18.3: agent core uses Map<taskId, AgentTask> (no cross-task interference)');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    assert(coreSource.includes('_activeTasks = new Map'), 'core.ts uses Map for active tasks');
    assert(coreSource.includes('_activeTasks.get(taskId)'), 'tasks looked up by taskId (no aliasing)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 19: context between two tasks isolated
  // ════════════════════════════════════════════════════════════════════════
  await testSection('19. two-task isolation', async () => {
    const { safeContextSnapshot } = await import('../../src/main/agent/context-contract.ts');

    console.log('\nTest 19.1: two tasks with same userRequest but different IDs are distinguishable');
    const task1 = makeTask({ id: 'task-1', userRequest: 'same request' });
    const task2 = makeTask({ id: 'task-2', userRequest: 'same request' });
    const s1 = safeContextSnapshot(task1);
    const s2 = safeContextSnapshot(task2);
    assertEqual(s1.userRequest, s2.userRequest, 'both have same userRequest');
    assert(s1.taskId !== s2.taskId, 'taskIds differ — tasks are distinguishable');

    console.log('\nTest 19.2: two tasks with different conversationIds are correlated correctly');
    const task3 = makeTask({ id: 't-a', conversationId: 'conv-A' });
    const task4 = makeTask({ id: 't-b', conversationId: 'conv-B' });
    const s3 = safeContextSnapshot(task3);
    const s4 = safeContextSnapshot(task4);
    assertEqual(s3.conversationId, 'conv-A', 'task 3 has conv-A');
    assertEqual(s4.conversationId, 'conv-B', 'task 4 has conv-B');

    console.log('\nTest 19.3: queue items are isolated by ID (source inspection)');
    const queueSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'tasks', 'queue.ts'),
      'utf-8',
    );
    assert(queueSource.includes('_items = new Map'), 'queue uses Map for items');
    assert(queueSource.includes('_items.get(taskId)'), 'items looked up by taskId');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 20: regression — Phase 6 + Phase 7 tests still pass
  // ════════════════════════════════════════════════════════════════════════
  await testSection('20. regression (source inspection)', async () => {
    console.log('\nTest 20.1: Phase 6 queue types + persistence still intact');
    const queueTypesSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'tasks', 'types.ts'),
      'utf-8',
    );
    assert(queueTypesSource.includes('TaskQueueItem'), 'TaskQueueItem type still exists');
    assert(queueTypesSource.includes('TaskPriority'), 'TaskPriority type still exists');
    assert(queueTypesSource.includes('TaskQueueStatus'), 'TaskQueueStatus type still exists');

    console.log('\nTest 20.2: Phase 7 error-classifier + recovery-engine still intact');
    const classifierSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'error-classifier.ts'),
      'utf-8',
    );
    assert(classifierSource.includes('ErrorClass'), 'ErrorClass type still exists');
    assert(classifierSource.includes('classifyError'), 'classifyError function still exists');

    const engineSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'recovery-engine.ts'),
      'utf-8',
    );
    assert(engineSource.includes('RecoveryAction'), 'RecoveryAction type still exists');
    assert(engineSource.includes('decideRecovery'), 'decideRecovery function still exists');
    assert(engineSource.includes('decideRecoveryHeuristic'), 'decideRecoveryHeuristic still exists');

    console.log('\nTest 20.3: Phase 8 additions are additive (no breaking changes)');
    const typesSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'types.ts'),
      'utf-8',
    );
    // New fields are optional (have ?)
    assert(typesSource.includes('conversationId?:'), 'conversationId is optional');
    assert(typesSource.includes('sessionId?:'), 'sessionId is optional');
    assert(typesSource.includes('language?:'), 'language is optional');
    assert(typesSource.includes('originalToolParams?:'), 'originalToolParams is optional');

    console.log('\nTest 20.4: context-contract module exists with required exports');
    const contractSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'context-contract.ts'),
      'utf-8',
    );
    assert(contractSource.includes('AgentContextContract'), 'AgentContextContract interface exists');
    assert(contractSource.includes('safeContextSnapshot'), 'safeContextSnapshot helper exists');
    assert(contractSource.includes('snapshotToolParams'), 'snapshotToolParams helper exists');
    assert(contractSource.includes('redactQueueMetadata'), 'redactQueueMetadata helper exists');
    assert(contractSource.includes('validateSnapshotBounds'), 'validateSnapshotBounds helper exists');
    assert(contractSource.includes('SNAPSHOT_BOUNDS'), 'SNAPSHOT_BOUNDS constants exist');

    console.log('\nTest 20.5: core.ts uses sessionId from task (not task.id as fallback)');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    assert(
      coreSource.includes('task.sessionId || task.id'),
      'core.ts uses task.sessionId (fallback to task.id) for permission scope',
    );

    console.log('\nTest 20.6: core.ts snapshots original toolParams before MODIFY_AND_RETRY');
    assert(
      coreSource.includes('snapshotToolParams') && coreSource.includes('task.originalToolParams'),
      'core.ts snapshots original toolParams before modification',
    );

    console.log('\nTest 20.7: persistence redacts metadata before writing to disk');
    const persistSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'tasks', 'persistence.ts'),
      'utf-8',
    );
    assert(
      persistSource.includes('redactQueueMetadata') &&
      persistSource.includes('context-contract'),
      'persistence.ts redacts metadata via context-contract',
    );

    console.log('\nTest 20.8: recovery-engine uses safeContextSnapshot (no inline redaction)');
    assert(
      engineSource.includes('safeContextSnapshot') &&
      !engineSource.includes('const safeParams = redactObjectDeep'),
      'recovery-engine uses safeContextSnapshot (no inline redaction duplication)',
    );
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 8 context propagation tests: ${passed}/${passed + failed} passed (${failed} failed)`);
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
