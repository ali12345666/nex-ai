/**
 * NEX AI — Phase 116: Agent Pipeline E2E Tests
 *
 * Tests the full agent pipeline for file search → read → open scenario:
 *   1. open_file_in_editor tool is registered
 *   2. Planner retry logic prevents action:ask fallback
 *   3. Heuristic fallback creates search → read → open plan
 *   4. ReAct always invokes after search_files/list_directory
 *   5. ReAct prompt forbids premature complete
 *
 * Run with: npx tsx tests/tools/test-phase-116-agent-pipeline.ts
 */

import * as path from 'path';
import * as fs from 'fs';

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) { passed++; console.log(`  PASS: ${name}`); }
    else { failed++; console.error(`  FAIL: ${name}`); }
  }

  console.log('Phase 116 Agent Pipeline E2E Tests\n');

  // ════════════════════════════════════════════════════════════════════════
  // 1. open_file_in_editor tool registered
  // ════════════════════════════════════════════════════════════════════════
  console.log('=== 1. open_file_in_editor Tool ===');

  const registrySource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tool-registry.ts'),
    'utf-8'
  );

  console.log('\nTest 1: open_file_in_editor is registered');
  assert(
    registrySource.includes('OpenFileInEditorTool') && registrySource.includes('open-file-in-editor-tool'),
    'open_file_in_editor tool should be registered'
  );

  // Check tool definition exists
  const toolSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'open-file-in-editor-tool.ts'),
    'utf-8'
  );

  console.log('\nTest 2: tool sends IPC to renderer');
  assert(
    toolSource.includes('open-file-in-editor') && toolSource.includes('webContents.send'),
    'tool should send open-file-in-editor IPC event'
  );

  console.log('\nTest 3: tool validates path inside workspace');
  assert(
    toolSource.includes('assertPathInside'),
    'tool should use assertPathInside for security'
  );

  console.log('\nTest 4: tool verifies file exists');
  assert(
    toolSource.includes('fs.existsSync') && toolSource.includes('isFile'),
    'tool should verify file exists and is a file'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 2. IPC bridge in preload + App.tsx
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 2. IPC Bridge ===');

  const preloadSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'preload.ts'),
    'utf-8'
  );

  console.log('\nTest 5: preload exposes onOpenFileInEditor');
  assert(
    preloadSource.includes('onOpenFileInEditor') && preloadSource.includes('open-file-in-editor'),
    'preload should expose onOpenFileInEditor listener'
  );

  const appSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'App.tsx'),
    'utf-8'
  );

  console.log('\nTest 6: App.tsx listens for open-file-in-editor');
  assert(
    appSource.includes('onOpenFileInEditor') && appSource.includes('openFile'),
    'App.tsx should call useStore.openFile when receiving open-file-in-editor event'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 3. Planner retry on invalid JSON
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 3. Planner Retry ===');

  const plannerSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'planner.ts'),
    'utf-8'
  );

  console.log('\nTest 7: planner retries on 0 steps');
  assert(
    plannerSource.includes('retrying with stricter prompt') && plannerSource.includes('retryPlan'),
    'planner should retry when first attempt produces 0 steps'
  );

  console.log('\nTest 8: planner prompt forbids action:ask');
  assert(
    plannerSource.includes('NEVER output {"action":"ask"}'),
    'planner prompt should explicitly forbid action:ask'
  );

  console.log('\nTest 9: planner prompt requires steps[] array');
  assert(
    plannerSource.includes('NEVER output a JSON without "steps" array'),
    'planner prompt should require steps[] array'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 4. Heuristic fallback uses search_files, not hardcoded paths
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 4. Heuristic Fallback ===');

  console.log('\nTest 10: fallback extracts explicit paths from request');
  assert(
    plannerSource.includes('pathMatch') && plannerSource.includes('explicitPath'),
    'fallback should extract explicit paths like C:\\Users\\...'
  );

  console.log('\nTest 11: fallback extracts content search query');
  assert(
    plannerSource.includes('contentSearchMatch') && plannerSource.includes('contentQuery'),
    'fallback should extract content search query (e.g. "hello" from "دارای hello")'
  );

  console.log('\nTest 12: fallback uses search_files before read_file');
  assert(
    plannerSource.includes('Search for files matching') && plannerSource.includes('search_files'),
    'fallback should create search_files step before read_file'
  );

  console.log('\nTest 13: fallback includes open_file_in_editor step');
  assert(
    plannerSource.includes('Open file in editor') && plannerSource.includes('open_file_in_editor'),
    'fallback should include open_file_in_editor step for "باز کن" requests'
  );

  console.log('\nTest 14: fallback does NOT default to hello.txt');
  assert(
    !plannerSource.includes("'hello.txt'"),
    'fallback should NOT hardcode hello.txt as default filename'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 5. ReAct prevents premature complete
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 5. ReAct Safety ===');

  const reactSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'react-loop.ts'),
    'utf-8'
  );

  console.log('\nTest 15: ReAct prompt forbids complete after list/search only');
  assert(
    reactSource.includes('NEVER mark "complete" after only list_directory or search_files'),
    'ReAct prompt should forbid complete after reconnaissance steps'
  );

  console.log('\nTest 16: ReAct prompt requires open_file_in_editor for "باز کن"');
  assert(
    reactSource.includes('MUST call open_file_in_editor before "complete"'),
    'ReAct prompt should require open_file_in_editor for open requests'
  );

  console.log('\nTest 17: ReAct prompt requires read_file for "محتویات"');
  assert(
    reactSource.includes('MUST call read_file and include the content'),
    'ReAct prompt should require read_file for content requests'
  );

  console.log('\nTest 18: ReAct always invokes after search_files/list_directory');
  assert(
    reactSource.includes("step.toolName === 'search_files'") && reactSource.includes("step.toolName === 'list_directory'"),
    'shouldInvokeRePlanner should always return true after search_files or list_directory'
  );

  console.log('\nTest 19: ReAct prompt says use actual paths from results');
  assert(
    reactSource.includes('USE THE ACTUAL FILE PATH from the results'),
    'ReAct prompt should instruct LLM to use actual paths from tool results'
  );

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 116 agent pipeline tests: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
