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
 *
 * Phase 115: On Windows, the filesystem is case-insensitive. We normalize
 * both paths to lowercase before comparison to avoid spurious "Access denied"
 * errors when the agent uses a different case than the root (e.g. the user
 * opened `C:\Users\Foo\project` but the agent writes to `c:\users\foo\project`).
 */
export function isPathInside(target: string, root: string): boolean {
  const t = path.resolve(target);
  const r = path.resolve(root);
  // Phase 115: Case-insensitive comparison on Windows
  const compareT = process.platform === 'win32' ? t.toLowerCase() : t;
  const compareR = process.platform === 'win32' ? r.toLowerCase() : r;
  if (compareT === compareR) return true;
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
  // Block sensitive system paths (defense-in-depth, even if inside a root)
  const blocked = isSensitivePath(resolved);
  if (blocked) {
    return { ok: false, reason: `Blocked sensitive path: ${blocked}` };
  }
  for (const root of roots) {
    if (!root) continue;
    if (isPathInside(resolved, root)) {
      return { ok: true, resolved };
    }
  }
  return { ok: false, reason: 'Path outside allowed roots', resolved };
}

/**
 * Check if a path is a sensitive system path that should NEVER be accessed
 * by the agent, regardless of workspace roots. Returns the reason if blocked,
 * or null if the path is safe.
 *
 * Blocks:
 *   Windows: C:\Windows, C:\System32, user .ssh, AppData\Roaming\nex-ai\secrets
 *   Linux/macOS: /etc, /var, /usr, ~/.ssh, ~/.config, ~/.gnupg
 */
export function isSensitivePath(target: string): string | null {
  const resolved = path.resolve(target).toLowerCase();
  const home = (require('os').homedir() as string).toLowerCase();

  // Cross-platform: block .ssh, .gnupg, .config
  if (resolved.includes(path.join(home, '.ssh').toLowerCase())) return '.ssh directory';
  if (resolved.includes(path.join(home, '.gnupg').toLowerCase())) return '.gnupg directory';

  if (process.platform === 'win32') {
    // Block Windows system directories
    if (resolved.includes('\\windows\\system32\\') && !resolved.includes('\\system32\\temp')) return 'System32';
    if (resolved.includes('\\windows\\system32\\config\\')) return 'System32 config';
    if (resolved.match(/^[a-z]:\\windows\\/i)) return 'Windows directory';
    // Block AppData secrets
    if (resolved.includes('\\appdata\\roaming\\nex-ai\\secrets')) return 'secrets.json';
    if (resolved.includes('\\appdata\\roaming\\nex-ai\\config.json')) return 'config.json';
  } else {
    // Linux/macOS system directories
    if (resolved.startsWith('/etc/')) return '/etc';
    if (resolved.startsWith('/var/')) return '/var';
    if (resolved.startsWith('/usr/') && !resolved.startsWith('/usr/local/')) return '/usr';
    if (resolved.startsWith('/boot/')) return '/boot';
    if (resolved.startsWith('/root/')) return '/root';
    // Block .config (may contain credentials)
    if (resolved.includes(path.join(home, '.config').toLowerCase())) return '.config directory';
  }

  return null;
}

// ─── Safe Content Sanitization (for AI chat output) ─────────────────────────
//
// NOTE: HTML sanitization is done in the RENDERER (src/renderer/lib/sanitize.ts)
// because it relies on DOMParser / DOM APIs that only exist in the browser.
// The main process never injects HTML anywhere — it only returns text.

// ─── Phase 115: Windows Atomic Rename Helper ─────────────────────────────────

/**
 * Retry an atomic rename operation on Windows when it fails with EPERM.
 *
 * Windows Defender, the Search Indexer, and other file-system filters can
 * briefly lock a file (10-100ms) causing `fs.renameSync(tmp, target)` to
 * fail with EPERM even though the operation is valid. This is a known
 * Node.js issue on Windows (nodejs/node#19077).
 *
 * This helper retries up to 3 times with 50ms backoff. On non-Windows
 * platforms, it's a direct passthrough (no retry needed).
 *
 * Usage:
 *   await retryOnEperm(() => { fs.renameSync(tmpPath, finalPath); });
 */
export async function retryOnEperm<T>(fn: () => T, retries = 3, delayMs = 50): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return fn();
    } catch (err: any) {
      lastErr = err;
      // Only retry on EPERM/EBUSY/EACCES on Windows
      const isWindowsLock = process.platform === 'win32' &&
        (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES');
      if (!isWindowsLock || attempt === retries) {
        throw err;
      }
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}

/**
 * Synchronous version of retryOnEperm for use in sync code paths.
 * Uses a busy-wait (acceptable for the short 50-150ms retry window).
 */
export function retryOnEpermSync<T>(fn: () => T, retries = 3, delayMs = 50): T {
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return fn();
    } catch (err: any) {
      lastErr = err;
      const isWindowsLock = process.platform === 'win32' &&
        (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES');
      if (!isWindowsLock || attempt === retries) {
        throw err;
      }
      // Busy-wait (short, acceptable for sync path)
      const start = Date.now();
      while (Date.now() - start < delayMs * (attempt + 1)) { /* spin */ }
    }
  }
  throw lastErr;
}

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
  // Phase 8/37: connect-src must include all allowed AI origins + Vite dev HMR
  "connect-src 'self' ws://localhost:5173 http://localhost:5173 https://api.openai.com https://api.anthropic.com https://api.z.ai https://open.bigmodel.cn",
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
  // Phase 8 / P8-A: GLM 5.3 (Z.ai international + BigModel CN)
  'https://api.z.ai',
  'https://open.bigmodel.cn',
]);

export function isAllowedAIOrigin(url: string): boolean {
  try {
    const u = new URL(url);
    return ALLOWED_AI_ORIGINS.has(`${u.protocol}//${u.host}`);
  } catch {
    return false;
  }
}
