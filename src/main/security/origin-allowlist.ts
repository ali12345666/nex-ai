/**
 * NEX AI — Origin Allowlist + SSRF Protection (Phase P1)
 *
 * Dynamic origin allowlist + SSRF (Server-Side Request Forgery) protection.
 *
 * Binding (v2.3 §3, §7):
 *   - User intent / approval MUST NOT bypass SSRF protection.
 *   - ALL endpoints (built-in, user, plugin) pass the SAME validation pipeline:
 *       URL parse → HTTPS/WSS → hostname → IP → private/loopback/link-local/metadata rejection
 *   - Self-hosted/LAN providers are EXPLICITLY DISABLED in P1.
 *   - http:// and ws:// are blocked (no exception, no "localhost dev mode" in P1).
 *   - isPrivateIp blocks: 10.x, 172.16-31.x, 192.168.x, 169.254.x (metadata),
 *     127.x (loopback), ::1, 0.0.0.0, broadcast, IPv6 ULA (fc00::/7),
 *     IPv6 link-local (fe80::/10).
 */

// ─── isPrivateIp — SSRF protection (binding) ───────────────────────────────

/**
 * Returns true if the host is a private/loopback/link-local/metadata address
 * that MUST be blocked for AI provider endpoints.
 *
 * Binding (v2.3 §3): applied to ALL endpoints unconditionally. No user-approval bypass.
 */
export function isPrivateIp(host: string): boolean {
  if (!host || typeof host !== 'string') return true; // block invalid

  const h = host.trim().toLowerCase();

  // IPv6 loopback
  if (h === '::1' || h === '::') return true;
  // IPv6 ULA (fc00::/7 — fc00:: to fdff::)
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  // IPv6 link-local (fe80::/10)
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true;
  // IPv6 unspecified
  if (h === '::0' || h === '0:0:0:0:0:0:0:0') return true;

  // IPv4: strip brackets if present
  const v4 = h.replace(/^\[|\]$/g, '');

  // All-zeros
  if (v4 === '0.0.0.0') return true;
  // Broadcast
  if (v4 === '255.255.255.255') return true;

  // Numeric IPv4
  const parts = v4.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const octets = parts.map((p) => parseInt(p, 10));
    if (octets.some((o) => o < 0 || o > 255)) return true; // invalid — block
    const [a, b] = octets;
    // 127.x — loopback
    if (a === 127) return true;
    // 10.x — private
    if (a === 10) return true;
    // 172.16-31.x — private
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.x — private
    if (a === 192 && b === 168) return true;
    // 169.254.x — link-local + metadata (169.254.169.254 = AWS metadata)
    if (a === 169 && b === 254) return true;
    // 0.x — "this network" (reserved)
    if (a === 0) return true;
    // 224-239.x — multicast
    if (a >= 224 && a <= 239) return true;
    // 240-255.x — reserved
    if (a >= 240) return true;
    return false; // public IPv4
  }

  // Hostname-based checks
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  // .local mDNS
  if (h.endsWith('.local')) return true;
  // .internal (common private TLD)
  if (h.endsWith('.internal')) return true;

  return false; // assume public hostname (will be DNS-validated separately)
}

// ─── Origin validation (URL + protocol + SSRF) ──────────────────────────────

export interface OriginValidationResult {
  ok: boolean;
  reason?: string;
  origin?: string;
  hostname?: string;
}

/**
 * Validate an origin (protocol://host) for use as an AI provider endpoint.
 * Binding (v2.3 §3): the full validation pipeline runs for ALL providers.
 */
export function validateOrigin(origin: string): OriginValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }

  // Protocol check: https:// or wss:// ONLY (binding v2.3 §3)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'wss:') {
    return { ok: false, reason: `protocol '${parsed.protocol}' not allowed — must be https: or wss:` };
  }

  const hostname = parsed.hostname;

  // SSRF check: hostname-based private/loopback/link-local
  if (isPrivateIp(hostname)) {
    return { ok: false, reason: `hostname '${hostname}' is private/loopback/link-local — blocked by SSRF protection` };
  }

  // Port check: block non-standard ports? No — allow any (the protocol + SSRF
  // checks are sufficient). But block port 0 (invalid).
  if (parsed.port && parseInt(parsed.port, 10) === 0) {
    return { ok: false, reason: 'port 0 is invalid' };
  }

  return {
    ok: true,
    origin: `${parsed.protocol}//${parsed.host}`,
    hostname,
  };
}

// ─── Origin Allowlist (dynamic) ────────────────────────────────────────────

class OriginAllowlistImpl {
  private origins = new Set<string>();

  /**
   * Add a built-in origin (auto-added at startup). Validates the origin.
   * Binding: validation runs regardless of trust level — NO bypass.
   */
  addBuiltIn(origin: string): OriginValidationResult {
    const result = validateOrigin(origin);
    if (!result.ok) return result;
    this.origins.add(result.origin!);
    return result;
  }

  /**
   * Add a user-defined origin (P2 — the user typed the endpoint).
   * Binding (v2.3 §3): user intent is NOT a security bypass. Full pipeline.
   */
  addUserDefined(origin: string): OriginValidationResult {
    const result = validateOrigin(origin);
    if (!result.ok) return result;
    this.origins.add(result.origin!);
    return result;
  }

  /**
   * Add a plugin origin (P4 — requires explicit user approval).
   * Binding: still passes validation. Approval is an additional gate, not a bypass.
   */
  addPlugin(origin: string, approval: { approvedBy: 'user'; approvedOrigins: string[] }): OriginValidationResult {
    if (!approval.approvedOrigins.includes(origin)) {
      return { ok: false, reason: `origin '${origin}' not in the user-approved list` };
    }
    const result = validateOrigin(origin);
    if (!result.ok) return result;
    this.origins.add(result.origin!);
    return result;
  }

  /**
   * Check if a URL's origin is in the allowlist.
   */
  isAllowed(url: string): boolean {
    try {
      const u = new URL(url);
      return this.origins.has(`${u.protocol}//${u.host}`);
    } catch {
      return false;
    }
  }

  /**
   * Remove an origin (when a provider is unregistered).
   */
  remove(origin: string): void {
    this.origins.delete(origin);
  }

  /**
   * List all allowed origins (for debugging/CSP).
   */
  list(): string[] {
    return Array.from(this.origins);
  }

  /**
   * Clear (test-only).
   */
  _clearForTest(): void {
    this.origins.clear();
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _allowlist: OriginAllowlistImpl | null = null;

export function getOriginAllowlist(): OriginAllowlistImpl {
  if (!_allowlist) _allowlist = new OriginAllowlistImpl();
  return _allowlist;
}

export function _resetOriginAllowlist(): void {
  if (_allowlist) _allowlist._clearForTest();
  _allowlist = null;
}

/**
 * Compatibility wrapper: matches the existing isAllowedAIOrigin signature.
 * Used by security/index.ts to delegate to the dynamic allowlist.
 */
export function isAllowedAIOrigin(url: string): boolean {
  return getOriginAllowlist().isAllowed(url);
}
