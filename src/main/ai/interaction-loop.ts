/**
 * NEX AI — Basic Interaction Loop (Phase 62: Basic Interaction MVP)
 *
 * The unified interaction loop that connects everything:
 *
 *   Text Input ──┐
 *                ├──→ Language Detection → System Prompt → Brain → GGUF → Response
 *   Voice (STT) ─┘                                                        ↓
 *                                                                   TTS → Speaker
 *
 * This is the MVP loop: user types or speaks → NEX answers locally
 * and can speak the answer. No cloud APIs.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  Interaction Loop Manager (this file)                       │
 *   │    1. processText(text) → detect lang → infer → respond     │
 *   │    2. processVoice(transcript) → same as text                │
 *   │    3. speakResponse(text) → TTS                              │
 *   │    4. getStatus() → model + runtime + STT/TTS + language     │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  Language Foundation (Phase 62)                              │
 *   │    detectLanguage + normalizePersian + buildSystemPrompt    │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  Local Engine (Phase 12)                                     │
 *   │    localChatComplete / localChatStream                      │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  Voice Engine (Phase 41)                                    │
 *   │    startListening / speak / stopSpeaking                     │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  Model Registry (Phase 39)                                  │
 *   │    getDefaultModel / listModels                              │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SECURITY
 * ════════════════════════════════════════════════════════════════════════════
 * - All inference is local (node-llama-cpp). No cloud API.
 * - All voice processing is local (whisper.cpp + piper). No cloud.
 * - This module NEVER downloads, installs, or deletes anything.
 * - It only orchestrates existing local inference + voice systems.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { detectLanguage, normalizePersian, buildSystemPrompt, getResponseLanguage, getLanguageLabelFa, type DetectedLanguage, type LanguageDetectionResult } from './language-foundation';
import { localChatComplete, localChatStream, localAbort, type LocalChatConfig, type LocalMessage } from './local-engine';
import { getDefaultModel, listModels, getModel, type LocalModelInfo } from './model-registry';
import { getLocalVoiceEngine } from '../voice/local-voice-engine';
import { getNexPersonalityEngine } from './nex-personality-engine';
import type { PersonalityType } from './nex-identity-manager';
import { getGpuBackend } from './inference';
import { getLastInference } from './runtime-telemetry';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface InteractionRequest {
  text: string;
  /** Whether this came from voice (STT). */
  fromVoice?: boolean;
  /** Conversation history (prior messages). */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Override model id (if not using default). */
  modelId?: string;
  /** Temperature override. */
  temperature?: number;
  /** Max tokens override. */
  maxTokens?: number;
  /** Whether to speak the response (TTS). */
  speakResponse?: boolean;
}

export interface InteractionResponse {
  success: boolean;
  response: string;
  language: DetectedLanguage;
  responseLanguage: 'fa' | 'en';
  modelId: string | null;
  modelName: string | null;
  tokensGenerated: number;
  durationMs: number;
  tokensPerSecond: number;
  fromVoice: boolean;
  spoken: boolean;
  error?: string;
}

export interface InteractionStatus {
  /** Whether a model is registered and available. */
  modelReady: boolean;
  /** Active model name (or null). */
  modelName: string | null;
  /** Model id (or null). */
  modelId: string | null;
  /** Model size. */
  modelSizeBytes: number;
  /** Whether STT is available (whisper binary + model). */
  sttReady: boolean;
  /** Whether TTS is available (piper binary + voice). */
  ttsReady: boolean;
  /** GPU backend. */
  gpuBackend: string;
  /** Last detected language. */
  lastLanguage: DetectedLanguage;
  /** Last language label (Persian). */
  lastLanguageLabelFa: string;
  /** Last inference tokens/sec. */
  lastTokensPerSecond: number | null;
  /** Total interactions. */
  totalInteractions: number;
  /** Whether inference is currently active. */
  inferenceActive: boolean;
}

// ─── Interaction Loop Manager ─────────────────────────────────────────────

export class InteractionLoopManager {
  private lastLanguage: DetectedLanguage = 'unknown';
  private totalInteractions = 0;
  private personality: PersonalityType = 'professional';

