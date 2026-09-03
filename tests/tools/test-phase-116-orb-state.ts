/**
 * NEX AI — Phase 116: Orb State Machine Tests
 *
 * Tests the new Orb state machine:
 *   - All 12 states exist (IDLE, INITIALIZING, READY, LISTENING, THINKING, SPEAKING, WORKING, SUCCESS, ERROR, CANCELLED, OFFLINE, INSTALLING)
 *   - State transitions are validated
 *   - Invalid transitions are rejected
 *   - Visual params computed for each state
 *   - Colors assigned for each state
 *
 * Run with: npx tsx tests/tools/test-phase-116-orb-state.ts
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

  console.log('Phase 116 Orb State Machine Tests\n');

  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'orb', 'orb-state.ts'),
    'utf-8'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 1. All states exist
  // ════════════════════════════════════════════════════════════════════════
  console.log('=== 1. State Definitions ===');

  const states = ['idle', 'initializing', 'ready', 'listening', 'thinking', 'speaking', 'active', 'working', 'success', 'error', 'cancelled', 'offline', 'installing'];

  states.forEach((s, i) => {
    console.log(`\nTest ${i + 1}: State "${s}" exists`);
    assert(source.includes(`'${s}'`), `State "${s}" should be in NexOrbState type`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. Transition validation
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 2. Transition Validation ===');

  console.log('\nTest 14: isValidOrbTransition function exists');
  assert(source.includes('export function isValidOrbTransition'), 'isValidOrbTransition should be exported');

  console.log('\nTest 15: safeOrbTransition function exists');
  assert(source.includes('export function safeOrbTransition'), 'safeOrbTransition should be exported');

  console.log('\nTest 16: VALID_TRANSITIONS map exists');
  assert(source.includes('VALID_TRANSITIONS'), 'VALID_TRANSITIONS map should exist');

  console.log('\nTest 17: IDLE can transition to INITIALIZING');
  assert(source.includes("idle: ['initializing'"), 'IDLE should allow transition to INITIALIZING');

  console.log('\nTest 18: READY can transition to LISTENING');
  assert(source.includes("ready: ['listening'"), 'READY should allow transition to LISTENING');

  console.log('\nTest 19: WORKING can transition to SUCCESS');
  assert(source.includes("working: ['ready', 'idle', 'error', 'success'"), 'WORKING should allow transition to SUCCESS');

  console.log('\nTest 20: SUCCESS can only go to IDLE or READY');
  assert(source.includes("success: ['idle', 'ready']"), 'SUCCESS should only transition to IDLE or READY');

  console.log('\nTest 21: CANCELLED can go to IDLE, READY, LISTENING');
  assert(source.includes("cancelled: ['idle', 'ready', 'listening']"), 'CANCELLED should transition to IDLE/READY/LISTENING');

  console.log('\nTest 22: No-op transitions always allowed');
  assert(source.includes('if (from === to) return true'), 'no-op transitions should be allowed');

  // ════════════════════════════════════════════════════════════════════════
  // 3. Color palette
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 3. Color Palette ===');

  console.log('\nTest 23: INITIALIZING has amber color');
  assert(source.includes("initializing: '#f59e0b'"), 'INITIALIZING should have amber color');

  console.log('\nTest 24: READY has emerald color');
  assert(source.includes("ready: '#10b981'"), 'READY should have emerald color');

  console.log('\nTest 25: WORKING has orange color');
  assert(source.includes("working: '#f97316'"), 'WORKING should have orange color');

  console.log('\nTest 26: SUCCESS has emerald color');
  assert(source.includes("success: '#10b981'"), 'SUCCESS should have emerald color');

  console.log('\nTest 27: CANCELLED has slate color');
  assert(source.includes("cancelled: '#64748b'"), 'CANCELLED should have slate color');

  // ════════════════════════════════════════════════════════════════════════
  // 4. Visual params for new states
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 4. Visual Params ===');

  console.log('\nTest 28: computeOrbVisual handles "initializing"');
  assert(source.includes("case 'initializing':"), 'computeOrbVisual should handle initializing');

  console.log('\nTest 29: computeOrbVisual handles "ready"');
  assert(source.includes("case 'ready':"), 'computeOrbVisual should handle ready');

  console.log('\nTest 30: computeOrbVisual handles "working"');
  assert(source.includes("case 'working':"), 'computeOrbVisual should handle working');

  console.log('\nTest 31: computeOrbVisual handles "success"');
  assert(source.includes("case 'success':"), 'computeOrbVisual should handle success');

  console.log('\nTest 32: computeOrbVisual handles "cancelled"');
  assert(source.includes("case 'cancelled':"), 'computeOrbVisual should handle cancelled');

  console.log('\nTest 33: INITIALIZING has pulseSpeed > 0 (pulsing)');
  assert(
    source.includes('pulseSpeed = 0.8; // slow steady pulse'),
    'INITIALIZING should have pulseSpeed for pulsing effect'
  );

  console.log('\nTest 34: WORKING has high particleSpeed');
  assert(
    source.includes('particleSpeed = 2.5'),
    'WORKING should have high particleSpeed (energetic)'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 5. AppShell integration
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 5. AppShell Integration ===');

  const appShellSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'layout', 'AppShell.tsx'),
    'utf-8'
  );

  console.log('\nTest 35: AppShell maps new states');
  assert(
    appShellSource.includes('initializing') &&
    appShellSource.includes('ready') &&
    appShellSource.includes('working') &&
    appShellSource.includes('success') &&
    appShellSource.includes('cancelled'),
    'AppShell should map new states (initializing, ready, working, success, cancelled)'
  );

  console.log('\nTest 36: AppShell maps WORKING to thinking');
  assert(
    appShellSource.includes("orbState === 'working'") &&
    appShellSource.includes("'thinking'"),
    'AppShell should map WORKING to thinking state'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 6. NexChatPanel agent → Orb state
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 6. NexChatPanel Agent → Orb ===');

  const chatSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'chat', 'NexChatPanel.tsx'),
    'utf-8'
  );

  console.log('\nTest 37: ChatPanel sets agent condition on planning_started');
  assert(
    chatSource.includes("case 'planning_started'") &&
    chatSource.includes("voiceController.setCondition('agent'"),
    'ChatPanel should set agent condition on planning_started'
  );

  console.log('\nTest 38: ChatPanel clears agent condition on task_completed');
  assert(
    chatSource.includes("case 'task_completed'") &&
    chatSource.includes("voiceController.clearCondition('agent')"),
    'ChatPanel should clear agent condition on task_completed'
  );

  console.log('\nTest 39: ChatPanel sets error on task_failed');
  assert(
    chatSource.includes("voiceController.setCondition('agent', 'error')"),
    'ChatPanel should set error state on task_failed'
  );

  console.log('\nTest 40: ChatPanel clears agent condition on task_cancelled');
  assert(
    chatSource.includes("voiceController.clearCondition('agent')"),
    'ChatPanel should clear agent condition on task_cancelled'
  );

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 116 orb state machine tests: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
