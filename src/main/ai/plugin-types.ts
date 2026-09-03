/**
 * NEX AI — Plugin System Types (Interface-only, Phase 34+)
 *
 * Defines interfaces for the future Plugin System, allowing third-party
 * tools, knowledge domains, and AI runtimes to be added without modifying Core.
 *
 * Planned modules (Phase 34+):
 *   plugins/loader.ts       — load plugins from <userData>/plugins/
 *   plugins/manifest.ts     — parse plugin.json manifest
 *   plugins/sandbox.ts      — run plugin code in isolated context
 *   plugins/registry.ts     — track installed plugins
 */

import type { Tool } from './tool-registry';
import type { AIRuntime, RuntimeType } from './runtime';
import type { KnowledgeBase, KnowledgeDomain } from './knowledge-types';

// ─── Plugin Manifest ─────────────────────────────────────────────────────────

export interface PluginManifest {
  /** Unique plugin ID (e.g. 'com.example.nex-plugin-foo') */
  id: string;
  /** Human-readable name */
  name: string;
  /** Semantic version (e.g. '1.0.0') */
  version: string;
  /** Author */
  author: string;
  /** Short description */
  description: string;
  /** Minimum NEX AI version required */
  nexAiVersion?: string;
  /** Plugin entry point (relative to plugin root) */
  main: string;
  /** Permissions required by the plugin */
  permissions: PluginPermission[];
  /** What this plugin provides */
  provides: PluginProvides;
  /** Plugin homepage / docs URL */
  homepage?: string;
  /** Plugin license (SPDX identifier) */
  license?: string;
}

export interface PluginPermission {
  /** Permission category */
  type: 'filesystem' | 'network' | 'terminal' | 'git' | 'cloud' | 'system' | 'admin' | 'ai-inference';
  /** Specific access scope (e.g. 'read-only', 'project-dir', 'allow-list:github.com') */
  scope: string;
  /** Why this permission is needed (shown to user) */
  reason: string;
}

export interface PluginProvides {
  /** Tools this plugin adds */
  tools?: string[];
  /** Knowledge domains this plugin adds */
  knowledgeDomains?: KnowledgeDomain[];
  /** AI runtime types this plugin adds */
  runtimes?: RuntimeType[];
  /** UI components this plugin adds (sidebar items, settings tabs, etc.) */
  uiExtensions?: string[];
}

// ─── Plugin Lifecycle ───────────────────────────────────────────────────────

export interface PluginContext {
  /** Plugin's data directory (<userData>/plugins/<id>/data) */
  dataDir: string;
  /** Logger */
  log: (level: 'info' | 'warn' | 'error', message: string, ...args: any[]) => void;
  /** Access to AI runtime (only if plugin has 'ai-inference' permission) */
  runtime?: AIRuntime;
  /** Access to knowledge base (only if plugin provides a knowledge domain) */
  knowledgeBase?: KnowledgeBase;
}

export interface Plugin {
  readonly manifest: PluginManifest;
  /** Called when the plugin is loaded */
  activate(context: PluginContext): Promise<void>;
  /** Called when the plugin is unloaded (e.g. user disables it, or app quits) */
  deactivate(): Promise<void>;
  /** List tool instances this plugin provides */
  getTools?(): Tool[];
}

// ─── Plugin Registry ────────────────────────────────────────────────────────

export interface PluginRegistryEntry {
  manifest: PluginManifest;
  /** Path to plugin directory */
  pluginDir: string;
  /** Loaded plugin instance (if active) */
  instance?: Plugin;
  /** Whether the plugin is enabled */
  enabled: boolean;
  /** When the plugin was installed */
  installedAt: number;
  /** Last loaded/activated time */
  lastActivatedAt?: number;
}

export interface PluginRegistry {
  /** Discover plugins in <userData>/plugins/ */
  discover(): Promise<PluginRegistryEntry[]>;
  /** Install a plugin from a .nex-plugin.zip file */
  install(zipPath: string): Promise<PluginRegistryEntry>;
  /** Uninstall a plugin */
  uninstall(pluginId: string): Promise<void>;
  /** Enable a disabled plugin */
  enable(pluginId: string): Promise<void>;
  /** Disable an enabled plugin */
  disable(pluginId: string): Promise<void>;
  /** Get all registered plugins */
  list(): PluginRegistryEntry[];
  /** Get a specific plugin */
  get(pluginId: string): PluginRegistryEntry | undefined;
}
