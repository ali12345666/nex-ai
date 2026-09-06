/**
 * NEX AI — Voice Controller (Phase 30 + Phase 116 JARVIS)
 *
 * Connects VoiceService to NexOrb and NexChatPanel.
 * This is the ONLY module that knows about both voice + UI.
 * Orb receives: state + audioLevel (via ref, not React state).
 * Chat receives: final transcripts (same pipeline as typed input).
 *
 * Phase 116 JARVIS additions:
 *   - VoiceMode management (continuous / push-to-talk / disabled)
 *   - Wake word callback forwarding
 *   - Barge-in coordination
 */

import { voiceService, type VoiceState, type VoiceMode } from './voice-service';
import { safeOrbTransition, type NexOrbState } from '../components/orb/orb-state';

/** Map VoiceState to NexOrbState. Phase 116: Extended with working/success/cancelled. */
function toOrbState(state: VoiceState): NexOrbState {
  // Direct mapping for states that exist in both
  if (state === 'idle') return 'idle';
  if (state === 'listening') return 'listening';
  if (state === 'thinking') return 'thinking';
  if (state === 'speaking') return 'speaking';
  if (state === 'error') return 'error';
  if (state === 'offline') return 'offline';
  // Phase 116 JARVIS: New states
  if (state === 'working') return 'working';
  if (state === 'success') return 'success';
  if (state === 'cancelled') return 'cancelled';
  return 'idle'; // fallback
}

export interface VoiceControllerCallbacks {
  /** Orb state change (for NexOrb component) */
  onOrbStateChange?: (state: NexOrbState) => void;
  /** Audio level for Orb (called via rAF — use a ref, NOT React state) */
  onOrbAudioLevel?: (level: number) => void;
  /** Final transcript — feed to NexChatPanel.sendMessage() */
  onFinalTranscript?: (text: string) => void;
  /** Partial transcript — for subtle display near Orb */
  onPartialTranscript?: (text: string) => void;
  /** Voice error — for small notification */
  onVoiceError?: (message: string) => void;
  /** Permission change */
  onPermissionChange?: (granted: boolean | null) => void;
  /** Phase 116: Wake word detected — NEX should respond "بله?" */
  onWakeWord?: () => void;
}

export class VoiceController {
  private callbacks: VoiceControllerCallbacks = {};
  private orbStateRef: { current: NexOrbState } = { current: 'idle' };
  private orbAudioRef: { current: number } = { current: 0 };
  private orbAudioCallbacks: Set<(level: number) => void> = new Set();
  private orbStateCallbacks: Set<(state: NexOrbState) => void> = new Set();
  private _audioLogCount = 0;

  constructor() {
    voiceService.setCallbacks({
      onStateChange: (state) => this.handleStateChange(state),
      onAudioLevel: (level) => this.handleAudioLevel(level),
      onFinalTranscript: (text) => this.callbacks.onFinalTranscript?.(text),
      onPartialTranscript: (text) => this.callbacks.onPartialTranscript?.(text),
      onError: (msg) => this.callbacks.onVoiceError?.(msg),
      onPermissionChange: (granted) => this.callbacks.onPermissionChange?.(granted),
      onWakeWord: () => this.callbacks.onWakeWord?.(),
    });
  }

  /** Register UI callbacks (from AppShell or ChatPanel).
   *  Phase 116: Pass null/empty object to CLEAR callbacks (previously
   *  spread-merge meant {} was a no-op, so the intended clear at
   *  AppShell.tsx:178 did nothing). */
  setCallbacks(callbacks: VoiceControllerCallbacks): void {
    if (callbacks && Object.keys(callbacks).length > 0) {
      this.callbacks = { ...this.callbacks, ...callbacks };
    } else {
      this.callbacks = {};
    }
  }

  /** Subscribe to Orb audio level updates (returns unsubscribe). */
  subscribeOrbAudio(callback: (level: number) => void): () => void {
    this.orbAudioCallbacks.add(callback);
    return () => this.orbAudioCallbacks.delete(callback);
  }

  /** Subscribe to Orb state updates (returns unsubscribe). */
  subscribeOrbState(callback: (state: NexOrbState) => void): () => void {
    this.orbStateCallbacks.add(callback);
    callback(this.orbStateRef.current); // emit current
    return () => this.orbStateCallbacks.delete(callback);
  }

  /** Get current values (for refs in Orb). */
  get orbState(): NexOrbState { return this.orbStateRef.current; }
  get orbAudioLevel(): number { return this.orbAudioRef.current; }

  /** Start always-ready voice (enable mic + STT). */
  async start(): Promise<void> {
    await voiceService.startListening();
  }

  /** Stop voice (but keep mic if enabled). */
  stop(): void {
    voiceService.stopListening();
  }

  /** Toggle voice on/off. */
  async toggle(): Promise<void> {
    if (voiceService.isListening) {
      this.stop();
    } else {
      await this.start();
    }
  }

  /** Phase 116: Set voice mode (continuous / push-to-talk / disabled) */
  setMode(mode: VoiceMode): void {
    voiceService.setMode(mode);
  }

