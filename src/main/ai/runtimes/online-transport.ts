/**
 * Online Transport — wires OnlineRuntime to the provider abstraction.
 *
 * This is the ONLY module in the Phase 8 chain that knows about provider
 * routing — and even here it just calls `routeChat()` (the same entry point
 * ChatPanel uses). It never imports GLM wire details directly.
 *
 * Config (provider/model/endpoint) + secret (API key) are read lazily at
 * call time via injected getters, so:
 *   - secrets never sit in runtime objects or logs
 *   - settings changes take effect on the next call without re-registration
 *   - unit tests can stub both getters
 */

import type { ChatMessage, ChatOptions, ChatResult } from '../runtime';
import type { OnlineChatTransport } from './online-runtime';
import type { OnlineRuntime } from './online-runtime';

export interface OnlineConfigProvider {
  /** e.g. 'glm' | 'openai' | 'claude' | 'gemini' */
  provider(): 'glm' | 'openai' | 'claude' | 'gemini';
  /** model id, e.g. 'glm-5.3' */
  model(): string;
  /** base endpoint, validated against ALLOWED_AI_ORIGINS by routeChat */
  endpoint(): string;
  /** secret — fetched fresh on every call, never cached here */
  apiKey(): string | undefined;
}

/**
 * Build a transport from config getters. Result shapes satisfy AIRuntime's
 * ChatResult contract (ids, timing, token accounting).
 */
export function createRouteChatTransport(cfg: OnlineConfigProvider): OnlineChatTransport {
  return async (messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> => {
    const started = Date.now();
    // Dynamic import keeps this module electron-free at load time and avoids
    // circulars: provider.ts → ai-service.ts (electron) is only pulled in by
    // the main process at actual call time.
    const { routeChat } = await import('../provider');
    // P1: coerce widened ChatMessage[] (role includes 'tool', content may be ContentPart[])
    // to the narrow AIMessage[] expected by routeChat (role: system|user|assistant, content: string).
    // The online transport handles text only in P1 — vision/tool-calling via ContentPart[]
    // is P3 scope. Extract text from ContentPart[] if present.
    const narrowMessages = messages.map((m) => ({
      role: (m.role === 'tool' ? 'user' : m.role) as 'system' | 'user' | 'assistant',
      content: typeof m.content === 'string'
        ? m.content
        : m.content.filter((p) => p.type === 'text').map((p: any) => p.text).join('\n'),
    }));
    const result = await routeChat(
      {
        provider: cfg.provider(),
        model: cfg.model(),
        endpoint: cfg.endpoint(),
        apiKey: cfg.apiKey(),
        maxTokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.7,
      },
      narrowMessages,
    );

    if (!result.success) {
      throw new Error(result.error || 'Online provider request failed');
    }

    return {
      content: result.content || '',
      tokensGenerated: result.tokens ?? 0,
      modelId: result.modelId || cfg.model(),
      modelName: result.modelName || cfg.model(),
      stopped: true,
      durationMs: Date.now() - started,
    };
  };
}

// ─── Default runtime factory (used by the Runtime Registry) ─────────────────

/**
 * Lazy transport: resolves settings/secrets on EVERY call via dynamic import,
 * then delegates to a per-call configured transport. This keeps construction
 * synchronous (Runtime Registry factories must be sync) while still reading
 * fresh config at call time — and zero electron imports at module load.
 *
 * P1: now looks up the provider descriptor from the ProviderRegistry for
 * defaults (model, endpoint, authMethod.secretId) instead of hard-coded
 * if/else chains. Falls back to the old pattern if the registry is not yet
 * wired (backward-compat during P1 rollout).
 */
export function createLazyOnlineTransport(): OnlineChatTransport {
  return async (messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> => {
    const { loadState, getSecret } = await import('../../persistence');
    const s = ((loadState() as any).settings || {}) as any;
    const provider = s?.onlineProvider === 'openai' || s?.onlineProvider === 'claude' || s?.onlineProvider === 'gemini' ? s.onlineProvider : 'glm';

    // P1: try the registry first; fall back to the legacy config if not available.
    let cfg: OnlineConfigProvider;
    try {
      const { getProviderRegistry } = await import('../provider-registry');
      const registry = getProviderRegistry();
      const desc = registry.getProvider(provider);
      if (desc) {
        cfg = {
          provider: () => provider,
          model: () => {
            if (provider === 'openai') return s?.aiModel || desc.defaultModel;
            if (provider === 'gemini') return s?.geminiModel || desc.defaultModel;
            if (provider === 'glm') return s?.glmModel || desc.defaultModel;
            return desc.defaultModel;
          },
          endpoint: () => {
            if (provider === 'gemini') return s?.geminiEndpoint || desc.defaultEndpoint;
            if (provider === 'glm') return s?.glmEndpoint || desc.defaultEndpoint;
            return desc.defaultEndpoint;
          },
          apiKey: () => {
            const secretId = desc.authMethod.type === 'none' ? null
              : (desc.authMethod as any).secretId;
            return secretId ? (getSecret(secretId) || undefined) : undefined;
          },
        };
      } else {
        throw new Error(`Provider '${provider}' not in registry`);
      }
    } catch {
      // Legacy fallback (registry not yet wired during startup)
      cfg = {
        provider: () => provider,
        model: () => {
          if (provider === 'openai') return s?.aiModel || 'gpt-4o';
          if (provider === 'claude') return 'claude-sonnet-4-20250514';
          if (provider === 'gemini') return s?.geminiModel || 'gemini-2.0-flash';
          return s?.glmModel || 'glm-5.3';
        },
        endpoint: () => {
          if (provider === 'openai') return 'https://api.openai.com/v1';
          if (provider === 'claude') return 'https://api.anthropic.com/v1';
          if (provider === 'gemini') return s?.geminiEndpoint || 'https://generativelanguage.googleapis.com';
          return s?.glmEndpoint || 'https://api.z.ai';
        },
        apiKey: () =>
          (provider === 'glm' ? getSecret('glmApiKey') : provider === 'gemini' ? getSecret('geminiApiKey') : getSecret('aiApiKey')) || undefined,
      };
    }

    const transport = createRouteChatTransport(cfg);
    return transport(messages, opts);
  };
}

/**
 * Create an OnlineRuntime wired to the user's configured online provider
 * (GLM 5.3 by default). Synchronous + lazy: the actual provider/model/secret
 * are read inside the transport at call time, so settings changes apply
 * immediately without re-registering anything.
 */
export function createDefaultOnlineRuntime(): OnlineRuntime {
  // Synchronous import is safe: online-runtime.ts is pure (no electron).
  const { OnlineRuntime: OR } = require('./online-runtime') as typeof import('./online-runtime');
  return new OR({
    modelId: 'glm-5.3',
    modelName: 'GLM 5.3',
    transport: createLazyOnlineTransport(),
  });
}
