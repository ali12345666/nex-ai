/**
 * NEX AI — Voice Types (Interface-only, Phase 22+)
 *
 * Defines interfaces for local speech-to-text (STT) and text-to-speech (TTS).
 *
 * Voice is Local-First:
 *   Microphone → Local STT → Agent → Tool → Agent → Local TTS → Speaker
 *
 * Works fully offline. No cloud STT/TTS.
 *
 * Planned modules (Phase 22+):
 *   voice/stt-engine.ts    — local Whisper.cpp or compatible (via GGUF)
 *   voice/tts-engine.ts    — local TTS (Piper, Coqui, or similar)
 *   voice/wake-word.ts     — "Hey NEX" detection (always-on, low-power)
 *   voice/voice-commands.ts — parse natural language commands
 *
 * Models loaded on-demand (not bundled). User adds STT/TTS models via Model Manager.
 */

export type VoiceCapability =
  | 'speech-to-text'
  | 'text-to-speech'
  | 'wake-word-detection'
  | 'voice-activity-detection'
  | 'speaker-identification';

export interface VoiceModelInfo {
  id: string;
  name: string;
  path: string;
  capabilities: VoiceCapability[];
  /** Supported languages (BCP-47 codes, e.g. 'en-US', 'fa-IR') */
  languages: string[];
  /** Sample rate (Hz) */
  sampleRate: number;
}

export interface STTOptions {
  language?: string;
  /** Audio file path (if not streaming from mic) */
  audioFilePath?: string;
  /** Enable word-level timestamps */
  enableTimestamps?: boolean;
  /** Enable speaker diarization */
  enableDiarization?: boolean;
}

export interface STTResult {
  success: boolean;
  text: string;
  /** Word-level timing (if enabled) */
  words?: Array<{ word: string; start: number; end: number; confidence: number }>;
  /** Detected language */
  language?: string;
  /** Detected segments */
  segments?: Array<{ text: string; start: number; end: number; speaker?: string }>;
  error?: string;
  durationMs?: number;
}

export interface TTSOptions {
  /** Voice name (e.g. 'en_US-lessac-medium', 'fa_IR-gyro-medium') */
  voice?: string;
  /** Speaking rate (0.5 = slow, 1.0 = normal, 2.0 = fast) */
  rate?: number;
  /** Pitch adjustment (-12 to +12 semitones) */
  pitch?: number;
  /** Output file path (if not playing to speaker) */
  outputFilePath?: string;
  /**
   * Phase 16 (BUG-12 + BUG-26): monotonic ID identifying this TTS turn.
   * Passed by the conversation handler (NexVoiceConversation.speakResponse)
   * so it can match the renderer's `voice-tts-ended` signal to the
   * correct in-flight request. When omitted, the engine auto-increments
   * its internal counter (legacy callers).
   */
  requestId?: number;
}

export interface TTSResult {
  success: boolean;
  /** Path to generated audio file */
  audioFilePath?: string;
  /** Audio duration in seconds */
  duration?: number;
  /** Audio sample rate */
  sampleRate?: number;
  error?: string;
  durationMs?: number;
}

// ─── Engine Interfaces ─────────────────────────────────────────────────────

export interface STTEngine {
  /** Initialize the STT engine (load model) */
  init(): Promise<void>;
  /** Transcribe audio from a file */
  transcribeFile(audioPath: string, opts?: STTOptions): Promise<STTResult>;
  /** Start streaming transcription from microphone */
  startStream(opts?: STTOptions): Promise<STTResult>;
  /** Stop streaming transcription */
  stopStream(): Promise<STTResult>;
  /** Shutdown */
  shutdown(): Promise<void>;
}

export interface TTSEngine {
  /** Initialize the TTS engine (load voice model) */
  init(): Promise<void>;
  /** Synthesize speech from text */
  synthesize(text: string, opts?: TTSOptions): Promise<TTSResult>;
  /** Get available voices */
  listVoices(): Promise<Array<{ name: string; language: string; gender?: string }>>;
  /** Shutdown */
  shutdown(): Promise<void>;
}

// ─── Wake Word Detection ────────────────────────────────────────────────────

export interface WakeWordDetector {
  /** Start listening for wake word ("Hey NEX") */
  start(): Promise<void>;
  /** Stop listening */
  stop(): Promise<void>;
  /** Register a callback for wake word detection */
  onWakeWord(callback: () => void): void;
}

// ─── Voice Command Parser ───────────────────────────────────────────────────

export interface VoiceCommand {
  /** Intent (e.g. 'open-file', 'run-tests', 'explain-code') */
  intent: string;
  /** Parsed parameters */
  params: Record<string, any>;
  /** Original transcription */
  text: string;
  /** Confidence (0-1) */
  confidence: number;
}

export interface VoiceCommandParser {
  /** Parse a transcribed voice command into a structured command */
  parse(text: string): Promise<VoiceCommand>;
}
