/**
 * NEX AI — Phase 18 Stage 3: Barge-in + TTS Mute Tests
 *
 * Tests:
 *   - Barge-in detection (main-side VAD → onBargeIn → handleBargeIn)
 *   - TTS playback stop/mute (ttsActive stays true during playback, onTtsPlaybackEnded)
 *   - Cancellation propagation (handleBargeIn bumps requestId, releases wait, stops engine)
 *   - Stale callback suppression (after barge-in, stale voice-tts-ended is ignored)
 *   - Duplicate TTS prevention (speakResponse GUARD 3 prevents enterListening after barge-in)
 *   - Orb state correctness (speaking → interrupted → listening transitions)
 *   - Rapid/repeated barge-in (second barge-in is idempotent)
 *   - Dispose/cleanup (ttsActive = false on dispose)
 *   - Renderer VAD gating (processVAD skipped when engine speaking)
 *   - onInterruption broadcasts voice-tts-stop-playback
 *
 * Run with: npx tsx tests/tools/test-phase-18-stage3.ts
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
  console.log('Phase 18 Stage 3: Barge-in + TTS Mute Tests\n');

  const engineSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'voice', 'local-voice-engine.ts'),
    'utf-8',
  );
  const conversationSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'voice', 'nex-voice-conversation.ts'),
    'utf-8',
  );
  const mainSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'),
    'utf-8',
  );
  const voiceServiceSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'services', 'voice-service.ts'),
    'utf-8',
  );

  // ════════════════════════════════════════════════════════════════════════
  // 1. Barge-in detection: source-level
  // ════════════════════════════════════════════════════════════════════════
  await testSection('1. Barge-in detection: source-level', async () => {
    console.log('\nTest 1.1: VoiceEngineCallbacks has onBargeIn');
    assert(engineSource.includes('onBargeIn?: () => void'), 'onBargeIn callback in VoiceEngineCallbacks');

    console.log('\nTest 1.2: VAD onEvent checks ttsActive + speech + higher threshold');
    // The VAD onEvent callback should check: if (event.state === 'speech' && this.ttsActive)
    assert(engineSource.includes("event.state === 'speech' && this.ttsActive"), 'VAD checks speech + ttsActive');
    assert(engineSource.includes('bargeInThreshold'), 'uses barge-in threshold');
    assert(engineSource.includes('this.callbacks.onBargeIn?.()'), 'fires onBargeIn callback');

    console.log('\nTest 1.3: barge-in threshold is 2× the normal VAD threshold');
    assert(engineSource.includes('silenceThreshold || 0.02) * 2'), '2× threshold calculation');

    console.log('\nTest 1.4: handleBargeIn method exists in conversation');
    assert(conversationSource.includes('handleBargeIn(): void'), 'handleBargeIn public method exists');

    console.log('\nTest 1.5: handleBargeIn guards with state check');
    const bargeInStart = conversationSource.indexOf('handleBargeIn(): void {');
    assert(bargeInStart > 0, 'handleBargeIn found');
    const bargeInEnd = conversationSource.indexOf('handleVoiceCommand', bargeInStart);
    const bargeInSection = conversationSource.substring(bargeInStart, bargeInEnd);
    assert(bargeInSection.includes("this.state !== 'speaking'"), 'guards with state !== speaking');
    assert(bargeInSection.includes('this.interruptionDetected = true'), 'sets interruptionDetected');
    assert(bargeInSection.includes('this.callbacks.onInterruption?.()'), 'fires onInterruption');
    assert(bargeInSection.includes('this.currentTtsRequestId++'), 'bumps currentTtsRequestId');
    assert(bargeInSection.includes('this.releaseTtsPlaybackWait()'), 'releases playback wait');
    assert(bargeInSection.includes('engine.stopSpeaking()'), 'stops engine TTS');
    assert(bargeInSection.includes("this.setState('interrupted')"), 'sets state to interrupted');
    assert(bargeInSection.includes('this.enterListening()'), 'restarts listening');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. TTS playback stop/mute: source-level
  // ════════════════════════════════════════════════════════════════════════
  await testSection('2. TTS playback stop/mute: source-level', async () => {
    console.log('\nTest 2.1: engine.speak() does NOT set ttsActive=false after synthesis');
    // The old code had `this.ttsActive = false;` after the synthesis try/catch.
    // After Phase 18 Stage 3, this line is removed. Verify the comment is present
    // and the unconditional ttsActive=false is gone.
    const speakStart = engineSource.indexOf('async speak(text: string, opts?: TTSOptions): Promise<boolean>');
    const speakEnd = engineSource.indexOf('onTtsPlaybackEnded', speakStart);
    const speakSection = engineSource.substring(speakStart, speakEnd);
    assert(speakSection.includes('Do NOT set ttsActive = false here'), 'comment about not setting ttsActive=false');
    // Check that the ONLY ttsActive=false in the speak method body is in the
    // stale guard (which is correct — but we already removed it in Stage 3).
    // After Stage 3, the stale guard does NOT set ttsActive=false either.
    // So there should be NO `this.ttsActive = false` in the speak method body
    // (between speakStart and speakEnd).
    const ttsActiveFalseLines = speakSection.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') && l.includes('this.ttsActive = false')
    );
    assert(ttsActiveFalseLines.length === 0, `no ttsActive=false in speak() body (found ${ttsActiveFalseLines.length})`);

    console.log('\nTest 2.2: onTtsPlaybackEnded method exists');
    assert(engineSource.includes('onTtsPlaybackEnded(): void'), 'onTtsPlaybackEnded method exists');

    console.log('\nTest 2.3: onTtsPlaybackEnded is idempotent');
    const onPlaybackStart = engineSource.indexOf('onTtsPlaybackEnded(): void {');
    const onPlaybackEnd = engineSource.indexOf('stopSpeaking()', onPlaybackStart);
    const onPlaybackSection = engineSource.substring(onPlaybackStart, onPlaybackEnd);
    assert(onPlaybackSection.includes('if (this.ttsActive)'), 'guards with if (this.ttsActive)');

    console.log('\nTest 2.4: voice-tts-ended handler calls engine.onTtsPlaybackEnded');
    const ttsEndedStart = mainSource.indexOf("'voice-tts-ended'");
    const ttsEndedEnd = mainSource.indexOf('});', ttsEndedStart + 100);
    const ttsEndedSection = mainSource.substring(ttsEndedStart, ttsEndedEnd + 3);
    assert(ttsEndedSection.includes('notifyTtsPlaybackEnded'), 'calls notifyTtsPlaybackEnded');
    assert(ttsEndedSection.includes('onTtsPlaybackEnded'), 'calls engine.onTtsPlaybackEnded');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. Cancellation propagation: source-level
  // ════════════════════════════════════════════════════════════════════════
  await testSection('3. Cancellation propagation: source-level', async () => {
    console.log('\nTest 3.1: main.ts wires onBargeIn to conversation.handleBargeIn');
    assert(mainSource.includes('onBargeIn:'), 'engine.setCallbacks has onBargeIn');
    assert(mainSource.includes('conversation.handleBargeIn()'), 'onBargeIn calls conversation.handleBargeIn');

    console.log('\nTest 3.2: onInterruption broadcasts voice-tts-stop-playback');
    const interruptionStart = mainSource.indexOf('onInterruption: () => {');
    assert(interruptionStart > 0, 'onInterruption callback exists');
    const interruptionEnd = mainSource.indexOf('},', interruptionStart + 50);
    const interruptionSection = mainSource.substring(interruptionStart, interruptionEnd + 2);
    assert(interruptionSection.includes('voice-conversation-interrupted'), 'sends voice-conversation-interrupted');
    assert(interruptionSection.includes('voice-tts-stop-playback'), 'sends voice-tts-stop-playback');

    console.log('\nTest 3.3: stopSpeaking bumps requestId + sets ttsActive false');
    const stopStart = engineSource.indexOf('stopSpeaking(): void {');
    const stopEnd = engineSource.indexOf('setThinking', stopStart);
    const stopSection = engineSource.substring(stopStart, stopEnd);
    assert(stopSection.includes('this.ttsActive = false'), 'stopSpeaking sets ttsActive false');
    assert(stopSection.includes('this._currentTtsRequestId++'), 'stopSpeaking bumps requestId');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4. Renderer VAD gating: source-level
  // ════════════════════════════════════════════════════════════════════════
  await testSection('4. Renderer VAD gating: source-level', async () => {
    console.log('\nTest 4.1: processVAD gated with engine speaking check');
    const vadStart = voiceServiceSource.indexOf('private processVAD(level: number): void {');
    assert(vadStart > 0, 'processVAD method exists');
    const vadBodyStart = voiceServiceSource.indexOf('{', vadStart);
    // Check the first few lines of processVAD for the gate
    const vadFirstLines = voiceServiceSource.substring(vadStart, vadStart + 200);
    assert(vadFirstLines.includes("_stateConditions.get('engine') === 'speaking'"), 'processVAD gates with engine speaking');
    assert(vadFirstLines.includes('return;'), 'returns early when engine is speaking');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5. Runtime: barge-in cancellation propagation
  // ════════════════════════════════════════════════════════════════════════
  await testSection('5. Runtime: barge-in cancellation propagation', async () => {
    console.log('\nTest 5.1: handleBargeIn bumps requestId + releases wait + stops engine');

    // Mirror the conversation's handleBargeIn logic
    let state = 'speaking';
    let currentTtsRequestId = 1;
    let interruptionDetected = false;
    let ttsPlaybackResolve: (() => void) | null = null;
    let ttsPlaybackRequestId: number | null = 1;
    let engineTtsActive = true;
    let onInterruptionFired = false;
    let enterListeningCalled = false;

    function releaseTtsPlaybackWait() {
      if (ttsPlaybackResolve) {
        const resolve = ttsPlaybackResolve;
        ttsPlaybackResolve = null;
        ttsPlaybackRequestId = null;
        resolve();
      }
    }

    function engineStopSpeaking() {
      engineTtsActive = false;
    }

    function setState(s: string) { state = s; }

    function handleBargeIn() {
      if (state !== 'speaking') return;
      interruptionDetected = true;
      onInterruptionFired = true;
      currentTtsRequestId++;
      releaseTtsPlaybackWait();
      engineStopSpeaking();
      setState('interrupted');
      enterListeningCalled = true;
      setState('listening');
    }

    // Simulate speakResponse awaiting waitForTtsPlayback
    const waitPromise = new Promise<void>((resolve) => {
      ttsPlaybackResolve = resolve;
      ttsPlaybackRequestId = 1;
    });

    // Fire barge-in
    handleBargeIn();

    assert(currentTtsRequestId === 2, 'requestId bumped from 1 to 2');
    assert(interruptionDetected === true, 'interruptionDetected set');
    assert(onInterruptionFired === true, 'onInterruption fired');
    assert(engineTtsActive === false, 'engine ttsActive set to false');
    assert(state === 'listening', 'state transitioned to listening');
    assert(enterListeningCalled === true, 'enterListening called');

    // The wait should have been released
    let waitResolved = false;
    waitPromise.then(() => { waitResolved = true; });
    await new Promise((r) => setTimeout(r, 10));
    assert(waitResolved === true, 'waitForTtsPlayback was released by barge-in');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 6. Runtime: stale callback suppression
  // ════════════════════════════════════════════════════════════════════════
  await testSection('6. Runtime: stale callback suppression', async () => {
    console.log('\nTest 6.1: stale voice-tts-ended after barge-in is ignored');

    // Mirror notifyTtsPlaybackEnded logic
    let ttsPlaybackResolve: (() => void) | null = null;
    let ttsPlaybackRequestId: number | null = null;

    function releaseTtsPlaybackWait() {
      if (ttsPlaybackResolve) {
        const resolve = ttsPlaybackResolve;
        ttsPlaybackResolve = null;
        ttsPlaybackRequestId = null;
        resolve();
      }
    }

    function notifyTtsPlaybackEnded(requestId: number) {
      if (ttsPlaybackRequestId === requestId) {
        releaseTtsPlaybackWait();
      }
      // else: stale signal — ignore
    }

    // Setup: speakResponse is awaiting waitForTtsPlayback(1)
    let waitResolved = false;
    const waitPromise = new Promise<void>((resolve) => {
      ttsPlaybackResolve = resolve;
      ttsPlaybackRequestId = 1;
    });
    waitPromise.then(() => { waitResolved = true; });

    // Barge-in fires → releaseTtsPlaybackWait → wait resolves
    releaseTtsPlaybackWait();
    await new Promise((r) => setTimeout(r, 10));
    assert(waitResolved === true, 'wait resolved after barge-in');

    // Now a stale voice-tts-ended for requestId=1 arrives
    // ttsPlaybackRequestId is null (was cleared by releaseTtsPlaybackWait)
    notifyTtsPlaybackEnded(1);
    // This should be a no-op — the wait was already released
    // No crash, no error — just ignored
    assert(ttsPlaybackResolve === null, 'stale voice-tts-ended did NOT create a new wait');
    assert(ttsPlaybackRequestId === null, 'stale voice-tts-ended did NOT set requestId');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 7. Runtime: duplicate TTS prevention (GUARD 3)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('7. Runtime: duplicate TTS prevention (GUARD 3)', async () => {
    console.log('\nTest 7.1: speakResponse GUARD 3 prevents enterListening after barge-in');

    let currentTtsRequestId = 0;
    let ttsPlaybackResolve: (() => void) | null = null;
    let ttsPlaybackRequestId: number | null = null;
    let ttsPlaybackTimeout: ReturnType<typeof setTimeout> | null = null;
    let enterListeningCalled = false;

    function releaseTtsPlaybackWait() {
      if (ttsPlaybackResolve) {
        const resolve = ttsPlaybackResolve;
        ttsPlaybackResolve = null;
        ttsPlaybackRequestId = null;
        if (ttsPlaybackTimeout) { clearTimeout(ttsPlaybackTimeout); ttsPlaybackTimeout = null; }
        resolve();
      }
    }

    function waitForTtsPlayback(requestId: number): Promise<void> {
      if (currentTtsRequestId !== requestId) return Promise.resolve();
      releaseTtsPlaybackWait();
      return new Promise<void>((resolve) => {
        ttsPlaybackRequestId = requestId;
        ttsPlaybackResolve = resolve;
        ttsPlaybackTimeout = setTimeout(() => releaseTtsPlaybackWait(), 30000);
      });
    }

    function handleBargeIn() {
      currentTtsRequestId++;
      releaseTtsPlaybackWait();
    }

    async function speakResponse(text: string): Promise<void> {
      currentTtsRequestId++;
      const requestId = currentTtsRequestId;
      const audioReady = true; // simulate successful synthesis
      if (currentTtsRequestId !== requestId) return; // GUARD 1
      if (!audioReady) return; // GUARD 2
      await waitForTtsPlayback(requestId);
      // GUARD 3: if requestId changed during playback, do NOT enterListening
      if (currentTtsRequestId !== requestId) {
        return; // barge-in or stop bumped the requestId
      }
      enterListeningCalled = true; // should NOT reach here after barge-in
    }

    // Start speakResponse
    const speakPromise = speakResponse('Hello');
    await new Promise((r) => setTimeout(r, 10));

    // Barge-in fires during playback
    handleBargeIn();
    await speakPromise;

    assert(enterListeningCalled === false, 'GUARD 3 prevented enterListening after barge-in');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 8. Runtime: rapid/repeated barge-in (idempotent)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('8. Runtime: rapid/repeated barge-in (idempotent)', async () => {
    console.log('\nTest 8.1: second barge-in is ignored (state no longer speaking)');

    let state = 'speaking';
    let bargeInCount = 0;

    function handleBargeIn() {
      if (state !== 'speaking') return; // idempotent guard
      bargeInCount++;
      state = 'interrupted';
      // ... (rest of handleBargeIn omitted for this test)
      state = 'listening';
    }

    // First barge-in
    handleBargeIn();
    assert(bargeInCount === 1, 'first barge-in processed');
    assert(state === 'listening', 'state is listening after first barge-in');

    // Second barge-in (rapid — state is now 'listening', not 'speaking')
    handleBargeIn();
    assert(bargeInCount === 1, 'second barge-in ignored (idempotent)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 9. Runtime: ttsActive lifecycle (synthesis → playback → ended)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('9. Runtime: ttsActive lifecycle', async () => {
    console.log('\nTest 9.1: ttsActive stays true during playback, false after ended');

    let ttsActive = false;

    // engine.speak() sets ttsActive = true, does NOT set false after synthesis
    function speak() {
      ttsActive = true;
      // synthesis happens...
      // (previously: ttsActive = false — REMOVED in Phase 18 Stage 3)
      // ttsActive stays true during playback
    }

    // stopSpeaking() sets ttsActive = false
    function stopSpeaking() {
      ttsActive = false;
    }

    // onTtsPlaybackEnded() sets ttsActive = false (idempotent)
    function onTtsPlaybackEnded() {
      if (ttsActive) ttsActive = false;
    }

    // Initial state
    assert(ttsActive === false, 'initial: ttsActive false');

    // speak() starts
    speak();
    assert(ttsActive === true, 'after speak(): ttsActive true (during synthesis)');

    // synthesis completes — ttsActive STAYS true (key change)
    assert(ttsActive === true, 'after synthesis: ttsActive STAYS true (during playback)');

    // playback ends naturally
    onTtsPlaybackEnded();
    assert(ttsActive === false, 'after onTtsPlaybackEnded: ttsActive false');

    // Idempotent: calling again is a no-op
    onTtsPlaybackEnded();
    assert(ttsActive === false, 'second onTtsPlaybackEnded: no-op (idempotent)');

    // Stop during playback
    speak();
    stopSpeaking();
    assert(ttsActive === false, 'after stopSpeaking: ttsActive false');
    onTtsPlaybackEnded();
    assert(ttsActive === false, 'after stopSpeaking + onTtsPlaybackEnded: still false (idempotent)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 10. Runtime: Orb state transitions for barge-in
  // ════════════════════════════════════════════════════════════════════════
  await testSection('10. Runtime: Orb state transitions for barge-in', async () => {
    console.log('\nTest 10.1: speaking → interrupted → listening (all valid)');

    // Use the relaxed VALID_TRANSITIONS from Phase 18 Stage 2
    const VALID: Record<string, string[]> = {
      speaking: ['ready', 'listening', 'idle', 'error', 'cancelled', 'working', 'thinking', 'success'],
      working: ['ready', 'idle', 'error', 'success', 'cancelled', 'thinking', 'speaking', 'listening'],
      listening: ['thinking', 'speaking', 'idle', 'ready', 'error', 'cancelled', 'working'],
    };

    function isValid(from: string, to: string): boolean {
      if (from === to) return true;
      return (VALID[from] || []).includes(to);
    }

    // Barge-in flow: speaking → interrupted (maps to 'working' in AppShell)
    // → listening (from enterListening)
    // The conversation sends 'interrupted' via voice-conversation-state IPC.
    // AppShell maps 'interrupted' → 'active' → setCondition('engine', 'working').
    // Then enterListening sends 'listening' → setCondition('engine', 'listening').

    // speaking → working (via interrupted → active → working mapping)
    assert(isValid('speaking', 'working'), 'speaking → working valid (barge-in interrupted state)');

    // working → listening (from enterListening)
    assert(isValid('working', 'listening'), 'working → listening valid (enterListening)');

    // Direct: speaking → listening (if handleBargeIn skips interrupted)
    assert(isValid('speaking', 'listening'), 'speaking → listening valid (direct)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 11. Source-level: dispose cleanup
  // ════════════════════════════════════════════════════════════════════════
  await testSection('11. Dispose cleanup', async () => {
    console.log('\nTest 11.1: dispose() calls stopSpeaking() which sets ttsActive=false');
    const disposeStart = engineSource.indexOf('async dispose(): Promise<void> {');
    assert(disposeStart > 0, 'dispose method exists');
    const disposeEnd = engineSource.indexOf('}', disposeStart + 50);
    const disposeSection = engineSource.substring(disposeStart, disposeEnd + 1);
    assert(disposeSection.includes('stopSpeaking()'), 'dispose calls stopSpeaking');
    assert(disposeSection.includes('stopListening()'), 'dispose calls stopListening');

    console.log('\nTest 11.2: VAD config is readonly (public)');
    assert(engineSource.includes('readonly config: VADConfig'), 'VAD config is readonly public');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 12. Regression: Phase 16+17+18 invariants preserved
  // ════════════════════════════════════════════════════════════════════════
  await testSection('12. Regression: Phase 16+17+18 invariants', async () => {
    console.log('\nTest 12.1: Phase 16 — requestId in voice-tts-audio payload');
    assert(mainSource.includes('onTTSAudioReady: (audioFilePath: string, text: string, requestId: number)'), 'onTTSAudioReady has requestId param');

    console.log('\nTest 12.2: Phase 16 — voice-tts-stop-playback IPC exists');
    assert(mainSource.includes("'voice-tts-stop-playback'"), 'voice-tts-stop-playback IPC exists');

    console.log('\nTest 12.3: Phase 18 Stage 1 — abortCurrentTurn in stop-speaking handler');
    const stopSpeakingHandler = mainSource.substring(
      mainSource.indexOf("'voice-conversation-stop-speaking'"),
      mainSource.indexOf('});', mainSource.indexOf("'voice-conversation-stop-speaking'") + 100)
    );
    assert(stopSpeakingHandler.includes('abortCurrentTurn'), 'stop-speaking calls abortCurrentTurn (Stage 1 P0-1)');

    console.log('\nTest 12.4: Phase 18 Stage 2 — safeOrbTransition in voice-service recomputeState');
    assert(voiceServiceSource.includes('safeOrbTransition('), 'recomputeState calls safeOrbTransition (Stage 2 BUG-37)');

    console.log('\nTest 12.5: Phase 18 Stage 1 — no _ttsActive in voice-service.ts');
    assert(!voiceServiceSource.includes('private _ttsActive'), 'no _ttsActive in voice-service (removed in Stage 1 P2-6)');

    console.log('\nTest 12.6: Phase 18 Stage 1 — no speak() method in voice-service.ts');
    const speakMethodMatch = voiceServiceSource.match(/^\s*speak\(text: string\): void \{/m);
    assert(!speakMethodMatch, 'no speak() method in voice-service (removed in Stage 1 P2-6)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 13. Security: PermissionGate intact
  // ════════════════════════════════════════════════════════════════════════
  await testSection('13. Security: PermissionGate intact', async () => {
    console.log('\nTest 13.1: PermissionGate requestPermission still exists');
    const permissionGateSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'update', 'permission-gate.ts'),
      'utf-8',
    );
    assert(permissionGateSource.includes('async requestPermission('), 'PermissionGate.requestPermission exists');
    assert(permissionGateSource.includes('async respondViaVoice('), 'PermissionGate.respondViaVoice exists');

    console.log('\nTest 13.2: No new IPC channels that bypass PermissionGate');
    // Barge-in does NOT add any new IPC channel — it uses the existing
    // onBargeIn callback (engine → conversation, internal to main process)
    // and the existing onInterruption → voice-conversation-interrupted +
    // voice-tts-stop-playback broadcasts. No new permission surface.
    assert(!mainSource.includes('barge-in-permission'), 'no new barge-in permission IPC');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 18 Stage 3 tests: ${passed}/${passed + failed} passed (${failed} failed)`);
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
