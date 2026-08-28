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
  /** Called when TTS has synthesized audio — the renderer should play this file */
  onTTSAudioReady?: (audioFilePath: string, text: string) => void;
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

  // Pipeline diagnostics
  private audioFramesCaptured = 0;
  private lastTranscription = '';
  private lastInference = '';
  private lastTTS = '';
  private isTranscribing = false;

  constructor(vadConfig?: Partial<VADConfig>) {
    this.vad = new VoiceActivityDetector(vadConfig);
    // Wire VAD events: when speech ends (silence after speech), trigger
    // transcription by stopping the stream → getting the transcript →
    // calling onFinalTranscript → the conversation handler picks it up.
    this.vad.onEvent((event) => {
      this.callbacks.onVADStateChange?.(event);
      if (event.state === 'silence' && this.sttActive && !this.isTranscribing) {
        // Speech ended — transcribe what was captured
        this.handleSpeechEnd().catch((err) => {
          console.warn(`[VOICE_PIPELINE] handleSpeechEnd error: ${err?.message}`);
        });
      }
    });
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
    if (this.state !== state) {
      this.state = state;
      this.callbacks.onStateChange?.(state);
      this.logPipeline();
    }
  }

  /**
   * Feed audio level from the renderer (mic capture). This drives VAD.
   * When VAD detects speech→silence transition, handleSpeechEnd() is called.
   */
  feedAudioLevel(level: number): void {
    this.callbacks.onAudioLevel?.(level);
    this.vad.feed(level);
  }

  /**
   * Feed an audio chunk (Buffer) from the renderer to the STT provider.
   * The renderer captures mic audio and sends it via IPC; this method
   * forwards it to the whisper provider's streaming buffer.
   */
  feedAudioChunk(chunk: Buffer): void {
    this.audioFramesCaptured++;
    if (this.sttProvider && this.sttActive) {
      try {
        this.sttProvider.feedAudioChunk(chunk);
      } catch (err: any) {
        console.warn(`[VOICE_PIPELINE] feedAudioChunk error: ${err?.message}`);
      }
    }
  }

  async startListening(): Promise<void> {
    if (this.sttActive) return;
    if (!this.sttProvider) { this.callbacks.onError?.('No STT provider registered'); return; }
    if (!this.sttProvider.isAvailable()) {
      try { await this.sttProvider.init(); }
      catch (err: any) { this.callbacks.onError?.(`STT init failed: ${err.message}`); return; }
    }
    // Start the STT provider's stream (begins collecting audio chunks)
    try {
      await this.sttProvider.startStream();
      console.log(`[VOICE_PIPELINE] STT stream started`);
    } catch (err: any) {
      console.warn(`[VOICE_PIPELINE] STT startStream failed: ${err?.message} — continuing without stream`);
    }
    this.sttActive = true;
    this.audioFramesCaptured = 0;
    this.setState('listening');
    this.logPipeline();
  }

  async stopListening(): Promise<void> {
    if (!this.sttActive) return;
    this.sttActive = false;
    if (this.sttProvider) {
      try {
        const result = await this.sttProvider.stopStream();
        if (result.text) {
          this.lastTranscription = result.text;
          this.callbacks.onFinalTranscript?.(result.text);
        }
      } catch { /* best-effort */ }
    }
    this.setState('idle');
  }

  /**
   * Handle speech end (VAD detected silence after speech).
   * Stops the stream, gets the transcript, and emits it via onFinalTranscript.
   * The conversation handler (NexVoiceConversation) picks up the transcript
   * and routes it to the AI model + TTS.
   */
  private async handleSpeechEnd(): Promise<void> {
    if (!this.sttProvider || !this.sttActive || this.isTranscribing) return;
    this.isTranscribing = true;
    this.setState('thinking'); // listening → thinking (transcribing)

    try {
      // Stop the current stream to flush the audio buffer
      const result = await this.sttProvider.stopStream();
      if (result.text && result.text.trim()) {
        this.lastTranscription = result.text;
        console.log(`[VOICE_PIPELINE] Transcription: "${result.text}"`);
        // Emit the transcript to the conversation handler
        this.callbacks.onFinalTranscript?.(result.text);
      } else {
        console.log(`[VOICE_PIPELINE] Transcription empty — no speech detected`);
      }
    } catch (err: any) {
      console.warn(`[VOICE_PIPELINE] Transcription failed: ${err?.message}`);
      this.callbacks.onError?.(`Transcription failed: ${err.message}`);
    } finally {
      this.isTranscribing = false;
      // Restart listening for the next utterance (if still active)
      if (this.sttActive) {
        try {
          await this.sttProvider.startStream();
          this.setState('listening');
        } catch (err: any) {
          console.warn(`[VOICE_PIPELINE] Restart stream failed: ${err?.message}`);
          this.setState('listening');
        }
      } else {
        this.setState('idle');
      }
    }
  }

  async transcribeFile(audioPath: string, opts?: STTOptions): Promise<STTResult> {
    if (!this.sttProvider) return { success: false, text: '', error: 'No STT provider registered' };
    const result = await this.sttProvider.transcribeFile(audioPath, opts);
    if (result.text) this.lastTranscription = result.text;
    return result;
  }

  async speak(text: string, opts?: TTSOptions): Promise<void> {
    if (!text.trim()) return;
    this.lastTTS = text;
    if (!this.ttsProvider) { this.callbacks.onError?.('No TTS provider registered'); return; }
    if (!this.ttsProvider.isAvailable()) {
      try { await this.ttsProvider.init(); }
      catch (err: any) { this.callbacks.onError?.(`TTS init failed: ${err.message}`); return; }
    }
    const wasListening = this.sttActive;
    if (wasListening) await this.stopListening();
    this.ttsActive = true;
    this.setState('speaking');
    console.log(`[VOICE_PIPELINE] TTS speaking: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
    try {
      const result = await this.ttsProvider.synthesize(text, opts);
      // CRITICAL: emit the audio file path so the renderer can play it.
      // Previously the result was ignored — TTS synthesized the WAV file
      // but nobody played it.
      if (result.success && result.audioFilePath) {
        console.log(`[VOICE_PIPELINE] TTS audio ready: ${result.audioFilePath}`);
        this.callbacks.onTTSAudioReady?.(result.audioFilePath, text);
      } else if (!result.success) {
        console.warn(`[VOICE_PIPELINE] TTS synthesis failed: ${result.error}`);
        this.callbacks.onError?.(`TTS synthesis failed: ${result.error}`);
      }
    }
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
    if (thinking) {
      this.lastInference = 'thinking...';
      this.setState('thinking');
    } else {
      this.setState(this.sttActive ? 'listening' : 'idle');
    }
  }

  /**
   * Called by the conversation handler after the AI model produces a response.
   * Stores the response text and triggers TTS.
   */
  onInferenceResult(text: string): void {
    this.lastInference = text;
    console.log(`[VOICE_PIPELINE] Inference result: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
  }

  setMicPermission(granted: boolean | null): void {
    this.micEnabled = granted === true;
    this.callbacks.onPermissionChange?.(granted);
  }

  /**
   * Log the [VOICE_PIPELINE] diagnostic block showing the current state of
   * the voice pipeline: state, audio frames captured, last transcription,
   * last inference, last TTS output.
   */
  logPipeline(): void {
    console.log(`[VOICE_PIPELINE]`);
    console.log(`  state=${this.state}`);
    console.log(`  audioFramesCaptured=${this.audioFramesCaptured}`);
    console.log(`  lastTranscription=${this.lastTranscription ? `"${this.lastTranscription.substring(0, 60)}"` : '(none)'}`);
    console.log(`  lastInference=${this.lastInference ? `"${this.lastInference.substring(0, 60)}"` : '(none)'}`);
    console.log(`  lastTTS=${this.lastTTS ? `"${this.lastTTS.substring(0, 60)}"` : '(none)'}`);
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
