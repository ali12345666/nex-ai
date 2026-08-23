/**
 * NEX AI — Plugin Registry (Phase 15 / P15-B)
 *
 * Implements the scaffold's `registry.ts`: discovery of plugin folders
 * under <userData>/plugins/, manifest validation (P15-A), enable/disable
 * persistence (state.json beside plugins), list/get — WITHOUT activating
 * any plugin code in this phase (activation/loader/sandbox = later phase;
 * this phase ships the trusted bookkeeping layer only).
 *
 * Security:
 *   - discovery NEVER requires/evaluates plugin code
 *   - plugin dirs with invalid manifests are recorded as invalid with the
 *     reason (surface for the UI), never loaded
 *   - state.json writes are atomic (temp+rename) and validated on read
 *     (prototype-pollution safe merge)
 *   - id-keyed maps only; traversal-shaped ids rejected upstream (manifest)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PluginRegistry, PluginRegistryEntry } from '../ai/plugin-types';
import { loadManifestFromDir } from './manifest';

interface RegistryState {
  enabled: Record<string, boolean>;
  installedAt: Record<string, number>;
}

const STATE_VERSION = 1;

export interface DiscoveredPlugin {
  entry?: PluginRegistryEntry;
  valid: boolean;
  dir: string;
  reason?: string;
}

export class LocalPluginRegistry implements PluginRegistry {
  private readonly pluginsDir: string;
  private state: RegistryState = { enabled: {}, installedAt: {} };
  private entries = new Map<string, PluginRegistryEntry>();
  private invalid: DiscoveredPlugin[] = [];

  constructor(userDataDir: string) {
    this.pluginsDir = path.join(userDataDir, 'plugins');
    this.loadState();
  }

  private statePath(): string {
    return path.join(this.pluginsDir, 'registry-state.json');
  }

  private loadState(): void {
    try {
      const raw = fs.readFileSync(this.statePath(), 'utf-8');
      const parsed = JSON.parse(raw);
      // strict-shape read: only expected keys with expected types (no merge
      // of unknown fields — prototype-pollution safe)
      const enabled: Record<string, boolean> = {};
      if (parsed && typeof parsed.enabled === 'object' && !Array.isArray(parsed.enabled)) {
        for (const [k, v] of Object.entries(parsed.enabled)) {
          if (typeof k === 'string' && k.length <= 128 && typeof v === 'boolean') enabled[k] = v;
        }
      }
      const installedAt: Record<string, number> = {};
      if (parsed && typeof parsed.installedAt === 'object' && !Array.isArray(parsed.installedAt)) {
        for (const [k, v] of Object.entries(parsed.installedAt)) {
          if (typeof k === 'string' && k.length <= 128 && typeof v === 'number' && Number.isFinite(v)) installedAt[k] = v;
        }
      }
      this.state = { enabled, installedAt };
    } catch {
      this.state = { enabled: {}, installedAt: {} };
    }
  }

  private saveState(): void {
    try {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
      const payload = JSON.stringify({ version: STATE_VERSION, ...this.state }, null, 2);
      const tmp = `${this.statePath()}.tmp-${Date.now()}`;
      fs.writeFileSync(tmp, payload, 'utf-8');
      fs.renameSync(tmp, this.statePath());
    } catch {
      // registry persistence is best-effort; discovery still works
    }
  }

  /** Scan the plugins dir; returns ALL discoveries (valid + invalid w/ reason). */
  async discover(): Promise<PluginRegistryEntry[]> {
    this.entries.clear();
    this.invalid = [];
    let dirs: string[] = [];
    try {
      dirs = fs
        .readdirSync(this.pluginsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
        .map((d) => path.join(this.pluginsDir, d.name));
    } catch {
      return []; // no plugins dir yet
    }

    for (const dir of dirs.slice(0, 200)) { // hard cap on scan
      const res = loadManifestFromDir(dir);
      if (!res.ok) {
        this.invalid.push({ valid: false, dir, reason: res.reason });
        continue;
      }
      const id = res.manifest.id;
      if (this.entries.has(id)) {
        this.invalid.push({ valid: false, dir, reason: `duplicate plugin id "${id}"` });
        continue;
      }
      const entry: PluginRegistryEntry = {
        manifest: res.manifest,
        pluginDir: dir,
        enabled: this.state.enabled[id] ?? true, // default enabled (activation comes later)
        installedAt: this.state.installedAt[id] ?? Date.now(),
      };
      this.entries.set(id, entry);
      this.state.installedAt[id] = entry.installedAt;
    }
    this.saveState();
    return [...this.entries.values()];
  }

  /** Invalid discoveries (for UI diagnostics). */
  invalidDiscoveries(): DiscoveredPlugin[] {
    return [...this.invalid];
  }

  async install(zipPath: string): Promise<PluginRegistryEntry> {
    // Zip installation is deliberately NOT implemented in Phase 15 (loader/
    // sandbox phase decides the safe extraction story). Explicit refusal:
    throw new Error('Plugin .zip installation arrives with the plugin loader phase (Phase 15 ships discovery/validation/enable-state only). Place the plugin folder under <userData>/plugins/ manually.');
    void zipPath;
  }

  async uninstall(pluginId: string): Promise<void> {
    const entry = this.entries.get(pluginId);
    if (!entry) throw new Error(`Unknown plugin: ${pluginId}`);
    // Bookkeeping removal only — folder deletion is a UI/user action in this
    // phase (destructive ops need explicit user confirmation elsewhere).
    this.entries.delete(pluginId);
    delete this.state.enabled[pluginId];
    delete this.state.installedAt[pluginId];
    this.saveState();
  }

  async enable(pluginId: string): Promise<void> {
    if (!this.entries.has(pluginId)) throw new Error(`Unknown plugin: ${pluginId}`);
    this.state.enabled[pluginId] = true;
    this.entries.get(pluginId)!.enabled = true;
    this.saveState();
  }

  async disable(pluginId: string): Promise<void> {
    if (!this.entries.has(pluginId)) throw new Error(`Unknown plugin: ${pluginId}`);
    this.state.enabled[pluginId] = false;
    this.entries.get(pluginId)!.enabled = false;
    this.saveState();
  }

  list(): PluginRegistryEntry[] {
    return [...this.entries.values()];
  }

  get(pluginId: string): PluginRegistryEntry | undefined {
    return this.entries.get(pluginId);
  }
}
