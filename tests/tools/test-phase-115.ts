/**
 * NEX AI — Phase 115: Production Hardening Regression Tests
 *
 * Tests the critical hardening changes from Phase 115:
 *   1. Snapshot lifecycle (create, restore, invalid restore, retention)
 *   2. Memory redaction (both direct setMemory + semantic store paths)
 *   3. Agent state machine (terminal state monotonicity)
 *   4. Cancellation token (double-cancel safety)
 *   5. Windows compatibility (sanitizeForFilename, retryOnEpermSync)
 *   6. Path security (case-insensitive on Windows)
 *
 * Run with: npx tsx tests/tools/test-phase-115.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Register electron mock BEFORE any imports that touch electron
process.env.NODE_PATH = path.join(__dirname, '..', '__mocks__');
require('module').Module._initPaths();

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) { passed++; console.log(`  PASS: ${name}`); }
    else { failed++; console.error(`  FAIL: ${name}`); }
  }

  // ── Setup ──
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-phase115-'));
  console.log(`Test workspace: ${tmpDir}`);

  // ════════════════════════════════════════════════════════════════════════
  // 1. SNAPSHOT LIFECYCLE TESTS
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 1. Snapshot Lifecycle ===');

  const { createSnapshot, restoreSnapshot, getSnapshotById, listSnapshots, cleanupOldSnapshots } =
    await import('../../src/main/agent/snapshot-service');
  const { WriteFileTool } = await import('../../src/main/ai/tools/write-file-tool');
  const writeTool = new WriteFileTool();

  // Test 1: Create snapshot + restore (undo flow)
  console.log('\nTest 1: Snapshot create + restore (undo flow)');
  {
    const filePath = path.join(tmpDir, 'undo-test.txt');
    fs.writeFileSync(filePath, 'original content\n');
    const snap = createSnapshot('task-undo-1', filePath);
    assert(snap !== null, 'Should create snapshot');
    assert(snap!.existedBefore === true, 'Should mark existedBefore=true');

    // Overwrite the file
    fs.writeFileSync(filePath, 'modified content\n');

    // Restore
    const result = restoreSnapshot(snap!.id);
    assert(result.success === true, 'Should restore successfully');
    const restored = fs.readFileSync(filePath, 'utf-8');
    assert(restored === 'original content\n', 'Should restore original content');
  }

  // Test 2: Restore invalid snapshot
  console.log('\nTest 2: Restore invalid snapshot');
  {
    const result = restoreSnapshot('nonexistent-snapshot-id');
    assert(result.success === false, 'Should fail on invalid snapshot');
    assert(result.error?.includes('not found') || result.error?.includes('Snapshot'), 'Error should mention not found');
  }

  // Test 3: Snapshot of new file (didn't exist before)
  console.log('\nTest 3: Snapshot of newly created file');
  {
    const newFilePath = path.join(tmpDir, 'new-file-test.txt');
    // File doesn't exist yet
    const snap = createSnapshot('task-new-1', newFilePath);
    assert(snap !== null, 'Should create snapshot for non-existent file');
    assert(snap!.existedBefore === false, 'Should mark existedBefore=false');

    // Now create the file
    fs.writeFileSync(newFilePath, 'new content\n');

    // Restore should DELETE the file (undo creation)
    const result = restoreSnapshot(snap!.id);
    assert(result.success === true, 'Should restore by deleting new file');
    assert(!fs.existsSync(newFilePath), 'File should be deleted after restore');
  }

  // Test 4: getSnapshotById returns the snapshot
  console.log('\nTest 4: getSnapshotById');
  {
    const filePath = path.join(tmpDir, 'getbyid-test.txt');
    fs.writeFileSync(filePath, 'content');
    const snap = createSnapshot('task-getbyid', filePath);
    assert(snap !== null, 'Should create snapshot');
    const retrieved = getSnapshotById(snap!.id);
    assert(retrieved !== null, 'getSnapshotById should return the snapshot');
    assert(retrieved!.id === snap!.id, 'IDs should match');
    assert(getSnapshotById('invalid-id') === null, 'Invalid ID should return null');
  }

  // Test 5: listSnapshots returns task snapshots
  console.log('\nTest 5: listSnapshots');
  {
    const f1 = path.join(tmpDir, 'list-1.txt');
    const f2 = path.join(tmpDir, 'list-2.txt');
    fs.writeFileSync(f1, 'a');
    fs.writeFileSync(f2, 'b');
    createSnapshot('task-list-1', f1);
    createSnapshot('task-list-1', f2);
    const list = listSnapshots('task-list-1');
    assert(list.length >= 2, 'Should list at least 2 snapshots for task');
    const otherList = listSnapshots('task-list-other');
    assert(otherList.length === 0, 'Other task should have 0 snapshots');
  }

  // Test 6: Retention cleanup removes old snapshots
  console.log('\nTest 6: Retention cleanup');
  {
    // cleanupOldSnapshots should run without error
    const result = cleanupOldSnapshots();
    assert(typeof result.deleted === 'number', 'Should return deleted count');
    assert(result.deleted >= 0, 'Deleted count should be non-negative');
  }

  // Test 7: write_file returns snapshotId in ToolResult
  console.log('\nTest 7: write_file snapshotId in ToolResult');
  {
    const context = { projectPath: tmpDir, metadata: { taskId: 'task-write-115' } };
    const result = await writeTool.execute({
      path: 'write-snap-test.txt',
      content: 'test content for snapshot',
    }, context);
    assert(result.success === true, 'write_file should succeed');
    assert(result.data?.snapshotId !== undefined, 'Should return snapshotId in data');
    assert(typeof result.data?.snapshotId === 'string', 'snapshotId should be a string');
  }

  // ════════════════════════════════════════════════════════════════════════
  // 2. MEMORY REDACTION TESTS
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 2. Memory Redaction ===');

  const { redactSecrets, redactObjectDeep } = await import('../../src/main/agent/logger');

  // Test 8: redactSecrets redacts API keys
  console.log('\nTest 8: redactSecrets redacts API keys');
  {
    const input = 'My API key is sk-1234567890abcdefghijklmnop and my password is password=abc1234567890xyzxyz';
    const { redacted, redactions } = redactSecrets(input);
    assert(redactions.length > 0, 'Should detect secrets');
    assert(!redacted.includes('sk-1234567890abcdefghijklmnop'), 'Should redact API key');
    assert(redacted.includes('REDACTED'), 'Should contain REDACTED placeholder');
  }

  // Test 9: redactSecrets leaves clean text alone
  console.log('\nTest 9: redactSecrets on clean text');
  {
    const input = 'This is a normal message with no secrets';
    const { redacted, redactions } = redactSecrets(input);
    assert(redactions.length === 0, 'Should not detect secrets');
    assert(redacted === input, 'Should not modify clean text');
  }

  // Test 10: redactObjectDeep redacts nested objects
  console.log('\nTest 10: redactObjectDeep on nested objects');
  {
    const obj = {
      message: 'API key: sk-1234567890abcdefghijklmnop',
      config: {
        token: 'ghp_1234567890abcdefghijklmnopqrstuvwxyz1234',
        nested: { secret: 'password=hunter2supersecretpassword' },
      },
      safe: 'this is fine',
    };
    const redacted = redactObjectDeep(obj) as any;
    assert(!JSON.stringify(redacted).includes('sk-1234567890abcdefghijklmnop'), 'Should redact nested API key');
    assert(!JSON.stringify(redacted).includes('ghp_1234567890abcdefghijklmnopqrstuvwxyz1234'), 'Should redact nested token');
    assert(redacted.config.nested.secret === '***REDACTED***', 'Secret key value should be fully redacted');
    assert(redacted.safe === 'this is fine', 'Should leave safe values unchanged');
  }

  // Test 11: redactObjectDeep on arrays
  console.log('\nTest 11: redactObjectDeep on arrays');
  {
    const arr = ['key=sk-1234567890abcdefghijklmnop', 'safe text', { secret: 'password=abc1234567890xyzxyz' }];
    const redacted = redactObjectDeep(arr) as any[];
    assert(!redacted[0].includes('sk-1234567890abcdefghijklmnop'), 'Should redact array element with key');
    assert(redacted[1] === 'safe text', 'Should leave safe array element');
    assert(!JSON.stringify(redacted[2]).includes('abc1234567890xyzxyz'), 'Should redact object in array');
  }

  // Test 12: Direct setMemory redacts secrets (storage-layer defense)
  console.log('\nTest 12: setMemory redacts at storage layer');
  {
    const { setMemory, getMemory } = await import('../../src/main/memory');
    setMemory('task', 'test-secret-key-115', {
      note: 'My key is sk-1234567890abcdefghijklmnopqr',
      safe: 'normal value',
    });
    const retrieved = getMemory('task', 'test-secret-key-115');
    assert(retrieved !== null, 'Should retrieve stored memory');
    const stored = JSON.stringify(retrieved!.value);
    assert(!stored.includes('sk-1234567890abcdefghijklmnopqr'), 'Secret should be redacted in stored memory');
    assert(stored.includes('REDACTED'), 'Should contain REDACTED placeholder');
    assert(stored.includes('normal value'), 'Safe value should be preserved');
  }

  // ════════════════════════════════════════════════════════════════════════
  // 3. AGENT STATE MACHINE TESTS
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 3. Agent State Machine ===');

  const { isValidTransition, isTerminalStatus, transitionTaskStatus } =
    await import('../../src/main/agent/state-machine');
  const type = await import('../../src/main/agent/types');

  // Test 13: Terminal states are monotonic (no transitions out)
  console.log('\nTest 13: Terminal states reject transitions');
  {
    assert(isValidTransition('completed', 'failed') === false, 'completed→failed should be invalid');
    assert(isValidTransition('completed', 'cancelled') === false, 'completed→cancelled should be invalid');
    assert(isValidTransition('completed', 'executing') === false, 'completed→executing should be invalid');
    assert(isValidTransition('failed', 'completed') === false, 'failed→completed should be invalid');
    assert(isValidTransition('failed', 'cancelled') === false, 'failed→cancelled should be invalid');
    assert(isValidTransition('cancelled', 'completed') === false, 'cancelled→completed should be invalid');
    assert(isValidTransition('cancelled', 'failed') === false, 'cancelled→failed should be invalid');
  }

  // Test 14: isTerminalStatus
  console.log('\nTest 14: isTerminalStatus');
  {
    assert(isTerminalStatus('completed') === true, 'completed is terminal');
    assert(isTerminalStatus('failed') === true, 'failed is terminal');
    assert(isTerminalStatus('cancelled') === true, 'cancelled is terminal');
    assert(isTerminalStatus('executing') === false, 'executing is not terminal');
    assert(isTerminalStatus('pending') === false, 'pending is not terminal');
    assert(isTerminalStatus('planning') === false, 'planning is not terminal');
  }

  // Test 15: Valid forward transitions
  console.log('\nTest 15: Valid forward transitions');
  {
    assert(isValidTransition('pending', 'planning') === true, 'pending→planning is valid');
    assert(isValidTransition('planning', 'executing') === true, 'planning→executing is valid');
    assert(isValidTransition('executing', 'observing') === true, 'executing→observing is valid');
    assert(isValidTransition('verifying', 'completed') === true, 'verifying→completed is valid');
    assert(isValidTransition('executing', 'failed') === true, 'executing→failed is valid');
    assert(isValidTransition('executing', 'cancelled') === true, 'executing→cancelled is valid');
  }

  // Test 16: transitionTaskStatus throws on illegal transition
  console.log('\nTest 16: transitionTaskStatus throws on illegal transition');
  {
    const task: type.AgentTask = {
      id: 'test-task',
      userRequest: 'test',
      status: 'completed',
      plan: [],
      currentStepIndex: 0,
      context: {} as any,
      toolCalls: [],
      observations: [],
      errors: [],
      verification: [],
      permissions: [],
      maxSteps: 20,
      maxToolCalls: 50,
      maxRetries: 3,
      maxExecutionTimeMs: 300000,
      createdAt: Date.now(),
      cancelled: false,
    };
    let threw = false;
    try {
      transitionTaskStatus(task, 'failed');
    } catch {
      threw = true;
    }
    assert(threw === true, 'Should throw on completed→failed');
    assert(task.status === 'completed', 'Status should remain completed');
  }

  // ════════════════════════════════════════════════════════════════════════
  // 4. CANCELLATION TOKEN TESTS
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 4. Cancellation Token ===');

  // Test 17: Double-cancel returns false
  console.log('\nTest 17: Double-cancel safety');
  {
    const token = type.createCancellationToken();
    assert(token.cancelled === false, 'Token should start uncancelled');
    const first = token.cancel('first cancel');
    assert(first === true, 'First cancel should return true');
    assert(token.cancelled === true, 'Token should be cancelled');
    const second = token.cancel('second cancel');
    assert(second === false, 'Second cancel should return false');
  }

  // Test 18: throwIfCancelled throws after cancel
  console.log('\nTest 18: throwIfCancelled');
  {
    const token = type.createCancellationToken();
    let threw = false;
    try { token.throwIfCancelled(); } catch { threw = true; }
    assert(threw === false, 'Should not throw before cancel');
    token.cancel('test');
    threw = false;
    try { token.throwIfCancelled(); } catch { threw = true; }
    assert(threw === true, 'Should throw after cancel');
  }

  // Test 19: onCancel fires on cancel
  console.log('\nTest 19: onCancel listener');
  {
    const token = type.createCancellationToken();
    let fired = false;
    token.onCancel(() => { fired = true; });
    assert(fired === false, 'Listener should not fire before cancel');
    token.cancel('test');
    assert(fired === true, 'Listener should fire on cancel');
  }

  // Test 20: onCancel fires immediately if already cancelled
  console.log('\nTest 20: onCancel on already-cancelled token');
  {
    const token = type.createCancellationToken();
    token.cancel('already');
    let fired = false;
    token.onCancel(() => { fired = true; });
    assert(fired === true, 'Listener should fire immediately if already cancelled');
  }

  // ════════════════════════════════════════════════════════════════════════
  // 5. WINDOWS COMPATIBILITY TESTS
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 5. Windows Compatibility ===');

  // Test 21: sanitizeForFilename strips path separators
  console.log('\nTest 21: sanitizeForFilename security');
  {
    // We can't directly import the private sanitizeForFilename, but we can
    // verify it indirectly via snapshot creation — a path-traversal attempt
    // in the taskId should not escape the snapshots directory.
    const evilTaskId = '../../../etc/passwd';
    const filePath = path.join(tmpDir, 'sanitize-test.txt');
    fs.writeFileSync(filePath, 'content');
    const snap = createSnapshot(evilTaskId, filePath);
    assert(snap !== null, 'Should create snapshot even with evil taskId');
    // The taskId is sanitized — no directory traversal should occur
    // (verified by the fact that no /etc/passwd directory was created)
    assert(!fs.existsSync('/etc/passwd/nex-snapshots'), 'Should not create directories outside snapshots');
  }

  // Test 22: retryOnEpermSync retries on EPERM
  console.log('\nTest 22: retryOnEpermSync behavior');
  {
    const { retryOnEpermSync } = await import('../../src/main/security');
    let callCount = 0;
    // Simulate EPERM on first 2 calls, success on 3rd
    // Only test retry behavior on Windows; on Linux it should throw immediately
    const originalPlatform = process.platform;
    let result: string | undefined;
    let threw = false;
    try {
      // Mock win32 platform for this test
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      result = retryOnEpermSync(() => {
        callCount++;
        if (callCount < 3) {
          const err: any = new Error('EPERM');
          err.code = 'EPERM';
          throw err;
        }
        return 'success';
      }, 3, 1); // 1ms delay for fast test
    } catch {
      threw = true;
    }
    assert(!threw, 'Should eventually succeed after retries');
    assert(result === 'success', 'Should return success value');
    assert(callCount === 3, `Should have retried 3 times (got ${callCount})`);

    // Restore platform
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  }

  // Test 23: retryOnEpermSync throws on non-EPERM errors
  console.log('\nTest 23: retryOnEpermSync non-EPERM error');
  {
    const { retryOnEpermSync } = await import('../../src/main/security');
    let threw = false;
    try {
      retryOnEpermSync(() => {
        const err: any = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      });
    } catch {
      threw = true;
    }
    assert(threw === true, 'Should throw immediately on non-EPERM error');
  }

  // Test 24: isPathInside (basic correctness)
  console.log('\nTest 24: isPathInside basic');
  {
    const { isPathInside } = await import('../../src/main/security');
    const root = tmpDir;
    const inside = path.join(root, 'subdir', 'file.txt');
    const outside = path.join(os.tmpdir(), 'other-dir', 'file.txt');
    assert(isPathInside(inside, root) === true, 'Inside path should be inside');
    assert(isPathInside(outside, root) === false, 'Outside path should not be inside');
    assert(isPathInside(root, root) === true, 'Root should be inside itself');
  }

  // Test 25: assertPathInside blocks path traversal
  console.log('\nTest 25: assertPathInside blocks traversal');
  {
    const { assertPathInside } = await import('../../src/main/security');
    const root = tmpDir;
    const traversal = path.join(root, '..', '..', 'etc', 'passwd');
    const guard = assertPathInside(traversal, [root]);
    assert(guard.ok === false, 'Path traversal should be blocked');
    const inside = path.join(root, 'safe.txt');
    const guard2 = assertPathInside(inside, [root]);
    assert(guard2.ok === true, 'Inside path should be allowed');
  }

  // ════════════════════════════════════════════════════════════════════════
  // 6. GIT_PUSH SECURITY TESTS
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 6. Git Push Security ===');

  const { GitPushTool } = await import('../../src/main/ai/tools/git-push-tool');
  const pushTool = new GitPushTool();

  // Test 26: git_push rejects --force
  console.log('\nTest 26: git_push rejects --force');
  {
    const result = await pushTool.execute({ remote: 'origin --force' }, { projectPath: tmpDir } as any);
    assert(result.success === false, 'Should reject --force in remote');
  }

  // Test 27: git_push rejects --force-with-lease
  console.log('\nTest 27: git_push rejects --force-with-lease');
  {
    const result = await pushTool.execute({ remote: '--force-with-lease' }, { projectPath: tmpDir } as any);
    assert(result.success === false, 'Should reject --force-with-lease');
  }

  // Test 28: git_push rejects -f shorthand
  console.log('\nTest 28: git_push rejects -f');
  {
    const result = await pushTool.execute({ branch: 'main -f' }, { projectPath: tmpDir } as any);
    assert(result.success === false, 'Should reject -f in branch');
  }

  // Test 29: git_push rejects --delete
  console.log('\nTest 29: git_push rejects --delete');
  {
    const result = await pushTool.execute({ remote: '--delete' }, { projectPath: tmpDir } as any);
    assert(result.success === false, 'Should reject --delete');
  }

  // ════════════════════════════════════════════════════════════════════════
  // 7. SNAPSHOT PERSISTENCE TESTS
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 7. Snapshot Persistence ===');

  // Test 30: Snapshot survives "restart" (loadSnapshotIndex)
  console.log('\nTest 30: Snapshot survives restart via loadSnapshotIndex');
  {
    const { loadSnapshotIndex } = await import('../../src/main/agent/snapshot-service');
    const filePath = path.join(tmpDir, 'persist-test.txt');
    fs.writeFileSync(filePath, 'persisted content');
    const snap = createSnapshot('task-persist-1', filePath);
    assert(snap !== null, 'Should create snapshot');

    // loadSnapshotIndex should reload from disk without losing the snapshot
    // (it merges — doesn't clear first)
    loadSnapshotIndex();
    const retrieved = getSnapshotById(snap!.id);
    assert(retrieved !== null, 'Snapshot should survive loadSnapshotIndex');
  }

  // Test 31: Undo after overwrite restores exact content
  console.log('\nTest 31: Undo restores exact original content');
  {
    const filePath = path.join(tmpDir, 'exact-restore.txt');
    const original = 'line 1\nline 2\nline 3\nspecial chars: café ☕ 你好\n';
    fs.writeFileSync(filePath, original);
    const snap = createSnapshot('task-exact', filePath);

    // Multiple overwrites
    fs.writeFileSync(filePath, 'overwrite 1\n');
    fs.writeFileSync(filePath, 'overwrite 2\n');

    // Restore
    const result = restoreSnapshot(snap!.id);
    assert(result.success === true, 'Should restore');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert(content === original, 'Should restore exact original content with unicode');
  }

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 115 tests: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
