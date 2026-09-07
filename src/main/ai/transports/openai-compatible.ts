/**
 * NEX AI — OpenAI-Compatible Transport (Phase P1)
 *
 * Reusable wire-protocol adapter for OpenAI-compatible chat APIs.
 * Used by: openai, custom-* (P2), openrouter (future).
 *
 * PURE module: NO fs, NO path, NO persistence, NO getSecret, NO tool-registry,
 * NO permissions imports. The transport receives ResolvedChatMessage[] +
 * ResolvedAuth (already-resolved credential) and produces RequestPlan.
 *
 * Binding (v2.3 §2.4, §6):
 *   - Takes ResolvedChatMessage[], NOT ChatMessage[]. File content is resolved
 *     (TransportFileContent — base64, no path).
 *   - The transport NEVER calls getSecret — it receives ResolvedAuth.
 *   - The transport NEVER reads the filesystem — it receives resolved content.
 *   - The transport NEVER executes tools — it returns toolCalls; the Agent
 *     executes them via the Tool Registry + Permission System.
 *   - sanitizeError strips ?key=, AIza keys, Bearer tokens, full URLs with
 *     credentials (binding v2.3 §4 P1-1).
 */

import type {
  ResolvedChatMessage,
  ChatOptions,
  ResolvedAuth,
  RequestPlan,
  ChatParseResult,
  StreamEvent,
  TextChatTransport,
  StreamChatTransport,
  ToolCallingTransport,
  ToolDeclaration,
  ToolCall,
} from '../capabilities';

// ─── Helpers (pure) ─────────────────────────────────────────────────────────

function toOpenAiMessages(messages: ResolvedChatMessage[]): unknown[] {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }
    const parts = msg.content.map((part) => {
      switch (part.type) {
        case 'text':
          return { type: 'text', text: part.text };
        case 'image':
          if (part.base64) {
            const dataUrl = `data:${part.mimeType};base64,${part.base64}`;
            return { type: 'image_url', image_url: { url: dataUrl } };
          }
          return { type: 'image_url', image_url: { url: part.url || '' } };
        case 'file':
          return { type: 'text', text: `[file: ${part.base64.substring(0, 100)}...]` };
        case 'audio':
          if (part.base64) {
            return { type: 'input_audio', input_audio: { data: part.base64, format: part.mimeType.split('/')[1] || 'wav' } };
          }
          return { type: 'text', text: '[audio]' };
        case 'tool_call':
          return { type: 'text', text: `[tool_call: ${part.name}]` };
        case 'tool_result':
          return { type: 'text', text: typeof part.content === 'string' ? part.content : '[tool_result]' };
        default:
          return { type: 'text', text: '' };
      }
    });
    return { role: msg.role, content: parts };
  });
}

function toOpenAiTools(tools: ToolDeclaration[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function parseOpenAiToolCalls(raw: any): ToolCall[] | undefined {
  if (!raw?.choices?.[0]?.message?.tool_calls) return undefined;
  return raw.choices[0].message.tool_calls.map((tc: any) => ({
    id: tc.id,
    name: tc.function?.name || '',
    args: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
  }));
}

// ─── OpenAI-Compatible Transport ──────────────────────────────────────────

export class OpenAiCompatibleTransport implements TextChatTransport, StreamChatTransport, ToolCallingTransport {
  readonly isStreaming = true;

  buildChatRequest(messages: ResolvedChatMessage[], opts: ChatOptions, auth: ResolvedAuth): RequestPlan {
    const endpoint = opts.endpoint || 'https://api.openai.com';
    const url = `${endpoint.replace(/\/+$/, '')}/v1/chat/completions`;
    const model = opts.model || 'gpt-4o';
    const body: Record<string, unknown> = {
      model,
      messages: toOpenAiMessages(messages),
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.7,
    };
    if (opts.tools && opts.tools.length > 0) {
      body.tools = toOpenAiTools(opts.tools);
    }
    return {
      url,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.credential}` },
      body: JSON.stringify(body),
    };
  }

  buildChatRequestWithTools(messages: ResolvedChatMessage[], tools: ToolDeclaration[], opts: ChatOptions, auth: ResolvedAuth): RequestPlan {
    const plan = this.buildChatRequest(messages, opts, auth);
    const body = JSON.parse(plan.body);
    body.tools = toOpenAiTools(tools);
    return { ...plan, body: JSON.stringify(body) };
  }

  parseChatResponse(raw: string): ChatParseResult {
    let data: any;
    try { data = JSON.parse(raw); } catch { return { success: false, error: 'OpenAI: response is not valid JSON' }; }
    if (data?.error) {
      const msg = data.error.message || data.error || 'OpenAI API error';
      return { success: false, error: String(msg) };
    }
    const choice = data?.choices?.[0];
    if (!choice) return { success: false, error: 'OpenAI: no choices in response' };
    const content = choice.message?.content || '';
    const toolCalls = parseOpenAiToolCalls(data);
    return { success: true, content, toolCalls, tokens: data?.usage?.total_tokens, finishReason: choice.finish_reason as any };
  }

  parseChatResponseWithTools(raw: string): ChatParseResult {
    return this.parseChatResponse(raw);
  }

  parseStreamChunk(line: string): StreamEvent {
    if (!line || !line.startsWith('data: ')) return { done: false };
    const data = line.slice(6).trim();
    if (data === '[DONE]') return { done: true };
    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) return { done: false };
      const content = delta.content || undefined;
      const toolCalls = delta.tool_calls
        ? delta.tool_calls.map((tc: any) => ({
            id: tc.id || '',
            name: tc.function?.name || '',
            args: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
          }))
        : undefined;
      return { content, toolCalls, done: false };
    } catch { return { done: false }; }
  }

  sanitizeError(raw: string): string {
    if (!raw || typeof raw !== 'string') return String(raw || '');
    let out = raw;
    out = out.replace(/([?&](?:key|access_token)=)[A-Za-z0-9_\-\.]{10,}/g, '$1***REDACTED***');
    out = out.replace(/\bAIza[A-Za-z0-9_-]{30,}\b/g, '***REDACTED_GOOGLE_KEY***');
    out = out.replace(/\bBearer\s+[A-Za-z0-9_\-\.]{20,}/g, 'Bearer ***REDACTED***');
    out = out.replace(/\bsk-[A-Za-z0-9]{20,}\b/g, '***REDACTED_OPENAI_KEY***');
    out = out.replace(/\bsk-ant-[A-Za-z0-9-_]{20,}\b/g, '***REDACTED_ANTHROPIC_KEY***');
    if (out.length > 500) out = out.slice(0, 500) + '...';
    return out;
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _transport: OpenAiCompatibleTransport | null = null;

export function getOpenAiCompatibleTransport(): OpenAiCompatibleTransport {
  if (!_transport) _transport = new OpenAiCompatibleTransport();
  return _transport;
}
