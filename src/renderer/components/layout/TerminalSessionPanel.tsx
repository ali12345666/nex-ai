/**
 * NEX AI — Terminal Session Panel (PTY Rewrite — ROOT CAUSE FIX)
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  WHAT CHANGED (vs. the version that produced WWWWW artefacts)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  1. Spawn now carries real cols/rows to the backend, and the backend spawns
 *     the shell through node-pty (ConPTY on Windows). The shell starts at the
 *     correct geometry instead of 80x24-by-default-then-refit, which eliminates
 *     the early resize storm that fragmented the first prompt.
 *
 *  2. fit() is GUARDED: it never runs while the container is display:none
 *     (zero dimensions) — that path previously proposed cols=2/rows=1 and
 *     corrupted xterm's buffer geometry.
 *
 *  3. Resize de-duplication: a lastReported {cols,rows} ref skips identical
 *     resize IPC calls, breaking the ResizeObserver → fit → resize → render →
 *     ResizeObserver feedback loop.
 *
 *  4. Single session per lifecycle: spawn runs ONCE. projectPath change is the
 *     only legitimate respawn trigger. Tab switches NEVER respawn.
 *
 *  5. Single output listener per session, removed via removeListener (never
 *     removeAllListeners) — no cross-session interference.
 *
 *  6. No manual prompt injection — the prompt comes exclusively from the shell
 *     through the PTY.
 *
 *  See src/main/services/terminal-service.ts for the backend half of this fix.
 * ════════════════════════════════════════════════════════════════════════════
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import {
  Terminal as TerminalIcon, Trash2, Loader2, Circle,
} from 'lucide-react';
import { useStore } from '../../store/useStore';

type SessionState = 'starting' | 'running' | 'exited' | 'error' | 'killed';

const STATE_COLORS: Record<SessionState, string> = {
  starting: 'var(--nex-warning)',
  running: 'var(--nex-success)',
  exited: 'var(--nex-text-muted)',
  error: 'var(--nex-error)',
  killed: 'var(--nex-error)',
};

/** Minimum sane terminal geometry. Never spawn / resize below this. */
const MIN_COLS = 20;
const MIN_ROWS = 5;

/** Clamp + validate geometry coming OUT of FitAddon (guards 0/NaN/Infinity). */
function safeDims(cols: number, rows: number): { cols: number; rows: number } | null {
  const c = Math.floor(Number(cols));
  const r = Math.floor(Number(rows));
  if (!Number.isFinite(c) || !Number.isFinite(r)) return null;
  if (c < MIN_COLS || r < MIN_ROWS) return null;
  return { cols: c, rows: r };
}

