/**
 * NEX AI — Phase 113: git_commit + Snapshot Tests
 *
 * Tests for git_commit tool and snapshot service.
 * Run with: npx tsx tests/tools/test-git-commit-snapshot.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

async function runTests() {
  const { GitCommitTool } = await import('../../src/main/ai/tools/git-tools');
  const { WriteFileTool } = await import('../../src/main/ai/tools/write-file-tool');
  const gitTool = new GitCommitTool();
  const writeTool = new WriteFileTool();

  // Create a temporary git repo for testing
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-git-test-'));
  console.log(`Test workspace: ${tmpDir}`);

  // Initialize git repo
  const { safeExecFile } = await import('../../src/main/security/shell');
  await safeExecFile('git', ['init'], { cwd: tmpDir, timeout: 5000 });
  await safeExecFile('git', ['config', 'user.email', 'test@nex.ai'], { cwd: tmpDir, timeout: 5000 });
  await safeExecFile('git', ['config', 'user.name', 'NEX Test'], { cwd: tmpDir, timeout: 5000 });

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) {
      passed++;
      console.log(`  PASS: ${name}`);
    } else {
      failed++;
      console.error(`  FAIL: ${name}`);
    }
  }

  const context = { projectPath: tmpDir, metadata: { taskId: 'test-task-113' } };

  // ── Test 1: git_commit with no changes ──
  console.log('\nTest 1: git_commit with no changes');
  {
    const result = await gitTool.execute({ message: 'empty commit' }, context);
    assert(result.success === false, 'Should fail when no changes');
  }

  // ── Test 2: Create a file and commit ──
  console.log('\nTest 2: Create a file and commit');
  {
    // Write a file first
    const writeResult = await writeTool.execute(
      { path: 'README.md', content: '# Test Project\n\nThis is a test.' },
      context,
    );
    assert(writeResult.success === true, 'write_file should succeed');

    const result = await gitTool.execute({ message: 'feat: initial commit' }, context);
    assert(result.success === true, 'git_commit should succeed');
    assert(result.data?.hash !== undefined, 'Should return commit hash');
    assert(result.data?.message === 'feat: initial commit', 'Should return commit message');
  }

  // ── Test 3: Modify file and commit ──
  console.log('\nTest 3: Modify file and commit');
  {
    const writeResult = await writeTool.execute(
      { path: 'README.md', content: '# Test Project\n\nUpdated content.' },
      context,
    );
    assert(writeResult.success === true, 'write_file overwrite should succeed');

    const result = await gitTool.execute({ message: 'docs: update README' }, context);
    assert(result.success === true, 'git_commit should succeed for modification');
  }

  // ── Test 4: Empty commit message ──
  console.log('\nTest 4: Empty commit message');
  {
    const result = await gitTool.execute({ message: '' }, context);
    assert(result.success === false, 'Should fail with empty message');
    assert(result.error?.includes('empty'), 'Error should mention empty');
  }

  // ── Test 5: Missing message parameter ──
  console.log('\nTest 5: Missing message parameter');
  {
    const result = await gitTool.execute({}, context);
    assert(result.success === false, 'Should fail without message');
  }

  // ── Test 6: Too long commit message ──
  console.log('\nTest 6: Too long commit message');
  {
    const result = await gitTool.execute({ message: 'x'.repeat(600) }, context);
    assert(result.success === false, 'Should fail with too long message');
  }

  // ── Test 7: git_commit outside repository ──
  console.log('\nTest 7: git_commit outside repository');
  {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-outside-'));
    const result = await gitTool.execute(
      { message: 'test', cwd: outsideDir },
      { projectPath: outsideDir, metadata: {} },
    );
    assert(result.success === false, 'Should fail outside git repo');
    assert(result.error?.includes('git repository'), 'Error should mention git repository');
    try { fs.rmSync(outsideDir, { recursive: true, force: true }); } catch { /* */ }
  }

  // ── Test 8: Tool schema validation ──
  console.log('\nTest 8: git_commit tool schema');
  {
    assert(gitTool.definition.name === 'git_commit', 'Tool name should be git_commit');
    assert(gitTool.definition.permission === 'git', 'Permission should be git');
    assert(gitTool.definition.category === 'git', 'Category should be git');
    assert(gitTool.definition.parameters[0].name === 'message', 'First param should be message');
    assert(gitTool.definition.parameters[0].required === true, 'message should be required');
  }

  // ── Test 9: write_file creates snapshot ──
  console.log('\nTest 9: write_file creates snapshot');
  {
    // Write a file with known content
    await writeTool.execute(
      { path: 'snapshot-test.txt', content: 'original content' },
      context,
    );
    // Overwrite it — should create a snapshot
    const result = await writeTool.execute(
      { path: 'snapshot-test.txt', content: 'modified content' },
      context,
    );
    assert(result.success === true, 'Overwrite should succeed');
    assert(result.data?.snapshotId !== undefined, 'Should return snapshotId');
  }

  // ── Test 10: write_file for new file (snapshot marks as non-existent) ──
  console.log('\nTest 10: write_file for new file');
  {
    const result = await writeTool.execute(
      { path: 'brand-new-file.txt', content: 'new file content' },
      context,
    );
    assert(result.success === true, 'Should succeed');
    assert(result.data?.created === true, 'Should report created=true');
    assert(result.data?.snapshotId !== undefined, 'Should return snapshotId even for new files');
  }

  // ── Test 11: Tool error returns graceful ToolResult ──
  console.log('\nTest 11: Tool error returns graceful ToolResult');
  {
    const result = await gitTool.execute({ message: 'test' }, { projectPath: '/nonexistent/path', metadata: {} });
    assert(result.success === false, 'Should fail');
    assert(typeof result.error === 'string', 'Error should be a string');
  }

  // ── Test 12: write_file security regression (path traversal) ──
  console.log('\nTest 12: write_file path traversal still denied');
  {
    const result = await writeTool.execute(
      { path: '../../../etc/test', content: 'hacked' },
      context,
    );
    assert(result.success === false, 'Should deny path traversal');
  }

  // ── Test 13: write_file .ssh still denied ──
  console.log('\nTest 13: write_file .ssh still denied');
  {
    const sshPath = path.join(os.homedir(), '.ssh', 'test_key');
    const result = await writeTool.execute(
      { path: sshPath, content: 'secret' },
      context,
    );
    assert(result.success === false, 'Should deny .ssh path');
  }

  // ── Test 14: Verify git log shows commits ──
  console.log('\nTest 14: Git log shows commits');
  {
    const { GitLogTool } = await import('../../src/main/ai/tools/git-tools');
    const logTool = new GitLogTool();
    const result = await logTool.execute({ count: 5 }, context);
    assert(result.success === true, 'git_log should succeed');
    assert(result.data?.commits?.length >= 2, 'Should have at least 2 commits');
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
