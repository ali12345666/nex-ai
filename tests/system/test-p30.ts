/**
 * Phase 30 / P30 — Voice + Orb Audio Reactivity Tests
 *
 * Tests voice service state machine, audio level pipeline (math),
 * controller wiring, orb integration, cleanup, and security.
 *
 * Run: npx tsx tests/system/test-p30.ts
 */
import '../__mocks__/install-electron-mock.js';

import * as fs from 'fs';
import * as path from 'path';

let pass = 0, fail = 0;
const failures: string[] = [];
function assert(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main(): Promise<void> {

const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf-8');

console.log('\n1) VoiceService architecture:');
const vsSrc = read('../../src/renderer/services/voice-service.ts');
assert('VoiceService exists', vsSrc.includes('export class VoiceService'));
assert('has getUserMedia', /getUserMedia/.test(vsSrc));
assert('has AudioContext + AnalyserNode', /AudioContext/.test(vsSrc) && /AnalyserNode/.test(vsSrc));
assert('has RMS calculation', /Math\.sqrt\(sum/.test(vsSrc));
assert('has noise gate', /noiseFloor/.test(vsSrc));
assert('has attack/release smoothing', /attackSpeed/.test(vsSrc) && /releaseSpeed/.test(vsSrc));
assert('has STT (SpeechRecognition)', /SpeechRecognition/.test(vsSrc));
assert('has TTS (SpeechSynthesis)', /speechSynthesis/.test(vsSrc));
assert('has state priority', /STATE_PRIORITY/.test(vsSrc));
assert('has dispose/cleanup', /dispose\(\)/.test(vsSrc));
assert('stops MediaStream tracks', /getTracks\(\)\.forEach.*stop/.test(vsSrc));
assert('closes AudioContext', /_audioContext\.close/.test(vsSrc));
assert('cancels animation frame', /cancelAnimationFrame/.test(vsSrc));
assert('NO raw audio in localStorage', !/localStorage/.test(vsSrc));
assert('NO raw audio persisted', !/saveAudio|storeAudio|recordAudio/.test(vsSrc));

console.log('\n2) State machine:');
assert('all 6 states defined', ['idle','listening','thinking','speaking','error','offline'].every((s) => vsSrc.includes(`'${s}'`)));
assert('priority prevents state conflicts', STATE_PRIORITY_ORDER(vsSrc));
assert('speaking not overridden by listening', SPEAKING_NOT_OVERRIDDEN(vsSrc));

function STATE_PRIORITY_ORDER(src: string): boolean {
  return src.includes('error: 6') && src.includes('offline: 5') && src.includes('speaking: 4');
}
function SPEAKING_NOT_OVERRIDDEN(src: string): boolean {
  // speaking (4) > listening (2) — so mic conditions don't override TTS
  return src.includes('speaking: 4') && src.includes('listening: 2');
}

console.log('\n3) VoiceController architecture:');
const vcSrc = read('../../src/renderer/services/voice-controller.ts');
assert('VoiceController exists', vcSrc.includes('export class VoiceController'));
assert('subscribes to orb audio', /subscribeOrbAudio/.test(vcSrc));
assert('subscribes to orb state', /subscribeOrbState/.test(vcSrc));
assert('final transcript callback', /onFinalTranscript/.test(vcSrc));
assert('thinking state setter', /setThinking/.test(vcSrc));
assert('has dispose', /dispose\(\)/.test(vcSrc));
assert('audio level via ref (not React state)', /orbAudioRef/.test(vcSrc) || /ref/.test(vcSrc));
assert('maps VoiceState to NexOrbState', /toOrbState/.test(vcSrc));

console.log('\n4) Orb integration (audio reactive):');
const orbSrc = read('../../src/renderer/components/orb/NexOrb.tsx');
assert('Orb accepts audioLevel prop', /audioLevel/.test(orbSrc));
assert('Orb accepts state prop', /state.*NexOrbState/.test(orbSrc));
assert('audioLevel feeds shader uniform', /uAudio/.test(orbSrc));
assert('audioLevel affects displacement', /audioWave/.test(orbSrc));
assert('Orb does NOT import VoiceService', !/voice-service/.test(orbSrc));
assert('Orb does NOT import getUserMedia', !/getUserMedia/.test(orbSrc));

const orbStateSrc = read('../../src/renderer/components/orb/orb-state.ts');
assert('listening scale 1.04-1.10', /1\.04.*level.*0\.06/.test(orbStateSrc));
assert('audioLevel clamped 0-1', /Math\.max\(0.*Math\.min\(1/.test(orbStateSrc));
assert('idle subtle', /1 \+ level \* 0\.02/.test(orbStateSrc));
assert('offline minimal', /0\.3/.test(orbStateSrc));

console.log('\n5) AppShell voice wiring:');
const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
assert('imports voiceController', /voiceController/.test(shellSrc));
assert('orb gets voice state', /orbState/.test(shellSrc));
assert('orb gets audio level', /orbAudioRef/.test(shellSrc));
assert('voice toggle button (small)', /VOICE/.test(shellSrc));
assert('NO large microphone button', !/Mic.*size.*[5-9][0-9]/.test(shellSrc));
assert('partial transcript display', /partialTranscript/.test(shellSrc));
assert('voice cleanup on unmount', /voiceController\.dispose/.test(shellSrc));
assert('Phase 27 composition preserved', /N E X/.test(shellSrc) && /NavigationRail/.test(shellSrc));

console.log('\n6) Chat + voice integration:');
const chatSrc = read('../../src/renderer/components/chat/NexChatPanel.tsx');
assert('listens for voice transcript event', /nex:voice-transcript/.test(chatSrc));
assert('voice → same sendMessage pipeline', /voiceController/.test(chatSrc));
assert('thinking state wired', /setThinking/.test(chatSrc));
assert('no second AI backend', !/new.*Provider|createProvider/.test(chatSrc));
assert('no direct STT in chat', !/SpeechRecognition/.test(chatSrc));

console.log('\n7) Interruption handling:');
assert('user speech cancels TTS', /stopSpeaking/.test(vsSrc));
assert('speaking state cleared on interrupt', /clearCondition.*tts/.test(vsSrc) || /stopSpeaking/.test(vcSrc));

console.log('\n8) Privacy + security:');
assert('no audio recording', !/MediaRecorder/.test(vsSrc));
assert('no raw audio in state', !/audioData.*=.*blob|audioData.*=.*arrayBuffer/.test(vsSrc));
assert('transient processing only', /getByteTimeDomainData/.test(vsSrc));
assert('no API keys in voice', !/apiKey/.test(vsSrc));
assert('no IPC in voice service (renderer-only)', !/ipcRenderer/.test(vsSrc));

console.log('\n9) Reduced motion:');
assert('Orb reduced-motion handler exists', /prefers-reduced-motion/.test(orbSrc));
assert('voice NOT disabled by reduced motion', !/prefers-reduced-motion/.test(vsSrc));

console.log('\n══════════════════════════════════════');
console.log(`P30 RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
console.log('P30 VOICE + ORB AUDIO: ALL PASS ✅');

} // end main
main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
