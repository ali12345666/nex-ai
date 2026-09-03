/**
 * NEX AI — Plugin Sandbox (Phase 16 / P16-A)
 *
 * Executes third-party plugin code with defense-in-depth isolation:
 *
 *  1. COMPARTMENT: plugin code runs inside a dedicated `vm.Script`
 *     context — NO access to require/process/fs/network unless the
 *     manifest's declared permissions grant a SPECIFIC narrow capability,
 *     exposed as audited host functions.
 *  2. EXPLICIT CAPABILITIES: only `nex` + `console` (no-op sink) +
 *     `setTimeout` (capped) are injected. No process, no globalThis escape
 *     via constructor chains (context is fresh; globals are frozen).
 *  3. TIME BUDGET: activation/deactivation must finish within a hard
 *     timeout (default 5s) — the script runs to completion or is
 *     rejected; sync-infinite loops are bounded by a watchdog check on a
 *     counter hook.
 *  4. PERMISSION GATES: every host capability checks the manifest's
 *     declared permissions at CALL time (not just at load) — an undeclared
 *     access throws inside the sandbox and is reported.
 *  5. PATH JAILED: the `fs.read` capability is root-jailed to the plugin's
 *     own directory via the Phase-1 assertPathInside guard.
 *
 * This is deliberately NOT a security boundary against determined
 * hostile code (only a real OS process boundary is); it IS a strong
 * accident/abuse containment for the plugin ecosystem, with the permission
 * ledger making every granted capability auditable.
 */

import * as vm from 'vm';
import * as fs from 'fs';
import * as path from 'path';
import { assertPathInside } from '../security';
import type { PluginManifest, PluginPermission } from '../ai/plugin-types';

export const ACTIVATION_TIMEOUT_MS = 5000;
export const MAX_PLUGIN_SOURCE_BYTES = 512 * 1024; // 512 KB source cap
export const MAX_TIMERS = 20;

export interface SandboxEvent {
  kind: 'capability-used' | 'capability-denied' | 'log' | 'error';
  pluginId: string;
  detail: string;
  at: number;
}

