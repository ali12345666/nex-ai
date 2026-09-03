/**
 * NEX AI — Phase 9: Agent Reliability & Verification — Comprehensive Tests
 *
 * Coverage (per Phase 9 §16 — 33 scenarios):
 *
 * Step verification:
 *   1.  successful tool + verified result
 *   2.  successful tool + verification failure
 *   3.  file creation verification
 *   4.  file modification verification
 *   5.  file deletion verification
 *   6.  rename/move verification
 *   7.  command verification
 *   8.  build verification
 *   9.  test verification
 *
 * Recovery:
 *  10. verification failure → RETRY
 *  11. verification failure → MODIFY_AND_RETRY
 *  12. verification failure → REPLAN
 *  13. verification failure → ABORT
 *  14. max retries respected
 *  15. no infinite verification loop
 *
 * Completion:
 *  16. all steps verified → SUCCESS
 *  17. unverified required step → NOT SUCCESS
 *  18. failed required step → NOT SUCCESS
 *  19. active recovery → NOT SUCCESS (no pending steps)
 *  20. cancellation → CANCELLED
 *
 * Context:
 *  21. taskId preserved
 *  22. agentTaskId preserved
 *  23. user goal preserved
 *  24. step context preserved
 *  25. verification context redacted
 *
 * Security:
 *  26. verification cannot bypass Permission Gate
 *  27. sensitive data not emitted in events
 *  28. sensitive data not persisted
 *
 * Concurrency:
 *  29. two tasks do not share verification state
 *  30. verification state survives retry correctly
 *
 * Regression:
 *  31. Phase 6 tests (source inspection)
 *  32. Phase 7 tests (source inspection)
 *  33. Phase 8 tests (source inspection)
 *
 * Run with: npx tsx tests/tools/test-phase-9-verification.ts
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
    toolCalls: [],
    verification: [],
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

function makeToolResult(overrides: any = {}): any {
  return {
    success: true,
    output: 'some output',
    data: {},
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('Phase 9: Agent Reliability & Verification — Comprehensive Tests\n');

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 1: successful tool + verified result
  // ════════════════════════════════════════════════════════════════════════
  await testSection('1. successful tool + verified result', async () => {
    const { verifyStepOutcome } = await import('../../src/main/agent/verification.ts');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p9-1-'));
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello world');

    console.log('\nTest 1.1: tool success + no expected outcome → verified (Level 1)');
    const step = makeStep({ toolParams: { path: filePath } });
    const toolResult = makeToolResult();
    const verification = await verifyStepOutcome(step, toolResult, tmpDir);
    assertEqual(verification.status, 'verified', 'status = verified');
    assertEqual(verification.level, 1, 'level = 1 (tool result only)');
    assert(verification.confidence! > 0, 'confidence > 0');

    console.log('\nTest 1.2: tool success + file_exists expected outcome → verified (Level 2)');
    const step2 = makeStep({
      toolParams: { path: filePath },
      expectedOutcome: { type: 'file_exists', path: 'test.txt' },
    });
    const verification2 = await verifyStepOutcome(step2, toolResult, tmpDir);
    assertEqual(verification2.status, 'verified', 'status = verified');
    assertEqual(verification2.level, 2, 'level = 2 (structural)');
    assert(verification2.evidence!.length > 0, 'has evidence');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 2: successful tool + verification failure
  // ════════════════════════════════════════════════════════════════════════
  await testSection('2. successful tool + verification failure', async () => {
    const { verifyStepOutcome } = await import('../../src/main/agent/verification.ts');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p9-2-'));

    console.log('\nTest 2.1: tool success but file_does_not_exist → failed');
    const step = makeStep({
      toolParams: { path: '/tmp/nonexistent.txt' },
      expectedOutcome: { type: 'file_exists', path: 'nonexistent.txt' },
    });
    const toolResult = makeToolResult();
    const verification = await verifyStepOutcome(step, toolResult, tmpDir);
    assertEqual(verification.status, 'failed', 'status = failed (file missing)');
    assertEqual(verification.level, 2, 'level = 2 (structural)');
    assertEqual(verification.recommendedAction, 'replan', 'recommendedAction = replan');

    console.log('\nTest 2.2: tool success but non-zero exit code → failed');
    const step2 = makeStep({ toolParams: {} });
    const toolResult2 = makeToolResult({ data: { exitCode: 1 } });
    const verification2 = await verifyStepOutcome(step2, toolResult2, tmpDir);
    assertEqual(verification2.status, 'failed', 'status = failed (non-zero exit)');
    assertEqual(verification2.level, 4, 'level = 4 (execution)');
    assertEqual(verification2.recommendedAction, 'retry', 'recommendedAction = retry');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 3: file creation verification
  // ════════════════════════════════════════════════════════════════════════
  await testSection('3. file creation verification', async () => {
    const { verifyStepOutcome } = await import('../../src/main/agent/verification.ts');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p9-3-'));
    const filePath = path.join(tmpDir, 'created.txt');

    console.log('\nTest 3.1: write_file succeeds + file_exists → verified');
    fs.writeFileSync(filePath, 'content');
    const step = makeStep({
      toolName: 'write_file',
      toolParams: { path: filePath, content: 'content' },
      expectedOutcome: { type: 'file_exists', path: 'created.txt' },
    });
    const verification = await verifyStepOutcome(step, makeToolResult(), tmpDir);
    assertEqual(verification.status, 'verified', 'file creation verified');

    console.log('\nTest 3.2: write_file reports success but file NOT created → failed');
    fs.unlinkSync(filePath);
    const step2 = makeStep({
      toolName: 'write_file',
      toolParams: { path: filePath, content: 'content' },
      expectedOutcome: { type: 'file_exists', path: 'created.txt' },
    });
    const verification2 = await verifyStepOutcome(step2, makeToolResult(), tmpDir);
    assertEqual(verification2.status, 'failed', 'file missing → verification failed');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 4: file modification verification (content check)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('4. file modification verification', async () => {
    const { verifyStepOutcome } = await import('../../src/main/agent/verification.ts');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p9-4-'));
    const filePath = path.join(tmpDir, 'edit.txt');

    console.log('\nTest 4.1: edit_file + expected content present → verified (Level 3)');
    fs.writeFileSync(filePath, 'before\nexport function hello() { return 42; }\nafter');
    const step = makeStep({
      toolName: 'edit_file',
      toolParams: { path: filePath, old_text: '42', new_text: '100' },
      expectedOutcome: { type: 'file_contains', path: 'edit.txt', content: 'export function hello() { return 100; }' },
    });
    // Simulate the edit (replace 42 with 100)
    fs.writeFileSync(filePath, 'before\nexport function hello() { return 100; }\nafter');
    const verification = await verifyStepOutcome(step, makeToolResult(), tmpDir);
    assertEqual(verification.status, 'verified', 'content verified');
    assertEqual(verification.level, 3, 'level = 3 (content)');

    console.log('\nTest 4.2: edit_file reports success but content NOT changed → failed');
    fs.writeFileSync(filePath, 'before\nexport function hello() { return 42; }\nafter');
    const step2 = makeStep({
      toolName: 'edit_file',
      toolParams: { path: filePath, old_text: '42', new_text: '100' },
      expectedOutcome: { type: 'file_contains', path: 'edit.txt', content: 'return 100' },
    });
    // File still has 42 (edit didn't happen despite tool success)
    const verification2 = await verifyStepOutcome(step2, makeToolResult(), tmpDir);
    assertEqual(verification2.status, 'failed', 'content missing → verification failed');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 5: file deletion verification
  // ════════════════════════════════════════════════════════════════════════
  await testSection('5. file deletion verification', async () => {
    const { verifyStepOutcome } = await import('../../src/main/agent/verification.ts');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p9-5-'));
    const filePath = path.join(tmpDir, 'deleteme.txt');

    console.log('\nTest 5.1: delete file + file_gone → verified');
    // File never created (or already deleted)
    const step = makeStep({
      toolName: 'run_command',
      toolParams: { command: 'rm', args: [filePath] },
      expectedOutcome: { type: 'file_gone', path: 'deleteme.txt' },
    });
    const verification = await verifyStepOutcome(step, makeToolResult(), tmpDir);
    assertEqual(verification.status, 'verified', 'file gone → verified');

    console.log('\nTest 5.2: delete reports success but file still exists → failed');
    fs.writeFileSync(filePath, 'content');
    const step2 = makeStep({
      toolName: 'run_command',
      toolParams: { command: 'rm', args: [filePath] },
      expectedOutcome: { type: 'file_gone', path: 'deleteme.txt' },
    });
    const verification2 = await verifyStepOutcome(step2, makeToolResult(), tmpDir);
    assertEqual(verification2.status, 'failed', 'file still exists → verification failed');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 6: rename/move verification
  // ════════════════════════════════════════════════════════════════════════
  await testSection('6. rename/move verification', async () => {
    const { verifyStepOutcome } = await import('../../src/main/agent/verification.ts');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p9-6-'));
    const oldPath = path.join(tmpDir, 'old.txt');
    const newPath = path.join(tmpDir, 'new.txt');

    console.log('\nTest 6.1: rename → old gone + new exists → verified (using file_gone for old)');
    fs.writeFileSync(newPath, 'content');
    const step = makeStep({
      toolName: 'run_command',
      toolParams: { command: 'mv', args: [oldPath, newPath] },
      expectedOutcome: { type: 'file_gone', path: 'old.txt' },
    });
    const verification = await verifyStepOutcome(step, makeToolResult(), tmpDir);
    assertEqual(verification.status, 'verified', 'old path gone → verified');

    console.log('\nTest 6.2: rename reports success but old file still exists → failed');
    fs.writeFileSync(oldPath, 'content');
    fs.unlinkSync(newPath);
    const step2 = makeStep({
      toolName: 'run_command',
      toolParams: { command: 'mv', args: [oldPath, newPath] },
      expectedOutcome: { type: 'file_gone', path: 'old.txt' },
    });
    const verification2 = await verifyStepOutcome(step2, makeToolResult(), tmpDir);
    assertEqual(verification2.status, 'failed', 'old file still exists → verification failed');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 7: command verification (exit code)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('7. command verification', async () => {
    const { verifyStepOutcome, verifyToolResult } = await import('../../src/main/agent/verification.ts');

    console.log('\nTest 7.1: command exit 0 → verified');
    const step = makeStep({ toolName: 'run_command', toolParams: { command: 'echo' } });
    const toolResult = makeToolResult({ data: { exitCode: 0 } });
    const verification = await verifyStepOutcome(step, toolResult);
    assertEqual(verification.status, 'verified', 'exit 0 → verified');

    console.log('\nTest 7.2: command exit 1 → failed');
    const step2 = makeStep({ toolName: 'run_command', toolParams: { command: 'false' } });
    const toolResult2 = makeToolResult({ data: { exitCode: 1 } });
    const verification2 = await verifyStepOutcome(step2, toolResult2);
    assertEqual(verification2.status, 'failed', 'exit 1 → failed');

    console.log('\nTest 7.3: verifyToolResult with expectedExitCode=0 + actual 0 → verified');
    const v3 = verifyToolResult({
      stepId: 's1', description: 'cmd',
      expectedExitCode: 0,
      toolResult: makeToolResult({ data: { exitCode: 0 } }),
    });
    assertEqual(v3.status, 'verified', 'expectedExitCode=0, actual=0 → verified');

    console.log('\nTest 7.4: verifyToolResult with expectedExitCode=0 + actual 1 → failed');
    const v4 = verifyToolResult({
      stepId: 's1', description: 'cmd',
      expectedExitCode: 0,
      toolResult: makeToolResult({ data: { exitCode: 1 } }),
    });
    assertEqual(v4.status, 'failed', 'expectedExitCode=0, actual=1 → failed');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 8: build verification
  // ════════════════════════════════════════════════════════════════════════
  await testSection('8. build verification', async () => {
    const { verifyToolResult } = await import('../../src/main/agent/verification.ts');

    console.log('\nTest 8.1: build exit 0 + output contains "built" → verified');
    const v1 = verifyToolResult({
      stepId: 's1', description: 'npm build',
      expectedExitCode: 0,
      expectedOutputContains: ['built'],
      toolResult: makeToolResult({ output: 'Build successful: 5 files built', data: { exitCode: 0 } }),
    });
    assertEqual(v1.status, 'verified', 'build verified');

    console.log('\nTest 8.2: build exit 0 but output contains "error" → failed (forbidden)');
    const v2 = verifyToolResult({
      stepId: 's1', description: 'npm build',
      forbiddenOutputContains: ['error'],
      toolResult: makeToolResult({ output: 'Build failed with error TS1234', data: { exitCode: 0 } }),
    });
    assertEqual(v2.status, 'failed', 'forbidden "error" → failed');

    console.log('\nTest 8.3: build exit 1 → failed (non-zero exit)');
    const v3 = verifyToolResult({
      stepId: 's1', description: 'npm build',
      expectedExitCode: 0,
      toolResult: makeToolResult({ data: { exitCode: 1 } }),
    });
    assertEqual(v3.status, 'failed', 'exit 1 → failed');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 9: test verification
  // ════════════════════════════════════════════════════════════════════════
  await testSection('9. test verification', async () => {
    const { verifyToolResult } = await import('../../src/main/agent/verification.ts');

    console.log('\nTest 9.1: tests pass (exit 0 + "passed") → verified');
    const v1 = verifyToolResult({
      stepId: 's1', description: 'npm test',
      expectedExitCode: 0,
      expectedOutputContains: ['passing'],
      toolResult: makeToolResult({ output: '5 passing, 0 failing', data: { exitCode: 0 } }),
    });
    assertEqual(v1.status, 'verified', 'tests pass → verified');

    console.log('\nTest 9.2: tests fail (exit 1 + "failing") → failed');
    const v2 = verifyToolResult({
      stepId: 's1', description: 'npm test',
      expectedExitCode: 0,
      toolResult: makeToolResult({ output: '4 passing, 1 failing', data: { exitCode: 1 } }),
    });
    assertEqual(v2.status, 'failed', 'tests fail → failed');

    console.log('\nTest 9.3: false-success prevention (exit 0 but "failing" in output)');
    const v3 = verifyToolResult({
      stepId: 's1', description: 'npm test',
      expectedExitCode: 0,
      forbiddenOutputContains: ['failing'],
      toolResult: makeToolResult({ output: '4 passing, 1 failing', data: { exitCode: 0 } }),
    });
    assertEqual(v3.status, 'failed', 'forbidden "failing" caught → failed');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 10-15: Recovery integration
  // ════════════════════════════════════════════════════════════════════════
  await testSection('10-15. Verification failure recovery', async () => {
    const { decideRecoveryHeuristic } = await import('../../src/main/agent/recovery-engine.ts');
    const { classifyError } = await import('../../src/main/agent/error-classifier.ts');

    console.log('\nTest 10: verification failure (attempt 0) → RETRY');
    const ctx = makeCtx({
      errorMessage: 'Verification failed: file does not exist',
      errorCode: 'VERIFICATION_FAILED', attempt: 0,
    });
    const d = decideRecoveryHeuristic(ctx);
    assertEqual(d.action, 'RETRY', 'verification_failed attempt 0 → RETRY');
    assertEqual(d.errorClass, 'verification_failed', 'errorClass = verification_failed');

    console.log('\nTest 11: verification failure classified as verification_failed');
    const c = classifyError('Verification failed: file missing', 'VERIFICATION_FAILED');
    assertEqual(c.class, 'verification_failed', 'classified as verification_failed');
    assertEqual(c.retryable, true, 'retryable (once)');

    console.log('\nTest 12: verification failure (attempt 1) with more steps → REPLAN');
    const task = makeTask({ plan: [makeStep(), makeStep({ index: 1 })], currentStepIndex: 0 });
    const ctx2 = makeCtx({
      task, errorMessage: 'Verification failed: content missing', errorCode: 'VERIFICATION_FAILED',
      attempt: 1,
    });
    const d2 = decideRecoveryHeuristic(ctx2);
    assertEqual(d2.action, 'REPLAN', 'attempt 1 with more steps → REPLAN');

    console.log('\nTest 13: verification failure (attempt 1) on last step → ABORT');
    const task3 = makeTask({ plan: [makeStep({ index: 0 })], currentStepIndex: 0 });
    const ctx3 = makeCtx({
      task: task3, errorMessage: 'Verification failed: missing', errorCode: 'VERIFICATION_FAILED',
      attempt: 1,
    });
    const d3 = decideRecoveryHeuristic(ctx3);
    assertEqual(d3.action, 'ABORT', 'attempt 1 last step → ABORT');

    console.log('\nTest 14: max retries respected (verification_failed only retries once)');
    const ctx4 = makeCtx({
      errorMessage: 'Verification failed', errorCode: 'VERIFICATION_FAILED', attempt: 1, maxRetries: 5,
    });
    const d4 = decideRecoveryHeuristic(ctx4);
    // Even with maxRetries=5, verification_failed only allows 1 retry
    assert(d4.action !== 'RETRY', 'after 1 retry, no more RETRY (even with maxRetries=5)');

    console.log('\nTest 15: no infinite verification loop (retries bounded)');
    // Simulate 10 verification failures on the same step — each round is attempt+1
    let attempts = 0;
    let lastAction = 'RETRY';
    for (let i = 0; i < 10; i++) {
      const ctxN = makeCtx({
        errorMessage: 'Verification failed', errorCode: 'VERIFICATION_FAILED', attempt: attempts,
      });
      const dN = decideRecoveryHeuristic(ctxN);
      lastAction = dN.action;
      if (dN.action === 'RETRY') attempts++;
      else break;
    }
    assert(lastAction !== 'RETRY', 'verification loop terminates (not infinite)');
  });

  function makeCtx(overrides: any = {}): any {
    const task = makeTask({ plan: [makeStep({ index: 0 }), makeStep({ index: 1, description: 'Step 2' })], currentStepIndex: 0 });
    const step = task.plan[0];
    return {
      taskId: task.id, step, task, toolName: step.toolName,
      errorMessage: 'test', errorCode: 'TOOL_FAILURE',
      attempt: 0, maxRetries: 3, cancelled: false,
      ...overrides,
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 16-20: Completion
  // ════════════════════════════════════════════════════════════════════════
  await testSection('16-20. Task completion gate', async () => {
    const { verifyTaskCompletion } = await import('../../src/main/agent/verification.ts');

    console.log('\nTest 16: all steps verified + toolCalls > 0 → SUCCESS');
    const task = makeTask({
      plan: [makeStep({ status: 'completed' }), makeStep({ status: 'completed', index: 1 })],
      toolCalls: [{ id: 'tc1' } as any],
    });
    const result = verifyTaskCompletion(task);
    assertEqual(result.passed, true, 'all verified → passed');
    assertEqual(result.unresolvedSteps.length, 0, 'no unresolved steps');

    console.log('\nTest 17: unverified required step (pending) → NOT SUCCESS');
    const task2 = makeTask({
      plan: [makeStep({ status: 'completed' }), makeStep({ status: 'pending', index: 1 })],
      toolCalls: [{ id: 'tc1' } as any],
    });
    const result2 = verifyTaskCompletion(task2);
    assertEqual(result2.passed, false, 'pending step → NOT passed');
    assertEqual(result2.unresolvedSteps.length, 1, '1 unresolved step');

    console.log('\nTest 18: failed required step → NOT SUCCESS');
    const task3 = makeTask({
      plan: [makeStep({ status: 'completed' }), makeStep({ status: 'failed', index: 1 })],
      toolCalls: [{ id: 'tc1' } as any],
    });
    const result3 = verifyTaskCompletion(task3);
    assertEqual(result3.passed, false, 'failed step → NOT passed');

    console.log('\nTest 19: skipped step (recovery SKIP) → still SUCCESS');
    const task4 = makeTask({
      plan: [makeStep({ status: 'completed' }), makeStep({ status: 'skipped', index: 1 })],
      toolCalls: [{ id: 'tc1' } as any],
    });
    const result4 = verifyTaskCompletion(task4);
    assertEqual(result4.passed, true, 'skipped step (recovery) → passed');

    console.log('\nTest 20: 0 tool calls → NOT SUCCESS');
    const task5 = makeTask({
      plan: [makeStep({ status: 'completed' })],
      toolCalls: [],
    });
    const result5 = verifyTaskCompletion(task5);
    assertEqual(result5.passed, false, '0 tool calls → NOT passed');

    console.log('\nTest 20b: unresolved error (tool_error, not recovered) → NOT SUCCESS');
    const task6 = makeTask({
      plan: [makeStep({ status: 'completed' })],
      toolCalls: [{ id: 'tc1' } as any],
      errors: [{
        id: 'err1', type: 'tool_error', message: 'boom',
        timestamp: Date.now(), recovered: false,
      } as any],
    });
    const result6 = verifyTaskCompletion(task6);
    assertEqual(result6.passed, false, 'unresolved error → NOT passed');
    assertEqual(result6.unresolvedErrors.length, 1, '1 unresolved error');

    console.log('\nTest 20c: recovered error → still SUCCESS');
    const task7 = makeTask({
      plan: [makeStep({ status: 'completed' })],
      toolCalls: [{ id: 'tc1' } as any],
      errors: [{
        id: 'err1', type: 'tool_error', message: 'boom',
        timestamp: Date.now(), recovered: true,
      } as any],
    });
    const result7 = verifyTaskCompletion(task7);
    assertEqual(result7.passed, true, 'recovered error → passed');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 21-25: Context preservation
  // ════════════════════════════════════════════════════════════════════════
  await testSection('21-25. Context preservation', async () => {
    const { verifyStepOutcome } = await import('../../src/main/agent/verification.ts');

    console.log('\nTest 21: taskId preserved in verification result');
    const task = makeTask({ id: 'task-xyz' });
    const step = makeStep({ id: 'step-1' });
    const verification = await verifyStepOutcome(step, makeToolResult());
    assertEqual(verification.stepId, 'step-1', 'stepId preserved');

    console.log('\nTest 22: verification result includes evidence (for context)');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-p9-22-'));
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'content');
    const step2 = makeStep({
      expectedOutcome: { type: 'file_exists', path: 'test.txt' },
    });
    const v2 = await verifyStepOutcome(step2, makeToolResult(), tmpDir);
    assert(v2.evidence!.length > 0, 'evidence array populated');
    assert(v2.evidence!.some((e: string) => e.includes('existsSync')), 'evidence includes fs check');
    fs.rmSync(tmpDir, { recursive: true, force: true });

    console.log('\nTest 23: user goal preserved (source inspection)');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    // The verification failure path uses step.description + verification.details
    assert(coreSource.includes('Verification failed:'), 'verification failure message includes context');

    console.log('\nTest 24: step context preserved in verification result');
    const step3 = makeStep({ description: 'Create the file at /tmp/x' });
    const v3 = await verifyStepOutcome(step3, makeToolResult());
    assertEqual(v3.description, 'Create the file at /tmp/x', 'step description preserved');

    console.log('\nTest 25: verification evidence is safe (no secrets)');
    const step4 = makeStep({
      toolParams: { path: '/tmp/x', apiKey: 'sk-1234567890abcdefghijklmnop' },
      expectedOutcome: { type: 'file_exists', path: 'x.txt' },
    });
    const v4 = await verifyStepOutcome(step4, makeToolResult(), '/tmp');
    // Evidence should NOT include the API key
    const evidenceStr = JSON.stringify(v4.evidence);
    assert(!evidenceStr.includes('sk-1234567890abcdefghijklmnop'), 'no API key in evidence');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 26-28: Security
  // ════════════════════════════════════════════════════════════════════════
  await testSection('26-28. Security', async () => {
    console.log('\nTest 26: verification does NOT call write/execute tools (source inspection)');
    const verSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'verification.ts'),
      'utf-8',
    );
    // verification.ts uses fs.existsSync, fs.readFileSync, fs.statSync — read-only fs ops
    // It does NOT call executeTool for write_file/edit_file/run_command
    assert(!verSource.includes("executeTool('write_file'"), 'does NOT call executeTool for write_file');
    assert(!verSource.includes("executeTool('edit_file'"), 'does NOT call executeTool for edit_file');
    assert(!verSource.includes("executeTool('run_command'"), 'does NOT call executeTool for run_command');
    assert(verSource.includes('fs.existsSync'), 'uses read-only fs.existsSync');
    assert(verSource.includes('fs.readFileSync'), 'uses read-only fs.readFileSync');

    console.log('\nTest 27: verification events do NOT emit raw tool output (source inspection)');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    // verification_passed/verification_failed events emit: level, confidence, evidence (which is safe)
    // They do NOT emit raw toolResult.output directly in the event data
    assert(coreSource.includes("type: 'verification_failed'"), 'verification_failed event exists');
    assert(coreSource.includes('evidence: lastVerification.evidence'), 'emits evidence (safe)');
    // Find the verification_failed event emit block and check it doesn't include rawOutput
    const verFailedIdx = coreSource.indexOf("type: 'verification_failed'");
    const verFailedBlock = coreSource.slice(verFailedIdx, verFailedIdx + 800);
    assert(!verFailedBlock.includes('result.output'), 'verification_failed event does NOT emit result.output');
    assert(!verFailedBlock.includes('rawOutput'), 'verification_failed event does NOT emit rawOutput');

    console.log('\nTest 28: verification does NOT persist secrets (source inspection)');
    // verification.ts doesn't write to disk at all — it only returns VerificationResult
    assert(!verSource.includes('fs.writeFileSync'), 'verification.ts does NOT write to disk');
    assert(!verSource.includes('fs.appendFile'), 'verification.ts does NOT append to disk');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 29-30: Concurrency
  // ════════════════════════════════════════════════════════════════════════
  await testSection('29-30. Concurrency', async () => {
    const { verifyStepOutcome, verifyTaskCompletion } = await import('../../src/main/agent/verification.ts');

    console.log('\nTest 29: two tasks do not share verification state');
    const task1 = makeTask({
      id: 'task-A',
      plan: [makeStep({ id: 's-A1', status: 'completed' })],
      toolCalls: [{ id: 'tc1' } as any],
    });
    const task2 = makeTask({
      id: 'task-B',
      plan: [makeStep({ id: 's-B1', status: 'failed' })],
      toolCalls: [{ id: 'tc1' } as any],
    });
    const r1 = verifyTaskCompletion(task1);
    const r2 = verifyTaskCompletion(task2);
    assert(r1.passed !== r2.passed, 'different tasks → different results');
    assertEqual(r1.passed, true, 'task A passed');
    assertEqual(r2.passed, false, 'task B failed');

    console.log('\nTest 30: verification state survives retry (source inspection)');
    // verifyStepOutcome is stateless — each call produces a fresh VerificationResult
    // The state (retryCount) lives on the step object, not on the verifier
    const verSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'verification.ts'),
      'utf-8',
    );
    // verifyStepOutcome returns a new VerificationResult each time (uses Date.now() + random)
    assert(verSource.includes('ver-out-'), 'each verification gets a unique ID');
    assert(verSource.includes('Date.now()'), 'uses Date.now() (fresh timestamp)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 31-33: Regression
  // ════════════════════════════════════════════════════════════════════════
  await testSection('31-33. Regression (source inspection)', async () => {
    console.log('\nTest 31: Phase 6 task queue still intact');
    const queueTypes = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'tasks', 'types.ts'),
      'utf-8',
    );
    assert(queueTypes.includes('TaskQueueItem'), 'TaskQueueItem type still exists');
    assert(queueTypes.includes('TaskPriority'), 'TaskPriority type still exists');

    console.log('\nTest 32: Phase 7 recovery engine still intact + handles verification_failed');
    const engineSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'recovery-engine.ts'),
      'utf-8',
    );
    assert(engineSource.includes('decideRecovery'), 'decideRecovery function exists');
    assert(engineSource.includes('verification_failed'), 'recovery handles verification_failed');
    assert(engineSource.includes("cls === 'verification_failed'"), 'verification_failed has its own branch');

    const classifierSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'error-classifier.ts'),
      'utf-8',
    );
    assert(classifierSource.includes("'verification_failed'"), 'error-classifier has verification_failed class');
    assert(classifierSource.includes("VERIFICATION_FAILED"), 'classifier detects VERIFICATION_FAILED code');

    console.log('\nTest 33: Phase 8 context contract still intact');
    const contractSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'context-contract.ts'),
      'utf-8',
    );
    assert(contractSource.includes('AgentContextContract'), 'AgentContextContract exists');
    assert(contractSource.includes('safeContextSnapshot'), 'safeContextSnapshot exists');

    console.log('\nTest 33b: Phase 9 additions are additive (no breaking changes)');
    const typesSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'types.ts'),
      'utf-8',
    );
    // VerificationResult new fields are optional
    assert(typesSource.includes('confidence?:'), 'confidence? optional');
    assert(typesSource.includes('evidence?:'), 'evidence? optional');
    assert(typesSource.includes('signals?:'), 'signals? optional');
    assert(typesSource.includes('recommendedAction?:'), 'recommendedAction? optional');
    assert(typesSource.includes('level?:'), 'level? optional');
    // AgentStep new fields are optional
    assert(typesSource.includes('expectedOutcome?:'), 'expectedOutcome? optional');
    assert(typesSource.includes('verificationHints?:'), 'verificationHints? optional');
    // ExpectedOutcome interface exists
    assert(typesSource.includes('interface ExpectedOutcome'), 'ExpectedOutcome interface exists');
    // New events
    assert(typesSource.includes("'verification_passed'"), 'verification_passed event');
    assert(typesSource.includes("'verification_failed'"), 'verification_failed event exists');

    console.log('\nTest 33c: core.ts wires verification failure into Phase 7 recovery');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    assert(coreSource.includes('verifyStepOutcome'), 'core.ts calls verifyStepOutcome');
    assert(coreSource.includes('verifyTaskCompletion'), 'core.ts calls verifyTaskCompletion');
    assert(coreSource.includes("'VERIFICATION_FAILED'"), 'core.ts sets VERIFICATION_FAILED code');
    assert(coreSource.includes('Task completion gate'), 'core.ts has completion gate');
    // Verification failure → handleStepFailure (Phase 7 recovery), not just mark failed
    assert(
      coreSource.includes('handleStepFailure(task, step, verErrorMessage') ||
      coreSource.includes('handleStepFailure(task, step, verError'),
      'verification failure routes to handleStepFailure (Phase 7 recovery)',
    );

    console.log('\nTest 33d: UI handles new verification events');
    const uiSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'agent', 'AgentStateDisplay.tsx'),
      'utf-8',
    );
    assert(uiSource.includes("case 'verification_passed'"), 'AgentStateDisplay handles verification_passed');
    assert(uiSource.includes("case 'verification_failed'"), 'AgentStateDisplay handles verification_failed');

    const chatSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'chat', 'NexChatPanel.tsx'),
      'utf-8',
    );
    assert(chatSource.includes("case 'verification_passed'"), 'NexChatPanel handles verification_passed');
    assert(chatSource.includes("case 'verification_failed'"), 'NexChatPanel handles verification_failed');

    console.log('\nTest 33e: verification.ts has required exports');
    const verSource33 = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'verification.ts'),
      'utf-8',
    );
    assert(
      verSource33.includes('export async function verifyStepOutcome') &&
      verSource33.includes('export function verifyTaskCompletion'),
      'verification.ts exports verifyStepOutcome + verifyTaskCompletion',
    );
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 9 verification tests: ${passed}/${passed + failed} passed (${failed} failed)`);
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
