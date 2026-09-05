/**
 * NEX AI — Phase 16: BUG-26 Fix Tests
 *
 * BUG-26: Stop doesn't actually stop TTS — stale audio plays after Stop.
 *
 * Two failure modes covered:
 *
 *   A) Stop during Piper synthesis:
 *      - stopSpeaking() bumps the requestId → engine's stale-guard
 *        discards the late synthesis result.
 *      - onTTSAudioReady is NOT fired → no voice-tts-audio IPC →
 *        renderer never plays the audio.
 *
 *   B) Stop during audio playback (renderer):
 *      - main broadcasts voice-tts-stop-playback to renderer.
 *      - App.tsx pauses the currently-playing <audio> element.
 *      - No stale audio continues through the speakers.
 *
 * Race protection (TTS #1 → Stop → TTS #1 late → TTS #2):
 *   - The renderer's App.tsx tracks currentAudioRequestIdRef.
 *   - When the late #1 audio arrives (with a smaller requestId than
 *     the current #2), App.tsx discards it entirely — never plays.
 *   - Only #2 plays.
 *
 * Run with: npx tsx tests/tools/test-phase-16-bug26.ts
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
  console.log('Phase 16: BUG-26 Fix Tests (Stop actually stops TTS)\n');

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
  const preloadSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'preload.ts'),
    'utf-8',
  );
  const appSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'App.tsx'),
    'utf-8',
  );

  // ════════════════════════════════════════════════════════════════════════
  // 1. Source-level: voice-tts-stop-playback IPC exists (main → renderer)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('1. voice-tts-stop-playback IPC exists', async () => {
    console.log('\nTest 1.1: main.ts broadcasts voice-tts-stop-playback in stop-speaking handler');
    // Find the stop-speaking handler
    const stopIdx = mainSource.indexOf("'voice-conversation-stop-speaking'");
    assert(stopIdx > 0, 'voice-conversation-stop-speaking handler exists');
    const stopSection = mainSource.substring(stopIdx, stopIdx + 1200);
    assert(stopSection.includes("webContents.send('voice-tts-stop-playback'"), 'broadcasts voice-tts-stop-playback');

    console.log('\nTest 1.2: preload exposes onVoiceTtsStopPlayback listener');
    assert(preloadSource.includes('onVoiceTtsStopPlayback'), 'preload: onVoiceTtsStopPlayback exists');
    assert(preloadSource.includes("ipcRenderer.on('voice-tts-stop-playback'"), 'preload: listens on voice-tts-stop-playback channel');

    console.log('\nTest 1.3: electron.d.ts has onVoiceTtsStopPlayback type');
    const dtsSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'types', 'electron.d.ts'),
      'utf-8',
    );
    assert(dtsSource.includes('onVoiceTtsStopPlayback'), 'electron.d.ts: onVoiceTtsStopPlayback typed');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. Source-level: BUG-26 A — engine.speak stale guard (discard late synthesis)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('2. BUG-26 A: engine stale guard discards late synthesis', async () => {
    console.log('\nTest 2.1: stopSpeaking bumps currentTtsRequestId');
    const stopStart = engineSource.indexOf('stopSpeaking(): void {');
    const stopEnd = engineSource.indexOf('setThinking(', stopStart);
    const stopSection = engineSource.substring(stopStart, stopEnd);
    assert(stopSection.includes('this._currentTtsRequestId++'), 'stopSpeaking bumps _currentTtsRequestId');

    console.log('\nTest 2.2: speak() has stale guard AFTER synthesize');
    const speakStart = engineSource.indexOf('async speak(text: string, opts?: TTSOptions): Promise<boolean>');
    const speakEnd = engineSource.indexOf('stopSpeaking(): void {', speakStart);
    const speakSection = engineSource.substring(speakStart, speakEnd);
    assert(speakSection.includes('!this.ttsActive || this._currentTtsRequestId !== requestId'), 'stale guard condition exists');
    assert(speakSection.includes('discarding'), 'logs "discarding" on stale');
    assert(speakSection.includes('return false'), 'returns false on stale');

    console.log('\nTest 2.3: speak() does NOT fire onTTSAudioReady for stale result');
    // The stale guard should be BEFORE the onTTSAudioReady fire
    const guardIdx = speakSection.indexOf('!this.ttsActive || this._currentTtsRequestId !== requestId');
    const fireIdx = speakSection.indexOf('onTTSAudioReady?.(');
    assert(guardIdx > 0 && fireIdx > 0, 'both guard and fire are present');
    assert(guardIdx < fireIdx, 'guard runs BEFORE onTTSAudioReady fire');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. Source-level: BUG-26 B — App.tsx pauses audio on stop signal
  // ════════════════════════════════════════════════════════════════════════
  await testSection('3. BUG-26 B: App.tsx pauses audio on stop signal', async () => {
    console.log('\nTest 3.1: App.tsx has currentAudioRef (for pause)');
    assert(appSource.includes('const currentAudioRef = useRef'), 'currentAudioRef declared');

    console.log('\nTest 3.2: App.tsx subscribes to onVoiceTtsStopPlayback');
    assert(appSource.includes('onVoiceTtsStopPlayback'), 'App.tsx: onVoiceTtsStopPlayback subscribed');
    const subIdx = appSource.indexOf('onVoiceTtsStopPlayback?.(');
    const subSection = appSource.substring(subIdx, subIdx + 500);
    assert(subSection.includes('currentAudioRef.current.pause()'), 'subscription pauses currentAudioRef');
    assert(subSection.includes('currentAudioRef.current = null'), 'subscription clears ref after pause');

    console.log('\nTest 3.3: App.tsx sets currentAudioRef when new audio arrives');
    assert(appSource.includes('currentAudioRef.current = audio'), 'new audio stored in currentAudioRef');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4. Source-level: voice-tts-audio IPC carries requestId
  // ════════════════════════════════════════════════════════════════════════
  await testSection('4. voice-tts-audio IPC carries requestId', async () => {
    console.log('\nTest 4.1: main.ts sends requestId in voice-tts-audio payload');
    const onReadyIdx = mainSource.indexOf('onTTSAudioReady: (audioFilePath: string, text: string, requestId: number)');
    assert(onReadyIdx > 0, 'main.ts onTTSAudioReady callback has requestId param');
    const onReadySection = mainSource.substring(onReadyIdx, onReadyIdx + 1000);
    assert(onReadySection.includes("send('voice-tts-audio'"), 'sends voice-tts-audio IPC');
    assert(onReadySection.includes('requestId'), 'payload includes requestId');

    console.log('\nTest 4.2: preload onVoiceTTSAudio callback receives requestId');
    assert(preloadSource.includes('onVoiceTTSAudio'), 'preload onVoiceTTSAudio exists');
    const preloadIdx = preloadSource.indexOf('onVoiceTTSAudio:');
    const preloadSection = preloadSource.substring(preloadIdx, preloadIdx + 400);
    assert(preloadSection.includes('requestId: number'), 'callback signature has requestId');
    assert(preloadSection.includes('ev?.requestId'), 'extracts requestId from IPC payload');

    console.log('\nTest 4.3: electron.d.ts onVoiceTTSAudio callback has requestId param');
    const dtsSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'types', 'electron.d.ts'),
      'utf-8',
    );
    assert(dtsSource.includes('onVoiceTTSAudio: (callback: (audioFilePath: string, text: string, requestId: number) => void)'), 'electron.d.ts: onVoiceTTSAudio typed with requestId');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5. Source-level: App.tsx race protection (requestId comparison)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('5. App.tsx race protection (requestId comparison)', async () => {
    console.log('\nTest 5.1: App.tsx has currentAudioRequestIdRef');
    assert(appSource.includes('const currentAudioRequestIdRef = useRef'), 'currentAudioRequestIdRef declared');

    console.log('\nTest 5.2: App.tsx compares requestId to currentAudioRequestIdRef');
    const onTTSAudioIdx = appSource.indexOf('onVoiceTTSAudio?.((');
    const onTTSAudioSection = appSource.substring(onTTSAudioIdx, onTTSAudioIdx + 1500);
    assert(onTTSAudioSection.includes('requestId < currentAudioRequestIdRef.current'), 'compares requestId to current');
    assert(onTTSAudioSection.includes('stale'), 'logs "stale" for old requestId');
    assert(onTTSAudioSection.includes('not playing'), 'does not play stale audio');

    console.log('\nTest 5.3: App.tsx pauses old audio before starting new (overlap protection)');
    assert(onTTSAudioSection.includes('currentAudioRef.current.pause()'), 'pauses old audio before new');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 6. Source-level: abortCurrentTurn bumps requestId + releases wait
  // ════════════════════════════════════════════════════════════════════════
  await testSection('6. abortCurrentTurn + handleInterruption invalidate TTS', async () => {
    console.log('\nTest 6.1: abortCurrentTurn bumps currentTtsRequestId');
    const abortStart = conversationSource.indexOf('abortCurrentTurn(): void {');
    const abortEnd = conversationSource.indexOf('// ── Permission voice confirmation', abortStart);
    const abortSection = conversationSource.substring(abortStart, abortEnd);
    assert(abortSection.includes('this.currentTtsRequestId++'), 'abort bumps currentTtsRequestId');
    assert(abortSection.includes('this.releaseTtsPlaybackWait()'), 'abort releases playback wait');

    console.log('\nTest 6.2: handleInterruption also bumps + releases');
    const interruptStart = conversationSource.indexOf('private handleInterruption(text: string): void {');
    const interruptEnd = conversationSource.indexOf('private handleVoiceCommand', interruptStart);
    const interruptSection = conversationSource.substring(interruptStart, interruptEnd);
    assert(interruptSection.includes('this.currentTtsRequestId++'), 'handleInterruption bumps currentTtsRequestId');
    assert(interruptSection.includes('this.releaseTtsPlaybackWait()'), 'handleInterruption releases playback wait');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 7. Runtime: BUG-26 A — Stop during synthesis discards result
  // ════════════════════════════════════════════════════════════════════════
  await testSection('7. Runtime: Stop during synthesis → discard (BUG-26 A)', async () => {
    console.log('\nTest 7.1: Stop during synthesis → onTTSAudioReady NOT fired');

    // Simulate the engine's speak() + stopSpeaking() + stale guard
    let ttsActive = false;
    let currentTtsRequestId = 0;
    let onTTSAudioReadyFired = false;
    let onTTSAudioReady: ((p: string, t: string, r: number) => void) | null = null;
    let synthResolve: ((result: { success: boolean; audioFilePath?: string; error?: string }) => void) | null = null;
    let synthPromise: Promise<{ success: boolean; audioFilePath?: string; error?: string }> | null = null;

    // Mock ttsProvider.synthesize — returns a promise that we control
    function mockSynthesize(): Promise<{ success: boolean; audioFilePath?: string; error?: string }> {
      return new Promise((resolve) => { synthResolve = resolve; synthPromise = null; });
    }

    // Mirror engine.speak() with the stale guard
    async function engineSpeak(text: string, opts?: any): Promise<boolean> {
      ttsActive = true;
      const requestId = opts?.requestId ?? ++currentTtsRequestId;
      currentTtsRequestId = requestId;
      // Simulate stopListening if active (not tracked here)
      // Synthesize (mocked)
      const result = await mockSynthesize();
      // BUG-26 A stale guard
      if (!ttsActive || currentTtsRequestId !== requestId) {
        ttsActive = false;
        return false;
      }
      if (result.success && result.audioFilePath) {
        onTTSAudioReady?.(result.audioFilePath, text, requestId);
        onTTSAudioReadyFired = true;
        ttsActive = false;
        return true;
      }
      ttsActive = false;
      return false;
    }

    function stopSpeaking() {
      ttsActive = false;
      currentTtsRequestId++;
    }

    onTTSAudioReady = () => { /* no-op */ };

    // Scenario: speak starts, then Stop fires BEFORE synthesis completes.
    onTTSAudioReadyFired = false;
    const speakPromise = engineSpeak('Hello', { requestId: 1 });

    // Stop fires while synthesis is still in progress
    stopSpeaking(); // bumps requestId to 2, sets ttsActive = false

    // Now synthesis completes late
    synthResolve!({ success: true, audioFilePath: '/tmp/stale.wav' });
    const audioReady = await speakPromise;

    assert(audioReady === false, 'engine.speak returns false (stale)');
    assert(onTTSAudioReadyFired === false, 'onTTSAudioReady NOT fired for stale synthesis');

    console.log('\nTest 7.2: Late synthesis after Stop is fully discarded');
    // No side effects — the renderer would never receive voice-tts-audio IPC
    // because onTTSAudioReady was never called.
  });

  // ════════════════════════════════════════════════════════════════════════
  // 8. Runtime: BUG-26 B — Stop during playback pauses audio
  // ════════════════════════════════════════════════════════════════════════
  await testSection('8. Runtime: Stop during playback → pause audio (BUG-26 B)', async () => {
    console.log('\nTest 8.1: Stop signal pauses currently-playing audio');

    // Simulate App.tsx's audio playback + stop signal subscription
    let currentAudioPaused = false;
    let currentAudioRef: { pause: () => void } | null = null;
    let currentAudioRequestIdRef: number | null = null;
    let onTtsStopPlaybackCb: (() => void) | null = null;

    function onVoiceTTSAudio(audioFilePath: string, _text: string, requestId: number) {
      // Race protection: skip stale
      if (currentAudioRequestIdRef !== null && requestId < currentAudioRequestIdRef) {
        return; // stale — not played
      }
      // Pause old audio
      if (currentAudioRef) {
        currentAudioRef.pause();
        currentAudioRef = null;
      }
      // Create new audio (simulated)
      currentAudioRef = {
        pause: () => { currentAudioPaused = true; },
      };
      currentAudioRequestIdRef = requestId;
    }

    function onVoiceTtsStopPlayback() {
      if (currentAudioRef) {
        currentAudioRef.pause();
        currentAudioRef = null;
        currentAudioRequestIdRef = null;
      }
    }

    onTtsStopPlaybackCb = onVoiceTtsStopPlayback;

    // Scenario: audio #1 arrives, plays. Then Stop fires.
    currentAudioPaused = false;
    onVoiceTTSAudio('/tmp/audio1.wav', 'Response 1', 1);
    assert(currentAudioRef !== null, 'audio #1 is set as current');
    assert(currentAudioRequestIdRef === 1, 'currentAudioRequestIdRef = 1');

    // Stop fires
    onTtsStopPlaybackCb!();
    assert(currentAudioPaused === true, 'audio #1 was paused');
    assert(currentAudioRef === null, 'currentAudioRef cleared after Stop');
    assert(currentAudioRequestIdRef === null, 'currentAudioRequestIdRef cleared after Stop');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 9. Runtime: Race protection — TTS #1 → Stop → TTS #1 late → TTS #2
  // ════════════════════════════════════════════════════════════════════════
  await testSection('9. Runtime: Race protection (TTS #1 late → discarded, only #2 plays)', async () => {
    console.log('\nTest 9.1: Late TTS #1 is discarded; only TTS #2 plays');

    // Simulate App.tsx's audio playback with requestId tracking
    let currentAudioRef: { pause: () => void; path: string } | null = null;
    let currentAudioRequestIdRef: number | null = null;
    const playedPaths: string[] = [];
    const pausedPaths: string[] = [];

    function onVoiceTTSAudio(audioFilePath: string, _text: string, requestId: number) {
      // Race protection: skip stale (smaller requestId)
      if (currentAudioRequestIdRef !== null && requestId < currentAudioRequestIdRef) {
        return; // stale — not played
      }
      // Pause old audio
      if (currentAudioRef) {
        currentAudioRef.pause();
        pausedPaths.push(currentAudioRef.path);
        currentAudioRef = null;
      }
      // Create new audio (simulated)
      currentAudioRef = {
        path: audioFilePath,
        pause: () => { pausedPaths.push(audioFilePath); },
      };
      currentAudioRequestIdRef = requestId;
      playedPaths.push(audioFilePath);
    }

    // Scenario:
    // T1: TTS #1 arrives (requestId=1), plays
    // T2: Stop → main bumps its requestId, broadcasts voice-tts-stop-playback
    //     But for this race scenario, we also start TTS #2 immediately
    // T3: TTS #2 arrives (requestId=3, because Stop bumped to 2), plays
    // T4: TTS #1's LATE synthesis completes, voice-tts-audio IPC arrives
    //     with requestId=1 — but currentAudioRequestIdRef=3, so 1 < 3 → discard

    onVoiceTTSAudio('/tmp/audio1.wav', 'Response 1', 1);
    assert(playedPaths.length === 1, 'TTS #1 played initially');
    assert(playedPaths[0] === '/tmp/audio1.wav', 'played path is audio1');

    // TTS #2 arrives (after Stop bumped requestId to 2, then #2's speak
    // used requestId=3). #1 is paused, #2 plays.
    onVoiceTTSAudio('/tmp/audio2.wav', 'Response 2', 3);
    assert(playedPaths.length === 2, 'TTS #2 played');
    assert(pausedPaths.includes('/tmp/audio1.wav'), 'TTS #1 was paused when #2 arrived');
    assert(currentAudioRequestIdRef === 3, 'currentAudioRequestIdRef = 3');

    // Late TTS #1 arrives with requestId=1 — STALE, discard
    onVoiceTTSAudio('/tmp/audio1.wav', 'Response 1 (late)', 1);
    assert(playedPaths.length === 2, 'TTS #1 late NOT played (discarded)');
    assert(currentAudioRequestIdRef === 3, 'currentAudioRequestIdRef still 3 (not regressed)');
    assert(currentAudioRef?.path === '/tmp/audio2.wav', 'current audio is still #2');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 10. Runtime: overlap protection — two concurrent TTS without Stop
  // ════════════════════════════════════════════════════════════════════════
  await testSection('10. Runtime: overlap protection (no two audios at once)', async () => {
    console.log('\nTest 10.1: Second TTS pauses the first (no overlap)');

    let currentAudioRef: { pause: () => void; path: string } | null = null;
    let currentAudioRequestIdRef: number | null = null;
    const playedPaths: string[] = [];
    const pausedPaths: string[] = [];

    function onVoiceTTSAudio(audioFilePath: string, _text: string, requestId: number) {
      if (currentAudioRequestIdRef !== null && requestId < currentAudioRequestIdRef) {
        return; // stale
      }
      if (currentAudioRef) {
        currentAudioRef.pause(); // pause() itself pushes to pausedPaths
        currentAudioRef = null;
      }
      currentAudioRef = {
        path: audioFilePath,
        pause: () => { pausedPaths.push(audioFilePath); },
      };
      currentAudioRequestIdRef = requestId;
      playedPaths.push(audioFilePath);
    }

    // Two consecutive TTS without Stop in between
    onVoiceTTSAudio('/tmp/audio1.wav', 'First', 1);
    onVoiceTTSAudio('/tmp/audio2.wav', 'Second', 2);

    assert(playedPaths.length === 2, 'both audios "played" (sequentially)');
    assert(pausedPaths.length === 1, 'first audio was paused when second arrived');
    assert(pausedPaths[0] === '/tmp/audio1.wav', 'paused path is audio1');
    assert(currentAudioRef?.path === '/tmp/audio2.wav', 'current audio is #2');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 11. Source-level: NexChatPanel handleStop intact (Phase 14 + 16)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('11. NexChatPanel handleStop intact', async () => {
    console.log('\nTest 11.1: NexChatPanel handleStop still calls voiceConversationStopSpeaking');
    const chatSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'chat', 'NexChatPanel.tsx'),
      'utf-8',
    );
    const stopStart = chatSource.indexOf('const handleStop = useCallback');
    const stopEnd = chatSource.indexOf('}, []);', stopStart) + 6;
    const stopSection = chatSource.substring(stopStart, stopEnd);
    assert(stopSection.includes('ttsCancelledRef.current = true'), 'sets ttsCancelledRef (Phase 14)');
    assert(stopSection.includes('wasVoiceInputRef.current = false'), 'clears wasVoiceInputRef (Phase 14)');
    assert(stopSection.includes('aiChatStreamCancel'), 'cancels chat stream');
    assert(stopSection.includes('agentCancelTask'), 'cancels agent task');
    assert(stopSection.includes('voiceConversationStopSpeaking'), 'calls voiceConversationStopSpeaking (triggers BUG-26 B broadcast)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 12. Regression: Phase 14 + 15 voice response intact
  // ════════════════════════════════════════════════════════════════════════
  await testSection('12. Regression: Phase 14 + 15 intact', async () => {
    console.log('\nTest 12.1: Phase 14 speakResponseIfVoice intact');
    const chatSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'chat', 'NexChatPanel.tsx'),
      'utf-8',
    );
    assert(chatSource.includes('speakResponseIfVoice'), 'speakResponseIfVoice intact');
    assert(chatSource.includes('wasVoiceInputRef'), 'wasVoiceInputRef intact');
    assert(chatSource.includes('ttsCancelledRef'), 'ttsCancelledRef intact');

    console.log('\nTest 12.2: Phase 15 voice-service.ts has no browser TTS');
    const voiceServiceSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'services', 'voice-service.ts'),
      'utf-8',
    );
    const speakSection = voiceServiceSource.substring(
      voiceServiceSource.indexOf('speak(text: string): void {'),
      voiceServiceSource.indexOf('stopSpeaking(): void {'),
    );
    assert(!speakSection.includes('window.speechSynthesis.speak'), 'no browser TTS in voice-service.speak()');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 16 BUG-26 tests: ${passed}/${passed + failed} passed (${failed} failed)`);
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
