/**
 * NEX AI — Secret Resolver (Phase P1)
 *
 * The Main Security Boundary for API key resolution. Runs `getSecret()` ONLY
 * here — transports NEVER call getSecret or import persistence.
 *
 * Lifecycle (binding v2.1 §4, v2.3 §4):
 *
 *   Renderer ── secretId (string) ──► Main Security Boundary (this module)
 *                                         │ getSecret(secretId) → credential
 *                                         │ → ResolvedAuth { credential }
 *                                         ├─► Transport.buildChatRequest(ResolvedChatMessage[], opts, ResolvedAuth)
 *                                         └─► Transport.testConnection(ProviderCallContext { auth: ResolvedAuth })
 *
 *   Transport NEVER imports persistence. Transport NEVER calls getSecret.
 *   ResolvedAuth is per-request — never cached, persisted, or logged.
 */

import type { AuthMethod, ResolvedAuth, ProviderDescriptor } from './capabilities';

// Lazy import of getSecret to avoid a hard dependency at module-load time
// (persistence/index.ts requires Electron's safeStorage which is unavailable
// in test environments).
let _getSecret: (key: string) => string | null;

/**
 * Wire the getSecret function. Called once at startup from main.ts.
 * In tests, a mock getSecret can be wired.
 */
export function wireSecretResolver(getSecretFn: (key: string) => string): void {
  _getSecret = (key: string) => {
    try {
      return getSecretFn(key) || '';
    } catch {
      return '';
    }
  };
}

/**
 * Resolve an AuthMethod to ResolvedAuth. Runs in the Main Security Boundary.
 * This is the ONLY function that calls getSecret.
 *
 * Binding: `getSecret()` runs ONLY here. Transports receive ResolvedAuth.
 */
export function resolveAuth(authMethod: AuthMethod): ResolvedAuth {
  if (authMethod.type === 'none') {
    return { credential: '' };
  }
  if (!_getSecret) {
    // No secret resolver wired — return empty (the request will fail at the
    // transport level with a "no API key" error, which is sanitized).
    return { credential: '' };
  }
  const credential = _getSecret(authMethod.secretId) || '';
  return { credential };
}

/**
 * Resolve auth for a provider by id. Convenience wrapper.
 */
export function resolveAuthForProvider(
  registry: { getProvider: (id: string) => ProviderDescriptor | undefined },
  providerId: string,
): ResolvedAuth | null {
  const desc = registry.getProvider(providerId);
  if (!desc) return null;
  return resolveAuth(desc.authMethod);
}
