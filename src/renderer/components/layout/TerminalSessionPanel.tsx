/**
 * NEX AI — Terminal Session Panel (Phase 28 + Flow Fix + StrictMode Fix)
 *
 * Real terminal using the TerminalService via IPC.
 * Features: session lifecycle, Ctrl+C, clear, state indicator,
 * workspace-cwd, "Open Terminal Here" from Explorer.
 * Uses xterm.js (already in dependencies).
 *
 * FLOW FIX + STRICTMODE FIX:
 *   - Single useEffect for xterm creation + spawn
 *   - spawnSession guarded by spawnedCwdRef to prevent duplicate spawns
 *   - StrictMode double-mount handled: cleanup properly nulls refs
 *   - Listeners cleaned up BEFORE kill to prevent accumulation
 *   - No manual cwd writeln (shell prompt shows it)
 *   - Focus on mount + tab switch
 *   - Right-click context menu for copy/paste
 *   - Ctrl+Shift+C/V for copy/paste
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

export default function TerminalSessionPanel() {
  const { projectPath } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('starting');
  const [shellName, setShellName] = useState<string>('');
  const cleanupFns = useRef<Array<() => void>>([]);
  const spawnedCwdRef = useRef<string | null>(null);
  // Guard against StrictMode double-mount: if we already spawned and
  // the cleanup hasn't run yet, don't spawn again.
  const hasSpawnedRef = useRef(false);

  const spawnSession = useCallback(async (cwd: string) => {
    // Skip if already spawned with this exact cwd
    if (sessionIdRef.current && spawnedCwdRef.current === cwd) return;

    // Kill existing session if any
    if (sessionIdRef.current) {
      cleanupFns.current.forEach((fn) => fn());
      cleanupFns.current = [];
      await window.nexAPI.terminalSessionKill(sessionIdRef.current).catch(() => {});
      sessionIdRef.current = null;
    }

    spawnedCwdRef.current = cwd;
    hasSpawnedRef.current = true;
    setSessionState('starting');
    const result = await window.nexAPI.terminalSessionSpawn(cwd);
    if (!result.success || !result.sessionId) {
      setSessionState('error');
      xtermRef.current?.writeln(`\r\n\x1b[31m[terminal error] ${result.error || 'failed to spawn'}\x1b[0m`);
      return;
    }

    sessionIdRef.current = result.sessionId;
    if ((result as any).shellName) {
      setShellName((result as any).shellName);
    }
    setSessionState('running');

    // Wire output listener
    const offOutput = window.nexAPI.onTerminalSessionOutput(result.sessionId, (data) => {
      xtermRef.current?.write(data);
    });
    cleanupFns.current.push(offOutput);

    // Wire exit listener
    const offExit = window.nexAPI.onTerminalSessionExit(result.sessionId, (code) => {
      setSessionState(code === 0 ? 'exited' : 'error');
      xtermRef.current?.writeln(`\r\n\x1b[90m[process exited: ${code}]\x1b[0m`);
    });
    cleanupFns.current.push(offExit);
  }, []);

  // SINGLE useEffect: xterm creation + initial spawn + all event wiring
  useEffect(() => {
    if (!containerRef.current) return;

    // Create xterm instance
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
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    // Fit after a tick to ensure container has dimensions
    requestAnimationFrame(() => fit.fit());

    xtermRef.current = term;
    fitRef.current = fit;

    // Wire input
    const inputDisposable = term.onData((data) => {
      if (sessionIdRef.current) {
        window.nexAPI.terminalSessionWrite(sessionIdRef.current, data).catch(() => {});
      }
    });

    // Keyboard handler:
    // - Ctrl+C with selection → copy (prevent default)
    // - Ctrl+C without selection → send SIGINT to shell
    // - Ctrl+Shift+C → copy selection
    // - Ctrl+Shift+V → paste from clipboard
    term.attachCustomKeyEventHandler((e) => {
      // Ctrl+Shift+C = copy
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        const sel = term.getSelection();
        if (sel) {
          navigator.clipboard.writeText(sel).catch(() => {});
          term.clearSelection();
        }
        return false;
      }
      // Ctrl+Shift+V = paste
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        navigator.clipboard.readText().then((text) => {
          if (text && sessionIdRef.current) {
            window.nexAPI.terminalSessionWrite(sessionIdRef.current, text).catch(() => {});
          }
        }).catch(() => {});
        return false;
      }
      // Ctrl+C with selection = copy (standard terminal behavior)
      if (e.ctrlKey && !e.shiftKey && e.key === 'c') {
        const sel = term.getSelection();
        if (sel) {
          navigator.clipboard.writeText(sel).catch(() => {});
          term.clearSelection();
          return false; // prevent SIGINT
        }
        // No selection → let \x03 go through to shell as SIGINT
        return true;
      }
      return true;
    });

    // Resize observer — refit on container resize
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => fit.fit());
    });
    ro.observe(containerRef.current);

    // Right-click context menu for copy/paste
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const sel = term.getSelection();
      // Try paste from clipboard
      navigator.clipboard.readText().then((clipText) => {
        if (clipText && sessionIdRef.current) {
          window.nexAPI.terminalSessionWrite(sessionIdRef.current, clipText).catch(() => {});
        }
      }).catch(() => {
        // If clipboard read fails, try copy instead
        if (sel) {
          navigator.clipboard.writeText(sel).catch(() => {});
        }
      });
    };
    containerRef.current.addEventListener('contextmenu', handleContextMenu);

    // Initial spawn — only once (guarded by hasSpawnedRef for StrictMode)
    if (!hasSpawnedRef.current) {
      const spawnCwd = projectPath || (typeof process !== 'undefined' ? process.env?.HOME || '~' : '~');
      spawnSession(spawnCwd);
    }

    // Listen for "Open Terminal Here" from Explorer
    const openHereHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.cwd) {
        term.clear();
        spawnedCwdRef.current = null;
        hasSpawnedRef.current = false;
        spawnSession(detail.cwd);
      }
    };
    window.addEventListener('nex:open-terminal-here', openHereHandler);

    // Focus terminal on mount
    term.focus();

    return () => {
      inputDisposable.dispose();
      ro.disconnect();
      window.removeEventListener('nex:open-terminal-here', openHereHandler);
      if (containerRef.current) {
        containerRef.current.removeEventListener('contextmenu', handleContextMenu);
      }
      // Kill session
      if (sessionIdRef.current) {
        window.nexAPI.terminalSessionKill(sessionIdRef.current).catch(() => {});
        sessionIdRef.current = null;
      }
      // Run all cleanup fns
      cleanupFns.current.forEach((fn) => fn());
      cleanupFns.current = [];
      spawnedCwdRef.current = null;
      hasSpawnedRef.current = false;
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-spawn ONLY when projectPath actually changes (not on mount)
  useEffect(() => {
    if (projectPath && spawnedCwdRef.current !== projectPath && hasSpawnedRef.current) {
      spawnSession(projectPath);
    }
  }, [projectPath, spawnSession]);

  // Focus terminal when tab becomes visible (display changes from none to flex)
  // This is triggered by parent WorkspacePanel changing activeTab
  useEffect(() => {
    // Small delay to ensure container is visible before focusing
    const timer = setTimeout(() => {
      if (xtermRef.current && containerRef.current) {
        // Check if container is actually visible (not display:none)
        const style = window.getComputedStyle(containerRef.current);
        if (style.display !== 'none') {
          fitRef.current?.fit();
          xtermRef.current.focus();
        }
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [projectPath]); // Re-focus when project changes (tab switch triggers re-render)

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

      {/* Terminal body — container must have explicit dimensions for xterm */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{
          padding: '4px 0',
          minHeight: 0, // allow flex to shrink
          userSelect: 'text', // enable text selection in terminal
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
