/**
 * NEX AI — Provider Abstraction (Phase 5, extended in Phase 8 / P8-A)
 *
 * Defines the unified AIProvider interface that all providers implement.
 *
 *  LocalProvider    — runs llama.cpp locally, no network required (DEFAULT)
 *  OpenAIProvider   — calls OpenAI API (optional, online only)
 *  AnthropicProvider — calls Anthropic API (optional, online only)
 *  GlmProvider      — calls GLM 5.3 via Z.ai/BigModel API (optional, online only,
 *                     primary online model for Phase 8+ — still routed through
 *                     this same abstraction; Agent never imports it directly)
 *
 * The ChatPanel/renderer never directly imports any provider — it builds a
 * LocalChatConfig and passes it through IPC. The main process routes to the
 * correct provider based on `config.provider`.
 *
 * Requirement: LocalProvider MUST work without any of the online providers
 * being installed or configured.
 */

import type { AIMessage } from '../ai-service';
import type { LocalChatConfig } from './local-engine';

export type ProviderType = 'local' | 'openai' | 'claude' | 'glm';

export interface ProviderConfig {
  provider: ProviderType;
  // Common
  maxTokens: number;
  temperature: number;
  // Online
  apiKey?: string;
  model?: string;
  endpoint?: string;
  // GLM (Phase 8) — model/endpoint shared with fields above; kept for clarity
  // GLM's default endpoint is filled by ai/glm.ts when omitted.
  // Local (ignored by online providers)
  localModelId?: string;
  localModelPath?: string;
  localContextSize?: number;
  localThreads?: number;
  localGpuLayers?: number;
  localTemperature?: number;
  localMaxTokens?: number;
}

export interface ProviderResult {
  success: boolean;
  content?: string;
  error?: string;
  tokens?: number;
  durationMs?: number;
  modelId?: string;
  modelName?: string;
  provider: ProviderType;
}

export interface AIProvider {
  readonly type: ProviderType;
  chat(messages: AIMessage[]): Promise<ProviderResult>;
}

// ─── Routing ────────────────────────────────────────────────────────────────

import { localChatComplete } from './local-engine';
import { chatCompletion } from '../ai-service';
import { isAllowedAIOrigin } from '../security';
import { enforceAiMode, getCurrentAiMode, type AIMode } from './ai-mode';

/**
 * Route a chat request to the appropriate provider based on config.provider.
 * This is the single entry point used by the `ai-chat` IPC handler.
 *
 * UI-02: Server-side aiMode enforcement. The persisted `aiMode` setting is
 * read from disk and enforced BEFORE origin/apiKey validation. If
 * `aiMode='local'` and `config.provider` is online, the request is blocked
 * regardless of what the renderer claimed. Callers may also pass an
 * explicit `aiModeOverride` (used by tests).
 */
export async function routeChat(
  config: ProviderConfig,
  messages: AIMessage[],
  aiModeOverride?: AIMode,
): Promise<ProviderResult> {
  // UI-02: Enforce persisted aiMode (defense-in-depth against compromised renderer).
  const mode = aiModeOverride ?? getCurrentAiMode();
  const blocked = enforceAiMode(mode, config.provider);
  if (blocked) {
    return blocked;
  }

  if (config.provider === 'local') {
    const result = await localChatComplete(config as LocalChatConfig, messages);
    return { ...result, provider: 'local' };
  }

  // Online providers — origin validation is mandatory
  if (!config.endpoint || !isAllowedAIOrigin(config.endpoint)) {
    return {
      success: false,
      error: `Blocked: AI endpoint "${config.endpoint || '(missing)'}" is not in the allowed origins list. Only OpenAI, Anthropic and GLM (Z.ai/BigModel) are permitted.`,
      provider: config.provider,
    };
  }

  if (!config.apiKey) {
    return {
      success: false,
      error: 'Online provider requires an API key. Configure it in Settings > Online AI, or switch to Local mode.',
      provider: config.provider,
    };
  }

  const result = await chatCompletion(config as any, messages);
  return { ...result, provider: config.provider };
}
