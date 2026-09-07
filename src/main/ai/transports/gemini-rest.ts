/**
 * NEX AI — Gemini REST Transport (Phase P1)
 *
 * Wire-protocol adapter for Google Gemini generateContent REST API.
 * Wraps the existing pure helpers in `../gemini.ts` (O1-O3) — reuses the
 * proven buildGeminiRequest + parseGeminiResponse.
 *
 * PURE module: NO fs, NO path, NO persistence, NO getSecret, NO tool-registry.
 */

import {
  buildGeminiRequestForEndpoint,
  parseGeminiResponse,
} from '../gemini';
import type {
  ResolvedChatMessage,
  ChatOptions,
  ResolvedAuth,
  RequestPlan,
  ChatParseResult,
  StreamEvent,
  TextChatTransport,
  StreamChatTransport,
} from '../capabilities';

// ─── Gemini REST Transport ────────────────────────────────────────────────

export class GeminiRestTransport implements TextChatTransport, StreamChatTransport {
  readonly isStreaming = true;

  buildChatRequest(messages: ResolvedChatMessage[], opts: ChatOptions, auth: ResolvedAuth): RequestPlan {
    // Convert ResolvedChatMessage[] → GeminiMessage[] (the existing gemini.ts
    // helper expects { role: 'system'|'user'|'assistant', content: string }).
    // For ContentPart[] content, extract text parts (vision/tool handled separately).
    const geminiMessages = messages.map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role === 'assistant' ? 'assistant' : m.role, content: m.content };
      }
      // ContentPart[] — extract text
      const text = m.content
        .filter((p) => p.type === 'text')
        .map((p) => (p as { type: 'text'; text: string }).text)
        .join('\n');
      return { role: m.role === 'assistant' ? 'assistant' : m.role, content: text };
    });

    const model = opts.model || 'gemini-2.0-flash';
    const plan = buildGeminiRequestForEndpoint(
      opts.endpoint || 'https://generativelanguage.googleapis.com',
      auth.credential,
      geminiMessages as any,
      { model, maxTokens: opts.maxTokens ?? 4096, temperature: opts.temperature ?? 0.7 },
    );

    return {
      url: plan.url,
      headers: { ...plan.headers, 'x-goog-api-key': auth.credential },
      body: plan.body,
    };
  }

  parseChatResponse(raw: string): ChatParseResult {
    const result = parseGeminiResponse(raw);
    if (!result.success) return { success: false, error: result.error };
    return {
      success: true,
      content: result.content,
      tokens: result.tokens,
      finishReason: 'stop',
    };
  }

  parseStreamChunk(line: string): StreamEvent {
    // Gemini Live uses WebSocket; the REST API uses SSE with JSON chunks.
    // For REST streaming, Gemini sends `data: {...}\r\n\r\n` blocks.
    if (!line || !line.startsWith('data: ')) return { done: false };
    const data = line.slice(6).trim();
    if (!data) return { done: false };
    try {
      const parsed = JSON.parse(data);
      // Gemini SSE has no [DONE] marker; we detect completion via finishReason
      const parts = parsed?.candidates?.[0]?.content?.parts;
      if (!parts) return { done: false };
      const text = parts.map((p: any) => p?.text || '').filter((t: string) => t).join('');
      const finishReason = parsed?.candidates?.[0]?.finishReason;
      return { content: text || undefined, done: finishReason === 'STOP' };
    } catch { return { done: false }; }
  }

  sanitizeError(raw: string): string {
    if (!raw || typeof raw !== 'string') return String(raw || '');
    let out = raw;
    out = out.replace(/([?&](?:key|access_token)=)[A-Za-z0-9_\-\.]{10,}/g, '$1***REDACTED***');
    out = out.replace(/\bAIza[A-Za-z0-9_-]{30,}\b/g, '***REDACTED_GOOGLE_KEY***');
    out = out.replace(/\bBearer\s+[A-Za-z0-9_\-\.]{20,}/g, 'Bearer ***REDACTED***');
    if (out.length > 500) out = out.slice(0, 500) + '...';
    return out;
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _transport: GeminiRestTransport | null = null;

export function getGeminiRestTransport(): GeminiRestTransport {
  if (!_transport) _transport = new GeminiRestTransport();
  return _transport;
}
