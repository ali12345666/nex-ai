/**
 * NEX AI — Gemini Provider Descriptor (Phase P1)
 *
 * Declares the Gemini provider for text chat (REST API). The Gemini Live
 * voice transport (O6) is separate — it uses a WebSocket transport, not this
 * REST transport.
 */

import type { ProviderDescriptor } from '../capabilities';
import { getGeminiRestTransport } from '../transports/gemini-rest';

export const geminiProvider: ProviderDescriptor = {
  id: 'gemini',
  displayName: 'Google Gemini',
  trust: 'built-in',
  capabilities: new Set(['text', 'streaming-text', 'vision', 'realtime-voice']),
  // Gemini REST uses x-goog-api-key; Gemini Live uses url-query (?key=).
  // For the text provider, we use x-goog-api-key (REST API).
  // The Gemini Live voice transport (O6) handles the url-query case separately.
  authMethod: { type: 'x-goog-api-key', secretId: 'geminiApiKey' },
  defaultModel: 'gemini-2.0-flash',
  defaultEndpoint: 'https://generativelanguage.googleapis.com',
  availableModels: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  transport: getGeminiRestTransport(),
  streamTransport: getGeminiRestTransport(),
  visionTransport: getGeminiRestTransport(),
  // NOTE: realtime-voice capability is declared but there's no toolTransport
  // needed for text. The Gemini Live voice transport (O6) is separate.
  // The registry invariant for 'tool-calling' is not triggered because we
  // don't declare 'tool-calling' here (Gemini REST tool-calling is deferred
  // to a future phase per the O6 directive — no native function calling).
  allowedOrigins: ['https://generativelanguage.googleapis.com'],
};
