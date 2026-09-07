/**
 * NEX AI — OpenAI Provider Descriptor (Phase P1)
 *
 * Declares the OpenAI provider's identity, capabilities, auth, defaults, and
 * references the reusable OpenAI-compatible transport.
 */

import type { ProviderDescriptor } from '../capabilities';
import { getOpenAiCompatibleTransport } from '../transports/openai-compatible';

export const openaiProvider: ProviderDescriptor = {
  id: 'openai',
  displayName: 'OpenAI',
  trust: 'built-in',
  capabilities: new Set(['text', 'streaming-text', 'vision', 'tool-calling']),
  authMethod: { type: 'bearer', secretId: 'openaiApiKey' },
  defaultModel: 'gpt-4o',
  defaultEndpoint: 'https://api.openai.com',
  availableModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  transport: getOpenAiCompatibleTransport(),
  streamTransport: getOpenAiCompatibleTransport(),
  toolTransport: getOpenAiCompatibleTransport(),
  visionTransport: getOpenAiCompatibleTransport(),
  allowedOrigins: ['https://api.openai.com'],
};
