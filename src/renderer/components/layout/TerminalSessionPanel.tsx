/**
 * NEX AI — Terminal Session Panel (Lazy-Init Rewrite — Residual W Fix)
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  RESIDUAL WWWWW ROOT CAUSE (after the PTY fix in 3ec5f08)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  The PTY fix (3ec5f08) replaced pipes with node-pty — that was correct and
 *  necessary, but it was NOT sufficient. A SECOND root cause remained:
 *
 *    term.open(container) was called on a container with clientWidth=0 /
 *    clientHeight=0 — because the terminal tab is display:none on app boot
 *    (activeTab starts as 'editor' or 'files', never 'terminal').
 *
 *  Consequence: xterm's renderer (canvas/DOM) initialises against a 0×0
 *  element. The renderer enters a degraded state where glyph measurement and
 *  reflow are broken. When the terminal tab is later activated and fit()
 *  runs, the resize is applied but the ALREADY-WRITTEN prompt output was
 *  laid out against the degraded renderer — producing the garbled "WWWWW"
 *  artefact next to the prompt that survived the PTY fix.
 *
 *  FIX (architectural — not a patch):
 *
 *    LAZY-INIT: do NOT create or open the xterm instance until the container
 *    has real, non-zero dimensions. A one-time visibility observer waits for
 *    the container to become visible, THEN creates xterm → open → fit →
 *    spawn PTY. This guarantees the renderer ALWAYS initialises against a
 *    properly-sized element.
 *
 *    The PTY is also spawned AFTER the first valid fit, so the shell starts
 *    at the correct geometry from byte zero — no resize storm on the first
 *    prompt.
 *
 *  Combined with the PTY fix, this closes the full pipeline:
 *
 *    PowerShell → ConPTY (node-pty) → IPC → renderer → xterm (opened on
 *    real dimensions) → DOM
 *
 *  See src/main/services/terminal-service.ts for the backend half.
 * ════════════════════════════════════════════════════════════════════════════
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import {
  Terminal as TerminalIcon, Trash2, Loader2, Circle,
} from 'lucide-react';
import { useStore } from '../../store/useStore';

type SessionState = 'idle' | 'starting' | 'running' | 'exited' | 'error' | 'killed';

const STATE_COLORS: Record<SessionState, string> = {
  idle: 'var(--nex-text-muted)',
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

/** Check if a DOM element is currently visible (not display:none, has size). */
function isVisible(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.clientWidth === 0 || el.clientHeight === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

// ════════════════════════════════════════════════════════════════════════════
// DEBUG INSTRUMENTATION — TEMPORARY
// ════════════════════════════════════════════════════════════════════════════
// Goal: find the producer of "WWWWW" characters that appear BEFORE the first
// PowerShell prompt on Windows.
//
// Enable: open DevTools console and run:
//   localStorage.setItem('nex:terminal-debug', '1')
// Then reload the page (Ctrl+R) and open the Terminal tab.
//
// Every xterm.write / xterm.writeln call is logged with:
//   - sequence number
//   - timestamp
//   - source tag (pty-output | spawn-error | exit | open-here)
//   - length
//   - escaped data (JSON.stringify, truncated to 200 chars)
//   - hex of first 64 bytes (to catch non-printable / VT escape sequences)
//   - stack trace for the first 5 writes (to catch unknown write paths)
//
// Cross-reference with backend logs ([NEX-TERM ... OUT]):
//   - If W's appear in BOTH → they come from the PTY (shell/ConPTY).
//   - If W's appear ONLY here (source ≠ pty-output) → renderer write path.
//   - If W's appear here with source=pty-output but NOT in backend logs →
//     they're injected in the IPC bridge or preload.
//
// This does NOT filter, modify, or suppress any data.
// ════════════════════════════════════════════════════════════════════════════
const XT_DEBUG = (() => {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('nex:terminal-debug') === '1'; }
  catch { return false; }
})();
let _xtSeq = 0;
function _dbgWrite(source: string, data: string): void {
  if (!XT_DEBUG) return;
  _xtSeq++;
  const hex = Array.from(data.slice(0, 64))
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join(' ');
  const esc = JSON.stringify(data).slice(0, 200);
  // Capture stack for first 5 writes to catch any UNKNOWN write path.
  const stack = _xtSeq <= 5
    ? ' stack=' + (new Error().stack || '').split('\n').slice(2, 6).map((l) => l.trim()).join(' | ')
    : '';
  console.log(
    `[NEX-XT ${_xtSeq}] t=${Date.now()} src=${source} ` +
    `len=${data.length} esc=${esc} hex=${hex}${stack}`,
  );
  // Also flag suspicious data (contains many repeated W's)
  if (data.length > 3 && /^W{3,}/.test(data)) {
    console.warn(`[NEX-XT ⚠ WWWWW DETECTED] seq=${_xtSeq} src=${source} len=${data.length} esc=${esc} hex=${hex}`);
  }
}

