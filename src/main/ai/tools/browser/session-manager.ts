/**
 * NEX AI — Phase 10: Browser Session Manager (Playwright)
 *
 * Manages isolated Playwright browser sessions, one per agent task.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * DESIGN
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Each agent task gets its own browser context (isolated cookies, storage,
 * cache). The browser is headless by default. Sessions are reused across
 * steps of the SAME task (so a navigate → click → type → extract sequence
 * shares one page). Sessions are cleaned up when:
 *   - The task completes (success/fail/cancel)
 *   - The browser crashes (we detect + recover)
 *   - The app shuts down (before-quit hook)
 *   - A task explicitly calls browser_close
 *
 * Session isolation:
 *   - Task A's browser state NEVER leaks to Task B (separate BrowserContext)
 *   - Each session has a unique ID (UUID) — not the task ID (decoupled)
 *   - The session map is keyed by taskId, so lookups are O(1)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SECURITY
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   - URL validation: blocks private IPs, localhost, file://, non-http(s)
 *   - Browser runs in a fresh context per task (no shared cookies/storage)
 *   - Credentials/cookies are NEVER logged (redactObjectDeep applied to
 *     any session metadata before logging)
 *   - Browser content is UNTRUSTED — we never execute page-provided
 *     instructions as agent commands (prompt-injection resistance)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CRASH RECOVERY
 * ════════════════════════════════════════════════════════════════════════════
 *
 * If the browser process crashes (Playwright throws "Target closed" or
 * "Browser has been closed"), we detect it and mark the session as dead.
 * The caller (recovery engine) can retry, which creates a fresh session.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * OPT-IN
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Browser automation is OFF by default. The caller must check
 * `isBrowserEnabled()` before using any browser tool. The opt-in flag
 * is in settings (browserAutomationEnabled) and is checked at tool
 * registration time + at runtime.
 */

import { redactObjectDeep } from '../../../agent/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BrowserSession {
  /** Unique session ID (UUID) — decoupled from task ID. */
  id: string;
  /** The task that owns this session. */
  taskId: string;
  /** Playwright Browser instance. */
  browser: any;
  /** Playwright BrowserContext (isolated cookies/storage). */
  context: any;
  /** Playwright Page (the active tab). */
  page: any;
  /** Current URL (last navigated). */
  currentUrl?: string;
  /** Current page title (cached after navigation). */
  currentTitle?: string;
  /** Created timestamp. */
  createdAt: number;
  /** Last activity timestamp. */
  lastActivityAt: number;
  /** Whether the session is alive (false after crash/close). */
  alive: boolean;
}

export interface BrowserSessionInfo {
  id: string;
  taskId: string;
  currentUrl?: string;
  currentTitle?: string;
  createdAt: number;
  lastActivityAt: number;
  alive: boolean;
}

// ─── Module State ─────────────────────────────────────────────────────────────

const _sessions = new Map<string, BrowserSession>();  // keyed by taskId
const _sessionIds = new Map<string, string>();          // taskId → sessionId

let _enabled = false;
let _browserType: 'chromium' | 'firefox' | 'webkit' = 'chromium';
let _headless = true;
let _playwrightModule: any = null;

// ─── Initialization ──────────────────────────────────────────────────────────

/**
 * Configure the browser session manager. Called from main.ts at startup
 * (after initPersistence). Reads the opt-in flag from settings.
 */
export function configureBrowserSessions(opts: {
  enabled?: boolean;
  browserType?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
}): void {
  _enabled = opts.enabled ?? false;
  _browserType = opts.browserType ?? 'chromium';
  _headless = opts.headless ?? true;
}

/**
 * Update the opt-in flag at runtime (called when user toggles the setting).
 * If turning OFF, does NOT kill existing sessions (they finish gracefully).
 */
export function setBrowserEnabled(enabled: boolean): void {
  _enabled = enabled;
}

/**
 * Check if browser automation is enabled (opt-in).
 * Browser tools should check this before doing anything.
 */
export function isBrowserEnabled(): boolean {
  return _enabled;
}

/**
 * Lazily load Playwright. We do this at first use (not module load) so
 * that non-browser code paths don't pay the import cost.
 */
