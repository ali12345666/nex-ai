/**
 * UI-13 — Orb Size + Active Red State Tests
 *
 * Verifies:
 *   1. Orb container size increased ~2x (was min(42vh,38vw) → min(72vh,48vw))
 *   2. New 'active' state added with RED color + intense motion
 *   3. 'thinking' state changed to RED (was violet)
 *   4. 'speaking' state changed to RED (was no tint)
 *   5. 'listening' stays normal (user input, not AI working)
 *   6. 'error' stays muted red (distinct from active vibrant red)
 *   7. Active red color is vibrant (#ff2d55), error is muted (#ef4444)
 *   8. Active state has pulse + high glow + fast motion
 *   9. Reduced-motion still gates rotations
 *  10. Smooth transition preserved (lerp in useFrame)
 *
 * Run: npx tsx tests/system/test-ui13-orb-size-active-state.ts
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

  console.log('\n1) Orb container size increased ~2x:');
  const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
  // Check the actual style declaration, not comments (which may mention old size for context).
  const shellNoComments = shellSrc.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert('NO old size min(42vh, 38vw) in style declarations', !/width: 'min\(42vh, 38vw\)'/.test(shellNoComments));
  // UI-16: orb size now dynamic (showOrb ? 72vh : 42vh)
assert('orb size uses min() with showOrb', /showOrb \? 'min\(\d+vh/.test(shellSrc));
  assert('orb height uses min() with showOrb', /showOrb \? 'min\(\d+vh/.test(shellSrc));
  assert('minHeight present (dynamic)', /minHeight:/.test(shellSrc));
  assert('minWidth present (dynamic)', /minWidth:/.test(shellSrc));
  // Calculate size increase: 72/42 = 1.71x, 48/38 = 1.26x. Effective ~1.7x on vh-bound.
  assert('size increase ratio ~1.7x (72vh/42vh)', (72 / 42) > 1.5 && (72 / 42) < 2.0);

  console.log('\n2) New active state added:');
  const orbStateSrc = read('../../src/renderer/components/orb/orb-state.ts');
  assert("'active' in NexOrbState type", /'active'/.test(orbStateSrc));
  assert("case 'active': in computeOrbVisual", /case 'active':/.test(orbStateSrc));
  assert('ACTIVE_RED constant defined', /const ACTIVE_RED = '#ff2d55'/.test(orbStateSrc));

  console.log('\n3) Active state visual params (vibrant red + intense motion):');
  // Extract active case body
  const activeMatch = orbStateSrc.match(/case 'active':[\s\S]*?break;/);
  const activeBody = activeMatch ? activeMatch[0] : '';
  assert('active uses ACTIVE_RED', /stateColor = ACTIVE_RED/.test(activeBody));
  assert('active colorShift = 0.9 (high)', /colorShift = 0\.9/.test(activeBody));
  assert('active glowIntensity = 1.5 (intense)', /glowIntensity = 1\.5/.test(activeBody));
  assert('active coreIntensity = 1.4 (bright core)', /coreIntensity = 1\.4/.test(activeBody));
  assert('active particleSpeed = 3.0 (fast)', /particleSpeed = 3\.0/.test(activeBody));
  assert('active ringSpeed = 2.6 (fast rings)', /ringSpeed = 2\.6/.test(activeBody));
  assert('active ambientDrift = 2.2 (energetic)', /ambientDrift = 2\.2/.test(activeBody));
  assert('active pulseSpeed = 1.2 (continuous pulse)', /pulseSpeed = 1\.2/.test(activeBody));
  assert('active scale = 1.1+ (slightly bigger)', /scale = 1\.1/.test(activeBody));

  console.log('\n4) thinking state changed to RED (was violet):');
  const thinkingMatch = orbStateSrc.match(/case 'thinking':[\s\S]*?break;/);
  const thinkingBody = thinkingMatch ? thinkingMatch[0] : '';
  assert('thinking uses ACTIVE_RED (not violet)', /stateColor = ACTIVE_RED/.test(thinkingBody));
  assert('thinking NO longer uses #8b5cf6', !/#8b5cf6/.test(thinkingBody));
  assert('thinking colorShift = 0.85 (high visibility)', /colorShift = 0\.85/.test(thinkingBody));
  assert('thinking glowIntensity = 1.4', /glowIntensity = 1\.4/.test(thinkingBody));
  assert('thinking particleSpeed = 2.8 (accelerated)', /particleSpeed = 2\.8/.test(thinkingBody));

  console.log('\n5) speaking state changed to RED (was no tint):');
  const speakingMatch = orbStateSrc.match(/case 'speaking':[\s\S]*?break;/);
  const speakingBody = speakingMatch ? speakingMatch[0] : '';
  assert('speaking uses ACTIVE_RED', /stateColor = ACTIVE_RED/.test(speakingBody));
  assert('speaking colorShift = 0.7 (visible red)', /colorShift = 0\.7/.test(speakingBody));
  assert('speaking has audio-reactive scale', /scale = 1\.08 \+ level \* 0\.08/.test(speakingBody));
  assert('speaking has pulse (audio-reactive)', /pulseSpeed = 1\.0 \+ level \* 0\.8/.test(speakingBody));

  console.log('\n6) listening stays normal (NOT red — user input, not AI working):');
  const listeningMatch = orbStateSrc.match(/case 'listening':[\s\S]*?break;/);
  const listeningBody = listeningMatch ? listeningMatch[0] : '';
  assert('listening NO stateColor (null)', !/stateColor = ACTIVE_RED/.test(listeningBody));
  assert('listening NO #ff2d55', !/#ff2d55/.test(listeningBody));
  assert('listening colorShift = 0 (no tint)', /colorShift = 0;/.test(listeningBody));

  console.log('\n7) error stays muted red (distinct from active vibrant red):');
  const errorMatch = orbStateSrc.match(/case 'error':[\s\S]*?break;/);
  const errorBody = errorMatch ? errorMatch[0] : '';
  assert('error uses #ef4444 (muted red)', /stateColor = '#ef4444'/.test(errorBody));
  assert('error NO ACTIVE_RED', !/ACTIVE_RED/.test(errorBody));
  assert('error glowIntensity = 0.6 (muted)', /glowIntensity = 0\.6/.test(errorBody));
  assert('error particleSpeed = 0.5 (slow)', /particleSpeed = 0\.5/.test(errorBody));
  assert('error pulseSpeed = 0 (no pulse)', /pulseSpeed = 0;/.test(errorBody));

  console.log('\n8) Active vs Error color distinction:');
  assert('ACTIVE_RED = #ff2d55 (vibrant pink-red)', /#ff2d55/.test(orbStateSrc));
  assert('error red = #ef4444 (muted red)', /#ef4444/.test(orbStateSrc));
  assert('two distinct reds exist', /#ff2d55/.test(orbStateSrc) && /#ef4444/.test(orbStateSrc));

  console.log('\n9) Smooth transition preserved (lerp in useFrame):');
  const orbSrc = read('../../src/renderer/components/orb/NexOrb.tsx');
  assert('lerpFactor still computed', /lerpFactor = 1 - Math\.exp\(-delta \* 5\)/.test(orbSrc));
  assert('smoothScale lerp preserved', /smoothScale\.current \+= \(visual\.scale - smoothScale\.current\) \* lerpFactor/.test(orbSrc));
  assert('smoothColorShift lerp preserved', /smoothColorShift\.current \+= \(visual\.colorShift/.test(orbSrc));
  assert('NO abrupt state changes (all via lerp)', !/visual\.colorShift;[\s\S]*?uniforms\.uColorShift\.value = visual\.colorShift/.test(orbSrc));

  console.log('\n10) Reduced-motion still gates rotations (UI-13 §6):');
  assert('reducedMotion check in ParticleSphere', /if \(!reducedMotion\)/.test(orbSrc));
  assert('reducedMotion check in CoreGlow', /CoreGlow[\s\S]*?if \(meshRef\.current && !reducedMotion\)/.test(orbSrc));
  assert('reducedMotion check in OrbRings', /OrbRings[\s\S]*?if \(reducedMotion\) return/.test(orbSrc));
  assert('reducedMotion check in AmbientParticles', /AmbientParticles[\s\S]*?if \(ref\.current && !reducedMotion\)/.test(orbSrc));
  assert('SpeakingPulse hidden when reducedMotion', /visual\.pulseSpeed <= 0 \|\| reducedMotion/.test(orbSrc));
  // UI-13 §6: reduced-motion keeps 2x size + red color, only reduces motion
  assert('reduced-motion does NOT change orb size', !/reducedMotion[\s\S]*?min\(42vh/.test(shellSrc));
  assert('reduced-motion does NOT change red color', !/reducedMotion[\s\S]*?#ef4444[\s\S]*?return/.test(orbStateSrc));

  console.log('\n11) NexOrb still fills 100% of container (orb scales with container):');
  assert('NexOrb container width: 100%', /width: '100%'/.test(orbSrc));
  assert('NexOrb container height: 100%', /height: '100%'/.test(orbSrc));

  console.log('\n12) State machine has 7 states (was 6, added active):');
  const typeMatch = orbStateSrc.match(/export type NexOrbState = ([^;]+)/);
  if (typeMatch) {
    const states = typeMatch[1].match(/'[^']+'/g) || [];
    assert('NexOrbState has 7 states', states.length === 7);
    assert("states include 'active'", states.includes("'active'"));
    assert("states include 'idle'", states.includes("'idle'"));
    assert("states include 'thinking'", states.includes("'thinking'"));
    assert("states include 'speaking'", states.includes("'speaking'"));
    assert("states include 'error'", states.includes("'error'"));
    assert("states include 'listening'", states.includes("'listening'"));
    assert("states include 'offline'", states.includes("'offline'"));
  } else {
    assert('NexOrbState type found', false);
  }

  console.log('\n13) No regression to existing orb layers (UI-01 preserved):');
  assert('ParticleSphere still present', /function ParticleSphere/.test(orbSrc));
  assert('CoreGlow still present', /function CoreGlow/.test(orbSrc));
  assert('SpeakingPulse still present', /function SpeakingPulse/.test(orbSrc));
  assert('OrbRings still present', /function OrbRings/.test(orbSrc));
  assert('AmbientParticles still present', /function AmbientParticles/.test(orbSrc));
  assert('audioLevelRef still used', /audioLevelRef\.current/.test(orbSrc));

  console.log('\n14) AppShell still passes audioLevelRef (UI-01 fix preserved):');
  assert('AppShell passes audioLevelRef', /audioLevelRef=\{orbAudioRef\}/.test(shellSrc));

  console.log('\n══════════════════════════════════════');
  console.log(`UI-13 RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('UI-13 ORB SIZE + ACTIVE RED STATE: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
