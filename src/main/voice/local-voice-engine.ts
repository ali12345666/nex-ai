/**
 * NEX AI — Local Voice Engine (Phase 41)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ARCHITECTURE
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │                   LocalVoiceEngine                        │
 *   │  (orchestrates: audio → VAD → STT → TTS → callbacks)     │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  AudioManager        getUserMedia + AudioContext + VAD    │
 *   │  STTProvider         LocalWhisperProvider (whisper.cpp)  │
 *   │  TTSProvider         LocalPiperProvider (piper binary)  │
 *   └──────────────────────────────────────────────────────────┘
 *
 * All providers implement the STTProvider/TTSProvider interfaces.
 * The engine is LOCAL-FIRST — no cloud API calls anywhere.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import type { STTResult, STTOptions, TTSResult, TTSOptions } from '../ai/voice-types';

// ─── STT Provider Interface ────────────────────────────────────────────────

export interface STTProvider {
  readonly name: string;
  readonly isLocal: boolean;
  isAvailable(): boolean;
  init(): Promise<void>;
  transcribeFile(audioPath: string, opts?: STTOptions): Promise<STTResult>;
  startStream(opts?: STTOptions): Promise<void>;
  feedAudioChunk(audioChunk: Buffer): void;
  stopStream(): Promise<STTResult>;
  shutdown(): Promise<void>;
}

// ─── TTS Provider Interface ────────────────────────────────────────────────

export interface TTSProvider {
  readonly name: string;
  readonly isLocal: boolean;
  isAvailable(): boolean;
  init(): Promise<void>;
  synthesize(text: string, opts?: TTSOptions): Promise<TTSResult>;
  listVoices(): Promise<Array<{ name: string; language: string; gender?: string }>>;
  stop(): void;
  shutdown(): Promise<void>;
}

// ─── Voice Activity Detection (VAD) ────────────────────────────────────────

export type VADState = 'silence' | 'speech' | 'transition';

export interface VADConfig {
  silenceThreshold: number;
  silenceDurationMs: number;
  speechDurationMs: number;
  noiseFloor: number;
}

export const DEFAULT_VAD_CONFIG: VADConfig = {
  silenceThreshold: 0.02,
  silenceDurationMs: 800,
  speechDurationMs: 300,
  noiseFloor: 0.015,
};

export interface VADEvent {
  state: VADState;
  audioLevel: number;
  isSpeech: boolean;
  timestamp: number;
}

export class VoiceActivityDetector {
  private config: VADConfig;
  private state: VADState = 'silence';
  private speechStartMs: number | null = null;
  private silenceStartMs: number | null = null;
  private smoothedLevel = 0;
  private callbacks: Array<(event: VADEvent) => void> = [];

  constructor(config: Partial<VADConfig> = {}) {
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
  }

  feed(audioLevel: number): VADState {
    const speed = audioLevel > this.smoothedLevel ? 0.4 : 0.08;
    this.smoothedLevel += (audioLevel - this.smoothedLevel) * speed;
    const now = Date.now();
    const isLoud = this.smoothedLevel > this.config.silenceThreshold;
    if (isLoud) {
      this.silenceStartMs = null;
      if (this.state === 'silence' || this.state === 'transition') {
        if (this.speechStartMs === null) {
          this.speechStartMs = now;
          this.state = 'transition';
        }
        if (this.state === 'transition' && now - this.speechStartMs >= this.config.speechDurationMs) {
          this.state = 'speech';
          this.emit('speech');
        }
      }
    } else {
      this.speechStartMs = null;
      // Check for silence transition from 'speech' OR 'transition' (after speech)
      if (this.state === 'speech' || this.state === 'transition') {
        if (this.silenceStartMs === null) {
          this.silenceStartMs = now;
          this.state = 'transition';
        }
        if (now - this.silenceStartMs >= this.config.silenceDurationMs) {
          this.state = 'silence';
          this.emit('silence');
        }
      }
    }
    return this.state;
  }

  get currentLevel(): number { return this.smoothedLevel; }
  get isSpeech(): boolean { return this.state === 'speech'; }

  onEvent(callback: (event: VADEvent) => void): () => void {
    this.callbacks.push(callback);
    return () => { this.callbacks = this.callbacks.filter((cb) => cb !== callback); };
  }

  private emit(state: VADState): void {
    const event: VADEvent = { state, audioLevel: this.smoothedLevel, isSpeech: state === 'speech', timestamp: Date.now() };
    this.callbacks.forEach((cb) => cb(event));
  }

  reset(): void {
    this.state = 'silence';
    this.speechStartMs = null;
    this.silenceStartMs = null;
    this.smoothedLevel = 0;
  }
}

// ─── Local Voice Engine ────────────────────────────────────────────────────

export type VoiceEngineState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error' | 'offline';

export interface VoiceEngineCallbacks {
  onStateChange?: (state: VoiceEngineState) => void;
  onAudioLevel?: (level: number) => void;
  onVADStateChange?: (event: VADEvent) => void;
  onPartialTranscript?: (text: string) => void;
  onFinalTranscript?: (text: string) => void;
  onError?: (message: string) => void;
  onPermissionChange?: (granted: boolean | null) => void;
}

export class LocalVoiceEngine {
  private sttProvider: STTProvider | null = null;
  private ttsProvider: TTSProvider | null = null;
  private vad: VoiceActivityDetector;
  private callbacks: VoiceEngineCallbacks = {};
  private state: VoiceEngineState = 'idle';
  private sttActive = false;
  private ttsActive = false;
  private micEnabled = false;

  constructor(vadConfig?: Partial<VADConfig>) {
    this.vad = new VoiceActivityDetector(vadConfig);
  }

  setSTTProvider(provider: STTProvider): void { this.sttProvider = provider; }
  setTTSProvider(provider: TTSProvider): void { this.ttsProvider = provider; }
  getSTTProvider(): STTProvider | null { return this.sttProvider; }
  getTTSProvider(): TTSProvider | null { return this.ttsProvider; }
  get hasLocalSTT(): boolean { return !!this.sttProvider?.isLocal && this.sttProvider.isAvailable(); }
  get hasLocalTTS(): boolean { return !!this.ttsProvider?.isLocal && this.ttsProvider.isAvailable(); }
  setCallbacks(callbacks: VoiceEngineCallbacks): void { this.callbacks = { ...this.callbacks, ...callbacks }; }
  get currentState(): VoiceEngineState { return this.state; }
  get isListening(): boolean { return this.sttActive; }
  get isSpeaking(): boolean { return this.ttsActive; }

  private setState(state: VoiceEngineState): void {
    if (this.state !== state) { this.state = state; this.callbacks.onStateChange?.(state); }
  }

  feedAudioLevel(level: number): void {
    this.callbacks.onAudioLevel?.(level);
    this.vad.feed(level);
  }

  async startListening(): Promise<void> {
    if (this.sttActive) return;
    if (!this.sttProvider) { this.callbacks.onError?.('No STT provider registered'); return; }
    if (!this.sttProvider.isAvailable()) {
      try { await this.sttProvider.init(); }
      catch (err: any) { this.callbacks.onError?.(`STT init failed: ${err.message}`); return; }
    }
    this.sttActive = true;
    this.setState('listening');
  }

  async stopListening(): Promise<void> {
    if (!this.sttActive) return;
    this.sttActive = false;
    if (this.sttProvider) {
      try {
        const result = await this.sttProvider.stopStream();
        if (result.text) this.callbacks.onFinalTranscript?.(result.text);
      } catch { /* best-effort */ }
    }
    this.setState('idle');
  }

  async transcribeFile(audioPath: string, opts?: STTOptions): Promise<STTResult> {
    if (!this.sttProvider) return { success: false, text: '', error: 'No STT provider registered' };
    return this.sttProvider.transcribeFile(audioPath, opts);
  }

  async speak(text: string, opts?: TTSOptions): Promise<void> {
    if (!text.trim()) return;
    if (!this.ttsProvider) { this.callbacks.onError?.('No TTS provider registered'); return; }
    if (!this.ttsProvider.isAvailable()) {
      try { await this.ttsProvider.init(); }
      catch (err: any) { this.callbacks.onError?.(`TTS init failed: ${err.message}`); return; }
    }
    const wasListening = this.sttActive;
    if (wasListening) await this.stopListening();
    this.ttsActive = true;
    this.setState('speaking');
    try { await this.ttsProvider.synthesize(text, opts); }
    catch (err: any) { this.callbacks.onError?.(`TTS failed: ${err.message}`); }
    this.ttsActive = false;
    this.setState(wasListening ? 'listening' : 'idle');
    if (wasListening) await this.startListening();
  }

  stopSpeaking(): void {
    if (this.ttsProvider) this.ttsProvider.stop();
    this.ttsActive = false;
    if (this.state === 'speaking') this.setState('idle');
  }

  setThinking(thinking: boolean): void {
    if (thinking) this.setState('thinking');
    else this.setState(this.sttActive ? 'listening' : 'idle');
  }

  setMicPermission(granted: boolean | null): void {
    this.micEnabled = granted === true;
    this.callbacks.onPermissionChange?.(granted);
  }

  async dispose(): Promise<void> {
    await this.stopListening();
    this.stopSpeaking();
    if (this.sttProvider) { try { await this.sttProvider.shutdown(); } catch {} }
    if (this.ttsProvider) { try { await this.ttsProvider.shutdown(); } catch {} }
    this.vad.reset();
    this.state = 'idle';
  }
}

let _engine: LocalVoiceEngine | null = null;
export function getLocalVoiceEngine(): LocalVoiceEngine {
  if (!_engine) _engine = new LocalVoiceEngine();
  return _engine;
}
export function setLocalVoiceEngine(engine: LocalVoiceEngine): void { _engine = engine; }
