/**
 * NEX AI — Phase 18 Stage 2: Orb State Flow Tests (BUG-37)
 *
 * Tests that all documented production flows produce ONLY valid transitions
 * under the relaxed VALID_TRANSITIONS graph:
 *
 *   1. Voice flow: idle → listening → thinking → speaking → listening → idle
 *   2. Chat flow: idle → thinking → listening → idle
 *   3. Agent flow: idle → thinking → working → success → idle
 *   4. Voice agent flow: idle → listening → thinking → working → success →
 *      speaking → listening
 *   5. Barge-in flow: speaking → listening → working → thinking
 *   6. Flash recovery: success → speaking, error → thinking, cancelled → working
 *   7. Error flash: idle → thinking → error → idle (auto-clear 1500ms)
 *   8. Cancel flash: idle → thinking → working → cancelled → idle (auto-clear 1500ms)
 *
 * Run with: npx tsx tests/tools/test-phase-18-orb-state-flows.ts
 */

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

// Mirror the relaxed VALID_TRANSITIONS from orb-state.ts (post-Phase 18)
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

// Priority system (from voice-service.ts STATE_PRIORITY)
const PRIORITY: Record<string, number> = {
  error: 8, offline: 7, speaking: 6, working: 5, thinking: 4, listening: 3, success: 2, cancelled: 2, idle: 1,
};

// Simulate voiceService + voiceController with enforcement
class OrbStateMachine {
  private state = 'idle';
  private conditions = new Map<string, string>();
  public transitions: string[] = ['idle']; // log all transitions
  public blocked: string[] = []; // log blocked transitions

  setCondition(key: string, st: string): void {
    this.conditions.set(key, st);
    this.recompute();
  }
  clearCondition(key: string): void {
    this.conditions.delete(key);
    this.recompute();
  }
  getState(): string { return this.state; }

  private recompute(): void {
    let newState = 'idle';
    let highest = 0;
    for (const st of this.conditions.values()) {
      const p = PRIORITY[st] || 0;
      if (p > highest) { highest = p; newState = st; }
    }
    if (newState !== this.state) {
      const validated = safeTransition(this.state, newState);
      if (validated !== this.state) {
        this.transitions.push(validated);
        this.state = validated;
      } else {
        this.blocked.push(`${this.state} → ${newState}`);
      }
    }
  }
}