  /** Phase 116: Get current voice mode */
  get mode(): VoiceMode {
    return voiceService.mode;
  }

  // Phase 18 (P2-6 fix): REMOVED `speak(text: string)` method.
  // Was `voiceService.speak(text)` — but voiceService.speak() was removed
  // (dead code — no production caller invoked voiceController.speak()).
  // Real TTS is handled EXCLUSIVELY by the main-side Piper pipeline:
  //   NexChatPanel.speakResponseIfVoice → voiceConversationSpeak IPC
  //   → nex-voice-conversation.speakResponse → local-voice-engine.speak
  //   → piper → voice-tts-audio IPC → App.tsx Audio playback.
  // See voice-service.ts P2-6 comment block for the full reference search.

  // Phase 18 (P2-6 fix): REMOVED `stopSpeaking()` method.
  // Was `voiceService.stopSpeaking()` — but voiceService.stopSpeaking() is
  // now a no-op (kept only because dispose() calls it). Real TTS cancellation
  // is handled by the `voiceConversationStopSpeaking` IPC (main process).
  // The only external caller of voiceController.stopSpeaking() was the dead
  // VoiceCenterPanel.tsx — no live caller exists.

  /**
   * Chat sets 'thinking' while AI processes.
   *
   * Phase 18 (P2-2 fix): when `thinking` is false, only clear the 'chat'
   * condition if it's currently 'thinking' — NOT if it's 'error'. The
   * chat 'error' flash (set in NexChatPanel's catch block + 1500ms
   * scheduleConditionClear timer) would otherwise be immediately wiped
   * by this call when `isGenerating` transitions to false in the finally
   * block, defeating the 1500ms error flash UX. By checking the current
   * state before clearing, we preserve the error flash until its 1500ms
   * timer fires naturally.
   */
  setThinking(thinking: boolean): void {
    if (thinking) voiceService.setCondition('chat', 'thinking');
    else {
      // Only clear if currently 'thinking' — don't wipe 'error' flash
      const currentState = voiceService.state;
      if (currentState !== 'error') {
        voiceService.clearCondition('chat');
      }
    }
  }

  /**
   * Set a named condition state on the VoiceService. Used by the main-side
   * conversation bridge to drive the Orb with main-side states.
   * The highest-priority active condition wins (see STATE_PRIORITY in voice-service).
   */
  setCondition(key: string, state: VoiceState): void {
    voiceService.setCondition(key, state);
  }

  /** Clear a named condition state. */
  clearCondition(key: string): void {
    voiceService.clearCondition(key);
  }

  /** Full cleanup on app shutdown. */
  dispose(): void {
    voiceService.dispose();
    this.orbAudioCallbacks.clear();
    this.orbStateCallbacks.clear();
    this.callbacks = {}; // Phase 116: clear callbacks too
    this.orbStateRef.current = 'idle';
    this.orbAudioRef.current = 0;
  }

  // ── Internal ──

  private handleStateChange(state: VoiceState): void {
    const orbState = toOrbState(state);
    // Phase 18 (BUG-37): enforce the Orb state machine. Validate the
    // transition via `safeOrbTransition()` before applying it. If the
    // transition is invalid per the relaxed VALID_TRANSITIONS graph in
    // orb-state.ts, the function returns the CURRENT state (blocking the
    // invalid transition) and logs:
    //   `[ORB_STATE] Invalid transition blocked: <from> → <to>`
    //
    // This is the SECOND enforcement layer (the first is in
    // voiceService.recomputeState). Both layers enforce because
    // recomputeState fires first (when the condition is set), then
    // onStateChange fires (when the state actually changes) →
    // handleStateChange. In normal operation, recomputeState already
    // validated, so handleStateChange's validation is a no-op. But if
    // a caller directly mutates voiceService._state (bypassing
    // recomputeState) OR if a future code path calls handleStateChange
    // directly, this layer catches invalid transitions too.
    const validated = safeOrbTransition(this.orbStateRef.current, orbState);
    if (validated !== this.orbStateRef.current) {
      this.orbStateRef.current = validated;
      this.orbStateCallbacks.forEach((cb) => cb(validated));
      this.callbacks.onOrbStateChange?.(validated);
    }
    // If validated === this.orbStateRef.current, the transition was blocked
    // — the warning was already logged by safeOrbTransition. We keep the
    // current state (do NOT update orbStateRef, do NOT fire callbacks).
  }

  private handleAudioLevel(level: number): void {
    this.orbAudioRef.current = level;
    this.orbAudioCallbacks.forEach((cb) => cb(level));
    this.callbacks.onOrbAudioLevel?.(level);
    // [ORB_AUDIO] — log when controller receives audio level (throttled)
    if (!this._audioLogCount) this._audioLogCount = 0;
    this._audioLogCount++;
    if (this._audioLogCount % 60 === 0) {
      console.log(`[ORB_AUDIO] VoiceController: level=${level.toFixed(4)} orbAudioRef=${this.orbAudioRef.current.toFixed(4)} subscribers=${this.orbAudioCallbacks.size}`);
    }
  }
}

// Singleton
export const voiceController = new VoiceController();
