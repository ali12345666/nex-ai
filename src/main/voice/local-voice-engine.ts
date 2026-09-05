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
  /**
   * Called when TTS has synthesized audio — the renderer should play this file.
   *
   * Phase 16: `requestId` is a monotonic ID identifying this TTS turn. It
   * travels through the whole pipeline (engine → main IPC → renderer →
   * audio element → renderer IPC back → main → conversation handler) so that
   * stale TTS (cancelled by Stop or superseded by a newer request) can be
   * discarded at every layer. See BUG-12 / BUG-26 fixes.
   */
  onTTSAudioReady?: (audioFilePath: string, text: string, requestId: number) => void;
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

  // Phase 16: monotonic TTS request ID for stale detection / race protection
  // (BUG-12 + BUG-26). Incremented on every speak() call and on every stopSpeaking().
  // The conversation handler (NexVoiceConversation) reads/sets this via the
  // `currentTtsRequestId` getter/setter so it can match the renderer's
  // `voice-tts-ended` signal to the correct in-flight request.
  private _currentTtsRequestId = 0;

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

  /**
   * Phase 16: The current TTS request ID. The conversation handler sets this
   * to its own counter before calling speak(), and reads it to match the
   * renderer's `voice-tts-ended` signal. Stop/cancel bumps this to
   * invalidate any in-flight synthesis.
   */
  get currentTtsRequestId(): number { return this._currentTtsRequestId; }
  set currentTtsRequestId(value: number) { this._currentTtsRequestId = value; }

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

  /**
   * Speak text via TTS (Piper).
   *
   * Phase 16 (BUG-12 + BUG-26 fixes):
   *
   * - `opts` may carry an optional `requestId` (via the `TTSOptions.requestId`
   *   field added in Phase 16). When the conversation handler passes one,
   *   it is used as the monotonic ID for this TTS turn. When omitted
   *   (legacy callers like InteractionLoopManager.speakText), the engine
   *   auto-increments its internal counter.
   *
   * - BUG-12: This method NO LONGER transitions state back to
   *   `listening`/`idle` and NO LONGER calls `startListening()` after
   *   synthesis completes. The conversation handler owns the post-speak
   *   state transition: it awaits the renderer's `voice-tts-ended` signal
   *   (via the `voice-tts-ended` IPC) and only then transitions to
   *   `listening` and restarts STT. This prevents the mic from hearing
   *   the still-playing TTS audio (feedback loop).
   *
   * - BUG-26 A: After `synthesize()` resolves, we check both `ttsActive`
   *   (false if `stopSpeaking()` was called during synthesis) and the
   *   request ID (bumped by `stopSpeaking()` or a newer `speak()` call).
   *   If either indicates this request is stale, we DISCARD the result
   *   — `onTTSAudioReady` is NOT fired, no audio file path is sent to the
   *   renderer, no audio plays.
   *
   * Returns `true` if audio was successfully synthesized and handed to the
   * renderer (`onTTSAudioReady` fired). Returns `false` if synthesis failed
   * OR if the result was discarded as stale.
   */
  async speak(text: string, opts?: TTSOptions): Promise<boolean> {
    if (!text.trim()) return false;
    this.lastTTS = text;
    if (!this.ttsProvider) { this.callbacks.onError?.('No TTS provider registered'); return false; }
    if (!this.ttsProvider.isAvailable()) {
      try { await this.ttsProvider.init(); }
      catch (err: any) { this.callbacks.onError?.(`TTS init failed: ${err.message}`); return false; }
    }
    const wasListening = this.sttActive;
    if (wasListening) await this.stopListening();
    this.ttsActive = true;

    // Phase 16: assign the request ID for this turn.
    // If the caller passed opts.requestId, use it (the conversation handler
    // owns the ID space so it can match it later). Otherwise auto-increment.
    const requestId = opts?.requestId ?? (++this._currentTtsRequestId);
    this._currentTtsRequestId = requestId;

    this.setState('speaking');
    console.log(`[VOICE_PIPELINE] TTS speaking (req=${requestId}): "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);

    let audioReady = false;
    try {
      const result = await this.ttsProvider.synthesize(text, opts);

      // ── BUG-26 A FIX: stale-detection guard ───────────────────────────
      // If stopSpeaking() was called during synthesis, ttsActive is false.
      // If a newer speak() or stopSpeaking() ran, the request ID was bumped.
      // In either case, this synthesis result is stale — DISCARD it. Do NOT
      // fire onTTSAudioReady. The renderer never receives the audio path.
      if (!this.ttsActive || this._currentTtsRequestId !== requestId) {
        console.log(`[VOICE_PIPELINE] TTS synthesis completed for req=${requestId} but stale (ttsActive=${this.ttsActive}, current=${this._currentTtsRequestId}) — discarding`);
        this.ttsActive = false;
        return false;
      }

      if (result.success && result.audioFilePath) {
        // CRITICAL: emit the audio file path so the renderer can play it.
        // The requestId travels to the renderer so it can decide whether
        // to actually play (a newer request would supersede this one).
        console.log(`[VOICE_PIPELINE] TTS audio ready (req=${requestId}): ${result.audioFilePath}`);
        this.callbacks.onTTSAudioReady?.(result.audioFilePath, text, requestId);
        audioReady = true;
      } else if (!result.success) {
        console.warn(`[VOICE_PIPELINE] TTS synthesis failed: ${result.error}`);
        this.callbacks.onError?.(`TTS synthesis failed: ${result.error}`);
      }
    }
    catch (err: any) {
      this.callbacks.onError?.(`TTS failed: ${err.message}`);
    }

    this.ttsActive = false;

    // ── BUG-12 FIX ──────────────────────────────────────────────────────
    // Do NOT transition state back to `listening`/`idle` here, and do NOT
    // call `startListening()`. The conversation handler owns the post-speak
    // state transition — it awaits `waitForTtsPlayback(requestId)` (which
    // resolves when the renderer sends `voice-tts-ended` after the audio
    // element fires `onended`), THEN transitions to `listening` and restarts
    // STT. This prevents the mic from hearing the still-playing TTS audio.
    //
    // Legacy callers (InteractionLoopManager.speakText) that don't go
    // through the conversation handler will leave the engine in the
    // `speaking` state until they explicitly call `setThinking(false)` or
    // `startListening()`. This matches the old behavior closely enough
    // for the legacy debug panel (BasicInteractionPanel) and is the
    // cleanest separation of concerns.
    return audioReady;
  }

  stopSpeaking(): void {
    if (this.ttsProvider) this.ttsProvider.stop();
    this.ttsActive = false;
    // Phase 16 (BUG-26 A): bump the request ID so any in-flight synthesis
    // (Piper still running) is invalidated. When synthesize() resolves,
    // the stale guard in speak() will discard its result.
    this._currentTtsRequestId++;
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
