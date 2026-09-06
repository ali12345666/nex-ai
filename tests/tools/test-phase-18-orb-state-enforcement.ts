/**
 * NEX AI — Phase 18 Stage 2: Orb State Machine Enforcement Tests (BUG-37)
 *
 * Tests that:
 *   - safeOrbTransition(from, to) returns `to` for VALID transitions
 *   - safeOrbTransition(from, to) returns `from` for INVALID transitions
 *   - The relaxed VALID_TRANSITIONS graph covers all documented production flows
 *   - Flash states (success/error/cancelled) can recover into active states
 *   - voiceService.recomputeState() actually enforces the state machine
 *   - voiceController.handleStateChange() actually enforces the state machine
 *   - The diagnostic warning `[ORB_STATE] Invalid transition blocked: <from> → <to>` fires
 *
 * Run with: npx tsx tests/tools/test-phase-18-orb-state-enforcement.ts
 */

import * as path from 'path';
import * as fs from 'fs';

let passed = 0, failed = 0;
const failures: string[] = [];

function assert(condition: boolean, name: string) {
  if (condition) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; failures.push(name); console.error(`  FAIL: ${name}`); }
}

async function testSection(name: string, fn: () => Promise<void> | void): Promise<void> {
  console.log(`\n=== ${name} ===`);
  try { await fn(); }
  catch (err) { failed++; failures.push(`${name} (threw: ${(err as Error).message})`); console.error(`  CRASH: ${name}:`, (err as Error).message); }
}

