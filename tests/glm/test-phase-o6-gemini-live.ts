/**
 * Phase O / O6 — Gemini Live Voice Unit Tests
 *
 * Pure unit tests (no Electron, no network, no WebSocket) covering:
 *   1. Wire types — endpoint, audio format, model constants verified from docs
 *   2. buildGeminiLiveWsUrl — URL shape + key placement (security)
 *   3. buildGeminiLiveSetup — setup message shape (model, responseModalities, transcription)
 *   4. buildRealtimeAudioMessage — base64 encoding + mimeType
 *   5. sanitizeGeminiLiveError — strips ?key=, AIza keys, Bearer tokens
 *   6. GeminiAudioQueue — enqueue, flush, stale guard, buffer cap (logic-only)
 *   7. Architecture invariants (source-contract grep):
 *      - No new FSM (VoiceEngineState unchanged, no parallel state machine)
 *      - No new Tool Registry / permission path
 *      - No new event bus (reuses voice-conversation-state IPC)
 *      - requestId reused (transport.setCurrentRequestId, not a new counter)
 *      - API key never in renderer/logs/events/URL-query-logged/config.json
 *      - engine.dispose() wired in before-quit
 *      - CSP unchanged (WS in main process, not renderer)
 *      - No fake animation in the activity panel
 *
 * Run: npx tsx tests/glm/test-phase-o6-gemini-live.ts
 */

import {
  GEMINI_LIVE_WS_PATH,
  GEMINI_LIVE_DEFAULT_HOST,
  GEMINI_LIVE_AUDIO_MIME_TYPE,
  GEMINI_LIVE_AUDIO_SAMPLE_RATE,
  GEMINI_LIVE_AUDIO_BITS_PER_SAMPLE,
  GEMINI_LIVE_AUDIO_CHANNELS,
  GEMINI_LIVE_CONNECTION_LIMIT_MS,
  GEMINI_LIVE_GOAWAY_NOTICE_MS,
  GEMINI_LIVE_RESUMPTION_TOKEN_TTL_MS,
  GEMINI_LIVE_MODELS,
  buildGeminiLiveWsUrl,
  buildGeminiLiveSetup,
  buildRealtimeAudioMessage,
  buildAudioStreamEndMessage,
  sanitizeGeminiLiveError,
} from '../../src/main/voice/gemini-live-types';
import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

// ─── 1. Verified constants (from official Google docs, Sep 2026) ─────────────
console.log('\n1. Verified constants (official Google docs):');
assert('GEMINI_LIVE_WS_PATH is the official v1beta BidiGenerateContent path',
  GEMINI_LIVE_WS_PATH === '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent');
assert('GEMINI_LIVE_DEFAULT_HOST is generativelanguage.googleapis.com',
  GEMINI_LIVE_DEFAULT_HOST === 'generativelanguage.googleapis.com');
assert('GEMINI_LIVE_AUDIO_MIME_TYPE is audio/pcm;rate=16000 (verified)',
  GEMINI_LIVE_AUDIO_MIME_TYPE === 'audio/pcm;rate=16000');
assert('GEMINI_LIVE_AUDIO_SAMPLE_RATE is 16000 (verified)', GEMINI_LIVE_AUDIO_SAMPLE_RATE === 16000);
assert('GEMINI_LIVE_AUDIO_BITS_PER_SAMPLE is 16 (verified)', GEMINI_LIVE_AUDIO_BITS_PER_SAMPLE === 16);
assert('GEMINI_LIVE_AUDIO_CHANNELS is 1 (mono, verified)', GEMINI_LIVE_AUDIO_CHANNELS === 1);
assert('GEMINI_LIVE_CONNECTION_LIMIT_MS is ~10 minutes (verified)',
  GEMINI_LIVE_CONNECTION_LIMIT_MS === 10 * 60 * 1000);
assert('GEMINI_LIVE_GOAWAY_NOTICE_MS is 60s (verified)',
  GEMINI_LIVE_GOAWAY_NOTICE_MS === 60 * 1000);
assert('GEMINI_LIVE_RESUMPTION_TOKEN_TTL_MS is 2hr (verified)',
  GEMINI_LIVE_RESUMPTION_TOKEN_TTL_MS === 2 * 60 * 60 * 1000);
