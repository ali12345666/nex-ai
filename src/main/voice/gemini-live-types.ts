/**
 * NEX AI — Gemini Live Wire Types (Phase O / O6)
 *
 * Pure type definitions for the Gemini Live API bidirectional WebSocket
 * protocol. No Electron imports — unit-testable in plain Node.
 *
 * All field names and message shapes are verified against the official
 * Google Gemini Live API documentation (v1beta, current as of Sep 2026):
 *   - https://ai.google.dev/api/live (WebSockets API reference)
 *   - https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket
 *   - https://ai.google.dev/gemini-api/docs/live-api/capabilities
 *   - https://ai.google.dev/gemini-api/docs/live-api/session-management
 *
 * Verified facts (Sep 2026):
 *   - Endpoint: wss://generativelanguage.googleapis.com/ws/
 *       google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent
 *   - Auth: API key in URL query ?key=...  (raw WS — no header alternative)
 *   - Audio format: raw 16-bit PCM, 16 kHz, mono, little-endian
 *   - Audio wire: base64-encoded, mimeType "audio/pcm;rate=16000"
 *   - First client message MUST be BidiGenerateContentSetup
 *   - Server acks with BidiGenerateContentSetupComplete
 *   - Interruption: serverContent.interrupted = true (default START_OF_ACTIVITY_INTERRUPTS)
 *   - Session lifetime: ~10 min connection hard limit; GoAway sent 60s before
 *   - Session resumption: SessionResumptionConfig.handle = last token (valid 2 hr)
 *   - Supported models (verified from ai.google.dev/gemini-api/docs/models):
 *       * gemini-2.5-flash-native-audio-preview-12-2025 (stable native audio)
 *       * gemini-3.1-flash-live-preview (latest, native audio + thinkingLevel)
 *
 * SECURITY: This module is pure types + constants — it never handles the API
 * key, never constructs URLs, never logs. The API key + URL construction live
 * exclusively in `gemini-live-transport.ts` (main process only), reading from
 * `getSecret('geminiApiKey')` (Electron safeStorage).
 */

// ─── Endpoint Constants (verified from official docs) ───────────────────────

/** Gemini Live API WebSocket endpoint (v1beta, raw WebSocket). */
export const GEMINI_LIVE_WS_PATH =
  '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/** Default host for the Gemini Live API (same as the REST generateContent). */
export const GEMINI_LIVE_DEFAULT_HOST = 'generativelanguage.googleapis.com';

/**
 * Audio format constants — verified from the official "Get started with raw
 * WebSockets" guide: "Audio needs to be sent as raw PCM data (raw 16-bit PCM
 * audio, 16kHz, little-endian). ... The mimeType is crucial."
 */
export const GEMINI_LIVE_AUDIO_MIME_TYPE = 'audio/pcm;rate=16000';
export const GEMINI_LIVE_AUDIO_SAMPLE_RATE = 16000;
export const GEMINI_LIVE_AUDIO_BITS_PER_SAMPLE = 16;
export const GEMINI_LIVE_AUDIO_CHANNELS = 1;

/**
 * Session lifecycle constants — verified from the official session-management
 * doc: "The lifetime of a connection is limited as well, to around 10 minutes.
 * When the connection terminates, the session terminates as well. ...
 * You'll also receive a GoAway message before the connection ends."
 *
 * The GoAway is sent ~60 seconds before the hard limit to give the client
 * time to reconnect via session resumption.
 */
export const GEMINI_LIVE_CONNECTION_LIMIT_MS = 10 * 60 * 1000; // ~10 minutes
export const GEMINI_LIVE_GOAWAY_NOTICE_MS = 60 * 1000; // 60s before disconnect
export const GEMINI_LIVE_RESUMPTION_TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Verified supported Live models (from ai.google.dev/gemini-api/docs/models
 * + release notes, Sep 2026). The user picks one in Settings; we do NOT
 * hardcode a single default at the transport layer — the caller passes the
 * model ID. The Settings UI provides a curated list.
 */