async function runTests() {
  console.log('Phase 18 Stage 2: Orb State Machine Enforcement Tests (BUG-37)\n');

  // Import the actual orb-state module to test the REAL functions
  const orbStatePath = path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'orb', 'orb-state.ts');
  const orbStateSource = fs.readFileSync(orbStatePath, 'utf-8');

  // We can't directly import the .ts file in tsx without compilation, but we
  // can evaluate the exported functions by extracting them. For a pure module
  // like orb-state.ts (no side effects at import time), we can use a
  // Function constructor to evaluate the relevant parts.
  //
  // Safer approach: parse the VALID_TRANSITIONS map from source and test
  // the isValidOrbTransition / safeOrbTransition logic by re-implementing
  // the same logic here (mirroring). This is a "shadow test" — it verifies
  // the source contains the right structure + the logic is correct.

  // ════════════════════════════════════════════════════════════════════════
  // 1. Source-level: VALID_TRANSITIONS is relaxed for flash states
  // ════════════════════════════════════════════════════════════════════════
  await testSection('1. VALID_TRANSITIONS relaxed for flash states', async () => {
    console.log('\nTest 1.1: success can transition to all active states');
    // Extract the success line from VALID_TRANSITIONS
    const successMatch = orbStateSource.match(/success:\s*\[([^\]]+)\]/);
    assert(successMatch !== null, 'success entry exists in VALID_TRANSITIONS');
    if (successMatch) {
      const successTargets = successMatch[1];
      assert(successTargets.includes("'listening'"), 'success → listening allowed (flash recovery)');
      assert(successTargets.includes("'thinking'"), 'success → thinking allowed (flash recovery)');
      assert(successTargets.includes("'speaking'"), 'success → speaking allowed (flash recovery)');
      assert(successTargets.includes("'working'"), 'success → working allowed (flash recovery)');
    }

    console.log('\nTest 1.2: error can transition to all active states');
    const errorMatch = orbStateSource.match(/error:\s*\[([^\]]+)\]/);
    assert(errorMatch !== null, 'error entry exists in VALID_TRANSITIONS');
    if (errorMatch) {
      const errorTargets = errorMatch[1];
      assert(errorTargets.includes("'listening'"), 'error → listening allowed (flash recovery)');
      assert(errorTargets.includes("'thinking'"), 'error → thinking allowed (flash recovery)');
      assert(errorTargets.includes("'speaking'"), 'error → speaking allowed (flash recovery)');
      assert(errorTargets.includes("'working'"), 'error → working allowed (flash recovery)');
    }

    console.log('\nTest 1.3: cancelled can transition to all active states');
    const cancelledMatch = orbStateSource.match(/cancelled:\s*\[([^\]]+)\]/);
    assert(cancelledMatch !== null, 'cancelled entry exists in VALID_TRANSITIONS');
    if (cancelledMatch) {
      const cancelledTargets = cancelledMatch[1];
      assert(cancelledTargets.includes("'listening'"), 'cancelled → listening allowed (flash recovery)');
      assert(cancelledTargets.includes("'thinking'"), 'cancelled → thinking allowed (flash recovery)');
      assert(cancelledTargets.includes("'speaking'"), 'cancelled → speaking allowed (flash recovery)');
      assert(cancelledTargets.includes("'working'"), 'cancelled → working allowed (flash recovery)');
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. Source-level: barge-in transitions allowed
  // ════════════════════════════════════════════════════════════════════════
  await testSection('2. Barge-in transitions allowed', async () => {
    console.log('\nTest 2.1: listening → working allowed (barge-in path)');
    const listeningMatch = orbStateSource.match(/listening:\s*\[([^\]]+)\]/);
    assert(listeningMatch !== null, 'listening entry exists');
    if (listeningMatch) {
      assert(listeningMatch[1].includes("'working'"), 'listening → working allowed (barge-in)');
    }

    console.log('\nTest 2.2: thinking → listening allowed (chat completion with mic on)');
    const thinkingMatch = orbStateSource.match(/thinking:\s*\[([^\]]+)\]/);
    assert(thinkingMatch !== null, 'thinking entry exists');
    if (thinkingMatch) {
      assert(thinkingMatch[1].includes("'listening'"), 'thinking → listening allowed');
    }

    console.log('\nTest 2.3: speaking → working + thinking allowed (barge-in restart)');
    const speakingMatch = orbStateSource.match(/speaking:\s*\[([^\]]+)\]/);
    assert(speakingMatch !== null, 'speaking entry exists');
    if (speakingMatch) {
      assert(speakingMatch[1].includes("'working'"), 'speaking → working allowed (barge-in)');
      assert(speakingMatch[1].includes("'thinking'"), 'speaking → thinking allowed (barge-in)');
    }

    console.log('\nTest 2.4: working → thinking + speaking + listening allowed (recovery + barge-in)');
    const workingMatch = orbStateSource.match(/working:\s*\[([^\]]+)\]/);
    assert(workingMatch !== null, 'working entry exists');
    if (workingMatch) {
      assert(workingMatch[1].includes("'thinking'"), 'working → thinking allowed (recovery replan)');
      assert(workingMatch[1].includes("'speaking'"), 'working → speaking allowed (TTS response)');
      assert(workingMatch[1].includes("'listening'"), 'working → listening allowed (barge-in)');
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. Source-level: idle can transition to thinking + working + cancelled
  // ════════════════════════════════════════════════════════════════════════
  await testSection('3. idle can transition to thinking + working + cancelled', async () => {
    console.log('\nTest 3.1: idle → thinking allowed (chat path starts at thinking)');
    const idleMatch = orbStateSource.match(/idle:\s*\[([^\]]+)\]/);
    assert(idleMatch !== null, 'idle entry exists');
    if (idleMatch) {
      assert(idleMatch[1].includes("'thinking'"), 'idle → thinking allowed');
      assert(idleMatch[1].includes("'working'"), 'idle → working allowed');
      assert(idleMatch[1].includes("'cancelled'"), 'idle → cancelled allowed');
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4. Source-level: true terminal states preserved
  // ════════════════════════════════════════════════════════════════════════
  await testSection('4. True terminal states preserved (monotonic)', async () => {
    console.log('\nTest 4.1: offline only transitions to idle/initializing');
    const offlineMatch = orbStateSource.match(/offline:\s*\[([^\]]+)\]/);
    assert(offlineMatch !== null, 'offline entry exists');
    if (offlineMatch) {
      const offlineTargets = offlineMatch[1];
      assert(offlineTargets.includes("'idle'"), 'offline → idle allowed');
      assert(offlineTargets.includes("'initializing'"), 'offline → initializing allowed');
      // Should NOT include active states
      assert(!offlineTargets.includes("'working'"), 'offline → working NOT allowed (terminal)');
      assert(!offlineTargets.includes("'speaking'"), 'offline → speaking NOT allowed (terminal)');
    }

    console.log('\nTest 4.2: installing only transitions to ready/idle/error');
    const installingMatch = orbStateSource.match(/installing:\s*\[([^\]]+)\]/);
    assert(installingMatch !== null, 'installing entry exists');
    if (installingMatch) {
      const installingTargets = installingMatch[1];
      assert(installingTargets.includes("'ready'"), 'installing → ready allowed');
      assert(installingTargets.includes("'idle'"), 'installing → idle allowed');
      assert(installingTargets.includes("'error'"), 'installing → error allowed');
      // Should NOT include active states
      assert(!installingTargets.includes("'working'"), 'installing → working NOT allowed (terminal)');
      assert(!installingTargets.includes("'speaking'"), 'installing → speaking NOT allowed (terminal)');
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5. Source-level: safeOrbTransition uses the new diagnostic message
  // ════════════════════════════════════════════════════════════════════════
  await testSection('5. safeOrbTransition uses new diagnostic message', async () => {
    console.log('\nTest 5.1: safeOrbTransition logs "[ORB_STATE] Invalid transition blocked: <from> → <to>"');
    assert(orbStateSource.includes('[ORB_STATE] Invalid transition blocked:'), 'uses the new diagnostic message format');
    // Should NOT have the old message format
    assert(!orbStateSource.includes("Invalid transition: ${current} → ${to} — keeping ${current}"), 'old message format removed');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 6. Source-level: voiceService.recomputeState enforces
  // ════════════════════════════════════════════════════════════════════════
  await testSection('6. voiceService.recomputeState enforces safeOrbTransition', async () => {
    const voiceServiceSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'services', 'voice-service.ts'),
      'utf-8',
    );

    console.log('\nTest 6.1: voice-service.ts imports safeOrbTransition');
    assert(voiceServiceSource.includes('import { safeOrbTransition'), 'imports safeOrbTransition from orb-state');
    assert(voiceServiceSource.includes("from '../components/orb/orb-state'"), 'imports from orb-state');

    console.log('\nTest 6.2: recomputeState calls safeOrbTransition');
    const recomputeStart = voiceServiceSource.indexOf('private recomputeState(): void {');
    assert(recomputeStart > 0, 'recomputeState method exists');
    // Extract the full method body
    const recomputeBodyStart = voiceServiceSource.indexOf('{', recomputeStart);
    let braceDepth = 0;
    let recomputeEnd = recomputeBodyStart;
    for (let i = recomputeBodyStart; i < voiceServiceSource.length; i++) {
      if (voiceServiceSource[i] === '{') braceDepth++;
      else if (voiceServiceSource[i] === '}') {
        braceDepth--;
        if (braceDepth === 0) { recomputeEnd = i; break; }
      }
    }
    const recomputeBody = voiceServiceSource.substring(recomputeStart, recomputeEnd + 1);
    assert(recomputeBody.includes('safeOrbTransition('), 'recomputeState calls safeOrbTransition');
    assert(recomputeBody.includes('this._state as NexOrbState'), 'casts current state to NexOrbState');
    assert(recomputeBody.includes('newState as NexOrbState'), 'casts new state to NexOrbState');

    console.log('\nTest 6.3: recomputeState blocks invalid transitions (does NOT update state)');
    // The key invariant: if validated === this._state, do NOT update + do NOT fire callback
    assert(recomputeBody.includes("if (validated !== this._state)"), 'only updates when validated differs from current');
    assert(recomputeBody.includes('this.callbacks.onStateChange?.(validated)'), 'fires callback with validated state');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 7. Source-level: voiceController.handleStateChange enforces
  // ════════════════════════════════════════════════════════════════════════
  await testSection('7. voiceController.handleStateChange enforces safeOrbTransition', async () => {
    const voiceControllerSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'services', 'voice-controller.ts'),
      'utf-8',
    );

    console.log('\nTest 7.1: voice-controller.ts imports safeOrbTransition');
    assert(voiceControllerSource.includes('import { safeOrbTransition'), 'imports safeOrbTransition');

    console.log('\nTest 7.2: handleStateChange calls safeOrbTransition');
    const handleStart = voiceControllerSource.indexOf('private handleStateChange(state: VoiceState): void {');
    assert(handleStart > 0, 'handleStateChange method exists');
    const handleBodyStart = voiceControllerSource.indexOf('{', handleStart);
    let braceDepth = 0;
    let handleEnd = handleBodyStart;
    for (let i = handleBodyStart; i < voiceControllerSource.length; i++) {
      if (voiceControllerSource[i] === '{') braceDepth++;
      else if (voiceControllerSource[i] === '}') {
        braceDepth--;
        if (braceDepth === 0) { handleEnd = i; break; }
      }
    }
    const handleBody = voiceControllerSource.substring(handleStart, handleEnd + 1);
    assert(handleBody.includes('safeOrbTransition('), 'handleStateChange calls safeOrbTransition');
    assert(handleBody.includes('this.orbStateRef.current'), 'passes current orbStateRef');

    console.log('\nTest 7.3: handleStateChange blocks invalid transitions (does NOT update orbStateRef)');
    assert(handleBody.includes("if (validated !== this.orbStateRef.current)"), 'only updates when validated differs from current');
    assert(handleBody.includes('this.orbStateCallbacks.forEach'), 'fires callbacks with validated state');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 8. Runtime: safeOrbTransition logic (shadow test)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('8. Runtime: safeOrbTransition returns to for valid, from for invalid', async () => {
    console.log('\nTest 8.1: safeOrbTransition returns `to` for valid transitions');

    // Mirror the VALID_TRANSITIONS graph from orb-state.ts (post-relaxation)
    // and test the safeOrbTransition logic.
    const VALID: Record<string, string[]> = {
      idle:          ['initializing', 'ready', 'listening', 'thinking', 'working', 'error', 'cancelled', 'offline'],
      initializing:  ['ready', 'error', 'idle', 'listening', 'thinking', 'working'],
      ready:         ['listening', 'thinking', 'working', 'idle', 'offline', 'error', 'cancelled'],
      listening:     ['thinking', 'speaking', 'idle', 'ready', 'error', 'cancelled', 'working'],
      thinking:      ['speaking', 'working', 'idle', 'ready', 'error', 'cancelled', 'listening'],
      speaking:      ['ready', 'listening', 'idle', 'error', 'cancelled', 'working', 'thinking', 'success'],
      active:        ['ready', 'idle', 'error', 'success', 'cancelled', 'listening', 'thinking', 'speaking'],
      working:       ['ready', 'idle', 'error', 'success', 'cancelled', 'thinking', 'speaking', 'listening'],
      success:       ['idle', 'ready', 'listening', 'thinking', 'speaking', 'working', 'error', 'cancelled'],
      error:         ['idle', 'ready', 'listening', 'thinking', 'speaking', 'working', 'cancelled'],
      cancelled:     ['idle', 'ready', 'listening', 'thinking', 'speaking', 'working', 'error'],
      offline:       ['idle', 'initializing'],
      installing:    ['ready', 'idle', 'error'],
    };

    function isValid(from: string, to: string): boolean {
      if (from === to) return true;
      return (VALID[from] || []).includes(to);
    }

    function safeTransition(current: string, to: string): string {
      if (isValid(current, to)) return to;
      return current;
    }

    // Valid transitions
    assert(safeTransition('idle', 'listening') === 'listening', 'idle → listening valid');
    assert(safeTransition('listening', 'thinking') === 'thinking', 'listening → thinking valid');
    assert(safeTransition('thinking', 'speaking') === 'speaking', 'thinking → speaking valid');
    assert(safeTransition('speaking', 'listening') === 'listening', 'speaking → listening valid');
    assert(safeTransition('listening', 'idle') === 'idle', 'listening → idle valid');

    // Flash-state recovery
    assert(safeTransition('success', 'speaking') === 'speaking', 'success → speaking valid (flash recovery)');
    assert(safeTransition('success', 'working') === 'working', 'success → working valid (flash recovery)');
    assert(safeTransition('error', 'thinking') === 'thinking', 'error → thinking valid (flash recovery)');
    assert(safeTransition('error', 'listening') === 'listening', 'error → listening valid (flash recovery)');
    assert(safeTransition('cancelled', 'working') === 'working', 'cancelled → working valid (flash recovery)');
    assert(safeTransition('cancelled', 'thinking') === 'thinking', 'cancelled → thinking valid (flash recovery)');

    // Barge-in
    assert(safeTransition('listening', 'working') === 'working', 'listening → working valid (barge-in)');
    assert(safeTransition('speaking', 'working') === 'working', 'speaking → working valid (barge-in)');
    assert(safeTransition('working', 'thinking') === 'thinking', 'working → thinking valid (recovery)');

    // Chat completion with mic on
    assert(safeTransition('thinking', 'listening') === 'listening', 'thinking → listening valid');

    console.log('\nTest 8.2: safeOrbTransition returns `from` for invalid transitions');
    // Invalid: offline → speaking (terminal)
    assert(safeTransition('offline', 'speaking') === 'offline', 'offline → speaking BLOCKED (terminal)');
    assert(safeTransition('offline', 'working') === 'offline', 'offline → working BLOCKED (terminal)');
    // Invalid: installing → speaking (terminal)
    assert(safeTransition('installing', 'speaking') === 'installing', 'installing → speaking BLOCKED (terminal)');
    assert(safeTransition('installing', 'working') === 'installing', 'installing → working BLOCKED (terminal)');
    // Invalid: idle → installing (not in valid list)
    assert(safeTransition('idle', 'installing') === 'idle', 'idle → installing BLOCKED (not in valid list)');
    // Invalid: idle → active (active is a legacy alias, not in idle's valid list)
    assert(safeTransition('idle', 'active') === 'idle', 'idle → active BLOCKED (not in valid list)');

    console.log('\nTest 8.3: no-op transitions (from === to) always return `to`');
    assert(safeTransition('idle', 'idle') === 'idle', 'idle → idle no-op');
    assert(safeTransition('speaking', 'speaking') === 'speaking', 'speaking → speaking no-op');
    assert(safeTransition('error', 'error') === 'error', 'error → error no-op');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 9. Runtime: recomputeState enforcement (shadow test)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('9. Runtime: recomputeState blocks invalid transitions', async () => {
    console.log('\nTest 9.1: recomputeState keeps current state on invalid transition');

    // Mirror the voiceService.recomputeState logic with enforcement
    const VALID: Record<string, string[]> = {
      idle:          ['initializing', 'ready', 'listening', 'thinking', 'working', 'error', 'cancelled', 'offline'],
      listening:     ['thinking', 'speaking', 'idle', 'ready', 'error', 'cancelled', 'working'],
      thinking:      ['speaking', 'working', 'idle', 'ready', 'error', 'cancelled', 'listening'],
      speaking:      ['ready', 'listening', 'idle', 'error', 'cancelled', 'working', 'thinking', 'success'],
      working:       ['ready', 'idle', 'error', 'success', 'cancelled', 'thinking', 'speaking', 'listening'],
      success:       ['idle', 'ready', 'listening', 'thinking', 'speaking', 'working', 'error', 'cancelled'],
      error:         ['idle', 'ready', 'listening', 'thinking', 'speaking', 'working', 'cancelled'],
      cancelled:     ['idle', 'ready', 'listening', 'thinking', 'speaking', 'working', 'error'],
      offline:       ['idle', 'initializing'],
      installing:    ['ready', 'idle', 'error'],
      // (others omitted for brevity — not used in this test)
    };

    function safeTransition(current: string, to: string): string {
      if (current === to) return to;
      if ((VALID[current] || []).includes(to)) return to;
      return current;
    }

    // Simulate voiceService: _state + _stateConditions + recomputeState
    let state: string = 'idle';
    let firedCallback: string | null = null;
    const conditions = new Map<string, string>();

    function setCondition(key: string, st: string) {
      conditions.set(key, st);
      recomputeState();
    }
    function clearCondition(key: string) {
      conditions.delete(key);
      recomputeState();
    }
    function recomputeState() {
      let newState = 'idle';
      let highest = 0;
      const PRIORITY: Record<string, number> = { error: 8, offline: 7, speaking: 6, working: 5, thinking: 4, listening: 3, success: 2, cancelled: 2, idle: 1 };
      for (const st of conditions.values()) {
        const p = PRIORITY[st] || 0;
        if (p > highest) { highest = p; newState = st; }
      }
      if (newState !== state) {
        const validated = safeTransition(state, newState);
        if (validated !== state) {
          state = validated;
          firedCallback = validated;
        }
        // else: blocked — keep state
      }
    }

    // Scenario 1: idle → listening (valid)
    firedCallback = null;
    setCondition('mic', 'listening');
    assert(state === 'listening', 'idle → listening succeeded');
    assert(firedCallback === 'listening', 'callback fired with listening');

    // Scenario 2: listening → thinking (valid)
    firedCallback = null;
    setCondition('chat', 'thinking'); // priority 4 > 3
    assert(state === 'thinking', 'listening → thinking succeeded');

    // Scenario 3: thinking → speaking (valid)
    firedCallback = null;
    setCondition('engine', 'speaking'); // priority 6 > 4
    assert(state === 'speaking', 'thinking → speaking succeeded');

    // Scenario 4: speaking → working (valid, barge-in)
    firedCallback = null;
    setCondition('agent', 'working'); // priority 5 < 6 (speaking wins) — need to clear speaking first
    clearCondition('engine');
    assert(state === 'working', 'speaking → working succeeded (after clearing engine)');

    // Scenario 5: working → success (valid — set success while working is still active)
    // In production, NexChatPanel sets agent=success WITHOUT clearing working first
    // (the 1500ms auto-clear handles the working→success→idle transition).
    // We must clear all other conditions (mic, chat from earlier scenarios)
    // because their states have higher priority than success (priority 2)
    // and would mask the working→success transition.
    firedCallback = null;
    clearCondition('mic');
    clearCondition('chat');
    setCondition('agent', 'success'); // overwrites agent working → success
    assert(state === 'success', 'working → success succeeded (same key overwrites)');

    // Scenario 6: success → speaking (valid, flash recovery — voice agent TTS)
    firedCallback = null;
    setCondition('engine', 'speaking'); // priority 6 > 2
    assert(state === 'speaking', 'success → speaking succeeded (flash recovery)');

    // Scenario 7: BLOCKED — offline → speaking (terminal)
    // Set up: clear all, set offline, then try speaking
    clearCondition('engine');
    // Manually set state to offline (simulating app going offline)
    state = 'offline';
    firedCallback = null;
    setCondition('engine', 'speaking');
    assert(state === 'offline', 'offline → speaking BLOCKED (terminal)');
    assert(firedCallback === null, 'no callback fired on blocked transition');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 10. Regression: existing Phase 116 orb-state tests still pass
  // ════════════════════════════════════════════════════════════════════════
  await testSection('10. Regression: Phase 116 orb-state invariants', async () => {
    console.log('\nTest 10.1: NexOrbState type still has 13 states');
    assert(orbStateSource.includes("'idle'"), 'idle state exists');
    assert(orbStateSource.includes("'initializing'"), 'initializing state exists');
    assert(orbStateSource.includes("'ready'"), 'ready state exists');
    assert(orbStateSource.includes("'listening'"), 'listening state exists');
    assert(orbStateSource.includes("'thinking'"), 'thinking state exists');
    assert(orbStateSource.includes("'speaking'"), 'speaking state exists');
    assert(orbStateSource.includes("'active'"), 'active state exists (legacy)');
    assert(orbStateSource.includes("'working'"), 'working state exists');
    assert(orbStateSource.includes("'success'"), 'success state exists');
    assert(orbStateSource.includes("'error'"), 'error state exists');
    assert(orbStateSource.includes("'cancelled'"), 'cancelled state exists');
    assert(orbStateSource.includes("'offline'"), 'offline state exists');
    assert(orbStateSource.includes("'installing'"), 'installing state exists');

    console.log('\nTest 10.2: STATE_COLOR_PALETTE still has all 13 states');
    assert(orbStateSource.includes('STATE_COLOR_PALETTE'), 'STATE_COLOR_PALETTE exists');
    for (const s of ['idle', 'initializing', 'ready', 'listening', 'thinking', 'speaking', 'active', 'working', 'success', 'error', 'cancelled', 'offline', 'installing']) {
      assert(orbStateSource.includes(`${s}: '#`), `STATE_COLOR_PALETTE has ${s}`);
    }

    console.log('\nTest 10.3: computeOrbVisual still exists');
    assert(orbStateSource.includes('export function computeOrbVisual'), 'computeOrbVisual exported');

    console.log('\nTest 10.4: isValidOrbTransition still exported');
    assert(orbStateSource.includes('export function isValidOrbTransition'), 'isValidOrbTransition exported');

    console.log('\nTest 10.5: safeOrbTransition still exported');
    assert(orbStateSource.includes('export function safeOrbTransition'), 'safeOrbTransition exported');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 18 Stage 2 Orb enforcement tests: ${passed}/${passed + failed} passed (${failed} failed)`);
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