export default function TerminalSessionPanel() {
  const { projectPath } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [shellName, setShellName] = useState<string>('');
  const [ptyMode, setPtyMode] = useState<boolean>(true);
  const [xtermReady, setXtermReady] = useState<boolean>(false);
  const cleanupFns = useRef<Array<() => void>>([]);
  /** cwd of the currently-spawned session — prevents duplicate spawns. */
  const spawnedCwdRef = useRef<string | null>(null);
  /** StrictMode double-mount guard. */
  const hasSpawnedRef = useRef(false);
  /** Has the xterm instance been created + opened? (one-shot) */
  const xtermCreatedRef = useRef(false);
  /** Last cols/rows reported to the backend — dedupes resize IPC. */
  const lastReportedRef = useRef<{ cols: number; rows: number } | null>(null);

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
      const errMsg = `\r\n\x1b[31m[terminal error] ${result.error || 'failed to spawn'}\x1b[0m`;
      _dbgWrite('spawn-error', errMsg);
      xtermRef.current?.writeln(errMsg);
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
      _dbgWrite('pty-output', data);
      xtermRef.current?.write(data);
    });
    cleanupFns.current.push(offOutput);

    // Wire exit listener.
    const offExit = window.nexAPI.onTerminalSessionExit(result.sessionId, (code) => {
      setSessionState(code === 0 ? 'exited' : 'error');
      const exitMsg = `\r\n\x1b[90m[process exited: ${code}]\x1b[0m`;
      _dbgWrite('exit', exitMsg);
      xtermRef.current?.writeln(exitMsg);
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
    if (!isVisible(container)) return null;
    try {
      fit.fit();
    } catch {
      return null;
    }
    const dims = safeDims(term.cols, term.rows);
    if (!dims) return null;
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

  // ─── Create + open xterm on a visible container (LAZY-INIT) ────────────────
  //
  // This is the core fix for the residual WWWWW: xterm is NEVER opened on a
  // 0×0 container. We wait until the container has real dimensions, then
  // create/open the Terminal, fit to actual geometry, and spawn the PTY at
  // that correct geometry from byte zero.
  const createXterm = useCallback((): boolean => {
    if (xtermCreatedRef.current) {
      if (XT_DEBUG) console.log('[NEX-XT createXterm] SKIP — already created');
      return true;
    }
    const container = containerRef.current;
    if (!container || !isVisible(container)) {
      if (XT_DEBUG) console.log('[NEX-XT createXterm] SKIP — container not visible');
      return false;
    }

    if (XT_DEBUG) {
      console.log(
        `[NEX-XT createXterm] START ` +
        `containerW=${container.clientWidth} containerH=${container.clientHeight} ` +
        `display=${window.getComputedStyle(container).display}`,
      );
    }

    const term = new Terminal({
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

    if (XT_DEBUG) console.log('[NEX-XT createXterm] Terminal constructed');

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container); // container is GUARANTEED visible here — no 0×0

    if (XT_DEBUG) {
      // Dump the buffer AFTER open() to verify it's empty (no stale data).
      const buf = term.buffer.active;
      let nonEmpty = 0;
      for (let r = 0; r < buf.length; r++) {
        const line = buf.getLine(r);
        if (line) {
          for (let c = 0; c < term.cols; c++) {
            const ch = line.getCell(c)?.getChars();
            if (ch && ch !== ' ' && ch !== '') { nonEmpty++; break; }
          }
        }
      }
      console.log(
        `[NEX-XT createXterm] AFTER open() ` +
        `cols=${term.cols} rows=${term.rows} ` +
        `bufferLen=${buf.length} nonEmptyCells=${nonEmpty} ` +
        `(nonEmpty=0 means buffer is clean — no stale data)`,
      );
    }

    xtermRef.current = term;
    fitRef.current = fit;
    xtermCreatedRef.current = true;
    setXtermReady(true);

    // Wire input — onData fires ONCE per logical input chunk.
    const inputDisposable = term.onData((data) => {
      if (sessionIdRef.current) {
        window.nexAPI.terminalSessionWrite(sessionIdRef.current, data).catch(() => {});
      }
    });
    cleanupFns.current.push(() => inputDisposable.dispose());

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
          return false;
        }
        return true;
      }
      return true;
    });

    // ResizeObserver — guarded fit + deduped resize IPC.
    let rafId = 0;
    const ro = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const dims = safeFit();
        if (dims) sendResizeIfChanged(dims.cols, dims.rows);
      });
    });
    ro.observe(container);
    cleanupFns.current.push(() => {
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
    });

    // Right-click paste (or copy if clipboard read fails).
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
    container.addEventListener('contextmenu', handleContextMenu);
    cleanupFns.current.push(() => container.removeEventListener('contextmenu', handleContextMenu));

    // Initial fit NOW (container is visible) — sets correct cols/rows.
    const dims = safeFit();
    if (XT_DEBUG) console.log(`[NEX-XT createXterm] AFTER fit dims=${JSON.stringify(dims)}`);

    // Spawn the PTY at the correct geometry from byte zero.
    if (!hasSpawnedRef.current) {
      const spawnCwd = projectPath ||
        (typeof process !== 'undefined' ? process.env?.HOME || '~' : '~');
      if (XT_DEBUG) console.log(`[NEX-XT createXterm] spawning PTY cwd=${spawnCwd} cols=${dims?.cols} rows=${dims?.rows}`);
      spawnSession(spawnCwd, dims?.cols, dims?.rows);
    }

    term.focus();
    if (XT_DEBUG) console.log('[NEX-XT createXterm] DONE');
    return true;
  }, [projectPath, safeFit, sendResizeIfChanged, spawnSession]);

  // ─── MOUNT EFFECT: wait for visibility, THEN lazy-init xterm ──────────────
  //
  // The terminal tab may be display:none on app boot. We use a ResizeObserver
  // (fires when display changes none→flex) + an initial check to detect the
  // first moment the container becomes visible, then create+open xterm.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // If already visible, create immediately.
    if (createXterm()) {
      // xterm created — nothing more to do here; the visibility observer
      // below handles subsequent resize/refit on tab switches.
    }

    // Visibility observer — fires when display:none → display:flex.
    // Used both for the initial lazy-init AND for refit on tab re-activation.
    let rafId = 0;
    const ro = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        // Lazy-init on first visibility.
        if (!xtermCreatedRef.current) {
          createXterm();
          return;
        }
        // Already created — just refit + push resize + focus.
        const dims = safeFit();
        if (dims) {
          sendResizeIfChanged(dims.cols, dims.rows);
          xtermRef.current?.focus();
        }
      });
    });
    ro.observe(container);

    // "Open Terminal Here" from Explorer.
    const openHereHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.cwd && xtermRef.current) {
        xtermRef.current.clear();
        spawnedCwdRef.current = null;
        hasSpawnedRef.current = false;
        const dims = safeFit();
        spawnSession(detail.cwd, dims?.cols, dims?.rows);
      }
    };
    window.addEventListener('nex:open-terminal-here', openHereHandler);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener('nex:open-terminal-here', openHereHandler);
      // Kill session + run all cleanup fns (input disposable, RO, contextmenu).
      if (sessionIdRef.current) {
        window.nexAPI.terminalSessionKill(sessionIdRef.current).catch(() => {});
        sessionIdRef.current = null;
      }
      cleanupFns.current.forEach((fn) => fn());
      cleanupFns.current = [];
      spawnedCwdRef.current = null;
      hasSpawnedRef.current = false;
      xtermCreatedRef.current = false;
      lastReportedRef.current = null;
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitRef.current = null;
      setXtermReady(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Re-spawn ONLY when projectPath actually changes ──────────────────────
  useEffect(() => {
    if (!projectPath) return;
    if (spawnedCwdRef.current === projectPath) return;
    if (!hasSpawnedRef.current) return; // initial spawn handled by createXterm
    if (!xtermCreatedRef.current) return; // xterm not ready yet
    const dims = safeFit();
    spawnSession(projectPath, dims?.cols, dims?.rows);
  }, [projectPath, spawnSession, safeFit]);

  // ─── Refit when the tab becomes visible (runs on every render) ───────────
  // Cheap because of dedupe guards. Handles tab re-activation after the
  // initial lazy-init.
  useEffect(() => {
    if (!xtermReady) return;
    const timer = setTimeout(() => {
      const container = containerRef.current;
      if (!container || !isVisible(container)) return;
      const dims = safeFit();
      if (dims) {
        sendResizeIfChanged(dims.cols, dims.rows);
        xtermRef.current?.focus();
      }
    }, 60);
    return () => clearTimeout(timer);
  }); // every render

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