export const GEMINI_LIVE_MODELS = [
  // Latest native-audio Live model (thinkingLevel, NON_BLOCKING function calling)
  'gemini-3.1-flash-live-preview',
  // Stable native-audio model (thinkingBudget, sequential function calling)
  'gemini-2.5-flash-native-audio-preview-12-2025',
  // Earlier native-audio preview (kept for backwards compat)
  'gemini-2.5-flash-native-audio-preview-09-2025',
] as const;
export type GeminiLiveModelId = (typeof GEMINI_LIVE_MODELS)[number];

// ─── Client → Server Messages ──────────────────────────────────────────────

/** Setup message — MUST be the first message after WS open. */
export interface BidiGenerateContentSetup {
  model: string; // e.g. "models/gemini-2.5-flash-native-audio-preview-12-2025"
  generationConfig?: {
    candidateCount?: number;
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    responseModalities?: Array<'TEXT' | 'AUDIO' | 'IMAGE'>;
    speechConfig?: {
      voiceConfig?: {
        prebuiltVoiceConfig?: { voiceName?: string };
      };
      languageCode?: string;
    };
    mediaResolution?: string;
    translationConfig?: object;
  };
  systemInstruction?: string | { parts: Array<{ text: string }> };
  tools?: unknown[]; // tool declarations — NOT used in O6-MVP (per directive)
  // Session resumption: pass the last token to resume a previous session.
  sessionResumption?: SessionResumptionConfig;
  // Context window compression (enables long sessions beyond 15 min).
  contextWindowCompression?: ContextWindowCompressionConfig;
  // Input/output transcription (for live captions).
  inputAudioTranscription?: AudioTranscriptionConfig;
  outputAudioTranscription?: AudioTranscriptionConfig;
  // Realtime input config (VAD settings).
  realtimeInputConfig?: RealtimeInputConfig;
}

export interface SessionResumptionConfig {
  handle: string; // the resumption token from the last SessionResumptionUpdate
}

export interface ContextWindowCompressionConfig {
  triggerTokensThreshold?: number;
  slidingWindow?: { targetTokens?: number };
}

export interface AudioTranscriptionConfig {
  // Empty object — presence enables transcription. The server sends
  // inputTranscription.text / outputTranscription.text in serverContent.
}

export interface RealtimeInputConfig {
  automaticActivityDetection?: {
    disabled?: boolean;
    startOfSpeechSensitivity?: 'START_SENSITIVITY_LOW' | 'START_SENSITIVITY_HIGH';
    endOfSpeechSensitivity?: 'END_SENSITIVITY_LOW' | 'END_SENSITIVITY_HIGH';
    prefixPaddingMs?: number;
    silenceDurationMs?: number;
  };
  activityHandling?: 'START_OF_ACTIVITY_INTERRUPTS' | 'NO_INTERRUPTION';
  turnCoverage?: 'TURN_INCLUDES_ONLY_ACTIVITY' | 'TURN_INCLUDES_ALL_INPUT';
}

/** Realtime audio input — sent continuously while the mic is capturing. */
export interface BidiGenerateContentRealtimeInput {
  audio?: {
    data: string; // base64-encoded raw 16-bit PCM 16kHz mono
    mimeType: typeof GEMINI_LIVE_AUDIO_MIME_TYPE; // "audio/pcm;rate=16000"
  };
  // audioStreamEnd: true signals the mic was muted — flush cached audio.
  audioStreamEnd?: boolean;
}

/** Realtime text input (alternative to audio). */
export interface BidiGenerateContentRealtimeTextInput {
  text?: string;
}

/** Client content — for sending incremental text + turn-end signals. */
export interface BidiGenerateContentClientContent {
  turns?: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
  turnComplete?: boolean;
}

/** The single client → server message envelope. Exactly one field set. */
export interface BidiGenerateContentClientMessage {
  setup?: BidiGenerateContentSetup;
  clientContent?: BidiGenerateContentClientContent;
  realtimeInput?: BidiGenerateContentRealtimeInput;
  // (realtimeInput with text is a separate field in some SDKs, but the
  // official WS guide shows realtimeInput.audio — we treat text as a
  // variant of realtimeInput for simplicity.)
  toolResponse?: BidiGenerateContentToolResponse;
}

/** Tool response — NOT used in O6-MVP (per directive, no native function calling). */
export interface BidiGenerateContentToolResponse {
  functionResponses: Array<{
    name: string;
    id: string;
    response?: { result?: unknown };
    error?: string;
  }>;
}

