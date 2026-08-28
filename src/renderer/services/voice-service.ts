/**
 * NEX AI — Voice Service (Phase 30)
 *
 * Always-ready voice system with Web Audio API microphone analysis +
 * browser SpeechRecognition for STT + SpeechSynthesis for TTS.
 *
 * Architecture (per directive):
 *   VoiceService (this module)
 *       ├── microphone: getUserMedia + AudioContext + AnalyserNode
 *       ├── audio level: RMS → noise gate → attack/release smoothing → 0..1
 *       ├── STT: webkitSpeechRecognition (Chromium native — no cloud in Electron)
 *       ├── TTS: SpeechSynthesis (local OS voices — offline capable)
 *       └── state: state machine → callbacks → VoiceController
 *
 * The Orb and Chat NEVER import this directly — they receive
 * normalized values and state via the VoiceController.
 */

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error' | 'offline';

export interface VoiceConfig {
  noiseFloor: number;
  attackSpeed: number;
  releaseSpeed: number;
  language: string;
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  noiseFloor: 0.015,
  attackSpeed: 0.4,
  releaseSpeed: 0.08,
  language: 'en-US',
};

export interface VoiceCallbacks {
  onStateChange?: (state: VoiceState) => void;
  onAudioLevel?: (level: number) => void;
  onPartialTranscript?: (text: string) => void;
  onFinalTranscript?: (text: string) => void;
  onPermissionChange?: (granted: boolean | null) => void;
  onError?: (message: string) => void;
}

