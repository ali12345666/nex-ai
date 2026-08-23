import { net } from 'electron';
import { GLM_DEFAULT_MODEL } from './ai/glm';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIConfig {
  provider: 'openai' | 'claude' | 'glm' | 'custom';
  apiKey: string;
  model: string;
  endpoint: string;
  maxTokens: number;
  temperature: number;
}

export interface AIStreamChunk {
  content: string;
  done: boolean;
  error?: string;
}

const DEFAULT_CONFIGS: Record<string, Partial<AIConfig>> = {
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o',
    maxTokens: 4096,
    temperature: 0.7,
  },
  claude: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4096,
    temperature: 0.7,
  },
  // Phase 8 / P8-A: GLM 5.3 — primary development/agent model.
  // Wire logic lives in ./ai/glm.ts (pure); this is the electron-net binding.
  glm: {
    endpoint: 'https://api.z.ai/api/paas/v4/chat/completions',
    model: GLM_DEFAULT_MODEL,
    maxTokens: 4096,
    temperature: 0.7,
  },
  custom: {
    model: 'gpt-4o',
    maxTokens: 4096,
    temperature: 0.7,
  },
};

export function getDefaultConfig(provider: string): Partial<AIConfig> {
  return DEFAULT_CONFIGS[provider] || DEFAULT_CONFIGS.openai;
}

export function chatCompletion(
  config: AIConfig,
  messages: AIMessage[]
): Promise<{ success: boolean; content?: string; error?: string; tokens?: number }> {
  return new Promise((resolve) => {
    if (!config.apiKey) {
      resolve({ success: false, error: 'API key not configured. Go to Settings to add your API key.' });
      return;
    }

    if (config.provider === 'claude') {
      callClaude(config, messages, resolve);
    } else if (config.provider === 'glm') {
      callGLM(config, messages, resolve);
    } else {
      callOpenAI(config, messages, resolve);
    }
  });
}

function callOpenAI(
  config: AIConfig,
  messages: AIMessage[],
  resolve: (result: { success: boolean; content?: string; error?: string; tokens?: number }) => void
): void {
  const url = new URL(config.endpoint);
  const body = JSON.stringify({
    model: config.model,
    messages,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
  });

  const request = net.request({
    method: 'POST',
    url: config.endpoint,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
  });

  let responseData = '';

  request.on('response', (response) => {
    response.on('data', (chunk) => {
      responseData += chunk.toString();
    });

    response.on('end', () => {
      try {
        const data = JSON.parse(responseData);
        if (data.error) {
          resolve({ success: false, error: data.error.message || 'API Error' });
          return;
        }
        const content = data.choices?.[0]?.message?.content;
        const tokens = data.usage?.total_tokens;
        resolve({ success: true, content, tokens });
      } catch (err: any) {
        resolve({ success: false, error: `Failed to parse response: ${err.message}` });
      }
    });
  });

  request.on('error', (err) => {
    resolve({ success: false, error: `Network error: ${err.message}` });
  });

  request.write(body);
  request.end();
}

function callClaude(
  config: AIConfig,
  messages: AIMessage[],
  resolve: (result: { success: boolean; content?: string; error?: string; tokens?: number }) => void
): void {
  // Convert messages format for Claude
  const systemMsg = messages.find((m) => m.role === 'system');
  const conversationMsgs = messages.filter((m) => m.role !== 'system');

  const body = JSON.stringify({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    system: systemMsg?.content || '',
    messages: conversationMsgs.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  const request = net.request({
    method: 'POST',
    url: config.endpoint,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
  });

  let responseData = '';

  request.on('response', (response) => {
    response.on('data', (chunk) => {
      responseData += chunk.toString();
    });

    response.on('end', () => {
      try {
        const data = JSON.parse(responseData);
        if (data.error) {
          resolve({ success: false, error: data.error.message || 'API Error' });
          return;
        }
        const content = data.content?.[0]?.text;
        const tokens = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
        resolve({ success: true, content, tokens });
      } catch (err: any) {
        resolve({ success: false, error: `Failed to parse response: ${err.message}` });
      }
    });
  });

  request.on('error', (err) => {
    resolve({ success: false, error: `Network error: ${err.message}` });
  });

  request.write(body);
  request.end();
}

// ─── GLM 5.3 (Phase 8 / P8-A) ───────────────────────────────────────────────
// Uses the pure wire helpers in ./ai/glm.ts; this function only supplies the
// electron `net` transport. Keep ALL shape logic in glm.ts so it stays testable.
import { buildGlmRequestForEndpoint, parseGlmResponse } from './ai/glm';

function callGLM(
  config: AIConfig,
  messages: AIMessage[],
  resolve: (result: { success: boolean; content?: string; error?: string; tokens?: number }) => void
): void {
  const plan = buildGlmRequestForEndpoint(config.endpoint, config.apiKey, messages, {
    model: config.model,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  });

  const request = net.request({
    method: 'POST',
    url: plan.url,
    headers: plan.headers,
  });

  let responseData = '';

  request.on('response', (response) => {
    response.on('data', (chunk) => {
      responseData += chunk.toString();
    });

    response.on('end', () => {
      const parsed = parseGlmResponse(responseData);
      if (!parsed.success && response.statusCode >= 400) {
        resolve({
          success: false,
          error: `GLM HTTP ${response.statusCode}: ${parsed.error || 'request failed'}`,
        });
        return;
      }
      resolve(parsed);
    });
  });

  request.on('error', (err) => {
    resolve({ success: false, error: `Network error: ${err.message}` });
  });

  request.write(plan.body);
  request.end();
}

// System prompt for NEX AI
export function getSystemPrompt(): string {
  return `You are NEX AI, an advanced AI-powered code assistant. You are an expert in all programming languages and frameworks.

Your capabilities:
- Write, debug, refactor, and explain code in any language
- Analyze project structures and suggest improvements
- Help with terminal commands and system operations
- Provide best practices and architectural guidance

Rules:
1. Always provide clean, production-ready code
2. Use proper syntax highlighting in code blocks (use \`\`\`language format)
3. Explain your reasoning when making architectural decisions
4. Be concise but thorough
5. If asked to modify code, show the complete modified version
6. Support all programming languages: JavaScript, TypeScript, Python, Go, Rust, Java, C++, C#, PHP, Ruby, Swift, Kotlin, Dart, SQL, HTML, CSS, and more`;
}
