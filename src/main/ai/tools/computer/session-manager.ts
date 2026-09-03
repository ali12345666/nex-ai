/**
 * NEX AI — Phase 11: Computer Session Manager
 *
 * Manages isolated computer control sessions (mouse/keyboard/screen) per task.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * DESIGN
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Computer control is more dangerous than browser automation — it can control
 * ANY application, type passwords, delete files via dialogs, etc. So:
 *
 *   - Opt-in OFF by default (computerControlEnabled in settings)
 *   - Per-task session isolation (no shared mouse/keyboard state)
 *   - Coordinate bounds checking (reject out-of-screen clicks)
 *   - System window blocking (allow-list enforcement in main/tool layer)
 *   - Crash detection + recovery (markSessionDead)
 *   - Cleanup on cancellation/crash/shutdown
 *
 * Sessions are lightweight — we don't open a separate process. We just track
 * per-task state (current coordinates, last screenshot, window focus) so two
 * tasks don't interfere. The actual mouse/keyboard/screen calls go through
 * @nut-tree-fork/nut-js (lazy-loaded).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SECURITY
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   - Coordinate validation (reject negative + out-of-screen x/y)
 *   - System window blocking (allow-list of safe window classes)
 *   - Screenshots are memory-only (NEVER written to disk)
 *   - Typed text is NOT stored (only charCount in ToolResult)
 *   - Every action requires 'computer' permission → executeToolWithPermission
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CRASH RECOVERY
 * ════════════════════════════════════════════════════════════════════════════
 *
 * If nut-js throws (native module crash, X11/Wayland issues), we detect it
 * and mark the session as dead. The caller (recovery engine) can retry with
 * a fresh session.
 */

import { redactObjectDeep } from '../../../agent/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ComputerSession {
  /** Unique session ID (UUID) — decoupled from task ID. */
  id: string;
  /** The task that owns this session. */
  taskId: string;
  /** Last known mouse position (x, y). */
  lastMouseX?: number;
  lastMouseY?: number;
  /** Last screenshot timestamp (for rate-limiting). */
  lastScreenshotAt?: number;
  /** Created timestamp. */
  createdAt: number;
  /** Last activity timestamp. */
  lastActivityAt: number;
  /** Whether the session is alive (false after crash/close). */
  alive: boolean;
}

export interface ComputerSessionInfo {
  id: string;
  taskId: string;
  lastMouseX?: number;
  lastMouseY?: number;
  lastScreenshotAt?: number;
  createdAt: number;
  lastActivityAt: number;
  alive: boolean;
}

export interface ScreenDimensions {
  width: number;
  height: number;
}

// ─── Module State ─────────────────────────────────────────────────────────────

const _sessions = new Map<string, ComputerSession>();  // keyed by taskId

let _enabled = false;
let _confirmationPolicy: 'per-action' | 'session-wide' = 'per-action';
let _nutModule: any = null;
let _systemWindowBlocklist: Set<string> = new Set([
  // Default blocklist — system/security windows that should NEVER be controlled
  // Uses case-insensitive substring match against window titles.
  'task manager',     // Windows Task Manager
  'taskmgr',           // Task Manager process name
  'registry editor',   // Windows Registry Editor
  'regedit',           // Registry Editor process name
  'command prompt',    // cmd window title
  'cmd.exe',           // cmd process name
  'powershell',        // PowerShell window
  'credential',        // Credential Manager / password dialogs
  'windows security', // Windows Security dialogs
  'user account control', // UAC prompts
  'logon',             // Logon screens
  'lock screen',       // Lock screen
  'security center',   // Security Center
  'windows defender', // Windows Defender
  'firewall',          // Firewall settings
]);

// ─── Initialization ──────────────────────────────────────────────────────────

/**
 * Configure the computer session manager. Called from main.ts at startup
 * (after initPersistence). Reads the opt-in flag from settings.
 */
export function configureComputerSessions(opts: {
  enabled?: boolean;
  confirmationPolicy?: 'per-action' | 'session-wide';
  systemWindowBlocklist?: string[];
}): void {
  _enabled = opts.enabled ?? false;
  _confirmationPolicy = opts.confirmationPolicy ?? 'per-action';
  if (opts.systemWindowBlocklist) {
    _systemWindowBlocklist = new Set(opts.systemWindowBlocklist.map(s => s.toLowerCase()));
  }
}

/**
 * Update the opt-in flag at runtime (called when user toggles the setting).
 * If turning OFF, does NOT kill existing sessions (they finish gracefully).
 */
export function setComputerEnabled(enabled: boolean): void {
  _enabled = enabled;
}

/**
 * Update the confirmation policy at runtime.
 */
export function setConfirmationPolicy(policy: 'per-action' | 'session-wide'): void {
  _confirmationPolicy = policy;
}

/**
 * Check if computer control is enabled (opt-in).
 * Computer tools should check this before doing anything.
 */
