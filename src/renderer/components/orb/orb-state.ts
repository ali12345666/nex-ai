/**
 * NEX AI Orb State Types (Phase 27)
 *
 * Voice/AI state machine driving orb visual behavior.
 */

export type NexOrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error' | 'offline';

export interface NexOrbVisual {
  state: NexOrbState;
  /** smoothed audio level [0..1] from mic (listening) or AI output (speaking) */
  audioLevel: number;
  /** target scale multiplier (computed from state + audio) */
  scale: number;
  /** particle speed multiplier */
  particleSpeed: number;
  /** color shift 0=cyan, 1=violet */
  colorShift: number;
  /** glow intensity multiplier */
  glowIntensity: number;
}

/** Compute visual parameters from state + audio */
export function computeOrbVisual(state: NexOrbState, audioLevel: number): NexOrbVisual {
  const level = Math.max(0, Math.min(1, audioLevel));
  let scale = 1;
  let particleSpeed = 1;
  let colorShift = 0;
  let glowIntensity = 1;

  switch (state) {
    case 'idle':
      scale = 1 + level * 0.02;
      particleSpeed = 1 + level * 0.3;
      colorShift = 0;
      glowIntensity = 0.8;
      break;
    case 'listening':
      scale = 1.04 + level * 0.06; // 1.04–1.10
      particleSpeed = 1.5 + level * 1.5;
      colorShift = 0;
      glowIntensity = 1.1 + level * 0.3;
      break;
    case 'thinking':
      scale = 1.06;
      particleSpeed = 2.5;
      colorShift = 0.4; // toward violet
      glowIntensity = 1.3;
      break;
    case 'speaking':
      scale = 1.05 + level * 0.07; // reactive to AI voice
      particleSpeed = 2 + level * 2;
      colorShift = 0.1;
      glowIntensity = 1.2 + level * 0.4;
      break;
    case 'error':
      scale = 0.98;
      particleSpeed = 0.5;
      colorShift = 0.8; // toward red
      glowIntensity = 0.6;
      break;
    case 'offline':
      scale = 1;
      particleSpeed = 0.3;
      colorShift = 0;
      glowIntensity = 0.4;
      break;
  }

  return { state, audioLevel: level, scale, particleSpeed, colorShift, glowIntensity };
}
