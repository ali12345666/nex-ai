/**
 * NEX AI — Built-in Provider Registration (Phase P1)
 *
 * Registers all built-in providers at startup. Called from main.ts after
 * the OriginAllowlist and secret-resolver are wired.
 *
 * Adding a new built-in provider = 1 new file in providers/ + 1 line here.
 * No Core/Agent/Tool/Permission/FSM changes.
 */

import { getProviderRegistry } from '../provider-registry';
import { openaiProvider } from './openai';
import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';
import { glmProvider } from './glm';

export function registerBuiltInProviders(): void {
  const registry = getProviderRegistry();
  registry.registerProvider(openaiProvider);
  registry.registerProvider(anthropicProvider);
  registry.registerProvider(geminiProvider);
  registry.registerProvider(glmProvider);
}
