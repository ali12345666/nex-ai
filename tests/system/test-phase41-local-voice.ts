/**
 * Phase 41 — Local Voice Intelligence Architecture Tests
 *
 * Verifies the new local voice system:
 *   1. LocalVoiceEngine (orchestrator + VAD)
 *   2. STTProvider interface + LocalWhisperProvider
 *   3. TTSProvider interface + LocalPiperProvider
 *   4. Voice Activity Detector (silence → speech → silence)
 *   5. IPC handlers registered
 *   6. Preload bridges present
 *   7. No cloud API calls anywhere
 *
 * Run: npx tsx tests/system/test-phase41-local-voice.ts
 */
import '../__mocks__/install-electron-mock.js';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main(): Promise<void> {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

  // ═══════════════════════════════════════════════════════════════════════
  // 1) LocalVoiceEngine module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n1) LocalVoiceEngine module:');
  const engineSrc = read('../../src/main/voice/local-voice-engine.ts');

  assert('local-voice-engine.ts exists', engineSrc.length > 0);
  assert('STTProvider interface exported', engineSrc.includes('export interface STTProvider'));
  assert('TTSProvider interface exported', engineSrc.includes('export interface TTSProvider'));
  assert('STTProvider has isLocal field', engineSrc.includes('readonly isLocal: boolean'));
  assert('STTProvider has transcribeFile', engineSrc.includes('transcribeFile'));
  assert('STTProvider has startStream/stopStream', engineSrc.includes('startStream') && engineSrc.includes('stopStream'));
  assert('TTSProvider has synthesize', engineSrc.includes('synthesize'));
  assert('TTSProvider has listVoices', engineSrc.includes('listVoices'));
  assert('VoiceActivityDetector class', engineSrc.includes('class VoiceActivityDetector'));
  assert('VAD has silenceThreshold', engineSrc.includes('silenceThreshold'));
  assert('VAD has silenceDurationMs', engineSrc.includes('silenceDurationMs'));
  assert('VAD has speechDurationMs', engineSrc.includes('speechDurationMs'));
  assert('VAD states (silence/speech/transition)', engineSrc.includes("'silence'") && engineSrc.includes("'speech'") && engineSrc.includes("'transition'"));
  assert('VAD feed method', engineSrc.includes('feed(audioLevel'));
  assert('VAD onEvent callback', engineSrc.includes('onEvent'));
  assert('LocalVoiceEngine class exported', engineSrc.includes('export class LocalVoiceEngine'));
  assert('engine has setSTTProvider', engineSrc.includes('setSTTProvider'));
  assert('engine has setTTSProvider', engineSrc.includes('setTTSProvider'));
  assert('engine has startListening', engineSrc.includes('startListening'));
  assert('engine has stopListening', engineSrc.includes('stopListening'));
  assert('engine has speak', engineSrc.includes('speak'));
  assert('engine has stopSpeaking', engineSrc.includes('stopSpeaking'));
  assert('engine has setThinking', engineSrc.includes('setThinking'));
  assert('engine has hasLocalSTT', engineSrc.includes('hasLocalSTT'));
  assert('engine has hasLocalTTS', engineSrc.includes('hasLocalTTS'));
  assert('engine pauses STT during TTS', engineSrc.includes('wasListening') && engineSrc.includes('stopListening'));
  assert('getLocalVoiceEngine singleton', engineSrc.includes('export function getLocalVoiceEngine'));

  // ═══════════════════════════════════════════════════════════════════════
  // 2) LocalWhisperProvider module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n2) LocalWhisperProvider module:');
  const whisperSrc = read('../../src/main/voice/local-whisper-provider.ts');

  assert('local-whisper-provider.ts exists', whisperSrc.length > 0);
  assert('LocalWhisperProvider class exported', whisperSrc.includes('export class LocalWhisperProvider'));
  assert('implements STTProvider', whisperSrc.includes('implements STTProvider'));
  assert('isLocal = true', whisperSrc.includes('readonly isLocal = true'));
  assert('name = whisper', whisperSrc.includes("readonly name = 'whisper'"));
  assert('findWhisperBinary exported', whisperSrc.includes('export function findWhisperBinary'));
  assert('findFfmpegBinary exported', whisperSrc.includes('export function findFfmpegBinary'));
  assert('uses safeExecFile (no shell)', whisperSrc.includes('safeExecFile'));
  assert('whisper binary search paths', whisperSrc.includes('WHISPER_SEARCH_PATHS'));
  assert('checks NEX_WHISPER_BIN env', whisperSrc.includes('NEX_WHISPER_BIN'));
  assert('transcribeFile method', whisperSrc.includes('transcribeFile'));
  assert('startStream method', whisperSrc.includes('startStream'));
  assert('stopStream method', whisperSrc.includes('stopStream'));
  assert('feedAudioChunk method', whisperSrc.includes('feedAudioChunk'));
  assert('resampling to 16kHz', whisperSrc.includes('16000'));
  assert('whisper args (-m -f)', whisperSrc.includes("'-m'") && whisperSrc.includes("'-f'"));
  assert('language support', whisperSrc.includes("'-l'"));
  assert('init checks binary exists', whisperSrc.includes('binary not found'));
  assert('init checks model exists', whisperSrc.includes('model not found'));

  // ═══════════════════════════════════════════════════════════════════════
  // 3) LocalPiperProvider module
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n3) LocalPiperProvider module:');
  const piperSrc = read('../../src/main/voice/local-piper-provider.ts');

  assert('local-piper-provider.ts exists', piperSrc.length > 0);
  assert('LocalPiperProvider class exported', piperSrc.includes('export class LocalPiperProvider'));
  assert('implements TTSProvider', piperSrc.includes('implements TTSProvider'));
  assert('isLocal = true', piperSrc.includes('readonly isLocal = true'));
  assert('name = piper', piperSrc.includes("readonly name = 'piper'"));
  assert('findPiperBinary exported', piperSrc.includes('export function findPiperBinary'));
  assert('uses safeExecFile (no shell)', piperSrc.includes('safeExecFile'));
  assert('piper binary search paths', piperSrc.includes('PIPER_SEARCH_PATHS'));
  assert('checks NEX_PIPER_BIN env', piperSrc.includes('NEX_PIPER_BIN'));
  assert('synthesize method', piperSrc.includes('synthesize'));
  assert('listVoices method', piperSrc.includes('listVoices'));
  assert('rate control (length-scale)', piperSrc.includes('--length-scale'));
  assert('piper args (--model)', piperSrc.includes("'--model'"));
  assert('output file path', piperSrc.includes('--output_file'));
  assert('init checks binary exists', piperSrc.includes('binary not found'));
  assert('init checks voice model exists', piperSrc.includes('voice model not found'));
  assert('voice name parsing (en_US-lessac)', piperSrc.includes('en_US') || piperSrc.includes('match'));

  // ═══════════════════════════════════════════════════════════════════════
  // 4) IPC handlers registered in main.ts
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n4) IPC handlers:');
  const mainSrc = read('../../src/main/main.ts');
  assert('voice-status handler', mainSrc.includes("'voice-status'"));
  assert('voice-set-stt-model handler', mainSrc.includes("'voice-set-stt-model'"));
  assert('voice-set-tts-model handler', mainSrc.includes("'voice-set-tts-model'"));
  assert('voice-transcribe handler', mainSrc.includes("'voice-transcribe'"));
  assert('voice-synthesize handler', mainSrc.includes("'voice-synthesize'"));
  assert('voice-list-voices handler', mainSrc.includes("'voice-list-voices'"));
  assert('voice-find-binaries handler', mainSrc.includes("'voice-find-binaries'"));
  assert('Phase 41 log message', mainSrc.includes('Phase 41'));

  // ═══════════════════════════════════════════════════════════════════════
  // 5) Preload bridges
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n5) Preload bridges:');
  const preSrc = read('../../src/main/preload.ts');
  assert('voiceStatus bridge', preSrc.includes('voiceStatus'));
  assert('voiceSetSTTModel bridge', preSrc.includes('voiceSetSTTModel'));
  assert('voiceSetTTSModel bridge', preSrc.includes('voiceSetTTSModel'));
  assert('voiceTranscribe bridge', preSrc.includes('voiceTranscribe'));
  assert('voiceSynthesize bridge', preSrc.includes('voiceSynthesize'));
  assert('voiceListVoices bridge', preSrc.includes('voiceListVoices'));
  assert('voiceFindBinaries bridge', preSrc.includes('voiceFindBinaries'));

  // ═══════════════════════════════════════════════════════════════════════
  // 6) Type definitions in electron.d.ts
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n6) Type definitions:');
  const typesSrc = read('../../src/renderer/types/electron.d.ts');
  assert('voiceStatus type', typesSrc.includes('voiceStatus'));
  assert('voiceSetSTTModel type', typesSrc.includes('voiceSetSTTModel'));
  assert('voiceSetTTSModel type', typesSrc.includes('voiceSetTTSModel'));
  assert('voiceTranscribe type', typesSrc.includes('voiceTranscribe'));
  assert('voiceSynthesize type', typesSrc.includes('voiceSynthesize'));
  assert('voiceListVoices type', typesSrc.includes('voiceListVoices'));
  assert('voiceFindBinaries type', typesSrc.includes('voiceFindBinaries'));
  assert('voice types has hasLocalSTT', typesSrc.includes('hasLocalSTT'));
  assert('voice types has hasLocalTTS', typesSrc.includes('hasLocalTTS'));

  // ═══════════════════════════════════════════════════════════════════════
  // 7) No cloud API calls in voice modules
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n7) No cloud API calls:');
  assert('NO googleapis in voice modules', !engineSrc.includes('googleapis') && !whisperSrc.includes('googleapis') && !piperSrc.includes('googleapis'));
  assert('NO cloud speech in voice modules', !engineSrc.includes('cloud-speech') && !whisperSrc.includes('cloud-speech'));
  assert('NO external http in voice modules', !engineSrc.includes('https://') && !whisperSrc.includes('https://') && !piperSrc.includes('https://'));
  assert('NO webkitSpeechRecognition in voice modules', !engineSrc.includes('webkitSpeechRecognition') && !whisperSrc.includes('webkitSpeechRecognition'));

  // ═══════════════════════════════════════════════════════════════════════
  // 8) Existing voice-types.ts interfaces
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n8) Existing voice-types.ts interfaces:');
  const vtSrc = read('../../src/main/ai/voice-types.ts');
  assert('STTEngine interface exists', vtSrc.includes('export interface STTEngine'));
  assert('TTSEngine interface exists', vtSrc.includes('export interface TTSEngine'));
  assert('STTResult interface exists', vtSrc.includes('export interface STTResult'));
  assert('TTSResult interface exists', vtSrc.includes('export interface TTSResult'));
  assert('WakeWordDetector interface exists', vtSrc.includes('export interface WakeWordDetector'));
  assert('VoiceCommandParser interface exists', vtSrc.includes('export interface VoiceCommandParser'));
  assert('voice-types says "local-first"', vtSrc.includes('Local-First') || vtSrc.includes('local'));

  // ═══════════════════════════════════════════════════════════════════════
  // 9) FUNCTIONAL TESTS — VAD
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n9) VAD functional tests:');

  const { VoiceActivityDetector } = await import('../../src/main/voice/local-voice-engine');
  const vad = new VoiceActivityDetector({
    silenceThreshold: 0.05,
    silenceDurationMs: 100, // short for testing
    speechDurationMs: 50,
    noiseFloor: 0.01,
  });

  let events: string[] = [];
  vad.onEvent((e) => events.push(e.state));

  // Feed silence → should stay 'silence'
  for (let i = 0; i < 10; i++) vad.feed(0.01);
  assert('VAD stays in silence when quiet', vad.isSpeech === false);

  // Feed loud audio → should transition to speech
  for (let i = 0; i < 20; i++) vad.feed(0.3);
  // Wait for speechDurationMs
  await new Promise((r) => setTimeout(r, 60));
  for (let i = 0; i < 20; i++) vad.feed(0.3);
  assert('VAD detects speech when loud', vad.isSpeech === true);
  assert('VAD emitted speech event', events.includes('speech'));

  // Feed silence → should transition back to silence
  // The VAD uses a smoothed level with slow release (0.08), so we need enough
  // samples + time to let the smoothed level drop below the threshold AND
  // pass the silenceDurationMs window.
  // Feed for 500ms total (well past the 100ms silenceDurationMs)
  for (let i = 0; i < 100; i++) {
    vad.feed(0.001);
    await new Promise((r) => setTimeout(r, 5));
  }
  // After ~500ms of feeding near-zero, the VAD should have emitted 'silence'
  assert('VAD returns to silence after quiet', vad.isSpeech === false);
  assert('VAD emitted silence event', events.includes('silence'));

  // ═══════════════════════════════════════════════════════════════════════
  // 10) FUNCTIONAL TESTS — LocalVoiceEngine
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n10) LocalVoiceEngine functional tests:');

  const { LocalVoiceEngine } = await import('../../src/main/voice/local-voice-engine');
  const engine = new LocalVoiceEngine();

  let stateChanges: string[] = [];
  let audioLevels: number[] = [];
  let transcripts: string[] = [];

  engine.setCallbacks({
    onStateChange: (s) => stateChanges.push(s),
    onAudioLevel: (l) => audioLevels.push(l),
    onFinalTranscript: (t) => transcripts.push(t),
    onError: () => {},
  });

  assert('engine starts in idle state', engine.currentState === 'idle');
  assert('engine has no STT provider initially', engine.getSTTProvider() === null);
  assert('engine has no TTS provider initially', engine.getTTSProvider() === null);
  assert('engine hasLocalSTT = false initially', engine.hasLocalSTT === false);
  assert('engine hasLocalTTS = false initially', engine.hasLocalTTS === false);

  // Feed audio level
  engine.feedAudioLevel(0.5);
  assert('engine forwards audio level', audioLevels.length > 0);
  assert('engine audio level = 0.5', audioLevels[audioLevels.length - 1] === 0.5);

  // setThinking
  engine.setThinking(true);
  assert('engine state = thinking', engine.currentState === 'thinking');
  engine.setThinking(false);
  assert('engine state returns to idle', engine.currentState === 'idle');

  // ═══════════════════════════════════════════════════════════════════════
  // 11) Provider detection (findWhisperBinary / findPiperBinary)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n11) Binary detection:');
  const { findWhisperBinary } = await import('../../src/main/voice/local-whisper-provider');
  const { findPiperBinary } = await import('../../src/main/voice/local-piper-provider');

  // These should return null or a string (not throw)
  const whisperBin = findWhisperBinary();
  const piperBin = findPiperBinary();
  assert('findWhisperBinary returns string or null', whisperBin === null || typeof whisperBin === 'string');
  assert('findPiperBinary returns string or null', piperBin === null || typeof piperBin === 'string');

  // ═══════════════════════════════════════════════════════════════════════
  // 12) Offline verification — no external calls
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n12) Offline verification:');
  // Check that no voice module imports http/https/fetch for external calls
  const allVoiceSrc = engineSrc + whisperSrc + piperSrc;
  assert('NO fetch() calls in voice modules', !allVoiceSrc.includes('fetch('));
  assert('NO XMLHttpRequest in voice modules', !allVoiceSrc.includes('XMLHttpRequest'));
  assert('NO https.request in voice modules', !allVoiceSrc.includes('https.request'));
  assert('NO cloud endpoints in voice modules', !allVoiceSrc.includes('api.openai.com') && !allVoiceSrc.includes('api.anthropic.com') && !allVoiceSrc.includes('googleapis.com'));

  console.log('\n══════════════════════════════════════');
  console.log(`PHASE 41 LOCAL VOICE RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('PHASE 41 LOCAL VOICE INTELLIGENCE: ALL PASS ✅');
  console.log('\nNOTE: Windows runtime QA is NOT VERIFIED by this test.');
  console.log('      The user MUST verify on Windows:');
  console.log('      1. Install whisper.cpp binary → voice-status returns hasLocalSTT=true');
  console.log('      2. Install piper binary → voice-status returns hasLocalTTS=true');
  console.log('      3. Add whisper model → voice-transcribe works');
  console.log('      4. Add piper voice → voice-synthesize returns audio file');
  console.log('      5. Disconnect internet → voice still works (offline)');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