async function runTests() {
  console.log('Phase 18 Stage 2: Orb State Flow Tests (BUG-37)\n');

  // ════════════════════════════════════════════════════════════════════════
  // 1. Voice flow: idle → listening → thinking → speaking → listening → idle
  // ════════════════════════════════════════════════════════════════════════
  await testSection('1. Voice flow: idle → listening → thinking → speaking → listening → idle', async () => {
    const sm = new OrbStateMachine();
    console.log('\nTest 1.1: All transitions valid');
    sm.setCondition('mic', 'listening');    // idle → listening
    sm.setCondition('engine', 'thinking');  // listening → thinking (engine=thinking priority 4 > mic=listening 3)
    sm.setCondition('engine', 'speaking');  // thinking → speaking (engine=speaking priority 6 > thinking 4)
    sm.clearCondition('engine');             // speaking → listening (engine cleared, mic=listening priority 3 wins)
    sm.clearCondition('mic');                // listening → idle (mic cleared, no conditions → idle)

    const expected = ['idle', 'listening', 'thinking', 'speaking', 'listening', 'idle'];
    assert(JSON.stringify(sm.transitions) === JSON.stringify(expected), `transitions match voice flow: ${sm.transitions.join(' → ')}`);
    assert(sm.blocked.length === 0, `no blocked transitions (got ${sm.blocked.length})`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. Chat flow: idle → thinking → listening → idle
  // ════════════════════════════════════════════════════════════════════════
  await testSection('2. Chat flow: idle → thinking → listening → idle', async () => {
    const sm = new OrbStateMachine();
    console.log('\nTest 2.1: All transitions valid (chat with voice mic on)');
    // Chat sets 'chat'=thinking (NexChatPanel.tsx:377-378)
    // Then chat completes, setThinking(false) clears 'chat'
    // But mic is still listening (continuous mode) → state goes thinking → listening
    sm.setCondition('mic', 'listening');    // idle → listening
    sm.setCondition('chat', 'thinking');     // listening → thinking (chat=thinking 4 > mic=listening 3)
    sm.clearCondition('chat');               // thinking → listening (chat cleared, mic=listening 3 wins)
    sm.clearCondition('mic');                // listening → idle

    // Expected: idle → listening → thinking → listening → idle
    const expected = ['idle', 'listening', 'thinking', 'listening', 'idle'];
    assert(JSON.stringify(sm.transitions) === JSON.stringify(expected), `transitions match chat flow: ${sm.transitions.join(' → ')}`);
    assert(sm.blocked.length === 0, `no blocked transitions`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. Agent flow: idle → thinking → working → success → idle
  // ════════════════════════════════════════════════════════════════════════
  await testSection('3. Agent flow: idle → thinking → working → success → idle', async () => {
    const sm = new OrbStateMachine();
    console.log('\nTest 3.1: All transitions valid (agent task lifecycle)');
    // Agent task: planning_started → thinking, planning_completed → working,
    // task_completed → success (auto-clear 1500ms → idle)
    sm.setCondition('agent', 'thinking');   // idle → thinking
    sm.setCondition('agent', 'working');    // thinking → working
    sm.setCondition('agent', 'success');    // working → success (overwrites agent, priority 2)
    sm.clearCondition('agent');              // success → idle (auto-clear)

    const expected = ['idle', 'thinking', 'working', 'success', 'idle'];
    assert(JSON.stringify(sm.transitions) === JSON.stringify(expected), `transitions match agent flow: ${sm.transitions.join(' → ')}`);
    assert(sm.blocked.length === 0, `no blocked transitions`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4. Voice agent flow: idle → listening → thinking → working → success →
  //    speaking → listening
  // ════════════════════════════════════════════════════════════════════════
  await testSection('4. Voice agent flow: full cycle with TTS', async () => {
    const sm = new OrbStateMachine();
    console.log('\nTest 4.1: All transitions valid (voice → agent → TTS → listen again)');
    // 1. User speaks → mic listening
    sm.setCondition('mic', 'listening');     // idle → listening
    // 2. Transcript → brainRoute → agent task → planning
    //    When agent task starts, mic is stopped (engine.stopListening in
    //    speakResponse or handleUserUtterance). Clear mic condition.
    sm.clearCondition('mic');
    sm.setCondition('agent', 'thinking');    // listening → thinking
    // 3. Plan created → tool execution
    sm.setCondition('agent', 'working');     // thinking → working
    // 4. Task completed → success flash
    sm.setCondition('agent', 'success');     // working → success
    // 5. speakResponseIfVoice → engine speaking (TTS)
    //    success has priority 2, speaking has priority 6 — speaking wins
    sm.setCondition('engine', 'speaking');   // success → speaking (flash recovery!)
    // 6. TTS playback ends → enterListening → engine listening
    sm.clearCondition('engine');              // speaking → idle (engine cleared, no other condition)
    // 7. Auto-clear success after 1500ms (in production, timer fires)
    sm.clearCondition('agent');               // idle → idle (success was already cleared by priority)
    // 8. Mic restarts (enterListening → mic condition set)
    sm.setCondition('mic', 'listening');     // idle → listening

    const expected = ['idle', 'listening', 'idle', 'thinking', 'working', 'success', 'speaking', 'success', 'idle', 'listening'];
    assert(JSON.stringify(sm.transitions) === JSON.stringify(expected), `transitions match voice agent flow: ${sm.transitions.join(' → ')}`);
    assert(sm.blocked.length === 0, `no blocked transitions`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5. Barge-in flow: speaking → listening → working → thinking
  // ════════════════════════════════════════════════════════════════════════
  await testSection('5. Barge-in flow: speaking → listening → working → thinking', async () => {
    const sm = new OrbStateMachine();
    console.log('\nTest 5.1: Barge-in transitions valid (relaxed graph)');
    // Setup: listening → thinking → speaking (normal voice flow before barge-in).
    // Note: idle → speaking is NOT in the valid list (the Orb must go through
    // listening/thinking first). This is intentional — prevents silent state
    // desync where the conversation FSM sends 'speaking' without first
    // going through the normal flow.
    sm.setCondition('mic', 'listening');     // idle → listening
    sm.setCondition('engine', 'thinking');   // listening → thinking
    sm.setCondition('engine', 'speaking');   // thinking → speaking
    // Barge-in: user speaks → main-side detection → stop TTS → restart listening
    sm.clearCondition('engine');              // speaking → listening (engine cleared, mic=listening 3 wins)
    // New agent task starts (barge-in utterance triggers brainRoute → agent)
    sm.clearCondition('mic');                  // listening → idle (mic stopped for agent)
    sm.setCondition('agent', 'working');    // idle → working (agent task starts)
    sm.setCondition('agent', 'thinking');   // working → thinking (recovery replan)

    const expected = ['idle', 'listening', 'thinking', 'speaking', 'listening', 'idle', 'working', 'thinking'];
    assert(JSON.stringify(sm.transitions) === JSON.stringify(expected), `transitions match barge-in flow: ${sm.transitions.join(' → ')}`);
    assert(sm.blocked.length === 0, `no blocked transitions in barge-in`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 6. Flash recovery: success → speaking, error → thinking, cancelled → working
  // ════════════════════════════════════════════════════════════════════════
  await testSection('6. Flash recovery: flash states can transition to active', async () => {
    console.log('\nTest 6.1: success → speaking (voice agent TTS after task completed)');
    const sm1 = new OrbStateMachine();
    // Setup: idle → thinking → working → success (the normal agent flow)
    sm1.setCondition('agent', 'thinking');   // idle → thinking
    sm1.setCondition('agent', 'working');    // thinking → working
    sm1.setCondition('agent', 'success');    // working → success
    sm1.setCondition('engine', 'speaking');  // success → speaking (flash recovery!)
    assert(sm1.getState() === 'speaking', 'success → speaking succeeded (flash recovery)');
    assert(sm1.blocked.length === 0, 'no blocked transitions');

    console.log('\nTest 6.2: error → thinking (new task starts during error flash)');
    const sm2 = new OrbStateMachine();
    sm2.setCondition('agent', 'thinking');   // idle → thinking
    sm2.setCondition('agent', 'working');    // thinking → working
    sm2.setCondition('agent', 'error');      // working → error (task failed)
    // Phase 18 (P2-1): stale timer protection — when a new task starts
    // during the error flash, the agent condition is overwritten with
    // 'thinking' (same key). error has priority 8, thinking has priority 4.
    // The resolved state drops from error (8) to thinking (4) — but ONLY
    // if no other condition has higher priority. In this case, agent is
    // the only condition, so the transition is error → thinking.
    sm2.setCondition('agent', 'thinking');    // error → thinking (flash recovery!)
    assert(sm2.getState() === 'thinking', 'error → thinking succeeded (flash recovery)');

    console.log('\nTest 6.3: cancelled → working (new task starts during cancel flash)');
    const sm3 = new OrbStateMachine();
    sm3.setCondition('agent', 'thinking');   // idle → thinking
    sm3.setCondition('agent', 'working');    // thinking → working
    sm3.setCondition('agent', 'cancelled');  // working → cancelled (task cancelled)
    sm3.setCondition('agent', 'working');    // cancelled → working (flash recovery — new task)
    assert(sm3.getState() === 'working', 'cancelled → working succeeded (flash recovery)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 7. Error flash: idle → thinking → error → idle (auto-clear 1500ms)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('7. Error flash: idle → thinking → error → idle', async () => {
    const sm = new OrbStateMachine();
    console.log('\nTest 7.1: Error flash + auto-clear returns to idle');
    sm.setCondition('agent', 'thinking');   // idle → thinking
    sm.setCondition('agent', 'error');     // thinking → error (task failed)
    sm.clearCondition('agent');              // error → idle (auto-clear 1500ms)

    const expected = ['idle', 'thinking', 'error', 'idle'];
    assert(JSON.stringify(sm.transitions) === JSON.stringify(expected), `transitions match error flash: ${sm.transitions.join(' → ')}`);
    assert(sm.blocked.length === 0, 'no blocked transitions');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 8. Cancel flash: idle → thinking → working → cancelled → idle (auto-clear)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('8. Cancel flash: idle → thinking → working → cancelled → idle', async () => {
    const sm = new OrbStateMachine();
    console.log('\nTest 8.1: Cancel flash + auto-clear returns to idle');
    sm.setCondition('agent', 'thinking');   // idle → thinking
    sm.setCondition('agent', 'working');    // thinking → working
    sm.setCondition('agent', 'cancelled');  // working → cancelled (task cancelled)
    sm.clearCondition('agent');              // cancelled → idle (auto-clear 1500ms)

    const expected = ['idle', 'thinking', 'working', 'cancelled', 'idle'];
    assert(JSON.stringify(sm.transitions) === JSON.stringify(expected), `transitions match cancel flash: ${sm.transitions.join(' → ')}`);
    assert(sm.blocked.length === 0, 'no blocked transitions');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 9. Terminal states: offline + installing cannot transition to active
  // ════════════════════════════════════════════════════════════════════════
  await testSection('9. Terminal states block active transitions', async () => {
    console.log('\nTest 9.1: offline → speaking BLOCKED');
    assert(safeTransition('offline', 'speaking') === 'offline', 'offline → speaking blocked');
    assert(safeTransition('offline', 'working') === 'offline', 'offline → working blocked');
    assert(safeTransition('offline', 'thinking') === 'offline', 'offline → thinking blocked');

    console.log('\nTest 9.2: installing → speaking BLOCKED');
    assert(safeTransition('installing', 'speaking') === 'installing', 'installing → speaking blocked');
    assert(safeTransition('installing', 'working') === 'installing', 'installing → working blocked');
    assert(safeTransition('installing', 'thinking') === 'installing', 'installing → thinking blocked');

    console.log('\nTest 9.3: offline → idle ALLOWED (recovery)');
    assert(safeTransition('offline', 'idle') === 'idle', 'offline → idle allowed');
    assert(safeTransition('offline', 'initializing') === 'initializing', 'offline → initializing allowed');

    console.log('\nTest 9.4: installing → ready ALLOWED (complete)');
    assert(safeTransition('installing', 'ready') === 'ready', 'installing → ready allowed');
    assert(safeTransition('installing', 'error') === 'error', 'installing → error allowed');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 10. No-op transitions always allowed
  // ════════════════════════════════════════════════════════════════════════
  await testSection('10. No-op transitions (from === to) always allowed', async () => {
    const states = ['idle', 'listening', 'thinking', 'speaking', 'working', 'success', 'error', 'cancelled', 'offline', 'installing'];
    for (const s of states) {
      assert(safeTransition(s, s) === s, `${s} → ${s} no-op allowed`);
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 18 Stage 2 Orb flow tests: ${passed}/${passed + failed} passed (${failed} failed)`);
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