export function isComputerEnabled(): boolean {
  return _enabled;
}

/**
 * Get the current confirmation policy.
 */
export function getConfirmationPolicy(): 'per-action' | 'session-wide' {
  return _confirmationPolicy;
}

/**
 * Check if a window title/process should be blocked (system/security window).
 * Case-insensitive substring match against the blocklist.
 */
export function isSystemWindowBlocked(windowTitle: string): boolean {
  const lower = windowTitle.toLowerCase();
  for (const blocked of _systemWindowBlocklist) {
    if (lower.includes(blocked)) return true;
  }
  return false;
}

/**
 * Add a window class to the blocklist (for user-configurable allow-list).
 */
export function addToBlocklist(windowClass: string): void {
  _systemWindowBlocklist.add(windowClass.toLowerCase());
}

/**
 * Remove a window class from the blocklist.
 */
export function removeFromBlocklist(windowClass: string): void {
  _systemWindowBlocklist.delete(windowClass.toLowerCase());
}

/**
 * Get the current blocklist (for settings UI).
 */
export function getBlocklist(): string[] {
  return Array.from(_systemWindowBlocklist);
}

/**
 * Lazily load @nut-tree-fork/nut-js. We do this at first use (not module
 * load) so that non-computer code paths don't pay the import cost.
 */
async function getNutJs(): Promise<any> {
  if (_nutModule) return _nutModule;
  try {
    _nutModule = require('@nut-tree-fork/nut-js');
    return _nutModule;
  } catch (err: any) {
    throw new Error(`@nut-tree-fork/nut-js not available: ${err.message}. Run 'npm install @nut-tree-fork/nut-js'.`);
  }
}

// ─── Session Lifecycle ──────────────────────────────────────────────────────

/**
 * Create a new computer session for a task. If the task already has a
 * session, reuses it (so screenshot → click → type share one session).
 *
 * Throws if computer control is disabled (opt-in OFF).
 */
export async function getOrCreateSession(taskId: string): Promise<ComputerSession> {
  if (!_enabled) {
    throw new Error('Computer control is disabled. Enable it in Settings → Computer Control (opt-in).');
  }

  // Reuse existing session if alive
  const existing = _sessions.get(taskId);
  if (existing && existing.alive) {
    existing.lastActivityAt = Date.now();
    return existing;
  }
  // Existing session is dead — clean it up + create a new one
  if (existing && !existing.alive) {
    _sessions.delete(taskId);
  }

  const sessionId = require('crypto').randomUUID();
  const session: ComputerSession = {
    id: sessionId,
    taskId,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    alive: true,
  };

  _sessions.set(taskId, session);
  return session;
}

/**
 * Get an existing session for a task. Returns null if no session or dead.
 */
export function getSession(taskId: string): ComputerSession | null {
  const session = _sessions.get(taskId);
  if (!session || !session.alive) return null;
  session.lastActivityAt = Date.now();
  return session;
}

/**
 * Close a specific session. Safe to call even if dead or already closed.
 */
export async function closeSession(taskId: string): Promise<void> {
  const session = _sessions.get(taskId);
  if (!session) return;
  session.alive = false;
  _sessions.delete(taskId);
}

/**
 * Close ALL sessions. Called on app shutdown (before-quit).
 */
export async function closeAllSessions(): Promise<void> {
  const taskIds = Array.from(_sessions.keys());
  for (const taskId of taskIds) {
    const session = _sessions.get(taskId);
    if (session) session.alive = false;
  }
  _sessions.clear();
}

/**
 * Clean up orphaned sessions (sessions whose task is no longer active).
 */
export async function cleanupOrphanedSessions(activeTaskIds: Set<string>): Promise<number> {
  const orphaned: string[] = [];
  for (const [taskId] of _sessions) {
    if (!activeTaskIds.has(taskId)) {
      orphaned.push(taskId);
    }
  }
  for (const id of orphaned) {
    const session = _sessions.get(id);
    if (session) session.alive = false;
    _sessions.delete(id);
  }
  return orphaned.length;
}

// ─── Session Info (for context + diagnostics) ───────────────────────────────

/**
 * Get safe (redacted) session info for a task. Used by context-contract
 * to populate executionMetadata with current mouse position.
 */
export function getSessionInfo(taskId: string): ComputerSessionInfo | null {
  const session = _sessions.get(taskId);
  if (!session) return null;
  const info: ComputerSessionInfo = {
    id: session.id,
    taskId: session.taskId,
    lastMouseX: session.lastMouseX,
    lastMouseY: session.lastMouseY,
    lastScreenshotAt: session.lastScreenshotAt,
    createdAt: session.createdAt,
    lastActivityAt: session.lastActivityAt,
    alive: session.alive,
  };
  return redactObjectDeep(info) as ComputerSessionInfo;
}

