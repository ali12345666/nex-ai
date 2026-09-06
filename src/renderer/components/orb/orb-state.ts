/**
 * NEX AI Orb State Types (UI-14 + Phase 116 JARVIS)
 *
 * State → Visual engine. Pure function — safe to call every animation frame.
 *
 * Phase 116 JARVIS additions:
 *   - New states: INITIALIZING, READY, WORKING, SUCCESS, CANCELLED
 *   - State transition validation (monotonic — no backward jumps to terminal)
 *   - Mapping from VoiceService/Agent/Chat states → Orb states
 *
 * Architecture (§12): Orb rendering logic is decoupled from state logic.
 * computeOrbVisual() is the single source of truth for visual params.
 *
 * State Machine:
 *   IDLE → INITIALIZING → READY → LISTENING → THINKING → SPEAKING → READY
 *                     ↓                     ↓               ↓
 *                   ERROR                 WORKING         CANCELLED
 *                     ↓                     ↓               ↓
 *                   IDLE                  SUCCESS          READY
 *                                          → READY
 */

export type NexOrbState =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'active'      // Phase 116: renamed concept = WORKING
  | 'working'     // Phase 116: WORKING (agent executing tools)
  | 'success'     // Phase 116: task completed successfully
  | 'error'
  | 'cancelled'   // Phase 116: task cancelled by user
  | 'offline'
  | 'installing';

// ─── State Transition Map ──────────────────────────────────────────────────
// Phase 18 (BUG-37 fix): RELAXED to reflect actual production flows.
//
// The original graph treated flash states (success/error/cancelled) as
// terminal — only allowing transitions back to idle/ready. This was
// incorrect for the Phase 16/17 auto-clear UX pattern: a flash state
// is a 1.5s auto-clearing interruption, and a new task/event arriving
// during that window MUST be able to transition into an active state
// (otherwise the new task's condition is silently dropped).
//
// Key relaxations (★ marks additions):
//   - Flash states (success/error/cancelled) can now transition to ALL
//     active states (listening/thinking/speaking/working) so a new
//     task starting during the 1.5s flash window takes effect.
//   - idle can now transition to thinking/working/cancelled directly
//     (chat path starts at thinking; agent path can start at working;
//     a cancel can arrive when idle in some race conditions).
//   - listening can now transition to working (barge-in path: user
//     speaks while TTS plays → listening → working → thinking).
//   - thinking can now transition to listening (chat completion with
//     voice mic still on → thinking → listening for next utterance).
//   - speaking can now transition to working/thinking (barge-in path
//     where the agent restarts during TTS).
//   - working can now transition to thinking/speaking/listening
//     (recovery engine replan, barge-in, agent TTS response).
//
// This preserves the monotonic-terminal-state invariant for TRUE
// terminal states (offline → only idle/initializing; installing →
// only ready/idle/error) while allowing flash states to be
// interrupted by new activity. The graph now matches all documented
// production flows:
//   - idle → listening → thinking → speaking → listening → idle (voice)
//   - idle → thinking → listening → idle (chat with voice mic on)
//   - idle → thinking → working → success → idle (agent task)
//   - idle → listening → thinking → working → success → speaking →
//     listening (voice agent task)
//   - speaking → listening → working → thinking (barge-in)
const VALID_TRANSITIONS: Record<string, NexOrbState[]> = {
  idle:          ['initializing', 'ready', 'listening', 'thinking', 'working', 'error', 'cancelled', 'offline'],          // ★ +thinking, +working, +cancelled
  initializing:  ['ready', 'error', 'idle', 'listening', 'thinking', 'working'],                                          // ★ +listening, +thinking, +working
  ready:         ['listening', 'thinking', 'working', 'idle', 'offline', 'error', 'cancelled'],                            // ★ +error, +cancelled
  listening:     ['thinking', 'speaking', 'idle', 'ready', 'error', 'cancelled', 'working'],                               // ★ +working (barge-in)
  thinking:      ['speaking', 'working', 'idle', 'ready', 'error', 'cancelled', 'listening'],                              // ★ +listening (chat completion w/ mic on)
  speaking:      ['ready', 'listening', 'idle', 'error', 'cancelled', 'working', 'thinking', 'success'],                              // ★ +working, +thinking, +success (barge-in + priority resolution)
  active:        ['ready', 'idle', 'error', 'success', 'cancelled', 'listening', 'thinking', 'speaking'],                 // ★ +listening, +thinking, +speaking (legacy alias)
  working:       ['ready', 'idle', 'error', 'success', 'cancelled', 'thinking', 'speaking', 'listening'],                 // ★ +thinking, +speaking, +listening (recovery + barge-in)
  success:       ['idle', 'ready', 'listening', 'thinking', 'speaking', 'working', 'error', 'cancelled'],                 // ★ RELAX: all flash interrupts
  error:         ['idle', 'ready', 'listening', 'thinking', 'speaking', 'working', 'cancelled'],                           // ★ RELAX: all flash interrupts
  cancelled:     ['idle', 'ready', 'listening', 'thinking', 'speaking', 'working', 'error'],                               // ★ RELAX: all flash interrupts
  offline:       ['idle', 'initializing'],
  installing:    ['ready', 'idle', 'error'],
};