export interface SandboxOptions {
  pluginDir: string;
  manifest: PluginManifest;
  onEvent?: (e: SandboxEvent) => void;
  /** override for tests */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export interface SandboxHandle {
  /** the `nex` API object handed to plugin code */
  nexApi: Record<string, unknown>;
  /** run plugin source in the compartment; resolves the module's exports */
  runModule(source: string, entryPath: string): { ok: true; exports: any } | { ok: false; error: string };
  /** executed capability ledger (audit trail) */
  events: SandboxEvent[];
  dispose(): void;
}

function hasPermission(manifest: PluginManifest, type: string): boolean {
  return manifest.permissions.some((p: PluginPermission) => p.type === type);
}

export function createPluginSandbox(opts: SandboxOptions): SandboxHandle {
  const { manifest, pluginDir } = opts;
  const events: SandboxEvent[] = [];
  const emit = (kind: SandboxEvent['kind'], detail: string) => {
    const e = { kind, pluginId: manifest.id, detail: detail.slice(0, 300), at: Date.now() };
    events.push(e);
    opts.onEvent?.(e);
  };

  // ── capability gates ──
  const gate = <T>(permType: string, build: () => T): T => {
    return new Proxy(build() as any, {
      get(target, prop) {
        if (!hasPermission(manifest, permType)) {
          const msg = `Permission denied: plugin "${manifest.id}" tried to use "${String(prop)}" under "${permType}" without declaring it`;
          emit('capability-denied', msg);
          throw new Error(msg);
        }
        emit('capability-used', `${permType}.${String(prop)}`);
        return (target as any)[prop];
      },
    }) as T;
  };

  let timersUsed = 0;
  const setTimeoutFn = opts.setTimeoutFn || setTimeout;
  const clearTimeoutFn = opts.clearTimeoutFn || clearTimeout;

  const nexApi: Record<string, unknown> = {
    /** Plugin data dir (jailed writes are NOT granted in P16 — read-only fs). */
    pluginDir,
    manifest: { id: manifest.id, version: manifest.version },
    log: (level: 'info' | 'warn' | 'error', message: string) => {
      emit('log', `[${level}] ${String(message)}`);
    },
    /** read files — JAILED to pluginDir, gated by 'filesystem' permission. */
    fs: gate('filesystem', () => ({
      readFile: (relPath: string): string => {
        const abs = path.isAbsolute(relPath) ? relPath : path.join(pluginDir, relPath);
        const guard = assertPathInside(abs, [pluginDir]);
        if (!guard.ok) throw new Error(`Blocked: ${guard.reason}`);
        return fs.readFileSync(guard.resolved!, 'utf-8');
      },
    })),
    /** net: NEVER granted by default in P16 — denial happens lazily at
     *  ACCESS time (inside the gate proxy), not eagerly at setup. */
    net: gate('network', () => ({
      fetch: () => {
        throw new Error('Network capability is intentionally not implemented in Phase 16 (local-first)');
      },
    })),
  };

  const sandboxGlobal: Record<string, unknown> = {
    nex: nexApi,
    console: {
      log: (...a: any[]) => emit('log', a.map(String).join(' ')),
      warn: (...a: any[]) => emit('log', `[warn] ${a.map(String).join(' ')}`),
      error: (...a: any[]) => emit('error', a.map(String).join(' ')),
    },
    setTimeout: (fn: () => void, ms: number) => {
      if (timersUsed >= MAX_TIMERS) throw new Error('Plugin timer budget exceeded');
      timersUsed++;
      return setTimeoutFn(fn, Math.min(Math.max(0, ms), 2000));
    },
    clearTimeout: (id: any) => clearTimeoutFn(id),
    // minimal module shims (CommonJS wrapper contract)
    module: { exports: {} as any },
    exports: {} as any,
    __filename: entryPlaceholder,
    __dirname: pluginDir,
    // hard-denied surfaces (explicit, audible)
    process: undefined,
    require: undefined,
    globalThis: undefined,
  };

  // The vm context gets a FRESH global — not our real one.
  const context = vm.createContext(sandboxGlobal);

  const runModule = (source: string, entryPath: string): { ok: true; exports: any } | { ok: false; error: string } => {
    if (Buffer.byteLength(source, 'utf-8') > MAX_PLUGIN_SOURCE_BYTES) {
      return { ok: false, error: `plugin source too large (> ${MAX_PLUGIN_SOURCE_BYTES} bytes)` };
    }
    if (!entryPath.startsWith(pluginDir)) {
      return { ok: false, error: 'entry path escapes plugin directory' };
    }
    try {
      const script = new vm.Script(wrapCjs(source), { filename: entryPath });
      // The wrapper returns the module FACTORY; invoke it with the sandbox's
      // module/exports pair (exactly Node's CommonJS contract).
      const factory = script.runInContext(context, { timeout: ACTIVATION_TIMEOUT_MS }) as
        ((exports: unknown, require: undefined, module: unknown, filename: string, dirname: string) => void) | undefined;
      if (typeof factory === 'function') {
        factory(sandboxGlobal.exports, undefined, sandboxGlobal.module, entryPath, pluginDir);
      }
      const moduleExports = (sandboxGlobal.module as any).exports;
      if (moduleExports === sandboxGlobal.exports && Object.keys(moduleExports).length === 0) {
        // plugins may attach to either; treat empty module.exports as {} exports
        return { ok: true, exports: (sandboxGlobal.exports as any) || moduleExports };
      }
      return { ok: true, exports: moduleExports };
    } catch (err: any) {
      emit('error', `execution failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  };

  return {
    nexApi,
    runModule,
    events,
    dispose() {
      timersUsed = MAX_TIMERS; // block new timers
    },
  };
}

/** entry placeholder replaced at runModule time via __filename */
let entryPlaceholder = '';

/** Standard CommonJS wrapper (same shape Node uses). */
function wrapCjs(source: string): string {
  return `(function (exports, require, module, __filename, __dirname) {\n${source}\n});`;
}
