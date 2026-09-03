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
import type { NexOrbState } from '../components/orb/orb-state';

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

  /** Speak text (TTS). */
  speak(text: string): void {
    voiceService.speak(text);
  }

  /** Stop TTS. */
  stopSpeaking(): void {
    voiceService.stopSpeaking();
  }

  /** Chat sets 'thinking' while AI processes. */
  setThinking(thinking: boolean): void {
    if (thinking) voiceService.setCondition('chat', 'thinking');
    else voiceService.clearCondition('chat');
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
    this.orbStateRef.current = orbState;
    this.orbStateCallbacks.forEach((cb) => cb(orbState));
    this.callbacks.onOrbStateChange?.(orbState);
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
