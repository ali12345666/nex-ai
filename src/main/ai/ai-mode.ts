/**
 * NEX AI — AI Mode Enforcement (UI-02)
 *
 * Server-side enforcement of the persisted `aiMode` setting.
 *
 * Why this exists:
 *   The renderer passes `config.provider` in IPC, but a compromised renderer
 *   (or a bug) could send `provider='openai'` while the user has set
 *   `aiMode='local'`. The main process MUST block such requests — not trust
 *   the renderer's claim. This is the directive §9 requirement:
 *   "Offline باید واقعاً هیچ endpoint خارجی اجباری نداشته باشد".
 *
 * Modes (mirrors src/renderer/store/useStore.ts → AIMode):
 *   'local'  → ALL online providers BLOCKED. Local-only. Defense-in-depth.
 *   'online' → online providers allowed IF network is available.
 *              Local still allowed (user can override per-request).
 *   'auto'   → renderer decides; backend doesn't second-guess.
 *
 * Network availability:
 *   Uses Electron's `net.online` (synchronous, OS-level check).
 *   In test/non-Electron envs, returns false (safe default).
 */

import { net } from 'electron';
import type { ProviderType, ProviderResult } from './provider';
import { loadState } from '../persistence';

export type AIMode = 'local' | 'online' | 'auto';

/** Persisted settings shape (mirrors persistence/index.ts). */
interface PersistedSettingsLite {
  aiMode?: AIMode;
}

/**
 * Read the current persisted aiMode setting.
 * Falls back to 'local' (safe default) if unset or invalid.
 *
 * Synchronous — safe to call from ipcMain handlers.
 */
export function getCurrentAiMode(): AIMode {
  try {
    const state = loadState();
    const mode = (state.settings as PersistedSettingsLite | undefined)?.aiMode;
    if (mode === 'local' || mode === 'online' || mode === 'auto') return mode;
  } catch {
    /* fall through to default */
  }
  return 'local'; // safe default
}

/**
 * Check whether the host has network connectivity.
 * Uses Electron's `net.online` (synchronous boolean).
 *
 * Returns false in test/non-Electron envs (net.online is undefined there).
 */
export function isNetworkAvailable(): boolean {
  try {
    // Electron exposes `net.online` as a synchronous boolean.
    return !!(net as any).online;
  } catch {
    return false;
  }
}

/**
 * Enforce the persisted aiMode against a requested provider.
 *
 * Returns `null` if the request is ALLOWED, or a `ProviderResult` error
 * describing why it was blocked.
 *
 * Decision matrix:
 *   mode='local'  + provider='local'   → ALLOW
 *   mode='local'  + provider=online    → BLOCK (defense-in-depth)
 *   mode='online' + provider='local'   → ALLOW (user can override)
 *   mode='online' + provider=online     → ALLOW only if network available
 *   mode='auto'   + any                 → ALLOW (renderer decides)
 *
 * @param mode    current persisted aiMode
 * @param provider requested provider type
 */
export function enforceAiMode(
  mode: AIMode,
  provider: ProviderType,
): ProviderResult | null {
  // Local mode: block all online providers (defense-in-depth).
  if (mode === 'local' && provider !== 'local') {
    return {
      success: false,
      error:
        `Blocked by aiMode='local': online provider "${provider}" not allowed. ` +
        `Switch to Online or Auto mode via the status bar toggle.`,
      provider,
    };
  }
  // Online mode + online provider: also require network availability.
  if (mode === 'online' && provider !== 'local' && !isNetworkAvailable()) {
    return {
      success: false,
      error:
        'No network connectivity detected. Cannot reach online AI provider. ' +
        'Switch to Local mode via the status bar toggle, or check your network.',
      provider,
    };
  }
  // Auto mode: backend doesn't second-guess the renderer's routing decision.
  return null;
}
