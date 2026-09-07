/**
 * NEX AI — Universal Provider Registry (Phase P1)
 *
 * Open-ended registry of ProviderDescriptors. Providers self-register at
 * startup (built-in) or via the Settings UI (user, P2) or plugin code (P4).
 *
 * Binding (v2.2 §2.6, v2.3 §2.6): registerProvider enforces invariants:
 *   - streaming-text ⇔ streamTransport exists AND isStreaming === true
 *   - tool-calling ⇔ toolTransport exists
 *   - vision ⇔ visionTransport exists
 *   - trust === 'plugin' && !approval → THROWS (P4; P1 only registers built-in)
 *   - origin validation: allowedOrigins pass SSRF + HTTPS validation
 *
 * The registry is provider-agnostic — no branching on provider names.
 * Adding a new provider MUST NOT require Core/Agent/Tool/Permission/FSM changes.
 */

import type {
  ProviderId,
  ProviderDescriptor,
  ProviderTrust,
  Capability,
  UserApproval,
} from './capabilities';

// Lazy import of the origin allowlist to avoid circular deps (origin-allowlist
// imports from security/index.ts; provider-registry is imported by main.ts
// which imports security/index.ts). We use a deferred getter.
let _originAllowlistAdd: ((origin: string) => { ok: boolean; reason?: string }) | null = null;
let _originAllowlistValidate: ((origin: string) => { ok: boolean; reason?: string }) | null = null;

/**
 * Wire the origin allowlist validation functions. Called once at startup
 * from main.ts (after both modules are loaded). This avoids a circular import.
 */
export function wireOriginAllowlist(
  addFn: (origin: string) => { ok: boolean; reason?: string },
  validateFn: (origin: string) => { ok: boolean; reason?: string },
): void {
  _originAllowlistAdd = addFn;
  _originAllowlistValidate = validateFn;
}

// ─── Registry invariant errors ──────────────────────────────────────────────

export class ProviderRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderRegistryError';
  }
}

// ─── Provider Registry (singleton) ─────────────────────────────────────────

class ProviderRegistryImpl {
  private providers = new Map<ProviderId, ProviderDescriptor>();
  private registeredCbs: Array<(desc: ProviderDescriptor) => void> = [];
  private unregisteredCbs: Array<(id: ProviderId) => void> = [];

