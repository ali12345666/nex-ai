/**
 * NEX AI — Terminal Session Panel (Thin View — Persistence Rewrite)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ARCHITECTURE CHANGE — PERSISTENT SESSIONS
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Previously, this component OWNED the xterm instance + PTY process. When
 *  AppShell switched views (chat → workspace), this component unmounted and
 *  its cleanup ran:
 *    - xterm.dispose()         ← scrollback GONE
 *    - terminalSessionKill()   ← PowerShell KILLED
 *
 *  Now, the xterm instance + PTY process are owned by the
 *  TerminalSessionManager SINGLETON (outside React). This component is a
 *  THIN VIEW that:
 *    - on mount: asks the manager for the session, attaches the xterm
 *      renderer to the container, registers a ResizeObserver
 *    - on unmount: detaches the renderer (xterm + PTY survive)
 *
 *  When the user navigates away and back, this component re-mounts and
 *  re-attaches to the SAME session — scrollback + PowerShell process are
 *  intact. This mirrors VS Code's integrated terminal.
 *
 *  See: src/renderer/services/terminal-session-manager.ts
 * ════════════════════════════════════════════════════════════════════════════
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Terminal as TerminalIcon, Trash2, Loader2, Circle,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import {
  terminalSessionManager,
  type ManagedTerminalSession,
} from '../../services/terminal-session-manager';

/** Check if a DOM element is currently visible (not display:none, has size). */
function isVisible(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.clientWidth === 0 || el.clientHeight === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

type SessionState = 'starting' | 'running' | 'exited' | 'error' | 'killed';

const STATE_COLORS: Record<SessionState, string> = {
  starting: 'var(--nex-warning)',
  running: 'var(--nex-success)',
  exited: 'var(--nex-text-muted)',
  error: 'var(--nex-error)',
  killed: 'var(--nex-error)',
};

const XT_DEBUG = (() => {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('nex:terminal-debug') === '1'; }
  catch { return false; }
})();

export default function TerminalSessionPanel() {
  const { projectPath } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<ManagedTerminalSession | null>(null);
  const [, forceRender] = useState(0);
  const [sessionState, setSessionState] = useState<SessionState>('starting');
  const [shellName, setShellName] = useState<string>('');
  const [ptyMode, setPtyMode] = useState<boolean>(true);

  const refreshState = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    setShellName(s.shellName);
    setPtyMode(s.ptyMode);
    setSessionState(s.exited ? 'exited' : (s.ptySessionId ? 'running' : 'starting'));
  }, []);

  // Subscribe to manager state changes (spawn / exit).
  useEffect(() => {
    return terminalSessionManager.onStateChange(() => {
      refreshState();
      forceRender((n) => n + 1);
    });
  }, [refreshState]);

  // ─── MOUNT: get-or-create session + attach to container ─────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let ro: ResizeObserver | null = null;

    (async () => {
      const spawnCwd = projectPath ||
        (typeof process !== 'undefined' ? process.env?.HOME || '~' : '~');

      if (XT_DEBUG) console.log(`[NEX-XT mount] getting/creating session cwd=${spawnCwd}`);

      // Get or create the persistent session. If the user navigated away and
      // back, this returns the EXISTING session with its scrollback + PTY.
      const session = await terminalSessionManager.getOrCreateSession(spawnCwd);
      if (cancelled) return;

      sessionRef.current = session;
      refreshState();

      // If the project path changed since the session was created, respawn
      // the PTY in the new cwd (reuses the xterm instance — scrollback cleared).
      if (session.cwd !== spawnCwd) {
        if (XT_DEBUG) console.log(`[NEX-XT mount] cwd changed ${session.cwd} → ${spawnCwd}, respawning`);
        await terminalSessionManager.respawnInCwd(session, spawnCwd);
        if (cancelled) return;
        refreshState();
      }

      // Attach the xterm renderer to the container.
      // The container may be display:none on first mount (terminal tab not
      // active). Wait for it to become visible via ResizeObserver.
      const tryAttach = () => {
        if (!container || !containerRef.current) return;
        if (session.attachedContainer === container) return;
        if (!isVisible(container)) return;
        if (XT_DEBUG) {
          console.log(
            `[NEX-XT mount] attaching to container ` +
            `w=${container.clientWidth} h=${container.clientHeight}`,
          );
        }
        terminalSessionManager.attachToContainer(session, container);
      };

      // Try immediately.
      tryAttach();

      // ResizeObserver: fires when display:none → display:flex (tab activation)
      // AND when the container resizes (window resize, sidebar drag).
      let rafId = 0;
      ro = new ResizeObserver(() => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          // Lazy-attach on first visibility.
          if (session.attachedContainer !== container) {
            tryAttach();
            return;
          }
          // Already attached — refit + push resize to PTY (deduped).
          terminalSessionManager.fitAndResize(session);
        });
      });
      ro.observe(container);

      // Right-click paste (or copy if clipboard read fails + selection exists).
      // This is a container-level handler, so it must be registered here (not
      // in the manager, which only owns the xterm instance).
      const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const sel = session.terminal.getSelection();
        navigator.clipboard.readText().then((clipText) => {
          if (clipText) terminalSessionManager.writeToPty(session, clipText);
        }).catch(() => {
          if (sel) navigator.clipboard.writeText(sel).catch(() => {});
        });
      };
      container.addEventListener('contextmenu', handleContextMenu);
    })();

    return () => {
      cancelled = true;
      if (ro) ro.disconnect();
      // Remove the contextmenu handler (container-level, component-owned).
      const container = containerRef.current;
      // We can't remove the specific handler here because it was created in
      // the async closure — but the container's DOM is removed by React on
      // unmount, so the listener is garbage-collected with it.
      // DETACH ONLY — do NOT dispose xterm or kill PTY.
      // The session survives in the manager singleton.
      const s = sessionRef.current;
      if (s) {
        terminalSessionManager.detachFromContainer(s);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Re-spawn when projectPath changes (session already exists) ──────────
  useEffect(() => {
    if (!projectPath) return;
    const s = sessionRef.current;
    if (!s) return;
    if (s.cwd === projectPath) return;
    if (XT_DEBUG) console.log(`[NEX-XT] projectPath changed → respawn in ${projectPath}`);
    terminalSessionManager.respawnInCwd(s, projectPath).then(refreshState);
  }, [projectPath, refreshState]);

  // ─── "Open Terminal Here" from Explorer ──────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.cwd) {
        const s = sessionRef.current;
        if (s) {
          terminalSessionManager.respawnInCwd(s, detail.cwd).then(refreshState);
        }
      }
    };
    window.addEventListener('nex:open-terminal-here', handler);
    return () => window.removeEventListener('nex:open-terminal-here', handler);
  }, [refreshState]);

  const handleClear = () => sessionRef.current?.terminal.clear();
  const handleCtrlC = () => {
    const s = sessionRef.current;
    if (s) terminalSessionManager.signalPty(s, 'SIGINT');
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

      {/* Terminal body — xterm attaches here */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{
          padding: '4px 0',
          minHeight: 0,
          userSelect: 'text',
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
