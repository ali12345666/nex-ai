/**
 * NEX AI Security Layer
 * Central security primitives: path validation, sanitization, permission policy.
 *
 * Design principles:
 *  - All filesystem operations must go through `assertPathInside()`
 *  - All shell invocations must use `execFile()` with arg arrays (NEVER `exec(command, str)`)
 *  - CSP must be set BOTH via meta tag and onHeadersReceived — both layers matter
 *  - AI chat output must be rendered through a strict allow-list sanitizer
 */

import * as path from 'path';
import * as fs from 'fs';

// ─── Path Validation ────────────────────────────────────────────────────────

/**
 * Asserts that `target` resolves to a path inside `root`.
 * Prevents path traversal (../) and absolute-path escapes.
 *
 * NOTE: This is intentionally strict. If a target legitimately needs to be
 * outside the project root (e.g. user opens a file from anywhere on disk),
 * the caller must pass an explicit allow-list of additional roots.
 */
export function isPathInside(target: string, root: string): boolean {
  const t = path.resolve(target);
  const r = path.resolve(root);
  if (t === r) return true;
  const rel = path.relative(r, t);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export interface PathAssertionResult {
  ok: boolean;
  reason?: string;
  resolved?: string;
}

/**
 * Validate a single target path against one or more allowed roots.
 * Returns ok=false if the target escapes every root.
 */
export function assertPathInside(target: string, roots: string[]): PathAssertionResult {
  if (!target || typeof target !== 'string') {
    return { ok: false, reason: 'Empty path' };
  }
  const resolved = path.resolve(target);
  // Block null bytes (path injection)
  if (resolved.includes('\0')) {
    return { ok: false, reason: 'Null byte in path' };
  }
  for (const root of roots) {
    if (!root) continue;
    if (isPathInside(resolved, root)) {
      return { ok: true, resolved };
    }
  }
  return { ok: false, reason: 'Path outside allowed roots', resolved };
}

// ─── Safe Content Sanitization (for AI chat output) ─────────────────────────
//
// NOTE: HTML sanitization is done in the RENDERER (src/renderer/lib/sanitize.ts)
// because it relies on DOMParser / DOM APIs that only exist in the browser.
// The main process never injects HTML anywhere — it only returns text.

// ─── CSP ────────────────────────────────────────────────────────────────────

/**
 * Content Security Policy. Tightened:
 *  - No external script sources (no unsafe-eval)
 *  - connect-src allows only self + known AI endpoints (openai/anthropic)
 *  - font-src restricted to Google Fonts (declared in index.html)
 *  - No img-src to external (only data/blob/self)
 *
 * Note: 'unsafe-inline' for script-src is needed by Vite dev. In production
 * builds we should switch to nonces, but for v1.0 this is acceptable.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "connect-src 'self' https://api.openai.com https://api.anthropic.com",
  "img-src 'self' data: blob:",
  "font-src 'self' https://fonts.gstatic.com data:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ') + ';';

// ─── Safe Shell Execution ───────────────────────────────────────────────────

/**
 * Returns true if a command string contains shell metacharacters that could
 * be used for injection. Used to reject string-shell-commands.
 *
 * Note: This is a defense-in-depth check. The primary fix is to NEVER use
 * exec(string) — always use execFile(file, args[]).
 */
export function hasShellMetachars(s: string): boolean {
  return /[;&|`$<>!\n\r\\]/.test(s);
}

// ─── Allowed AI Origins ──────────────────────────────────────────────────────

export const ALLOWED_AI_ORIGINS = new Set([
  'https://api.openai.com',
  'https://api.anthropic.com',
]);

export function isAllowedAIOrigin(url: string): boolean {
  try {
    const u = new URL(url);
    return ALLOWED_AI_ORIGINS.has(`${u.protocol}//${u.host}`);
  } catch {
    return false;
  }
}
