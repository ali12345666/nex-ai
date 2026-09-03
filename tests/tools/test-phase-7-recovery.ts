/**
 * NEX AI — Phase 7: LLM Error Recovery — Comprehensive Tests
 *
 * Coverage (per Phase 7 §13):
 *   1. Error classification (10 classes)
 *   2. Transient retry
 *   3. Exponential backoff
 *   4. Permanent error (no retry)
 *   5. Permission/security rejection
 *   6. Cancellation (never retry)
 *   7. Max retry
 *   8. MODIFY_AND_RETRY
 *   9. REPLAN
 *  10. SKIP
 *  11. ABORT
 *  12. LLM analysis fallback
 *  13. Offline behavior (no LLM available)
 *  14. Context propagation (redacted)
 *  15. Verification (post-recovery)
 *  16. Queue integration (source inspection)
 *  17. Orb integration (event mapping)
 *  18. Race conditions
 *  19. Failure isolation
 *  20. Memory recording
 *  21. Agent core integration (handleStepFailure)
 *  22. Safety guards (LLM can't bypass permission/security)
 *
 * Run with: npx tsx tests/tools/test-phase-7-recovery.ts
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
    plan: [],
    currentStepIndex: 0,
    context: { activeFile: undefined, relevantFiles: [], recentConversation: [] },
    errors: [],
    observations: [],
    maxRetries: 3,
    maxSteps: 20,
    maxToolCalls: 50,
    createdAt: Date.now(),
    cancelled: false,
    ...overrides,
  };
}

function makeStep(overrides: any = {}): any {
  return {
    id: 'step-1',
    index: 0,
    description: 'Test step',
    toolName: 'read_file',
    toolParams: { path: '/tmp/test.txt' },
    status: 'pending',
    retryCount: 0,
    ...overrides,
  };
}

function makeCtx(overrides: any = {}): any {
  const task = makeTask();
  const step = makeStep();
  return {
    taskId: task.id,
    step,
    task,
    toolName: step.toolName,
    errorMessage: 'test error',
    errorCode: 'TOOL_FAILURE',
    attempt: 0,
    maxRetries: task.maxRetries,
    cancelled: false,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('Phase 7: LLM Error Recovery — Comprehensive Tests\n');

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 1: Error Classification (10 classes)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('1. Error Classification', async () => {
    const { classifyError } = await import('../../src/main/agent/error-classifier.ts');

    console.log('\nTest 1.1: user_cancellation (via code)');
    let c = classifyError('some error', 'AGENT_CANCELLED');
    assertEqual(c.class, 'user_cancellation', 'AGENT_CANCELLED → user_cancellation');
    assertEqual(c.neverRetry, true, 'cancellation neverRetry');
    assertEqual(c.retryable, false, 'cancellation not retryable');

    console.log('\nTest 1.2: user_cancellation (via message)');
    c = classifyError('Agent cancelled by user');
    assertEqual(c.class, 'user_cancellation', 'message "Agent cancelled" → user_cancellation');

    console.log('\nTest 1.3: security_policy');
    c = classifyError('blocked: command not allowed');
    assertEqual(c.class, 'security_policy', '"blocked:" → security_policy');
    assertEqual(c.neverRetry, true, 'security_policy neverRetry');
    assertEqual(c.retryable, false, 'security_policy not retryable');

    console.log('\nTest 1.4: permission_denied');
    c = classifyError('permission denied by user');
    assertEqual(c.class, 'permission_denied', '"permission denied" → permission_denied');
    assertEqual(c.neverRetry, true, 'permission_denied neverRetry');
    assertEqual(c.retryable, false, 'permission_denied not retryable');

    console.log('\nTest 1.5: invalid_arguments');
    c = classifyError('missing required parameter: path');
    assertEqual(c.class, 'invalid_arguments', '"missing required parameter" → invalid_arguments');
    assertEqual(c.neverRetry, false, 'invalid_arguments can be retried after fix');

    console.log('\nTest 1.6: file_path');
    c = classifyError('ENOENT: no such file or directory');
    assertEqual(c.class, 'file_path', 'ENOENT → file_path');
    c = classifyError('file not found: /tmp/missing.txt');
    assertEqual(c.class, 'file_path', '"file not found" → file_path');
    c = classifyError('module not found: ./lib/foo');
    assertEqual(c.class, 'file_path', '"module not found" → file_path');

    console.log('\nTest 1.7: model_inference');
    c = classifyError('JSON parse error: unexpected token');
    assertEqual(c.class, 'model_inference', '"JSON parse error" → model_inference');
    c = classifyError('context too large: exceeds 4096 tokens');
    assertEqual(c.class, 'model_inference', '"context too large" → model_inference');

    console.log('\nTest 1.8: timeout');
    c = classifyError('operation timed out after 5000ms');
    assertEqual(c.class, 'timeout', '"timed out" → timeout');
    assertEqual(c.retryable, true, 'timeout retryable');

    console.log('\nTest 1.9: transient_network');
    c = classifyError('ECONNRESET: socket hang up');
    assertEqual(c.class, 'transient_network', 'ECONNRESET → transient_network');
    assertEqual(c.retryable, true, 'transient_network retryable');

    c = classifyError('EBUSY: resource temporarily unavailable');
    assertEqual(c.class, 'transient_network', 'EBUSY → transient_network');

    console.log('\nTest 1.10: tool_failure (via code)');
    c = classifyError('custom tool failure message', 'TOOL_FAILURE');
    assertEqual(c.class, 'tool_failure', 'code TOOL_FAILURE → tool_failure');
    assertEqual(c.retryable, true, 'tool_failure retryable (once)');

    console.log('\nTest 1.11: unknown (no pattern matches)');
    c = classifyError('some random weird error');
    assertEqual(c.class, 'unknown', 'no match → unknown');
    assertEqual(c.retryable, true, 'unknown retryable (once)');

    console.log('\nTest 1.12: priority — cancellation beats everything');
    c = classifyError('permission denied', 'AGENT_CANCELLED');
    assertEqual(c.class, 'user_cancellation', 'cancellation wins over permission');

    c = classifyError('blocked: security', 'AGENT_CANCELLED');
    assertEqual(c.class, 'user_cancellation', 'cancellation wins over security');

    console.log('\nTest 1.13: priority — security beats permission');
    c = classifyError('blocked: security policy');
    assertEqual(c.class, 'security_policy', 'security beats permission (more specific)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 2: Transient Retry
  // ════════════════════════════════════════════════════════════════════════
  await testSection('2. Transient Retry', async () => {
    const { decideRecoveryHeuristic } = await import('../../src/main/agent/recovery-engine.ts');

    console.log('\nTest 2.1: transient_network → RETRY');
    const ctx = makeCtx({ errorMessage: 'ECONNRESET', attempt: 0, maxRetries: 3 });
    const d = decideRecoveryHeuristic(ctx);
    assertEqual(d.action, 'RETRY', 'transient → RETRY');
    assert(d.backoffMs > 0, 'backoff > 0');
    assertEqual(d.errorClass, 'transient_network', 'errorClass preserved');
    assertEqual(d.llmAnalyzed, false, 'heuristic (not LLM)');

    console.log('\nTest 2.2: timeout → RETRY');
    const ctx2 = makeCtx({ errorMessage: 'timed out after 5000ms', attempt: 0, maxRetries: 3 });
    const d2 = decideRecoveryHeuristic(ctx2);
    assertEqual(d2.action, 'RETRY', 'timeout → RETRY');
    assertEqual(d2.errorClass, 'timeout', 'errorClass = timeout');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 3: Exponential Backoff
  // ════════════════════════════════════════════════════════════════════════
  await testSection('3. Exponential Backoff', async () => {
    const { _internal } = await import('../../src/main/agent/recovery-engine.ts');

    console.log('\nTest 3.1: backoff grows exponentially');
    const b0 = _internal.exponentialBackoff(0, 'transient_network');
    const b1 = _internal.exponentialBackoff(1, 'transient_network');
    const b2 = _internal.exponentialBackoff(2, 'transient_network');
    // b0 ≈ 400+jitter, b1 ≈ 800+jitter, b2 ≈ 1600+jitter (with jitter 0-119)
    assert(b0 >= 400 && b0 < 600, `backoff(0) ~400-520 (got ${b0})`);
    assert(b1 >= 800 && b1 < 1000, `backoff(1) ~800-920 (got ${b1})`);
    assert(b2 >= 1600 && b2 < 1800, `backoff(2) ~1600-1720 (got ${b2})`);

    console.log('\nTest 3.2: backoff caps at 5000ms');
    const b10 = _internal.exponentialBackoff(10, 'transient_network');
    assert(b10 <= 5120, `backoff(10) <= 5120 (cap 5000 + jitter 120, got ${b10})`);

    console.log('\nTest 3.3: timeout gets longer base (2x)');
    const tb0 = _internal.exponentialBackoff(0, 'timeout');
    assert(tb0 >= 800, `timeout backoff(0) >= 800 (got ${tb0})`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 4: Permanent Error (no retry)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('4. Permanent Error', async () => {
    const { decideRecoveryHeuristic } = await import('../../src/main/agent/recovery-engine.ts');

    console.log('\nTest 4.1: file_path → REPLAN (not RETRY)');
    const ctx = makeCtx({ errorMessage: 'ENOENT: no such file', attempt: 0, maxRetries: 3 });
    const d = decideRecoveryHeuristic(ctx);
    assertEqual(d.action, 'REPLAN', 'file_path → REPLAN');
    assertEqual(d.errorClass, 'file_path', 'errorClass preserved');

    console.log('\nTest 4.2: file_path on last step → REPLAN still (not ABORT)');
    const task = makeTask({ plan: [makeStep({ index: 0 })], currentStepIndex: 0 });
    const ctx2 = makeCtx({
      task, errorMessage: 'file not found', attempt: 0,
    });
    const d2 = decideRecoveryHeuristic(ctx2);
    assertEqual(d2.action, 'REPLAN', 'file_path last step → REPLAN');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 5: Permission/Security Rejection
  // ════════════════════════════════════════════════════════════════════════
  await testSection('5. Permission/Security Rejection', async () => {
    const { decideRecoveryHeuristic } = await import('../../src/main/agent/recovery-engine.ts');

    console.log('\nTest 5.1: permission_denied → SKIP (more steps remain)');
    const task = makeTask({ plan: [makeStep(), makeStep({ index: 1 })], currentStepIndex: 0 });
    const ctx = makeCtx({ task, errorMessage: 'permission denied by user', attempt: 0 });
    const d = decideRecoveryHeuristic(ctx);
    assertEqual(d.action, 'SKIP', 'permission_denied with more steps → SKIP');
    assertEqual(d.errorClass, 'permission_denied', 'errorClass preserved');

    console.log('\nTest 5.2: permission_denied on last step → ABORT');
    const task2 = makeTask({ plan: [makeStep({ index: 0 })], currentStepIndex: 0 });
    const ctx2 = makeCtx({ task: task2, errorMessage: 'permission denied', attempt: 0 });
    const d2 = decideRecoveryHeuristic(ctx2);
    assertEqual(d2.action, 'ABORT', 'permission_denied last step → ABORT');

    console.log('\nTest 5.3: security_policy → SKIP (more steps remain)');
    const task3 = makeTask({ plan: [makeStep(), makeStep({ index: 1 })], currentStepIndex: 0 });
    const ctx3 = makeCtx({ task: task3, errorMessage: 'blocked: command not allowed', attempt: 0 });
    const d3 = decideRecoveryHeuristic(ctx3);
    assertEqual(d3.action, 'SKIP', 'security_policy → SKIP');

    console.log('\nTest 5.4: security_policy on last step → ABORT');
    const task4 = makeTask({ plan: [makeStep({ index: 0 })], currentStepIndex: 0 });
    const ctx4 = makeCtx({ task: task4, errorMessage: 'blocked: security policy rejected', attempt: 0 });
    const d4 = decideRecoveryHeuristic(ctx4);
    assertEqual(d4.action, 'ABORT', 'security_policy last step → ABORT');

    console.log('\nTest 5.5: permission/security NEVER RETRY even with retries left');
    const task5 = makeTask({ plan: [makeStep(), makeStep({ index: 1 })], currentStepIndex: 0 });
    const ctx5 = makeCtx({ task: task5, errorMessage: 'permission denied', attempt: 0, maxRetries: 5 });
    const d5 = decideRecoveryHeuristic(ctx5);
    assert(d5.action !== 'RETRY' && d5.action !== 'MODIFY_AND_RETRY', 'permission_denied never RETRY/MODIFY');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 6: Cancellation (never retry)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('6. Cancellation', async () => {
    const { decideRecoveryHeuristic } = await import('../../src/main/agent/recovery-engine.ts');

    console.log('\nTest 6.1: cancelled task → ABORT (regardless of error)');
    const task = makeTask({ cancelled: true, cancelReason: 'user pressed stop' });
    const ctx = makeCtx({
      task, errorMessage: 'some transient error', errorCode: 'AGENT_CANCELLED',
    });
    const d = decideRecoveryHeuristic(ctx);
    assertEqual(d.action, 'ABORT', 'cancelled → ABORT');
    assertEqual(d.errorClass, 'user_cancellation', 'errorClass = user_cancellation');

    console.log('\nTest 6.2: cancellation never RETRY');
    assert(d.action !== 'RETRY', 'cancellation never RETRY');
    assert(d.action !== 'MODIFY_AND_RETRY', 'cancellation never MODIFY_AND_RETRY');
    assert(d.action !== 'REPLAN', 'cancellation never REPLAN');
    assert(d.action !== 'SKIP', 'cancellation never SKIP (immediate ABORT)');

    console.log('\nTest 6.3: cancelled flag overrides error class');
    const task2 = makeTask({ cancelled: true });
    const ctx2 = makeCtx({
      task: task2, errorMessage: 'ECONNRESET (would normally retry)', errorCode: 'AGENT_CANCELLED',
    });
    const d2 = decideRecoveryHeuristic(ctx2);
    assertEqual(d2.action, 'ABORT', 'cancelled flag → ABORT even on transient error');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 7: Max Retry
  // ════════════════════════════════════════════════════════════════════════
  await testSection('7. Max Retry', async () => {
    const { decideRecoveryHeuristic } = await import('../../src/main/agent/recovery-engine.ts');

    console.log('\nTest 7.1: transient_network at max retries → REPLAN (more steps)');
    const task = makeTask({ plan: [makeStep(), makeStep({ index: 1 })], currentStepIndex: 0 });
    const ctx = makeCtx({ task, errorMessage: 'ECONNRESET', attempt: 3, maxRetries: 3 });
    const d = decideRecoveryHeuristic(ctx);
    assertEqual(d.action, 'REPLAN', 'transient at max retries → REPLAN');

    console.log('\nTest 7.2: transient_network at max retries on last step → ABORT');
    const task2 = makeTask({ plan: [makeStep({ index: 0 })], currentStepIndex: 0 });
    const ctx2 = makeCtx({ task: task2, errorMessage: 'ECONNRESET', attempt: 3, maxRetries: 3 });
    const d2 = decideRecoveryHeuristic(ctx2);
    assertEqual(d2.action, 'ABORT', 'transient at max retries last step → ABORT');

    console.log('\nTest 7.3: model_inference at 1 retry → SKIP/ABORT');
    const task3 = makeTask({ plan: [makeStep(), makeStep({ index: 1 })], currentStepIndex: 0 });
    const ctx3 = makeCtx({ task: task3, errorMessage: 'JSON parse error', attempt: 1, maxRetries: 3 });
    const d3 = decideRecoveryHeuristic(ctx3);
    assertEqual(d3.action, 'SKIP', 'model_inference at 1 retry → SKIP');

    console.log('\nTest 7.4: unknown at 1 retry → ABORT');
    // Note: errorCode must NOT be TOOL_FAILURE or AGENT_CANCELLED to get 'unknown' class.
    // A genuinely ambiguous error message with no errorCode → unknown class.
    const ctx4 = makeCtx({ errorMessage: 'some weird error', errorCode: undefined, attempt: 1, maxRetries: 3 });
    const d4 = decideRecoveryHeuristic(ctx4);
    assertEqual(d4.action, 'ABORT', 'unknown at 1 retry → ABORT');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 8: MODIFY_AND_RETRY
  // ════════════════════════════════════════════════════════════════════════
  await testSection('8. MODIFY_AND_RETRY', async () => {
    const { decideRecoveryHeuristic, _internal } = await import('../../src/main/agent/recovery-engine.ts');

    console.log('\nTest 8.1: invalid_arguments (missing path) → MODIFY_AND_RETRY');
    const task = makeTask({ context: { activeFile: '/tmp/from-active.txt' } });
    const step = makeStep({ toolParams: { content: 'hello' } }); // no path
    const ctx = makeCtx({
      task, step,
      errorMessage: 'missing required parameter: path',
      attempt: 0,
    });
    const d = decideRecoveryHeuristic(ctx);
    assertEqual(d.action, 'MODIFY_AND_RETRY', 'missing path → MODIFY_AND_RETRY');
    assert(!!d.modifiedParams, 'modifiedParams provided');
    assertEqual(d.modifiedParams!.path, '/tmp/from-active.txt', 'path filled from activeFile');

    console.log('\nTest 8.2: invalid_arguments (missing content) → MODIFY_AND_RETRY');
    const step2 = makeStep({ toolParams: { path: '/tmp/test.txt' } }); // no content
    const ctx2 = makeCtx({
      step: step2,
      errorMessage: 'missing required parameter: content',
      attempt: 0,
    });
    const d2 = decideRecoveryHeuristic(ctx2);
    assertEqual(d2.action, 'MODIFY_AND_RETRY', 'missing content → MODIFY_AND_RETRY');
    assertEqual(d2.modifiedParams!.content, '', 'content filled as empty string');

    console.log('\nTest 8.3: path outside → SECURITY (heuristic does NOT auto-fix — safety)');
    // "path outside" matches security_policy (correct behavior — security gate
    // decision is final; the heuristic cannot auto-fix it). This is a SAFETY
    // feature, not a bug: we never strip paths to bypass security.
    const step3 = makeStep({ toolParams: { path: '../../../etc/passwd' } });
    const ctx3 = makeCtx({
      step: step3,
      errorMessage: 'path not allowed: outside workspace',
      attempt: 0,
    });
    const d3 = decideRecoveryHeuristic(ctx3);
    assertEqual(d3.errorClass, 'security_policy', 'path not allowed → security_policy');
    assert(d3.action !== 'MODIFY_AND_RETRY', 'security_policy → NEVER MODIFY (safety)');

    console.log('\nTest 8.4: tryFixArguments returns null when no heuristic fix available');
    const fix = _internal.tryFixArguments({
      step: makeStep({ toolParams: { foo: 'bar' } }),
      task: makeTask(),
      errorMessage: 'some weird invalid argument error',
      attempt: 0,
    } as any);
    assertEqual(fix, null, 'no fix available → null');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 9: REPLAN
  // ════════════════════════════════════════════════════════════════════════
  await testSection('9. REPLAN', async () => {
    const { decideRecoveryHeuristic } = await import('../../src/main/agent/recovery-engine.ts');

    console.log('\nTest 9.1: file_path → REPLAN');
    const ctx = makeCtx({ errorMessage: 'file not found: /tmp/missing', attempt: 0 });
    const d = decideRecoveryHeuristic(ctx);
    assertEqual(d.action, 'REPLAN', 'file_path → REPLAN');
    assertEqual(d.errorClass, 'file_path', 'errorClass preserved');
    assertEqual(d.backoffMs, 0, 'REPLAN has no backoff');

    console.log('\nTest 9.2: transient at max retries → REPLAN (when more steps)');
    const task = makeTask({ plan: [makeStep(), makeStep({ index: 1 })], currentStepIndex: 0 });
    const ctx2 = makeCtx({ task, errorMessage: 'ECONNRESET', attempt: 3, maxRetries: 3 });
    const d2 = decideRecoveryHeuristic(ctx2);
    assertEqual(d2.action, 'REPLAN', 'transient exhausted → REPLAN');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 10: SKIP
  // ════════════════════════════════════════════════════════════════════════
  await testSection('10. SKIP', async () => {
    const { decideRecoveryHeuristic } = await import('../../src/main/agent/recovery-engine.ts');

    console.log('\nTest 10.1: permission_denied with more steps → SKIP');
    const task = makeTask({ plan: [makeStep(), makeStep({ index: 1 })], currentStepIndex: 0 });
    const ctx = makeCtx({ task, errorMessage: 'permission denied', attempt: 0 });
    const d = decideRecoveryHeuristic(ctx);
    assertEqual(d.action, 'SKIP', 'permission_denied → SKIP');
    assertEqual(d.backoffMs, 0, 'SKIP has no backoff');

    console.log('\nTest 10.2: model_inference at 1 retry with more steps → SKIP');
    const task2 = makeTask({ plan: [makeStep(), makeStep({ index: 1 })], currentStepIndex: 0 });
    const ctx2 = makeCtx({ task: task2, errorMessage: 'JSON parse error', attempt: 1 });
    const d2 = decideRecoveryHeuristic(ctx2);
    assertEqual(d2.action, 'SKIP', 'model_inference at 1 retry → SKIP');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 11: ABORT
  // ════════════════════════════════════════════════════════════════════════
  await testSection('11. ABORT', async () => {
    const { decideRecoveryHeuristic } = await import('../../src/main/agent/recovery-engine.ts');

    console.log('\nTest 11.1: cancellation → ABORT');
    const ctx = makeCtx({ errorMessage: 'test', errorCode: 'AGENT_CANCELLED', cancelled: true });
    const d = decideRecoveryHeuristic(ctx);
    assertEqual(d.action, 'ABORT', 'cancellation → ABORT');

    console.log('\nTest 11.2: permission_denied on last step → ABORT');
    const task = makeTask({ plan: [makeStep({ index: 0 })], currentStepIndex: 0 });
    const ctx2 = makeCtx({ task: task2.task || task, errorMessage: 'permission denied', attempt: 0 });
    const d2 = decideRecoveryHeuristic(ctx2);
    assertEqual(d2.action, 'ABORT', 'permission last step → ABORT');

    console.log('\nTest 11.3: unknown at 1 retry → ABORT');
    const ctx3 = makeCtx({ errorMessage: 'weird error', errorCode: undefined, attempt: 1, maxRetries: 3 });
    const d3 = decideRecoveryHeuristic(ctx3);
    assertEqual(d3.action, 'ABORT', 'unknown at 1 retry → ABORT');

    function task2() { return makeTask({ plan: [makeStep({ index: 0 })], currentStepIndex: 0 }); }
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 12: LLM Analysis Fallback
  // ════════════════════════════════════════════════════════════════════════
  await testSection('12. LLM Analysis Fallback', async () => {
    const { decideRecovery, analyzeWithLLM } = await import('../../src/main/agent/recovery-engine.ts');

    console.log('\nTest 12.1: heuristic runs first (LLM not called for clear-cut errors)');
    const ctx = makeCtx({ errorMessage: 'ECONNRESET', attempt: 0, maxRetries: 3 });
    const d = await decideRecovery({ context: ctx, runtime: null, model: null });
    assertEqual(d.action, 'RETRY', 'heuristic → RETRY (no LLM)');
    assertEqual(d.llmAnalyzed, false, 'LLM not consulted for clear transient');

    console.log('\nTest 12.2: ambiguous error → LLM fallback (when runtime available)');
    // Make a mock runtime that returns a valid JSON response
    const mockRuntime: any = {
      chat: async (_msgs: any, _opts: any) => ({
        content: JSON.stringify({
          action: 'REPLAN',
          reason: 'LLM analyzed: wrong approach',
          confidence: 0.8,
        }),
      }),
    };
    const mockModel: any = { contextSize: 4096 };
    // errorCode undefined → classifyError returns 'unknown' (ambiguous) → LLM consulted
    const ctx2 = makeCtx({
      errorMessage: 'some weird ambiguous error', errorCode: undefined,
      attempt: 0, maxRetries: 3,
    });
    const d2 = await decideRecovery({
      context: ctx2,
      runtime: mockRuntime,
      model: mockModel,
    });
    // Heuristic returns 'unknown' for weird errors → ambiguous → LLM consulted
    assertEqual(d2.llmAnalyzed, true, 'LLM was consulted for ambiguous error');
    assertEqual(d2.action, 'REPLAN', 'LLM decision overrides heuristic');

    console.log('\nTest 12.3: LLM parse failure → fall back to heuristic');
    const badMockRuntime: any = {
      chat: async () => ({ content: 'not valid json' }),
    };
    const ctx3 = makeCtx({ errorMessage: 'weird ambiguous error', errorCode: undefined, attempt: 0 });
    const d3 = await decideRecovery({
      context: ctx3,
      runtime: badMockRuntime,
      model: mockModel,
    });
    assertEqual(d3.llmAnalyzed, false, 'LLM parse failure → heuristic used');
    // Heuristic for unknown → RETRY once
    assertEqual(d3.action, 'RETRY', 'fallback to heuristic RETRY');

    console.log('\nTest 12.4: LLM call throws → fall back to heuristic');
    const throwingRuntime: any = {
      chat: async () => { throw new Error('model crashed'); },
    };
    const ctx4 = makeCtx({ errorMessage: 'weird error', errorCode: undefined, attempt: 0 });
    const d4 = await decideRecovery({
      context: ctx4,
      runtime: throwingRuntime,
      model: mockModel,
    });
    assertEqual(d4.llmAnalyzed, false, 'LLM throw → heuristic used');

    console.log('\nTest 12.5: forceLLM=true always consults LLM');
    const ctx5 = makeCtx({ errorMessage: 'ECONNRESET', attempt: 0 });
    const d5 = await decideRecovery({
      context: ctx5,
      runtime: mockRuntime,
      model: mockModel,
      forceLLM: true,
    });
    assertEqual(d5.llmAnalyzed, true, 'forceLLM → LLM consulted');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 13: Offline Behavior
  // ════════════════════════════════════════════════════════════════════════
  await testSection('13. Offline Behavior', async () => {
    const { decideRecovery } = await import('../../src/main/agent/recovery-engine.ts');

    console.log('\nTest 13.1: no runtime + no model → heuristic only');
    const ctx = makeCtx({ errorMessage: 'weird error', attempt: 0 });
    const d = await decideRecovery({ context: ctx, runtime: null, model: null });
    assertEqual(d.llmAnalyzed, false, 'no LLM when offline');
    assertEqual(d.action, 'RETRY', 'heuristic path still works');

    console.log('\nTest 13.2: no runtime but has model → heuristic only');
    const ctx2 = makeCtx({ errorMessage: 'weird error', attempt: 0 });
    const d2 = await decideRecovery({ context: ctx2, runtime: null, model: { contextSize: 4096 } as any });
    assertEqual(d2.llmAnalyzed, false, 'no LLM without runtime');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 14: Context Propagation (redacted)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('14. Context Propagation', async () => {
    const { _internal } = await import('../../src/main/agent/recovery-engine.ts');
    const { classifyError } = await import('../../src/main/agent/error-classifier.ts');

    console.log('\nTest 14.1: prompt includes task ID, step, error');
    const task = makeTask({ userRequest: 'fix the bug' });
    const step = makeStep({ description: 'Read the file', toolName: 'read_file' });
    const ctx = makeCtx({
      taskId: task.id, // ensure taskId matches the overridden task
      task, step, errorMessage: 'ENOENT: file not found', attempt: 1, maxRetries: 3,
    });
    const classification = classifyError(ctx.errorMessage, ctx.errorCode);
    const heuristic = { action: 'REPLAN' as const, reason: 'test', errorClass: 'file_path' as const, backoffMs: 0, llmAnalyzed: false, confidence: 0.8, ambiguous: false };
    const prompt = _internal.buildLLMRecoveryPrompt(ctx, classification, heuristic);

    assert(prompt.includes(task.id), 'prompt includes task ID');
    assert(prompt.includes('fix the bug'), 'prompt includes user request');
    assert(prompt.includes('Read the file'), 'prompt includes step description');
    assert(prompt.includes('read_file'), 'prompt includes tool name');
    assert(prompt.includes('ENOENT'), 'prompt includes error message');
    assert(prompt.includes('1/3'), 'prompt includes attempt/maxRetries');

    console.log('\nTest 14.2: prompt redacts secrets in tool params');
    const step2 = makeStep({ toolParams: { path: '/tmp/test.txt', apiKey: 'sk-secret-1234567890' } });
    const ctx2 = makeCtx({ step: step2, errorMessage: 'some error' });
    const prompt2 = _internal.buildLLMRecoveryPrompt(ctx2, classification, heuristic);
    // The redacted version should NOT contain the raw secret
    assert(!prompt2.includes('sk-secret-1234567890'), 'prompt does NOT include raw API key');
    // But should include the path
    assert(prompt2.includes('/tmp/test.txt'), 'prompt includes path (non-secret)');

    console.log('\nTest 14.3: prompt includes remaining plan');
    const task3 = makeTask({ plan: [step, makeStep({ index: 1, description: 'Step 2' }), makeStep({ index: 2, description: 'Step 3' })] });
    const ctx3 = makeCtx({ task: task3, step, errorMessage: 'error', attempt: 0 });
    const prompt3 = _internal.buildLLMRecoveryPrompt(ctx3, classification, heuristic);
    assert(prompt3.includes('Step 2'), 'prompt includes remaining step 2');
    assert(prompt3.includes('Step 3'), 'prompt includes remaining step 3');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 15: Verification (post-recovery)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('15. Verification', async () => {
    console.log('\nTest 15.1: handleStepFailure emits recovery_succeeded only on actual completion');
    // Source inspection: the core.ts checks step.status === 'completed' after retry
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    assert(
      coreSource.includes("if (step.status === 'completed')") &&
      coreSource.includes("type: 'recovery_succeeded'"),
      'core.ts checks step.status === completed before emitting recovery_succeeded',
    );

    console.log('\nTest 15.2: existing verification logic preserved (verifyToolResult)');
    assert(coreSource.includes('verifyToolResult'), 'verifyToolResult still called in core');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 16: Queue Integration (source inspection)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('16. Queue Integration', async () => {
    console.log('\nTest 16.1: recovery events flow through agent-event IPC (no new IPC)');
    const mainSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'),
      'utf-8',
    );
    assert(mainSource.includes("'agent-event'"), "agent-event IPC channel exists");
    assert(mainSource.includes('onAgentEvent'), 'onAgentEvent listener wired');

    console.log('\nTest 16.2: Phase 6 Task Queue still has retry policy (independent)');
    const queueSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'tasks', 'queue.ts'),
      'utf-8',
    );
    assert(queueSource.includes('maxRetries'), 'queue has maxRetries');
    assert(queueSource.includes('retryCount'), 'queue tracks retryCount');
    assert(queueSource.includes('retryable'), 'queue checks retryable');
    // Queue retry policy applies to function-kind tasks (independent from agent recovery)
    assert(queueSource.includes("errCode !== 'AGENT_CANCELLED'"), 'queue skips retry on cancellation');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 17: Orb Integration (event mapping)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('17. Orb Integration', async () => {
    console.log('\nTest 17.1: NexChatPanel maps recovery_started → thinking');
    const chatSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'chat', 'NexChatPanel.tsx'),
      'utf-8',
    );
    assert(
      chatSource.includes("case 'recovery_started'") &&
      chatSource.includes("voiceController.setCondition('agent', 'thinking')"),
      'NexChatPanel maps recovery_started → thinking Orb state',
    );

    console.log('\nTest 17.2: NexChatPanel maps modify_retry_started → working');
    assert(
      chatSource.includes("case 'modify_retry_started'") &&
      chatSource.includes("voiceController.setCondition('agent', 'working')"),
      'NexChatPanel maps modify_retry_started → working Orb state',
    );

    console.log('\nTest 17.3: NexChatPanel handles all 6 recovery events');
    for (const evt of ['recovery_started', 'recovery_decision', 'modify_retry_started', 'skip_executed', 'recovery_succeeded', 'recovery_failed']) {
      assert(chatSource.includes(`case '${evt}'`), `NexChatPanel handles ${evt}`);
    }

    console.log('\nTest 17.4: AgentStateDisplay handles all 6 recovery events');
    const displaySource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'agent', 'AgentStateDisplay.tsx'),
      'utf-8',
    );
    for (const evt of ['recovery_started', 'recovery_decision', 'modify_retry_started', 'skip_executed', 'recovery_succeeded', 'recovery_failed']) {
      assert(displaySource.includes(`case '${evt}'`), `AgentStateDisplay handles ${evt}`);
    }

    console.log('\nTest 17.5: Orb integration does NOT create new state machine');
    // Recovery events map to existing Orb states (thinking/working/success/error/cancelled)
    // No new orb-state.ts transitions should be added
    const orbStateSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'orb', 'orb-state.ts'),
      'utf-8',
    );
    assert(!orbStateSource.includes('recovery'), 'orb-state.ts does NOT mention recovery (no new states)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 18: Race Conditions
  // ════════════════════════════════════════════════════════════════════════
  await testSection('18. Race Conditions', async () => {
    const { decideRecovery } = await import('../../src/main/agent/recovery-engine.ts');

    console.log('\nTest 18.1: concurrent decideRecovery calls (no shared state)');
    const ctxs: any[] = [];
    for (let i = 0; i < 10; i++) {
      ctxs.push(makeCtx({ errorMessage: `ECONNRESET-${i}`, attempt: 0, maxRetries: 3 }));
    }
    const decisions = await Promise.all(
      ctxs.map((ctx) => decideRecovery({ context: ctx, runtime: null, model: null }))
    );
    // All decisions should be RETRY (transient)
    let allRetry = true;
    for (const d of decisions) {
      if (d.action !== 'RETRY') { allRetry = false; break; }
    }
    assert(allRetry, 'all concurrent decisions are RETRY (no interference)');

    console.log('\nTest 18.2: cancellation during analysis → ABORT wins');
    const ctx = makeCtx({
      errorMessage: 'ECONNRESET', attempt: 0, cancelled: true, errorCode: 'AGENT_CANCELLED',
    });
    const d = await decideRecovery({ context: ctx, runtime: null, model: null });
    assertEqual(d.action, 'ABORT', 'cancellation overrides transient retry');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 19: Failure Isolation
  // ════════════════════════════════════════════════════════════════════════
  await testSection('19. Failure Isolation', async () => {
    console.log('\nTest 19.1: recovery engine crash → ABORT (safe default)');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    assert(
      coreSource.includes('Recovery engine crashed') &&
      coreSource.includes('ABORT'),
      'core.ts catches recovery engine crashes and falls back to ABORT',
    );

    console.log('\nTest 19.2: LLM failure → heuristic fallback (no crash)');
    const { decideRecovery } = await import('../../src/main/agent/recovery-engine.ts');
    const ctx = makeCtx({ errorMessage: 'weird error', attempt: 0 });
    const throwingRuntime: any = {
      chat: async () => { throw new Error('model crashed'); },
    };
    const d = await decideRecovery({
      context: ctx,
      runtime: throwingRuntime,
      model: { contextSize: 4096 } as any,
    });
    assertEqual(d.llmAnalyzed, false, 'LLM crash → heuristic used');
    assertEqual(d.action, 'RETRY', 'heuristic still produced a decision');

    console.log('\nTest 19.3: one task failure does not affect another');
    const ctx1 = makeCtx({ errorMessage: 'ECONNRESET', attempt: 0, maxRetries: 3 });
    const ctx2 = makeCtx({ errorMessage: 'permission denied', attempt: 0 });
    const d1 = await decideRecovery({ context: ctx1, runtime: null, model: null });
    const d2 = await decideRecovery({ context: ctx2, runtime: null, model: null });
    assertEqual(d1.action, 'RETRY', 'task 1 → RETRY');
    assert(d2.action === 'SKIP' || d2.action === 'ABORT', 'task 2 → SKIP/ABORT (different decision)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 20: Memory Recording
  // ════════════════════════════════════════════════════════════════════════
  await testSection('20. Memory Recording', async () => {
    console.log('\nTest 20.1: recordRecoveryMemory filters noisy retries');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    // The filter logic: skip transient RETRY (noisy) + successful unknown RETRY (noisy)
    assert(
      coreSource.includes("decision.action === 'RETRY'") &&
      coreSource.includes("decision.errorClass === 'transient_network'") &&
      coreSource.includes('return;'),
      'recordRecoveryMemory filters out noisy transient retries',
    );

    console.log('\nTest 20.2: recordRecoveryMemory records important recoveries');
    // Records: SKIP, ABORT, REPLAN, LLM-analyzed, MODIFY_AND_RETRY (all non-filtered)
    assert(
      coreSource.includes('TaskMemory.set(`recovery-') &&
      coreSource.includes('taskId: task.id') &&
      coreSource.includes('action: decision.action'),
      'recordRecoveryMemory records to TaskMemory',
    );

    console.log('\nTest 20.3: memory recording is best-effort (does not fail recovery)');
    assert(
      coreSource.includes('try') && coreSource.includes('Failed to record recovery memory'),
      'memory recording wrapped in try/catch',
    );
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 21: Agent Core Integration (handleStepFailure)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('21. Agent Core Integration', async () => {
    console.log('\nTest 21.1: handleStepFailure uses decideRecovery (not decideRetry)');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    assert(coreSource.includes('decideRecovery('), 'core.ts calls decideRecovery');
    // The old decideRetry is still imported (other callers) but not called in handleStepFailure
    assert(!coreSource.includes('const decision = decideRetry('), 'handleStepFailure no longer calls decideRetry directly');

    console.log('\nTest 21.2: recovery_started emitted before decision');
    assert(
      coreSource.includes("type: 'recovery_started'") &&
      coreSource.includes("type: 'recovery_decision'"),
      'core.ts emits recovery_started + recovery_decision events',
    );

    console.log('\nTest 21.3: all 5 recovery actions handled in switch');
    for (const action of ['RETRY', 'MODIFY_AND_RETRY', 'REPLAN', 'SKIP', 'ABORT']) {
      assert(coreSource.includes(`case '${action}':`), `core.ts handles ${action}`);
    }

    console.log('\nTest 21.4: ABORT pushes AgentError with recovery metadata');
    assert(
      coreSource.includes("type: mapErrorClassToAgentErrorType") &&
      coreSource.includes('errorClass: decision.errorClass') &&
      coreSource.includes('recoveryDecision:') &&
      coreSource.includes('recoveryAttempts:'),
      'ABORT creates AgentError with full recovery metadata',
    );

    console.log('\nTest 21.5: SKIP marks step as skipped (not failed)');
    assert(
      coreSource.includes("step.status = 'skipped'") &&
      coreSource.includes("type: 'skip_executed'"),
      'SKIP marks step skipped + emits skip_executed',
    );

    console.log('\nTest 21.6: error-classifier + recovery-engine imported');
    assert(
      coreSource.includes('from') && coreSource.includes("'./error-classifier'"),
      'error-classifier imported',
    );
    assert(
      coreSource.includes('from') && coreSource.includes("'./recovery-engine'"),
      'recovery-engine imported',
    );
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 22: Safety Guards (LLM can't bypass permission/security)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('22. Safety Guards', async () => {
    const { decideRecovery } = await import('../../src/main/agent/recovery-engine.ts');

    console.log('\nTest 22.1: LLM suggests RETRY for permission_denied → safety overrides to heuristic');
    const mockRuntime: any = {
      chat: async () => ({
        content: JSON.stringify({
          action: 'RETRY',
          reason: 'LLM wrongly suggested retry',
          confidence: 0.9,
        }),
      }),
    };
    const task = makeTask({ plan: [makeStep(), makeStep({ index: 1 })], currentStepIndex: 0 });
    const ctx = makeCtx({
      task, errorMessage: 'permission denied by user', attempt: 0,
    });
    const d = await decideRecovery({
      context: ctx, runtime: mockRuntime, model: { contextSize: 4096 } as any, forceLLM: true,
    });
    // Safety: permission_denied → never retry, even if LLM suggests it
    assert(d.action !== 'RETRY', 'LLM cannot override safety: permission_denied never RETRY');
    assert(d.action !== 'MODIFY_AND_RETRY', 'LLM cannot override: permission_denied never MODIFY');
    // Should be SKIP (heuristic decision)
    assertEqual(d.action, 'SKIP', 'safety override → heuristic SKIP');

    console.log('\nTest 22.2: LLM suggests RETRY for security_policy → safety overrides');
    const ctx2 = makeCtx({
      task, errorMessage: 'blocked: security policy', attempt: 0,
    });
    const d2 = await decideRecovery({
      context: ctx2, runtime: mockRuntime, model: { contextSize: 4096 } as any, forceLLM: true,
    });
    assert(d2.action !== 'RETRY', 'security_policy never RETRY (LLM overriden)');
    assert(d2.action !== 'MODIFY_AND_RETRY', 'security_policy never MODIFY (LLM overriden)');

    console.log('\nTest 22.3: LLM suggests RETRY for cancellation → safety overrides');
    const ctx3 = makeCtx({
      errorMessage: 'some error', errorCode: 'AGENT_CANCELLED', cancelled: true, attempt: 0,
    });
    const d3 = await decideRecovery({
      context: ctx3, runtime: mockRuntime, model: { contextSize: 4096 } as any, forceLLM: true,
    });
    assertEqual(d3.action, 'ABORT', 'cancellation → ABORT regardless of LLM suggestion');

    console.log('\nTest 22.4: recovery actions re-execute through permission gate');
    // The RETRY/MODIFY_AND_RETRY call executeStep() which calls executeToolWithPermission
    // (the same path as the original execution). The recovery engine NEVER bypasses it.
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    assert(
      coreSource.includes('executeStep(task, step, token, runtime, model)') &&
      coreSource.includes('executeToolWithPermission'),
      'recovery RETRY/MODIFY re-execute via executeStep → executeToolWithPermission',
    );

    console.log('\nTest 22.5: recovery-engine does not call executeTool directly');
    const engineSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'recovery-engine.ts'),
      'utf-8',
    );
    // The recovery engine should NOT import or call executeTool/executeToolWithPermission.
    // It only returns decisions; the caller (core.ts) re-executes via executeStep.
    // We check for import statements and function calls (not comment mentions).
    const hasImportExecuteTool = /import\s+\{[^}]*executeTool[^}]*\}/.test(engineSource);
    const hasCallExecuteTool = /[^a-zA-Z]executeTool\s*\(/.test(engineSource);
    const hasCallExecuteToolWithPermission = /[^a-zA-Z]executeToolWithPermission\s*\(/.test(engineSource);
    assert(!hasImportExecuteTool, 'recovery-engine does NOT import executeTool');
    assert(!hasCallExecuteTool, 'recovery-engine does NOT call executeTool()');
    assert(!hasCallExecuteToolWithPermission, 'recovery-engine does NOT call executeToolWithPermission()');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 23: Types + AgentEventType
  // ════════════════════════════════════════════════════════════════════════
  await testSection('23. Types + AgentEventType', async () => {
    console.log('\nTest 23.1: AgentEventType includes 6 recovery events');
    const typesSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'types.ts'),
      'utf-8',
    );
    for (const evt of ['recovery_started', 'recovery_decision', 'modify_retry_started', 'skip_executed', 'recovery_succeeded', 'recovery_failed']) {
      assert(typesSource.includes(`'${evt}'`), `AgentEventType includes ${evt}`);
    }

    console.log('\nTest 23.2: AgentError has recovery metadata fields');
    assert(typesSource.includes('errorClass?'), 'AgentError.errorClass field');
    assert(typesSource.includes('recoveryDecision?'), 'AgentError.recoveryDecision field');
    assert(typesSource.includes('recoveryAttempts?'), 'AgentError.recoveryAttempts field');
    assert(typesSource.includes('llmAnalyzed?'), 'AgentError.llmAnalyzed field');

    console.log('\nTest 23.3: AgentError.type extended with new error classes');
    // The legacy 'type' field stays, but errorClass is the new 10-class taxonomy
    assert(typesSource.includes("type: 'tool_error'"), 'AgentError.type preserved (legacy)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 7 recovery tests: ${passed}/${passed + failed} passed (${failed} failed)`);
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