  /**
   * Register a provider descriptor. Enforces invariants (binding v2.2 §2.6).
   * Throws ProviderRegistryError if validation fails.
   */
  registerProvider(desc: ProviderDescriptor, approval?: UserApproval): void {
    // INVARIANT: id must be non-empty + unique
    if (!desc.id || typeof desc.id !== 'string' || !desc.id.trim()) {
      throw new ProviderRegistryError('ProviderDescriptor.id must be a non-empty string');
    }
    if (this.providers.has(desc.id)) {
      throw new ProviderRegistryError(`Provider '${desc.id}' is already registered`);
    }

    // INVARIANT: trust policy (P1 only allows built-in; P2 adds user; P4 adds plugin)
    if (desc.trust === 'plugin' && !approval) {
      throw new ProviderRegistryError(
        `Provider '${desc.id}' has trust='plugin' but no user approval — plugin providers require explicit approval`,
      );
    }
    if (desc.trust === 'user' && desc.id.startsWith('custom-')) {
      // P2 will implement user providers; P1 blocks them at registration.
      // (The type is defined for forward-compat; registration is rejected in P1.)
      // NOTE: we allow 'user' trust here for future P2 — the block is only on
      // the UI/persistence side in P1. Code-registered descriptors with
      // trust='user' are allowed (there are none in P1).
    }

    // INVARIANT 1 (streaming-text ⇔ streamTransport + isStreaming)
    const hasStreamingCap = desc.capabilities.has('streaming-text');
    const hasStreamTransport = !!desc.streamTransport;
    if (hasStreamingCap && !hasStreamTransport) {
      throw new ProviderRegistryError(
        `Provider '${desc.id}' advertises 'streaming-text' but has no streamTransport — ` +
        `a provider that emulates streaming MUST NOT advertise 'streaming-text'`,
      );
    }
    if (hasStreamTransport && !hasStreamingCap) {
      throw new ProviderRegistryError(
        `Provider '${desc.id}' has a streamTransport but does not advertise 'streaming-text' — ` +
        `add 'streaming-text' to capabilities or remove streamTransport`,
      );
    }
    if (hasStreamTransport && desc.streamTransport!.isStreaming !== true) {
      throw new ProviderRegistryError(
        `Provider '${desc.id}' streamTransport.isStreaming must be true — ` +
        `emulated streaming does NOT qualify for the 'streaming-text' capability`,
      );
    }

    // INVARIANT 2 (tool-calling ⇔ toolTransport)
    if (desc.capabilities.has('tool-calling') && !desc.toolTransport) {
      throw new ProviderRegistryError(
        `Provider '${desc.id}' advertises 'tool-calling' but has no toolTransport`,
      );
    }
    if (desc.toolTransport && !desc.capabilities.has('tool-calling')) {
      throw new ProviderRegistryError(
        `Provider '${desc.id}' has a toolTransport but does not advertise 'tool-calling'`,
      );
    }

    // INVARIANT 3 (vision ⇔ visionTransport)
    if (desc.capabilities.has('vision') && !desc.visionTransport) {
      throw new ProviderRegistryError(
        `Provider '${desc.id}' advertises 'vision' but has no visionTransport`,
      );
    }
    if (desc.visionTransport && !desc.capabilities.has('vision')) {
      throw new ProviderRegistryError(
        `Provider '${desc.id}' has a visionTransport but does not advertise 'vision'`,
      );
    }

    // INVARIANT: required transport must exist
    if (!desc.transport) {
      throw new ProviderRegistryError(
        `Provider '${desc.id}' must have a transport (TextChatTransport is required)`,
      );
    }

    // INVARIANT: defaultModel + defaultEndpoint must be non-empty
    if (!desc.defaultModel || !desc.defaultModel.trim()) {
      throw new ProviderRegistryError(`Provider '${desc.id}' must have a defaultModel`);
    }
    if (!desc.defaultEndpoint || !desc.defaultEndpoint.trim()) {
      throw new ProviderRegistryError(`Provider '${desc.id}' must have a defaultEndpoint`);
    }

    // INVARIANT: origin validation (allowedOrigins must pass SSRF + HTTPS)
    if (_originAllowlistAdd) {
      for (const origin of desc.allowedOrigins) {
        const result = _originAllowlistAdd(origin);
        if (!result.ok) {
          throw new ProviderRegistryError(
            `Provider '${desc.id}' allowedOrigin '${origin}' rejected: ${result.reason || 'validation failed'}`,
          );
        }
      }
    }

    // All invariants passed — register.
    this.providers.set(desc.id, desc);
    console.log(`[PROVIDER_REGISTRY] registered: ${desc.id} (trust=${desc.trust}, capabilities=[${Array.from(desc.capabilities).join(', ')}])`);
    for (const cb of this.registeredCbs) {
      try { cb(desc); } catch { /* best-effort */ }
    }
  }

  unregisterProvider(id: ProviderId): void {
    if (!this.providers.has(id)) return;
    this.providers.delete(id);
    console.log(`[PROVIDER_REGISTRY] unregistered: ${id}`);
    for (const cb of this.unregisteredCbs) {
      try { cb(id); } catch { /* best-effort */ }
    }
  }

  getProvider(id: ProviderId): ProviderDescriptor | undefined {
    return this.providers.get(id);
  }

  listProviders(filter?: { capability?: Capability; trust?: ProviderTrust }): ProviderDescriptor[] {
    let list = Array.from(this.providers.values());
    if (filter?.capability) {
      list = list.filter((d) => d.capabilities.has(filter.capability!));
    }
    if (filter?.trust) {
      list = list.filter((d) => d.trust === filter.trust);
    }
    return list;
  }

  getProvidersForCapability(cap: Capability): ProviderDescriptor[] {
    return this.listProviders({ capability: cap });
  }

  onProviderRegistered(cb: (desc: ProviderDescriptor) => void): () => void {
    this.registeredCbs.push(cb);
    return () => {
      const idx = this.registeredCbs.indexOf(cb);
      if (idx >= 0) this.registeredCbs.splice(idx, 1);
    };
  }

  onProviderUnregistered(cb: (id: ProviderId) => void): () => void {
    this.unregisteredCbs.push(cb);
    return () => {
      const idx = this.unregisteredCbs.indexOf(cb);
      if (idx >= 0) this.unregisteredCbs.splice(idx, 1);
    };
  }

  /** Clear all providers (test-only helper). */
  _clearForTest(): void {
    this.providers.clear();
    this.registeredCbs = [];
    this.unregisteredCbs = [];
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _registry: ProviderRegistryImpl | null = null;

export function getProviderRegistry(): ProviderRegistryImpl {
  if (!_registry) _registry = new ProviderRegistryImpl();
  return _registry;
}

export function _resetProviderRegistry(): void {
  if (_registry) {
    _registry._clearForTest();
  }
  _registry = null;
}
