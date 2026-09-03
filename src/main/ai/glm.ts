/**
 * NEX AI — GLM Provider (Phase 8 / P8-A)
 *
 * GLM 5.3 integration behind the existing Provider/Runtime abstraction.
 *
 * IMPORTANT ARCHITECTURE RULE (enforced by project convention):
 *   Agent Core NEVER imports this module directly. The only consumers are:
 *     - `ai-service.ts`   (electron net binding for online calls)
 *     - `provider.ts`     (routeChat: 'glm' branch)
 *   This keeps the layering intact:
 *
 *     User → Agent → AIRuntime / routeChat → { GLM 5.3 | Local GGUF | OpenAI | Claude }
 *
 * This module is PURE (no electron imports) so it is unit-testable in plain
 * Node with zero mocks.
 *
 * Wire format: GLM's API (api.z.ai / open.bigmodel.cn) is OpenAI-compatible
 * for chat completions — same request/response shape, different auth header
 * style is supported (Bearer token).
 */

/**
 * Structural twin of ai-service's AIMessage (kept local so this module stays
 * import-free and unit-testable in plain Node).
 */
export interface GlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** International GLM API endpoint (default). */
export const GLM_DEFAULT_ENDPOINT = 'https://api.z.ai';

/** China mainland GLM API endpoint (user-selectable). */
export const GLM_CN_ENDPOINT = 'https://open.bigmodel.cn';

/** The primary development / agent model for Phase 8+. */
export const GLM_DEFAULT_MODEL = 'glm-5.3';

/** Alias models users may switch to (kept in sync with GLM family). */
export const GLM_MODELS = ['glm-5.3', 'glm-5.3-air', 'glm-5.3-flash'] as const;
export type GlmModelName = (typeof GLM_MODELS)[number];

/** Full chat-completions path for the GLM v4-style API. */
export const GLM_CHAT_PATH = '/api/paas/v4/chat/completions';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GlmChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Extra body fields (e.g. top_p). Never overrides security fields. */
  extra?: Record<string, unknown>;
}

export interface GlmRequestPlan {
  url: string;
  headers: Record<string, string>;
  body: string;
}

// ─── Helpers (pure) ─────────────────────────────────────────────────────────

/**
 * Normalize a user-provided endpoint into a full chat-completions URL.
 * Handles:
 *   'https://api.z.ai'                                → .../api/paas/v4/chat/completions
 *   'https://api.z.ai/'                               → same
 *   'https://api.z.ai/api/paas/v4'                    → same
 *   'https://api.z.ai/api/paas/v4/chat/completions'   → unchanged
 */
export function glmEndpointUrl(endpoint?: string): string {
  const base = (endpoint && endpoint.trim()) || GLM_DEFAULT_ENDPOINT;
  let url = base.replace(/\/+$/, ''); // strip trailing slashes
  if (!url.endsWith(GLM_CHAT_PATH)) {
    // If user pasted the bare v4 prefix, don't double it
    if (url.endsWith('/api/paas/v4')) {
      url += '/chat/completions';
    } else {
      url += GLM_CHAT_PATH;
    }
  }
  return url;
}

/**
 * Build the request plan (url, headers, JSON body) for a GLM chat call.
 * The api key is placed ONLY in the Authorization header — never in the body,
 * never in a query string.
 */
export function buildGlmRequest(
  apiKey: string,
  messages: GlmMessage[],
  opts: GlmChatOptions = {}
): GlmRequestPlan {
  const model = opts.model || GLM_DEFAULT_MODEL;
  const bodyObj: Record<string, unknown> = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.7,
    ...(opts.extra || {}),
  };

  return {
    url: glmEndpointUrl(undefined),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(bodyObj),
  };
}

/**
 * Same as buildGlmRequest but for a custom endpoint (used when the user has
 * selected the CN endpoint or a proxy in the allowlist).
 */
export function buildGlmRequestForEndpoint(
  endpoint: string | undefined,
  apiKey: string,
  messages: GlmMessage[],
  opts: GlmChatOptions = {}
): GlmRequestPlan {
  const plan = buildGlmRequest(apiKey, messages, opts);
  return { ...plan, url: glmEndpointUrl(endpoint) };
}

// ─── Response parsing (pure) ────────────────────────────────────────────────

export interface GlmParseResult {
  success: boolean;
  content?: string;
  error?: string;
  tokens?: number;
}

/**
 * Parse a GLM chat-completions HTTP response body (OpenAI-compatible shape).
 * Strict: unknown shapes resolve to { success: false } rather than throwing.
 */
export function parseGlmResponse(raw: string): GlmParseResult {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { success: false, error: 'GLM: response is not valid JSON' };
  }

  // Error envelope: { error: { message } }
  if (data && typeof data === 'object' && data.error) {
    const msg =
      (data.error && typeof data.error === 'object' && data.error.message) ||
      (typeof data.error === 'string' && data.error) ||
      'GLM API error';
    return { success: false, error: String(msg) };
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    return { success: false, error: 'GLM: unexpected response shape (missing choices[0].message.content)' };
  }

  const tokens =
    typeof data?.usage?.total_tokens === 'number'
      ? data.usage.total_tokens
      : undefined;

  return { success: true, content, tokens };
}

/**
 * Check whether a given model name is a known GLM model.
 * (Used by settings UI validation — pure, trivial.)
 */
export function isGlmModel(model: string): boolean {
  return (GLM_MODELS as readonly string[]).includes(model);
}
