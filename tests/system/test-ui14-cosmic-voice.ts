/**
 * UI-14 — Cosmic Dynamic Orb + Minimal Header + Always-Ready Voice Tests
 *
 * Verifies:
 *   §2: Header compact (smaller text, less margin)
 *   §3: Voice toggle button removed, auto-start on boot
 *   §4: Self-hearing prevention (STT paused during TTS, resumed after)
 *   §6: Rings made more subtle (no solid white lines)
 *   §7-§9: Particle cohesion/dispersion/turbulence params exist
 *   §11: 17+ color palette (deterministic, not random)
 *   §12: computeOrbVisual extended with new params
 *   §16: Reduced-motion preserved
 *
 * Run: npx tsx tests/system/test-ui14-cosmic-voice.ts
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

  console.log('\n1) §2 Header minimalization:');
  const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
  // Strip comments before checking (UI-14 comments mention old values for context).
  // Strip both // comments, /* */ comments, and JSX {/* */} comments.
  const shellNoComments = shellSrc
    .split('\n')
    .filter(l => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('*') && !t.startsWith('{/*');
    })
    .join('\n');
  assert('NO text-4xl in branding (code, not comments)', !/text-4xl/.test(shellNoComments));
  assert('NO text-5xl in branding (code, not comments)', !/text-5xl/.test(shellNoComments));
  assert('NO text-6xl in branding (code, not comments)', !/text-6xl/.test(shellNoComments));
  // UI-16: simplified to text-sm