/**
 * Update session state after a mouse/screenshot action.
 */
export function updateSessionState(taskId: string, update: { mouseX?: number; mouseY?: number; screenshotAt?: number }): void {
  const session = _sessions.get(taskId);
  if (!session) return;
  if (update.mouseX !== undefined) session.lastMouseX = update.mouseX;
  if (update.mouseY !== undefined) session.lastMouseY = update.mouseY;
  if (update.screenshotAt !== undefined) session.lastScreenshotAt = update.screenshotAt;
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

// ─── Coordinate Validation ─────────────────────────────────────────────────

/**
 * Validate coordinates against screen dimensions.
 * Rejects negative + out-of-bounds x/y.
 *
 * Screen dimensions are obtained from nut-js screen.width/height (or
 * desktopCapturer on Electron). Falls back to conservative 1920x1080 if
 * unavailable.
 */
export function validateCoordinates(x: number, y: number, dims?: ScreenDimensions): { ok: boolean; reason?: string } {
  if (typeof x !== 'number' || typeof y !== 'number' || isNaN(x) || isNaN(y)) {
    return { ok: false, reason: 'Coordinates must be finite numbers' };
  }
  if (x < 0 || y < 0) {
    return { ok: false, reason: `Coordinates must be non-negative (got x=${x}, y=${y})` };
  }
  if (dims) {
    if (x >= dims.width || y >= dims.height) {
      return { ok: false, reason: `Coordinates out of bounds (got x=${x}, y=${y}; screen ${dims.width}x${dims.height})` };
    }
  }
  return { ok: true };
}

/**
 * Get screen dimensions via nut-js. Caches the result (screen size doesn't
 * change during a session unless the user changes display settings).
 */
let _cachedDims: ScreenDimensions | null = null;
export async function getScreenDimensions(): Promise<ScreenDimensions> {
  if (_cachedDims) return _cachedDims;
  try {
    const nut = await getNutJs();
    const width = await nut.screen.width();
    const height = await nut.screen.height();
    _cachedDims = { width, height };
    return _cachedDims;
  } catch {
    // Fallback: conservative 1920x1080
    _cachedDims = { width: 1920, height: 1080 };
    return _cachedDims;
  }
}

// ─── Hotkey Validation ─────────────────────────────────────────────────────

/**
 * Validate a hotkey string (e.g. "Ctrl+C", "Alt+Tab").
 * Rejects invalid key combinations to prevent arbitrary input.
 *
 * Allowed modifiers: Ctrl, Alt, Shift, Cmd/Meta/Super
 * Allowed keys: A-Z, 0-9, F1-F12, Enter, Tab, Escape, Space, arrows,
 *               Backspace, Delete, Home, End, PageUp, PageDown
 */
const ALLOWED_MODIFIERS = ['ctrl', 'alt', 'shift', 'cmd', 'meta', 'super'];
const ALLOWED_KEYS = new Set([
  // Letters
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  // Numbers
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  // Function keys
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
  // Special keys
  'enter', 'return', 'tab', 'escape', 'esc', 'space', 'backspace', 'delete',
  'home', 'end', 'pageup', 'pagedown', 'up', 'down', 'left', 'right',
  'insert',
]);

export function validateHotkey(hotkey: string): { ok: boolean; reason?: string } {
  if (!hotkey || typeof hotkey !== 'string') {
    return { ok: false, reason: 'Hotkey must be a non-empty string' };
  }
  const parts = hotkey.toLowerCase().split('+').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { ok: false, reason: 'Hotkey must have at least one key' };
  }
  // Last part is the key; preceding parts are modifiers
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  // Validate key
  if (!ALLOWED_KEYS.has(key)) {
    return { ok: false, reason: `Hotkey key "${key}" is not in the allowed list` };
  }
  // Validate modifiers
  for (const mod of modifiers) {
    if (!ALLOWED_MODIFIERS.includes(mod)) {
      return { ok: false, reason: `Hotkey modifier "${mod}" is not allowed (use: Ctrl, Alt, Shift, Cmd)` };
    }
  }
  return { ok: true };
}

// ─── Crash Detection ─────────────────────────────────────────────────────────

/**
 * Check if an error indicates the nut-js native module crashed or is
 * unavailable (X11 libraries missing, native binary load failure, etc.).
 */
export function isComputerCrashError(err: any): boolean {
  if (!err || !err.message) return false;
  const msg = String(err.message).toLowerCase();
  return (
    msg.includes('libnut') ||
    msg.includes('nut-js') ||
    msg.includes('native module') ||
    msg.includes('cannot find module') ||
    msg.includes('libxtst') ||
    msg.includes('libx11') ||
    msg.includes('libxdo') ||
    msg.includes('.node') ||
    msg.includes('segfault') ||
    msg.includes('abort') ||
    msg.includes('the module was compiled against a different node.js version')
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
