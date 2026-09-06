/**
 * NEX AI — Voice Service (Phase 30 + Phase 116 JARVIS)
 *
 * Always-ready voice system with Web Audio API microphone analysis +
 * browser SpeechRecognition for STT + SpeechSynthesis for TTS.
 *
 * Phase 116 JARVIS additions:
 *   - Continuous Conversation mode (auto-restart listening after TTS)
 *   - Push-to-talk mode (manual start/stop)
 *   - Disabled mode (no voice)
 *   - Wake Word detection ("NEX") — simple regex-based, fully local
 *   - VAD (Voice Activity Detection) for auto speech-end detection
 *   - Barge-in support (stop TTS when user starts speaking)
 *
 * Architecture:
 *   VoiceService (this module)
 *       ├── microphone: getUserMedia + AudioContext + AnalyserNode
 *       ├── audio level: RMS → noise gate → attack/release smoothing → 0..1
 *       ├── VAD: speech/silence detection → auto-transcribe
 *       ├── STT: webkitSpeechRecognition (fallback) / whisper (main process)
 *       ├── TTS: SpeechSynthesis (local OS voices — offline capable)
 *       ├── Wake Word: regex match on partial transcripts
 *       └── state: state machine → callbacks → VoiceController
 */

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error' | 'offline' | 'working' | 'success' | 'cancelled';

// Phase 116: Voice mode controls how listening works
export type VoiceMode = 'continuous' | 'push-to-talk' | 'disabled';

export interface VoiceConfig {
  noiseFloor: number;
  attackSpeed: number;
  releaseSpeed: number;
  language: string;
  /** Phase 116: Wake word to listen for before activating commands */
  wakeWord: string;
  /** Phase 116: VAD silence threshold for speech-end detection */
  vadSilenceThreshold: number;
  /** Phase 116: VAD silence duration (ms) before declaring speech ended */
  vadSilenceDurationMs: number;
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  noiseFloor: 0.015,
  attackSpeed: 0.4,
  releaseSpeed: 0.08,
  language: 'en-US',
  wakeWord: 'nex',
  vadSilenceThreshold: 0.02,
  vadSilenceDurationMs: 1200,
};

export interface VoiceCallbacks {
  onStateChange?: (state: VoiceState) => void;
  onAudioLevel?: (level: number) => void;
  onPartialTranscript?: (text: string) => void;
  onFinalTranscript?: (text: string) => void;
  onPermissionChange?: (granted: boolean | null) => void;
  onError?: (message: string) => void;
  /** Phase 116: Called when wake word is detected */
  onWakeWord?: () => void;
}

const STATE_PRIORITY: Record<VoiceState, number> = {
  error: 8, offline: 7, speaking: 6, working: 5, thinking: 4, listening: 3, success: 2, cancelled: 2, idle: 1,
};

// Phase 18 (BUG-37): Import the Orb state-machine enforcement function.
// `recomputeState()` now validates every state transition via
// `safeOrbTransition()` before applying it. Previously the state machine
// in orb-state.ts was documentation-only — `safeOrbTransition` was defined
// but never called, so invalid transitions silently happened. Now blocked
// transitions are rejected and a diagnostic warning is logged:
//   `[ORB_STATE] Invalid transition blocked: <from> → <to>`
import { safeOrbTransition, type NexOrbState } from '../components/orb/orb-state';

export class VoiceService {
  private config: VoiceConfig;
  private callbacks: VoiceCallbacks = {};
  private _state: VoiceState = 'idle';
  private _stateConditions = new Map<string, VoiceState>();
  private _stream: MediaStream | null = null;
  private _audioContext: AudioContext | null = null;
  private _analyser: AnalyserNode | null = null;
  private _dataArray: Uint8Array<ArrayBuffer> | null = null;
  private _rafId: number | null = null;
  private _smoothedLevel = 0;
  private _micPermission: boolean | null = null;
  private _recognition: any = null;
  private _sttActive = false;
  private _shouldRestartSTT = false;
  // Phase 18 (P2-6 fix): REMOVED `_ttsActive` field.
  // The entire renderer-side TTS path (speak/stopSpeaking/_ttsActive/
  // _bargeInEnabled/isSpeaking) was dead — no production caller invoked
  // voiceController.speak() or voiceService.speak(). Real TTS flows
  // EXCLUSIVELY through the main-side Piper pipeline (voiceConversationSpeak
  // IPC → nex-voice-conversation.speakResponse → local-voice-engine.speak
  // → voice-tts-audio IPC → App.tsx Audio). The renderer-side barge-in
  // branch (processVAD line 269) was dead code that never fired because
  // _ttsActive was never set to true. See the P2-6 comment block in
  // voice-service.ts (former speak() location) for the full reference search.

