/**
 * NEX AI — Anthropic Provider Descriptor (Phase P1)
 */

import type { ProviderDescriptor } from '../capabilities';
import { getAnthropicTransport } from '../transports/anthropic';

export const anthropicProvider: ProviderDescriptor = {
  id: 'anthropic',
  displayName: 'Anthropic Claude',
  trust: 'built-in',
  capabilities: new Set(['text', 'streaming-text', 'vision', 'tool-calling']),
  authMethod: { type: 'x-api-key', secretId: 'anthropicApiKey' },
  defaultModel: 'claude-sonnet-4-20250514',
  defaultEndpoint: 'https://api.anthropic.com',
  availableModels: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-haiku-20241022'],
  transport: getAnthropicTransport(),
  streamTransport: getAnthropicTransport(),
  toolTransport: getAnthropicTransport(),
  visionTransport: getAnthropicTransport(),
  allowedOrigins: ['https://api.anthropic.com'],
};