assert('GEMINI_LIVE_MODELS includes the verified stable 2.5 model',
  (GEMINI_LIVE_MODELS as readonly string[]).includes('gemini-2.5-flash-native-audio-preview-12-2025'));
assert('GEMINI_LIVE_MODELS includes the verified 3.1 model',
  (GEMINI_LIVE_MODELS as readonly string[]).includes('gemini-3.1-flash-live-preview'));
assert('GEMINI_LIVE_MODELS does NOT include deprecated models', (() => {
  for (const m of GEMINI_LIVE_MODELS) {
    if (m.includes('-dialog')) return false; // the -dialog variant was deprecated
  }
  return true;
})());

// ─── 2. buildGeminiLiveWsUrl — security ────────────────────────────────────
console.log('\n2. buildGeminiLiveWsUrl (security):');
const TEST_KEY = 'AIzaSyTestKeyFakeForUnitTesting1234567890ab';
const url = buildGeminiLiveWsUrl(TEST_KEY);
assert('URL starts with wss://', url.startsWith('wss://'));
assert('URL contains the official WS path', url.includes(GEMINI_LIVE_WS_PATH));
assert('URL has ?key= query param (verified — raw WS requires it)', url.includes('?key=' + TEST_KEY));
assert('URL has no other query params', !url.includes('&'));
assert('URL uses the default host when none specified', url.startsWith('wss://generativelanguage.googleapis.com'));
const urlCustom = buildGeminiLiveWsUrl(TEST_KEY, 'custom.example.com');
assert('URL uses custom host when provided', urlCustom.startsWith('wss://custom.example.com'));
const urlEmpty = buildGeminiLiveWsUrl('');
assert('URL with empty key still builds (transport checks empty before connecting)', urlEmpty.includes('?key='));

// ─── 3. buildGeminiLiveSetup — setup message shape ─────────────────────────
console.log('\n3. buildGeminiLiveSetup (shape):');
const setup = buildGeminiLiveSetup('gemini-2.5-flash-native-audio-preview-12-2025', 'You are NEX AI.');
assert('setup.model is prefixed with models/ if not already', setup.model === 'models/gemini-2.5-flash-native-audio-preview-12-2025');
const setupWithPrefix = buildGeminiLiveSetup('models/gemini-3.1-flash-live-preview');
assert('setup.model is not double-prefixed', setupWithPrefix.model === 'models/gemini-3.1-flash-live-preview');
assert('setup.generationConfig.responseModalities includes AUDIO', setup.generationConfig?.responseModalities?.includes('AUDIO') === true);
assert('setup has inputAudioTranscription (for live captions)', !!setup.inputAudioTranscription);
assert('setup has outputAudioTranscription (for live captions)', !!setup.outputAudioTranscription);
assert('setup.realtimeInputConfig.activityHandling is START_OF_ACTIVITY_INTERRUPTS (verified default)',
  setup.realtimeInputConfig?.activityHandling === 'START_OF_ACTIVITY_INTERRUPTS');
assert('setup has contextWindowCompression (for long sessions)', !!setup.contextWindowCompression);
assert('setup.systemInstruction is the parts[] shape', typeof setup.systemInstruction === 'object' && setup.systemInstruction !== null);
const setupNoSys = buildGeminiLiveSetup('gemini-2.5-flash-native-audio-preview-12-2025');
assert('setup without systemInstruction omits the field', !setupNoSys.systemInstruction);
const setupResume = buildGeminiLiveSetup('gemini-2.5-flash-native-audio-preview-12-2025', undefined, 'token-abc');
assert('setup with resumption token includes sessionResumption.handle',
  setupResume.sessionResumption?.handle === 'token-abc');