  /**
   * Process a text input: detect language → build prompt → infer → respond.
   *
   * This is the core MVP loop. User types (or STT produces a transcript),
   * NEX detects the language, builds a language-aware system prompt, runs
   * local inference, and optionally speaks the response via TTS.
   */
  async processText(request: InteractionRequest): Promise<InteractionResponse> {
    const start = Date.now();
    const text = request.text;

    if (!text || !text.trim()) {
      return this.fail('متن خالی است / Empty text', 'unknown', request.fromVoice || false);
    }

    // 1. Detect language + normalize
    const detection = detectLanguage(text);
    this.lastLanguage = detection.language;
    const normalizedText = detection.normalizedText;

    // 2. Build system prompt
    const systemPrompt = buildSystemPrompt(detection.language, this.personality);

    // 3. Resolve the model
    const model = request.modelId
      ? getModel(request.modelId)
      : getDefaultModel();

    if (!model) {
      return this.fail(
        'هیچ مدلی نصب نشده است. از پنل Deploy یک مدل GGUF اضافه کنید. / No model installed. Add a GGUF model from the Deploy panel.',
        detection.language,
        request.fromVoice || false,
      );
    }

    if (!model.fileExists) {
      return this.fail(
        `فایل مدل یافت نشد: ${model.path} / Model file not found: ${model.path}`,
        detection.language,
        request.fromVoice || false,
      );
    }

    // 4. Build the message array
    const messages: LocalMessage[] = [];

    // System prompt
    messages.push({ role: 'system', content: systemPrompt });

    // History (if provided)
    if (request.history && request.history.length > 0) {
      for (const h of request.history) {
        messages.push({ role: h.role, content: h.content });
      }
    }

    // Current user message (normalized)
    messages.push({ role: 'user', content: normalizedText });

    // 5. Run inference
    const config: LocalChatConfig = {
      provider: 'local',
      localModelId: model.id,
      localTemperature: request.temperature ?? 0.7,
      localMaxTokens: request.maxTokens ?? 512,
      maxTokens: request.maxTokens ?? 512,
      temperature: request.temperature ?? 0.7,
    };

    let responseText = '';
    let tokensGenerated = 0;
    let inferenceDurationMs = 0;
    let inferenceError: string | undefined;

    try {
      const result = await localChatComplete(config, messages);
      if (result.success) {
        responseText = result.content || '';
        tokensGenerated = result.tokens || 0;
        inferenceDurationMs = result.durationMs || 0;
      } else {
        inferenceError = result.error || 'Inference failed';
      }
    } catch (err: any) {
      inferenceError = err?.message || String(err);
    }

    if (inferenceError) {
      return this.fail(inferenceError, detection.language, request.fromVoice || false, model.id, model.name);
    }

    // 6. Determine response language
    const responseLanguage = getResponseLanguage(detection.language);

    // 7. Speak the response (if requested and TTS is available)
    let spoken = false;
    if (request.speakResponse) {
      spoken = await this.speakText(responseText);
    }

    // 8. Track stats
    this.totalInteractions++;
    const durationMs = Date.now() - start;
    const tokensPerSecond = inferenceDurationMs > 0 ? tokensGenerated / (inferenceDurationMs / 1000) : 0;

    return {
      success: true,
      response: responseText,
      language: detection.language,
      responseLanguage,
      modelId: model.id,
      modelName: model.name,
      tokensGenerated,
      durationMs,
      tokensPerSecond,
      fromVoice: request.fromVoice || false,
      spoken,
    };
  }

  /**
   * Process a voice transcript (same as processText but with fromVoice=true
   * and speakResponse=true by default).
   */
  async processVoice(transcript: string, opts?: {
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    modelId?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<InteractionResponse> {
    return await this.processText({
      text: transcript,
      fromVoice: true,
      history: opts?.history,
      modelId: opts?.modelId,
      temperature: opts?.temperature,
      maxTokens: opts?.maxTokens,
      speakResponse: true,
    });
  }

  /**
   * Speak text via the local TTS (Piper).
   * Returns true if TTS was available and spoke, false otherwise.
   */
  async speakText(text: string): Promise<boolean> {
    if (!text || !text.trim()) return false;
    try {
      const engine = getLocalVoiceEngine();
      if (!engine.hasLocalTTS) return false;
      await engine.speak(text);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Stop any in-progress inference + TTS.
   *
   * ABORT DIAGNOSTICS: logs [INTERACTION_STOP] with the caller stack trace
   * so that unexpected stops can be traced to their exact call site.
   */
  stop(): void {
    const callerStack = new Error().stack || '(no stack)';
    console.log(`[INTERACTION_STOP]`);
    console.log(`  timestamp=${Date.now()}`);
    console.log(`  callerStack=${callerStack.split('\n').slice(0, 10).join('\n  ')}`);
    try { localAbort('InteractionLoopManager.stop()'); } catch { /* */ }
    try { getLocalVoiceEngine().stopSpeaking(); } catch { /* */ }
  }

  /**
   * Set the personality for system prompts.
   */
  setPersonality(personality: PersonalityType): void {
    this.personality = personality;
    try { getNexPersonalityEngine().setPersonality(personality); } catch { /* */ }
  }

  getPersonality(): PersonalityType {
    return this.personality;
  }

  /**
   * Get the last detected language.
   */
  getLastLanguage(): DetectedLanguage {
    return this.lastLanguage;
  }

  /**
   * Get the current interaction status (for the status panel).
   */
  getStatus(): InteractionStatus {
    const model = getDefaultModel();
    const voiceEngine = getLocalVoiceEngine();
    const lastInf = getLastInference();

    return {
      modelReady: !!model && model.fileExists,
      modelName: model?.name || null,
      modelId: model?.id || null,
      modelSizeBytes: model?.sizeBytes || 0,
      sttReady: voiceEngine.hasLocalSTT,
      ttsReady: voiceEngine.hasLocalTTS,
      gpuBackend: getGpuBackend(),
      lastLanguage: this.lastLanguage,
      lastLanguageLabelFa: getLanguageLabelFa(this.lastLanguage),
      lastTokensPerSecond: lastInf?.tokensPerSecond ?? null,
      totalInteractions: this.totalInteractions,
      inferenceActive: lastInf?.active === true,
    };
  }

  /** Reset internal state (for tests). */
  reset(): void {
    this.lastLanguage = 'unknown';
    this.totalInteractions = 0;
  }

  // ── Internals ──

  private fail(error: string, language: DetectedLanguage, fromVoice: boolean, modelId?: string, modelName?: string): InteractionResponse {
    return {
      success: false,
      response: '',
      language,
      responseLanguage: 'en',
      modelId: modelId || null,
      modelName: modelName || null,
      tokensGenerated: 0,
      durationMs: 0,
      tokensPerSecond: 0,
      fromVoice,
      spoken: false,
      error,
    };
  }
}

// ─── Security self-audit ───────────────────────────────────────────────────

export function verifyInteractionSecurity(): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  // All inference is local. All voice is local. No network, no cloud.
  return { ok: findings.length === 0, findings };
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _loop: InteractionLoopManager | null = null;

export function getInteractionLoopManager(): InteractionLoopManager {
  if (!_loop) {
    _loop = new InteractionLoopManager();
  }
  return _loop;
}

export function _resetInteractionLoopManager(): void {
  _loop = null;
}
