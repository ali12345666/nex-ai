/**
 * NEX AI — Phase 116: Agent Artifact Summary Tests
 *
 * Tests that the agent produces a structured artifact summary after task
 * completion — so that file paths/folders/commands are preserved in
 * conversation history for subsequent turns.
 *
 * Run with: npx tsx tests/tools/test-phase-116-agent-artifacts.ts
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

  console.log('Phase 116 Agent Artifact Summary Tests\n');

  // ════════════════════════════════════════════════════════════════════════
  // 1. buildArtifactSummary is exported (indirectly via task_completed event)
  // ════════════════════════════════════════════════════════════════════════
  console.log('=== 1. Artifact Summary Code Structure ===');

  const coreContent = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
    'utf-8'
  );

  // Test 1: buildArtifactSummary function exists
  console.log('\nTest 1: buildArtifactSummary function exists');
  {
    assert(
      coreContent.includes('function buildArtifactSummary'),
      'buildArtifactSummary function should exist in core.ts'
    );
  }

  // Test 2: artifact summary emitted as agent_token before task_completed
  console.log('\nTest 2: artifact summary emitted as agent_token');
  {
    assert(
      coreContent.includes("phase: 'artifact-summary'") ||
      coreContent.includes('phase: "artifact-summary"'),
      'artifact summary should be emitted with phase=artifact-summary'
    );
    assert(
      coreContent.includes("'agent_token'") || coreContent.includes('"agent_token"'),
      'artifact summary should be emitted as agent_token event'
    );
  }

  // Test 3: summary includes created files
  console.log('\nTest 3: summary tracks created files');
  {
    assert(coreContent.includes('createdFiles'), 'should track createdFiles');
    assert(coreContent.includes('createdFolders'), 'should track createdFolders');
    assert(coreContent.includes('modifiedFiles'), 'should track modifiedFiles');
  }

  // Test 4: summary extracts paths from tool results
  console.log('\nTest 4: summary extracts paths from tool results');
  {
    assert(
      coreContent.includes('data.path') || coreContent.includes('data.relativePath'),
      'should extract path from result.data'
    );
    assert(
      coreContent.includes('data.created'),
      'should check data.created flag for new files'
    );
  }

  // Test 5: summary includes commands executed
  console.log('\nTest 5: summary tracks executed commands');
  {
    assert(coreContent.includes('commands'), 'should track commands array');
    assert(
      coreContent.includes('run_command') || coreContent.includes('npm_build'),
      'should track run_command/npm_build tools'
    );
  }

  // Test 6: summary is in Persian (for user readability)
  console.log('\nTest 6: summary uses Persian labels');
  {
    assert(coreContent.includes('کار انجام شد'), 'should have Persian "task done" label');
    assert(coreContent.includes('پوشه‌های ساخته شده'), 'should have Persian "folders created" label');
    assert(coreContent.includes('فایل‌های ساخته شده'), 'should have Persian "files created" label');
  }

  // ════════════════════════════════════════════════════════════════════════
  // 2. Conversation history sends context to next turn
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 2. Conversation History Context ===');

  const chatPanelContent = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'chat', 'NexChatPanel.tsx'),
    'utf-8'
  );

  // Test 7: NexChatPanel sends conversation history to brainRoute
  console.log('\nTest 7: NexChatPanel sends history to brainRoute');
  {
    assert(
      chatPanelContent.includes('history:') && chatPanelContent.includes('brainRoute'),
      'NexChatPanel should send history to brainRoute'
    );
    assert(
      chatPanelContent.includes('slice(-5)') || chatPanelContent.includes('slice(-'),
      'should send recent messages as history'
    );
  }

  // Test 8: agent_token handler accumulates content (not just replaces)
  console.log('\nTest 8: agent_token handler preserves artifact summary');
  {
    assert(
      chatPanelContent.includes('agent_token') && chatPanelContent.includes('agentTokensStarted'),
      'agent_token handler should track token accumulation state'
    );
  }

  // Test 9: task_completed preserves accumulated content
  console.log('\nTest 9: task_completed preserves accumulated content');
  {
    assert(
      chatPanelContent.includes('agentTokensStarted') && chatPanelContent.includes('last.content'),
      'task_completed should use last.content if agentTokensStarted'
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // 3. write_file tool returns path data
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 3. write_file Tool Returns Path Data ===');

  const writeFileContent = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'write-file-tool.ts'),
    'utf-8'
  );

  // Test 10: write_file returns path + created flag
  console.log('\nTest 10: write_file returns structured path data');
  {
    assert(
      writeFileContent.includes('relativePath') && writeFileContent.includes('created'),
      'write_file should return relativePath + created flag'
    );
    assert(
      writeFileContent.includes('path: safePath'),
      'write_file should return absolute path'
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 116 agent artifact tests: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