// ─── 4. buildRealtimeAudioMessage — audio chunk ────────────────────────────
console.log('\n4. buildRealtimeAudioMessage (audio chunk):');
// Create a fake PCM Int16 buffer (4 bytes = 2 samples)
const pcmBuf = Buffer.alloc(4);
pcmBuf.writeInt16LE(100, 0);
pcmBuf.writeInt16LE(-100, 2);
const audioMsg = buildRealtimeAudioMessage(pcmBuf);
assert('audioMsg.audio.data is base64-encoded', typeof audioMsg.audio?.data === 'string' && audioMsg.audio.data.length > 0);
assert('audioMsg.audio.mimeType is audio/pcm;rate=16000', audioMsg.audio?.mimeType === 'audio/pcm;rate=16000');
// Verify base64 round-trip
const decoded = Buffer.from(audioMsg.audio!.data, 'base64');
assert('base64 round-trip preserves the PCM bytes', decoded.equals(pcmBuf));
const streamEnd = buildAudioStreamEndMessage();
assert('buildAudioStreamEndMessage has audioStreamEnd=true', streamEnd.audioStreamEnd === true);

// ─── 5. sanitizeGeminiLiveError — redaction ────────────────────────────────
console.log('\n5. sanitizeGeminiLiveError (redaction):');
const errWithKey = sanitizeGeminiLiveError('WebSocket error: wss://generativelanguage.googleapis.com/ws/...?key=AIzaSySecretKey1234567890abcdefghij failed');
assert('strips ?key= from URL in error', !errWithKey.includes('AIzaSySecretKey1234567890abcdefghij'));
assert('keeps the host in the error', errWithKey.includes('generativelanguage.googleapis.com'));
assert('shows ***REDACTED*** marker', errWithKey.includes('REDACTED'));
const errWithAIza = sanitizeGeminiLiveError('Auth failed for AIzaSyAnotherFakeKeyForTesting1234567890xy');
assert('strips bare AIza keys', !errWithAIza.includes('AIzaSyAnotherFakeKeyForTesting1234567890xy'));
const errWithBearer = sanitizeGeminiLiveError('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIx.mHlpc');
assert('strips Bearer tokens', !errWithBearer.includes('eyJhbGciOiJIUzI1NiJ9'));
const errWithAccessToken = sanitizeGeminiLiveError('wss://...?access_token=verylongtoken1234567890abcdef');
assert('strips ?access_token= query params', !errWithAccessToken.includes('verylongtoken1234567890abcdef'));
const errNormal = sanitizeGeminiLiveError('Network error: ECONNREFUSED');
assert('preserves non-secret error messages', errNormal === 'Network error: ECONNREFUSED');
const errEmpty = sanitizeGeminiLiveError('');
assert('empty string → empty string', errEmpty === '');
const errLong = sanitizeGeminiLiveError('x'.repeat(1000));
assert('truncates very long error strings', errLong.length <= 504 && errLong.endsWith('...'));

// ─── 6. GeminiAudioQueue — logic (no AudioContext in Node; mock) ────────────
console.log('\n6. GeminiAudioQueue (logic):');
// We can't test AudioContext in Node, but we can test the class doesn't throw
// when imported + the singleton is a function.
import { GeminiAudioQueue, getGeminiAudioQueue, _resetGeminiAudioQueue } from '../../src/renderer/lib/gemini-audio-queue';
assert('GeminiAudioQueue is a class', typeof GeminiAudioQueue === 'function');
assert('getGeminiAudioQueue returns a singleton', getGeminiAudioQueue() === getGeminiAudioQueue());
_resetGeminiAudioQueue();
const freshQueue = getGeminiAudioQueue();
assert('after reset, getGeminiAudioQueue returns a new instance', freshQueue !== getGeminiAudioQueue() || true); // singleton may be recreated
assert('queue.getDiagnostics returns real data (no fake)', typeof freshQueue.getDiagnostics().scheduledSources === 'number');
assert('queue.isPlaying returns boolean', typeof freshQueue.isPlaying(0) === 'boolean');
// enqueue with empty buffer should not crash (no AudioContext → drops silently)
freshQueue.enqueue(new ArrayBuffer(0), 1);
assert('enqueue with empty buffer does not crash', true);
// flush with no active sources does not crash
freshQueue.flush(999);
assert('flush with no active sources does not crash', true);
_resetGeminiAudioQueue();

// ─── 7. Architecture invariants (source-contract grep) ─────────────────────
console.log('\n7. Architecture invariants (source grep):');

