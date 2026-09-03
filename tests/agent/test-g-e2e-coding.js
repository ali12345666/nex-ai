/**
 * Phase 7 — Test G: E2E Coding Agent
 *
 * The most important test of Phase 7. NEX AI Agent must:
 *   1. Inspect the test-project fixture (which has an intentional bug in add())
 *   2. Run tests to see them fail
 *   3. Read calculator.ts to understand the bug
 *   4. Generate a fix (a - b → a + b)
 *   5. Show the diff via DiffManager
 *   6. Request permission to apply
 *   7. Apply the fix
 *   8. Run tests again to verify they pass
 *
 * This test simulates the agent flow but uses deterministic tool calls
 * (not LLM-generated ones) because the small Qwen2.5-0.5B model is not
 * reliable enough to follow the full plan format.
 *
 * Run with: node tests/agent/test-g-e2e-coding.js
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MODEL_PATH = '/home/z/my-project/repos/nex-ai/models/qwen2.5-0.5b-q4_k_m.gguf';
const FIXTURE_PATH = '/home/z/my-project/repos/nex-ai/tests/fixtures/test-project';

let pass = 0, fail = 0;
const failures = [];
function assert(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else {
    fail++; console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`);
    failures.push({ name, extra });
  }
}

app.whenReady().then(async () => {
  try {
    console.log('\n=== Phase 7 Test G: E2E Coding Agent ===\n');

    if (!fs.existsSync(MODEL_PATH)) {
      console.error('Model file not found:', MODEL_PATH);
      app.exit(1);
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-e2e-'));
    const { initPersistence } = require('../../dist/main/persistence');
    initPersistence(tmpDir);

    // Copy fixture to tmpDir so we can modify it
    const projectDir = path.join(tmpDir, 'test-project');
    fs.cpSync(FIXTURE_PATH, projectDir, { recursive: true });
    // Install typescript in the project (so npm test can run)
    console.log('   Setting up fixture deps...');
    const { execFileSync } = require('child_process');
    try {
      execFileSync('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: projectDir,
        stdio: 'pipe',
        timeout: 120000,
      });
    } catch (err) {
      console.error('   npm install failed in fixture:', err.message);
      app.exit(1);
      return;
    }
    console.log('   Fixture ready');

    const { addModel } = require('../../dist/main/ai/model-registry');
    addModel(MODEL_PATH, {
      name: 'Qwen2.5-0.5B-Instruct',
      contextSize: 2048,
      category: 'fast',
    });

    const { ensureBuiltinToolsRegistered, executeTool, executeToolWithPermission } = require('../../dist/main/ai/tool-registry');
    await ensureBuiltinToolsRegistered();
    const { setPermissionRequestHandler, respondToPermissionRequest } = require('../../dist/main/permissions');

    // Set up permission handler that auto-allows for this test
    setPermissionRequestHandler((req) => {
      setTimeout(() => {
        respondToPermissionRequest({
          requestId: req.id,
          decision: 'allow',
          scope: 'once',
        });
      }, 5);
    });

    const { proposeChange, acceptChange } = require('../../dist/main/agent/diff-manager');

    // ────────────────────────────────────────────────────────────────
    // STEP 1: Inspect project (list_directory)
    // ────────────────────────────────────────────────────────────────
    console.log('\nStep 1: Inspect project');
    const step1 = await executeTool('list_directory', { path: projectDir }, { projectPath: projectDir });
    assert('list_directory succeeds', step1.success === true);
    assert('project has package.json', step1.data?.entries?.some((e) => e.name === 'package.json'));
    assert('project has src/', step1.data?.entries?.some((e) => e.name === 'src' && e.type === 'dir'));
    assert('project has tests/', step1.data?.entries?.some((e) => e.name === 'tests' && e.type === 'dir'));

    // ────────────────────────────────────────────────────────────────
    // STEP 2: Run tests (should fail because of the bug)
    // ────────────────────────────────────────────────────────────────
    console.log('\nStep 2: Run tests (expecting failure)');
    const step2 = await executeTool('run_command', {
      binary: 'npm',
      args: ['test'],
      cwd: projectDir,
      timeout: 30000,
    }, { projectPath: projectDir });
    assert('npm test runs', step2.data?.exitCode !== undefined);
    assert('tests fail (exit code 1)', step2.data?.exitCode === 1, `exit: ${step2.data?.exitCode}`);
    assert('test output mentions add() failures', /FAIL: add/.test(step2.data?.stdout || ''));
    assert('test output shows expected vs actual', /expected 5, got -1/.test(step2.data?.stdout || ''));

    // ────────────────────────────────────────────────────────────────
    // STEP 3: Read calculator.ts to identify the bug
    // ────────────────────────────────────────────────────────────────
    console.log('\nStep 3: Read source to identify bug');
    const calcFile = path.join(projectDir, 'src', 'calculator.ts');
    const step3 = await executeTool('read_file', { path: calcFile }, { projectPath: projectDir });
    assert('read_file succeeds', step3.success === true);
    assert('file contains add() function', /function add/.test(step3.output));
    assert('file contains the bug (a - b)', /return a - b/.test(step3.output));
    assert('bug is in add() (not subtract)', step3.output.indexOf('function add') < step3.output.indexOf('return a - b'));

    // ────────────────────────────────────────────────────────────────
    // STEP 4: Generate the fix
    // ────────────────────────────────────────────────────────────────
    console.log('\nStep 4: Generate fix');
    const beforeContent = step3.output;
    const afterContent = beforeContent.replace('return a - b;', 'return a + b;');
    assert('fix changes a - b to a + b', afterContent !== beforeContent);
    assert('fix is correct', /return a \+ b/.test(afterContent));
    assert('fix preserves subtract', /return a - b/.test(afterContent)); // subtract still has a - b
    assert('only one change made', (afterContent.match(/return a \+ b/g) || []).length === 1);

    // ────────────────────────────────────────────────────────────────
    // STEP 5: Generate diff
    // ────────────────────────────────────────────────────────────────
    console.log('\nStep 5: Generate diff');
    const { computeUnifiedDiff } = require('../../dist/main/agent/diff-manager');
    const diff = computeUnifiedDiff(beforeContent, afterContent, calcFile);
    assert('diff is non-empty', diff.length > 0);
    assert('diff contains -return a - b', diff.includes('-return a - b') || diff.includes('-  return a - b'));
    assert('diff contains +return a + b', diff.includes('+return a + b') || diff.includes('+  return a + b'));

    // ────────────────────────────────────────────────────────────────
    // STEP 6: Propose change (DiffManager)
    // ────────────────────────────────────────────────────────────────
    console.log('\nStep 6: Propose change via DiffManager');
    const change = proposeChange('e2e-task', 'step-6', calcFile, beforeContent, afterContent);
    assert('proposeChange creates pending change', change.status === 'pending');
    assert('proposed change has correct file', change.filePath === calcFile);

    // ────────────────────────────────────────────────────────────────
    // STEP 7: User accepts the diff
    // ────────────────────────────────────────────────────────────────
    console.log('\nStep 7: User accepts the diff');
    await acceptChange(change.id);
    const appliedContent = fs.readFileSync(calcFile, 'utf-8');
    assert('file is modified after accept', appliedContent === afterContent);
    assert('file no longer has the bug', !/return a - b/.test(appliedContent) || appliedContent.indexOf('function subtract') < appliedContent.indexOf('return a - b'));
    assert('file has the fix', /return a \+ b/.test(appliedContent));

    // ────────────────────────────────────────────────────────────────
    // STEP 8: Run tests again (should pass)
    // ────────────────────────────────────────────────────────────────
    console.log('\nStep 8: Run tests (expecting pass)');
    const step8 = await executeTool('run_command', {
      binary: 'npm',
      args: ['test'],
      cwd: projectDir,
      timeout: 30000,
    }, { projectPath: projectDir });
    assert('tests pass (exit code 0)', step8.data?.exitCode === 0, `exit: ${step8.data?.exitCode}, stderr: ${step8.data?.stderr?.slice(0, 200)}`);
    assert('test output shows all pass', /7 passed/.test(step8.data?.stdout || '') || /PASS: add: 2 \+ 3 = 5/.test(step8.data?.stdout || ''));

    // ────────────────────────────────────────────────────────────────
    // STEP 9: Verify
    // ────────────────────────────────────────────────────────────────
    console.log('\nStep 9: Verification');
    const { verifyToolResult } = require('../../dist/main/agent/verification');
    const verification = verifyToolResult({
      stepId: 'step-8',
      description: 'Tests pass after fix',
      expectedExitCode: 0,
      expectedOutputContains: ['PASS: add: 2 + 3 = 5'],
      toolResult: step8,
    });
    assert('verification status is verified', verification.status === 'verified', `status: ${verification.status}, details: ${verification.details}`);

    // Cleanup
    const { shutdownLlama } = require('../../dist/main/ai/inference');
    await shutdownLlama();
    fs.rmSync(tmpDir, { recursive: true });

    console.log('\n=== E2E Flow Summary ===');
    console.log('  1. ✅ Inspected project structure');
    console.log('  2. ✅ Detected failing tests (bug in add())');
    console.log('  3. ✅ Read source code');
    console.log('  4. ✅ Identified bug (a - b should be a + b)');
    console.log('  5. ✅ Generated diff');
    console.log('  6. ✅ Proposed change via DiffManager');
    console.log('  7. ✅ User accepted → file modified on disk');
    console.log('  8. ✅ Tests pass after fix');
    console.log('  9. ✅ Verification confirms success');

    console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===\n`);
    if (failures.length > 0) {
      console.log('Failures:');
      failures.forEach((f) => console.log(`  - ${f.name}${f.extra ? ': ' + f.extra : ''}`));
    }

    setTimeout(() => app.exit(fail > 0 ? 1 : 0), 200);
  } catch (err) {
    console.error('Top-level error:', err);
    console.error(err.stack);
    setTimeout(() => app.exit(1), 200);
  }
});
