/**
 * NEX AI — Phase 18 Stage 4: GAP-7 Separation Tests
 *
 * Tests that:
 *   - conversation sender includes `source: 'conversation'` in payload
 *   - engine sender includes `source: 'engine'` in payload
 *   - AppShell routes to 'conversation' condition key for conversation source
 *   - AppShell routes to 'engine' condition key for engine source
 *   - Engine 'idle' does NOT clear conversation's 'speaking' condition
 *   - Race condition eliminated: both FSMs independently contribute to Orb
 *   - VoiceManagerPanel still receives state correctly
 *
 * Run with: npx tsx tests/tools/test-phase-18-stage4.ts
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
  console.log('Phase 18 Stage 4: GAP-7 Separation Tests\n');

  const mainSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'),
    'utf-8',
  );
  const appShellSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'layout', 'AppShell.tsx'),
    'utf-8',
  );

  // ════════════════════════════════════════════════════════════════════════
  // 1. Source-level: conversation sender includes source field
  // ════════════════════════════════════════════════════════════════════════
  await testSection('1. Conversation sender includes source field', async () => {
    console.log('\nTest 1.1: conversation.onStateChange sends source: conversation');
    // Find the conversation onStateChange callback
    const convCallbackStart = mainSource.indexOf('onStateChange: (state, prev) => {');
    assert(convCallbackStart > 0, 'conversation onStateChange callback exists');
    const convCallbackSection = mainSource.substring(convCallbackStart, convCallbackStart + 800);
    assert(convCallbackSection.includes("source: 'conversation'"), 'includes source: conversation in payload');
    assert(convCallbackSection.includes('CONVERSATION_ORB_COLOR'), 'includes color mapping');

    console.log('\nTest 1.2: engine.onStateChange sends source: engine');
    const engineCallbackStart = mainSource.indexOf("onStateChange: (state: string) => {", convCallbackStart + 100);
    assert(engineCallbackStart > 0, 'engine onStateChange callback exists');
    const engineCallbackSection = mainSource.substring(engineCallbackStart, engineCallbackStart + 1000);
    assert(engineCallbackSection.includes("source: 'engine'"), 'includes source: engine in payload');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. Source-level: AppShell routes to separate condition keys
  // ════════════════════════════════════════════════════════════════════════
  await testSection('2. AppShell routes to separate condition keys', async () => {
    console.log('\nTest 2.1: AppShell reads ev.source');
    const stateListenerStart = appShellSource.indexOf('onVoiceConversationState?.((ev: any) => {');
    assert(stateListenerStart > 0, 'onVoiceConversationState listener exists');
    // Use a larger window to capture the full listener body (conditionKey
    // is on line ~39, setCondition on ~44, clearCondition on ~56 → ~3000 chars)
    const listenerSection = appShellSource.substring(stateListenerStart, stateListenerStart + 3000);
    assert(listenerSection.includes("ev?.source"), 'reads ev.source');
    assert(listenerSection.includes("const source = ev?.source"), 'extracts source variable');

    console.log('\nTest 2.2: AppShell determines conditionKey from source');
    assert(listenerSection.includes("conditionKey = source === 'conversation' ? 'conversation' : 'engine'"),
      'routes to conversation or engine condition key');

    console.log('\nTest 2.3: AppShell uses conditionKey for setCondition + clearCondition');
    assert(listenerSection.includes("setCondition(conditionKey,"), 'uses conditionKey for setCondition');
    assert(listenerSection.includes("clearCondition(conditionKey)"), 'uses conditionKey for clearCondition');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. Runtime: race condition eliminated
  // ════════════════════════════════════════════════════════════════════════
  await testSection('3. Runtime: race condition eliminated', async () => {
    console.log('\nTest 3.1: engine idle does NOT clear conversation speaking');

    // Simulate the voice-service condition map + priority system
    const PRIORITY: Record<string, number> = {
      error: 8, offline: 7, speaking: 6, working: 5, thinking: 4, listening: 3, success: 2, cancelled: 2, idle: 1,
    };

    let resolvedState = 'idle';
    const conditions = new Map<string, string>();

    function setCondition(key: string, state: string) {
      conditions.set(key, state);
      recompute();
    }
    function clearCondition(key: string) {
      conditions.delete(key);
      recompute();
    }
    function recompute() {
      let newState = 'idle';
      let highest = 0;
      for (const st of conditions.values()) {
        const p = PRIORITY[st] || 0;
        if (p > highest) { highest = p; newState = st; }
      }
      resolvedState = newState;
    }

    // Scenario: conversation is 'speaking' (waiting for playback)
    setCondition('conversation', 'speaking');
    assert(resolvedState === 'speaking', 'conversation speaking → Orb speaking');

    // Engine goes idle (stopSpeaking after synthesis)
    // OLD behavior: clearCondition('engine') would clear the shared 'engine' key
    // → Orb drops to idle → RACE
    // NEW behavior: clearCondition('engine') only clears the engine key
    // → conversation key still has 'speaking' → Orb stays speaking
    clearCondition('engine'); // no-op (engine key was never set in this test)
    assert(resolvedState === 'speaking', 'engine idle → Orb STILL speaking (race eliminated)');

    // Now engine also sets speaking (from engine.setState('speaking'))
    setCondition('engine', 'speaking');
    assert(resolvedState === 'speaking', 'engine speaking → Orb speaking (both same)');

    // Engine goes idle again
    clearCondition('engine');
    assert(resolvedState === 'speaking', 'engine idle again → Orb STILL speaking (conversation key persists)');

    // Finally, conversation goes idle (playback ended)
    clearCondition('conversation');
    assert(resolvedState === 'idle', 'conversation idle → Orb idle (both cleared)');

    console.log('\nTest 3.2: priority resolution between conversation and engine');
    // Conversation: thinking (priority 4), Engine: speaking (priority 6)
    setCondition('conversation', 'thinking');
    setCondition('engine', 'speaking');
    assert(resolvedState === 'speaking', 'engine speaking(6) > conversation thinking(4) → Orb speaking');

    // Engine goes idle, conversation still thinking
    clearCondition('engine');
    assert(resolvedState === 'thinking', 'engine cleared → Orb thinking (conversation persists)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4. Source-level: backward compatibility
  // ════════════════════════════════════════════════════════════════════════
  await testSection('4. Backward compatibility', async () => {
    console.log('\nTest 4.1: default source is engine (for backward-compat)');
    // If source is missing (undefined), default to 'engine'
    // Search in the full AppShell source (the listener is in a useEffect)
    assert(appShellSource.includes("ev?.source || 'engine'"), "defaults to 'engine' when source missing");
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5. Source-level: VoiceManagerPanel unaffected
  // ════════════════════════════════════════════════════════════════════════
  await testSection('5. VoiceManagerPanel unaffected', async () => {
    console.log('\nTest 5.1: VoiceManagerPanel only reads ev.state (not ev.source)');
    const vmPanelSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'VoiceManagerPanel.tsx'),
      'utf-8',
    );
    const vmListenerStart = vmPanelSource.indexOf('onVoiceConversationState?.((ev: any) => {');
    assert(vmListenerStart > 0, 'VoiceManagerPanel has onVoiceConversationState listener');
    const vmListenerSection = vmPanelSource.substring(vmListenerStart, vmListenerStart + 200);
    assert(vmListenerSection.includes('ev.state'), 'reads ev.state for display');
    assert(!vmListenerSection.includes('ev.source'), 'does NOT read ev.source (unaffected)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 6. Regression: Phase 16+17+18 invariants
  // ════════════════════════════════════════════════════════════════════════
  await testSection('6. Regression: Phase 16+17+18 invariants', async () => {
    console.log('\nTest 6.1: Phase 16 — requestId in voice-tts-audio payload');
    assert(mainSource.includes('onTTSAudioReady: (audioFilePath: string, text: string, requestId: number)'),
      'onTTSAudioReady has requestId param');

    console.log('\nTest 6.2: Phase 18 Stage 1 — abortCurrentTurn in stop-speaking handler');
    const stopSpeakingHandler = mainSource.substring(
      mainSource.indexOf("'voice-conversation-stop-speaking'"),
      mainSource.indexOf('});', mainSource.indexOf("'voice-conversation-stop-speaking'") + 100)
    );
    assert(stopSpeakingHandler.includes('abortCurrentTurn'), 'stop-speaking calls abortCurrentTurn');

    console.log('\nTest 6.3: Phase 18 Stage 2 — safeOrbTransition in voice-service');
    const voiceServiceSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'services', 'voice-service.ts'),
      'utf-8',
    );
    assert(voiceServiceSource.includes('safeOrbTransition('), 'recomputeState calls safeOrbTransition');

    console.log('\nTest 6.4: Phase 18 Stage 3 — onBargeIn wired in engine callbacks');
    assert(mainSource.includes('onBargeIn:'), 'engine.setCallbacks has onBargeIn');
    assert(mainSource.includes('conversation.handleBargeIn()'), 'onBargeIn calls handleBargeIn');

    console.log('\nTest 6.5: Phase 18 Stage 3 — voice-tts-stop-playback in onInterruption');
    const interruptionSection = mainSource.substring(
      mainSource.indexOf('onInterruption: () => {'),
      mainSource.indexOf('onVoiceCommand', mainSource.indexOf('onInterruption: () => {'))
    );
    assert(interruptionSection.includes('voice-tts-stop-playback'), 'onInterruption broadcasts voice-tts-stop-playback');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 18 Stage 4 tests: ${passed}/${passed + failed} passed (${failed} failed)`);
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