assert('compact text-sm used', /text-sm/.test(shellSrc));
  assert('mb-8 reduced to mb-2 (code, not comments)', !/mb-8/.test(shellNoComments) && /mb-2/.test(shellSrc));
  assert('NO subtitle text (UI-16 removed)', !/LOCAL INTELLIGENCE/.test(shellSrc));
  assert('NO subtitle (UI-16 minimal)', !/ALWAYS READY/.test(shellSrc));
  assert('NO ALWAYS READY subtitle (UI-16 minimal)', !/ALWAYS READY/.test(shellSrc));
  assert('title says NEX AI (not N E X)', /NEX AI/.test(shellSrc) && !/>N E X</.test(shellSrc));

  console.log('\n2) §3 Voice toggle button removed:');
  assert('NO voice toggle button onClick', !/voiceController\.toggle\(\)/.test(shellNoComments));
  assert('NO voiceActive state (code, not comments)', !/voiceActive/.test(shellNoComments));
  assert('NO LISTENING/VOICE button text', !/'LISTENING' : 'VOICE'/.test(shellSrc));
  assert('NO aria-label Stop voice input', !/Stop voice input/.test(shellSrc));

  console.log('\n3) §3 Always-Ready Voice — auto-start on boot:');
  assert('voiceController.start() called in useEffect', /voiceController\.start\(\)/.test(shellSrc));
  assert('start called with .catch() for permission denial', /voiceController\.start\(\)\.catch/.test(shellSrc));
  assert('UI-14 §3 comment present', /UI-14 §3:.*Always-Ready Voice/.test(shellSrc));

  console.log('\n4) §4 Self-hearing prevention (TTS pauses STT):');
  const voiceSrc = read('../../src/renderer/services/voice-service.ts');
  assert('speak() pauses STT if active', /if \(this\._sttActive\) \{[\s\S]*?this\.stopSTT\(\)/.test(voiceSrc));
  assert('speak() keeps _shouldRestartSTT true', /this\._shouldRestartSTT = true;[\s\S]*?window\.speechSynthesis\.speak/.test(voiceSrc));
  assert('utterance.onend resumes listening', /utterance\.onend = \(\) => \{[\s\S]*?if \(this\._shouldRestartSTT && !this\._sttActive\)/.test(voiceSrc));
  assert('utterance.onerror resumes listening', /utterance\.onerror = \(\) => \{[\s\S]*?if \(this\._shouldRestartSTT && !this\._sttActive\)/.test(voiceSrc));
  assert('UI-14 §4 comment present', /UI-14 §4:.*self-hearing/.test(voiceSrc));

  console.log('\n5) §4 Voice safety — audio constraints:');
  assert('echoCancellation enabled', /echoCancellation: true/.test(voiceSrc));
  assert('noiseSuppression enabled', /noiseSuppression: true/.test(voiceSrc));
  assert('autoGainControl enabled', /autoGainControl: true/.test(voiceSrc));

  console.log('\n6) §7-§9 Particle cohesion/dispersion/turbulence params:');
  const orbStateSrc = read('../../src/renderer/components/orb/orb-state.ts');
  assert('cohesion field in NexOrbVisual', /cohesion: number/.test(orbStateSrc));
  assert('dispersion field in NexOrbVisual', /dispersion: number/.test(orbStateSrc));
  assert('turbulence field in NexOrbVisual', /turbulence: number/.test(orbStateSrc));
  assert('waveAmplitude field in NexOrbVisual', /waveAmplitude: number/.test(orbStateSrc));
  assert('waveFrequency field in NexOrbVisual', /waveFrequency: number/.test(orbStateSrc));
  assert('particleScale field in NexOrbVisual', /particleScale: number/.test(orbStateSrc));
  assert('opacity field in NexOrbVisual', /opacity: number/.test(orbStateSrc));
  assert('corePulse field in NexOrbVisual', /corePulse: number/.test(orbStateSrc));
  // Per-state values
  assert('idle has high cohesion (0.9)', /case 'idle'[\s\S]*?cohesion = 0\.9/.test(orbStateSrc));
  assert('active has low cohesion (0.4)', /case 'active'[\s\S]*?cohesion = 0\.4/.test(orbStateSrc));
  assert('active has high dispersion (0.7)', /case 'active'[\s\S]*?dispersion = 0\.7/.test(orbStateSrc));
  assert('thinking has high turbulence (0.6)', /case 'thinking'[\s\S]*?turbulence = 0\.6/.test(orbStateSrc));
  assert('idle has low turbulence (0.05)', /case 'idle'[\s\S]*?turbulence = 0\.05/.test(orbStateSrc));

  console.log('\n7) §11 17+ color palette (deterministic):');
  assert('STATE_COLOR_PALETTE exported', /export const STATE_COLOR_PALETTE/.test(orbStateSrc));
  assert('FULL_COLOR_PALETTE exported', /export const FULL_COLOR_PALETTE/.test(orbStateSrc));
  // Count colors in FULL_COLOR_PALETTE
  const paletteMatch = orbStateSrc.match(/export const FULL_COLOR_PALETTE = \[([\s\S]*?)\]/);
  if (paletteMatch) {
    const colorCount = (paletteMatch[1].match(/#[0-9a-f]{6}/gi) || []).length;
    assert('FULL_COLOR_PALETTE has 17 colors', colorCount === 17, `found ${colorCount}`);
  } else {
    assert('FULL_COLOR_PALETTE found', false);
  }
  assert('NO Math.random for color selection', !/Math\.random.*color|color.*Math\.random/.test(orbStateSrc));
  assert('colors are deterministic (state-keyed)', /STATE_COLOR_PALETTE: Record<NexOrbState, string>/.test(orbStateSrc));
  // Verify specific state→color mappings per directive §11
  const paletteSrc = orbStateSrc;
  assert('idle → Cyan', /idle: '#00e5ff'/.test(paletteSrc));
  assert('listening → Blue', /listening: '#3b82f6'/.test(paletteSrc));
  assert('thinking → Violet', /thinking: '#8b5cf6'/.test(paletteSrc));
  assert('speaking → Magenta/Pink', /speaking: '#ec4899'/.test(paletteSrc));
  assert('active → Red', /active: '#ff2d55'/.test(paletteSrc));
  assert('error → muted Red', /error: '#ef4444'/.test(paletteSrc));

  console.log('\n8) §12 computeOrbVisual returns new params:');
  const visualMatch = orbStateSrc.match(/return \{[\s\S]*?\};/);
  if (visualMatch) {
    const ret = visualMatch[0];
    assert('return has cohesion', /cohesion,/.test(ret));
    assert('return has dispersion', /dispersion,/.test(ret));
    assert('return has turbulence', /turbulence,/.test(ret));
    assert('return has waveAmplitude', /waveAmplitude,/.test(ret));
    assert('return has waveFrequency', /waveFrequency,/.test(ret));
    assert('return has particleScale', /particleScale,/.test(ret));
    assert('return has opacity', /opacity,/.test(ret));
    assert('return has corePulse', /corePulse,/.test(ret));
  }

  console.log('\n9) §7-§9 Shader uniforms for cohesion/dispersion/turbulence:');
  const orbSrc = read('../../src/renderer/components/orb/NexOrb.tsx');
  assert('uCohesion uniform declared', /uCohesion:/.test(orbSrc));
  assert('uDispersion uniform declared', /uDispersion:/.test(orbSrc));
  assert('uTurbulence uniform declared', /uTurbulence:/.test(orbSrc));
  assert('uWaveAmplitude uniform declared', /uWaveAmplitude:/.test(orbSrc));
  assert('uWaveFrequency uniform declared', /uWaveFrequency:/.test(orbSrc));
  assert('uParticleScale uniform declared', /uParticleScale:/.test(orbSrc));
  assert('uOpacity uniform declared', /uOpacity:/.test(orbSrc));
  assert('uCorePulse uniform declared', /uCorePulse:/.test(orbSrc));
  // Verify uniforms set in useFrame
  assert('uCohesion set in useFrame', /uniforms\.uCohesion\.value = visual\.cohesion/.test(orbSrc));
  assert('uDispersion set in useFrame', /uniforms\.uDispersion\.value = visual\.dispersion/.test(orbSrc));
  assert('uTurbulence set in useFrame', /uniforms\.uTurbulence\.value = visual\.turbulence/.test(orbSrc));
  assert('uWaveAmplitude set in useFrame', /uniforms\.uWaveAmplitude\.value = visual\.waveAmplitude/.test(orbSrc));
  assert('uOpacity set in useFrame', /uniforms\.uOpacity\.value = visual\.opacity/.test(orbSrc));

  console.log('\n10) §7 Vertex shader uses new uniforms:');
  assert('vertex shader declares uCohesion', /uniform float uCohesion;/.test(orbSrc));
  assert('vertex shader declares uDispersion', /uniform float uDispersion;/.test(orbSrc));
  assert('vertex shader declares uTurbulence', /uniform float uTurbulence;/.test(orbSrc));
  assert('vertex shader declares uWaveAmplitude', /uniform float uWaveAmplitude;/.test(orbSrc));
  assert('vertex shader declares uWaveFrequency', /uniform float uWaveFrequency;/.test(orbSrc));
  assert('vertex shader declares uParticleScale', /uniform float uParticleScale;/.test(orbSrc));
  assert('shader uses uWaveAmplitude in wave calc', /uWaveAmplitude/.test(orbSrc));
  assert('shader uses uWaveFrequency in wave calc', /uWaveFrequency/.test(orbSrc));
  assert('shader uses uTurbulence for noise', /uTurbulence \* 0\.1/.test(orbSrc));
  assert('shader uses uCohesion for cohesionFactor', /cohesionFactor = mix/.test(orbSrc));
  assert('shader uses uParticleScale for point size', /uParticleScale/.test(orbSrc));

  console.log('\n11) §6 Rings made more subtle (translucent, not solid):');
  assert('OrbRings uses transparent material', /transparent/.test(orbSrc));
  assert('OrbRings uses depthWrite false', /depthWrite=\{false\}/.test(orbSrc) || /depthWrite: false/.test(orbSrc));
  assert('OrbRings opacity is low (0.3 or less)', /opacity=\{0\.3\}/.test(orbSrc) || /opacity=\{0\.15\}/.test(orbSrc));
  assert('OrbRings uses AdditiveBlending (not solid white)', /AdditiveBlending/.test(orbSrc));

  console.log('\n12) §16 Reduced-motion preserved:');
  assert('reducedMotion handler exists', /prefers-reduced-motion/.test(orbSrc));
  assert('rotation gated behind reducedMotion', /if \(!reducedMotion\)/.test(orbSrc));
  assert('orb size NOT affected by reducedMotion', !/reducedMotion[\s\S]*?min\(42vh/.test(shellSrc));

  console.log('\n13) §15 WebGL disposal preserved:');
  assert('geometry dispose on unmount', /geometry\?\.dispose\(\)/.test(orbSrc));
  assert('material dispose on unmount', /materialRef\.current\.dispose\?\.(\(\))/.test(orbSrc));

  console.log('\n14) §13 Orb size still ~2x (from UI-13):');
  assert('orb size min() responsive', /min\(\d+vh, \d+vw\)/.test(shellSrc));

  console.log('\n15) No regression to existing orb layers:');
  assert('ParticleSphere still present', /function ParticleSphere/.test(orbSrc));
  assert('CoreGlow still present', /function CoreGlow/.test(orbSrc));
  assert('SpeakingPulse still present', /function SpeakingPulse/.test(orbSrc));
  assert('OrbRings still present', /function OrbRings/.test(orbSrc));
  assert('AmbientParticles still present', /function AmbientParticles/.test(orbSrc));
  assert('audioLevelRef still used', /audioLevelRef\.current/.test(orbSrc));

  console.log('\n16) §3 Voice auto-restart infrastructure (VoiceService):');
  assert('_shouldRestartSTT flag exists', /_shouldRestartSTT/.test(voiceSrc));
  assert('startListening sets _shouldRestartSTT = true', /startListening[\s\S]*?this\._shouldRestartSTT = true/.test(voiceSrc));
  assert('onend handler restarts STT', /recognition\.onend = \(\) => \{[\s\S]*?if \(this\._shouldRestartSTT\)/.test(voiceSrc));
  assert('STT restart uses setTimeout (debounce)', /setTimeout\(\(\) => \{[\s\S]*?this\.startSTT\(\)/.test(voiceSrc));

  console.log('\n══════════════════════════════════════');
  console.log(`UI-14 RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('UI-14 COSMIC DYNAMIC ORB + ALWAYS-READY VOICE: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