  // Phase 116: Voice mode + wake word + VAD
  private _mode: VoiceMode = 'continuous';
  private _wakeWordDetected = false;
  private _wakeWordBuffer = '';
  private _vadState: 'silence' | 'speech' = 'silence';
  private _vadSilenceStart = 0;
  private _vadSpeechStart = 0;
  // Phase 18 (P2-6 fix): REMOVED `_bargeInEnabled` field.
  // The renderer-side barge-in path was dead (see P2-6 comment block).

  // PCM audio capture for LocalVoiceEngine (whisper STT)
  private _scriptProcessor: ScriptProcessorNode | null = null;
  private _chunksSent = 0;
  private _lastChunkSize = 0;
  private _ipcFeedingEnabled = false;
  private _audioProcessEventCount = 0;
  private _audioLevelLogCount = 0;

  constructor(config?: Partial<VoiceConfig>) {
    this.config = { ...DEFAULT_VOICE_CONFIG, ...config };
  }

  setCallbacks(callbacks: VoiceCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  get state(): VoiceState { return this._state; }
  get audioLevel(): number { return this._smoothedLevel; }
  get micPermission(): boolean | null { return this._micPermission; }
  get isListening(): boolean { return this._sttActive; }
  // Phase 18 (P2-6 fix): REMOVED `isSpeaking` getter.
  // Was `return this._ttsActive` — but `_ttsActive` was removed (always false).
  // No external caller used this getter (verified by reference search).
  get mode(): VoiceMode { return this._mode; }

  /** Phase 116: Set voice mode (continuous / push-to-talk / disabled) */
  setMode(mode: VoiceMode): void {
    const prevMode = this._mode;
    this._mode = mode;
    console.log(`[VOICE] Mode changed: ${prevMode} → ${mode}`);

    if (mode === 'disabled') {
      this.stopListening();
      this.stopSpeaking();
    } else if (mode === 'continuous' && prevMode !== 'continuous') {
      // Auto-start continuous listening
      this.startListening().catch(() => {});
    } else if (mode === 'push-to-talk' && prevMode === 'continuous') {
      // Stop continuous listening — user will push to talk
      this.stopListening();
    }
  }

  async enableMicrophone(): Promise<boolean> {
    if (this._stream) return true;
    try {
      this._micPermission = null; // pending
      console.log(`[VOICE] calling getUserMedia...`);
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this._micPermission = true;
      this.callbacks.onPermissionChange?.(true);
      console.log(`[VOICE] getUserMedia resolved — stream tracks: ${this._stream.getTracks().length}`);

      this._audioContext = new AudioContext();
      console.log(`[VOICE] AudioContext created — state: ${this._audioContext.state}`);

      // CRITICAL: AudioContext starts in 'suspended' state in Electron.
      if (this._audioContext.state === 'suspended') {
        console.log(`[VOICE] AudioContext suspended — calling resume()...`);
        try {
          await this._audioContext.resume();
          console.log(`[VOICE] AudioContext resumed — state: ${this._audioContext.state}`);
        } catch (err: any) {
          console.warn(`[VOICE] AudioContext resume failed: ${err?.message}`);
        }
      }

      const source = this._audioContext.createMediaStreamSource(this._stream);
      this._analyser = this._audioContext.createAnalyser();
      this._analyser.fftSize = 256;
      this._analyser.smoothingTimeConstant = 0.8;
      source.connect(this._analyser);
      this._dataArray = new Uint8Array(new ArrayBuffer(this._analyser.frequencyBinCount));

      // ── PCM audio capture for LocalVoiceEngine ──────────────────────────
      this._scriptProcessor = this._audioContext.createScriptProcessor(4096, 1, 1);
      console.log(`[VOICE] ScriptProcessorNode created — bufferSize: ${this._scriptProcessor.bufferSize}`);

      this._audioProcessEventCount = 0;
      this._scriptProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
        this._audioProcessEventCount++;
        if (!this._ipcFeedingEnabled) {
          if (this._audioProcessEventCount <= 3) {
            console.log(`[VOICE] onaudioprocess (#${this._audioProcessEventCount}) but IPC feeding disabled`);
          }
          return;
        }
        const inputBuffer = event.inputBuffer;
        const channelData = inputBuffer.getChannelData(0);

        // Downsample from 48kHz to 16kHz
        const downsampled = this.downsampleTo16k(channelData);

        // Convert Float32 to Int16 PCM
        const pcm16 = new Int16Array(downsampled.length);
        for (let i = 0; i < downsampled.length; i++) {
          const s = Math.max(-1, Math.min(1, downsampled[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Send the PCM chunk to the main process via IPC
        const chunkBuffer = pcm16.buffer;
        this._chunksSent++;
        this._lastChunkSize = chunkBuffer.byteLength;
        try {
          const ipcAvailable = !!(window as any).nexAPI?.voiceFeedAudioChunk;
          if (!ipcAvailable) {
            if (this._chunksSent <= 3) {
              console.warn(`[VOICE] voiceFeedAudioChunk NOT available on window.nexAPI!`);
            }
            return;
          }
          window.nexAPI!.voiceFeedAudioChunk!(chunkBuffer);
        } catch (err: any) {
          if (this._chunksSent <= 3) {
            console.warn(`[VOICE] voiceFeedAudioChunk error: ${err?.message}`);
          }
        }

        // Compute audio level (RMS) for VAD + Orb animation
        let sum = 0;
        for (let i = 0; i < downsampled.length; i++) {
          sum += downsampled[i] * downsampled[i];
        }
        const rms = Math.sqrt(sum / downsampled.length);
        const gated = rms < this.config.noiseFloor ? 0 : rms;
        const normalized = Math.min(1, gated * 4);
        const speed = normalized > this._smoothedLevel
          ? this.config.attackSpeed : this.config.releaseSpeed;
        this._smoothedLevel += (normalized - this._smoothedLevel) * speed;
        this.callbacks.onAudioLevel?.(this._smoothedLevel);
        try {
          window.nexAPI?.voiceFeedAudioLevel?.(this._smoothedLevel);
        } catch { /* best-effort */ }

        // Phase 116: VAD (Voice Activity Detection) — detect speech start/end
        this.processVAD(normalized);
      };
      source.connect(this._scriptProcessor);
      this._scriptProcessor.connect(this._audioContext.destination);
      console.log(`[VOICE] ScriptProcessorNode connected — source→processor→destination`);

      this.startAudioLoop();
      return true;
    } catch (err: any) {
      this._micPermission = false;
      this.callbacks.onPermissionChange?.(false);
      const msg = err.name === 'NotAllowedError' ? 'Microphone access denied'
        : err.name === 'NotFoundError' ? 'No microphone found'
        : `Microphone error: ${err.message}`;
      console.error(`[VOICE] enableMicrophone failed: ${msg} (name=${err.name})`);
      this.callbacks.onError?.(msg);
      return false;
    }
  }

  /**
   * Phase 116: Voice Activity Detection — detects speech start and end
   * based on audio level. When speech ends (silence after speech), we
   * know the user finished their sentence and can process the transcript.
   *
   * Phase 18 Stage 3 (AUDIO-NO-MUTE-TTS fix): skip VAD processing when the
   * engine is in 'speaking' state. This prevents TTS audio bleed from
   * updating the `_vadState` (harmless but wasteful, and prevents stale
   * 'speech' state from persisting after TTS ends). The main-side VAD
   * handles barge-in detection with its own higher threshold — the
   * renderer VAD is purely for the renderer-side speech/silence tracking
   * which is no longer used for any action (barge-in was removed in P2-6).
   *
   * The audio level is still sent to main unconditionally (via
   * `voiceFeedAudioLevel`) so the main-side VAD can detect barge-in. Only
   * the renderer-side `processVAD` computation is skipped.
   */
  private processVAD(level: number): void {
    // Phase 18 Stage 3: skip when engine is speaking (TTS in progress).
    if (this._stateConditions.get('engine') === 'speaking') return;

    const now = Date.now();
    const isLoud = level > this.config.vadSilenceThreshold;

    if (isLoud) {
      // Speech detected
      if (this._vadState === 'silence') {
        this._vadState = 'speech';
        this._vadSpeechStart = now;
        this._vadSilenceStart = 0;
        // Phase 18 (P2-6 fix): REMOVED the renderer-side barge-in branch.
        // Previously: `if (this._ttsActive && this._bargeInEnabled) {
        //   this.stopSpeaking(); if (this._mode === 'continuous' && !this._sttActive)
        //   { this.startSTT(); this.setCondition('mic', 'listening'); ... } }`
        // This was dead code — `_ttsActive` was never set to true (no caller
        // invoked voiceService.speak()). The renderer VAD cannot distinguish
        // user speech from TTS audio bleed (browser echo cancellation is
        // imperfect with speakers). Barge-in detection should be on the
        // MAIN side (where sttActive gates VAD) — see Phase 18 audit P1-1
        // for the recommended main-side barge-in fix (Stage 3, not yet
        // implemented). For now, the renderer VAD only transitions state —
        // it does NOT trigger barge-in. This is safe because the main-side
        // VAD (local-voice-engine.ts:199) is gated by `sttActive` and
        // `ttsActive` (engine.speak sets ttsActive=true during synthesis),
        // so the main side correctly suppresses transcription during TTS.
      }
    } else {
      // Silence detected
      if (this._vadState === 'speech') {
        if (this._vadSilenceStart === 0) {
          this._vadSilenceStart = now;
        }
        // If silence lasts long enough, declare speech ended
        if (now - this._vadSilenceStart >= this.config.vadSilenceDurationMs) {
          this._vadState = 'silence';
          console.log('[VOICE] VAD: speech ended (silence detected)');
        }
      }
    }
  }

  /**
   * Downsample Float32 audio from 48kHz to 16kHz by taking every 3rd sample.
   */
  private downsampleTo16k(input: Float32Array): Float32Array {
    const ratio = 3; // 48000 / 16000
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      output[i] = input[i * ratio];
    }
    return output;
  }

  /**
   * Enable/disable IPC feeding of PCM audio to the main process.
   */
  setIPCFeedingEnabled(enabled: boolean): void {
    this._ipcFeedingEnabled = enabled;
    if (enabled) {
      this._chunksSent = 0;
    }
    console.log(`[VOICE_AUDIO] IPC feeding ${enabled ? 'enabled' : 'disabled'}`);
  }

  async startListening(): Promise<void> {
    if (this._mode === 'disabled') return;
    if (!this._stream) {
      const ok = await this.enableMicrophone();
      if (!ok) { this.setCondition('mic', 'error'); return; }
    }
    // Phase 18 (P2-6 fix): REMOVED `if (this._ttsActive) this.stopSpeaking();`
    // — `_ttsActive` was removed (always false). Real TTS is on the main side.
    this.setIPCFeedingEnabled(true);
    this.startSTT();
    this.setCondition('mic', 'listening');
    this._shouldRestartSTT = true;
  }

  stopListening(): void {
    this.stopSTT();
    this.setIPCFeedingEnabled(false);
    this.clearCondition('mic');
    this._shouldRestartSTT = false;
  }

  // Phase 18 (P2-6 fix): REMOVED the `speak(text: string)` method.
  //
  // Reference search confirmed ZERO production callers of voiceService.speak()
  // or voiceController.speak(). The Phase 15 regression test
  // (tests/tools/test-phase-15-voice-unification.ts:165-177) explicitly
  // asserts `!foundSpeakCall` ("no renderer component calls
  // voiceController.speak()") — this is a TESTED invariant.
  //
  // The previous implementation was state-only (no audio) — it set
  // `_ttsActive = true`, setCondition('tts', 'speaking'), then a setTimeout
  // cleared both after `Math.max(500, text.length * 50)` ms. This was a
  // fake-completion path that ran in parallel with the main-side Piper
  // pipeline (voiceConversationSpeak IPC → nex-voice-conversation.speakResponse
  // → local-voice-engine.speak → voice-tts-audio → App.tsx Audio). It was
  // a source of STATE DESYNC (the 'tts' condition was set/cleared on a
  // different timeline than the real TTS playback).
  //
  // Real TTS is handled EXCLUSIVELY by the main-side Piper pipeline:
  //   NexChatPanel.speakResponseIfVoice → voiceConversationSpeak IPC
  //   → nex-voice-conversation.speakResponse() → local-voice-engine.speak()
  //   → piper → voice-tts-audio IPC → App.tsx Audio playback
  // The Orb's 'speaking' state is driven by the main-side
  // `voice-conversation-state` IPC → AppShell → voiceController.setCondition
  // ('engine', 'speaking'). No renderer-side TTS state is needed.

  /**
   * Phase 18 (P2-6 fix): stopSpeaking() is now a no-op.
   *
   * Previously this cleared `_ttsActive = false` + `clearCondition('tts')`.
   * Both are dead:
   *   - `_ttsActive` was removed (always false)
   *   - The 'tts' condition was only set in the removed `speak()` method
   *     (also dead), so `clearCondition('tts')` is a no-op (deleting a
   *     non-existent key from the Map).
   *
   * The method is kept as a no-op (rather than removed) because `dispose()`
   * calls it. Removing the call from dispose() would be a larger diff;
   * the no-op is harmless and clearly documents the dead path. Real TTS
   * cancellation is handled by the `voiceConversationStopSpeaking` IPC
   * (main process) — see main.ts voice-conversation-stop-speaking handler
   * (Phase 16 BUG-26 B + Phase 18 P0-1 fix).
   */
  stopSpeaking(): void {
    // No-op. See method comment above.
  }

  setCondition(key: string, state: VoiceState): void {
    this._stateConditions.set(key, state);
    this.recomputeState();
  }

  clearCondition(key: string): void {
    this._stateConditions.delete(key);
    this.recomputeState();
  }

  dispose(): void {
    this.stopListening();
    this.stopSpeaking();
    this.stopAudioLoop();
    if (this._scriptProcessor) {
      try { this._scriptProcessor.disconnect(); } catch { /* */ }
      this._scriptProcessor = null;
    }
    if (this._stream) {
      this._stream.getTracks().forEach((track) => track.stop());
      this._stream = null;
    }
    if (this._audioContext) {
      this._audioContext.close().catch(() => {});
      this._audioContext = null;
    }
    this._analyser = null;
    this._dataArray = null;
    this._smoothedLevel = 0;
    this._stateConditions.clear();
    this._state = 'idle';
  }

  private recomputeState(): void {
    let newState: VoiceState = 'idle';
    let highest = 0;
    for (const state of this._stateConditions.values()) {
      const p = STATE_PRIORITY[state] || 0;
      if (p > highest) { highest = p; newState = state; }
    }
    if (newState !== this._state) {
      // Phase 18 (BUG-37): enforce the Orb state machine. Validate the
      // transition via `safeOrbTransition()`. If the transition is invalid
      // per the relaxed VALID_TRANSITIONS graph in orb-state.ts, the
      // function returns the CURRENT state (blocking the invalid transition)
      // and logs `[ORB_STATE] Invalid transition blocked: <from> → <to>`.
      //
      // This prevents invalid transitions (e.g. offline → speaking without
      // going through idle) while allowing all documented production flows
      // (voice, chat, agent, voice-agent, barge-in, flash-state recovery).
      // See orb-state.ts VALID_TRANSITIONS comment for the full list of
      // relaxed transitions.
      //
      // Cast VoiceState ↔ NexOrbState: VoiceState has 9 states (a subset of
      // NexOrbState's 13), so the cast is safe — every VoiceState is a
      // valid NexOrbState. The returned NexOrbState is similarly castable
      // back to VoiceState (the blocked case returns the current state,
      // which was already a VoiceState).
      const validated = safeOrbTransition(this._state as NexOrbState, newState as NexOrbState) as VoiceState;
      if (validated !== this._state) {
        this._state = validated;
        this.callbacks.onStateChange?.(validated);
      }
      // If validated === this._state, the transition was blocked — the
      // warning was already logged by safeOrbTransition. We keep the
      // current state (do NOT update this._state, do NOT fire callback).
    }
  }

  private startAudioLoop(): void {
    if (this._rafId !== null) return;
    const loop = () => {
      if (!this._analyser || !this._dataArray) return;
      this._analyser.getByteTimeDomainData(this._dataArray);
      let sum = 0;
      for (let i = 0; i < this._dataArray.length; i++) {
        const val = (this._dataArray[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / this._dataArray.length);
      const gated = rms < this.config.noiseFloor ? 0 : rms;
      const normalized = Math.min(1, gated * 4);
      const speed = normalized > this._smoothedLevel
        ? this.config.attackSpeed : this.config.releaseSpeed;
      this._smoothedLevel += (normalized - this._smoothedLevel) * speed;
      this.callbacks.onAudioLevel?.(this._smoothedLevel);
      this._audioLevelLogCount++;
      if (this._audioLevelLogCount % 60 === 0) {
        console.log(`[ORB_AUDIO] VoiceService: rms=${rms.toFixed(4)} smoothed=${this._smoothedLevel.toFixed(4)}`);
      }
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  private stopAudioLoop(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  private startSTT(): void {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      // Phase 116: Browser SpeechRecognition is NOT available in Electron.
      // Use the main-side whisper STT path instead.
      // The whisper path: mic → IPC → whisper → transcript → voice-conversation-user IPC
      console.log('[VOICE] Browser STT not available — using main-side whisper STT');
      this._sttActive = true;
      this.setCondition('mic', 'listening');
      return;
    }
    this.stopSTT();
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = this.config.language;
    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (interim) {
        // Phase 116: Check for wake word in interim results
        this.checkWakeWord(interim);
        this.callbacks.onPartialTranscript?.(interim);
      }
      if (final) {
        console.log(`[VOICE] browser STT transcript: "${final.trim().substring(0, 100)}"`);
        // Phase 116: Check for wake word in final results
        const wakeWordFound = this.checkWakeWord(final);
        if (wakeWordFound) {
          // Strip the wake word from the transcript
          const stripped = final.trim().replace(
            new RegExp(`\\b${this.config.wakeWord}\\b`, 'i'),
            ''
          ).trim();
          if (stripped) {
            this.callbacks.onFinalTranscript?.(stripped);
          } else {
            // Just the wake word — signal that NEX should respond "بله؟"
            this.callbacks.onWakeWord?.();
          }
        } else if (this._wakeWordDetected || this._mode === 'continuous') {
          // In continuous mode or after wake word, send all transcripts
          this.callbacks.onFinalTranscript?.(final.trim());
        }
        this._wakeWordDetected = wakeWordFound;
      }
    };
    recognition.onerror = (event: any) => {
      console.warn(`[VOICE] browser STT error: ${event.error}`);
      if (event.error === 'not-allowed') {
        this.callbacks.onError?.('Speech recognition permission denied');
        this._shouldRestartSTT = false;
      }
    };
    recognition.onend = () => {
      this._sttActive = false;
      if (this._mode === 'continuous' && this._shouldRestartSTT) {
        setTimeout(() => {
          if (this._mode === 'continuous' && this._shouldRestartSTT) this.startSTT();
        }, 100);
      }
    };
    try {
      recognition.start();
      this._recognition = recognition;
      this._sttActive = true;
      console.log('[VOICE] browser STT started');
    } catch { /* already started */ }
  }

  /**
   * Phase 116: Check if the wake word ("NEX") appears in the transcript.
   * If found, sets _wakeWordDetected = true and calls onWakeWord callback.
   * Returns true if wake word was found.
   */
  private checkWakeWord(text: string): boolean {
    const lower = text.toLowerCase().trim();
    const wakeWord = this.config.wakeWord.toLowerCase();

    // Check if the wake word appears as a standalone word
    const regex = new RegExp(`\\b${wakeWord}\\b`, 'i');
    if (regex.test(lower)) {
      console.log(`[VOICE] Wake word detected: "${this.config.wakeWord}"`);
      this._wakeWordDetected = true;
      this.callbacks.onWakeWord?.();
      return true;
    }
    return false;
  }

  private stopSTT(): void {
    this._shouldRestartSTT = false;
    this._sttActive = false;
    if (this._recognition) {
      try { this._recognition.stop(); } catch { /* already stopped */ }
      this._recognition = null;
    }
  }
}

export const voiceService = new VoiceService();