async function getPlaywright(): Promise<any> {
  if (_playwrightModule) return _playwrightModule;
  try {
    _playwrightModule = require('playwright');
    return _playwrightModule;
  } catch (err: any) {
    throw new Error(`Playwright not available: ${err.message}. Run 'npm install playwright' + 'npx playwright install chromium'.`);
  }
}

// ─── Session Lifecycle ──────────────────────────────────────────────────────

/**
 * Create a new browser session for a task. If the task already has a
 * session, reuses it (so navigate → click → type share one page).
 *
 * Throws if browser automation is disabled (opt-in OFF).
 */
export async function getOrCreateSession(taskId: string): Promise<BrowserSession> {
  if (!_enabled) {
    throw new Error('Browser automation is disabled. Enable it in Settings → Browser Automation (opt-in).');
  }

  // Reuse existing session if alive
  const existing = _sessions.get(taskId);
  if (existing && existing.alive) {
    existing.lastActivityAt = Date.now();
    return existing;
  }
  // Existing session is dead — clean it up + create a new one
  if (existing && !existing.alive) {
    await cleanupSession(taskId).catch(() => {});
  }

  // Create a new session
  const pw = await getPlaywright();
  const browser = await pw[_browserType].launch({ headless: _headless });
  const context = await browser.newContext({
    // Isolated context per task — no shared cookies/storage
    ignoreHTTPSErrors: false,
    javaScriptEnabled: true,
  });
  const page = await context.newPage();

  const sessionId = require('crypto').randomUUID();
  const session: BrowserSession = {
    id: sessionId,
    taskId,
    browser,
    context,
    page,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    alive: true,
  };

  _sessions.set(taskId, session);
  _sessionIds.set(taskId, sessionId);
  return session;
}

/**
 * Get an existing session for a task. Returns null if no session or
 * the session is dead.
 */
export function getSession(taskId: string): BrowserSession | null {
  const session = _sessions.get(taskId);
  if (!session || !session.alive) return null;
  session.lastActivityAt = Date.now();
  return session;
}

/**
 * Close a specific session. Safe to call even if the session is dead
 * or already closed. Used by browser_close tool + task completion.
 */
export async function closeSession(taskId: string): Promise<void> {
  const session = _sessions.get(taskId);
  if (!session) return;
  await cleanupSession(taskId);
}

/**
 * Internal: clean up a session (close browser + remove from maps).
 * Best-effort — never throws (so it can be used in finally blocks).
 */
async function cleanupSession(taskId: string): Promise<void> {
  const session = _sessions.get(taskId);
  if (!session) return;
  try {
    if (session.page && !session.page.isClosed?.()) {
      await session.page.close().catch(() => {});
    }
  } catch { /* best-effort */ }
  try {
    if (session.context) {
      await session.context.close().catch(() => {});
    }
  } catch { /* best-effort */ }
  try {
    if (session.browser && session.browser.isConnected?.()) {
      await session.browser.close().catch(() => {});
    }
  } catch { /* best-effort */ }
  session.alive = false;
  _sessions.delete(taskId);
  _sessionIds.delete(taskId);
}

/**
 * Close ALL sessions. Called on app shutdown (before-quit).
 */
export async function closeAllSessions(): Promise<void> {
  const taskIds = Array.from(_sessions.keys());
  await Promise.all(taskIds.map((id) => cleanupSession(id)));
}

/**
 * Clean up orphaned sessions (sessions whose task is no longer active).
 * Called periodically + on task completion.
 */
export async function cleanupOrphanedSessions(activeTaskIds: Set<string>): Promise<number> {
  const orphaned: string[] = [];
  for (const [taskId] of _sessions) {
    if (!activeTaskIds.has(taskId)) {
      orphaned.push(taskId);
    }
  }
  await Promise.all(orphaned.map((id) => cleanupSession(id)));
  return orphaned.length;
}

// ─── Session Info (for context + diagnostics) ───────────────────────────────

/**
 * Get safe (redacted) session info for a task. Used by context-contract
 * to populate executionMetadata with current URL/title.
 *
 * Redaction: the URL may contain query params with tokens — redactObjectDeep
 * strips them. Title is generally safe but we redact anyway for consistency.
 */
