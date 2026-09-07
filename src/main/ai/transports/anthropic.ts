/**
 * NEX AI — Anthropic Transport (Phase P1)
 *
 * Wire-protocol adapter for Anthropic Claude chat API.
 * PURE module: NO fs, NO path, NO persistence, NO getSecret, NO tool-registry.
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

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Anthropic separates system instruction from the messages array.
 * system messages → top-level `system` field; user/assistant → messages[].
 */
function toAnthropicMessages(messages: ResolvedChatMessage[]): { system?: string; messages: unknown[] } {
  let system: string | undefined;
  const msgs: unknown[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system = (system ? system + '\n\n' : '') + (typeof m.content === 'string' ? m.content : '');
      continue;
    }
    if (typeof m.content === 'string') {
      msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
    } else {
      const parts = m.content.map((p) => {
        switch (p.type) {
          case 'text': return { type: 'text', text: p.text };
          case 'image':
            if (p.base64) return { type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.base64 } };
            return { type: 'text', text: '[image]' };
          default: return { type: 'text', text: '' };
        }
      });
      msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: parts });
    }
  }
  return { system, messages: msgs };
}

function toAnthropicTools(tools: ToolDeclaration[]): unknown[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

// ─── Anthropic Transport ──────────────────────────────────────────────────

export class AnthropicTransport implements TextChatTransport, StreamChatTransport, ToolCallingTransport {
  readonly isStreaming = true;

  buildChatRequest(messages: ResolvedChatMessage[], opts: ChatOptions, auth: ResolvedAuth): RequestPlan {
    const endpoint = opts.endpoint || 'https://api.anthropic.com';
    const url = `${endpoint.replace(/\/+$/, '')}/v1/messages`;
    const model = opts.model || 'claude-sonnet-4-20250514';
    const { system, messages: anthropicMsgs } = toAnthropicMessages(messages);
    const body: Record<string, unknown> = {
      model,
      messages: anthropicMsgs,
      max_tokens: opts.maxTokens ?? 4096,
    };
    if (system) body.system = system;
    return {
      url,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': auth.credential,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    };
  }

  buildChatRequestWithTools(messages: ResolvedChatMessage[], tools: ToolDeclaration[], opts: ChatOptions, auth: ResolvedAuth): RequestPlan {
    const plan = this.buildChatRequest(messages, opts, auth);
    const body = JSON.parse(plan.body);
    body.tools = toAnthropicTools(tools);
    return { ...plan, body: JSON.stringify(body) };
  }

  parseChatResponse(raw: string): ChatParseResult {
    let data: any;
    try { data = JSON.parse(raw); } catch { return { success: false, error: 'Anthropic: response is not valid JSON' }; }
    if (data?.error) {
      const msg = data.error.message || data.error || 'Anthropic API error';
      return { success: false, error: String(msg) };
    }
    if (!data?.content || !Array.isArray(data.content)) {
      return { success: false, error: 'Anthropic: no content in response' };
    }
    const content = data.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('');
    const toolCallsArr: ToolCall[] = data.content
      .filter((c: any) => c.type === 'tool_use')
      .map((c: any) => ({ id: c.id, name: c.name, args: c.input || {} }));
    return {
      success: true,
      content,
      toolCalls: toolCallsArr.length > 0 ? toolCallsArr : undefined,
      tokens: data?.usage?.input_tokens && data?.usage?.output_tokens
        ? data.usage.input_tokens + data.usage.output_tokens
        : undefined,
      finishReason: data.stop_reason as any,
    };
  }

  parseChatResponseWithTools(raw: string): ChatParseResult {
    return this.parseChatResponse(raw);
  }

  parseStreamChunk(line: string): StreamEvent {
    if (!line || !line.startsWith('data: ')) return { done: false };
    const data = line.slice(6).trim();
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'message_stop') return { done: true };
      if (parsed.type === 'content_block_delta') {
        if (parsed.delta?.type === 'text_delta') {
          return { content: parsed.delta.text || undefined, done: false };
        }
        if (parsed.delta?.type === 'input_json_delta') {
          // tool-call argument delta — we don't accumulate partial args here
          return { done: false };
        }
      }
      return { done: false };
    } catch { return { done: false }; }
  }

  sanitizeError(raw: string): string {
    if (!raw || typeof raw !== 'string') return String(raw || '');
    let out = raw;
    out = out.replace(/([?&](?:key|access_token)=)[A-Za-z0-9_\-\.]{10,}/g, '$1***REDACTED***');
    out = out.replace(/\bAIza[A-Za-z0-9_-]{30,}\b/g, '***REDACTED_GOOGLE_KEY***');
    out = out.replace(/\bBearer\s+[A-Za-z0-9_\-\.]{20,}/g, 'Bearer ***REDACTED***');
    out = out.replace(/\bsk-ant-[A-Za-z0-9-_]{20,}\b/g, '***REDACTED_ANTHROPIC_KEY***');
    if (out.length > 500) out = out.slice(0, 500) + '...';
    return out;
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _transport: AnthropicTransport | null = null;

export function getAnthropicTransport(): AnthropicTransport {
  if (!_transport) _transport = new AnthropicTransport();
  return _transport;
}
