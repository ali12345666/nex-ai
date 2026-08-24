/**
 * NEX AI Orb State Types (Phase 27 + UI-01 aliveness + UI-13 active state)
 *
 * Voice/AI state machine driving orb visual behavior.
 *
 * UI-01 changes:
 *   - Added `coreIntensity` for inner core glow modulation per state
 *   - Added `ringSpeed` for holographic rings (state-reactive)
 *   - Added `ambientDrift` for ambient particle field
 *   - Added `stateColor` (nullable) — when set, the fragment shader mixes
 *     the primary theme color toward this color by `colorShift`.
 *   - Added `pulseSpeed` — speaking-pulse ring expansion rate (0 = no pulse)
 *
 * UI-13 changes (ACTIVE RED STATE):
 *   - Added `active` state — unified "NEX is working" state. Vibrant red,
 *     high glow, fast motion, scale pulse. Used for: generating, thinking,
 *     tool-running, searching, knowledge-retrieving, loading-model,
 *     speaking, executing task, agent running.
 *   - Changed `thinking` to use RED stateColor (was violet #8b5cf6) —
 *     thinking IS working, so it should be red per directive.
 *   - Changed `speaking` to use RED stateColor (was no tint) — speaking IS
 *     working, so it should be red too.
 *   - `error` remains muted red (distinct from active vibrant red — error is
 *     constrained/slow, active is vibrant/fast).
 *   - `listening` stays normal theme (user input, not AI working).
 */

export type NexOrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'active' | 'error' | 'offline';

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
 * UI-13: vibrant red used for all "working" states (active, thinking, speaking).
 * Distinct from error's muted red (#ef4444) — this is brighter and more energetic.
 */
const ACTIVE_RED = '#ff2d55'; // vibrant pink-red — "NEX is working"

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
      // Receptive — user is speaking TO the AI. Subtle accent, NOT red.
      // (Red is reserved for when the AI itself is working.)
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
      // UI-13: thinking IS working → RED (was violet).
      // Engaged — vibrant red tint, accelerated motion, no pulse (internal processing).
      scale = 1.08;
      particleSpeed = 2.8;
      colorShift = 0.85;
      glowIntensity = 1.4;
      coreIntensity = 1.2;
      ringSpeed = 2.2;
      ambientDrift = 1.8;
      pulseSpeed = 0;
      stateColor = ACTIVE_RED;
      break;
    case 'speaking':
      // UI-13: speaking IS working → RED (was no tint).
      // Active output — red tint + audio-reactive pulse + scale.
      scale = 1.08 + level * 0.08; // reactive to AI voice
      particleSpeed = 2.5 + level * 2;
      colorShift = 0.7;
      glowIntensity = 1.4 + level * 0.4;
      coreIntensity = 1.3 + level * 0.4;
      ringSpeed = 2.4 + level * 1.0;
      ambientDrift = 2.0 + level * 0.5;
      pulseSpeed = 1.0 + level * 0.8;
      stateColor = ACTIVE_RED;
      break;
    case 'active':
      // UI-13: unified "NEX is working" state — vibrant red, intense motion.
      // Used for: generating, tool-running, searching, knowledge-retrieving,
      // loading-model, executing task, agent running.
      // Distinct from error: active is vibrant/fast, error is muted/slow.
      scale = 1.1 + level * 0.05;
      particleSpeed = 3.0;
      colorShift = 0.9;
      glowIntensity = 1.5;
      coreIntensity = 1.4;
      ringSpeed = 2.6;
      ambientDrift = 2.2;
      pulseSpeed = 1.2; // continuous pulse while working
      stateColor = ACTIVE_RED;
      break;
    case 'error':
      // Constrained — slow, MUTED red (distinct from active vibrant red).
      scale = 0.98;
      particleSpeed = 0.5;
      colorShift = 0.85;
      glowIntensity = 0.6;
      coreIntensity = 0.5;
      ringSpeed = 0.3;
      ambientDrift = 0.4;
      pulseSpeed = 0;
      stateColor = '#ef4444'; // muted red — error state
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
