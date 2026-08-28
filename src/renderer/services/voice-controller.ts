/**
 * NEX AI — Voice Controller (Phase 30)
 *
 * Connects VoiceService to NexOrb and NexChatPanel.
 * This is the ONLY module that knows about both voice + UI.
 * Orb receives: state + audioLevel (via ref, not React state).
 * Chat receives: final transcripts (same pipeline as typed input).
 */

import { voiceService, type VoiceState } from './voice-service';
import type { NexOrbState } from '../components/orb/orb-state';

/** Map VoiceState to NexOrbState (they share the same names). */
function toOrbState(state: VoiceState): NexOrbState {
  return state; // 1:1 mapping — same state names
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
    });
  }

  /** Register UI callbacks (from AppShell or ChatPanel). */
  setCallbacks(callbacks: VoiceControllerCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
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
    // [ORB_AUDIO_DEBUG] — log when controller receives audio level (throttled)
    if (!this._audioLogCount) this._audioLogCount = 0;
    this._audioLogCount++;
    if (this._audioLogCount % 60 === 0) {
      console.log(`[ORB_AUDIO_DEBUG] VoiceController: level=${level.toFixed(4)} orbAudioRef=${this.orbAudioRef.current.toFixed(4)} subscribers=${this.orbAudioCallbacks.size}`);
    }
  }
}

// Singleton
export const voiceController = new VoiceController();
