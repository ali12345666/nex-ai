/**
 * NEX AI — Gemini Provider (Phase O)
 *
 * Google Gemini API integration behind the existing Provider/Runtime abstraction.
 *
 * IMPORTANT ARCHITECTURE RULE (enforced by project convention):
 *   Agent Core NEVER imports this module directly. The only consumers are:
 *     - `ai-service.ts`   (electron net binding for online calls)
 *     - `provider.ts`     (routeChat: 'gemini' branch)
 *   This keeps the layering intact:
 *
 *     User → Agent → AIRuntime / routeChat → { Local GGUF | GLM 5.3 | Gemini | OpenAI | Claude }
 *
 * This module is PURE (no electron imports) so it is unit-testable in plain
 * Node with zero mocks.
 *
 * Wire format: Gemini's REST API (generativelanguage.googleapis.com) uses
 * a different request/response shape than OpenAI-compatible APIs:
 *   - Request: {contents: [{role, parts: [{text}]}], systemInstruction, generationConfig}
 *   - Auth: x-goog-api-key header (NOT Bearer)
 *   - Model is embedded in the URL path (NOT in the request body)
 *   - Response: {candidates: [{content: {parts: [{text}], role}, finishReason}], usageMetadata}
 *
 * Reference: https://ai.google.dev/api/generate-content
 */

/**
 * Structural twin of ai-service's AIMessage (kept local so this module stays
 * import-free and unit-testable in plain Node).
 */
export interface GeminiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Google Gemini API endpoint (default). */
export const GEMINI_DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com';

/** The primary default model for Phase O. */
export const GEMINI_DEFAULT_MODEL = 'gemini-2.0-flash';

/** Available Gemini models users can select. */
export const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
] as const;
export type GeminiModelName = (typeof GEMINI_MODELS)[number];

/** API path prefix for the v1beta REST API. */
export const GEMINI_API_PREFIX = '/v1beta/models';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GeminiChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Extra body fields (e.g. topP). Never overrides security fields. */
  extra?: Record<string, unknown>;
}

export interface GeminiRequestPlan {
  url: string;
  headers: Record<string, string>;
  body: string;
}

// ─── Helpers (pure) ─────────────────────────────────────────────────────────

/**
 * Build the full generateContent URL for a given endpoint + model.
 * Format: {endpoint}/v1beta/models/{model}:generateContent
 */
export function geminiEndpointUrl(endpoint?: string, model?: string): string {
  const base = (endpoint && endpoint.trim()) || GEMINI_DEFAULT_ENDPOINT;
  let url = base.replace(/\/+$/, ''); // strip trailing slashes
  const modelName = model || GEMINI_DEFAULT_MODEL;
  // Ensure the path has the v1beta prefix
  if (!url.includes(GEMINI_API_PREFIX)) {
    url += `${GEMINI_API_PREFIX}/${modelName}:generateContent`;
  } else if (!url.endsWith(':generateContent')) {
    // If user pasted the prefix but not the method
    url += `/${modelName}:generateContent`;
  }
  return url;
}

/**
 * Convert NEX AI's standard message format (system/user/assistant) to
 * Gemini's content format (user/model parts).
 *
 * Gemini uses "user" and "model" roles (not "assistant"). System messages
 * are extracted and placed in `systemInstruction` (a top-level field, not
 * inside contents[]).
 */
function convertMessagesToContents(messages: GeminiMessage[]): {
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  systemInstruction?: { parts: Array<{ text: string }> };
} {
  // Extract system messages → systemInstruction
  const systemMsgs = messages.filter((m) => m.role === 'system');
  const conversationMsgs = messages.filter((m) => m.role !== 'system');

  const systemInstruction = systemMsgs.length > 0
    ? { parts: [{ text: systemMsgs.map((m) => m.content).join('\n\n') }] }
    : undefined;

  // Convert user/assistant → user/model
  const contents = conversationMsgs.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  return { contents, systemInstruction };
}

/**
 * Build the request plan (url, headers, JSON body) for a Gemini chat call.
 * The API key is placed ONLY in the x-goog-api-key header — never in the body,
 * never in a query string.
 */
export function buildGeminiRequest(
  apiKey: string,
  messages: GeminiMessage[],
  opts: GeminiChatOptions = {},
): GeminiRequestPlan {
  const model = opts.model || GEMINI_DEFAULT_MODEL;
  const { contents, systemInstruction } = convertMessagesToContents(messages);

  const bodyObj: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.7,
    },
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(opts.extra || {}),
  };

  return {
    url: geminiEndpointUrl(undefined, model),
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(bodyObj),
  };
}

/**
 * Same as buildGeminiRequest but for a custom endpoint (used when the user
 * has configured a custom Gemini endpoint or proxy in settings).
 */
export function buildGeminiRequestForEndpoint(
  endpoint: string | undefined,
  apiKey: string,
  messages: GeminiMessage[],
  opts: GeminiChatOptions = {},
): GeminiRequestPlan {
  const plan = buildGeminiRequest(apiKey, messages, opts);
  return { ...plan, url: geminiEndpointUrl(endpoint, opts.model) };
}

// ─── Response parsing (pure) ────────────────────────────────────────────────

export interface GeminiParseResult {
  success: boolean;
  content?: string;
  error?: string;
  tokens?: number;
}

/**
 * Parse a Gemini generateContent HTTP response body.
 * Expected shape:
 *   {
 *     candidates: [{
 *       content: { parts: [{ text: "..." }], role: "model" },
 *       finishReason: "STOP"
 *     }],
 *     usageMetadata: { promptTokenCount, candidatesTokenCount, totalTokenCount }
 *   }
 *
 * Error shape:
 *   { error: { code, message, status } }
 */
export function parseGeminiResponse(raw: string): GeminiParseResult {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { success: false, error: 'Gemini: response is not valid JSON' };
  }

  // Error envelope: { error: { code, message, status } }
  if (data && typeof data === 'object' && data.error) {
    const msg =
      (data.error && typeof data.error === 'object' && data.error.message) ||
      (typeof data.error === 'string' && data.error) ||
      'Gemini API error';
    return { success: false, error: String(msg) };
  }

  // Extract content from candidates[0].content.parts[].text
  const candidates = data?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { success: false, error: 'Gemini: no candidates in response' };
  }

  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return { success: false, error: 'Gemini: no content parts in response' };
  }

  // Concatenate all text parts (Gemini can return multiple parts)
  const text = parts
    .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
    .filter((t: string) => t.length > 0)
    .join('');

  if (!text) {
    return { success: false, error: 'Gemini: empty text in response parts' };
  }

  // Extract token usage if available
  const tokens =
    typeof data?.usageMetadata?.totalTokenCount === 'number'
      ? data.usageMetadata.totalTokenCount
      : undefined;

  return { success: true, content: text, tokens };
}

/**
 * Check whether a given model name is a known Gemini model.
 */
export function isGeminiModel(model: string): boolean {
  return (GEMINI_MODELS as readonly string[]).includes(model);
}