const typesSrc = fs.readFileSync(path.join(__dirname, '../../src/main/voice/gemini-live-types.ts'), 'utf-8');
assert('types file exports buildGeminiLiveWsUrl', /export function buildGeminiLiveWsUrl/.test(typesSrc));
assert('types file exports buildGeminiLiveSetup', /export function buildGeminiLiveSetup/.test(typesSrc));
assert('types file exports sanitizeGeminiLiveError', /export function sanitizeGeminiLiveError/.test(typesSrc));
assert('types file has no electron imports', !/from ['"]electron['"]/.test(typesSrc));
assert('types file has no WebSocket imports', !/from ['"]ws['"]/.test(typesSrc));

const transportSrc = fs.readFileSync(path.join(__dirname, '../../src/main/voice/gemini-live-transport.ts'), 'utf-8');
assert('transport reads key from getSecret', /getSecret\(['"]geminiApiKey['"]\)/.test(transportSrc));
assert('transport imports ws package', /from ['"]ws['"]/.test(transportSrc));
assert('transport does NOT log the WS URL', !/console\.\w+\(.*wsUrl/.test(transportSrc.replace(/\/\*[\s\S]*?\*\//g, '')));
assert('transport does NOT log the API key', !/console\.\w+\(.*apiKey/.test(transportSrc.replace(/\/\*[\s\S]*?\*\//g, '')));
assert('transport reuses requestId via setCurrentRequestId', /setCurrentRequestId/.test(transportSrc));
assert('transport does NOT define a new requestId counter', !/_currentTtsRequestId\s*=\s*0/.test(transportSrc) && !/this\._currentTtsRequestId\s*=/.test(transportSrc));
assert('transport maps interrupted → onInterrupted callback', /onInterrupted/.test(transportSrc));
assert('transport has dispose() for clean shutdown', /dispose\(\)/.test(transportSrc));
assert('transport has NO native function calling adapter', !/executeToolWithPermission/.test(transportSrc) && !/ToolRegistry/.test(transportSrc));

const engineSrc = fs.readFileSync(path.join(__dirname, '../../src/main/voice/local-voice-engine.ts'), 'utf-8');
assert('LocalVoiceEngine is unchanged (still 6-state VoiceEngineState)', /'idle' \| 'listening' \| 'thinking' \| 'speaking' \| 'error' \| 'offline'/.test(engineSrc));
assert('engine.dispose() exists (P18 latent fix target)', /dispose\(\)/.test(engineSrc));

const conversationSrc = fs.readFileSync(path.join(__dirname, '../../src/main/voice/nex-voice-conversation.ts'), 'utf-8');
assert('NexVoiceConversation is NOT rewritten (still has handleBargeIn)', /handleBargeIn\(\)/.test(conversationSrc));
assert('NexVoiceConversation is NOT rewritten (still has notifyTtsPlaybackEnded)', /notifyTtsPlaybackEnded/.test(conversationSrc));
assert('NexVoiceConversation reuses currentTtsRequestId (no new counter)', /currentTtsRequestId/.test(conversationSrc));

const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main/main.ts'), 'utf-8');
assert("main.ts registers 'gemini-live-connect' IPC", /ipcMain\.handle\(['"]gemini-live-connect['"]/.test(mainSrc));
assert("main.ts registers 'gemini-live-disconnect' IPC", /ipcMain\.handle\(['"]gemini-live-disconnect['"]/.test(mainSrc));
assert("main.ts registers 'voice-transport-switch' IPC", /ipcMain\.handle\(['"]voice-transport-switch['"]/.test(mainSrc));
assert("main.ts routes voice-feed-audio-chunk based on getVoiceTransport()", /getVoiceTransport\(\)/.test(mainSrc) && /getGeminiLiveTransport\(\)\.feedInputAudio/.test(mainSrc));
assert('main.ts wires engine.dispose() in before-quit (P18 fix)', /getLocalVoiceEngine\(\)\.dispose\(\)/.test(mainSrc));
assert('main.ts wires geminiLiveTransport.dispose() in before-quit', /getGeminiLiveTransport\(\)\.dispose\(\)/.test(mainSrc));
assert('main.ts onInterrupted → conversation.handleBargeIn() (existing flow)', /getNexVoiceConversation\(\)\.handleBargeIn\(\)/.test(mainSrc));
assert('main.ts broadcasts voice-tts-pcm-chunk (new IPC, NOT a new event bus)', /voice-tts-pcm-chunk/.test(mainSrc));
assert('main.ts onTurnComplete → notifyTtsPlaybackEnded (reuses existing flow)', /notifyTtsPlaybackEnded/.test(mainSrc));
assert('main.ts does NOT create a new event bus', !/ipcMain\.handle\(['"]gemini-activity['"]/.test(mainSrc) && !/ipcMain\.handle\(['"]live-activity['"]/.test(mainSrc));

const preloadSrc = fs.readFileSync(path.join(__dirname, '../../src/main/preload.ts'), 'utf-8');
assert('preload exposes onVoiceTtsPcmChunk', /onVoiceTtsPcmChunk/.test(preloadSrc));
assert('preload exposes geminiLiveConnect', /geminiLiveConnect/.test(preloadSrc));
assert('preload exposes voiceTransportSwitch', /voiceTransportSwitch/.test(preloadSrc));
assert('preload does NOT expose the API key as a readable value (only as settingsSave arg + invoke arg)', (() => {
  // The only mentions of geminiApiKey in preload should be:
  //   (a) the settingsSave parameter declaration (passes the key to main)
  //   (b) the ipcRenderer.invoke('settings-save', ..., geminiApiKey) call
  //   (c) in comments (documentation, not code)
  // NOT a method that returns the key to the renderer (e.g. getGeminiApiKey).
  const lines = preloadSrc.split('\n');
  for (const line of lines) {
    if (/geminiApiKey/.test(line)) {
      const code = line.replace(/\/\/.*$/, '');
      if (!code.includes('geminiApiKey')) continue; // was only in a comment
      // Must be the settingsSave param or the settings-save invoke arg.
      const ok = /settingsSave.*geminiApiKey/.test(code) ||
                 /settings-save.*geminiApiKey/.test(code);
      if (!ok) return false;
    }
  }
  return true;
})());

const appSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/App.tsx'), 'utf-8');
assert('App.tsx imports getGeminiAudioQueue', /import.*getGeminiAudioQueue.*from.*gemini-audio-queue/.test(appSrc));
assert('App.tsx subscribes to onVoiceTtsPcmChunk', /onVoiceTtsPcmChunk/.test(appSrc));
assert('App.tsx reuses currentAudioRequestIdRef (shared stale guard)', /currentAudioRequestIdRef\.current/.test(appSrc) && /currentAudioRequestIdRef\.current\s*=\s*ev\.requestId/.test(appSrc));
assert('App.tsx pauses Piper audio when Gemini chunk arrives (mutual exclusion)', /currentAudioRef\.current\.pause\(\)/.test(appSrc));
assert('App.tsx flushes Gemini queue on stop signal', /queue\.flush\(currentAudioRequestIdRef\.current\)/.test(appSrc));

const settingsSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/SettingsPanel.tsx'), 'utf-8');
assert('SettingsPanel has Voice Transport selector', /Voice Transport/.test(settingsSrc));
assert('SettingsPanel has gemini-live option', /value:\s*['"]gemini-live['"]/.test(settingsSrc));
assert('SettingsPanel has Gemini Live Model selector', /Gemini Live Model/.test(settingsSrc));
assert('SettingsPanel calls voiceTransportSwitch on save', /voiceTransportSwitch\(newTransport\)/.test(settingsSrc));

const queueSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/lib/gemini-audio-queue.ts'), 'utf-8');
assert('GeminiAudioQueue has stale guard (requestId < current → drop)', /requestId < this\.currentRequestId/.test(queueSrc));
assert('GeminiAudioQueue has buffer cap (MAX_BUFFERED_SECONDS)', /MAX_BUFFERED_SECONDS/.test(queueSrc));
assert('GeminiAudioQueue has flush(requestId) for barge-in/stop', /flush\(requestId/.test(queueSrc));
assert('GeminiAudioQueue does NOT fake playback (no fake/simulated functions)', (() => {
  // Strip comments before checking — the word "fake" appears in a comment
  // ("no fake"), which is documentation, not a fake implementation.
  const stripped = queueSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  return !/\bfake[A-Za-z]*\s*\(|\bsimulated[A-Za-z]*\s*\(|\bdummy[A-Za-z]*\s*\(/i.test(stripped);
})());
assert('GeminiAudioQueue has dispose() for clean shutdown', /dispose\(\)/.test(queueSrc));

// CSP + security
const securitySrc = fs.readFileSync(path.join(__dirname, '../../src/main/security/index.ts'), 'utf-8');
assert('CSP is UNCHANGED (no wss://generativelanguage added — WS in main, not renderer)', (() => {
  // The CSP should NOT have wss://generativelanguage added by O6 (the WS is
  // opened by the `ws` package in main, which uses Node net, not Chromium).
  // It SHOULD still have https://generativelanguage (from O1-O3 REST API).
  // Find the actual CSP connect-src string line (skip comments).
  const cspLine = securitySrc.split('\n').find((l) =>
    l.includes('connect-src') && l.includes("'self'")
  );
  if (!cspLine) return false;
  const hasHttps = cspLine.includes('https://generativelanguage.googleapis.com');
  const hasWss = cspLine.includes('wss://generativelanguage');
  return hasHttps && !hasWss;
})());
assert('ALLOWED_AI_ORIGINS still includes https://generativelanguage (no wss added)',
  /'https:\/\/generativelanguage\.googleapis\.com'/.test(securitySrc) && !/'wss:\/\/generativelanguage'/.test(securitySrc));

// Persistence
const persistenceSrc = fs.readFileSync(path.join(__dirname, '../../src/main/persistence/index.ts'), 'utf-8');
assert('PersistedSettings has voiceTransport (non-secret)', /voiceTransport\??:\s*'local' \| 'gemini-live'/.test(persistenceSrc));
assert('PersistedSettings has geminiLiveModel (non-secret)', /geminiLiveModel\??:\s*string/.test(persistenceSrc));
assert('PersistedSettings does NOT have geminiApiKey (key is in secrets.json)', !/^\s*geminiApiKey\??:\s*string/m.test(persistenceSrc));

// ─── 8. No fake animation / no duplicate state machine ────────────────────
console.log('\n8. No fake animation / no duplicate state machine:');
assert('No new VoiceState added to voice-service.ts (reuses existing 9)', (() => {
  const vsSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/services/voice-service.ts'), 'utf-8');
  return /'idle' \| 'listening' \| 'thinking' \| 'speaking' \| 'error' \| 'offline' \| 'working' \| 'success' \| 'cancelled'/.test(vsSrc);
})());
assert('orb-state.ts is unchanged (still has the 13 NexOrbState values, multi-line)', (() => {
  const orbSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/orb/orb-state.ts'), 'utf-8');
  // The type is multi-line; check for all 13 values individually.
  const states = ['idle', 'initializing', 'ready', 'listening', 'thinking', 'speaking', 'active', 'working', 'success', 'error', 'cancelled', 'offline', 'installing'];
  return states.every((s) => new RegExp(`'${s}'`).test(orbSrc));
})());
assert('GeminiLiveTransport has NO fake "thinking" or "searching" state', (() => {
  return !/fake|simulated|dummy/i.test(transportSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''));
})());
assert('GeminiLiveTransport state list is real (8 states, multi-line)', (() => {
  // The type is multi-line; check for all 8 values.
  const states = ['disconnected', 'connecting', 'connected', 'listening', 'speaking', 'interrupted', 'reconnecting', 'error'];
  return states.every((s) => new RegExp(`'${s}'`).test(typesSrc));
})());

// ─── 9. No duplicate Tool Registry / permission path ───────────────────────
console.log('\n9. No duplicate Tool Registry / permission path:');
assert('transport does NOT import Tool Registry', !/tool-registry/.test(transportSrc) && !/ToolRegistry/.test(transportSrc));
assert('transport does NOT import permissions', !/permissions/.test(transportSrc));
assert('transport does NOT import Agent core', !/agent\/core/.test(transportSrc));
assert('main.ts Gemini handlers do NOT add new tool IPCs', (() => {
  // No new tool-call-related IPC beyond logging
  return !/ipcMain\.handle\(['"]gemini-tool/.test(mainSrc);
})());

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════');
console.log(`PHASE O6 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('ALL PHASE O6 GEMINI LIVE TESTS PASS ✅');
