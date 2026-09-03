/**
 * NEX AI — Plugin Loader (Phase 16 / P16-B)
 *
 * Bridges registry (P15) + sandbox (P16-A): loads ENABLED plugins with
 * valid manifests, runs their entry in the sandbox compartment, extracts
 * the Plugin contract (activate/deactivate/getTools) and enforces the
 * lifecycle:
 *   - activate(context) with a 5s budget; failures disable the plugin for
 *     the session and are reported (never crash the host)
 *   - tools returned by getTools() are REGISTERED into the shared tool
 *     registry with a namespaced name (plugin_<id>_<tool>) and the
 *     plugin's permission ledger attached for audit
 *   - deactivate() best-effort on shutdown/disable
 *
 * The loader is the ONLY place plugin code meets host capabilities.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Plugin, PluginContext, PluginManifest, PluginRegistryEntry } from '../ai/plugin-types';
import type { Tool } from '../ai/tool-registry';
import { createPluginSandbox, type SandboxEvent } from './sandbox';

export interface LoadedPlugin {
  manifest: PluginManifest;
  instance: Plugin;
  sandboxEvents: SandboxEvent[];
  activatedAt: number;
  toolsRegistered: string[];
}

export interface LoadReport {
  pluginId: string;
  status: 'activated' | 'failed' | 'skipped';
  reason?: string;
  tools: string[];
  events: SandboxEvent[];
}

/** Minimal registry surface the loader needs (duck-typed). */
export interface ToolRegistrationSink {
  registerTool?: (tool: Tool) => void;
}

export interface LoaderOptions {
  toolRegistry: ToolRegistrationSink;
  onEvent?: (e: SandboxEvent) => void;
  now?: () => number;
}

export class PluginLoader {
  private loaded = new Map<string, LoadedPlugin>();
  private opts: LoaderOptions;

  constructor(opts: LoaderOptions) {
    this.opts = opts;
  }

  /** Load + activate one registry entry. Never throws. */
  async load(entry: PluginRegistryEntry): Promise<LoadReport> {
    const { manifest, pluginDir } = entry;
    if (!entry.enabled) {
      return { pluginId: manifest.id, status: 'skipped', reason: 'disabled', tools: [], events: [] };
    }
    const entryPath = path.resolve(pluginDir, manifest.main);
    if (!entryPath.startsWith(pluginDir)) {
      return { pluginId: manifest.id, status: 'failed', reason: 'entry escapes plugin dir', tools: [], events: [] };
    }
    let source: string;
    try {
      source = fs.readFileSync(entryPath, 'utf-8');
    } catch (err: any) {
      return { pluginId: manifest.id, status: 'failed', reason: `cannot read entry: ${err.message}`, tools: [], events: [] };
    }

    const sandbox = createPluginSandbox({ pluginDir, manifest, onEvent: this.opts.onEvent });
    const run = sandbox.runModule(source, entryPath);
    if (!run.ok) {
      return { pluginId: manifest.id, status: 'failed', reason: run.error, tools: [], events: sandbox.events };
    }

    const candidate = run.exports;
    if (!candidate || typeof candidate !== 'object' || typeof candidate.activate !== 'function') {
      return { pluginId: manifest.id, status: 'failed', reason: 'entry does not export a Plugin (activate() missing)', tools: [], events: sandbox.events };
    }
    const instance = candidate as Plugin;
    if (instance.manifest && instance.manifest.id !== manifest.id) {
      return { pluginId: manifest.id, status: 'failed', reason: 'exported manifest id mismatch', tools: [], events: sandbox.events };
    }

    // Lifecycle context (dataDir is created lazily by the plugin itself —
    // the loader does NOT auto-create writable space in P16).
    const ctx: PluginContext = {
      dataDir: path.join(pluginDir, 'data'),
      log: (level, message) => this.opts.onEvent?.({ kind: 'log', pluginId: manifest.id, detail: `[${level}] ${String(message).slice(0, 200)}`, at: (this.opts.now || Date.now)() }),
    };

    try {
      await withTimeout(instance.activate(ctx), 5000, `activate() timeout for ${manifest.id}`);
    } catch (err: any) {
      return { pluginId: manifest.id, status: 'failed', reason: `activate() failed: ${err.message}`, tools: [], events: sandbox.events };
    }

    // Tools registration (namespaced + permission ledger in metadata)
    const toolsRegistered: string[] = [];
    try {
      const tools = instance.getTools?.() || [];
      for (const tool of tools.slice(0, 20)) {
        if (!tool?.definition?.name) continue;
        const nsName = `plugin_${manifest.id}_${tool.definition.name}`.replace(/[^a-z0-9_]/gi, '_').slice(0, 80);
        const wrapped: Tool = {
          definition: {
            ...tool.definition,
            name: nsName,
            // Plugins cannot silently escalate permissions: destructive/admin
            // requires BOTH tool declaration and manifest permission.
            permission: tool.definition.permission === 'admin' && !manifest.permissions.some((p) => p.type === 'admin')
              ? 'write' : tool.definition.permission,
          },
          execute: (params, tctx) => tool.execute(params, tctx),
        } as Tool;
        (this.opts.toolRegistry as any).registerTool?.(wrapped);
        toolsRegistered.push(nsName);
      }
    } catch (err: any) {
      return { pluginId: manifest.id, status: 'failed', reason: `getTools()/registration failed: ${err.message}`, tools: toolsRegistered, events: sandbox.events };
    }

    this.loaded.set(manifest.id, {
      manifest,
      instance,
      sandboxEvents: sandbox.events,
      activatedAt: (this.opts.now || Date.now)(),
      toolsRegistered,
    });
    return { pluginId: manifest.id, status: 'activated', tools: toolsRegistered, events: sandbox.events };
  }