export default function TerminalSessionPanel() {
  const { projectPath } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('starting');
  const [shellName, setShellName] = useState<string>('');
  const [ptyMode, setPtyMode] = useState<boolean>(true);
  const cleanupFns = useRef<Array<() => void>>([]);
  /** cwd of the currently-spawned session — prevents duplicate spawns. */
  const spawnedCwdRef = useRef<string | null>(null);
  /** StrictMode double-mount guard. */
  const hasSpawnedRef = useRef(false);
  /** Last cols/rows reported to the backend — dedupes resize IPC. */
  const lastReportedRef = useRef<{ cols: number; rows: number } | null>(null);
  /** Whether the container currently has real (non-zero) dimensions. */
  const hasRealDimsRef = useRef(false);

  // ─── Spawn helper ──────────────────────────────────────────────────────────
  const spawnSession = useCallback(async (cwd: string, cols?: number, rows?: number) => {
    // Skip if already spawned with this exact cwd (dedupe).
    if (sessionIdRef.current && spawnedCwdRef.current === cwd) return;

    // Kill existing session if any (project path changed).
    if (sessionIdRef.current) {
      cleanupFns.current.forEach((fn) => fn());
      cleanupFns.current = [];
      await window.nexAPI.terminalSessionKill(sessionIdRef.current).catch(() => {});
      sessionIdRef.current = null;
      lastReportedRef.current = null;
    }

    spawnedCwdRef.current = cwd;
    hasSpawnedRef.current = true;
    setSessionState('starting');
    const result = await window.nexAPI.terminalSessionSpawn(cwd, cols, rows);
    if (!result.success || !result.sessionId) {
      setSessionState('error');
      xtermRef.current?.writeln(`\r\n\x1b[31m[terminal error] ${result.error || 'failed to spawn'}\x1b[0m`);
      return;
    }

    sessionIdRef.current = result.sessionId;
    if (result.shellName) setShellName(result.shellName);
    if (typeof result.pty === 'boolean') setPtyMode(result.pty);
    if (result.cols && result.rows) {
      lastReportedRef.current = { cols: result.cols, rows: result.rows };
    }
    setSessionState('running');

    // Wire output listener (single listener per session, removed by ref).
    const offOutput = window.nexAPI.onTerminalSessionOutput(result.sessionId, (data) => {
      xtermRef.current?.write(data);
    });
    cleanupFns.current.push(offOutput);

    // Wire exit listener.
    const offExit = window.nexAPI.onTerminalSessionExit(result.sessionId, (code) => {
      setSessionState(code === 0 ? 'exited' : 'error');
      xtermRef.current?.writeln(`\r\n\x1b[90m[process exited: ${code}]\x1b[0m`);
    });
    cleanupFns.current.push(offExit);
  }, []);

  // ─── Safe fit() — guarded against display:none and bad geometry ────────────
  const safeFit = useCallback((): { cols: number; rows: number } | null => {
    const fit = fitRef.current;
    const term = xtermRef.current;
    const container = containerRef.current;
    if (!fit || !term || !container) return null;
    // Don't fit when the container is hidden (display:none → 0x0).
    // FitAddon would propose cols=2/rows=1 and corrupt the buffer.
    if (container.clientWidth === 0 || container.clientHeight === 0) return null;
    try {
      fit.fit();
    } catch {
      return null;
    }
    const dims = safeDims(term.cols, term.rows);
    if (!dims) return null;
    hasRealDimsRef.current = true;
    return dims;
  }, []);

  // ─── Resize IPC sender (deduped) ───────────────────────────────────────────
  const sendResizeIfChanged = useCallback((cols: number, rows: number) => {
    const dims = safeDims(cols, rows);
    if (!dims) return;
    const last = lastReportedRef.current;
    if (last && last.cols === dims.cols && last.rows === dims.rows) return;
    lastReportedRef.current = dims;
    if (sessionIdRef.current) {
      window.nexAPI.terminalSessionResize(sessionIdRef.current, dims.cols, dims.rows).catch(() => {});
    }
  }, []);

  // ─── SINGLE mount effect: xterm create + initial spawn ─────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#060a12',
        foreground: '#c8d0e0',
        cursor: 'var(--nex-accent)',
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
      // Start with a sane default geometry; the real size is applied on first
      // safeFit() once the container has real dimensions.
      cols: 80,
      rows: 24,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    xtermRef.current = term;
    fitRef.current = fit;

    // Wire input — onData fires ONCE per logical input chunk.
    const inputDisposable = term.onData((data) => {
      if (sessionIdRef.current) {
        window.nexAPI.terminalSessionWrite(sessionIdRef.current, data).catch(() => {});
      }
    });

    // Keyboard: Ctrl+C (copy if selection, else SIGINT), Ctrl+Shift+C/V.
    term.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        const sel = term.getSelection();
        if (sel) {
          navigator.clipboard.writeText(sel).catch(() => {});
          term.clearSelection();
        }
        return false;
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        navigator.clipboard.readText().then((text) => {
          if (text && sessionIdRef.current) {
            window.nexAPI.terminalSessionWrite(sessionIdRef.current, text).catch(() => {});
          }
        }).catch(() => {});
        return false;
      }
      if (e.ctrlKey && !e.shiftKey && e.key === 'c') {
        const sel = term.getSelection();
        if (sel) {
          navigator.clipboard.writeText(sel).catch(() => {});
          term.clearSelection();
          return false; // copy, don't send SIGINT
        }
        return true; // no selection → let \x03 reach the shell as SIGINT
      }
      return true;
    });

    // ResizeObserver — guarded fit + deduped resize IPC.
    // This BREAKS the old feedback loop (RO → fit → resize IPC → render → RO)
    // because (a) we skip fit when hidden, and (b) we skip IPC when unchanged.
    let rafId = 0;
    const ro = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const dims = safeFit();
        if (dims) sendResizeIfChanged(dims.cols, dims.rows);
      });
    });
    ro.observe(containerRef.current);

    // Right-click paste (or copy if clipboard read fails and there's a selection).
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const sel = term.getSelection();
      navigator.clipboard.readText().then((clipText) => {
        if (clipText && sessionIdRef.current) {
          window.nexAPI.terminalSessionWrite(sessionIdRef.current, clipText).catch(() => {});
        }
      }).catch(() => {
        if (sel) navigator.clipboard.writeText(sel).catch(() => {});
      });
    };
    containerRef.current.addEventListener('contextmenu', handleContextMenu);

    // "Open Terminal Here" from Explorer.
    const openHereHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.cwd) {
        term.clear();
        spawnedCwdRef.current = null;
        hasSpawnedRef.current = false;
        const dims = safeFit();
        spawnSession(detail.cwd, dims?.cols, dims?.rows);
      }
    };
    window.addEventListener('nex:open-terminal-here', openHereHandler);

    // Initial spawn — ONLY ONCE (guarded by hasSpawnedRef for StrictMode).
    // We try to fit first so the PTY starts at the right geometry; if the
    // container is still hidden (display:none because terminal tab isn't
    // active), we spawn at 80x24 and the first visibility fit will resize.
    if (!hasSpawnedRef.current) {
      const spawnCwd = projectPath ||
        (typeof process !== 'undefined' ? process.env?.HOME || '~' : '~');
      const dims = safeFit();
      spawnSession(spawnCwd, dims?.cols, dims?.rows);
    }

    term.focus();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      inputDisposable.dispose();
      ro.disconnect();
      window.removeEventListener('nex:open-terminal-here', openHereHandler);
      containerRef.current?.removeEventListener('contextmenu', handleContextMenu);
      if (sessionIdRef.current) {
        window.nexAPI.terminalSessionKill(sessionIdRef.current).catch(() => {});
        sessionIdRef.current = null;
      }
      cleanupFns.current.forEach((fn) => fn());
      cleanupFns.current = [];
      spawnedCwdRef.current = null;
      hasSpawnedRef.current = false;
      lastReportedRef.current = null;
      hasRealDimsRef.current = false;
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Re-spawn ONLY when projectPath actually changes ──────────────────────
  useEffect(() => {
    if (!projectPath) return;
    if (spawnedCwdRef.current === projectPath) return; // no change
    if (!hasSpawnedRef.current) return; // initial spawn handled by mount effect
    const dims = safeFit();
    spawnSession(projectPath, dims?.cols, dims?.rows);
  }, [projectPath, spawnSession, safeFit]);

  // ─── Refit + focus + resize IPC when the tab becomes visible ──────────────
  // WorkspacePanel hides inactive tabs via display:none. When the terminal
  // tab is re-activated we must (a) wait for layout, (b) fit, (c) push the
  // new geometry to the PTY, (d) focus. This runs on every render triggered
  // by projectPath/activeTab changes via the parent re-render.
  useEffect(() => {
    const timer = setTimeout(() => {
      const container = containerRef.current;
      const term = xtermRef.current;
      if (!container || !term) return;
      const style = window.getComputedStyle(container);
      if (style.display === 'none') return; // still hidden — skip
      const dims = safeFit();
      if (dims) {
        sendResizeIfChanged(dims.cols, dims.rows);
        term.focus();
      }
    }, 60); // wait one frame for display:flex to take effect + layout
    return () => clearTimeout(timer);
  }); // runs every render — cheap because of dedupe guards

  const handleClear = () => xtermRef.current?.clear();
  const handleCtrlC = () => {
    if (sessionIdRef.current) {
      window.nexAPI.terminalSessionSignal(sessionIdRef.current, 'SIGINT').catch(() => {});
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--nex-glass-border)' }}
      >
        <div className="flex items-center gap-2">
          <TerminalIcon size={12} style={{ color: 'var(--nex-accent)' }} />
          <span className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
            TERMINAL{shellName ? ` — ${shellName}` : ''}
          </span>
          {/* PTY indicator */}
          <span
            className="text-[8px] px-1 rounded"
            style={{
              color: ptyMode ? 'var(--nex-success)' : 'var(--nex-warning)',
              border: `1px solid ${ptyMode ? 'var(--nex-success)' : 'var(--nex-warning)'}40`,
            }}
            title={ptyMode ? 'Real PTY (ConPTY) — full interactive' : 'Pipe fallback — degraded (install node-pty)'}
          >
            {ptyMode ? 'PTY' : 'PIPE'}
          </span>
          {/* State indicator */}
          <span className="flex items-center gap-1 ml-1">
            <Circle
              size={6}
              className={sessionState === 'running' ? 'animate-pulse' : ''}
              style={{ color: STATE_COLORS[sessionState], fill: STATE_COLORS[sessionState] }}
            />
            <span className="text-[9px]" style={{ color: STATE_COLORS[sessionState] }}>
              {sessionState.toUpperCase()}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCtrlC}
            className="px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors hover:bg-white/[0.06] nex-click"
            style={{ color: 'var(--nex-text-muted)', border: '1px solid var(--nex-glass-border)' }}
            title="Send Ctrl+C (interrupt)"
            aria-label="Send Ctrl+C"
          >
            ^C
          </button>
          <button
            onClick={handleClear}
            className="p-1 rounded transition-colors hover:bg-white/[0.06] nex-click"
            style={{ color: 'var(--nex-text-muted)' }}
            title="Clear terminal"
            aria-label="Clear terminal"
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>

      {/* Terminal body — explicit dimensions for xterm */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{
          padding: '4px 0',
          minHeight: 0, // allow flex to shrink
          userSelect: 'text', // enable text selection inside terminal
        }}
      />

      {/* Footer hint */}
      <div
        className="px-3 py-1 shrink-0 flex items-center justify-between"
        style={{ borderTop: '1px solid var(--nex-glass-border)' }}
      >
        <span className="text-[9px] text-[var(--nex-text-muted)] font-mono">
          {projectPath ? projectPath.split(/[\\/]/).pop() : '~'}
        </span>
        <span className="text-[9px] text-[var(--nex-text-muted)]">
          Ctrl+Shift+C: Copy | Ctrl+Shift+V: Paste | Right-click: Paste
        </span>
        {sessionState === 'starting' && <Loader2 size={9} className="animate-spin text-[var(--nex-warning)]" />}
      </div>
    </div>
  );
}
