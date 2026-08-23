/**
 * NEX AI Orb — WebGL Particle Sphere (Phase 27)
 *
 * A living holographic sphere built with React Three Fiber:
 *   - ~2000 particles on a fibonacci sphere with fluid wave displacement
 *   - Continuous slow rotation (never static)
 *   - Audio-reactive scaling (smoothed)
 *   - Color themes via CSS variable bridge
 *   - Performance: adaptive particle count, DPR cap, proper cleanup
 */

import React, { useRef, useMemo, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { computeOrbVisual, type NexOrbState } from './orb-state';

// ─── Particle Sphere ─────────────────────────────────────────────────────────

interface ParticleSphereProps {
  state: NexOrbState;
  audioLevel: number;
  primaryColor: string;
  secondaryColor: string;
  particleCount?: number;
}

function ParticleSphere({ state, audioLevel, primaryColor, secondaryColor, particleCount = 2000 }: ParticleSphereProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const smoothScale = useRef(1);
  const smoothSpeed = useRef(1);
  const smoothGlow = useRef(0.8);

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

  const colors = useMemo(() => {
    const c1 = new THREE.Color(primaryColor);
    const c2 = new THREE.Color(secondaryColor);
    const arr = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const mix = Math.random();
      const c = c1.clone().lerp(c2, mix);
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    return arr;
  }, [particleCount, primaryColor, secondaryColor]);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uSpeed: { value: 1 },
    uScale: { value: 1 },
    uGlow: { value: 0.8 },
    uPrimary: { value: new THREE.Color(primaryColor) },
    uSecondary: { value: new THREE.Color(secondaryColor) },
    uAudio: { value: 0 },
  }), [primaryColor, secondaryColor]);

  const vertexShader = useMemo(() => `
    attribute float phase;
    uniform float uTime;
    uniform float uSpeed;
    uniform float uScale;
    uniform float uAudio;
    varying float vDist;
    varying float vPhase;

    void main() {
      vPhase = phase;
      // Organic fluid wave: multiple sine layers
      float wave1 = sin(position.x * 3.0 + uTime * uSpeed + phase) * 0.06;
      float wave2 = sin(position.y * 5.0 + uTime * uSpeed * 1.3 + phase * 1.5) * 0.04;
      float wave3 = sin(position.z * 7.0 + uTime * uSpeed * 0.7 + phase * 0.8) * 0.03;
      float audioWave = uAudio * sin(phase * 4.0 + uTime * 8.0) * 0.08;
      float displacement = wave1 + wave2 + wave3 + audioWave;

      vec3 displaced = position * (uScale + displacement);
      vDist = displacement;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      gl_PointSize = 2.0 + abs(displacement) * 6.0;
    }
  `, []);

  const fragmentShader = useMemo(() => `
    uniform vec3 uPrimary;
    uniform vec3 uSecondary;
    uniform float uGlow;
    uniform float uAudio;
    varying float vDist;
    varying float vPhase;

    void main() {
      float alpha = 0.3 + abs(vDist) * 3.0 + uAudio * 0.2;
      alpha *= uGlow;
      vec3 color = mix(uPrimary, uSecondary, abs(vDist) * 4.0);
      gl_FragColor = vec4(color, clamp(alpha, 0.05, 0.9));
    }
  `, []);

  useFrame((_, delta) => {
    const visual = computeOrbVisual(state, audioLevel);
    // Smooth interpolation (premium = no jerky movement)
    const lerpFactor = 1 - Math.exp(-delta * 5);
    smoothScale.current += (visual.scale - smoothScale.current) * lerpFactor;
    smoothSpeed.current += (visual.particleSpeed - smoothSpeed.current) * lerpFactor;
    smoothGlow.current += (visual.glowIntensity - smoothGlow.current) * lerpFactor;

    uniforms.uTime.value += delta;
    uniforms.uSpeed.value = smoothSpeed.current;
    uniforms.uScale.value = smoothScale.current;
    uniforms.uGlow.value = smoothGlow.current;
    uniforms.uAudio.value = audioLevel;

    if (pointsRef.current) {
      pointsRef.current.rotation.y += delta * 0.15; // very slow rotation
      pointsRef.current.rotation.z += delta * 0.03;
    }
  });

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

// ─── Holographic Rings ───────────────────────────────────────────────────────

function OrbRings({ color }: { color: string }) {
  const ring1 = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (ring1.current) ring1.current.rotation.z += delta * 0.05;
    if (ring2.current) ring2.current.rotation.z -= delta * 0.03;
  });

  return (
    <group>
      <mesh ref={ring1} rotation={[Math.PI / 3, 0, 0]}>
        <torusGeometry args={[1.45, 0.005, 8, 100]} />
        <meshBasicMaterial color={color} transparent opacity={0.3} />
      </mesh>
      <mesh ref={ring2} rotation={[Math.PI / 2, Math.PI / 4, 0]}>
        <torusGeometry args={[1.65, 0.003, 8, 80]} />
        <meshBasicMaterial color={color} transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

// ─── Ambient Particles (surrounding the orb) ────────────────────────────────

function AmbientParticles({ color, count = 120 }: { color: string; count?: number }) {
  const ref = useRef<THREE.Points>(null);

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

  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.02;
      ref.current.rotation.x += delta * 0.008;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.02} color={color} transparent opacity={0.4} sizeAttenuation />
    </points>
  );
}

// ─── Main Orb Component ──────────────────────────────────────────────────────

export interface NexOrbProps {
  state?: NexOrbState;
  audioLevel?: number;
  primaryColor?: string;
  secondaryColor?: string;
  quality?: 'high' | 'medium' | 'low';
  className?: string;
}

export default function NexOrb({
  state = 'idle',
  audioLevel = 0,
  primaryColor = '#00e5ff',
  secondaryColor = '#2563ff',
  quality = 'high',
  className,
}: NexOrbProps) {
  const particleCount = quality === 'high' ? 2000 : quality === 'medium' ? 1200 : 600;
  const ambientCount = quality === 'high' ? 120 : quality === 'medium' ? 70 : 40;
  const dpr: [number, number] = quality === 'high' ? [1, 2] : [1, 1.5];

  return (
    <div className={className} style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Ground reflection */}
      <div className="nex-orb-reflection" />
      <Canvas
        camera={{ position: [0, 0, 4], fov: 45 }}
        dpr={dpr}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        style={{ background: 'transparent' }}
      >
        <ParticleSphere
          state={state}
          audioLevel={audioLevel}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          particleCount={particleCount}
        />
        <OrbRings color={primaryColor} />
        <AmbientParticles color={primaryColor} count={ambientCount} />
      </Canvas>
    </div>
  );
}