const STATE_PRIORITY: Record<VoiceState, number> = {
  error: 6, offline: 5, speaking: 4, thinking: 3, listening: 2, idle: 1,
};

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
  private _ttsActive = false;

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
  get isSpeaking(): boolean { return this._ttsActive; }

  async enableMicrophone(): Promise<boolean> {
    if (this._stream) return true;
    try {
      this._micPermission = null; // pending
      console.log(`[VOICE_AUDIO_DEBUG] calling getUserMedia...`);
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this._micPermission = true;
      this.callbacks.onPermissionChange?.(true);
      console.log(`[VOICE_AUDIO_DEBUG] getUserMedia resolved — stream tracks: ${this._stream.getTracks().length}`);

      this._audioContext = new AudioContext();
      console.log(`[VOICE_AUDIO_DEBUG] AudioContext created — state: ${this._audioContext.state}`);

      // CRITICAL: AudioContext starts in 'suspended' state in Electron.
      // Must resume it before ScriptProcessorNode will fire onaudioprocess.
      if (this._audioContext.state === 'suspended') {
        console.log(`[VOICE_AUDIO_DEBUG] AudioContext suspended — calling resume()...`);
        try {
          await this._audioContext.resume();
          console.log(`[VOICE_AUDIO_DEBUG] AudioContext resumed — state: ${this._audioContext.state}`);
        } catch (err: any) {
          console.warn(`[VOICE_AUDIO_DEBUG] AudioContext resume failed: ${err?.message}`);
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
      console.log(`[VOICE_AUDIO_DEBUG] ScriptProcessorNode created — bufferSize: ${this._scriptProcessor.bufferSize}`);

      this._audioProcessEventCount = 0;
      this._scriptProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
        this._audioProcessEventCount++;
        if (!this._ipcFeedingEnabled) {
          // Log first few events even when disabled, to prove the processor is firing
          if (this._audioProcessEventCount <= 3) {
            console.log(`[VOICE_AUDIO_DEBUG] onaudioprocess firing (#${this._audioProcessEventCount}) but IPC feeding disabled`);
          }
          return;
        }
        const inputBuffer = event.inputBuffer;
        const channelData = inputBuffer.getChannelData(0); // Float32Array, mono

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
              console.warn(`[VOICE_AUDIO_DEBUG] voiceFeedAudioChunk NOT available on window.nexAPI!`);
            }
            return;
          }
          window.nexAPI!.voiceFeedAudioChunk!(chunkBuffer);
        } catch (err: any) {
          if (this._chunksSent <= 3) {
            console.warn(`[VOICE_AUDIO_DEBUG] voiceFeedAudioChunk error: ${err?.message}`);
          }
        }

        // Also send the audio level (RMS) for VAD + Orb animation
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
      };
      // Connect: source → scriptProcessor → destination
      source.connect(this._scriptProcessor);
      this._scriptProcessor.connect(this._audioContext.destination);
      console.log(`[VOICE_AUDIO_DEBUG] ScriptProcessorNode connected — source→processor→destination`);

      this.startAudioLoop();

      // Log the initial [VOICE_AUDIO] + [VOICE_AUDIO_DEBUG] blocks
      this.logVoiceAudio();
      this.logVoiceAudioDebug();
      return true;
    } catch (err: any) {
      this._micPermission = false;
      this.callbacks.onPermissionChange?.(false);
      const msg = err.name === 'NotAllowedError' ? 'Microphone access denied'
        : err.name === 'NotFoundError' ? 'No microphone found'
        : `Microphone error: ${err.message}`;
      console.error(`[VOICE_AUDIO_DEBUG] enableMicrophone failed: ${msg} (name=${err.name})`);
      this.callbacks.onError?.(msg);
      this.logVoiceAudio();
      this.logVoiceAudioDebug();
      return false;
    }
  }

  /**
   * Downsample Float32 audio from 48kHz to 16kHz by taking every 3rd sample.
   * This is a simple decimation (no low-pass filter, but acceptable for STT).
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
   * When the conversation is active, this is enabled; when stopped, disabled.
   */
  setIPCFeedingEnabled(enabled: boolean): void {
    this._ipcFeedingEnabled = enabled;
    if (enabled) {
      this._chunksSent = 0;
    }
    console.log(`[VOICE_AUDIO] IPC feeding ${enabled ? 'enabled' : 'disabled'}`);
    this.logVoiceAudio();
  }

  /**
   * Log the [VOICE_AUDIO] diagnostic block.
   */
  logVoiceAudio(): void {
    console.log(`[VOICE_AUDIO]`);
    console.log(`  microphonePermission=${this._micPermission === null ? 'unknown' : this._micPermission ? 'granted' : 'denied'}`);
    console.log(`  streamActive=${!!this._stream}`);
    console.log(`  audioContextState=${this._audioContext?.state || 'none'}`);
    console.log(`  chunksSent=${this._chunksSent}`);
    console.log(`  lastChunkSize=${this._lastChunkSize}`);
    console.log(`  ipcFeedingEnabled=${this._ipcFeedingEnabled}`);
  }

  /**
   * Log the [VOICE_AUDIO_DEBUG] diagnostic block — detailed pipeline trace.
   * Shows exactly where the audio pipeline is broken:
   *   permission → stream → audioContext → processor → onaudioprocess → IPC
   */
  logVoiceAudioDebug(): void {
    const ipcAvailable = !!(window as any).nexAPI?.voiceFeedAudioChunk;
    const streamTracks = this._stream ? this._stream.getTracks().length : 0;
    console.log(`[VOICE_AUDIO_DEBUG]`);
    console.log(`  permission=${this._micPermission === null ? 'pending' : this._micPermission ? 'granted' : 'denied'}`);
    console.log(`  streamTracks=${streamTracks}`);
    console.log(`  audioContext=${this._audioContext?.state || 'none'}`);
    console.log(`  processorCreated=${!!this._scriptProcessor}`);
    console.log(`  audioProcessEvents=${this._audioProcessEventCount}`);
    console.log(`  ipcAvailable=${ipcAvailable}`);
    if (this._audioContext && this._audioContext.state !== 'running') {
      console.warn(`[VOICE_AUDIO_DEBUG] WARNING: AudioContext is ${this._audioContext.state} — onaudioprocess will NOT fire until resumed`);
    }
    if (!ipcAvailable) {
      console.warn(`[VOICE_AUDIO_DEBUG] WARNING: window.nexAPI.voiceFeedAudioChunk is NOT available — IPC bridge missing`);
    }
  }

  async startListening(): Promise<void> {
    if (!this._stream) {
      const ok = await this.enableMicrophone();
      if (!ok) { this.setCondition('mic', 'error'); return; }
    }
    if (this._ttsActive) this.stopSpeaking();
    // Enable IPC feeding so PCM audio reaches the LocalVoiceEngine
    this.setIPCFeedingEnabled(true);
    this.startSTT();
    this.setCondition('mic', 'listening');
    this._shouldRestartSTT = true;
  }

  stopListening(): void {
    this.stopSTT();
    // Disable IPC feeding when not listening
    this.setIPCFeedingEnabled(false);
    this.clearCondition('mic');
    this._shouldRestartSTT = false;
  }

  speak(text: string): void {
    if (!('speechSynthesis' in window)) {
      this.callbacks.onError?.('TTS unavailable');
      return;
    }
    window.speechSynthesis.cancel();
    // UI-14 §4: Pause STT during TTS to prevent self-hearing (ASR picking up
    // NEX's own TTS output as a user command). _shouldRestartSTT stays true
    // so STT auto-resumes after TTS ends (via utterance.onend → startSTT()).
    if (this._sttActive) {
      this.stopSTT();
      // Keep _shouldRestartSTT true so onend handler restarts listening.
      this._shouldRestartSTT = true;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.config.language;
    utterance.onstart = () => { this._ttsActive = true; this.setCondition('tts', 'speaking'); };
    utterance.onend = () => {
      this._ttsActive = false;
      this.clearCondition('tts');
      // UI-14 §3+§4: Auto-resume listening after TTS ends (Always-Ready Voice).
      // _shouldRestartSTT was kept true during TTS, so startSTT() will run.
      if (this._shouldRestartSTT && !this._sttActive) {
        setTimeout(() => { if (this._shouldRestartSTT) this.startSTT(); }, 200);
      }
    };
    utterance.onerror = () => {
      this._ttsActive = false;
      this.clearCondition('tts');
      // UI-14 §4: Resume listening even on TTS error (don't leave voice dead).
      if (this._shouldRestartSTT && !this._sttActive) {
        setTimeout(() => { if (this._shouldRestartSTT) this.startSTT(); }, 200);
      }
    };
    window.speechSynthesis.speak(utterance);
  }

  stopSpeaking(): void {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    this._ttsActive = false;
    this.clearCondition('tts');
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
      this._state = newState;
      this.callbacks.onStateChange?.(newState);
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
      // [ORB_AUDIO_DEBUG] — log audio level every 60 frames (~1/sec)
      this._audioLevelLogCount++;
      if (this._audioLevelLogCount % 60 === 0) {
        console.log(`[ORB_AUDIO_DEBUG] VoiceService: rms=${rms.toFixed(4)} smoothed=${this._smoothedLevel.toFixed(4)} normalized=${normalized.toFixed(4)}`);
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
    if (!SR) { this.callbacks.onError?.('Speech recognition unavailable'); return; }
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
      if (interim) this.callbacks.onPartialTranscript?.(interim);
      if (final) this.callbacks.onFinalTranscript?.(final.trim());
    };
    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') {
        this.callbacks.onError?.('Speech recognition permission denied');
        this._shouldRestartSTT = false;
      }
    };
    recognition.onend = () => {
      this._sttActive = false;
      if (this._shouldRestartSTT) {
        setTimeout(() => { if (this._shouldRestartSTT) this.startSTT(); }, 100);
      }
    };
    try {
      recognition.start();
      this._recognition = recognition;
      this._sttActive = true;
    } catch { /* already started */ }
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