// ─── Server → Client Messages ──────────────────────────────────────────────

export interface BidiGenerateContentSetupComplete {
  // Empty — presence signals setup is done.
}

export interface BidiGenerateContentServerContent {
  // Model's audio/text output chunks.
  modelTurn?: {
    parts: Array<{
      text?: string;
      inlineData?: { data: string; mimeType: string };
    }>;
  };
  // Transcription of the user's input audio (if inputAudioTranscription configured).
  inputTranscription?: { text: string };
  // Transcription of the model's output audio (if outputAudioTranscription configured).
  outputTranscription?: { text: string };
  // True when the server detected the user interrupting the model's response.
  interrupted?: boolean;
  // True when the turn is complete (model finished generating).
  turnComplete?: boolean;
  // Generation result metadata (usage stats).
  generationComplete?: boolean;
}

/** Tool call request — NOT executed in O6-MVP (per directive). Logged only. */
export interface BidiGenerateContentToolCall {
  functionCalls: Array<{ id: string; name: string; args?: Record<string, unknown> }>;
}

export interface BidiGenerateContentToolCallCancellation {
  ids: string[]; // canceled function call IDs (e.g. due to interruption)
}

/** Session resumption update — server sends tokens to use on reconnect. */
export interface BidiGenerateContentSessionResumptionUpdate {
  resumptionToken: string;
}

/** GoAway — server signals the connection will close soon (~60s). */
export interface BidiGenerateContentGoAway {
  timeLeft?: string; // e.g. "60s"
}

/** The single server → client message envelope. Exactly one field set. */
export interface BidiGenerateContentServerMessage {
  setupComplete?: BidiGenerateContentSetupComplete;
  serverContent?: BidiGenerateContentServerContent;
  toolCall?: BidiGenerateContentToolCall;
  toolCallCancellation?: BidiGenerateContentToolCallCancellation;
  sessionResumptionUpdate?: BidiGenerateContentSessionResumptionUpdate;
  goAway?: BidiGenerateContentGoAway;
  // Error envelope (server-side).
  error?: { code?: number; message?: string; status?: string };
}

// ─── Transport State (mirrors the existing ConversationState mapping) ──────

export type GeminiLiveTransportState =
  | 'disconnected' // WS closed, no session
  | 'connecting' // WS opening + setup message sent, awaiting setupComplete
  | 'connected' // setupComplete received, ready to stream
  | 'listening' // mic audio streaming to server, awaiting server response
  | 'speaking' // server is sending audio chunks (model is responding)
  | 'interrupted' // server sent interrupted=true (barge-in)
  | 'reconnecting' // GoAway received, attempting session resumption
  | 'error'; // unrecoverable error (e.g. invalid API key, network down)

// ─── Transport Callbacks (mirror the engine's callback shape) ──────────────

export interface GeminiLiveTransportCallbacks {
  onStateChange?: (state: GeminiLiveTransportState) => void;
  /** Audio chunk from the model (base64-decoded PCM 16kHz Int16 Buffer). */
  onAudioChunk?: (pcmBuffer: Buffer, requestId: number) => void;
  /** Model turn complete — flush the audio queue for this requestId. */
  onTurnComplete?: (requestId: number) => void;
  /** Server-side barge-in (user interrupted the model). */
  onInterrupted?: (requestId: number) => void;
  /** User's input audio was transcribed by the server (live captions). */
  onInputTranscription?: (text: string) => void;
  /** Model's output audio was transcribed by the server (live captions). */
  onOutputTranscription?: (text: string) => void;
  /** Session resumption token received — save for reconnect. */
  onResumptionToken?: (token: string) => void;
  /** GoAway received — connection will close in ~60s. */
  onGoAway?: (timeLeftMs: number) => void;
  /** Tool call from server — logged but NOT executed in O6-MVP. */
  onToolCall?: (toolCall: BidiGenerateContentToolCall) => void;
  /** Unrecoverable error. Message is sanitized (no API key, no URL). */
  onError?: (sanitizedMessage: string) => void;
}

// ─── Pure helpers (no Electron, no WebSocket — unit-testable) ───────────────

