/**
 * NEX AI — Gemini Live Transport (Phase O / O6)
 *
 * Realtime bidirectional voice transport over the Gemini Live WebSocket API.
 * This is the online counterpart to the local Whisper + Piper provider pair.
 *
 * ARCHITECTURE (per O6 design):
 *   - This module is a TRANSPORT, not an STTProvider/TTSProvider. The Live API
 *     has different semantics (bidirectional streaming, no discrete
 *     "synthesize" or "transcribeFile" calls), so forcing it into the existing
 *     STT/TTS provider shape would impose wrong semantics. The transport is
 *     a peer of the LocalVoiceEngine — both feed the same NexVoiceConversation
 *     FSM, Orb FSM, condition system, and requestId cancellation.
 *   - The engine's `currentTtsRequestId` counter is REUSED (passed in via
 *     callbacks). NO new counter, NO new _abortFlag.
 *   - The transport emits the same `voice-conversation-state` states
 *     (listening/thinking/speaking/interrupted/idle/error) that AppShell maps
 *     to Orb conditions. NO new Orb FSM states.
 *   - Barge-in: the server sends `serverContent.interrupted = true`. The
 *     transport calls `callbacks.onInterrupted(requestId)`, which the engine
 *     routes to `conversation.handleBargeIn()` (the EXISTING flow).
 *
 * SECURITY (non-negotiable):
 *   - API key read from `getSecret('geminiApiKey')` (Electron safeStorage) at
 *     connect time. NEVER in renderer, config.json, Git, logs, events, or UI.
 *   - The WS URL contains `?key=...` (required by the raw WS protocol —
 *     verified from official docs). The URL is constructed via the pure
 *     `buildGeminiLiveWsUrl` helper, used to open the WS, then DISCARDED. It
 *     is NEVER stored in a field, logged, or emitted in an event.
 *   - Error messages are sanitized via `sanitizeGeminiLiveError` before
 *     being emitted to the renderer or logged (strips `?key=...`, AIza keys,
 *     Bearer tokens).
 *   - The transport logs only: [GEMINI_LIVE] connecting/connected/
 *     interrupted/disconnected/error/GoAway/reconnecting — NEVER the key, URL,
 *     or raw response body.
 *
 * Verified facts (Sep 2026, from ai.google.dev/gemini-api/docs/live-api*):
 *   - Endpoint: wss://generativelanguage.googleapis.com/ws/
 *       google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent
 *   - Auth: ?key=API_KEY in URL query (raw WS only).
 *   - Audio: raw 16-bit PCM, 16 kHz, mono, little-endian, base64-encoded.
 *   - Setup: first message = BidiGenerateContentSetup; server acks with
 *     BidiGenerateContentSetupComplete.
 *   - Session: ~10 min hard limit; GoAway 60s before; session resumption via
 *     SessionResumptionConfig.handle token (valid 2 hr).
 *   - Interruption: serverContent.interrupted = true (default
 *     START_OF_ACTIVITY_INTERRUPTS).
 */

import WebSocket from 'ws';
import { getSecret } from '../persistence';
import {
  buildGeminiLiveWsUrl,
  buildGeminiLiveSetup,
  buildRealtimeAudioMessage,
  buildAudioStreamEndMessage,
  sanitizeGeminiLiveError,
  GEMINI_LIVE_DEFAULT_HOST,
  GEMINI_LIVE_GOAWAY_NOTICE_MS,
  type BidiGenerateContentClientMessage,
  type BidiGenerateContentServerMessage,
  type GeminiLiveTransportState,
  type GeminiLiveTransportCallbacks,
} from './gemini-live-types';

export class GeminiLiveTransport {
  private ws: WebSocket | null = null;
  private state: GeminiLiveTransportState = 'disconnected';
  private callbacks: GeminiLiveTransportCallbacks = {};
  private model = '';
  private systemInstruction = '';
  private resumptionToken: string | null = null;
  private connectRequestId = 0; // guards against stale connect/disconnect races
  private disposed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private goAwayTimer: ReturnType<typeof setTimeout> | null = null;

  setState(state: GeminiLiveTransportState): void {
    if (this.state === state) return;
    this.state = state;
    this.callbacks.onStateChange?.(state);
  }

  getState(): GeminiLiveTransportState {
    return this.state;
  }

