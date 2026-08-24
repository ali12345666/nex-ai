/**
 * NEX AI Orb State Types (Phase 27 + UI-01 aliveness upgrade)
 *
 * Voice/AI state machine driving orb visual behavior.
 *
 * UI-01 changes:
 *   - Added `coreIntensity` for inner core glow modulation per state
 *   - Added `ringSpeed` for holographic rings (state-reactive)
 *   - Added `ambientDrift` for ambient particle field
 *   - Added `stateColor` (nullable) — when set, the fragment shader mixes
 *     the primary theme color toward this color by `colorShift`.
 *     This finally makes `error` red and `thinking` violet actually visible.
 *   - Added `pulseSpeed` — speaking-pulse ring expansion rate (0 = no pulse)
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
  /** color shift 0..1 — how strongly to mix toward stateColor */
  colorShift: number;
  /** glow intensity multiplier */
  glowIntensity: number;
  /** UI-01: inner core glow intensity multiplier (0..1.6) */
  coreIntensity: number;
  /** UI-01: holographic ring rotation speed multiplier */
  ringSpeed: number;
  /** UI-01: ambient particle field drift speed multiplier */
  ambientDrift: number;
  /** UI-01: speaking-pulse ring expansion rate (0 = inactive). */
  pulseSpeed: number;
  /** UI-01: state-tint color (CSS hex). When non-null, shader mixes
   * primary→stateColor by colorShift. null = use theme colors only. */
  stateColor: string | null;
}

/**
 * Compute visual parameters from state + audio.
 *
 * Pure function — safe to call every animation frame.
 */
export function computeOrbVisual(state: NexOrbState, audioLevel: number): NexOrbVisual {
  const level = Math.max(0, Math.min(1, audioLevel));
  let scale = 1;
  let particleSpeed = 1;
  let colorShift = 0;
  let glowIntensity = 1;
  let coreIntensity = 0.8;
  let ringSpeed = 1;
  let ambientDrift = 1;
  let pulseSpeed = 0;
  let stateColor: string | null = null;

  switch (state) {
    case 'idle':
      // Subtle breathing; barely perceptible motion.
      scale = 1 + level * 0.02;
      particleSpeed = 1 + level * 0.3;
      colorShift = 0;
      glowIntensity = 0.8;
      coreIntensity = 0.6 + level * 0.1;
      ringSpeed = 0.6;
      ambientDrift = 0.5;
      pulseSpeed = 0;
      break;
    case 'listening':
      // Receptive — particles pick up, waves expand gently toward user.
      scale = 1.04 + level * 0.06; // 1.04–1.10
      particleSpeed = 1.5 + level * 1.5;
      colorShift = 0;
      glowIntensity = 1.1 + level * 0.3;
      coreIntensity = 0.8 + level * 0.2;
      ringSpeed = 1.2 + level * 0.8;
      ambientDrift = 1.2 + level * 0.5;
      pulseSpeed = 0;
      break;
    case 'thinking':
      // Engaged — accent tint shifts toward violet, motion accelerates.
      scale = 1.06;
      particleSpeed = 2.5;
      colorShift = 0.45;
      glowIntensity = 1.3;
      coreIntensity = 1.0;
      ringSpeed = 1.8;
      ambientDrift = 1.5;
      pulseSpeed = 0;
      stateColor = '#8b5cf6'; // violet — matches directive §5 "thinking" intent
      break;
    case 'speaking':
      // Active — orb pulses with audio amplitude, ring expands outward.
      scale = 1.05 + level * 0.07; // reactive to AI voice
      particleSpeed = 2 + level * 2;
      colorShift = 0.1;
      glowIntensity = 1.2 + level * 0.4;
      coreIntensity = 1.0 + level * 0.4;
      ringSpeed = 2.0 + level * 1.0;
      ambientDrift = 1.8 + level * 0.5;
      pulseSpeed = 0.8 + level * 0.8;
      break;
    case 'error':
      // Constrained — slow, muted, red-tinted (without flashing).
      scale = 0.98;
      particleSpeed = 0.5;
      colorShift = 0.85;
      glowIntensity = 0.6;
      coreIntensity = 0.5;
      ringSpeed = 0.3;
      ambientDrift = 0.4;
      pulseSpeed = 0;
      stateColor = '#ef4444'; // red — error state
      break;
    case 'offline':
      // Dormant — minimal motion, low glow.
      scale = 1;
      particleSpeed = 0.3;
      colorShift = 0;
      glowIntensity = 0.4;
      coreIntensity = 0.35;
      ringSpeed = 0.15;
      ambientDrift = 0.25;
      pulseSpeed = 0;
      break;
  }

  return {
    state,
    audioLevel: level,
    scale,
    particleSpeed,
    colorShift,
    glowIntensity,
    coreIntensity,
    ringSpeed,
    ambientDrift,
    pulseSpeed,
    stateColor,
  };
}
