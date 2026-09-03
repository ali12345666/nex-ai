/**
 * Phase 7 — Infrastructure Tests
 *
 * Verifies the new infrastructure layer:
 *  - ToolRegistry
 *  - PermissionManager
 *  - Memory Architecture
 *  - AIRuntime abstraction
 *
 * Run with: node tests/local-ai/test-infra.js
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else      { fail++; console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

app.whenReady().then(async () => {
  try {
    console.log('\n=== Phase 7 Infrastructure Tests ===\n');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-infra-'));
    const { initPersistence } = require('../../dist/main/persistence');
    initPersistence(tmpDir);

    // ── 1. ToolRegistry ──
    console.log('1. ToolRegistry:');
    const { registerTool, unregisterTool, listTools, listToolDefinitions, getTool, getToolSchemasForLLM, ensureBuiltinToolsRegistered } =
      require('../../dist/main/ai/tool-registry');

    // Register built-in tools
    await ensureBuiltinToolsRegistered();
    const tools = listTools();
    const toolNames = tools.map((t) => t.definition.name);
    console.log('   Registered tools:', toolNames.join(', '));
    assert('at least 8 tools registered', tools.length >= 8, `only ${tools.length}`);
    assert('read_file registered', toolNames.includes('read_file'));
    assert('search_files registered', toolNames.includes('search_files'));
    assert('list_directory registered', toolNames.includes('list_directory'));
    assert('git_status registered', toolNames.includes('git_status'));
    assert('git_log registered', toolNames.includes('git_log'));
    assert('git_diff registered', toolNames.includes('git_diff'));
    assert('run_command registered', toolNames.includes('run_command'));
    assert('npm_build registered', toolNames.includes('npm_build'));
    assert('npm_test registered', toolNames.includes('npm_test'));
    assert('calculation registered', toolNames.includes('calculation'));
    assert('system_info registered', toolNames.includes('system_info'));

    // getTool
    const readFileTool = getTool('read_file');
    assert('getTool returns valid tool', !!readFileTool);
    assert('tool has definition', !!readFileTool?.definition);
    assert('tool definition has name', readFileTool?.definition.name === 'read_file');
    assert('tool definition has category', readFileTool?.definition.category === 'filesystem');
    assert('tool definition has permission', readFileTool?.definition.permission === 'read');
    assert('tool definition has parameters', Array.isArray(readFileTool?.definition.parameters));
    assert('tool definition has required parameter path', readFileTool?.definition.parameters.some((p) => p.name === 'path' && p.required));

    // listToolDefinitions
    const defs = listToolDefinitions();
    assert('listToolDefinitions returns same count', defs.length === tools.length);

    // getToolSchemasForLLM
    const schemas = getToolSchemasForLLM();
    assert('getToolSchemasForLLM returns array', Array.isArray(schemas));
    assert('first schema has name', !!schemas[0]?.name);
    assert('first schema has parameters', !!schemas[0]?.parameters);
    assert('first schema parameters is object type', schemas[0]?.parameters?.type === 'object');

    // ── 2. Tool execution ──
    console.log('\n2. Tool execution:');

    // Create a test file
    const testFile = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(testFile, 'Hello NEX AI!\nLine 2\nLine 3');

    const { executeTool } = require('../../dist/main/ai/tool-registry');
    const result = await executeTool('read_file', { path: testFile }, { projectPath: tmpDir });
    assert('read_file succeeds', result.success === true);
    assert('read_file returns content', result.output === 'Hello NEX AI!\nLine 2\nLine 3');

    // search_files
    const searchResult = await executeTool('search_files', { query: 'NEX', dir: tmpDir }, { projectPath: tmpDir });
    assert('search_files succeeds', searchResult.success === true);
    assert('search_files finds matches', searchResult.data?.count > 0);

    // list_directory
    const listResult = await executeTool('list_directory', { path: tmpDir }, { projectPath: tmpDir });
    assert('list_directory succeeds', listResult.success === true);
    assert('list_directory finds test.txt', listResult.data?.entries?.some((e) => e.name === 'test.txt'));

    // calculation
    const calcResult = await executeTool('calculation', { expression: '2 + 2 * 3' }, { projectPath: tmpDir });
    assert('calculation succeeds', calcResult.success === true);
    assert('calculation correct (2+2*3=8)', calcResult.data?.value === 8);

    const calcResult2 = await executeTool('calculation', { expression: 'sin(0) + cos(0)' }, { projectPath: tmpDir });
    assert('calculation with functions (sin(0)+cos(0)=1)', Math.abs(calcResult2.data?.value - 1) < 0.001);

    const calcResult3 = await executeTool('calculation', { expression: '2 ** 10' }, { projectPath: tmpDir });
    assert('calculation with power (2^10=1024)', calcResult3.data?.value === 1024);

    // system_info
    const sysResult = await executeTool('system_info', {}, { projectPath: tmpDir });
    assert('system_info succeeds', sysResult.success === true);
    assert('system_info returns platform', !!sysResult.data?.platform);

    // Unknown tool
    const unknownResult = await executeTool('nonexistent_tool', {}, { projectPath: tmpDir });
    assert('unknown tool returns error', unknownResult.success === false);

    // ── 3. PermissionManager ──
    console.log('\n3. PermissionManager:');
    const { requestPermission, respondToPermissionRequest, setPermissionRequestHandler, listAllGrants, clearSessionGrants } =
      require('../../dist/main/permissions');

    // Without a handler, requests should auto-deny (after timeout, but we won't wait)
    const req1 = requestPermission('test_tool', 'read', 'Test read', { sessionId: 'test1' });
    assert('permission request returns pending when no handler auto-denies', req1.status === 'pending' || req1.status === 'deny');

    // Set up a handler that auto-allows
    let capturedRequest = null;
    setPermissionRequestHandler((req) => {
      capturedRequest = req;
      // Auto-allow for this test
      setTimeout(() => {
        respondToPermissionRequest({
          requestId: req.id,
          decision: 'allow',
          scope: 'once',
        });
      }, 10);
    });

    const req2 = requestPermission('test_tool', 'read', 'Test read with handler', { sessionId: 'test2' });
    assert('request returns pending when handler set', req2.status === 'pending');

    // Wait for the auto-allow
    if (req2.requestId) {
      const { awaitPermissionDecision } = require('../../dist/main/permissions');
      const response = await awaitPermissionDecision(req2.requestId);
      assert('permission decision received', response.decision === 'allow');
      assert('captured request has tool name', capturedRequest?.tool === 'test_tool');
      assert('captured request has permission', capturedRequest?.permission === 'read');
      assert('captured request has description', capturedRequest?.description?.includes('Test'));
    }

    // ── 4. Memory Architecture ──
    console.log('\n4. Memory Architecture:');
    const { setMemory, getMemory, updateMemory, deleteMemory, queryMemory, listMemory, clearMemoryStore, UserMemory, ProjectMemory, TaskMemory } =
      require('../../dist/main/memory');

    // User memory
    const userEntry = UserMemory.set('language', 'en', { tags: ['pref'] });
    assert('UserMemory.set returns entry', !!userEntry?.id);
    const userEntry2 = UserMemory.get('language');
    assert('UserMemory.get retrieves entry', userEntry2?.value === 'en');
    assert('UserMemory.get has tags', userEntry2?.tags?.includes('pref'));
    const updated = UserMemory.update('language', 'fa');
    assert('UserMemory.update preserves id', updated?.id === userEntry.id);
    assert('UserMemory.update changes value', updated?.value === 'fa');
    assert('UserMemory.update preserves createdAt', updated?.createdAt === userEntry.createdAt);

    // Project memory (with projectId)
    ProjectMemory.set('arch', 'react-19', 'project-1');
    ProjectMemory.set('arch', 'nextjs-16', 'project-2'); // different project
    const proj1 = ProjectMemory.get('arch', 'project-1');
    const proj2 = ProjectMemory.get('arch', 'project-2');
    assert('ProjectMemory isolates per project', proj1?.value === 'react-19' && proj2?.value === 'nextjs-16');

    // Task memory with tags
    TaskMemory.set('plan', { steps: ['analyze', 'edit', 'test'] }, { tags: ['task', 'current'] });
    const tasks = TaskMemory.query({ tags: ['task'] });
    assert('TaskMemory.query with tag returns matches', tasks.length === 1);
    assert('TaskMemory.query returns correct entry', tasks[0]?.key === 'plan');

    // Delete
    const deleted = UserMemory.delete('language');
    assert('Memory.delete returns true on success', deleted === true);
    assert('Memory.delete removes entry', UserMemory.get('language') === null);

    // ── 5. AIRuntime Abstraction ──
    console.log('\n5. AIRuntime Abstraction:');
    const { getRuntime, getDefaultRuntime, listRuntimeTypes, shutdownAllRuntimes } =
      require('../../dist/main/ai/runtime');

    const types = listRuntimeTypes();
    assert('llamacpp runtime registered', types.includes('llamacpp'));

    const runtime = getDefaultRuntime();
    assert('getRuntime returns instance', !!runtime);
    assert('runtime has type llamacpp', runtime.type === 'llamacpp');
    assert('runtime has capabilities set', runtime.capabilities instanceof Set);
    assert('runtime capabilities include chat', runtime.capabilities.has('chat'));
    assert('runtime has init method', typeof runtime.init === 'function');
    assert('runtime has loadModel method', typeof runtime.loadModel === 'function');
    assert('runtime has chat method', typeof runtime.chat === 'function');
    assert('runtime has chatStream method', typeof runtime.chatStream === 'function');
    assert('runtime has abort method', typeof runtime.abort === 'function');
    assert('runtime has shutdown method', typeof runtime.shutdown === 'function');

    const stats = runtime.getStats();
    assert('runtime.getStats returns object', typeof stats === 'object');
    assert('runtime stats has type', stats.type === 'llamacpp');
    assert('runtime stats has loaded bool', typeof stats.loaded === 'boolean');

    // Cleanup
    await shutdownAllRuntimes();
    fs.rmSync(tmpDir, { recursive: true });

    console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===\n`);
    setTimeout(() => app.exit(fail > 0 ? 1 : 0), 100);
  } catch (err) {
    console.error('Top-level error:', err);
    console.error(err.stack);
    setTimeout(() => app.exit(1), 100);
  }
});
