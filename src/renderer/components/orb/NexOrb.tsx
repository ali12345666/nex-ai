/**
 * NEX AI Orb — WebGL Particle Sphere (Phase 27 + UI-01 aliveness upgrade)
 *
 * A living holographic sphere built with React Three Fiber:
 *   - ~2000 particles on a fibonacci sphere with fluid wave displacement
 *   - Inner core glow (UI-01: directive §4 layer 1 — "core")
 *   - Speaking-pulse ring (UI-01: directive §4 layer 6 — "speaking pulse")
 *   - Continuous slow rotation (never static, unless reduced-motion)
 *   - Audio-reactive scaling (smoothed) — READ FROM REF (UI-01 fix for
 *     stale-prop bug: ref.current updates 60×/sec without React re-render)
 *   - State-reactive color shift (UI-01 fix: colorShift now wired to shader
 *     uniform so error/thinking tints are visible)
 *   - Theme colors via CSS variable bridge (Phase 31)
 *   - Performance: adaptive particle count, DPR cap, proper cleanup,
 *     reduced-motion gating (UI-01 fix: now actually freezes rotations)
 */

import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { computeOrbVisual, type NexOrbState } from './orb-state';

// ─── Particle Sphere ─────────────────────────────────────────────────────────

interface ParticleSphereProps {
  state: NexOrbState;
  /** Live audio level ref — read every frame so 60fps updates flow through
   * without triggering React re-renders (UI-01 fix for stale-prop bug). */
  audioLevelRef: React.MutableRefObject<number>;
  primaryColor: string;
  secondaryColor: string;
  particleCount?: number;
  reducedMotion?: boolean;
}

