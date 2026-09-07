/**
 * NEX AI — GLM Provider Descriptor (Phase P1)
 *
 * Declares the GLM 5.3 (Z.ai) provider. GLM uses an OpenAI-compatible API
 * with Bearer auth.
 */

import type { ProviderDescriptor } from '../capabilities';
import { getOpenAiCompatibleTransport } from '../transports/openai-compatible';
import { GLM_DEFAULT_MODEL, GLM_DEFAULT_ENDPOINT } from '../glm';

export const glmProvider: ProviderDescriptor = {
  id: 'glm',
  displayName: 'GLM 5.3 (Z.ai)',
  trust: 'built-in',
  capabilities: new Set(['text', 'streaming-text', 'vision']),
  authMethod: { type: 'bearer', secretId: 'glmApiKey' },
  defaultModel: GLM_DEFAULT_MODEL,
  defaultEndpoint: GLM_DEFAULT_ENDPOINT,
  availableModels: ['glm-5.3', 'glm-5.3-air', 'glm-5.3-flash'],
  transport: getOpenAiCompatibleTransport(),
  streamTransport: getOpenAiCompatibleTransport(),
  visionTransport: getOpenAiCompatibleTransport(),
  allowedOrigins: ['https://api.z.ai', 'https://open.bigmodel.cn'],
};
