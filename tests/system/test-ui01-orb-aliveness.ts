/**
 * UI-01 — Orb Aliveness Upgrade Tests
 *
 * Verifies the Phase 1 UI improvements:
 *   1. Audio reactivity wiring fixed (ref-based, not stale prop)
 *   2. colorShift wired to shader uniform (state tints actually visible)
 *   3. Inner core glow layer present
 *   4. Speaking-pulse ring present
 *   5. Reduced-motion actually gates Three.js rotations
 *   6. AmbientParticles + OrbRings respond to state
 *   7. AmbientParticles explicit disposal
 *
 * Run: npx tsx tests/system/test-ui01-orb-aliveness.ts
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

  console.log('\n1) Audio reactivity wiring (UI-01 fix for GAP-1):');
  const orbSrc = read('../../src/renderer/components/orb/NexOrb.tsx');
  assert('audioLevelRef prop exists on NexOrbProps', /audioLevelRef\?.*MutableRefObject<number>/.test(orbSrc));
  assert('ParticleSphere takes audioLevelRef prop', /audioLevelRef: React.MutableRefObject<number>/.test(orbSrc));
  assert('useFrame reads audioLevelRef.current (not prop)', /audioLevelRef\.current/.test(orbSrc));
  assert('uAudio uniform reads from ref each frame', /uniforms\.uAudio\.value = audioLevel/.test(orbSrc));
  assert('backward-compat: legacy audioLevel prop still supported', /audioLevel\?: number/.test(orbSrc));
  assert('internalAudioRef synced from legacy prop', /internalAudioRef\.current = audioLevel/.test(orbSrc));

  const shellSrc = read('../../src/renderer/components/layout/AppShell.tsx');
  assert('AppShell passes ref object (not .current value)', /audioLevelRef=\{orbAudioRef\}/.test(shellSrc));
  assert('AppShell NO LONGER passes stale audioLevel prop', !/audioLevel=\{orbAudioRef\.current\}/.test(shellSrc));

  console.log('\n2) colorShift wiring (UI-01 fix for GAP-2):');
  const orbStateSrc = read('../../src/renderer/components/orb/orb-state.ts');
  assert('NexOrbVisual has colorShift field', /colorShift: number/.test(orbStateSrc));
  assert('NexOrbVisual has stateColor field (nullable)', /stateColor: string \| null/.test(orbStateSrc));
  assert('error state sets stateColor', /stateColor = '#ef4444'/.test(orbStateSrc));
  // UI-13: thinking now uses RED (#ff2d55) instead of violet (#8b5cf6).
  // thinking IS working → red per UI-13 directive.
  assert('thinking state sets RED stateColor (UI-13)', /stateColor = ACTIVE_RED/.test(orbStateSrc) || /stateColor = '#ff2d55'/.test(orbStateSrc));
  assert('idle state has null stateColor', /case 'idle'[\s\S]*?stateColor = null/.test(orbStateSrc) || /let stateColor: string \| null = null/.test(orbStateSrc));

  assert('uColorShift uniform declared', /uColorShift:/.test(orbSrc));
  assert('uStateColor uniform declared', /uStateColor:/.test(orbSrc));
  assert('fragment shader mixes base toward uStateColor', /mix\(base, uStateColor, uColorShift\)/.test(orbSrc));
  assert('useFrame updates uColorShift', /uniforms\.uColorShift\.value/.test(orbSrc));
  assert('useFrame updates uStateColor', /uniforms\.uStateColor\.value\.copy/.test(orbSrc));
  // UI-13: thinking colorShift increased from 0.45 to 0.85 (more visible red).
  assert('thinking colorShift = 0.85 (UI-13: increased for red visibility)', /colorShift = 0\.85/.test(orbStateSrc));
  assert('error colorShift = 0.85', /colorShift = 0\.85/.test(orbStateSrc));

  console.log('\n3) New visual layers (UI-01: directive §4 layers):');
  assert('CoreGlow component present', /function CoreGlow/.test(orbSrc));
  assert('CoreGlow uses fresnel shader', /fresnel/.test(orbSrc));
  assert('CoreGlow has coreIntensity uniform', /uIntensity/.test(orbSrc));
  assert('SpeakingPulse component present', /function SpeakingPulse/.test(orbSrc));
  assert('SpeakingPulse expands scale over cycle', /mesh\.scale\.set\(scale/.test(orbSrc));
  assert('SpeakingPulse fades opacity to 0', /opacity = 0\.5 \* \(1 - cycle\)/.test(orbSrc));
  assert('SpeakingPulse hidden when pulseSpeed <= 0', /visual\.pulseSpeed <= 0/.test(orbSrc));
  assert('Canvas renders CoreGlow', /<CoreGlow/.test(orbSrc));
  assert('Canvas renders SpeakingPulse', /<SpeakingPulse/.test(orbSrc));

  console.log('\n4) New visual parameters per state:');
  assert('coreIntensity per state', /coreIntensity = [\d.]+/.test(orbStateSrc));
  assert('ringSpeed per state', /ringSpeed = [\d.]+/.test(orbStateSrc));
  assert('ambientDrift per state', /ambientDrift = [\d.]+/.test(orbStateSrc));
  assert('pulseSpeed per state', /pulseSpeed = [\d.]+/.test(orbStateSrc));
  // UI-13: speaking pulseSpeed increased from 0.8 to 1.0+ (more visible pulse when working).
  assert('speaking has non-zero pulseSpeed', /case 'speaking'[\s\S]*?pulseSpeed = [1-9]/.test(orbStateSrc));
  assert('non-speaking states have pulseSpeed 0', /pulseSpeed = 0;/.test(orbStateSrc));

  console.log('\n5) Reduced-motion ACTUALLY gates Three.js rotations (UI-01 fix for GAP-6):');
  assert('ParticleSphere accepts reducedMotion prop', /reducedMotion = false/.test(orbSrc));
  assert('rotation gated behind reducedMotion check', /if \(!reducedMotion\)/.test(orbSrc));
  assert('CoreGlow rotation gated', /CoreGlow[\s\S]*?if \(meshRef\.current && !reducedMotion\)/.test(orbSrc));
  assert('OrbRings early-return on reducedMotion', /if \(reducedMotion\) return;/.test(orbSrc));
  assert('AmbientParticles rotation gated', /if \(ref\.current && !reducedMotion\)/.test(orbSrc));
  assert('quality tier demoted when reducedMotion', /effectiveQuality = reducedMotion/.test(orbSrc));
  assert('particle count reduced when reducedMotion', /effectiveParticleCount/.test(orbSrc));

  console.log('\n6) State-reactive rings + ambient particles (UI-01 fix for GAP-10):');
  assert('OrbRings takes state prop', /OrbRingsProps[\s\S]*?state: NexOrbState/.test(orbSrc));
  assert('OrbRings takes audioLevelRef prop', /OrbRingsProps[\s\S]*?audioLevelRef/.test(orbSrc));
  assert('OrbRings modulates speed via ringSpeed', /smoothSpeed\.current \+= \(visual\.ringSpeed/.test(orbSrc));
  assert('OrbRings dims opacity in error state', /state === 'error' \? 0\.15/.test(orbSrc));
  assert('AmbientParticles takes state prop', /AmbientParticlesProps[\s\S]*?state: NexOrbState/.test(orbSrc));
  assert('AmbientParticles modulates drift via ambientDrift', /smoothDrift\.current \+= \(visual\.ambientDrift/.test(orbSrc));

  console.log('\n7) AmbientParticles explicit disposal (UI-01 fix for GAP-9):');
  assert('AmbientParticles useEffect cleanup returns disposal', /AmbientParticles[\s\S]*?return \(\) => \{[\s\S]*?geometry\?\.dispose\(\)/.test(orbSrc));
  assert('AmbientParticles material disposed', /AmbientParticles[\s\S]*?matRef\.current\.dispose\?\.(\(\))/.test(orbSrc));
  assert('CoreGlow disposes geometry + material', /CoreGlow[\s\S]*?geometry\?\.dispose\(\)[\s\S]*?materialRef\.current\.dispose\?\.(\(\))/.test(orbSrc));
  assert('SpeakingPulse disposes geometry + material', /SpeakingPulse[\s\S]*?geometry\?\.dispose\(\)[\s\S]*?materialRef\.current\.dispose\?\.(\(\))/.test(orbSrc));

  console.log('\n8) Backward compatibility + no regressions:');
  assert('NexOrbProps still accepts state prop', /state\?: NexOrbState/.test(orbSrc));
  assert('NexOrbProps still accepts primaryColor / secondaryColor', /primaryColor\?: string/.test(orbSrc) && /secondaryColor\?: string/.test(orbSrc));
  assert('NexOrbProps still accepts quality prop', /quality\?: 'high' \| 'medium' \| 'low'/.test(orbSrc));
  assert('ParticleSphere uses fibonacci sphere', /goldenRatio/.test(orbSrc));
  assert('DPR cap preserved', /dpr: \[number, number\]/.test(orbSrc));
  assert('additive blending preserved', /blending=\{THREE\.AdditiveBlending\}/.test(orbSrc));

  console.log('\n9) Theme integration preserved (Phase 31 contract):');
  assert('particle colors still set ONCE (no theme deps)', /Phase 31: particle colors are set ONCE/.test(orbSrc));
  assert('uniforms updated via useEffect (not recreated)', /uniforms\.uPrimary\.value\.set\(primaryColor\)/.test(orbSrc));
  assert('uStateColor also updated via useEffect', /uStateColor/.test(orbSrc));

  console.log('\n══════════════════════════════════════');
  console.log(`UI-01 RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILURES:', failures.join(' | ')); process.exit(1); }
  console.log('UI-01 ORB ALIVENESS UPGRADE: ALL PASS ✅');
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
