/**
 * NEX AI — Plugin Manifest Loader + Validator (Phase 15 / P15-A)
 *
 * Implements the scaffold's `manifest.ts` plan: parse + STRICTLY validate
 * plugin.json manifests from a candidate plugin directory.
 *
 * Security posture (critical — plugins are THIRD-PARTY code):
 *   - Manifest-only validation here: NO code execution at this stage.
 *   - id charset enforced (no traversal, no wildcards, no "..")
 *   - `main` entry must be a RELATIVE path inside the plugin dir with a
 *     safe extension (.js/.cjs only for Phase 15)
 *   - permissions must be known types with bounded scope strings
 *   - size caps everywhere (manifest ≤ 64 KB; arrays bounded)
 *   - homepage https-only; version semver-ish
 *
 * Pure validation + fs-read layer (injectable for tests).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PluginManifest, PluginPermission } from '../ai/plugin-types';

export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_TOOLS_DECLARED = 50;
export const MAX_RUNTIME_TYPES_DECLARED = 10;

const KNOWN_PERMISSION_TYPES: ReadonlySet<string> = new Set([
  'filesystem', 'network', 'terminal', 'git', 'cloud', 'system', 'admin', 'ai-inference',
]);

export type ManifestLoadResult =
  | { ok: true; manifest: PluginManifest; manifestPath: string }
  | { ok: false; reason: string };

/** Validate + parse a manifest object (structure-level, no fs). */
export function validateManifest(raw: unknown): { ok: true; manifest: PluginManifest } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'manifest must be a JSON object' };
  }
  const m = raw as Record<string, unknown>;

  if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(m.id)) {
    return { ok: false, reason: `invalid id "${String(m.id).slice(0, 40)}" (expected lowercase reverse-domain-ish, 3-128 chars, [a-z0-9._-])` };
  }
  if (m.id.includes('..')) return { ok: false, reason: 'id must not contain ".."' };

  if (typeof m.name !== 'string' || m.name.trim().length < 1 || m.name.length > 100) {
    return { ok: false, reason: 'name must be 1-100 chars' };
  }
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/i.test(m.version)) {
    return { ok: false, reason: `invalid semver version "${String(m.version).slice(0, 30)}"` };
  }
  if (typeof m.author !== 'string' || m.author.length === 0 || m.author.length > 100) {
    return { ok: false, reason: 'author required (<=100 chars)' };
  }
  if (typeof m.description !== 'string' || m.description.length > 500) {
    return { ok: false, reason: 'description required (<=500 chars)' };
  }

  if (typeof m.main !== 'string' || m.main.length === 0 || m.main.length > 200) {
    return { ok: false, reason: 'main entry required (<=200 chars)' };
  }
  if (path.isAbsolute(m.main) || m.main.includes('..') || m.main.includes('\0')) {
    return { ok: false, reason: `main must be a relative path inside the plugin directory (got "${m.main.slice(0, 60)}")` };
  }
  if (!/\.(js|cjs)$/i.test(m.main)) {
    return { ok: false, reason: `main must be a .js/.cjs entry (got "${path.extname(m.main) || '(none)'}")` };
  }

  if (!Array.isArray(m.permissions)) return { ok: false, reason: 'permissions must be an array' };
  if (m.permissions.length > 16) return { ok: false, reason: 'too many permissions (max 16)' };
  const seen = new Set<string>();
  for (const p of m.permissions) {
    if (!p || typeof p !== 'object') return { ok: false, reason: 'permission entries must be objects' };
    const perm = p as Record<string, unknown>;
    if (typeof perm.type !== 'string' || !KNOWN_PERMISSION_TYPES.has(perm.type)) {
      return { ok: false, reason: `unknown permission type "${String(perm.type).slice(0, 30)}"` };
    }
    if (typeof perm.scope !== 'string' || perm.scope.length === 0 || perm.scope.length > 200 || /[\r\n\0]/.test(perm.scope)) {
      return { ok: false, reason: `permission scope invalid for "${perm.type}"` };
    }
    if (typeof perm.reason !== 'string' || perm.reason.length === 0 || perm.reason.length > 300) {
      return { ok: false, reason: `permission reason required for "${perm.type}" (<=300 chars)` };
    }
    const key = `${perm.type}:${perm.scope}`;
    if (seen.has(key)) return { ok: false, reason: `duplicate permission ${key}` };
    seen.add(key);
  }

  const provides = (m.provides || {}) as Record<string, unknown>;
  if (typeof provides !== 'object' || Array.isArray(provides)) return { ok: false, reason: 'provides must be an object' };
  if (provides.tools !== undefined) {
    if (!Array.isArray(provides.tools) || provides.tools.length > MAX_TOOLS_DECLARED) {
      return { ok: false, reason: `provides.tools must be an array (max ${MAX_TOOLS_DECLARED})` };
    }
    for (const t of provides.tools) {
      if (typeof t !== 'string' || !/^[a-z][a-z0-9_]{1,49}$/.test(t)) {
        return { ok: false, reason: `invalid tool name declared: "${String(t).slice(0, 40)}" (snake_case, 2-50 chars)` };
      }
    }
  }
  if (provides.runtimes !== undefined) {
    if (!Array.isArray(provides.runtimes) || provides.runtimes.length > MAX_RUNTIME_TYPES_DECLARED) {
      return { ok: false, reason: 'provides.runtimes must be a bounded array' };
    }
    for (const r of provides.runtimes) {
      if (typeof r !== 'string' || !/^[a-z][a-z0-9-]{1,29}$/.test(r)) {
        return { ok: false, reason: `invalid runtime type declared: "${String(r).slice(0, 30)}"` };
      }
    }
  }
  if (provides.knowledgeDomains !== undefined && !Array.isArray(provides.knowledgeDomains)) {
    return { ok: false, reason: 'provides.knowledgeDomains must be an array' };
  }
  if (provides.uiExtensions !== undefined) {
    if (!Array.isArray(provides.uiExtensions) || provides.uiExtensions.length > 20) {
      return { ok: false, reason: 'provides.uiExtensions must be a bounded array' };
    }
  }

  const manifest: PluginManifest = {
    id: m.id,
    name: m.name.trim(),
    version: m.version,
    author: m.author,
    description: m.description,
    nexAiVersion: typeof m.nexAiVersion === 'string' ? m.nexAiVersion : undefined,
    main: m.main,
    permissions: m.permissions as PluginPermission[],
    provides: {
      tools: (provides.tools as string[]) || [],
      knowledgeDomains: (provides.knowledgeDomains as any[]) || [],
      runtimes: (provides.runtimes as any[]) || [],
      uiExtensions: (provides.uiExtensions as string[]) || [],
    },
    homepage: typeof m.homepage === 'string' && /^https:\/\//.test(m.homepage) ? m.homepage : undefined,
    license: typeof m.license === 'string' && m.license.length <= 50 ? m.license : undefined,
  };
  return { ok: true, manifest };
}

/** Read + validate a plugin.json from a directory (fs layer, injectable). */
export function loadManifestFromDir(
  pluginDir: string,
  deps: { readFileSync?: (p: string, enc?: string) => unknown; statSync?: typeof fs.statSync } = {}
): ManifestLoadResult {
  const read = (p: string, enc: string): string => {
    if (deps.readFileSync) return deps.readFileSync(p, enc as BufferEncoding) as unknown as string;
    return fs.readFileSync(p, enc as BufferEncoding) as unknown as string;
  };
  const stat = deps.statSync || ((p: string) => fs.statSync(p));
  const manifestPath = path.join(pluginDir, 'plugin.json');
  let raw: string;
  try {
    const s = stat(manifestPath);
    if (!s.isFile()) return { ok: false, reason: 'plugin.json is not a file' };
    if (s.size > MAX_MANIFEST_BYTES) return { ok: false, reason: `manifest too large (${s.size} > ${MAX_MANIFEST_BYTES})` };
    raw = read(manifestPath, 'utf-8');
  } catch {
    return { ok: false, reason: 'plugin.json not found' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'plugin.json is not valid JSON' };
  }
  const v = validateManifest(parsed);
  return v.ok ? { ok: true, manifest: v.manifest, manifestPath } : v;
}
