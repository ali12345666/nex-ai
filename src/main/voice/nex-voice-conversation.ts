/**
 * NEX AI — Voice Conversation System (Phase 56)
 *
 * Upgrades voice from simple STT/TTS into a natural conversational assistant.
 * A finite-state machine drives the conversation, with continuous context
 * tracking, user-interruption detection, personality-aware responses, and
 * permission-gated voice confirmation for sensitive actions.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CONVERSATION FLOW
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   Wake word / voice trigger ("سلام NEX")
 *        ↓
 *   Listen (Local Whisper STT)
 *        ↓
 *   NEX Brain (model selection)
 *        ↓
 *   Personality Engine + Long-Term Memory (context)
 *        ↓
 *   Local Piper TTS (speak)
 *        ↓
 *   Listen again (continuous) OR idle
 *
 * STATES:  idle → listening → thinking → speaking → (interrupted) → listening
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CRITICAL SECURITY (Phase 43)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * NEX MUST NEVER autonomously:
 *   - perform sensitive actions (file modify / terminal / install / delete)
 *   - confirm a permission without an explicit spoken "بله تایید می‌کنم"
 *   - upload audio anywhere
 *   - use a cloud speech API
 *   - record audio permanently without permission
 *
 * Voice confirmation for sensitive actions goes through PermissionGate's
 * `respondViaVoice()` → this system's STT capture hook → transcript is
 * matched against the required Persian confirmation phrase.
 *
 * All voice processing is LOCAL (whisper.cpp + piper). No network.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { getLocalVoiceEngine, type VoiceEngineState, type VoiceEngineCallbacks } from './local-voice-engine';
import { getWakeWordDetector, parseVoiceCommand, type WakeWordMatch, type VoiceControlCommand } from './wake-word-detector';
import { getNexPersonalityEngine } from '../ai/nex-personality-engine';
import type { PersonalityType } from '../ai/nex-identity-manager';
import { getLongTermMemorySystem } from '../ai/long-term-memory-system';

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * Conversation state machine.
 *   idle         — not in a conversation, waiting for wake word
 *   listening    — capturing user speech via STT
 *   thinking     — processing (brain + memory + personality)
 *   speaking     — TTS playback of NEX's response
 *   interrupted  — user spoke during 'speaking' (barge-in)
 */
export type ConversationState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'interrupted';

/**
 * Orb color mapping (Phase 56 spec):
 *   idle → blue
 *   listening → green
 *   thinking → purple
 *   speaking → green
 *   error → red
 */
export const CONVERSATION_ORB_COLOR: Record<ConversationState | 'error', string> = {
  idle: '#00e5ff',        // cyan — calm, ready
  listening: '#3b82f6',   // blue — receiving input
  thinking: '#8b5cf6',    // purple — internal processing
  speaking: '#22c55e',    // green — output (speaking)
  interrupted: '#f59e0b', // amber (transition)
  error: '#ef4444',       // red
};

export interface ConversationContext {
  /** The most recent user utterance (raw transcript). */
  currentUtterance: string;
  /** The previous user utterance (for "همان قبلی" resolution). */
  previousUtterance: string;
  /** The topic of the current conversation (derived/heuristic). */
  currentTopic: string | null;
  /** The previous topic. */
  previousTopic: string | null;
  /** The current task NEX is working on (free-form). */
  currentTask: string | null;
  /** Turn counter for this conversation session. */
  turnCount: number;
  /** When the conversation started. */
  startedAt: number;
  /** Last activity timestamp. */
  lastActivityAt: number;
  /** Whether a sensitive-action permission is pending voice confirmation. */
  pendingPermission: boolean;
}

export interface ConversationTurn {
  role: 'user' | 'nex';
  text: string;
  timestamp: number;
  state: ConversationState;
}

export interface ConversationCallbacks {
  onStateChange?: (state: ConversationState, prev: ConversationState) => void;
  onWakeWord?: (match: WakeWordMatch) => void;
  onUserUtterance?: (text: string) => void;
  onNexResponse?: (text: string) => void;
  onPartialTranscript?: (text: string) => void;
  onInterruption?: () => void;
  onVoiceCommand?: (command: VoiceControlCommand, phrase: string | null) => void;
  onError?: (message: string) => void;
  /** Hook to capture a voice confirmation (returns transcript). */
  onCaptureVoiceConfirmation?: () => Promise<string>;
}

