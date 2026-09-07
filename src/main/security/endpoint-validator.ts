/**
 * NEX AI — Endpoint Validator (Phase P1)
 *
 * Validates an endpoint before EVERY request (not just at registration).
 * Defends against DNS rebinding / TOCTOU by validating the ACTUAL connection
 * target (post-DNS-resolution).
 *
 * Binding (v2.3 §3 P0-1, P0-2):
 *   - Per-request validation: validateRequest runs before EVERY net.request.
 *   - DNS-TOCTOU defense: pre-connect DNS resolution + IP validation + IP pinning.
 *   - Redirect validation: redirect: 'manual' + request.on('redirect') → validateRedirect.
 *   - Credentials NOT sent to redirect targets unless independently revalidated.
 *
 * Pipeline (runs before EVERY request, not just at registration):
 *   1. URL parse (valid URL)
 *   2. Protocol: https:// or wss:// ONLY (http:// ws:// blocked)
 *   3. OriginAllowlist: isAllowedOrigin(origin)
 *   4. SSRF: !isPrivateIp(hostname)
 *   5. DNS-TOCTOU: dns.lookup(hostname, {all:true}) → for each IP: !isPrivateIp(ip)
 *      → reject if ANY resolved IP is private (catches DNS rebinding)
 *   6. Return ValidatedEndpoint { url, hostname, port, protocol, resolvedIps }
 *
 * The caller (callProvider) uses validated.resolvedIps[0] as the net.request
 * `hostname` option to pin the connection to the validated IP. The `Host`
 * header is set to the original hostname for TLS SNI + virtual hosts.
 */

import * as dns from 'dns';
import { isPrivateIp, getOriginAllowlist } from './origin-allowlist';

// ─── ValidatedEndpoint ─────────────────────────────────────────────────────

export interface ValidatedEndpoint {
  url: string;
  hostname: string;
  port: number;
  protocol: string;
  resolvedIps: string[];
}

export class EndpointValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EndpointValidationError';
  }
}

// ─── DNS resolution (with caching for performance) ─────────────────────────

interface DnsCacheEntry {
  ips: string[];
  expiresAt: number;
}

const DNS_CACHE_TTL_MS = 30_000; // 30 seconds
const dnsCache = new Map<string, DnsCacheEntry>();

async function resolveHostname(hostname: string): Promise<string[]> {
  // Check cache
  const cached = dnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ips;
  }

  // Resolve via dns.promises.lookup with all: true (returns all A + AAAA records)
  try {
    const records = await dns.promises.lookup(hostname, { all: true });
    const ips = records.map((r) => r.address);
    // Cache
    dnsCache.set(hostname, { ips, expiresAt: Date.now() + DNS_CACHE_TTL_MS });
    return ips;
  } catch (err: any) {
    // DNS resolution failed — block the request (defense-in-depth).
    throw new EndpointValidationError(`DNS resolution failed for '${hostname}'`);
  }
}

/**
 * Invalidate the DNS cache for a hostname (e.g. when the allowlist changes).
 */
export function invalidateDnsCache(hostname?: string): void {
  if (hostname) {
    dnsCache.delete(hostname);
  } else {
    dnsCache.clear();
  }
}

// ─── Sanitize error messages (strip URLs with credentials) ────────────────

/**
 * Sanitize an error message — strip ?key=, ?access_token=, AIza keys, Bearer tokens,
 * and full URLs with credentials. Binding (v2.3 §4 P1-1).
 */
export function sanitizeEndpointError(raw: string): string {
  if (!raw || typeof raw !== 'string') return String(raw || '');
  let out = raw;
  // Strip ?key= and ?access_token= query params
  out = out.replace(/([?&](?:key|access_token)=)[A-Za-z0-9_\-\.]{10,}/g, '$1***REDACTED***');
  // Strip AIza Google API keys
  out = out.replace(/\bAIza[A-Za-z0-9_-]{30,}\b/g, '***REDACTED_GOOGLE_KEY***');
  // Strip Bearer tokens
  out = out.replace(/\bBearer\s+[A-Za-z0-9_\-\.]{20,}/g, 'Bearer ***REDACTED***');
  // Strip other long base64-like strings (defense-in-depth)
  out = out.replace(/\bsk-[A-Za-z0-9]{20,}\b/g, '***REDACTED_OPENAI_KEY***');
  out = out.replace(/\bsk-ant-[A-Za-z0-9-_]{20,}\b/g, '***REDACTED_ANTHROPIC_KEY***');
  // Truncate
  if (out.length > 500) out = out.slice(0, 500) + '...';
  return out;
}

// ─── EndpointValidator ─────────────────────────────────────────────────────

export class EndpointValidator {
  /**
   * Validate an endpoint URL before sending a request.
   * Runs the full pipeline: URL → HTTPS → SSRF → OriginAllowlist → DNS-TOCTOU.
   * Throws EndpointValidationError if validation fails.
   * Returns ValidatedEndpoint if it passes.
   *
   * Binding (v2.3 §3 P0-2): runs before EVERY net.request, not just at registration.
   */
  async validateRequest(url: string): Promise<ValidatedEndpoint> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new EndpointValidationError('invalid URL');
    }

    // 1. Protocol: https:// or wss:// ONLY
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'wss:') {
      throw new EndpointValidationError(`protocol '${parsed.protocol}' not allowed — must be https: or wss:`);
    }

    const hostname = parsed.hostname;
    const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 443);

    // 2. OriginAllowlist check (binding v2.3 §3 P0-2)
    if (!getOriginAllowlist().isAllowed(url)) {
      throw new EndpointValidationError(`origin '${parsed.protocol}//${parsed.host}' not in the allowlist`);
    }

    // 3. SSRF check (hostname-based)
    if (isPrivateIp(hostname)) {
      throw new EndpointValidationError(`hostname '${hostname}' is private/loopback/link-local — blocked by SSRF`);
    }

    // 4. DNS-TOCTOU defense: resolve hostname → IPs, validate ALL
    const resolvedIps = await resolveHostname(hostname);
    for (const ip of resolvedIps) {
      if (isPrivateIp(ip)) {
        throw new EndpointValidationError(
          `DNS resolved '${hostname}' to private IP '${ip}' — blocked by SSRF (DNS rebinding defense)`,
        );
      }
    }

    return {
      url,
      hostname,
      port,
      protocol: parsed.protocol,
      resolvedIps,
    };
  }

  /**
   * Validate a redirect target independently (binding v2.3 §3 P0-2).
   * The redirect target must pass the SAME full pipeline as the original.
   * Credentials are NOT sent to a redirect target unless it passes this.
   */
  async validateRedirect(redirectUrl: string, _originalValidated: ValidatedEndpoint): Promise<ValidatedEndpoint> {
    // The redirect target goes through the EXACT same pipeline as the original request.
    // No inheritance of validation — independent revalidation (binding).
    return this.validateRequest(redirectUrl);
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _validator: EndpointValidator | null = null;

export function getEndpointValidator(): EndpointValidator {
  if (!_validator) _validator = new EndpointValidator();
  return _validator;
}

export function _resetEndpointValidator(): void {
  _validator = null;
  dnsCache.clear();
}
