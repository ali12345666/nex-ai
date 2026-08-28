/**
 * NEX AI — Phase 112: write_file Tool Tests
 *
 * Automated tests for the write_file tool.
 * Tests security, correctness, and error handling.
 *
 * Run with: npx tsx tests/tools/test-write-file.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

async function runTests() {
  const { WriteFileTool } = await import('../../src/main/ai/tools/write-file-tool');
  const tool = new WriteFileTool();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-test-'));
  console.log(`Test workspace: ${tmpDir}`);

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

  const context = { projectPath: tmpDir, metadata: {} };

  // Test 1: Create new file
  console.log('\nTest 1: Create new file');
  {
    const result = await tool.execute({ path: 'hello.txt', content: 'Hello, World!' }, context);
    assert(result.success === true, 'Should succeed');
    assert(fs.existsSync(path.join(tmpDir, 'hello.txt')), 'File should exist');
    assert(fs.readFileSync(path.join(tmpDir, 'hello.txt'), 'utf-8') === 'Hello, World!', 'Content should match');
    assert(result.data?.created === true, 'Should report created=true');
  }

  // Test 2: Overwrite existing file
  console.log('\nTest 2: Overwrite existing file');
  {
    const result = await tool.execute({ path: 'hello.txt', content: 'Updated content!' }, context);
    assert(result.success === true, 'Should succeed');
    assert(fs.readFileSync(path.join(tmpDir, 'hello.txt'), 'utf-8') === 'Updated content!', 'Content should be updated');
    assert(result.data?.overwritten === true, 'Should report overwritten=true');
    assert(result.modifiedFiles?.[0]?.before === 'Hello, World!', 'Should capture before content for undo');
  }

  // Test 3: Nested file (create parent dirs)
  console.log('\nTest 3: Nested file with parent directory creation');
  {
    const result = await tool.execute({ path: 'src/components/Button.tsx', content: 'export const Button = () => null;' }, context);
    assert(result.success === true, 'Should succeed');
    assert(fs.existsSync(path.join(tmpDir, 'src/components/Button.tsx')), 'Nested file should exist');
  }

  // Test 4: Path traversal denied
  console.log('\nTest 4: Path traversal denied');
  {
    const result = await tool.execute({ path: '../../../etc/passwd', content: 'hacked' }, context);
    assert(result.success === false, 'Should fail');
    assert(result.error?.includes('Access denied') || result.error?.includes('outside'), 'Error should mention access');
  }

  // Test 5: Outside workspace denied
  console.log('\nTest 5: Outside workspace denied');
  {
    const outsidePath = path.join(os.tmpdir(), 'outside-test.txt');
    const result = await tool.execute({ path: outsidePath, content: 'outside' }, context);
    assert(result.success === false, 'Should fail');
    assert(result.error?.includes('Access denied') || result.error?.includes('outside'), 'Error should mention access');
  }

  // Test 6: .ssh path denied
  console.log('\nTest 6: .ssh path denied');
  {
    const sshPath = path.join(os.homedir(), '.ssh', 'id_rsa');
    const result = await tool.execute({ path: sshPath, content: 'secret' }, context);
    assert(result.success === false, 'Should fail');
    assert(result.error?.includes('Access denied') || result.error?.includes('sensitive'), 'Error should mention access/sensitive');
  }

  // Test 7: Oversized content denied
  console.log('\nTest 7: Oversized content denied');
  {
    const largeContent = 'x'.repeat(3 * 1024 * 1024);
    const result = await tool.execute({ path: 'large.txt', content: largeContent }, context);
    assert(result.success === false, 'Should fail');
    assert(result.error?.includes('too large') || result.error?.includes('Max'), 'Error should mention size');
  }

  // Test 8: Binary content (null bytes) denied
  console.log('\nTest 8: Binary content denied');
  {
    const result = await tool.execute({ path: 'binary.txt', content: 'text\0binary' }, context);
    assert(result.success === false, 'Should fail');
    assert(result.error?.includes('binary') || result.error?.includes('null'), 'Error should mention binary');
  }

  // Test 9: Nonexistent parent with create_dirs=false
  console.log('\nTest 9: Nonexistent parent with create_dirs=false');
  {
    const result = await tool.execute({ path: 'nonexistent/dir/file.txt', content: 'test', create_dirs: false }, context);
    assert(result.success === false, 'Should fail when parent does not exist and create_dirs=false');
  }

  // Test 10: Tool error returns graceful ToolResult
  console.log('\nTest 10: Tool error returns graceful ToolResult');
  {
    const result = await tool.execute({ path: '', content: 'test' }, context);
    assert(result.success === false, 'Should fail');
    assert(typeof result.error === 'string', 'Error should be a string');
  }

  // Test 11: Missing content parameter
  console.log('\nTest 11: Missing content parameter');
  {
    const result = await tool.execute({ path: 'test.txt' }, context);
    assert(result.success === false, 'Should fail');
    assert(result.error?.includes('content'), 'Error should mention content');
  }

  // Test 12: Tool registration/schema
  console.log('\nTest 12: Tool definition/schema');
  {
    assert(tool.definition.name === 'write_file', 'Tool name should be write_file');
    assert(tool.definition.permission === 'write', 'Permission should be write');
    assert(tool.definition.category === 'filesystem', 'Category should be filesystem');
    assert(tool.definition.parameters.length === 3, 'Should have 3 parameters');
    assert(tool.definition.parameters[0].name === 'path', 'First param should be path');
    assert(tool.definition.parameters[0].required === true, 'path should be required');
    assert(tool.definition.parameters[1].name === 'content', 'Second param should be content');
    assert(tool.definition.parameters[1].required === true, 'content should be required');
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
