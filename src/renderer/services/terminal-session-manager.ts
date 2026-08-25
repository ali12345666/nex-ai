/**
 * NEX AI — Terminal Session Manager (Singleton, outside React)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  AppShell's `renderView` switch returns a DIFFERENT component type per nav
 *  view (chat / workspace / memory / knowledge / settings). When the user
 *  navigates between views, React's reconciler sees a different element type
 *  and UNMOUNTS the entire WorkspacePanel subtree — including
 *  TerminalSessionPanel.
 *
 *  Previously, TerminalSessionPanel's cleanup ran on unmount:
 *    - xterm.dispose()         ← scrollback + renderer state GONE
 *    - terminalSessionKill()   ← PowerShell process KILLED
 *
 *  So every time the user switched Chat → Workspace → Chat, they lost their
 *  terminal session. This is the root cause of "terminal resets on tab switch".
 *
 *  FIX (architectural): separate the terminal RUNTIME from the UI component.
 *
 *    - The TerminalSessionManager (this file) is a singleton that lives for
 *      the entire app lifetime. It owns:
 *        * the xterm.Terminal instance (with its scrollback buffer)
 *        * the FitAddon
 *        * the PTY session ID (the PowerShell process)
 *        * the IPC output/exit listeners
 *
 *    - The UI component (TerminalSessionPanel) is now a THIN VIEW: on mount it
 *      asks the manager for the session, calls `term.open(container)` to
 *      attach the renderer to the current DOM container, and registers a
 *      ResizeObserver. On unmount it calls `detachFromContainer()` — the
 *      xterm instance and PTY process are NOT destroyed, only detached.
 *
 *    - When the component re-mounts (user navigates back), it re-attaches
 *      to the SAME session — scrollback is intact, same PowerShell process,
 *      no reset.
 *
 *  This mirrors how VS Code's integrated terminal works: the terminal
 *  process is owned by the extension host (survives panel hide/show), only
 *  the DOM renderer is attached/detached.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LIFECYCLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  App boot:
 *    manager.ensureSession(cwd)         ← lazy: spawns PTY on first call
 *
 *  TerminalSessionPanel mount:
 *    const session = manager.getOrCreateSession(cwd)
 *    session.attachToContainer(containerEl)   ← term.open(container)
 *
 *  TerminalSessionPanel unmount (tab switch / nav away):
 *    session.detachFromContainer()       ← xterm detached, NOT disposed
 *
 *  TerminalSessionPanel remount (back to terminal):
 *    session.attachToContainer(newContainer) ← re-attach, scrollback intact
 *
 *  App quit:
 *    manager.disposeAll()               ← kill PTY, dispose xterm
 *
 * ════════════════════════════════════════════════════════════════════════════
 * MULTI-SESSION (future)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  The manager stores sessions in a Map<sessionId, ManagedTerminalSession>.
 *  Currently only ONE session ("default") is used, but the architecture
 *  supports N terminals in the future (split terminals, multiple tabs).
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

/** Minimum sane terminal geometry. */
const MIN_COLS = 20;
const MIN_ROWS = 5;

function safeDims(cols: number, rows: number): { cols: number; rows: number } | null {
  const c = Math.floor(Number(cols));
  const r = Math.floor(Number(rows));
  if (!Number.isFinite(c) || !Number.isFinite(r)) return null;
  if (c < MIN_COLS || r < MIN_ROWS) return null;
  return { cols: c, rows: r };
}

