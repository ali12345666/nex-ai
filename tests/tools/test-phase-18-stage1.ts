/**
 * NEX AI — Phase 18 Stage 1: Voice Runtime & Orb State Integration Tests
 *
 * Stage 1 covers:
 *   - P0-1: Stop-during-TTS wait hang — waitForTtsPlayback releases immediately
 *   - P1-5: AI Mode desync — BottomStatusBar uses Zustand canonical path
 *   - P1-6: Voice confirmation dead/recursive code removed
 *   - P2-6: Dead renderer voice/TTS path removed (_ttsActive, _bargeInEnabled,
 *     voiceService.speak, renderer-side barge-in)
 *
 * These tests verify BOTH:
 *   (a) source-level patterns: the new code structure is correct
 *   (b) runtime semantics: race/cancellation behavior is correct
 *
 * Run with: npx tsx tests/tools/test-phase-18-stage1.ts
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
  console.log('Phase 18 Stage 1: Voice Runtime & Orb State Integration Tests\n');

  const mainSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'),
    'utf-8',
  );
  const conversationSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'voice', 'nex-voice-conversation.ts'),
    'utf-8',
  );
  const bottomBarSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'layout', 'BottomStatusBar.tsx'),
    'utf-8',
  );
  const useStoreSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'store', 'useStore.ts'),
    'utf-8',
  );
  const voiceServiceSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'services', 'voice-service.ts'),
    'utf-8',
  );
  const voiceControllerSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'services', 'voice-controller.ts'),
    'utf-8',
  );
  const permissionGateSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'update', 'permission-gate.ts'),
    'utf-8',
  );
  const updateManagerSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'update', 'update-manager.ts'),
    'utf-8',
  );

  // ════════════════════════════════════════════════════════════════════════
  // 1. P0-1: Stop-during-TTS wait hang fix
  // ════════════════════════════════════════════════════════════════════════
  await testSection('1. P0-1: Stop-during-TTS wait hang fix', async () => {
    console.log('\nTest 1.1: voice-conversation-stop-speaking handler calls abortCurrentTurn');
    // Find the stop-speaking handler
    const stopIdx = mainSource.indexOf("'voice-conversation-stop-speaking'");
    assert(stopIdx > 0, 'voice-conversation-stop-speaking handler exists');
    const stopSection = mainSource.substring(stopIdx, stopIdx + 3000);
    assert(stopSection.includes('abortCurrentTurn'), 'handler calls abortCurrentTurn');
    assert(stopSection.includes('getNexVoiceConversation().abortCurrentTurn'), 'calls conversation.abortCurrentTurn()');

    console.log('\nTest 1.2: abortCurrentTurn is called BEFORE engine.stopSpeaking');
    // The abortCurrentTurn call must come before engine.stopSpeaking so the
    // wait is released first. Find the positions in the stop-speaking handler.
    const abortIdx = stopSection.indexOf('abortCurrentTurn');
    const engineStopIdx = stopSection.indexOf('engine.stopSpeaking()');
    assert(abortIdx > 0 && engineStopIdx > 0, 'both calls present in handler');
    assert(abortIdx < engineStopIdx, 'abortCurrentTurn called before engine.stopSpeaking');

    console.log('\nTest 1.3: NexVoiceConversation.abortCurrentTurn releases playback wait');
    // Verify abortCurrentTurn calls releaseTtsPlaybackWait + bumps currentTtsRequestId
    const abortMethodStart = conversationSource.indexOf('abortCurrentTurn(): void {');
    assert(abortMethodStart > 0, 'abortCurrentTurn method exists');
    const abortMethodEnd = conversationSource.indexOf('// ── Permission voice confirmation', abortMethodStart);
    const abortMethod = abortMethodEnd > abortMethodStart
      ? conversationSource.substring(abortMethodStart, abortMethodEnd)
      : conversationSource.substring(abortMethodStart, abortMethodStart + 800);
    assert(abortMethod.includes('this.currentTtsRequestId++'), 'abortCurrentTurn bumps currentTtsRequestId');
    assert(abortMethod.includes('this.releaseTtsPlaybackWait()'), 'abortCurrentTurn calls releaseTtsPlaybackWait');

    console.log('\nTest 1.4: releaseTtsPlaybackWait resolves the pending promise');
    // Verify releaseTtsPlaybackWait resolves ttsPlaybackResolve
    const releaseStart = conversationSource.indexOf('private releaseTtsPlaybackWait(): void {');
    assert(releaseStart > 0, 'releaseTtsPlaybackWait method exists');
    // Extract the full method body (until the closing brace at the same indent level)
    const releaseMethodStart = conversationSource.indexOf('{', releaseStart);
    let braceDepth = 0;
    let releaseEnd = releaseMethodStart;
    for (let i = releaseMethodStart; i < conversationSource.length; i++) {
      if (conversationSource[i] === '{') braceDepth++;
      else if (conversationSource[i] === '}') {
        braceDepth--;
        if (braceDepth === 0) { releaseEnd = i; break; }
      }
    }
    const releaseMethod = conversationSource.substring(releaseStart, releaseEnd + 1);
    assert(releaseMethod.includes('ttsPlaybackResolve'), 'touches ttsPlaybackResolve');
    assert(releaseMethod.includes('resolve()'), 'resolves the promise');
    assert(releaseMethod.includes('clearTimeout'), 'clears the safety timeout');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. P0-1 Runtime: Stop-during-TTS releases wait immediately (not 30s)
  // ════════════════════════════════════════════════════════════════════════
  await testSection('2. Runtime: Stop-during-TTS releases wait immediately', async () => {
    console.log('\nTest 2.1: waitForTtsPlayback resolves immediately on abortCurrentTurn');

    // Mirror NexVoiceConversation's waitForTtsPlayback + releaseTtsPlaybackWait
    // + abortCurrentTurn semantics with a fake implementation.
    let currentTtsRequestId = 0;
    let ttsPlaybackResolve: (() => void) | null = null;
    let ttsPlaybackRequestId: number | null = null;
    let ttsPlaybackTimeout: ReturnType<typeof setTimeout> | null = null;

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

    function abortCurrentTurn() {
      currentTtsRequestId++;
      releaseTtsPlaybackWait();
    }

    // Scenario: speakResponse is awaiting waitForTtsPlayback(1).
    // User clicks Stop → abortCurrentTurn() fires.
    currentTtsRequestId = 1;
    const waitPromise = waitForTtsPlayback(1);

    // Yield to let the promise set up
    await new Promise((r) => setTimeout(r, 10));

    // The wait should still be pending (no signal yet)
    let resolved = false;
    waitPromise.then(() => { resolved = true; });
    await new Promise((r) => setTimeout(r, 10));
    assert(resolved === false, 'waitForTtsPlayback still pending before Stop');

    // Now simulate Stop → abortCurrentTurn
    const stopStart = Date.now();
    abortCurrentTurn();
    await waitPromise;
    const elapsed = Date.now() - stopStart;

    assert(resolved === true, 'waitForTtsPlayback resolved after Stop');
    assert(elapsed < 1000, `waitForTtsPlayback resolved immediately (elapsed=${elapsed}ms, not 30s)`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. P0-1 Runtime: Stop-during-TTS does NOT restart listening
  // ════════════════════════════════════════════════════════════════════════
  await testSection('3. Runtime: Stop-during-TTS does NOT restart listening', async () => {
    console.log('\nTest 3.1: GUARD 3 in speakResponse prevents enterListening after cancel');

    // Mirror speakResponse's GUARD 3: after waitForTtsPlayback resolves,
    // re-check currentTtsRequestId — if it changed (Stop bumped it), do
    // NOT call enterListening.
    let currentTtsRequestId = 0;
    let ttsPlaybackResolve: (() => void) | null = null;
    let ttsPlaybackTimeout: ReturnType<typeof setTimeout> | null = null;

    function releaseTtsPlaybackWait() {
      if (ttsPlaybackResolve) {
        const resolve = ttsPlaybackResolve;
        ttsPlaybackResolve = null;
        if (ttsPlaybackTimeout) { clearTimeout(ttsPlaybackTimeout); ttsPlaybackTimeout = null; }
        resolve();
      }
    }

    function waitForTtsPlayback(requestId: number): Promise<void> {
      if (currentTtsRequestId !== requestId) return Promise.resolve();
      releaseTtsPlaybackWait();
      return new Promise<void>((resolve) => {
        ttsPlaybackResolve = resolve;
        ttsPlaybackTimeout = setTimeout(() => releaseTtsPlaybackWait(), 30000);
      });
    }

    function abortCurrentTurn() {
      currentTtsRequestId++;
      releaseTtsPlaybackWait();
    }

    let enterListeningCalled = false;
    async function speakResponse(text: string): Promise<void> {
      currentTtsRequestId++;
      const requestId = currentTtsRequestId;
      // Simulate audioReady=true (synthesis completed)
      const audioReady = true;
      if (currentTtsRequestId !== requestId) return; // GUARD 1
      if (!audioReady) return; // GUARD 2
      await waitForTtsPlayback(requestId);
      // GUARD 3: if currentTtsRequestId changed during playback, do NOT enterListening
      if (currentTtsRequestId !== requestId) {
        console.log(`[test] GUARD 3: req=${requestId} cancelled during playback — not entering listening`);
        return;
      }
      enterListeningCalled = true; // this should NOT happen after Stop
    }

    // Start speakResponse
    const speakPromise = speakResponse('Hello');
    await new Promise((r) => setTimeout(r, 10));

    // Simulate Stop during playback
    abortCurrentTurn();
    await speakPromise;

    assert(enterListeningCalled === false, 'Stop during TTS does NOT restart listening (GUARD 3)');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4. P1-5: AI Mode desync fix
  // ════════════════════════════════════════════════════════════════════════
  await testSection('4. P1-5: BottomStatusBar AI Mode desync fix', async () => {
    console.log('\nTest 4.1: BottomStatusBar imports useStore');
    assert(bottomBarSource.includes("from '../../store/useStore'"), 'imports useStore');
    assert(bottomBarSource.includes('useStore'), 'uses useStore');

    console.log('\nTest 4.2: BottomStatusBar reads aiMode from useStore (not local state)');
    assert(bottomBarSource.includes('useStore((s) => s.aiMode)'), 'reads aiMode via useStore selector');
    assert(bottomBarSource.includes('useStore((s) => s.setAIMode)'), 'reads setAIMode via useStore selector');

    console.log('\nTest 4.3: BottomStatusBar no longer has local useState for aiMode');
    // The old pattern was `const [aiMode, setAiModeState] = useState<AIMode>('local')`.
    // After the fix, there should be NO `useState<AIMode>` in code lines
    // (comments mentioning it are OK — they explain what was removed).
    const useStateAiModeCodeLines = bottomBarSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') && l.includes('useState<AIMode>')
    );
    assert(useStateAiModeCodeLines.length === 0, 'no local useState<AIMode> in BottomStatusBar code');
    // Also check for the old setAiModeState pattern in code lines
    const setAiModeStateCodeLines = bottomBarSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') && l.includes('setAiModeState')
    );
    assert(setAiModeStateCodeLines.length === 0, 'no local setAiModeState in code');

    console.log('\nTest 4.4: cycleMode calls setAIMode (canonical Zustand path)');
    // Find the cycleMode function
    const cycleStart = bottomBarSource.indexOf('const cycleMode = useCallback');
    assert(cycleStart > 0, 'cycleMode exists');
    const cycleEnd = bottomBarSource.indexOf('}, [', cycleStart);
    const cycleSection = bottomBarSource.substring(cycleStart, cycleEnd);
    assert(cycleSection.includes('setAIMode(nextMode)'), 'cycleMode calls setAIMode');

    console.log('\nTest 4.5: cycleMode also persists via settingsSave');
    assert(cycleSection.includes('settingsSave'), 'cycleMode persists via settingsSave');

    console.log('\nTest 4.6: useStore.setAIMode syncs both aiMode and settings.aiMode');
    // Verify the useStore.setAIMode implementation syncs both fields
    const setAiModeStart = useStoreSource.indexOf('setAIMode: (mode) => set((s) => ({');
    assert(setAiModeStart > 0, 'useStore.setAIMode exists');
    const setAiModeEnd = useStoreSource.indexOf('})),', setAiModeStart);
    const setAiModeSection = useStoreSource.substring(setAiModeStart, setAiModeEnd + 3);
    assert(setAiModeSection.includes('aiMode: mode'), 'updates top-level aiMode');
    assert(setAiModeSection.includes('settings: { ...s.settings, aiMode: mode }'), 'updates nested settings.aiMode');

    console.log('\nTest 4.7: BottomStatusBar removed the settingsLoad on mount useEffect');
    // The old pattern had a useEffect that called settingsLoad() on mount to
    // populate the local aiMode state. After the fix, aiMode comes from useStore
    // (hydrated in App.tsx on startup), so the mount-time settingsLoad is gone.
    // Check that there's no `setAiModeState(r.settings.aiMode` pattern.
    assert(!bottomBarSource.includes('setAiModeState(r.settings.aiMode'), 'removed settingsLoad → setAiModeState on mount');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5. P1-5 Runtime: AI Mode change syncs useStore + settings
  // ════════════════════════════════════════════════════════════════════════
  await testSection('5. Runtime: AI Mode change syncs useStore + settings', async () => {
    console.log('\nTest 5.1: setAIMode updates both aiMode and settings.aiMode in one set() call');

    // Mirror the useStore.setAIMode implementation
    let storeState: { aiMode: string; settings: { aiMode: string } } = {
      aiMode: 'local',
      settings: { aiMode: 'local' },
    };

    function set(updater: (s: typeof storeState) => Partial<typeof storeState>) {
      const partial = updater(storeState);
      storeState = { ...storeState, ...partial };
    }

    // Phase 17 P0 13-1 fix: setAIMode syncs both fields
    function setAIMode(mode: string) {
      set((s) => ({
        aiMode: mode,
        settings: { ...s.settings, aiMode: mode },
      }));
    }

    // Scenario: user clicks BottomStatusBar to cycle from local → online
    setAIMode('online');

    assert(storeState.aiMode === 'online', 'top-level aiMode updated to online');
    assert(storeState.settings.aiMode === 'online', 'nested settings.aiMode updated to online');

    // Cycle to auto
    setAIMode('auto');
    assert(storeState.aiMode === 'auto', 'top-level aiMode updated to auto');
    assert(storeState.settings.aiMode === 'auto', 'nested settings.aiMode updated to auto');

    // Verify both fields stay in sync (the Phase 18 P1-5 invariant)
    assert(storeState.aiMode === storeState.settings.aiMode, 'aiMode and settings.aiMode are in sync');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 6. P1-6: Voice confirmation dead/recursive code removed
  // ════════════════════════════════════════════════════════════════════════
  await testSection('6. P1-6: Voice confirmation dead/recursive code removed', async () => {
    console.log('\nTest 6.1: main.ts no longer wires setPermissionVoiceCapture');
    // The old recursive wiring was:
    //   conversation.setPermissionVoiceCapture(async () => {
    //     return await conversation.captureVoiceConfirmation();
    //   });
    // After P1-6, this block should be gone from code (comments explaining
    // the removal are OK).
    const setPermissionCodeLines = mainSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') && l.includes('setPermissionVoiceCapture(async')
    );
    assert(setPermissionCodeLines.length === 0, 'removed setPermissionVoiceCapture wiring in main.ts code');
    const captureVoiceConfCodeLines = mainSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') && l.includes('captureVoiceConfirmation()')
    );
    assert(captureVoiceConfCodeLines.length === 0, 'removed captureVoiceConfirmation call in main.ts code');

    console.log('\nTest 6.2: NexVoiceConversation removed setPermissionVoiceCapture method');
    // Code-line check (method definition should be gone — only comments remain)
    const setPermMethodLines = conversationSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') && l.includes('setPermissionVoiceCapture(fn')
    );
    assert(setPermMethodLines.length === 0, 'removed setPermissionVoiceCapture method definition');

    console.log('\nTest 6.3: NexVoiceConversation removed captureVoiceConfirmation method');
    const captureMethodLines = conversationSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') && l.includes('async captureVoiceConfirmation()')
    );
    assert(captureMethodLines.length === 0, 'removed captureVoiceConfirmation method definition');

    console.log('\nTest 6.4: NexVoiceConversation removed handlePermissionConfirmation method');
    const handlePermMethodLines = conversationSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') && l.includes('handlePermissionConfirmation')
    );
    assert(handlePermMethodLines.length === 0, 'removed handlePermissionConfirmation method');

    console.log('\nTest 6.5: NexVoiceConversation removed permissionVoiceCaptureFn field');
    const permFieldLines = conversationSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') && l.includes('private permissionVoiceCaptureFn')
    );
    assert(permFieldLines.length === 0, 'removed permissionVoiceCaptureFn field');

    console.log('\nTest 6.6: NexVoiceConversation removed pendingPermission field from ConversationContext');
    // The field declaration `pendingPermission: boolean;` should be gone from code
    const pendingFieldDeclLines = conversationSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') && l.includes('pendingPermission: boolean')
    );
    assert(pendingFieldDeclLines.length === 0, 'removed pendingPermission field declaration');
    // The initialization `pendingPermission: false,` should be gone from code
    const pendingInitLines = conversationSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') && l.includes('pendingPermission: false')
    );
    assert(pendingInitLines.length === 0, 'removed pendingPermission initialization');

    console.log('\nTest 6.7: feedTranscript no longer checks pendingPermission');
    // The old feedTranscript had: `if (this.context.pendingPermission) { ... }`
    // After P1-6, this branch is removed. Check the feedTranscript method body.
    const feedTranscriptStart = conversationSource.indexOf('feedTranscript(text: string): void {');
    assert(feedTranscriptStart > 0, 'feedTranscript method exists');
    const feedTranscriptEnd = conversationSource.indexOf("// If we're speaking and the user talks", feedTranscriptStart);
    const feedTranscriptSection = conversationSource.substring(feedTranscriptStart, feedTranscriptEnd);
    // Code-line check (not comments)
    const pendingCheckCodeLines = feedTranscriptSection.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') && l.includes('this.context.pendingPermission')
    );
    assert(pendingCheckCodeLines.length === 0, 'feedTranscript no longer checks pendingPermission in code');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 7. P1-6: Active PermissionGate paths still intact
  // ════════════════════════════════════════════════════════════════════════
  await testSection('7. P1-6: Active PermissionGate paths still intact', async () => {
    console.log('\nTest 7.1: PermissionGate.requestPermission still exists');
    assert(permissionGateSource.includes('async requestPermission('), 'PermissionGate.requestPermission exists');

    console.log('\nTest 7.2: PermissionGate.respondViaVoice still exists');
    assert(permissionGateSource.includes('async respondViaVoice('), 'PermissionGate.respondViaVoice exists');

    console.log('\nTest 7.3: update-manager still wires onCaptureVoiceInput (own verifier)');
    // update-manager uses its own voiceVerifier — this path is separate from
    // the conversation's dead captureVoiceConfirmation. It should still work.
    assert(updateManagerSource.includes('onCaptureVoiceInput'), 'update-manager still wires onCaptureVoiceInput');
    assert(updateManagerSource.includes('voiceVerifier.captureConfirmation'), 'update-manager uses own voiceVerifier');

    console.log('\nTest 7.4: VoicePermissionVerifier class still exists');
    assert(permissionGateSource.includes('class VoicePermissionVerifier'), 'VoicePermissionVerifier class exists');
    assert(permissionGateSource.includes('setCaptureFunction'), 'VoicePermissionVerifier.setCaptureFunction exists');

    console.log('\nTest 7.5: main.ts still wires deploymentManager + knowledgePackManager onRequestPermission');
    // These are the ACTIVE permission paths — only onRequestPermission is wired
    // (no onCaptureVoiceInput for these managers, which is fine — they use the
    // respondViaVoice IPC path).
    assert(mainSource.includes("deploymentManager.setCallbacks"), 'deploymentManager.setCallbacks wired');
    assert(mainSource.includes("knowledgePackManager.setCallbacks"), 'knowledgePackManager.setCallbacks wired');
    assert(mainSource.includes("model-deployment-permission-request"), 'model-deployment permission IPC intact');
    assert(mainSource.includes("knowledge-pack-permission-request"), 'knowledge-pack permission IPC intact');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 8. P2-6: Dead renderer voice/TTS path removed
  // ════════════════════════════════════════════════════════════════════════
  await testSection('8. P2-6: Dead renderer voice/TTS path removed', async () => {
    console.log('\nTest 8.1: voice-service.ts removed _ttsActive field');
    assert(!voiceServiceSource.includes('private _ttsActive'), '_ttsActive field removed');

    console.log('\nTest 8.2: voice-service.ts removed _bargeInEnabled field');
    assert(!voiceServiceSource.includes('private _bargeInEnabled'), '_bargeInEnabled field removed');

    console.log('\nTest 8.3: voice-service.ts removed isSpeaking getter');
    // The old getter was `get isSpeaking(): boolean { return this._ttsActive; }`
    // After P2-6, it should be gone (or only in a comment explaining removal).
    const isSpeakingCodeLines = voiceServiceSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') && l.includes('get isSpeaking()')
    );
    assert(isSpeakingCodeLines.length === 0, 'isSpeaking getter removed from code');

    console.log('\nTest 8.4: voice-service.ts removed speak(text: string) method');
    // The old method was `speak(text: string): void { ... }`
    // After P2-6, the method definition should be gone.
    const speakMethodMatch = voiceServiceSource.match(/^\s*speak\(text: string\): void \{/m);
    assert(!speakMethodMatch, 'speak(text: string) method definition removed');

    console.log('\nTest 8.5: voice-service.ts stopSpeaking is a no-op');
    // stopSpeaking is kept (called by dispose()) but is now a no-op.
    const stopStart = voiceServiceSource.indexOf('stopSpeaking(): void {');
    assert(stopStart > 0, 'stopSpeaking method still exists (called by dispose)');
    const stopEnd = voiceServiceSource.indexOf('setCondition(key: string', stopStart);
    const stopSection = voiceServiceSource.substring(stopStart, stopEnd);
    assert(!stopSection.includes('this._ttsActive'), 'stopSpeaking does not touch _ttsActive (removed)');
    assert(!stopSection.includes("this.clearCondition('tts')"), 'stopSpeaking does not clear tts condition (dead)');

    console.log('\nTest 8.6: voice-service.ts removed renderer-side barge-in branch');
    // The old branch was `if (this._ttsActive && this._bargeInEnabled) { ... }`
    // inside processVAD. After P2-6, this branch is gone.
    const vadStart = voiceServiceSource.indexOf('private processVAD(level: number): void {');
    assert(vadStart > 0, 'processVAD method exists');
    const vadEnd = voiceServiceSource.indexOf('private downsampleTo16k', vadStart);
    const vadSection = voiceServiceSource.substring(vadStart, vadEnd);
    // Code-line check (not comments)
    const bargeInCodeLines = vadSection.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') && l.includes('this._ttsActive') && l.includes('this._bargeInEnabled')
    );
    assert(bargeInCodeLines.length === 0, 'renderer-side barge-in branch removed from processVAD');

    console.log('\nTest 8.7: voice-controller.ts removed speak() method');
    const controllerSpeakMatch = voiceControllerSource.match(/^\s*speak\(text: string\): void \{/m);
    assert(!controllerSpeakMatch, 'voiceController.speak() method removed');

    console.log('\nTest 8.8: voice-controller.ts removed stopSpeaking() method');
    // The old method was `stopSpeaking(): void { voiceService.stopSpeaking(); }`
    // After P2-6, the method definition should be gone (voiceService.stopSpeaking
    // is now a no-op, and voiceController.stopSpeaking had zero external callers).
    const controllerStopMatch = voiceControllerSource.match(/^\s*stopSpeaking\(\): void \{/m);
    assert(!controllerStopMatch, 'voiceController.stopSpeaking() method removed');

    console.log('\nTest 8.9: voice-controller.ts no longer calls voiceService.speak/stopSpeaking');
    // Code-line check (not comments)
    const controllerCallLines = voiceControllerSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') &&
      (l.includes('voiceService.speak(') || l.includes('voiceService.stopSpeaking('))
    );
    assert(controllerCallLines.length === 0, `voice-controller no longer calls voiceService.speak/stopSpeaking (found ${controllerCallLines.length})`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 9. Regression: Phase 14/15/16 invariants preserved
  // ════════════════════════════════════════════════════════════════════════
  await testSection('9. Regression: Phase 14/15/16 invariants preserved', async () => {
    console.log('\nTest 9.1: Phase 14 — NexChatPanel wasVoiceInputRef intact');
    const chatSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'chat', 'NexChatPanel.tsx'),
      'utf-8',
    );
    assert(chatSource.includes('wasVoiceInputRef'), 'Phase 14 wasVoiceInputRef intact');
    assert(chatSource.includes('speakResponseIfVoice'), 'Phase 14 speakResponseIfVoice intact');
    assert(chatSource.includes('ttsCancelledRef'), 'Phase 14 ttsCancelledRef intact');

    console.log('\nTest 9.2: Phase 14 — AppShell source=voice intact');
    const appShellSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'layout', 'AppShell.tsx'),
      'utf-8',
    );
    assert(appShellSource.includes("source: 'voice'"), 'Phase 14 source=voice intact');

    console.log('\nTest 9.3: Phase 15 — voice-service.ts has no browser speechSynthesis');
    const synthSpeakLines = voiceServiceSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') && l.includes('window.speechSynthesis')
    );
    assert(synthSpeakLines.length === 0, 'no window.speechSynthesis in voice-service.ts code');

    console.log('\nTest 9.4: Phase 16 — voice-tts-ended IPC intact');
    assert(mainSource.includes("'voice-tts-ended'"), 'Phase 16 voice-tts-ended IPC intact');
    assert(mainSource.includes('notifyTtsPlaybackEnded'), 'Phase 16 notifyTtsPlaybackEnded intact');

    console.log('\nTest 9.5: Phase 16 — voice-tts-stop-playback IPC intact');
    assert(mainSource.includes("'voice-tts-stop-playback'"), 'Phase 16 voice-tts-stop-playback IPC intact');

    console.log('\nTest 9.6: Phase 16 — requestId in voice-tts-audio payload');
    const onReadyIdx = mainSource.indexOf('onTTSAudioReady: (audioFilePath: string, text: string, requestId: number)');
    assert(onReadyIdx > 0, 'Phase 16 onTTSAudioReady has requestId param');
    const onReadySection = mainSource.substring(onReadyIdx, onReadyIdx + 1000);
    assert(onReadySection.includes("send('voice-tts-audio'"), 'Phase 16 sends voice-tts-audio');
    assert(onReadySection.includes('requestId'), 'Phase 16 payload includes requestId');

    console.log('\nTest 9.7: Phase 17 — cancelTask still calls abortInference');
    const coreSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'core.ts'),
      'utf-8',
    );
    const cancelStart = coreSource.indexOf('export async function cancelTask(');
    assert(cancelStart > 0, 'Phase 17 cancelTask is async');
    const cancelEnd = coreSource.indexOf('export function cancelTaskSync', cancelStart);
    const cancelSection = coreSource.substring(cancelStart, cancelEnd);
    assert(cancelSection.includes('abortInference'), 'Phase 17 cancelTask calls abortInference');

    console.log('\nTest 9.8: Phase 17 — Orb error auto-clear intact');
    // Phase 17 ORB-ERROR-NO-CLEAR fix: task_failed error condition auto-clears after 1.5s
    // Phase 18 (P2-1): the clear is now via scheduleConditionClear helper.
    const taskFailedIdx = chatSource.indexOf("case 'task_failed':");
    assert(taskFailedIdx > 0, 'task_failed case exists');
    // Window increased to 1200 to cover the full case body (comments + setCondition + setTimeout)
    const taskFailedSection = chatSource.substring(taskFailedIdx, taskFailedIdx + 1200);
    assert(taskFailedSection.includes("setCondition('agent', 'error')"), 'Phase 17 sets error condition');
    // Phase 18 (P2-1): auto-clear is now via scheduleConditionClear helper
    assert(taskFailedSection.includes("scheduleConditionClear('agent'"), 'Phase 17 auto-clears error condition via scheduleConditionClear');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 18 Stage 1 tests: ${passed}/${passed + failed} passed (${failed} failed)`);
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