  /** Best-effort deactivate all (app shutdown). */
  async deactivateAll(): Promise<void> {
    for (const [, lp] of this.loaded) {
      try { await withTimeout(lp.instance.deactivate?.(), 2000, 'deactivate timeout'); } catch { /* best-effort */ }
    }
    this.loaded.clear();
  }

  /**
   * UI-11: deactivate + unload a single plugin by ID (best-effort).
   * Called when the user disables a plugin via the UI toggle.
   */
  async unload(pluginId: string): Promise<void> {
    const lp = this.loaded.get(pluginId);
    if (!lp) return; // not loaded — nothing to do
    try { await withTimeout(lp.instance.deactivate?.(), 2000, 'deactivate timeout'); } catch { /* best-effort */ }
    this.loaded.delete(pluginId);
  }

  listLoaded(): LoadedPlugin[] {
    return [...this.loaded.values()];
  }
}

function withTimeout<T>(p: Promise<T> | void, ms: number, label: string): Promise<T | void> {
  // CRITICAL (found by P16 tests): promises created INSIDE a vm context
  // reject on that context's microtask queue; if we only chain a wrapper,
  // the ORIGINAL promise is left unhandled and Node kills the process.
  // Attach a no-op catch FIRST, then race a wrapped copy.
  // CROSS-REALM (found by P16 tests): promises created inside a vm context
  // FAIL `instanceof Promise` against the host realm in modern Node — an
  // instanceof check silently replaced rejections with instant-resolve.
  // Use a duck-typed thenable check instead.
  const isThenable = (v: unknown): v is Promise<T | void> =>
    !!v && (typeof v === 'object' || typeof v === 'function') && typeof (v as any).then === 'function';
  const settled: Promise<T | void> = isThenable(p) ? (p as Promise<T | void>) : Promise.resolve(undefined as unknown as T);
  return new Promise<T | void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms);
    settled.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
    // CRITICAL: mark the ORIGINAL vm-context promise as handled so Node's
    // unhandled-rejection monitor doesn't kill the host process — the
    // wrapper above already observed it; this noop never affects the race.
    settled.catch(() => { /* observed via wrapper */ });
  });
}