/**
 * Validate a state transition. Returns true if the transition is allowed.
 * Unknown 'from' states allow all transitions (safe fallback).
 *
 * Phase 18 (BUG-37): this is now the ACTUAL enforcement function used by
 * `voiceService.recomputeState()` and `voiceController.handleStateChange()`.
 * Previously it was defined but never called — the state machine was
 * documentation-only. Now invalid transitions are blocked at both layers.
 */
export function isValidOrbTransition(from: NexOrbState, to: NexOrbState): boolean {
  if (from === to) return true; // no-op transitions always allowed
  const allowed = VALID_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

/**
 * Safely transition to a new state. Returns the new state if valid,
 * or the current state if the transition is invalid (logs a warning).
 *
 * Phase 18 (BUG-37): this is now the ACTUAL enforcement function. Called by
 * `voiceService.recomputeState()` and `voiceController.handleStateChange()`.
 * When a transition is blocked, the diagnostic warning is logged:
 *   `[ORB_STATE] Invalid transition blocked: <from> → <to>`
 * This makes it possible to grep the console for blocked transitions
 * during E2E testing.
 */
export function safeOrbTransition(current: NexOrbState, to: NexOrbState): NexOrbState {
  if (isValidOrbTransition(current, to)) return to;
  console.warn(`[ORB_STATE] Invalid transition blocked: ${current} → ${to}`);
  return current;
}

export interface NexOrbVisual {
  state: NexOrbState;
  audioLevel: number;
  scale: number;
  particleSpeed: number;
  particleScale: number;
  colorShift: number;
  glowIntensity: number;
  coreIntensity: number;
  corePulse: number;
  ringSpeed: number;
  ambientDrift: number;
  pulseSpeed: number;
  stateColor: string | null;
  // UI-14 §9: Particle Cohesion Engine params
  cohesion: number;       // 0=dispersed, 1=tight sphere
  dispersion: number;     // 0=tight, 1=spread out
  turbulence: number;     // 0=calm, 1=chaotic
  waveAmplitude: number;  // particle wave displacement magnitude
  waveFrequency: number;  // particle wave frequency
  opacity: number;        // overall particle opacity multiplier
}

/**
 * UI-14 §11: 17-color deterministic palette.
 * State → color mapping is DETERMINISTIC (not random).
 * Each state has a conceptual color meaning per directive §11.
 */
export const STATE_COLOR_PALETTE: Record<NexOrbState, string> = {
  idle: '#00e5ff',        // Cyan — calm, ready
  initializing: '#f59e0b', // Amber — loading model, warming up
  ready: '#10b981',       // Emerald — fully ready, AI available
  listening: '#3b82f6',   // Blue — receiving input
  thinking: '#8b5cf6',    // Violet/Purple — internal processing
  speaking: '#22c55e',    // Green — output (speaking)
  active: '#ff2d55',       // Red/Crimson — working hard
  working: '#f97316',      // Orange — agent executing tools
  success: '#10b981',      // Emerald — task completed successfully
  error: '#ef4444',        // Red — error (muted)
  cancelled: '#64748b',    // Slate — cancelled by user
  offline: '#64748b',      // Slate — dormant
  installing: '#f59e0b',   // Amber — installing/updating
};

/**
 * UI-14 §11: Extended palette (17 colors) for future state expansion.
 * Currently mapped via STATE_COLOR_PALETTE, but this provides the full
 * palette set the directive requires.
 */
export const FULL_COLOR_PALETTE = [
  '#00e5ff', // 1. Cyan
  '#3b82f6', // 2. Blue
  '#0ea5e9', // 3. Azure
  '#8b5cf6', // 4. Violet
  '#a855f7', // 5. Purple
  '#d946ef', // 6. Magenta
  '#ec4899', // 7. Pink
  '#ff2d55', // 8. Red
  '#dc2626', // 9. Crimson
  '#f97316', // 10. Orange
  '#f59e0b', // 11. Amber
  '#eab308', // 12. Gold
  '#84cc16', // 13. Lime
  '#22c55e', // 14. Green
  '#10b981', // 15. Emerald
  '#14b8a6', // 16. Teal
  '#e2e8f0', // 17. White/Silver
] as const;

/**
 * UI-14: vibrant red used for all "working" states (active, thinking, speaking).
 * Distinct from error's muted red (#ef4444) — this is brighter and more energetic.
 */
const ACTIVE_RED = '#ff2d55';

/**
 * Compute visual parameters from state + audio.
 *
 * Pure function — safe to call every animation frame.
 * UI-14 §12: Single source of truth for orb visual params.
 */
export function computeOrbVisual(state: NexOrbState, audioLevel: number): NexOrbVisual {
  const level = Math.max(0, Math.min(1, audioLevel));
  // Defaults
  let scale = 1;
  let particleSpeed = 1;
  let particleScale = 1;
  let colorShift = 0;
  let glowIntensity = 1;
  let coreIntensity = 0.8;
  let corePulse = 0.5;
  let ringSpeed = 1;
  let ambientDrift = 1;
  let pulseSpeed = 0;
  let stateColor: string | null = null;
  let cohesion = 0.8;
  let dispersion = 0.2;
  let turbulence = 0.1;
  let waveAmplitude = 0.05;
  let waveFrequency = 1;
  let opacity = 0.8;

  switch (state) {
    case 'idle':
      // §8 IDLE: calm, cohesive, stable. High cohesion, low turbulence.
      scale = 1 + level * 0.02;
      particleSpeed = 1 + level * 0.3;
      particleScale = 1;
      colorShift = 0;
      glowIntensity = 0.8;
      coreIntensity = 0.6 + level * 0.1;
      corePulse = 0.3;
      ringSpeed = 0.6;
      ambientDrift = 0.5;
      pulseSpeed = 0;
      stateColor = null; // theme color
      cohesion = 0.9;
      dispersion = 0.1;
      turbulence = 0.05;
      waveAmplitude = 0.03;
      waveFrequency = 0.8;
      opacity = 0.7;
      break;

    // ── Phase 116 JARVIS: New states ──────────────────────────────────
    case 'initializing':
      // INITIALIZING: warm pulsing, amber — model loading / warming up
      scale = 1.02 + level * 0.03;
      particleSpeed = 1.2;
      particleScale = 1.05;
      colorShift = 0.3;
      glowIntensity = 0.9 + level * 0.2;
      coreIntensity = 0.7 + level * 0.15;
      corePulse = 0.4;
      ringSpeed = 0.8;
      ambientDrift = 0.7;
      pulseSpeed = 0.8; // slow steady pulse
      stateColor = '#f59e0b'; // amber
      cohesion = 0.85;
      dispersion = 0.15;
      turbulence = 0.1;
      waveAmplitude = 0.04;
      waveFrequency = 1.0;
      opacity = 0.75;
      break;

    case 'ready':
      // READY: emerald, stable, confident — AI is ready to respond
      scale = 1.01 + level * 0.02;
      particleSpeed = 1.0 + level * 0.2;
      particleScale = 1.0;
      colorShift = 0.1;
      glowIntensity = 0.85;
      coreIntensity = 0.65 + level * 0.1;
      corePulse = 0.35;
      ringSpeed = 0.7;
      ambientDrift = 0.6;
      pulseSpeed = 0;
      stateColor = '#10b981'; // emerald
      cohesion = 0.88;
      dispersion = 0.12;
      turbulence = 0.06;
      waveAmplitude = 0.035;
      waveFrequency = 0.9;
      opacity = 0.72;
      break;

    case 'working':
      // WORKING: orange, energetic, tool execution — agent is doing things
      scale = 1.08 + level * 0.04;
      particleSpeed = 2.5;
      particleScale = 1.18;
      colorShift = 0.6;
      glowIntensity = 1.3;
      coreIntensity = 1.1;
      corePulse = 0.65;
      ringSpeed = 2.0;
      ambientDrift = 1.6;
      pulseSpeed = 0.5;
      stateColor = '#f97316'; // orange
      cohesion = 0.5;
      dispersion = 0.6;
      turbulence = 0.5;
      waveAmplitude = 0.09;
      waveFrequency = 2.8;
      opacity = 0.88;
      break;

    case 'success':
      // SUCCESS: emerald, brief glow — task completed successfully
      scale = 1.05;
      particleSpeed = 1.5;
      particleScale = 1.08;
      colorShift = 0.15;
      glowIntensity = 1.2;
      coreIntensity = 1.0;
      corePulse = 0.5;
      ringSpeed = 1.0;
      ambientDrift = 0.8;
      pulseSpeed = 0;
      stateColor = '#10b981'; // emerald
      cohesion = 0.8;
      dispersion = 0.2;
      turbulence = 0.15;
      waveAmplitude = 0.05;
      waveFrequency = 1.2;
      opacity = 0.85;
      break;

    case 'cancelled':
      // CANCELLED: slate, dimmed — user stopped the task
      scale = 0.99;
      particleSpeed = 0.6;
      particleScale = 0.92;
      colorShift = 0.1;
      glowIntensity = 0.5;
      coreIntensity = 0.4;
      corePulse = 0.2;
      ringSpeed = 0.4;
      ambientDrift = 0.5;
      pulseSpeed = 0;
      stateColor = '#64748b'; // slate
      cohesion = 0.7;
      dispersion = 0.3;
      turbulence = 0.1;
      waveAmplitude = 0.03;
      waveFrequency = 0.6;
      opacity = 0.6;
      break;

    // ── Existing states (preserved) ────────────────────────────────────
    case 'listening':
      // §8 LISTENING: slightly open, sensitive, audio wave receptive.
      // Amplified audio reactivity (was too subtle — level*0.06 scale change
      // was imperceptible). Now scale + speed + glow all react visibly.
      scale = 1.04 + level * 0.15;
      particleSpeed = 1.5 + level * 3.0;
      particleScale = 1.1 + level * 0.4;
      colorShift = 0;
      glowIntensity = 1.1 + level * 0.6;
      coreIntensity = 0.8 + level * 0.4;
      corePulse = 0.5 + level * 0.5;
      ringSpeed = 1.2 + level * 1.5;
      ambientDrift = 1.2 + level * 1.0;
      pulseSpeed = 0;
      stateColor = null; // theme color (not red — user input, not AI working)
      cohesion = 0.7;
      dispersion = 0.3;
      turbulence = 0.15 + level * 0.2;
      waveAmplitude = 0.06 + level * 0.1;
      waveFrequency = 1.5;
      opacity = 0.8;
      break;
    case 'thinking':
      // §8 THINKING: dense, internal motion, turbulence. RED (working).
      scale = 1.08;
      particleSpeed = 2.8;
      particleScale = 1.15;
      colorShift = 0.85;
      glowIntensity = 1.4;
      coreIntensity = 1.2;
      corePulse = 0.7;
      ringSpeed = 2.2;
      ambientDrift = 1.8;
      pulseSpeed = 0;
      stateColor = ACTIVE_RED;
      cohesion = 0.85;
      dispersion = 0.2;
      turbulence = 0.6;
      waveAmplitude = 0.08;
      waveFrequency = 2.5;
      opacity = 0.85;
      break;
    case 'speaking':
      // §8 SPEAKING: audio-driven deformation. RED (working).
      scale = 1.08 + level * 0.08;
      particleSpeed = 2.5 + level * 2;
      particleScale = 1.2 + level * 0.3;
      colorShift = 0.7;
      glowIntensity = 1.4 + level * 0.4;
      coreIntensity = 1.3 + level * 0.4;
      corePulse = 0.8 + level * 0.4;
      ringSpeed = 2.4 + level * 1.0;
      ambientDrift = 2.0 + level * 0.5;
      pulseSpeed = 1.0 + level * 0.8;
      stateColor = ACTIVE_RED;
      cohesion = 0.6;
      dispersion = 0.4;
      turbulence = 0.4 + level * 0.3;
      waveAmplitude = 0.1 + level * 0.06;
      waveFrequency = 3.0;
      opacity = 0.9;
      break;
    case 'active':
      // §8 WORKING/ACTIVE: fast, energetic, dispersed, strong waves. RED.
      scale = 1.1 + level * 0.05;
      particleSpeed = 3.0;
      particleScale = 1.25;
      colorShift = 0.9;
      glowIntensity = 1.5;
      coreIntensity = 1.4;
      corePulse = 0.9;
      ringSpeed = 2.6;
      ambientDrift = 2.2;
      pulseSpeed = 1.2;
      stateColor = ACTIVE_RED;
      cohesion = 0.4;
      dispersion = 0.7;
      turbulence = 0.7;
      waveAmplitude = 0.12;
      waveFrequency = 3.5;
      opacity = 0.95;
      break;
    case 'error':
      // §8 ERROR: unstable but controlled, warning color. Muted red.
      scale = 0.98;
      particleSpeed = 0.5;
      particleScale = 0.9;
      colorShift = 0.85;
      glowIntensity = 0.6;
      coreIntensity = 0.5;
      corePulse = 0.2;
      ringSpeed = 0.3;
      ambientDrift = 0.4;
      pulseSpeed = 0;
      stateColor = '#ef4444';
      cohesion = 0.5;
      dispersion = 0.5;
      turbulence = 0.3;
      waveAmplitude = 0.04;
      waveFrequency = 0.5;
      opacity = 0.6;
      break;
    case 'offline':
      // §8 PAUSED/OFFLINE: very low motion but orb stays alive.
      scale = 1;
      particleSpeed = 0.3;
      particleScale = 0.8;
      colorShift = 0;
      glowIntensity = 0.4;
      coreIntensity = 0.35;
      corePulse = 0.1;
      ringSpeed = 0.15;
      ambientDrift = 0.25;
      pulseSpeed = 0;
      stateColor = null;
      cohesion = 0.95;
      dispersion = 0.05;
      turbulence = 0.02;
      waveAmplitude = 0.02;
      waveFrequency = 0.3;
      opacity = 0.5;
      break;
  }

  return {
    state,
    audioLevel: level,
    scale,
    particleSpeed,
    particleScale,
    colorShift,
    glowIntensity,
    coreIntensity,
    corePulse,
    ringSpeed,
    ambientDrift,
    pulseSpeed,
    stateColor,
    cohesion,
    dispersion,
    turbulence,
    waveAmplitude,
    waveFrequency,
    opacity,
  };
}
