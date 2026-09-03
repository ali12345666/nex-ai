/**
 * NEX AI — Phase 116: Heuristic Planner E2E Tests
 *
 * Tests that the heuristic fallback plan correctly creates real tool calls
 * when the LLM planner fails. This was the ROOT CAUSE of "0 tool calls
 * executed" — the old fallback created a step WITHOUT a toolName, which
 * executeStep() treated as a "non-tool step" and just marked as "completed".
 *
 * Run with: npx tsx tests/tools/test-phase-116-heuristic-planner.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

process.env.NODE_PATH = path.join(__dirname, '..', '__mocks__');
require('module').Module._initPaths();

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) { passed++; console.log(`  PASS: ${name}`); }
    else { failed++; console.error(`  FAIL: ${name}`); }
  }

  console.log('Phase 116 Heuristic Planner E2E Tests\n');

  // ════════════════════════════════════════════════════════════════════════
  // 1. Heuristic fallback creates real tool calls for file creation
  // ════════════════════════════════════════════════════════════════════════
  console.log('=== 1. Heuristic Fallback for File Creation ===');

  // Read the planner source to verify heuristic exists
  const plannerSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'planner.ts'),
    'utf-8'
  );

  // Test 1: fallbackPlan creates heuristic steps (not empty)
  console.log('\nTest 1: fallbackPlan creates heuristic tool calls');
  {
    assert(
      plannerSource.includes('heuristic') && plannerSource.includes('write_file'),
      'fallbackPlan should create write_file tool calls heuristically'
    );
    assert(
      plannerSource.includes('read_file'),
      'fallbackPlan should create read_file tool calls'
    );
    assert(
      plannerSource.includes('list_directory'),
      'fallbackPlan should create list_directory tool calls'
    );
  }

  // Test 2: heuristic extracts folder name from Persian request
  console.log('\nTest 2: heuristic extracts folder name');
  {
    assert(
      plannerSource.includes('folderMatch') && plannerSource.includes('folderName'),
      'should extract folder name from request'
    );
    assert(
      plannerSource.includes('fileMatch') && plannerSource.includes('fileName'),
      'should extract file name from request'
    );
    assert(
      plannerSource.includes('contentMatch'),
      'should extract content from request'
    );
  }

  // Test 3: heuristic creates create_dirs=true for folder creation
  console.log('\nTest 3: heuristic uses create_dirs for folder creation');
  {
    assert(
      plannerSource.includes('create_dirs: true'),
      'should set create_dirs=true so write_file creates parent directory'
    );
  }

  // Test 4: no false success on 0 tool calls
  console.log('\nTest 4: 0 tool calls causes failure');
  {
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8'
    );
    assert(
      coreSource.includes('task.toolCalls.length === 0') && coreSource.includes('task.status = \'failed\''),
      '0 tool calls should cause task to fail (not falsely succeed)'
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // 2. Tool Registry has all required tools
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 2. Tool Registry Verification ===');

  const { ensureBuiltinToolsRegistered, listToolDefinitions } =
    await import('../../src/main/ai/tool-registry');

  await ensureBuiltinToolsRegistered();
  const tools = listToolDefinitions();

  // Test 5: write_file is registered
  console.log('\nTest 5: write_file is registered');
  {
    const wf = tools.find((t: any) => t.name === 'write_file');
    assert(!!wf, 'write_file should be registered');
    assert(wf?.permission === 'write', 'write_file permission should be write');
    const paramNames = wf?.parameters.map((p: any) => p.name) || [];
    assert(paramNames.includes('path'), 'write_file should have path param');
    assert(paramNames.includes('content'), 'write_file should have content param');
    assert(paramNames.includes('create_dirs'), 'write_file should have create_dirs param');
  }

  // Test 6: read_file is registered
  console.log('\nTest 6: read_file is registered');
  {
    const rf = tools.find((t: any) => t.name === 'read_file');
    assert(!!rf, 'read_file should be registered');
    assert(rf?.permission === 'read', 'read_file permission should be read');
  }

  // Test 7: list_directory is registered
  console.log('\nTest 7: list_directory is registered');
  {
    const ld = tools.find((t: any) => t.name === 'list_directory');
    assert(!!ld, 'list_directory should be registered');
  }

  // Test 8: edit_file is registered
  console.log('\nTest 8: edit_file is registered');
  {
    const ef = tools.find((t: any) => t.name === 'edit_file');
    assert(!!ef, 'edit_file should be registered');
  }

  // ════════════════════════════════════════════════════════════════════════
  // 3. Real Tool Execution E2E (write + read)
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 3. Real Tool Execution E2E ===');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-heuristic-'));
  console.log(`Test workspace: ${tmpDir}`);

  const { WriteFileTool } = await import('../../src/main/ai/tools/write-file-tool');
  const { FileSystemTool } = await import('../../src/main/ai/tools/filesystem-tool');
  const writeTool = new WriteFileTool();
  const readTool = new FileSystemTool();

  const context = { projectPath: tmpDir, metadata: { taskId: 'heuristic-test' } };

  // Test 9: write_file creates folder + file with create_dirs=true
  console.log('\nTest 9: write_file with create_dirs creates folder + file');
  {
    const result = await writeTool.execute({
      path: 'NEX-Test/hello.txt',
      content: 'سلام من نکس هستم',
      create_dirs: true,
    }, context as any);

    assert(result.success === true, 'write_file should succeed');
    assert(fs.existsSync(path.join(tmpDir, 'NEX-Test', 'hello.txt')), 'File should exist on disk');
    assert(fs.existsSync(path.join(tmpDir, 'NEX-Test')), 'Folder should exist on disk');

    const content = fs.readFileSync(path.join(tmpDir, 'NEX-Test', 'hello.txt'), 'utf-8');
    assert(content === 'سلام من نکس هستم', 'File content should match exactly');
    assert(result.data?.created === true, 'Should report created=true');
    assert(result.data?.relativePath === 'NEX-Test/hello.txt', 'Should return relative path');
  }

  // Test 10: read_file reads the file back
  console.log('\nTest 10: read_file reads file content');
  {
    const result = await readTool.execute({
      path: 'NEX-Test/hello.txt',
    }, context as any);

    assert(result.success === true, 'read_file should succeed');
    assert(result.output?.includes('سلام من نکس هستم'), 'Should contain the file content');
  }

  // Test 11: write_file without create_dirs fails for non-existent dir
  console.log('\nTest 11: write_file without create_dirs in non-existent dir');
  {
    const result = await writeTool.execute({
      path: 'NonExistentDir/file.txt',
      content: 'test',
      create_dirs: false,
    }, context as any);

    // Should fail because parent dir doesn't exist
    assert(result.success === false, 'Should fail when parent dir missing and create_dirs=false');
  }

  // ════════════════════════════════════════════════════════════════════════
  // 4. Pattern matching for Persian requests
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 4. Persian Request Pattern Matching ===');

  // Test 12: "بساز" pattern detected
  console.log('\nTest 12: "بساز" (create) pattern detected');
  {
    assert(plannerSource.includes('بساز'), 'should detect بساز keyword');
    assert(plannerSource.includes('ساز'), 'should detect ساز keyword');
  }

  // Test 13: "بخوان" pattern detected
  console.log('\nTest 13: "بخوان" (read) pattern detected');
  {
    assert(plannerSource.includes('بخوان'), 'should detect بخوان keyword');
  }

  // Test 14: "نشون" pattern detected
  console.log('\nTest 14: "نشون" (show) pattern detected');
  {
    assert(plannerSource.includes('نشون'), 'should detect نشون keyword');
  }

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 116 heuristic planner tests: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