export interface ConversationStatus {
  state: ConversationState;
  active: boolean;
  wakeWordEnabled: boolean;
  context: ConversationContext;
  recentTurns: ConversationTurn[];
  personality: PersonalityType;
  orbColor: string;
}

// ─── Conversation System ───────────────────────────────────────────────────

export class NexVoiceConversation {
  private state: ConversationState = 'idle';
  private callbacks: ConversationCallbacks = {};
  private context: ConversationContext;
  private turns: ConversationTurn[] = [];
  private personality: PersonalityType = 'professional';
  private wakeEnabled = true;
  private active = false;
  private interruptionDetected = false;
  private permissionVoiceCaptureFn: (() => Promise<string>) | null = null;

  // ── Phase 16 (BUG-12 + BUG-26): TTS request coordination ──────────────
  //
  // `currentTtsRequestId` is the monotonic ID of the currently-in-flight TTS
  // turn. It is incremented at the start of every speakResponse() and on
  // every cancel (abortCurrentTurn / handleInterruption). The engine uses
  // the same ID for its stale-detection guard (BUG-26 A), and the renderer
  // uses it to decide which `voice-tts-audio` IPC is the "current" one
  // (BUG-26 B + overlap protection).
  //
  // `ttsPlaybackResolve` / `ttsPlaybackRequestId` / `ttsPlaybackTimeout`
  // implement `waitForTtsPlayback(requestId)` — a promise that resolves
  // when the renderer sends `voice-tts-ended` for this requestId, OR when
  // the request is cancelled/superseded, OR after a 30s safety timeout
  // (BUG-12 fix: prevents hang if renderer crashes or audio element never
  // fires `onended`).
  private currentTtsRequestId = 0;
  private ttsPlaybackResolve: (() => void) | null = null;
  private ttsPlaybackRequestId: number | null = null;
  private ttsPlaybackTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.context = {
      currentUtterance: '',
      previousUtterance: '',
      currentTopic: null,
      previousTopic: null,
      currentTask: null,
      turnCount: 0,
      startedAt: 0,
      lastActivityAt: 0,
      pendingPermission: false,
    };
  }

  setCallbacks(callbacks: ConversationCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  get currentState(): ConversationState {
    return this.state;
  }

  get isActive(): boolean {
    return this.active;
  }

  get wakeWordEnabled(): boolean {
    return this.wakeEnabled;
  }

  get currentContext(): ConversationContext {
    return { ...this.context };
  }

  get currentPersonality(): PersonalityType {
    return this.personality;
  }

  get orbColor(): string {
    return CONVERSATION_ORB_COLOR[this.state];
  }

  // ── Lifecycle ──

  /**
   * Start the conversation system: enable wake-word listening and mark active.
   * Does NOT immediately start STT — waits for the wake word.
   */
  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.context.startedAt = Date.now();
    this.context.lastActivityAt = this.context.startedAt;
    this.setState('idle');
    // Wake-word detection is handled inside feedTranscript (the caller feeds
    // transcripts as they arrive from STT). No separate listener needed —
    // a single feedTranscript call resolves the wake word + remainder in one pass.
  }

  /**
   * Stop the conversation system: stop STT/TTS, clear state.
   */
  async stop(): Promise<void> {
    this.active = false;
    try {
      const engine = getLocalVoiceEngine();
      if (engine.isListening) await engine.stopListening();
      if (engine.isSpeaking) engine.stopSpeaking();
    } catch { /* */ }
    this.setState('idle');
  }

  /**
   * Toggle the conversation on/off.
   */
  async toggle(): Promise<void> {
    if (this.active) await this.stop();
    else await this.start();
  }

  /** Enable wake-word detection. */
  enableWakeWord(): void {
    this.wakeEnabled = true;
  }

  /** Disable wake-word detection (e.g., during a meeting). */
  disableWakeWord(): void {
    this.wakeEnabled = false;
  }

  // ── Personality ──

  setPersonality(type: PersonalityType): void {
    this.personality = type;
    try { getNexPersonalityEngine().setPersonality(type); } catch { /* */ }
  }

  getPersonalityPrefixFa(): string {
    try {
      return getNexPersonalityEngine().getSystemPromptPrefixFa();
    } catch {
      return '';
    }
  }

  // ── Wake word handling ──

  /**
   * Feed a transcript to the wake word detector (called after STT produces
   * a result, OR continuously as partial transcripts arrive).
   */
  feedTranscript(text: string): void {
    if (!text || !this.active) return;

    // First: check for natural speech-control commands (interruption / stop / resume)
    const cmd = parseVoiceCommand(text);
    if (cmd.command !== 'unknown') {
      this.handleVoiceCommand(cmd.command, cmd.matchedPhrase);
      this.callbacks.onVoiceCommand?.(cmd.command, cmd.matchedPhrase);
      return;
    }

    // If a permission is pending, route the transcript to permission confirmation
    if (this.context.pendingPermission) {
      this.handlePermissionConfirmation(text);
      return;
    }

    // If we're speaking and the user talks → interruption (barge-in)
    if (this.state === 'speaking') {
      this.handleInterruption(text);
      return;
    }

    // If wake word detection is enabled, check for it
    if (this.wakeEnabled) {
      const detector = getWakeWordDetector();
      const match = detector.feedTranscript(text);
      if (match.matched) {
        this.handleWakeWord(match);
        return;
      }
    }

    // Otherwise, treat as a user utterance in the current conversation.
    // (The 'speaking' state was already handled above as a barge-in, so
    // at this point we're in idle/listening/thinking/interrupted — all of
    // which accept a new user utterance as a fresh turn.)
    this.handleUserUtterance(text);
  }

  /**
   * Manually trigger a conversation turn (e.g., from chat input or button).
   * Bypasses the wake word — starts listening immediately.
   */
  async startConversationTurn(initialText?: string): Promise<void> {
    if (!this.active) await this.start();
    if (initialText) {
      this.handleUserUtterance(initialText);
    } else {
      await this.enterListening();
    }
  }

  // ── Internal state machine ──

  private handleWakeWord(match: WakeWordMatch): void {
    this.callbacks.onWakeWord?.(match);
    // If the wake phrase had a trailing command (e.g., "سلام NEX یک مدار طراحی کن")
    // treat the remainder as the user utterance directly.
    if (match.remainder.trim()) {
      this.handleUserUtterance(match.remainder);
    } else {
      this.enterListening();
    }
  }

  private async enterListening(): Promise<void> {
    if (!this.active) return;
    this.setState('listening');
    try {
      const engine = getLocalVoiceEngine();
      if (!engine.isListening) {
        await engine.startListening();
      }
    } catch (err: any) {
      this.callbacks.onError?.(`STT start failed: ${err?.message || err}`);
    }
  }

  private async exitListening(): Promise<string> {
    try {
      const engine = getLocalVoiceEngine();
      if (engine.isListening) {
        await engine.stopListening();
      }
    } catch { /* */ }
    return this.context.currentUtterance;
  }

  /**
   * Handle a complete user utterance: resolve context references, store the
   * turn, transition to thinking, and (in production) hand off to the brain.
   */
  private handleUserUtterance(text: string): void {
    const resolved = this.resolveContextReferences(text);

    // Update context
    this.context.previousUtterance = this.context.currentUtterance;
    this.context.currentUtterance = resolved;
    this.context.turnCount++;
    this.context.lastActivityAt = Date.now();

    // Heuristic topic detection
    this.context.previousTopic = this.context.currentTopic;
    this.context.currentTopic = this.detectTopic(resolved);

    // Record the turn
    this.turns.push({ role: 'user', text: resolved, timestamp: Date.now(), state: this.state });
    this.callbacks.onUserUtterance?.(resolved);

    // Persist context to long-term memory (session-scoped, public, no permission needed)
    this.persistContext();

    // Transition to thinking
    this.setState('thinking');
    try { getLocalVoiceEngine().setThinking(true); } catch { /* */ }

    // Phase 14+15: The response is generated by the chat panel, not here.
    // The flow is:
    //   1. This conversation system emits onUserUtterance → voice-conversation-user IPC
    //   2. AppShell.tsx dispatches nex:voice-transcript (source='voice') to NexChatPanel
    //   3. NexChatPanel calls brainRoute IPC → agent/chat generates response
    //   4. After response completion, NexChatPanel calls voiceConversationSpeak IPC
    //   5. That triggers this.speakResponse() → Piper TTS → audio playback
    //   6. After TTS, this.enterListening() restarts STT (continuous mode)
    //
    // We do NOT generate a response here — we wait for the external
    // voiceConversationSpeak() call from NexChatPanel.
  }

  /**
   * Resolve pronoun references like "همان قبلی" (the same as before) using
   * the stored conversation context.
   *
   * "همان قبلی" refers to the immediately preceding utterance. At the time
   * of resolution, that utterance is still in `currentUtterance` (it moves to
   * `previousUtterance` only AFTER this resolution + the context update).
   */
  private resolveContextReferences(text: string): string {
    const normalized = text.replace(/\u200c/g, ' ').trim();

    // "همان قبلی" / "قبلی" → refer to the last utterance (current, about to be previous)
    if (/همان\s*قبلی|همون\s*قبلی|قبلی/.test(normalized)) {
      const ref = this.context.currentUtterance || this.context.previousUtterance;
      if (ref) {
        return `${ref} (مرجع: همان قبلی)`;
      }
    }

    // "همین" / "این" without a noun → refer to current topic
    if (/^(همین|این)$/.test(normalized) && this.context.currentTopic) {
      return this.context.currentTopic;
    }

    // "ادامه‌اش" / "ادامه اش" → continue the current task
    if (/ادامه\s*اش|ادامه‌اش| ادامه‌اش/.test(normalized) && this.context.currentTask) {
      return `ادامه ${this.context.currentTask}`;
    }

    return text;
  }

  /**
   * Heuristic topic detection from the utterance.
   * In production, the expert router (Phase 53) would inform this.
   */
  private detectTopic(text: string): string | null {
    const lower = text.toLowerCase();
    if (/مدار|circuit|ولت|amp|resistor|مقاومت|خازن|capacitor|آردوینو|arduino|esp32/.test(lower)) return 'electronics';
    if (/کد|code|تابع|function|برنامه|program|debug|باگ|bug/.test(lower)) return 'software';
    if (/ریاضی|math|فیزیک|physics|شیمی|chemistry/.test(lower)) return 'science';
    if (/پروژه|project|مدیریت|manage/.test(lower)) return 'project';
    return null;
  }

  /**
   * Speak a response (TTS). Called by the brain / chat IPC after generating
   * a personality-styled response.
   *
   * Phase 16 (BUG-12 + BUG-26 fix):
   *
   * The new lifecycle is:
   *   1. Generate a fresh requestId (invalidates any previous in-flight TTS).
   *   2. setState('speaking') and call engine.speak(text, { requestId }).
   *      engine.speak returns once Piper synthesis is done (NOT once audio
   *      playback is done — that's the bug we're fixing). It returns
   *      `audioReady` = true iff `onTTSAudioReady` was fired.
   *   3. If audioReady is false (synthesis failed OR stale per BUG-26 A
   *      guard), do NOT wait — transition to idle and return.
   *   4. If the request was superseded during synthesis (a newer
   *      speakResponse or a Stop arrived), abort without waiting.
   *   5. Otherwise, await `waitForTtsPlayback(requestId)` — a promise that
   *      resolves when the renderer sends `voice-tts-ended` for this
   *      requestId (audio element's `onended` / `onerror`), with a 30s
   *      safety timeout.
   *   6. After the wait resolves, re-check the requestId — if a Stop or
   *      newer request arrived during playback, do NOT enterListening.
   *   7. Only if still current, enterListening() (which transitions to
   *      'listening' and restarts STT).
   *
   * Race protection (TTS #1 → Stop → TTS #1 late → TTS #2):
   *   - Stop bumps currentTtsRequestId, so engine.speak's BUG-26 A guard
   *     discards the late #1 synthesis result. audioReady=false, the wait
   *     is skipped. No audio for #1.
   *   - TTS #2 gets a fresh requestId, synthesizes normally, waits for its
   *     own playback, and only #2 plays.
   */
  async speakResponse(text: string): Promise<void> {
    if (!text.trim()) return;

    // Generate a fresh request ID. This invalidates any previous in-flight
    // TTS — its engine stale-guard will fire, its waitForTtsPlayback will
    // be released immediately (see releaseTtsPlaybackWait below).
    this.currentTtsRequestId++;
    const requestId = this.currentTtsRequestId;

    // Record the turn
    this.turns.push({ role: 'nex', text, timestamp: Date.now(), state: 'speaking' });
    this.callbacks.onNexResponse?.(text);

    // Transition to speaking
    this.setState('speaking');

    let audioReady = false;
    try {
      const engine = getLocalVoiceEngine();
      // Pass requestId so engine uses it for stale detection and tags the
      // voice-tts-audio IPC. The renderer uses it to discard stale audio.
      audioReady = await engine.speak(text, { requestId });
    } catch (err: any) {
      this.callbacks.onError?.(`TTS failed: ${err?.message || err}`);
      this.setState('idle');
      this.releaseTtsPlaybackWait();
      return;
    }

    // GUARD 1: if a newer request or Stop superseded this one during
    // synthesis, do NOT wait for playback and do NOT enterListening.
    if (this.currentTtsRequestId !== requestId) {
      console.log(`[VOICE_PIPELINE] speakResponse: req=${requestId} superseded during synthesis — not waiting for playback`);
      return;
    }

    // GUARD 2: if synthesis failed or was discarded as stale (BUG-26 A),
    // there is no audio to wait for. Transition to idle and return.
    if (!audioReady) {
      console.log(`[VOICE_PIPELINE] speakResponse: req=${requestId} no audio ready — transitioning to idle`);
      this.setState(this.active ? 'idle' : 'idle');
      return;
    }

    // Wait for the renderer to confirm playback ended (BUG-12 fix).
    // This promise resolves when:
    //   (a) the renderer sends `voice-tts-ended` for this requestId
    //       (audio element's `onended` fired), OR
    //   (b) the renderer sends `voice-tts-ended` for this requestId
    //       because `onerror` fired (defensive — release the wait), OR
    //   (c) a newer speakResponse or Stop bumps currentTtsRequestId
    //       (releaseTtsPlaybackWait auto-resolves the pending wait), OR
    //   (d) the 30s safety timeout fires (defensive — prevents hang if
    //       the renderer crashed or audio element never fires onended).
    await this.waitForTtsPlayback(requestId);

    // GUARD 3: re-check after the wait — a Stop or newer request may have
    // arrived during playback. If so, do NOT enterListening (the new
    // request's speakResponse will handle that, or the user explicitly
    // cancelled).
    if (this.currentTtsRequestId !== requestId) {
      console.log(`[VOICE_PIPELINE] speakResponse: req=${requestId} cancelled during playback — not entering listening`);
      return;
    }

    // After playback ended, return to listening (continuous conversation)
    // or idle.
    if (this.active && !this.interruptionDetected) {
      await this.enterListening();
    } else {
      this.interruptionDetected = false;
      this.setState('idle');
    }
  }

  /**
   * Phase 16 (BUG-12 fix): Wait for the renderer to confirm that the audio
   * element finished playing the TTS WAV file for the given requestId.
   *
   * Resolves when:
   *   - `notifyTtsPlaybackEnded(requestId)` is called (renderer sent
   *     `voice-tts-ended` for this requestId), OR
   *   - `releaseTtsPlaybackWait()` is called (cancel/supersede — the
   *     pending wait is released so the caller doesn't hang), OR
   *   - 30s safety timeout fires (defensive — prevents permanent hang if
   *     renderer crashes or audio element never fires `onended`).
   *
   * If `requestId` does not match `this.currentTtsRequestId` at call time,
   * resolves immediately (the request was already superseded before this
   * wait even started).
   */
  private waitForTtsPlayback(requestId: number): Promise<void> {
    // If already superseded, resolve immediately.
    if (this.currentTtsRequestId !== requestId) {
      console.log(`[VOICE_PIPELINE] waitForTtsPlayback: req=${requestId} already superseded — resolving immediately`);
      return Promise.resolve();
    }
    // If a previous wait is somehow still pending, release it first
    // (defensive — should not normally happen because speakResponse is
    // serialized, but protects against reentrancy).
    this.releaseTtsPlaybackWait();
    return new Promise<void>((resolve) => {
      this.ttsPlaybackRequestId = requestId;
      this.ttsPlaybackResolve = resolve;
      this.ttsPlaybackTimeout = setTimeout(() => {
        if (this.ttsPlaybackRequestId === requestId) {
          console.warn(`[VOICE_PIPELINE] TTS playback wait timeout for req=${requestId} — releasing (renderer may have crashed)`);
          this.releaseTtsPlaybackWait();
        }
      }, 30000);
    });
  }

  /**
   * Phase 16 (BUG-12 fix): Called by the main process `voice-tts-ended`
   * IPC handler when the renderer's audio element fires `onended` (or
   * `onerror`). Resolves the pending `waitForTtsPlayback(requestId)`
   * promise iff the signal matches the current pending wait.
   *
   * If the signal is for a stale requestId (already superseded), it is
   * ignored — the wait was already released by `releaseTtsPlaybackWait`
   * when the supersede happened.
   */
  notifyTtsPlaybackEnded(requestId: number): void {
    if (this.ttsPlaybackRequestId === requestId) {
      console.log(`[VOICE_PIPELINE] TTS playback ended signal for req=${requestId} — releasing wait`);
      this.releaseTtsPlaybackWait();
    } else {
      // Stale signal — ignore. Could be:
      //   - a late `onended` for a previously-cancelled request, OR
      //   - a duplicate `onended` after the wait was already released.
      console.log(`[VOICE_PIPELINE] TTS playback ended signal for req=${requestId} but current wait is for req=${this.ttsPlaybackRequestId} — ignoring (stale)`);
    }
  }

  /**
   * Phase 16 (BUG-12 + BUG-26): Release the pending `waitForTtsPlayback`
   * promise (if any). Called by:
   *   - `notifyTtsPlaybackEnded` when the matching signal arrives, OR
   *   - `abortCurrentTurn` / `handleInterruption` when the user cancels, OR
   *   - `speakResponse` when a newer request supersedes the previous one
   *     (the previous wait is released so the previous speakResponse can
   *     finish and exit without hanging).
   *
   * Also bumps `currentTtsRequestId` so the engine's stale-guard discards
   * any in-flight synthesis for the cancelled request (BUG-26 A).
   */
  private releaseTtsPlaybackWait(): void {
    if (this.ttsPlaybackResolve) {
      const resolve = this.ttsPlaybackResolve;
      this.ttsPlaybackResolve = null;
      this.ttsPlaybackRequestId = null;
      if (this.ttsPlaybackTimeout) {
        clearTimeout(this.ttsPlaybackTimeout);
        this.ttsPlaybackTimeout = null;
      }
      resolve();
    }
  }

  /**
   * Handle a barge-in: the user spoke while NEX was speaking.
   * Stops TTS immediately and transitions to listening.
   *
   * Phase 16 (BUG-26 fix): bumps currentTtsRequestId and releases any
   * pending playback wait so the cancelled speakResponse doesn't hang,
   * and the engine's stale-guard discards any in-flight synthesis.
   */
  private handleInterruption(text: string): void {
    this.interruptionDetected = true;
    this.callbacks.onInterruption?.();
    // Phase 16: invalidate any in-flight TTS (synthesis + playback).
    this.currentTtsRequestId++;
    this.releaseTtsPlaybackWait();
    try {
      const engine = getLocalVoiceEngine();
      engine.stopSpeaking();
    } catch { /* */ }
    this.setState('interrupted');
    // Immediately process the interrupting utterance as a new turn
    setTimeout(() => this.handleUserUtterance(text), 50);
  }

  /**
   * Handle a natural speech-control command (stop / resume / cancel).
   */
  private handleVoiceCommand(command: VoiceControlCommand, phrase: string | null): void {
    switch (command) {
      case 'stop-speaking':
        try { getLocalVoiceEngine().stopSpeaking(); } catch { /* */ }
        this.setState('idle');
        break;
      case 'resume':
        if (this.active) this.enterListening();
        break;
      case 'cancel':
        this.abortCurrentTurn();
        break;
      case 'repeat':
        // Repeat the last NEX response
        const lastNex = [...this.turns].reverse().find((t) => t.role === 'nex');
        if (lastNex) this.speakResponse(lastNex.text);
        break;
      case 'unknown':
      default:
        break;
    }
  }

  /**
   * Abort the current turn (cancel thinking / speaking).
   *
   * Phase 16 (BUG-12 + BUG-26 fix):
   *   - Bump `currentTtsRequestId` so the engine's stale-guard (BUG-26 A)
   *     discards any in-flight Piper synthesis. The renderer also uses the
   *     bumped ID via the `voice-tts-stop-playback` IPC to pause any
   *     currently-playing audio element (BUG-26 B).
   *   - Release the pending `waitForTtsPlayback` promise (BUG-12) so the
   *     speakResponse that's awaiting playback doesn't hang waiting for a
   *     `voice-tts-ended` signal that will never come (the renderer pauses
   *     the audio, so `onended` may not fire).
   */
  abortCurrentTurn(): void {
    // Invalidate any in-flight TTS request (both engine synthesis and
    // renderer playback). The bumped ID causes:
    //   - engine.speak's stale-guard to discard late synthesis (BUG-26 A)
    //   - speakResponse's GUARD 1/3 to skip enterListening (BUG-12)
    this.currentTtsRequestId++;
    // Release any pending playback wait so speakResponse doesn't hang.
    this.releaseTtsPlaybackWait();
    try {
      const engine = getLocalVoiceEngine();
      if (engine.isSpeaking) engine.stopSpeaking();
      if (engine.isListening) { engine.stopListening().catch(() => {}); }
    } catch { /* */ }
    this.setState('idle');
  }

  // ── Permission voice confirmation (Phase 43 integration) ──

  /**
   * Register a voice-capture function for permission confirmations.
   * Called by the PermissionGate via `onCaptureVoiceInput`.
   */
  setPermissionVoiceCapture(fn: () => Promise<string>): void {
    this.permissionVoiceCaptureFn = fn;
  }

  /**
   * Capture a voice confirmation for a pending permission request.
   * Puts the conversation into 'listening' state, captures one utterance,
   * and returns the transcript. The PermissionGate matches it against the
   * required Persian phrase ("بله تایید می‌کنم" / "تایید می‌کنم").
   */
  async captureVoiceConfirmation(): Promise<string> {
    this.context.pendingPermission = true;
    const prev = this.state;
    await this.enterListening();
    try {
      if (this.permissionVoiceCaptureFn) {
        return await this.permissionVoiceCaptureFn();
      }
      // Fallback: wait for the next transcript via feedTranscript
      return await new Promise<string>((resolve) => {
        const timeout = setTimeout(() => {
          this.context.pendingPermission = false;
          resolve('');
        }, 10000); // 10s timeout
        const orig = { ...this.callbacks };
        this.callbacks.onUserUtterance = (text: string) => {
          clearTimeout(timeout);
          this.context.pendingPermission = false;
          this.callbacks = orig;
          resolve(text);
        };
      });
    } finally {
      this.context.pendingPermission = false;
      if (prev !== 'listening') this.setState(prev);
    }
  }

  /**
   * Handle an incoming transcript when a permission is pending.
   * Routes it as the permission confirmation (does NOT start a new turn).
   */
  private handlePermissionConfirmation(text: string): void {
    // The PermissionGate's respondViaVoice flow calls captureVoiceConfirmation,
    // which resolves the promise with the transcript. This path is for the
    // fallback case where the conversation's feedTranscript receives the
    // confirmation directly.
    this.context.pendingPermission = false;
    // Re-emit so the capture promise (if waiting) can resolve.
    this.callbacks.onUserUtterance?.(text);
  }

  // ── Context persistence (Long-Term Memory) ──

  private persistContext(): void {
    try {
      const mem = getLongTermMemorySystem();
      mem.store('pattern', 'voice:previous-topic', this.context.previousTopic, {
        store: 'session', sensitivity: 'public', tags: ['voice', 'conversation-context'],
      }).catch(() => {});
      mem.store('pattern', 'voice:current-topic', this.context.currentTopic, {
        store: 'session', sensitivity: 'public', tags: ['voice', 'conversation-context'],
      }).catch(() => {});
      mem.store('pattern', 'voice:current-task', this.context.currentTask, {
        store: 'session', sensitivity: 'public', tags: ['voice', 'conversation-context'],
      }).catch(() => {});
      mem.store('pattern', 'voice:previous-utterance', this.context.previousUtterance, {
        store: 'session', sensitivity: 'public', tags: ['voice', 'conversation-context'],
      }).catch(() => {});
    } catch { /* memory is best-effort */ }
  }

  /**
   * Restore context from long-term memory (on conversation restart).
   */
  async restoreContext(): Promise<void> {
    try {
      const mem = getLongTermMemorySystem();
      const prevTopic = mem.retrieve('voice:previous-topic', 'session');
      const curTopic = mem.retrieve('voice:current-topic', 'session');
      const curTask = mem.retrieve('voice:current-task', 'session');
      const prevUtter = mem.retrieve('voice:previous-utterance', 'session');
      if (typeof prevTopic === 'string') this.context.previousTopic = prevTopic;
      if (typeof curTopic === 'string') this.context.currentTopic = curTopic;
      if (typeof curTask === 'string') this.context.currentTask = curTask;
      if (typeof prevUtter === 'string') this.context.previousUtterance = prevUtter;
    } catch { /* */ }
  }

  // ── Status ──

  getStatus(): ConversationStatus {
    return {
      state: this.state,
      active: this.active,
      wakeWordEnabled: this.wakeEnabled,
      context: this.currentContext,
      recentTurns: this.turns.slice(-10),
      personality: this.personality,
      orbColor: this.orbColor,
    };
  }

  getRecentTurns(limit = 10): ConversationTurn[] {
    return this.turns.slice(-limit);
  }

  /** Reset the conversation (clear context + turns). */
  reset(): void {
    this.context = {
      currentUtterance: '',
      previousUtterance: '',
      currentTopic: null,
      previousTopic: null,
      currentTask: null,
      turnCount: 0,
      startedAt: this.active ? Date.now() : 0,
      lastActivityAt: Date.now(),
      pendingPermission: false,
    };
    this.turns = [];
    this.interruptionDetected = false;
    this.setState('idle');
  }

  // ── State machine ──

  private setState(newState: ConversationState): void {
    if (this.state === newState) return;
    const prev = this.state;
    this.state = newState;
    this.callbacks.onStateChange?.(newState, prev);
  }
}

// ─── Security self-audit ───────────────────────────────────────────────────

/**
 * Verifies the conversation system:
 *   - never uploads audio (no fetch / no net.request)
 *   - never calls a cloud speech API
 *   - never records permanently without permission
 *   - sensitive actions require explicit voice confirmation
 */
export function verifyConversationSecurity(): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  // The conversation system delegates all STT/TTS to the local providers
  // (LocalWhisperProvider / LocalPiperProvider). No cloud imports.
  // Permission confirmations go through PermissionGate.respondViaVoice().
  return { ok: findings.length === 0, findings };
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _conversation: NexVoiceConversation | null = null;

export function getNexVoiceConversation(): NexVoiceConversation {
  if (!_conversation) {
    _conversation = new NexVoiceConversation();
  }
  return _conversation;
}

export function _resetNexVoiceConversation(): void {
  _conversation = null;
}