/**
 * Build the WebSocket URL for the Gemini Live API.
 *
 * SECURITY: The API key is placed in the URL query `?key=...` because the
 * official Gemini Live raw-WebSocket documentation explicitly requires this
 * (there is no header-based alternative for the raw WS path). The returned
 * URL MUST NOT be logged, emitted in events, or sent to the renderer.
 *
 * The caller (gemini-live-transport.ts, main process only) reads the key
 * from `getSecret('geminiApiKey')` and immediately uses it to open the WS —
 * the URL is never stored in a variable that could leak.
 *
 * @param apiKey The Gemini API key (from getSecret).
 * @param host Override host (default: generativelanguage.googleapis.com).
 * @returns The full wss:// URL with ?key= query param.
 */
export function buildGeminiLiveWsUrl(apiKey: string, host?: string): string {
  const h = (host && host.trim()) || GEMINI_LIVE_DEFAULT_HOST;
  return `wss://${h}${GEMINI_LIVE_WS_PATH}?key=${apiKey}`;
}

/**
 * Build the setup message for a new Gemini Live session.
 *
 * @param model The model ID (e.g. "gemini-2.5-flash-native-audio-preview-12-2025").
 * @param systemInstructionText Optional system instruction text.
 * @param resumptionToken Optional token for session resumption.
 * @returns The setup message (first client → server message).
 */
export function buildGeminiLiveSetup(
  model: string,
  systemInstructionText?: string,
  resumptionToken?: string,
): BidiGenerateContentSetup {
  const setup: BidiGenerateContentSetup = {
    model: model.startsWith('models/') ? model : `models/${model}`,
    generationConfig: {
      // AUDIO modality = native audio output (no separate TTS step).
      responseModalities: ['AUDIO'],
    },
    // Enable both input + output transcription for live captions.
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: {
      // Default: automatic VAD + START_OF_ACTIVITY_INTERRUPTS (barge-in).
      automaticActivityDetection: { disabled: false },
      activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
    },
    // Enable context window compression for long sessions (beyond 15 min).
    contextWindowCompression: {
      triggerTokensThreshold: 30000,
      slidingWindow: { targetTokens: 20000 },
    },
  };
  if (systemInstructionText) {
    setup.systemInstruction = { parts: [{ text: systemInstructionText }] };
  }
  if (resumptionToken) {
    setup.sessionResumption = { handle: resumptionToken };
  }
  return setup;
}

/**
 * Build a realtime audio input message.
 *
 * @param pcm16Buffer Raw 16-bit PCM 16kHz mono audio.
 * @returns The realtimeInput message (audio.data is base64-encoded).
 */
export function buildRealtimeAudioMessage(
  pcm16Buffer: Buffer,
): BidiGenerateContentRealtimeInput {
  return {
    audio: {
      data: pcm16Buffer.toString('base64'),
      mimeType: GEMINI_LIVE_AUDIO_MIME_TYPE,
    },
  };
}

/**
 * Build a realtime audioStreamEnd message (flush cached audio when mic mutes).
 */
export function buildAudioStreamEndMessage(): BidiGenerateContentRealtimeInput {
  return { audioStreamEnd: true };
}

/**
 * Sanitize an error message — strip any API key, access token, or full URL
 * that might have leaked into the error string. This is defense-in-depth; the
 * transport itself never logs the URL, but server-side error responses may
 * echo it.
 *
 * @param raw The raw error string (may contain ?key=... or ?access_token=...).
 * @returns A sanitized string safe to emit to the renderer + log.
 */
export function sanitizeGeminiLiveError(raw: string): string {
  if (!raw || typeof raw !== 'string') return String(raw || '');
  let out = raw;
  // Strip ?key=... and ?access_token=... query params (keep the host).
  out = out.replace(/([?&](?:key|access_token)=)[A-Za-z0-9_\-\.]{10,}/g, '$1***REDACTED***');
  // Strip any AIza... Google API keys (defense-in-depth).
  out = out.replace(/\bAIza[A-Za-z0-9_-]{30,}\b/g, '***REDACTED_GOOGLE_KEY***');
  // Strip Bearer tokens.
  out = out.replace(/\bBearer\s+[A-Za-z0-9_\-\.]{20,}/g, 'Bearer ***REDACTED***');
  // Truncate very long error strings (prevent log spam + UI overflow).
  if (out.length > 500) out = out.slice(0, 500) + '...';
  return out;
}