  setCallbacks(callbacks: GeminiLiveTransportCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  isActive(): boolean {
    return this.state === 'connected' || this.state === 'listening' || this.state === 'speaking' || this.state === 'interrupted' || this.state === 'reconnecting';
  }

  /**
   * Connect to the Gemini Live API.
   *
   * Reads the API key from secure storage, builds the WS URL (never logged),
   * opens the WebSocket, sends the setup message, and awaits
   * `BidiGenerateContentSetupComplete`.
   *
   * @param model The model ID (e.g. "gemini-2.5-flash-native-audio-preview-12-2025").
   * @param systemInstruction Optional system instruction text.
   * @param resumptionToken Optional token for session resumption.
   * @returns `true` on setup complete, `false` on failure (error emitted via callback).
   */
  async connect(
    model: string,
    systemInstruction: string,
    resumptionToken?: string,
  ): Promise<boolean> {
    if (this.disposed) {
      this.callbacks.onError?.('Transport disposed');
      return false;
    }
    // If already connected, close the old session first (idempotent).
    if (this.ws && (this.state === 'connected' || this.state === 'listening' || this.state === 'speaking')) {
      this.closeInternal('reconnect');
    }

    const myRequestId = ++this.connectRequestId;
    this.model = model;
    this.systemInstruction = systemInstruction;
    if (resumptionToken) this.resumptionToken = resumptionToken;

    // 1. Read API key from secure storage. Defensive: getSecret may throw
    // if safeStorage is unavailable (e.g. running outside Electron in a test).
    let apiKey = '';
    try {
      apiKey = getSecret('geminiApiKey') || '';
    } catch (err: any) {
      console.log('[GEMINI_LIVE] getSecret failed: %s', sanitizeGeminiLiveError(err?.message || ''));
      apiKey = '';
    }
    if (!apiKey || !apiKey.trim()) {
      this.callbacks.onError?.('No Gemini API key saved. Set it in Settings first.');
      this.setState('error');
      return false;
    }

    // 2. Build the WS URL (pure helper — URL never stored in a field, never logged).
    const wsUrl = buildGeminiLiveWsUrl(apiKey, GEMINI_LIVE_DEFAULT_HOST);

    // 3. Open the WebSocket.
    this.setState('connecting');
    console.log('[GEMINI_LIVE] connecting (model=%s, resumption=%s)', model, resumptionToken ? 'yes' : 'no');

    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const finish = (ok: boolean) => {
        if (resolved) return;
        resolved = true;
        resolve(ok);
      };

      try {
        const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
        this.ws = ws;

        // Setup timeout: 15s for the server to ack setup.
        const setupTimeout = setTimeout(() => {
          if (myRequestId !== this.connectRequestId) return; // stale
          console.log('[GEMINI_LIVE] setup timeout');
          this.callbacks.onError?.('Gemini Live setup timed out (15s)');
          this.setState('error');
          try { ws.close(); } catch { /* */ }
          this.ws = null;
          finish(false);
        }, 15000);

        ws.on('open', () => {
          if (myRequestId !== this.connectRequestId) {
            try { ws.close(); } catch { /* */ }
            return;
          }
          clearTimeout(setupTimeout);
          // Send the setup message (first client → server message).
          const setup = buildGeminiLiveSetup(model, this.systemInstruction, resumptionToken);
          const msg: BidiGenerateContentClientMessage = { setup };
          try {
            ws.send(JSON.stringify(msg));
            console.log('[GEMINI_LIVE] setup message sent');
          } catch (err: any) {
            const sanitized = sanitizeGeminiLiveError(err?.message || 'Failed to send setup');
            this.callbacks.onError?.(`Setup send failed: ${sanitized}`);
            this.setState('error');
            try { ws.close(); } catch { /* */ }
            finish(false);
          }
        });

        ws.on('message', (data: Buffer | string) => {
          if (myRequestId !== this.connectRequestId) return; // stale
          let parsed: BidiGenerateContentServerMessage;
          try {
            parsed = JSON.parse(typeof data === 'string' ? data : data.toString()) as BidiGenerateContentServerMessage;
          } catch {
            console.log('[GEMINI_LIVE] received non-JSON message — ignoring');
            return;
          }
          this.handleServerMessage(parsed, myRequestId);
          // setupComplete resolves the connect() promise.
          if (parsed.setupComplete && !resolved) {
            this.setState('connected');
            console.log('[GEMINI_LIVE] connected');
            finish(true);
          }
        });

        ws.on('error', (err: Error) => {
          if (myRequestId !== this.connectRequestId) return;
          clearTimeout(setupTimeout);
          // Sanitize: ws errors may include the URL (with ?key=...). Strip it.
          const sanitized = sanitizeGeminiLiveError(err?.message || 'WebSocket error');
          console.log('[GEMINI_LIVE] error: %s', sanitized);
          this.callbacks.onError?.(sanitized);
          if (this.state !== 'error') this.setState('error');
          this.ws = null;
          finish(false);
        });

        ws.on('close', (code: number, reason: Buffer) => {
          if (myRequestId !== this.connectRequestId) return;
          clearTimeout(setupTimeout);
          const reasonStr = reason?.toString?.() || '';
          console.log('[GEMINI_LIVE] closed (code=%s)', code);
          // 1000 = normal close, 1001 = going away, 1008 = policy violation (e.g. bad key)
          if (this.state !== 'error' && this.state !== 'disconnected') {
            if (code === 1008) {
              this.callbacks.onError?.('Gemini Live connection rejected (check API key)');
              this.setState('error');
            } else if (code === 1011) {
              this.callbacks.onError?.(`Gemini Live server error: ${sanitizeGeminiLiveError(reasonStr)}`);
              this.setState('error');
            } else {
              // Graceful close or unexpected — let the caller decide reconnect.
              this.setState('disconnected');
            }
          }
          this.ws = null;
          if (!resolved) finish(false);
        });
      } catch (err: any) {
        const sanitized = sanitizeGeminiLiveError(err?.message || 'Failed to open WebSocket');
        console.log('[GEMINI_LIVE] open error: %s', sanitized);
        this.callbacks.onError?.(sanitized);
        this.setState('error');
        this.ws = null;
        finish(false);
      }
    });
  }

  /**
   * Handle a parsed server message — dispatch to the appropriate callback.
   * `requestId` is the connectRequestId (to ignore stale messages from a
   * previous connection attempt).
   */
  private handleServerMessage(msg: BidiGenerateContentServerMessage, requestId: number): void {
    if (msg.error) {
      const sanitized = sanitizeGeminiLiveError(msg.error.message || 'Gemini API error');
      console.log('[GEMINI_LIVE] server error: %s', sanitized);
      this.callbacks.onError?.(sanitized);
      if (this.state !== 'error') this.setState('error');
      return;
    }
    if (msg.setupComplete) {
      // Handled in the message handler above (resolves connect()).
      return;
    }
    if (msg.goAway) {
      console.log('[GEMINI_LIVE] GoAway received (timeLeft=%s)', msg.goAway.timeLeft || 'unknown');
      this.callbacks.onGoAway?.(GEMINI_LIVE_GOAWAY_NOTICE_MS);
      // The caller (VoiceManager / conversation) decides whether to reconnect.
      return;
    }
    if (msg.sessionResumptionUpdate?.resumptionToken) {
      this.resumptionToken = msg.sessionResumptionUpdate.resumptionToken;
      console.log('[GEMINI_LIVE] resumption token received');
      this.callbacks.onResumptionToken?.(msg.sessionResumptionUpdate.resumptionToken);
      return;
    }
    if (msg.toolCall) {
      // O6-MVP: log only, do NOT execute (per directive — no native function calling).
      console.log('[GEMINI_LIVE] toolCall received (NOT executed in O6-MVP): %d calls', msg.toolCall.functionCalls?.length || 0);
      this.callbacks.onToolCall?.(msg.toolCall);
      return;
    }
    if (msg.toolCallCancellation) {
      console.log('[GEMINI_LIVE] toolCallCancellation received: %j', msg.toolCallCancellation.ids);
      return;
    }
    if (msg.serverContent) {
      this.handleServerContent(msg.serverContent);
    }
  }

  /**
   * Handle a `serverContent` message: audio chunks, transcripts, interruption, turn-complete.
   * The `requestId` here is the engine's `currentTtsRequestId` — passed via the
   * callback so the renderer's GeminiAudioQueue + the existing Piper path share
   * the SAME stale guard. NO new counter.
   */
  private currentRequestId: number = 0;
  setCurrentRequestId(id: number): void { this.currentRequestId = id; }

  private handleServerContent(content: NonNullable<BidiGenerateContentServerMessage['serverContent']>): void {
    // Barge-in: server detected user speech while model was responding.
    if (content.interrupted) {
      console.log('[GEMINI_LIVE] interrupted (barge-in)');
      this.setState('interrupted');
      this.callbacks.onInterrupted?.(this.currentRequestId);
      return;
    }
    // Transcriptions (live captions).
    if (content.inputTranscription?.text) {
      this.callbacks.onInputTranscription?.(content.inputTranscription.text);
    }
    if (content.outputTranscription?.text) {
      this.callbacks.onOutputTranscription?.(content.outputTranscription.text);
    }
    // Audio chunks from the model.
    if (content.modelTurn?.parts) {
      // Only transition to 'speaking' if we were 'listening' or 'connected'.
      // (If interrupted, stay interrupted — the server sends trailing chunks
      //  but we should drop them per the barge-in semantics.)
      if (this.state === 'listening' || this.state === 'connected') {
        this.setState('speaking');
      }
      for (const part of content.modelTurn.parts) {
        if (part.inlineData?.data) {
          // Decode base64 → raw 16-bit PCM Buffer.
          try {
            const pcmBuffer = Buffer.from(part.inlineData.data, 'base64');
            // Only emit if not interrupted (drop trailing chunks after barge-in).
            if (this.state !== 'interrupted') {
              this.callbacks.onAudioChunk?.(pcmBuffer, this.currentRequestId);
            }
          } catch (err: any) {
            console.log('[GEMINI_LIVE] audio chunk decode error: %s', sanitizeGeminiLiveError(err?.message || ''));
          }
        }
        if (part.text) {
          // Text part — treat as output transcription variant.
          this.callbacks.onOutputTranscription?.(part.text);
        }
      }
    }
    // Turn complete — flush the audio queue for this requestId.
    if (content.turnComplete) {
      console.log('[GEMINI_LIVE] turn complete (req=%s)', this.currentRequestId);
      this.callbacks.onTurnComplete?.(this.currentRequestId);
      // Return to listening (server-side VAD will pick up the next utterance).
      if (this.state === 'speaking') this.setState('listening');
    }
  }

  /**
   * Send a raw 16-bit PCM 16kHz mono audio chunk to the server.
   * The renderer's voice-service.ts already produces this format — zero
   * conversion needed here.
   */
  feedInputAudio(pcm16Buffer: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.state !== 'listening' && this.state !== 'connected' && this.state !== 'speaking') return;
    try {
      const realtimeInput = buildRealtimeAudioMessage(pcm16Buffer);
      const msg: BidiGenerateContentClientMessage = { realtimeInput };
      this.ws.send(JSON.stringify(msg));
    } catch (err: any) {
      // Don't spam logs for transient send errors.
      console.log('[GEMINI_LIVE] feedInputAudio error: %s', sanitizeGeminiLiveError(err?.message || ''));
    }
  }

  /**
   * Signal that the mic was muted — flush the server's cached audio.
   * Per official docs: "When the audio stream is paused for more than a second,
   * an audioStreamEnd event should be sent to flush any cached audio."
   */
  sendAudioStreamEnd(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      const realtimeInput = buildAudioStreamEndMessage();
      const msg: BidiGenerateContentClientMessage = { realtimeInput };
      this.ws.send(JSON.stringify(msg));
    } catch { /* best-effort */ }
  }

  /**
   * Transition to listening mode (mic streaming active).
   * Called by the conversation layer when it enters listening state.
   */
  startListening(): void {
    if (this.state === 'connected' || this.state === 'speaking' || this.state === 'interrupted') {
      this.setState('listening');
    }
  }

  /**
   * Get the last resumption token (for reconnect).
   */
  getResumptionToken(): string | null {
    return this.resumptionToken;
  }

  /**
   * Clear the resumption token (e.g. after a successful reconnect without it).
   */
  clearResumptionToken(): void {
    this.resumptionToken = null;
  }

  /**
   * Close the current connection. Internal helper for connect() reconnect path.
   */
  private closeInternal(reason: string): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.goAwayTimer) {
      clearTimeout(this.goAwayTimer);
      this.goAwayTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch { /* */ }
      this.ws = null;
    }
    this.setState('disconnected');
  }

  /**
   * Disconnect from the Gemini Live API. Used by the conversation layer when
   * stopping voice mode. Does NOT dispose the transport (it can reconnect).
   */
  disconnect(): void {
    console.log('[GEMINI_LIVE] disconnect');
    this.closeInternal('user-stop');
  }

  /**
   * Dispose the transport permanently (app shutdown). Releases all resources.
   * After dispose, the transport cannot be reused.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.closeInternal('dispose');
    this.callbacks = {};
    console.log('[GEMINI_LIVE] disposed');
  }
}

// ─── Singleton (one transport per app lifetime) ──────────────────────────

let _transport: GeminiLiveTransport | null = null;

export function getGeminiLiveTransport(): GeminiLiveTransport {
  if (!_transport) {
    _transport = new GeminiLiveTransport();
  }
  return _transport;
}

export function _resetGeminiLiveTransport(): void {
  if (_transport) {
    _transport.dispose();
    _transport = null;
  }
}
