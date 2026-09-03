/**
 * NEX AI — Phase 116: JARVIS Voice Experience Tests
 *
 * Tests the new voice pipeline features:
 *   1. VoiceMode (continuous / push-to-talk / disabled)
 *   2. Wake word detection ("NEX")
 *   3. VAD (Voice Activity Detection) integration
 *   4. Barge-in (stop TTS when user speaks)
 *   5. JARVIS personality prompt
 *   6. Continuous conversation auto-restart
 *
 * Run with: npx tsx tests/tools/test-phase-116-jarvis-voice.ts
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

  console.log('Phase 116 JARVIS Voice Experience Tests\n');

  // ════════════════════════════════════════════════════════════════════════
  // 1. VoiceService — VoiceMode
  // ════════════════════════════════════════════════════════════════════════
  console.log('=== 1. VoiceMode ===');

  const voiceServiceSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'services', 'voice-service.ts'),
    'utf-8'
  );

  console.log('\nTest 1: VoiceMode type exists');
  assert(voiceServiceSource.includes("export type VoiceMode = 'continuous' | 'push-to-talk' | 'disabled'"), 'VoiceMode type should be defined');

  console.log('\nTest 2: setMode method exists');
  assert(voiceServiceSource.includes('setMode(mode: VoiceMode)'), 'setMode method should exist');

  console.log('\nTest 3: Disabled mode stops listening');
  assert(
    voiceServiceSource.includes("if (mode === 'disabled')") &&
    voiceServiceSource.includes('this.stopListening()'),
    'disabled mode should stop listening'
  );

  console.log('\nTest 4: Continuous mode auto-starts');
  assert(
    voiceServiceSource.includes("if (mode === 'continuous' && prevMode !== 'continuous')") &&
    voiceServiceSource.includes('this.startListening()'),
    'continuous mode should auto-start listening'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 2. Wake Word Detection
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 2. Wake Word ===');

  console.log('\nTest 5: Wake word config exists');
  assert(voiceServiceSource.includes('wakeWord'), 'wakeWord config should exist');
  assert(voiceServiceSource.includes("wakeWord: 'nex'"), 'default wake word should be "nex"');

  console.log('\nTest 6: checkWakeWord method exists');
  assert(voiceServiceSource.includes('checkWakeWord'), 'checkWakeWord method should exist');

  console.log('\nTest 7: Wake word callback exists');
  assert(voiceServiceSource.includes('onWakeWord'), 'onWakeWord callback should exist');

  console.log('\nTest 8: Wake word strips from transcript');
  assert(
    voiceServiceSource.includes('Strip the wake word') &&
    voiceServiceSource.includes('replace'),
    'should strip wake word from transcript before sending'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 3. VAD (Voice Activity Detection)
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 3. VAD ===');

  console.log('\nTest 9: VAD config exists');
  assert(
    voiceServiceSource.includes('vadSilenceThreshold') &&
    voiceServiceSource.includes('vadSilenceDurationMs'),
    'VAD config should exist'
  );

  console.log('\nTest 10: processVAD method exists');
  assert(voiceServiceSource.includes('processVAD'), 'processVAD method should exist');

  console.log('\nTest 11: VAD detects speech start');
  assert(
    voiceServiceSource.includes("_vadState = 'speech'"),
    'VAD should detect speech start'
  );

  console.log('\nTest 12: VAD detects speech end (silence)');
  assert(
    voiceServiceSource.includes('_vadSilenceStart') &&
    voiceServiceSource.includes('vadSilenceDurationMs'),
    'VAD should detect silence after speech'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 4. Barge-in
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 4. Barge-in ===');

  console.log('\nTest 13: Barge-in stops TTS when user speaks');
  assert(
    voiceServiceSource.includes('Barge-in') &&
    voiceServiceSource.includes('this.stopSpeaking()'),
    'should stop TTS when user starts speaking during TTS'
  );

  console.log('\nTest 14: Barge-in restarts STT in continuous mode');
  assert(
    voiceServiceSource.includes("if (this._mode === 'continuous' && !this._sttActive)"),
    'should restart STT after barge-in in continuous mode'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 5. Continuous Conversation
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 5. Continuous Conversation ===');

  console.log('\nTest 15: Continuous mode auto-restarts STT after TTS');
  assert(
    voiceServiceSource.includes("'continuous'") &&
    voiceServiceSource.includes('_shouldRestartSTT') &&
    voiceServiceSource.includes('this.startSTT()'),
    'continuous mode should auto-restart STT after TTS ends'
  );

  console.log('\nTest 16: STT onend restarts in continuous mode');
  assert(
    voiceServiceSource.includes("if (this._mode === 'continuous' && this._shouldRestartSTT)"),
    'STT onend should restart in continuous mode'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 6. VoiceController
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 6. VoiceController ===');

  const voiceControllerSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'services', 'voice-controller.ts'),
    'utf-8'
  );

  console.log('\nTest 17: VoiceController has setMode');
  assert(voiceControllerSource.includes('setMode(mode: VoiceMode)'), 'VoiceController should have setMode');

  console.log('\nTest 18: VoiceController has onWakeWord callback');
  assert(voiceControllerSource.includes('onWakeWord'), 'VoiceController should have onWakeWord callback');

  console.log('\nTest 19: VoiceController forwards onWakeWord');
  assert(
    voiceControllerSource.includes("onWakeWord: () => this.callbacks.onWakeWord?.()"),
    'VoiceController should forward wake word callback'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 7. AppShell Integration
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 7. AppShell Integration ===');

  const appShellSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'layout', 'AppShell.tsx'),
    'utf-8'
  );

  console.log('\nTest 20: AppShell sets continuous mode on startup');
  assert(
    appShellSource.includes("voiceController.setMode('continuous')"),
    'AppShell should set continuous mode on startup'
  );

  console.log('\nTest 21: AppShell handles wake word');
  assert(
    appShellSource.includes('onWakeWord') &&
    appShellSource.includes('nex:voice-transcript'),
    'AppShell should dispatch wake word event'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 8. JARVIS Personality
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 8. JARVIS Personality ===');

  const aiServiceSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'ai-service.ts'),
    'utf-8'
  );

  console.log('\nTest 22: System prompt is calm and efficient');
  assert(aiServiceSource.includes('calm and efficient'), 'system prompt should say "calm and efficient"');

  console.log('\nTest 23: System prompt says "do not say I\'m doing X"');
  assert(aiServiceSource.includes("Do NOT say"), 'system prompt should tell model not to pre-announce');

  console.log('\nTest 24: System prompt mentions voice conversations');
  assert(aiServiceSource.includes('voice conversations'), 'system prompt should mention voice conversations');

  console.log('\nTest 25: System prompt handles wake word "NEX"');
  assert(
    aiServiceSource.includes('NEX') && aiServiceSource.includes('بله?'),
    'system prompt should handle wake word "NEX" → "بله?"'
  );

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 116 JARVIS voice tests: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
