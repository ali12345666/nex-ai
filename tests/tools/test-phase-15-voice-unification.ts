/**
 * NEX AI — Phase 15: Voice TTS Unification + Comment Cleanup — Tests
 *
 * Tests that:
 *   - voice-service.ts no longer uses window.speechSynthesis for TTS
 *   - SpeechSynthesisUtterance is not used for response audio
 *   - voiceService.speak() only manages Orb state, no audio
 *   - Real TTS flows through Piper (voiceConversationSpeak IPC)
 *   - Stale comment in nex-voice-conversation.ts is updated
 *   - stop/cancel still prevents unwanted TTS
 *   - No duplicate TTS path exists
 *
 * Run with: npx tsx tests/tools/test-phase-15-voice-unification.ts
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
  console.log('Phase 15: Voice TTS Unification + Comment Cleanup Tests\n');

  const voiceServiceSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'services', 'voice-service.ts'),
    'utf-8',
  );
  const conversationSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'voice', 'nex-voice-conversation.ts'),
    'utf-8',
  );

  // ════════════════════════════════════════════════════════════════════════
  // 1. voice-service.ts: no browser TTS
  // ════════════════════════════════════════════════════════════════════════
  await testSection('1. voice-service.ts: no browser TTS', async () => {
    console.log('\nTest 1.1: speak() does NOT call window.speechSynthesis.speak');
    // Extract the speak() method body (not comments)
    const speakSection = voiceServiceSource.substring(
      voiceServiceSource.indexOf('speak(text: string): void {'),
      voiceServiceSource.indexOf('stopSpeaking(): void {'),
    );
    assert(!speakSection.includes('window.speechSynthesis.speak'), 'no speechSynthesis.speak in speak()');
    assert(!speakSection.includes('SpeechSynthesisUtterance'), 'no SpeechSynthesisUtterance in speak()');

    console.log('\nTest 1.2: speak() manages Orb state (setCondition tts speaking)');
    assert(speakSection.includes("this.setCondition('tts', 'speaking')"), 'sets speaking state');

    console.log('\nTest 1.3: speak() pauses STT during speaking');
    assert(speakSection.includes('this.stopSTT()'), 'pauses STT');

    console.log('\nTest 1.4: speak() auto-resumes listening after TTS in continuous mode');
    assert(speakSection.includes('this._shouldRestartSTT'), 'checks restart flag');
    assert(speakSection.includes("this.startSTT()"), 'restarts STT');

    console.log('\nTest 1.5: stopSpeaking() does NOT use window.speechSynthesis.cancel');
    const stopSection = voiceServiceSource.substring(
      voiceServiceSource.indexOf('stopSpeaking(): void {'),
      voiceServiceSource.indexOf('setCondition(key: string'),
    );
    assert(!stopSection.includes('window.speechSynthesis'), 'no speechSynthesis in stopSpeaking()');
    assert(stopSection.includes("this.clearCondition('tts')"), 'clears tts condition');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. No SpeechSynthesisUtterance anywhere in renderer
  // ════════════════════════════════════════════════════════════════════════
  await testSection('2. No SpeechSynthesisUtterance in renderer', async () => {
    console.log('\nTest 2.1: no SpeechSynthesisUtterance in voice-service.ts code (only comments)');
    // Count actual code lines (not comments) that use SpeechSynthesisUtterance
    const codeLines = voiceServiceSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') && l.includes('SpeechSynthesisUtterance')
    );
    assert(codeLines.length === 0, `no SpeechSynthesisUtterance in code (found ${codeLines.length})`);

    console.log('\nTest 2.2: no window.speechSynthesis.speak in voice-service.ts code');
    const synthSpeakLines = voiceServiceSource.split('\n').filter(l =>
      !l.trim().startsWith('//') && !l.trim().startsWith('*') && l.includes('window.speechSynthesis.speak')
    );
    assert(synthSpeakLines.length === 0, `no speechSynthesis.speak in code (found ${synthSpeakLines.length})`);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. Real TTS flows through Piper
  // ════════════════════════════════════════════════════════════════════════
  await testSection('3. Real TTS via Piper', async () => {
    console.log('\nTest 3.1: nex-voice-conversation.ts has speakResponse method');
    assert(conversationSource.includes('async speakResponse'), 'speakResponse exists');

    console.log('\nTest 3.2: speakResponse calls local-voice-engine.speak');
    // Phase 16: speakResponse may pass an additional { requestId } arg for
    // BUG-12 / BUG-26 race protection. The Phase 15 invariant — that
    // speakResponse calls engine.speak (NOT browser TTS) — is preserved.
    assert(conversationSource.includes('engine.speak(text'), 'calls engine.speak');

    console.log('\nTest 3.3: voiceConversationSpeak IPC exists in main.ts');
    const mainSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'),
      'utf-8',
    );
    assert(mainSource.includes("'voice-conversation-speak'"), 'IPC handler exists');

    console.log('\nTest 3.4: NexChatPanel calls voiceConversationSpeak (Phase 14)');
    const chatSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'chat', 'NexChatPanel.tsx'),
      'utf-8',
    );
    assert(chatSource.includes('voiceConversationSpeak'), 'NexChatPanel calls voiceConversationSpeak');

    console.log('\nTest 3.5: App.tsx plays TTS audio from Piper');
    const appSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'App.tsx'),
      'utf-8',
    );
    assert(appSource.includes('onVoiceTTSAudio'), 'App.tsx listens for TTS audio');
    assert(appSource.includes('new Audio'), 'App.tsx plays audio');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4. Stale comment updated
  // ════════════════════════════════════════════════════════════════════════
  await testSection('4. Stale comment updated', async () => {
    console.log('\nTest 4.1: old "In production" comment removed');
    assert(!conversationSource.includes('In production, the brain + chat IPC would produce a response here'),
      'old comment removed');

    console.log('\nTest 4.2: new Phase 14+15 comment present');
    assert(conversationSource.includes('Phase 14+15'), 'new comment has Phase 14+15 marker');
    assert(conversationSource.includes('voiceConversationSpeak'), 'mentions voiceConversationSpeak');
    assert(conversationSource.includes('NexChatPanel'), 'mentions NexChatPanel');
    assert(conversationSource.includes('enterListening'), 'mentions enterListening');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5. No duplicate TTS
  // ════════════════════════════════════════════════════════════════════════
  await testSection('5. No duplicate TTS', async () => {
    console.log('\nTest 5.1: voice-service.ts does NOT produce audio');
    const speakSection = voiceServiceSource.substring(
      voiceServiceSource.indexOf('speak(text: string): void {'),
      voiceServiceSource.indexOf('stopSpeaking(): void {'),
    );
    assert(!speakSection.includes('new Audio'), 'no new Audio in speak()');
    assert(!speakSection.includes('.play()'), 'no .play() in speak()');

    console.log('\nTest 5.2: voice-controller.ts.speak() delegates to voice-service (state only)');
    const controllerSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'services', 'voice-controller.ts'),
      'utf-8',
    );
    assert(controllerSource.includes('voiceService.speak(text)'), 'delegates to voiceService.speak');

    console.log('\nTest 5.3: no renderer component calls voiceController.speak() for TTS');
    // Check all .tsx files for voiceController.speak
    const tsxFiles = fs.readdirSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'components'))
      .filter(f => f.endsWith('.tsx'));
    let foundSpeakCall = false;
    for (const f of tsxFiles) {
      const content = fs.readFileSync(
        path.join(__dirname, '..', '..', 'src', 'renderer', 'components', f),
        'utf-8',
      );
      if (content.includes('voiceController.speak(')) foundSpeakCall = true;
    }
    assert(!foundSpeakCall, 'no renderer component calls voiceController.speak()');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 6. stop/cancel still works
  // ════════════════════════════════════════════════════════════════════════
  await testSection('6. stop/cancel still works', async () => {
    console.log('\nTest 6.1: stopSpeaking clears _ttsActive and tts condition');
    const stopSection = voiceServiceSource.substring(
      voiceServiceSource.indexOf('stopSpeaking(): void {'),
      voiceServiceSource.indexOf('setCondition(key: string'),
    );
    assert(stopSection.includes('this._ttsActive = false'), 'clears _ttsActive');
    assert(stopSection.includes("this.clearCondition('tts')"), 'clears tts condition');

    console.log('\nTest 6.2: NexChatPanel handleStop calls voiceConversationStopSpeaking');
    const chatSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'chat', 'NexChatPanel.tsx'),
      'utf-8',
    );
    assert(chatSource.includes('voiceConversationStopSpeaking'), 'handleStop stops TTS');
  });

  // ════════════════════════════════════════════════════════════════════════
  // 7. Regression
  // ════════════════════════════════════════════════════════════════════════
  await testSection('7. Regression', async () => {
    console.log('\nTest 7.1: Phase 14 voice response intact');
    const chatSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'chat', 'NexChatPanel.tsx'),
      'utf-8',
    );
    assert(chatSource.includes('wasVoiceInputRef'), 'Phase 14 wasVoiceInputRef intact');
    assert(chatSource.includes('speakResponseIfVoice'), 'Phase 14 speakResponseIfVoice intact');
    assert(chatSource.includes('ttsCancelledRef'), 'Phase 14 ttsCancelledRef intact');

    console.log('\nTest 7.2: Phase 13 wiring intact');
    const mainSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'),
      'utf-8',
    );
    assert(mainSource.includes('wireAgentRequest'), 'Phase 13 wireAgentRequest intact');

    console.log('\nTest 7.3: Phase 6 task queue intact');
    assert(fs.existsSync(path.join(__dirname, '..', '..', 'src', 'main', 'tasks', 'queue.ts')), 'Phase 6 intact');

    console.log('\nTest 7.4: AppShell voice-transcript source=voice intact (Phase 14)');
    const appShellSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'layout', 'AppShell.tsx'),
      'utf-8',
    );
    assert(appShellSource.includes("source: 'voice'"), 'Phase 14 source=voice intact');
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 15 voice unification tests: ${passed}/${passed + failed} passed (${failed} failed)`);
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