function isVisible(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.clientWidth === 0 || el.clientHeight === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

export interface ManagedTerminalSession {
  /** Stable session ID — "default" for the primary terminal. */
  id: string;
  /** The xterm.Terminal instance — owns the scrollback buffer + renderer. */
  terminal: Terminal;
  /** FitAddon for geometry measurement. */
  fitAddon: FitAddon;
  /** The PTY session ID returned by the backend. */
  ptySessionId: string | null;
  /** The cwd this session was spawned in. */
  cwd: string;
  /** Shell name for display (e.g. "PowerShell 5.1"). */
  shellName: string;
  /** Whether the backend is using a real PTY (vs pipe fallback). */
  ptyMode: boolean;
  /** Currently attached DOM container (null when detached). */
  attachedContainer: HTMLElement | null;
  /** Last reported cols/rows to the backend — dedupes resize IPC. */
  lastReported: { cols: number; rows: number } | null;
  /** Whether the PTY has been spawned (one-shot). */
  hasSpawned: boolean;
  /** Cleanup functions for IPC listeners. */
  listenerCleanups: Array<() => void>;
  /** Whether this session's PTY has exited. */
  exited: boolean;
}

class TerminalSessionManager {
  private sessions = new Map<string, ManagedTerminalSession>();
  /** Global callback for state changes (so UI can re-render on spawn/exit). */
  private stateListeners = new Set<() => void>();

  /** Subscribe to session state changes. Returns unsubscribe. */
  onStateChange(cb: () => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  private notifyStateChange(): void {
    this.stateListeners.forEach((cb) => cb());
  }

  /**
   * Get an existing session by ID, or null.
   */
  getSession(id: string = 'default'): ManagedTerminalSession | null {
    return this.sessions.get(id) || null;
  }

  /**
   * Get or create a terminal session. The PTY is spawned on first creation.
   * If the session already exists (e.g. user navigated away and back), the
   * EXISTING session is returned — scrollback + PTY process are intact.
   */
  async getOrCreateSession(
    cwd: string,
    id: string = 'default',
  ): Promise<ManagedTerminalSession> {
    const existing = this.sessions.get(id);
    if (existing) return existing;

    // Create the xterm instance FIRST (before spawning PTY) so the output
    // listener can be attached immediately — no early-output-drop.
    const terminal = new Terminal({
      theme: {
        background: '#060a12',
        foreground: '#c8d0e0',
        cursor: '#00e5ff',
        cursorAccent: '#060a12',
        selectionBackground: 'rgba(0, 229, 255, 0.25)',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 12,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      scrollback: 5000,
      cols: 80,
      rows: 24,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    const session: ManagedTerminalSession = {
      id,
      terminal,
      fitAddon,
      ptySessionId: null,
      cwd,
      shellName: '',
      ptyMode: true,
      attachedContainer: null,
      lastReported: null,
      hasSpawned: false,
      listenerCleanups: [],
      exited: false,
    };

    this.sessions.set(id, session);

    // Wire xterm-level handlers ONCE (survive attach/detach cycles).
    // Input → PTY.
    terminal.onData((data) => {
      this.writeToPty(session, data);
    });

    // Keyboard: Ctrl+C (copy if selection, else SIGINT), Ctrl+Shift+C/V.
    terminal.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        const sel = terminal.getSelection();
        if (sel) {
          navigator.clipboard.writeText(sel).catch(() => {});
          terminal.clearSelection();
        }
        return false;
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        navigator.clipboard.readText().then((text) => {
          if (text) this.writeToPty(session, text);
        }).catch(() => {});
        return false;
      }
      if (e.ctrlKey && !e.shiftKey && e.key === 'c') {
        const sel = terminal.getSelection();
        if (sel) {
          navigator.clipboard.writeText(sel).catch(() => {});
          terminal.clearSelection();
          return false; // copy, don't send SIGINT
        }
        return true; // no selection → let \x03 reach the shell as SIGINT
      }
      return true;
    });

    // Spawn the PTY. We pass 80x24 as the initial geometry — the real
    // geometry will be pushed via resize() once the container is attached
    // and fit() runs.
    await this.spawnPty(session, cwd, 80, 24);

    this.notifyStateChange();
    return session;
  }

  /** Spawn the PTY process and wire output/exit listeners. */
  private async spawnPty(
    session: ManagedTerminalSession,
    cwd: string,
    cols?: number,
    rows?: number,
  ): Promise<void> {
    if (session.hasSpawned) return;
    session.hasSpawned = true;

    // Kill existing PTY if any (project path changed).
    if (session.ptySessionId) {
      session.listenerCleanups.forEach((fn) => fn());
      session.listenerCleanups = [];
      await window.nexAPI.terminalSessionKill(session.ptySessionId).catch(() => {});
      session.ptySessionId = null;
      session.lastReported = null;
    }

    session.cwd = cwd;
    const result = await window.nexAPI.terminalSessionSpawn(cwd, cols, rows);
    if (!result.success || !result.sessionId) {
      session.terminal.writeln(
        `\r\n\x1b[31m[terminal error] ${result.error || 'failed to spawn'}\x1b[0m`,
      );
      session.exited = true;
      return;
    }

    session.ptySessionId = result.sessionId;
    if (result.shellName) session.shellName = result.shellName;
    if (typeof result.pty === 'boolean') session.ptyMode = result.pty;
    if (result.cols && result.rows) {
      session.lastReported = { cols: result.cols, rows: result.rows };
    }

    // Wire output listener — writes directly to the xterm instance.
    // This survives UI unmount because the listener + xterm are owned by
    // the manager, not the component.
    const offOutput = window.nexAPI.onTerminalSessionOutput(result.sessionId, (data) => {
      session.terminal.write(data);
    });
    session.listenerCleanups.push(offOutput);

    const offExit = window.nexAPI.onTerminalSessionExit(result.sessionId, (code) => {
      session.exited = true;
      session.terminal.writeln(`\r\n\x1b[90m[process exited: ${code}]\x1b[0m`);
      this.notifyStateChange();
    });
    session.listenerCleanups.push(offExit);

    this.notifyStateChange();
  }

  /**
   * Re-spawn the PTY in a new cwd (project path changed).
   * The xterm instance is reused — scrollback is cleared via term.clear().
   */
  async respawnInCwd(session: ManagedTerminalSession, cwd: string): Promise<void> {
    session.terminal.clear();
    session.exited = false;
    session.hasSpawned = false;
    await this.spawnPty(session, cwd);
  }

  /**
   * Attach the xterm renderer to a DOM container.
   * Called by TerminalSessionPanel on mount. Safe to call multiple times —
   * if already attached to the same container, no-op.
   *
   * This is the KEY method: it calls term.open(container) which attaches
   * the canvas/DOM renderer. When the component unmounts, detachFromContainer()
   * is called — but the xterm instance + PTY survive.
   */
  attachToContainer(
    session: ManagedTerminalSession,
    container: HTMLElement,
  ): boolean {
    if (!isVisible(container)) return false;

    // If already attached to THIS container, no-op.
    if (session.attachedContainer === container) {
      this.fitAndResize(session);
      session.terminal.focus();
      return true;
    }

    // If attached to a DIFFERENT container (e.g. hot-reload), detach first.
    // Note: xterm doesn't have a clean "detach" API — we dispose the renderer
    // by re-opening on the new container. The buffer (scrollback) survives
    // because it's stored in the Terminal instance, not the DOM.
    if (session.attachedContainer && session.attachedContainer !== container) {
      // xterm v5: calling term.open() on a new container re-attaches.
      // The old container's DOM is orphaned but that's fine — React removes it.
    }

    // Open the terminal on the container (attaches renderer).
    session.terminal.open(container);
    session.attachedContainer = container;

    // Fit to the container's actual dimensions + push resize to PTY.
    this.fitAndResize(session);
    session.terminal.focus();
    return true;
  }

  /**
   * Fit the terminal to its container and push the new geometry to the PTY.
   * Safe to call when attached. No-op when detached or hidden.
   */
  fitAndResize(session: ManagedTerminalSession): { cols: number; rows: number } | null {
    if (!session.attachedContainer || !isVisible(session.attachedContainer)) return null;
    try {
      session.fitAddon.fit();
    } catch {
      return null;
    }
    const dims = safeDims(session.terminal.cols, session.terminal.rows);
    if (!dims) return null;

    // Dedupe — only push to PTY if geometry actually changed.
    const last = session.lastReported;
    if (last && last.cols === dims.cols && last.rows === dims.rows) return dims;
    session.lastReported = dims;

    if (session.ptySessionId) {
      window.nexAPI
        .terminalSessionResize(session.ptySessionId, dims.cols, dims.rows)
        .catch(() => {});
    }
    return dims;
  }

  /** Write data to the PTY stdin (user keyboard input). */
  writeToPty(session: ManagedTerminalSession, data: string): void {
    if (session.ptySessionId) {
      window.nexAPI.terminalSessionWrite(session.ptySessionId, data).catch(() => {});
    }
  }

  /** Send a signal (SIGINT etc.) to the PTY. */
  signalPty(session: ManagedTerminalSession, signal: string): void {
    if (session.ptySessionId) {
      window.nexAPI.terminalSessionSignal(session.ptySessionId, signal).catch(() => {});
    }
  }

  /** Detach the xterm renderer from its container (on UI unmount).
   *  The xterm instance + PTY process are NOT destroyed. */
  detachFromContainer(session: ManagedTerminalSession): void {
    // xterm v5 has no explicit "detach" — the renderer stays attached to the
    // old container's DOM. When React removes that DOM (unmount), the renderer
    // becomes orphaned. On re-attach, term.open(newContainer) re-initialises
    // the renderer on the new container. The Terminal buffer (scrollback)
    // survives because it's stored on the Terminal instance, not the DOM.
    session.attachedContainer = null;
  }

  /** Dispose ALL sessions (app quit). Kills PTY processes + disposes xterm. */
  disposeAll(): void {
    for (const [, session] of this.sessions) {
      session.listenerCleanups.forEach((fn) => fn());
      session.listenerCleanups = [];
      if (session.ptySessionId) {
        window.nexAPI.terminalSessionKill(session.ptySessionId).catch(() => {});
      }
      try {
        session.terminal.dispose();
      } catch { /* already disposed */ }
    }
    this.sessions.clear();
  }
}

// Singleton — lives for the entire app lifetime.
export const terminalSessionManager = new TerminalSessionManager();