export function getSessionInfo(taskId: string): BrowserSessionInfo | null {
  const session = _sessions.get(taskId);
  if (!session) return null;
  const info: BrowserSessionInfo = {
    id: session.id,
    taskId: session.taskId,
    currentUrl: session.currentUrl,
    currentTitle: session.currentTitle,
    createdAt: session.createdAt,
    lastActivityAt: session.lastActivityAt,
    alive: session.alive,
  };
  return redactObjectDeep(info) as BrowserSessionInfo;
}

/**
 * Update session state after a navigation/action. Called by browser tools
 * to keep the cached URL/title in sync.
 */
export function updateSessionState(taskId: string, update: { url?: string; title?: string }): void {
  const session = _sessions.get(taskId);
  if (!session) return;
  if (update.url !== undefined) session.currentUrl = update.url;
  if (update.title !== undefined) session.currentTitle = update.title;
  session.lastActivityAt = Date.now();
}

/**
 * Mark a session as dead (after a crash). The next getOrCreateSession
 * call will create a fresh session.
 */
export function markSessionDead(taskId: string): void {
  const session = _sessions.get(taskId);
  if (session) {
    session.alive = false;
  }
}

// ─── URL Validation ─────────────────────────────────────────────────────────

/**
 * Validate a URL before navigation. Blocks:
 *   - private IPs (127.0.0.1, 10.x, 192.168.x, 172.16-31.x, localhost)
 *   - non-http(s) schemes (file://, ftp://, data:, javascript:)
 *   - loopback addresses
 *
 * This is a defense-in-depth layer. Even if a user enables browser
 * automation, we never allow navigation to local resources (which
 * could bypass the filesystem permission gate via file:// URLs).
 */
export function isUrlBlocked(url: string): { blocked: boolean; reason?: string } {
  if (!url || typeof url !== 'string') {
    return { blocked: true, reason: 'Invalid URL' };
  }
  const lower = url.toLowerCase().trim();

  // Scheme check — only http/https allowed
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
    return { blocked: true, reason: `Only http/https schemes allowed (got: ${lower.split(':')[0]}://)` };
  }

  // Private IP / localhost patterns
  if (lower.includes('localhost') || lower.includes('127.0.0.1') || lower.includes('0.0.0.0')) {
    return { blocked: true, reason: 'Blocked: localhost/loopback' };
  }
  if (lower.includes('192.168.') || lower.includes('10.') || lower.includes('172.16.')) {
    return { blocked: true, reason: 'Blocked: private IP range' };
  }
  // More thorough private IP check: 172.16.0.0 - 172.31.255.255
  const ipMatch = lower.match(/:\/\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
  if (ipMatch) {
    const ip = ipMatch[1];
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return { blocked: true, reason: 'Blocked: private IP 10.x' };
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return { blocked: true, reason: 'Blocked: private IP 172.16-31.x' };
    if (parts[0] === 192 && parts[1] === 168) return { blocked: true, reason: 'Blocked: private IP 192.168.x' };
    if (parts[0] === 127) return { blocked: true, reason: 'Blocked: loopback 127.x' };
  }

  return { blocked: false };
}

// ─── Crash Detection ─────────────────────────────────────────────────────────

/**
 * Check if an error indicates the browser crashed. Playwright throws
 * errors with these messages when the browser process dies or the page
 * becomes unresponsive.
 */
export function isBrowserCrashError(err: any): boolean {
  if (!err || !err.message) return false;
  const msg = String(err.message).toLowerCase();
  return (
    msg.includes('target closed') ||
    msg.includes('browser has been closed') ||
    msg.includes('page has been closed') ||
    msg.includes('context has been closed') ||
    msg.includes('protocol error') ||
    msg.includes('targetcrashed') ||
    msg.includes('navigation failed because the cr')

  );
}

// ─── Statistics (for diagnostics + tests) ────────────────────────────────────

export function getSessionCount(): number {
  return _sessions.size;
}

export function getActiveSessionTaskIds(): string[] {
  const result: string[] = [];
  for (const [taskId, session] of _sessions) {
    if (session.alive) result.push(taskId);
  }
  return result;
}
