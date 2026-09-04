/**
 * NEX AI — Phase 13: Agent Execution Data Wiring & Brain Router Integration — Tests
 *
 * Tests that all three agent entry paths correctly wire:
 *   1. brain-route: projectPath (not workspaceRoot) + knowledgePort + onlineEnvironment
 *   2. agent-create-task: knowledgePort + onlineEnvironment via shared helper
 *   3. task-queue-create-agent-task: knowledgePort + onlineEnvironment via shared helper
 *   4. NexAgentExecutor: onlineEnvironment passed to createTask
 *   5. Deprecated stub message removed
 *   6. API key never in logs/events/memory
 *   7. Graceful behavior when no API key / no projectPath
 *   8. DRY: shared helper used (not copy-paste)
 *   9. Regression: Phase 6-12 intact
 *
 * Run with: npx tsx tests/tools/test-phase-13-agent-wiring.ts
 */

import * as path from 'path';
import * as fs from 'fs';

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

// ─── Tests ─────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('Phase 13: Agent Execution Data Wiring & Brain Router Integration Tests\n');

  const mainSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'),
    'utf-8',
  );

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 1: brain-route uses projectPath (not workspaceRoot)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('1. brain-route uses projectPath', async () => {
    console.log('\nTest 1.1: brain-route uses projectPath (not workspaceRoot)');
    assert(mainSource.includes('projectPath: request.projectPath'), 'uses projectPath');
    assert(!mainSource.includes('workspaceRoot: request.projectPath'), 'does NOT use workspaceRoot');

    console.log('\nTest 1.2: brain-route does NOT fallback to process.cwd()');
    // Check the brain-route handler doesn't have process.cwd() for projectPath
    const brainRouteSection = mainSource.substring(
      mainSource.indexOf("if (route === 'agent')"),
      mainSource.indexOf("return { success: true, route: 'agent'"),
    );
    assert(!brainRouteSection.includes('process.cwd()'), 'no process.cwd() fallback in brain-route');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 2: brain-route wires knowledgePort
  // ════════════════════════════════════════════════════════════════════════
  await testSection('2. brain-route wires knowledgePort', async () => {
    console.log('\nTest 2.1: brain-route calls wireAgentRequest');
    const brainRouteSection = mainSource.substring(
      mainSource.indexOf("if (route === 'agent')"),
      mainSource.indexOf("return { success: true, route: 'agent'"),
    );
    assert(brainRouteSection.includes('wireAgentRequest'), 'brain-route calls wireAgentRequest');

    console.log('\nTest 2.2: wireAgentRequest wires knowledgePort');
    assert(mainSource.includes('async function wireKnowledgePort'), 'wireKnowledgePort exists');
    assert(mainSource.includes('request.knowledgePort'), 'sets knowledgePort on request');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 3: brain-route wires onlineEnvironment
  // ════════════════════════════════════════════════════════════════════════
  await testSection('3. brain-route wires onlineEnvironment', async () => {
    console.log('\nTest 3.1: wireOnlineEnvironment exists');
    assert(mainSource.includes('function wireOnlineEnvironment'), 'wireOnlineEnvironment exists');

    console.log('\nTest 3.2: wireOnlineEnvironment reads settings + secrets');
    assert(mainSource.includes("getSecret('glmApiKey')"), 'reads GLM API key');
    assert(mainSource.includes("getSecret('aiApiKey')"), 'reads AI API key');
    assert(mainSource.includes('loadState().settings'), 'reads settings');

    console.log('\nTest 3.3: wireOnlineEnvironment sets onlineEnvironment on request');
    assert(mainSource.includes('request.onlineEnvironment ='), 'sets onlineEnvironment');

    console.log('\nTest 3.4: when no API key, onlineEnvironment = { available: false }');
    assert(mainSource.includes("{ available: false }"), 'graceful when no API key');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 4: agent-create-task wires onlineEnvironment via helper
  // ════════════════════════════════════════════════════════════════════════
  await testSection('4. agent-create-task wires via helper', async () => {
    console.log('\nTest 4.1: agent-create-task calls wireAgentRequest');
    // Find the agent-create-task handler
    const createTaskSection = mainSource.substring(
      mainSource.indexOf("ipcMain.handle('agent-create-task'"),
      mainSource.indexOf("ipcMain.handle('agent-cancel-task'"),
    );
    assert(createTaskSection.includes('wireAgentRequest'), 'agent-create-task calls wireAgentRequest');

    console.log('\nTest 4.2: agent-create-task does NOT have inline knowledge wiring');
    // The old inline knowledge code should be removed
    assert(!createTaskSection.includes("getKnowledgeService"), 'no inline getKnowledgeService');
    assert(!createTaskSection.includes("projectIdFromPath"), 'no inline projectIdFromPath');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 5: task-queue-create-agent-task wires via helper
  // ════════════════════════════════════════════════════════════════════════
  await testSection('5. task-queue-create-agent-task wires via helper', async () => {
    console.log('\nTest 5.1: task-queue-create-agent-task calls wireAgentRequest');
    const queueSection = mainSource.substring(
      mainSource.indexOf("ipcMain.handle('task-queue-create-agent-task'"),
      mainSource.indexOf("ipcMain.handle('task-queue-cancel'"),
    );
    assert(queueSection.includes('wireAgentRequest'), 'task-queue-create-agent-task calls wireAgentRequest');

    console.log('\nTest 5.2: task-queue-create-agent-task does NOT have inline knowledge wiring');
    assert(!queueSection.includes("getKnowledgeService"), 'no inline getKnowledgeService');
    assert(!queueSection.includes("projectIdFromPath"), 'no inline projectIdFromPath');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 6: DRY — shared helper used
  // ════════════════════════════════════════════════════════════════════════
  await testSection('6. DRY — shared helper', async () => {
    console.log('\nTest 6.1: wireAgentRequest exists as shared helper');
    assert(mainSource.includes('async function wireAgentRequest'), 'wireAgentRequest exists');

    console.log('\nTest 6.2: wireKnowledgePort is a single function (not duplicated in agent paths)');
    const knowledgeWiringCount = (mainSource.match(/getKnowledgeService/g) || []).length;
    // Should be 4: 2 in wireKnowledgePort helper + 2 in knowledgeServiceFor (separate, for Knowledge panel IPC)
    // Before Phase 13: appeared 6+ times (2 in agent-create-task inline + 2 in task-queue inline + 2 in knowledgeServiceFor)
    assert(knowledgeWiringCount <= 4, `getKnowledgeService appears ${knowledgeWiringCount} times (should be <=4: helper + knowledge panel)`);

    console.log('\nTest 6.3: wireOnlineEnvironment is a single function (not duplicated)');
    const onlineWiringCount = (mainSource.match(/wireOnlineEnvironment/g) || []).length;
    // Should be 2: function definition + call in wireAgentRequest
    assert(onlineWiringCount === 2, `wireOnlineEnvironment appears ${onlineWiringCount} times (should be 2: definition + call)`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 7: Deprecated stub message removed
  // ════════════════════════════════════════════════════════════════════════
  await testSection('7. Deprecated stub message removed', async () => {
    console.log('\nTest 7.1: DEPRECATED console.warn removed from agent-execute-plan');
    assert(!mainSource.includes("[DEPRECATED] agent-execute-plan is a stub"), 'deprecated warning removed');

    console.log('\nTest 7.2: STUB comments removed');
    assert(!mainSource.includes("Phase 104: nex-agent-executor.executePlan() is a STUB"), 'STUB comment removed');
    assert(!mainSource.includes("Phase 104 WARNING: This is a STUB"), 'STUB warning comment removed');

    console.log('\nTest 7.3: Phase 12+13 comment present');
    assert(mainSource.includes("Phase 12+13: nex-agent-executor.executePlan() now uses the REAL agent"), 'Phase 12+13 comment present');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 8: API key security
  // ════════════════════════════════════════════════════════════════════════
  await testSection('8. API key security', async () => {
    console.log('\nTest 8.1: API key read via getSecret (not hardcoded)');
    assert(mainSource.includes("getSecret('glmApiKey')"), 'GLM key via getSecret');
    assert(mainSource.includes("getSecret('aiApiKey')"), 'AI key via getSecret');

    console.log('\nTest 8.2: API key not stored in onlineEnvironment (only availability flag)');
    // OnlineEnvironment interface: { available, modelName, modelId } — NO apiKey field
    const routerSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'model-router.ts'),
      'utf-8',
    );
    assert(routerSource.includes('available: boolean'), 'OnlineEnvironment has available field');
    assert(!routerSource.includes('apiKey'), 'OnlineEnvironment does NOT have apiKey field');

    console.log('\nTest 8.3: API key read lazily by transport (not in agent request)');
    const transportSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'runtimes', 'online-transport.ts'),
      'utf-8',
    );
    assert(transportSource.includes("getSecret('glmApiKey')"), 'transport reads key lazily');
    assert(transportSource.includes('apiKey: () =>'), 'transport uses getter (lazy, not cached)');

    console.log('\nTest 8.4: redactObjectDeep applied to agent events (existing)');
    const loggerSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'logger.ts'),
      'utf-8',
    );
    assert(loggerSource.includes('redactObjectDeep'), 'logger redacts event data');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 9: Graceful behavior
  // ════════════════════════════════════════════════════════════════════════
  await testSection('9. Graceful behavior', async () => {
    console.log('\nTest 9.1: no API key → onlineEnvironment = { available: false }');
    assert(mainSource.includes("if (!apiKey)"), 'checks for missing API key');
    assert(mainSource.includes("{ available: false }"), 'sets available: false');

    console.log('\nTest 9.2: no projectPath → knowledgePort not wired (graceful)');
    assert(mainSource.includes("if (!request?.projectPath || request.knowledgePort) return;"), 'returns early if no projectPath');

    console.log('\nTest 9.3: knowledge wiring wrapped in try/catch');
    assert(mainSource.includes("} catch (err: any) {"), 'knowledge wiring has catch');
    assert(mainSource.includes("console.warn('[NEX AI] Knowledge wiring unavailable"), 'logs warning on failure');

    console.log('\nTest 9.4: online wiring wrapped in try/catch');
    const onlineSection = mainSource.substring(
      mainSource.indexOf('function wireOnlineEnvironment'),
      mainSource.indexOf('async function wireAgentRequest'),
    );
    assert(onlineSection.includes("} catch (err: any) {"), 'online wiring has catch');
    assert(onlineSection.includes("{ available: false }"), 'fallback to available: false');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SECTION 10: Regression — Phase 6-12 intact
  // ════════════════════════════════════════════════════════════════════════
  await testSection('10. Regression (source inspection)', async () => {
    console.log('\nTest 10.1: Phase 6 task queue intact');
    const queueSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'tasks', 'queue.ts'),
      'utf-8',
    );
    assert(queueSource.includes('enqueueAgentTask'), 'Phase 6 queue intact');

    console.log('\nTest 10.2: Phase 7 recovery intact');
    const recoverySource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'recovery-engine.ts'),
      'utf-8',
    );
    assert(recoverySource.includes('decideRecovery'), 'Phase 7 recovery intact');

    console.log('\nTest 10.3: Phase 8 context intact');
    const contextSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'context-contract.ts'),
      'utf-8',
    );
    assert(contextSource.includes('safeContextSnapshot'), 'Phase 8 context intact');

    console.log('\nTest 10.4: Phase 9 verification intact');
    const verSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'verification.ts'),
      'utf-8',
    );
    assert(verSource.includes('verifyTaskCompletion'), 'Phase 9 verification intact');

    console.log('\nTest 10.5: Phase 10 browser intact');
    assert(fs.existsSync(path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'browser', 'session-manager.ts')), 'Phase 10 browser intact');

    console.log('\nTest 10.6: Phase 11 computer intact');
    assert(fs.existsSync(path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'tools', 'computer', 'session-manager.ts')), 'Phase 11 computer intact');

    console.log('\nTest 10.7: Phase 12 orchestration intact');
    const executorSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'ai', 'nex-agent-executor.ts'),
      'utf-8',
    );
    assert(executorSource.includes('agentCore.createTask'), 'Phase 12 executor intact');
    assert(executorSource.includes('agentCore.runTask'), 'Phase 12 runTask intact');

    console.log('\nTest 10.8: Phase 13 changes are additive (no breaking changes)');
    // brain-route handler still exists
    assert(mainSource.includes("ipcMain.handle('brain-route'"), 'brain-route handler exists');
    // agent-create-task still exists
    assert(mainSource.includes("ipcMain.handle('agent-create-task'"), 'agent-create-task handler exists');
    // task-queue-create-agent-task still exists
    assert(mainSource.includes("ipcMain.handle('task-queue-create-agent-task'"), 'task-queue-create-agent-task handler exists');
    // agent-execute-plan still exists (just updated comment)
    assert(mainSource.includes("ipcMain.handle('agent-execute-plan'"), 'agent-execute-plan handler exists');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 13 agent wiring tests: ${passed}/${passed + failed} passed (${failed} failed)`);
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
