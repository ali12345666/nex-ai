/**
 * NEX AI — Phase 114: edit_file + git_push + snapshot retention tests
 *
 * Run with: npx tsx tests/tools/test-phase-114.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

async function runTests() {
  const { EditFileTool } = await import('../../src/main/ai/tools/edit-file-tool');
  const { GitPushTool } = await import('../../src/main/ai/tools/git-push-tool');
  const { WriteFileTool } = await import('../../src/main/ai/tools/write-file-tool');
  const { safeExecFile } = await import('../../src/main/security/shell');

  const editTool = new EditFileTool();
  const pushTool = new GitPushTool();
  const writeTool = new WriteFileTool();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-phase114-'));
  console.log(`Test workspace: ${tmpDir}`);

  // Initialize git repo
  await safeExecFile('git', ['init'], { cwd: tmpDir, timeout: 5000 });
  await safeExecFile('git', ['config', 'user.email', 'test@nex.ai'], { cwd: tmpDir, timeout: 5000 });
  await safeExecFile('git', ['config', 'user.name', 'NEX Test'], { cwd: tmpDir, timeout: 5000 });

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) { passed++; console.log(`  PASS: ${name}`); }
    else { failed++; console.error(`  FAIL: ${name}`); }
  }

  const context = { projectPath: tmpDir, metadata: { taskId: 'phase114-test' } };

  // ── edit_file tests ──
  console.log('\n=== edit_file tests ===');

  // Test 1: Exact single replacement
  console.log('\nTest 1: Exact single replacement');
  {
    await writeTool.execute({ path: 'edit-test.txt', content: 'Hello World\nFoo Bar\nHello Again' }, context);
    const result = await editTool.execute({ path: 'edit-test.txt', old_text: 'Foo Bar', new_text: 'Baz Qux' }, context);
    assert(result.success === true, 'Should succeed');
    const content = fs.readFileSync(path.join(tmpDir, 'edit-test.txt'), 'utf-8');
    assert(content === 'Hello World\nBaz Qux\nHello Again', 'Content should be updated');
    assert(result.data?.occurrencesReplaced === 1, 'Should report 1 occurrence');
  }

  // Test 2: Ambiguous match (multiple occurrences, no expected_occurrences)
  console.log('\nTest 2: Ambiguous match rejected');
  {
    const result = await editTool.execute({ path: 'edit-test.txt', old_text: 'Hello', new_text: 'Hi' }, context);
    assert(result.success === false, 'Should fail on ambiguous match');
    assert(result.error?.includes('occurrences'), 'Error should mention occurrences');
  }

  // Test 3: Multiple occurrences with expected_occurrences
  console.log('\nTest 3: Multiple occurrences with expected_occurrences');
  {
    const result = await editTool.execute({ path: 'edit-test.txt', old_text: 'Hello', new_text: 'Hi', expected_occurrences: 2 }, context);
    assert(result.success === true, 'Should succeed with expected count');
    assert(result.data?.occurrencesReplaced === 2, 'Should report 2 occurrences');
  }

  // Test 4: Wrong expected_occurrences
  console.log('\nTest 4: Wrong expected_occurrences');
  {
    const result = await editTool.execute({ path: 'edit-test.txt', old_text: 'Hi', new_text: 'Hello', expected_occurrences: 5 }, context);
    assert(result.success === false, 'Should fail with wrong count');
  }

  // Test 5: old_text not found
  console.log('\nTest 5: old_text not found');
  {
    const result = await editTool.execute({ path: 'edit-test.txt', old_text: 'NonExistent', new_text: 'Nothing' }, context);
    assert(result.success === false, 'Should fail');
    assert(result.error?.includes('not found'), 'Error should mention not found');
  }

  // Test 6: File not found
  console.log('\nTest 6: File not found');
  {
    const result = await editTool.execute({ path: 'nonexistent.txt', old_text: 'a', new_text: 'b' }, context);
    assert(result.success === false, 'Should fail');
  }

  // Test 7: Path traversal
  console.log('\nTest 7: Path traversal denied');
  {
    const result = await editTool.execute({ path: '../../../etc/passwd', old_text: 'a', new_text: 'b' }, context);
    assert(result.success === false, 'Should deny');
  }

  // Test 8: .ssh denied
  console.log('\nTest 8: .ssh denied');
  {
    const sshPath = path.join(os.homedir(), '.ssh', 'id_rsa');
    const result = await editTool.execute({ path: sshPath, old_text: 'a', new_text: 'b' }, context);
    assert(result.success === false, 'Should deny');
  }

  // Test 9: Identical old/new text
  console.log('\nTest 9: Identical old/new text');
  {
    const result = await editTool.execute({ path: 'edit-test.txt', old_text: 'Hello', new_text: 'Hello' }, context);
    assert(result.success === false, 'Should fail');
  }

  // Test 10: Snapshot created
  console.log('\nTest 10: Snapshot created by edit_file');
  {
    // Use a fresh file to avoid interference from earlier tests
    await writeTool.execute({ path: 'snapshot-edit-test.txt', content: 'line1\nold text\nline3' }, context);
    const result = await editTool.execute({ path: 'snapshot-edit-test.txt', old_text: 'old text', new_text: 'new text' }, context);
    assert(result.success === true, 'Should succeed');
    assert(result.data?.snapshotId !== undefined, 'Should return snapshotId');
  }

  // Test 11: edit_file schema
  console.log('\nTest 11: edit_file schema');
  {
    assert(editTool.definition.name === 'edit_file', 'Name should be edit_file');
    assert(editTool.definition.permission === 'write', 'Permission should be write');
    assert(editTool.definition.parameters.length === 4, 'Should have 4 params');
  }

  // ── git_push tests ──
  console.log('\n=== git_push tests ===');

  // Test 12: git_push outside repo
  console.log('\nTest 12: git_push outside repo');
  {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-outside-push-'));
    const result = await pushTool.execute({ cwd: outsideDir }, { projectPath: outsideDir, metadata: {} });
    assert(result.success === false, 'Should fail outside repo');
    try { fs.rmSync(outsideDir, { recursive: true, force: true }); } catch { /* */ }
  }

  // Test 13: git_push with no remote
  console.log('\nTest 13: git_push with no remote');
  {
    const result = await pushTool.execute({}, context);
    assert(result.success === false, 'Should fail with no remote');
    assert(result.error?.includes('not found') || result.error?.includes('remote'), 'Error should mention remote');
  }

  // Test 14: git_push forbidden args (--force)
  console.log('\nTest 14: git_push rejects --force');
  {
    const result = await pushTool.execute({ remote: 'origin --force' }, context);
    assert(result.success === false, 'Should reject --force');
  }

  // Test 15: git_push schema
  console.log('\nTest 15: git_push schema');
  {
    assert(pushTool.definition.name === 'git_push', 'Name should be git_push');
    assert(pushTool.definition.permission === 'git', 'Permission should be git');
  }

  // ── Snapshot retention tests ──
  console.log('\n=== Snapshot retention tests ===');

  // Test 16: cleanupOldSnapshots doesn't crash
  console.log('\nTest 16: cleanupOldSnapshots runs without crash');
  {
    const { cleanupOldSnapshots } = await import('../../src/main/agent/snapshot-service');
    const result = cleanupOldSnapshots();
    assert(typeof result.deleted === 'number', 'Should return deleted count');
    assert(typeof result.reason === 'string', 'Should return reason');
  }

  // Test 17: getSnapshotById returns null for unknown
  console.log('\nTest 17: getSnapshotById returns null for unknown');
  {
    const { getSnapshotById } = await import('../../src/main/agent/snapshot-service');
    const result = getSnapshotById('nonexistent-id');
    assert(result === null, 'Should return null');
  }

  // Test 18: listSnapshots returns array
  console.log('\nTest 18: listSnapshots returns array');
  {
    const { listSnapshots } = await import('../../src/main/agent/snapshot-service');
    const result = listSnapshots('phase114-test');
    assert(Array.isArray(result), 'Should return array');
  }

  // ── Undo / Restore tests ──
  console.log('\n=== Undo / Restore tests ===');

  // Test 19: Restore overwritten file
  console.log('\nTest 19: Restore overwritten file');
  {
    // Write original
    await writeTool.execute({ path: 'undo-test.txt', content: 'original content' }, context);
    // Overwrite (creates snapshot)
    const writeResult = await writeTool.execute({ path: 'undo-test.txt', content: 'modified content' }, context);
    assert(writeResult.data?.snapshotId !== undefined, 'Should have snapshotId');

    // Restore
    const { restoreSnapshot } = await import('../../src/main/agent/snapshot-service');
    const restoreResult = restoreSnapshot(writeResult.data.snapshotId);
    assert(restoreResult.success === true, 'Restore should succeed');

    const content = fs.readFileSync(path.join(tmpDir, 'undo-test.txt'), 'utf-8');
    assert(content === 'original content', 'Content should be restored to original');
  }

  // Test 20: Restore newly-created file (deletes it)
  console.log('\nTest 20: Restore newly-created file (deletes it)');
  {
    const writeResult = await writeTool.execute({ path: 'new-file-to-undo.txt', content: 'new file' }, context);
    assert(writeResult.data?.snapshotId !== undefined, 'Should have snapshotId');
    assert(fs.existsSync(path.join(tmpDir, 'new-file-to-undo.txt')), 'File should exist');

    const { restoreSnapshot } = await import('../../src/main/agent/snapshot-service');
    const restoreResult = restoreSnapshot(writeResult.data.snapshotId);
    assert(restoreResult.success === true, 'Restore should succeed');
    assert(!fs.existsSync(path.join(tmpDir, 'new-file-to-undo.txt')), 'File should be deleted');
  }

  // Test 21: Restore invalid snapshot
  console.log('\nTest 21: Restore invalid snapshot');
  {
    const { restoreSnapshot } = await import('../../src/main/agent/snapshot-service');
    const result = restoreSnapshot('invalid-id-12345');
    assert(result.success === false, 'Should fail');
    assert(result.error?.includes('not found'), 'Error should mention not found');
  }

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }

  console.log(`\n${passed}/${passed + failed} tests passed (${failed} failed)`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
