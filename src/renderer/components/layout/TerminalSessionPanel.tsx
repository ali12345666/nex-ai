/**
 * NEX AI — Terminal Session Panel (Phase 28 + Flow Fix)
 *
 * Real terminal using the TerminalService via IPC.
 * Features: session lifecycle, Ctrl+C, clear, state indicator,
 * workspace-cwd, "Open Terminal Here" from Explorer.
 * Uses xterm.js (already in dependencies).
 *
 * FLOW FIX:
 *   - Merged mount + re-spawn effects into ONE useEffect
 *   - Session is created once on mount; only re-spawned when projectPath changes
 *   - cleanupFns are cleared on kill to prevent listener accumulation
 *   - Removed duplicate cwd writeln (shell prompt already shows cwd)
 *   - IIFE pattern prevents double-calling leftPanel() in parent
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
  // Track the cwd we spawned with — prevents duplicate spawns for same path
  const spawnedCwdRef = useRef<string | null>(null);

  const spawnSession = useCallback(async (cwd: string) => {
    // Skip if already spawned with this exact cwd (prevents duplicate)
    if (sessionIdRef.current && spawnedCwdRef.current === cwd) return;

    // Kill existing session if any
    if (sessionIdRef.current) {
      // Clean up old listeners BEFORE killing to prevent accumulation
      cleanupFns.current.forEach((fn) => fn());
      cleanupFns.current = [];
      await window.nexAPI.terminalSessionKill(sessionIdRef.current).catch(() => {});
      sessionIdRef.current = null;
    }

    spawnedCwdRef.current = cwd;
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

    // Wire output listener — stored for cleanup
    const offOutput = window.nexAPI.onTerminalSessionOutput(result.sessionId, (data) => {
      xtermRef.current?.write(data);
    });
    cleanupFns.current.push(offOutput);

    // Wire exit listener — stored for cleanup
    const offExit = window.nexAPI.onTerminalSessionExit(result.sessionId, (code) => {
      setSessionState(code === 0 ? 'exited' : 'error');
      xtermRef.current?.writeln(`\r\n\x1b[90m[process exited: ${code}]\x1b[0m`);
    });
    cleanupFns.current.push(offExit);

    // NOTE: Do NOT writeln the cwd — the shell prompt already shows it.
    // Writing it here causes duplicate path display in the terminal.
  }, []);

  // SINGLE useEffect: handles xterm creation + initial spawn + projectPath changes
  useEffect(() => {
    if (!containerRef.current) return;

    // Create xterm instance
    const term = new Terminal({
      theme: {
        background: '#060a12',
        foreground: '#c8d0e0',
        cursor: 'var(--nex-accent)',
        cursorAccent: '#060a12',
        selectionBackground: 'rgba(0, 229, 255, 0.15)',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 11,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      scrollback: 5000,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    xtermRef.current = term;
    fitRef.current = fit;

    // Wire input
    const inputDisposable = term.onData((data) => {
      if (sessionIdRef.current) {
        window.nexAPI.terminalSessionWrite(sessionIdRef.current, data).catch(() => {});
      }
    });

    // Wire Ctrl+C handler (xterm sends \x03)
    term.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && e.key === 'c' && window.getSelection()?.toString()) {
        return false; // allow copy
      }
      return true;
    });

    // Resize observer
    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(containerRef.current);

    // Initial spawn — only once
    const spawnCwd = projectPath || (typeof process !== 'undefined' ? process.env?.HOME || '~' : '~');
    spawnSession(spawnCwd);

    // Listen for "Open Terminal Here" from Explorer
    const openHereHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.cwd) {
        term.clear();
        spawnedCwdRef.current = null; // force re-spawn
        spawnSession(detail.cwd);
      }
    };
    window.addEventListener('nex:open-terminal-here', openHereHandler);

    return () => {
      inputDisposable.dispose();
      ro.disconnect();
      window.removeEventListener('nex:open-terminal-here', openHereHandler);
      // Kill session
      if (sessionIdRef.current) {
        window.nexAPI.terminalSessionKill(sessionIdRef.current).catch(() => {});
        sessionIdRef.current = null;
      }
      // Run all cleanup fns
      cleanupFns.current.forEach((fn) => fn());
      cleanupFns.current = [];
      spawnedCwdRef.current = null;
      term.dispose();
      xtermRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-spawn ONLY when projectPath actually changes (not on mount)
  useEffect(() => {
    if (projectPath && spawnedCwdRef.current !== projectPath) {
      spawnSession(projectPath);
    }
  }, [projectPath, spawnSession]);

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
            className="px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors hover:bg-white/[0.06]"
            style={{ color: 'var(--nex-text-muted)', border: '1px solid var(--nex-glass-border)' }}
            title="Send Ctrl+C"
            aria-label="Send Ctrl+C"
          >
            ^C
          </button>
          <button
            onClick={handleClear}
            className="p-1 rounded transition-colors hover:bg-white/[0.06]"
            style={{ color: 'var(--nex-text-muted)' }}
            title="Clear"
            aria-label="Clear terminal"
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>

      {/* Terminal body */}
      <div ref={containerRef} className="flex-1 overflow-hidden" style={{ padding: '4px 0' }} />

      {/* Footer hint */}
      <div
        className="px-3 py-1 shrink-0 flex items-center justify-between"
        style={{ borderTop: '1px solid var(--nex-glass-border)' }}
      >
        <span className="text-[9px] text-[var(--nex-text-muted)] font-mono">
          {projectPath ? projectPath.split(/[\\/]/).pop() : '~'}
        </span>
        {sessionState === 'starting' && <Loader2 size={9} className="animate-spin text-[var(--nex-warning)]" />}
      </div>
    </div>
  );
}