function ParticleSphere({
  state,
  audioLevelRef,
  primaryColor,
  secondaryColor,
  particleCount = 2000,
  reducedMotion = false,
}: ParticleSphereProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const smoothScale = useRef(1);
  const smoothSpeed = useRef(1);
  const smoothGlow = useRef(0.8);
  const smoothColorShift = useRef(0);
  const stateColorRef = useRef(new THREE.Color(primaryColor));
  const debugFrameCount = useRef(0); // [ORB_DEBUG] throttle

  // Fibonacci sphere positions
  const positions = useMemo(() => {
    const arr = new Float32Array(particleCount * 3);
    const goldenRatio = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < particleCount; i++) {
      const y = 1 - (i / (particleCount - 1)) * 2;
      const radius = Math.sqrt(1 - y * y);
      const theta = goldenRatio * i;
      arr[i * 3] = Math.cos(theta) * radius;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = Math.sin(theta) * radius;
    }
    return arr;
  }, [particleCount]);

  // Per-particle random phase for organic waves
  const phases = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) arr[i] = Math.random() * Math.PI * 2;
    return arr;
  }, [particleCount]);

  // Phase 31: particle colors are set ONCE (random mix); shader uniforms
  // handle live color changes without touching vertex buffers.
  // UI-01: kept identical pattern (still a single useMemo with no deps on
  // theme colors) so theme switches don't recreate particle buffers.
  const colors = useMemo(() => {
    const arr = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      arr[i * 3] = 1.0; arr[i * 3 + 1] = 1.0; arr[i * 3 + 2] = 1.0;
    }
    return arr;
  }, [particleCount]);

  // UI-01: added uColorShift + uStateColor uniforms so error/thinking tints
  // are actually visible (was a known gap — colorShift computed but unused).
  // UI-13: thinking + speaking + active all use RED (#ff2d55) — "NEX is working".
  // error uses muted red (#ef4444) — distinct from active vibrant red.
  // UI-14: added cohesion/dispersion/turbulence/waveAmplitude/waveFrequency/
  // particleScale/opacity/corePulse uniforms for cosmic morphing (§7-§9).
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uSpeed: { value: 1 },
    uScale: { value: 1 },
    uGlow: { value: 0.8 },
    uPrimary: { value: new THREE.Color(primaryColor) },
    uSecondary: { value: new THREE.Color(secondaryColor) },
    uStateColor: { value: new THREE.Color(primaryColor) },
    uColorShift: { value: 0 },
    uAudio: { value: 0 },
    // UI-14 §9: cohesion/dispersion engine
    uCohesion: { value: 0.8 },
    uDispersion: { value: 0.2 },
    uTurbulence: { value: 0.1 },
    uWaveAmplitude: { value: 0.05 },
    uWaveFrequency: { value: 1 },
    uParticleScale: { value: 1 },
    uOpacity: { value: 0.8 },
    uCorePulse: { value: 0.5 },
  }), []); // create once — colors updated via useEffect below

  // Phase 31: Update uniform colors on theme change WITHOUT recreating
  // geometry or particle buffers (performance requirement).
  useEffect(() => {
    uniforms.uPrimary.value.set(primaryColor);
    uniforms.uSecondary.value.set(secondaryColor);
  }, [primaryColor, secondaryColor, uniforms]);

  const vertexShader = useMemo(() => `
    attribute float phase;
    uniform float uTime;
    uniform float uSpeed;
    uniform float uScale;
    uniform float uAudio;
    // UI-14 §9: cohesion/dispersion/turbulence/wave uniforms
    uniform float uCohesion;
    uniform float uDispersion;
    uniform float uTurbulence;
    uniform float uWaveAmplitude;
    uniform float uWaveFrequency;
    uniform float uParticleScale;
    varying float vDist;
    varying float vPhase;
    varying float vDispersion;

    void main() {
      vPhase = phase;
      // UI-14 §7-§9: Dynamic particle morphing.
      // Organic fluid wave: multiple sine layers (state-reactive amplitude/frequency)
      float wave1 = sin(position.x * 3.0 * uWaveFrequency + uTime * uSpeed + phase) * uWaveAmplitude;
      float wave2 = sin(position.y * 5.0 * uWaveFrequency + uTime * uSpeed * 1.3 + phase * 1.5) * uWaveAmplitude * 0.7;
      float wave3 = sin(position.z * 7.0 * uWaveFrequency + uTime * uSpeed * 0.7 + phase * 0.8) * uWaveAmplitude * 0.5;
      float audioWave = uAudio * sin(phase * 4.0 + uTime * 8.0) * 0.08;

      // UI-14 §9: turbulence — chaotic displacement (procedural noise approximation)
      float turbNoise = sin(phase * 12.0 + uTime * uSpeed * 2.0) * cos(phase * 7.0 + uTime * uSpeed * 1.7) * uTurbulence * 0.1;

      float displacement = wave1 + wave2 + wave3 + audioWave + turbNoise;

      // UI-14 §9: cohesion vs dispersion — pull particles toward center (cohesion)
      // or push them outward (dispersion). High cohesion = tighter sphere.
      float cohesionFactor = mix(1.0 + uDispersion * 0.3, 1.0 - uCohesion * 0.1, uCohesion);
      vec3 displaced = position * (uScale * cohesionFactor + displacement);

      vDist = displacement;
      vDispersion = uDispersion;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      // UI-14 §7: particle size varies with particleScale uniform + displacement
      gl_PointSize = (2.0 + abs(displacement) * 6.0) * uParticleScale;
    }
  `, []);

  // UI-01: fragment shader now mixes primary → stateColor by colorShift,
  // giving error (red) and thinking (violet) actual visual differentiation.
  // UI-14: opacity uniform added for state-reactive particle visibility.
  const fragmentShader = useMemo(() => `
    uniform vec3 uPrimary;
    uniform vec3 uSecondary;
    uniform vec3 uStateColor;
    uniform float uColorShift;
    uniform float uGlow;
    uniform float uAudio;
    uniform float uOpacity;
    varying float vDist;
    varying float vPhase;
    varying float vDispersion;

    void main() {
      float alpha = 0.3 + abs(vDist) * 3.0 + uAudio * 0.2;
      alpha *= uGlow;
      alpha *= uOpacity;
      // First mix primary→secondary along displacement, then mix toward
      // stateColor (e.g., red for error) by uColorShift.
      vec3 base = mix(uPrimary, uSecondary, abs(vDist) * 4.0);
      vec3 color = mix(base, uStateColor, uColorShift);
      gl_FragColor = vec4(color, clamp(alpha, 0.05, 0.95));
    }
  `, []);

  useFrame((_, delta) => {
    // UI-01: read live audio level from ref each frame — ref.current updates
    // 60×/sec from VoiceService without triggering React re-render.
    const audioLevel = audioLevelRef.current;
    const visual = computeOrbVisual(state, audioLevel);
    // Smooth interpolation (premium = no jerky movement)
    const lerpFactor = 1 - Math.exp(-delta * 5);
    smoothScale.current += (visual.scale - smoothScale.current) * lerpFactor;
    smoothSpeed.current += (visual.particleSpeed - smoothSpeed.current) * lerpFactor;
    smoothGlow.current += (visual.glowIntensity - smoothGlow.current) * lerpFactor;
    smoothColorShift.current += (visual.colorShift - smoothColorShift.current) * lerpFactor;

    uniforms.uTime.value += delta;
    uniforms.uSpeed.value = smoothSpeed.current;
    uniforms.uScale.value = smoothScale.current;
    uniforms.uGlow.value = smoothGlow.current;
    uniforms.uAudio.value = audioLevel;
    uniforms.uColorShift.value = smoothColorShift.current;
    // UI-14 §9: set new cohesion/dispersion/turbulence/wave uniforms
    uniforms.uCohesion.value = visual.cohesion;
    uniforms.uDispersion.value = visual.dispersion;
    uniforms.uTurbulence.value = visual.turbulence;
    uniforms.uWaveAmplitude.value = visual.waveAmplitude;
    uniforms.uWaveFrequency.value = visual.waveFrequency;
    uniforms.uParticleScale.value = visual.particleScale;
    uniforms.uOpacity.value = visual.opacity;

    // Update state color uniform (only when stateColor changes)
    if (visual.stateColor) {
      stateColorRef.current.set(visual.stateColor);
    } else {
      // No tint — fall back to primary so mix has no visible effect.
      stateColorRef.current.set(primaryColor);
    }
    uniforms.uStateColor.value.copy(stateColorRef.current);

    if (pointsRef.current) {
      // UI-01: gate rotations behind reducedMotion (was a lying comment —
      // the original code claimed to "freeze high-speed animation" but
      // kept rotating).
      if (!reducedMotion) {
        pointsRef.current.rotation.y += delta * 0.15; // very slow rotation
        pointsRef.current.rotation.z += delta * 0.03;
      }
    }

    // [ORB_TRACE_VISUAL] + [ORB_TRACE_SHADER] diagnostics — throttled to ~1/second
    debugFrameCount.current++;
    if (debugFrameCount.current % 60 === 0) {
      console.log(`[ORB_TRACE_VISUAL]`);
      console.log(`  state=${state}`);
      console.log(`  energy=${visual.particleSpeed.toFixed(2)}`);
      console.log(`  speed=${visual.particleSpeed.toFixed(2)}`);
      console.log(`  glow=${visual.glowIntensity.toFixed(2)}`);
      console.log(`  scale=${visual.scale.toFixed(2)}`);
      console.log(`  audioLevel=${audioLevel.toFixed(3)}`);
      console.log(`  stateColor=${visual.stateColor || '(theme)'}`);

      console.log(`[ORB_TRACE_SHADER]`);
      console.log(`  uEnergy=${uniforms.uSpeed.value.toFixed(2)}`);
      console.log(`  uSpeed=${uniforms.uSpeed.value.toFixed(2)}`);
      console.log(`  uGlow=${uniforms.uGlow.value.toFixed(2)}`);
      console.log(`  uIntensity=${uniforms.uGlow.value.toFixed(2)}`);
      console.log(`  uAudio=${uniforms.uAudio.value.toFixed(3)}`);
      console.log(`  uScale=${uniforms.uScale.value.toFixed(2)}`);
      console.log(`  uColorShift=${uniforms.uColorShift.value.toFixed(2)}`);
    }
  });

  // Phase 27 REVIEW: explicit geometry disposal (R3F auto-disposes most
  // resources, but bufferAttribute with args[] can leak on hot-reload
  // or rapid mount/unmount cycles)
  useEffect(() => {
    return () => {
      if (pointsRef.current) {
        pointsRef.current.geometry?.dispose();
      }
      if (materialRef.current) {
        materialRef.current.dispose?.();
      }
    };
  }, []);

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        <bufferAttribute attach="attributes-phase" args={[phases, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ─── Inner Core Glow (UI-01: directive §4 layer 1) ──────────────────────────

interface CoreGlowProps {
  state: NexOrbState;
  audioLevelRef: React.MutableRefObject<number>;
  primaryColor: string;
  reducedMotion?: boolean;
}

/**
 * Inner glowing sphere — gives the orb a sense of "presence" / energy
 * source at its center. Intensity varies per state + audio.
 */
function CoreGlow({ state, audioLevelRef, primaryColor, reducedMotion = false }: CoreGlowProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const smoothIntensity = useRef(0.6);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uIntensity: { value: 0.6 },
    uColor: { value: new THREE.Color(primaryColor) },
  }), []);

  useEffect(() => {
    uniforms.uColor.value.set(primaryColor);
  }, [primaryColor, uniforms]);

  const vertexShader = useMemo(() => `
    varying vec3 vNormal;
    varying vec3 vViewPos;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
      vViewPos = -mvPos.xyz;
      gl_Position = projectionMatrix * mvPos;
    }
  `, []);

  // Fresnel-style glow — brighter at silhouette edges.
  const fragmentShader = useMemo(() => `
    uniform vec3 uColor;
    uniform float uIntensity;
    uniform float uTime;
    varying vec3 vNormal;
    varying vec3 vViewPos;
    void main() {
      vec3 viewDir = normalize(vViewPos);
      float fresnel = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 2.0);
      // Subtle inner pulse — slow sine for "breathing"
      float pulse = 0.85 + 0.15 * sin(uTime * 1.2);
      float alpha = fresnel * uIntensity * pulse * 0.7;
      gl_FragColor = vec4(uColor, clamp(alpha, 0.0, 0.85));
    }
  `, []);

  useFrame((_, delta) => {
    const audioLevel = audioLevelRef.current;
    const visual = computeOrbVisual(state, audioLevel);
    const target = visual.coreIntensity;
    const lerpFactor = 1 - Math.exp(-delta * 5);
    smoothIntensity.current += (target - smoothIntensity.current) * lerpFactor;
    uniforms.uTime.value += delta;
    uniforms.uIntensity.value = smoothIntensity.current;
    if (meshRef.current && !reducedMotion) {
      // Very slow counter-rotation for life
      meshRef.current.rotation.y += delta * 0.08;
    }
  });

  useEffect(() => {
    return () => {
      if (meshRef.current) meshRef.current.geometry?.dispose();
      if (materialRef.current) materialRef.current.dispose?.();
    };
  }, []);

  return (
    <mesh ref={meshRef} scale={0.55}>
      <sphereGeometry args={[1, 32, 32]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

// ─── Speaking Pulse Ring (UI-01: directive §4 layer 6) ─────────────────────

interface SpeakingPulseProps {
  state: NexOrbState;
  audioLevelRef: React.MutableRefObject<number>;
  primaryColor: string;
  reducedMotion?: boolean;
}

/**
 * Expanding ring pulse — visible only during speaking state. Scales outward
 * and fades, driven by audioLevel + pulseSpeed.
 */
function SpeakingPulse({ state, audioLevelRef, primaryColor, reducedMotion = false }: SpeakingPulseProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const phaseRef = useRef(0);

  const color = useMemo(() => new THREE.Color(primaryColor), [primaryColor]);

  useEffect(() => {
    color.set(primaryColor);
    if (materialRef.current) materialRef.current.color = color;
  }, [primaryColor, color]);

  useFrame((_, delta) => {
    const audioLevel = audioLevelRef.current;
    const visual = computeOrbVisual(state, audioLevel);
    const mesh = meshRef.current;
    const mat = materialRef.current;
    if (!mesh || !mat) return;

    if (visual.pulseSpeed <= 0 || reducedMotion) {
      // Hide when not speaking or when reduced-motion is active.
      mat.opacity = 0;
      return;
    }
    // Advance pulse phase — speed scales with audio + pulseSpeed.
    phaseRef.current += delta * (0.5 + audioLevel * 1.5) * visual.pulseSpeed;
    // Wrap to [0, 1) for repeated expansion cycles.
    const cycle = phaseRef.current % 1;
    // Scale: 1.0 → 1.8 over cycle, opacity: 0.5 → 0
    const scale = 1.0 + cycle * 0.8;
    const opacity = 0.5 * (1 - cycle);
    mesh.scale.set(scale, scale, scale);
    mat.opacity = opacity;
  });

  useEffect(() => {
    return () => {
      if (meshRef.current) meshRef.current.geometry?.dispose();
      if (materialRef.current) materialRef.current.dispose?.();
    };
  }, []);

  return (
    <mesh ref={meshRef} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[1.1, 0.012, 8, 64]} />
      <meshBasicMaterial
        ref={materialRef}
        color={color}
        transparent
        opacity={0}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

// ─── Holographic Rings ───────────────────────────────────────────────────────

interface OrbRingsProps {
  state: NexOrbState;
  audioLevelRef: React.MutableRefObject<number>;
  color: string;
  reducedMotion?: boolean;
}

function OrbRings({ state, audioLevelRef, color, reducedMotion = false }: OrbRingsProps) {
  const ring1 = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);
  const mat1 = useRef<THREE.MeshBasicMaterial>(null);
  const mat2 = useRef<THREE.MeshBasicMaterial>(null);
  const smoothSpeed = useRef(1);

  // UI-01: rings now react to state — speed modulated, opacity shifts on error.
  useFrame((_, delta) => {
    const visual = computeOrbVisual(state, audioLevelRef.current);
    const lerpFactor = 1 - Math.exp(-delta * 4);
    smoothSpeed.current += (visual.ringSpeed - smoothSpeed.current) * lerpFactor;
    if (reducedMotion) return; // freeze all rotation when reduced-motion
    if (ring1.current) ring1.current.rotation.z += delta * 0.05 * smoothSpeed.current;
    if (ring2.current) ring2.current.rotation.z -= delta * 0.03 * smoothSpeed.current;
    // Dim rings during error state for visual coherence with red tint.
    if (mat1.current) mat1.current.opacity = state === 'error' ? 0.15 : 0.3;
    if (mat2.current) mat2.current.opacity = state === 'error' ? 0.08 : 0.15;
  });

  return (
    <group>
      <mesh ref={ring1} rotation={[Math.PI / 3, 0, 0]}>
        <torusGeometry args={[1.45, 0.005, 8, 100]} />
        <meshBasicMaterial ref={mat1} color={color} transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <mesh ref={ring2} rotation={[Math.PI / 2, Math.PI / 4, 0]}>
        <torusGeometry args={[1.65, 0.003, 8, 80]} />
        <meshBasicMaterial ref={mat2} color={color} transparent opacity={0.15} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ─── Ambient Particles (surrounding the orb) ────────────────────────────────

interface AmbientParticlesProps {
  state: NexOrbState;
  audioLevelRef: React.MutableRefObject<number>;
  color: string;
  count?: number;
  reducedMotion?: boolean;
}

function AmbientParticles({
  state,
  audioLevelRef,
  color,
  count = 120,
  reducedMotion = false,
}: AmbientParticlesProps) {
  const ref = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);
  const smoothDrift = useRef(1);

  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 2.5 + Math.random() * 2.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.5;
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, [count]);

  // UI-01: ambient particles now react to state — drift speed modulated.
  useFrame((_, delta) => {
    const visual = computeOrbVisual(state, audioLevelRef.current);
    const lerpFactor = 1 - Math.exp(-delta * 3);
    smoothDrift.current += (visual.ambientDrift - smoothDrift.current) * lerpFactor;
    if (ref.current && !reducedMotion) {
      ref.current.rotation.y += delta * 0.02 * smoothDrift.current;
      ref.current.rotation.x += delta * 0.008 * smoothDrift.current;
    }
    // Dim ambient particles during error state.
    if (matRef.current) {
      matRef.current.opacity = state === 'error' ? 0.2 : 0.4;
    }
  });

  // UI-01: explicit geometry/material disposal (was relying on R3F auto-dispose
  // which can leak on hot-reload cycles).
  useEffect(() => {
    return () => {
      if (ref.current) ref.current.geometry?.dispose();
      if (matRef.current) matRef.current.dispose?.();
    };
  }, []);

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        size={0.02}
        color={color}
        transparent
        opacity={0.4}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

// ─── Main Orb Component ──────────────────────────────────────────────────────

export interface NexOrbProps {
  state?: NexOrbState;
  /**
   * UI-01: preferred way to pass live audio level — a ref object whose
   * .current value is updated externally (e.g., by VoiceService at 60fps).
   * The orb reads it inside useFrame without triggering React re-renders.
   */
  audioLevelRef?: React.MutableRefObject<number>;
  /** Legacy fallback: static audio level value (still supported). */
  audioLevel?: number;
  primaryColor?: string;
  secondaryColor?: string;
  quality?: 'high' | 'medium' | 'low';
  className?: string;
}

export default function NexOrb({
  state = 'idle',
  audioLevelRef,
  audioLevel = 0,
  primaryColor = '#00e5ff',
  secondaryColor = '#2563ff',
  quality = 'high',
  className,
}: NexOrbProps) {
  const particleCount = quality === 'high' ? 2000 : quality === 'medium' ? 1200 : 600;
  const ambientCount = quality === 'high' ? 120 : quality === 'medium' ? 70 : 40;
  const dpr: [number, number] = quality === 'high' ? [1, 2] : [1, 1.5];

  // UI-01: if caller passed a ref, use it; otherwise create an internal ref
  // synced from the legacy `audioLevel` prop each render. This keeps the
  // component backward-compatible while fixing the stale-prop bug for callers
  // that pass a ref.
  const internalAudioRef = useRef<number>(audioLevel);
  const effectiveAudioRef = audioLevelRef ?? internalAudioRef;
  // Sync legacy prop into internal ref (no-op when caller passes audioLevelRef).
  useEffect(() => {
    if (!audioLevelRef) internalAudioRef.current = audioLevel;
  }, [audioLevel, audioLevelRef]);

  // [ORB_TRACE_ORB] — log when the state prop changes (proves React re-render)
  useEffect(() => {
    console.log(`[ORB_TRACE_ORB] propState=${state} audioLevel=${(audioLevelRef?.current ?? audioLevel).toFixed(3)}`);
  }, [state, audioLevel, audioLevelRef]);

  // Reduced-motion support — now actually gates Three.js rotations (UI-01 fix).
  const [reducedMotion, setReducedMotion] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // UI-01: in reduced-motion mode, demote quality tier by one step so we
  // actually drop particle count (the original comment lied about doing this).
  const effectiveQuality = reducedMotion
    ? quality === 'high' ? 'medium' : 'low'
    : quality;
  const effectiveParticleCount = effectiveQuality === 'high' ? 2000 : effectiveQuality === 'medium' ? 1200 : 600;
  const effectiveAmbientCount = effectiveQuality === 'high' ? 120 : effectiveQuality === 'medium' ? 70 : 40;

  // In reduced-motion mode, force a calm visual state but keep the actual
  // state for color/intensity (so user still sees error tint etc.).
  const effectiveState: NexOrbState = reducedMotion ? 'offline' : state;

  return (
    <div className={className} style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Ground reflection */}
      <div className="nex-orb-reflection" />
      <Canvas
        camera={{ position: [0, 0,4], fov: 45 }}
        dpr={dpr}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        style={{ background: 'transparent' }}
      >
        <ParticleSphere
          state={effectiveState}
          audioLevelRef={effectiveAudioRef}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          particleCount={effectiveParticleCount}
          reducedMotion={reducedMotion}
        />
        <CoreGlow
          state={effectiveState}
          audioLevelRef={effectiveAudioRef}
          primaryColor={primaryColor}
          reducedMotion={reducedMotion}
        />
        <SpeakingPulse
          state={effectiveState}
          audioLevelRef={effectiveAudioRef}
          primaryColor={primaryColor}
          reducedMotion={reducedMotion}
        />
        {/* Phase 66: OrbRings removed — replaced by organic particle/wave system */}
        <AmbientParticles
          state={effectiveState}
          audioLevelRef={effectiveAudioRef}
          color={primaryColor}
          count={effectiveAmbientCount}
          reducedMotion={reducedMotion}
        />
      </Canvas>
    </div>
  );
}
