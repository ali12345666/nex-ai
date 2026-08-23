import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import {
  GitBranch, Wifi, WifiOff, Cpu,
  Terminal, Bot, MemoryStick, Zap, Activity,
} from 'lucide-react';
import type { SystemMonitorSnapshot } from '../types/electron';

/**
 * StatusBar (Phase 24: LIVE telemetry — no fake values)
 *
 * Every value here is REAL:
 *  - git branch + dirty count via `git-status` IPC (real safeExecFile)
 *  - CPU% / RAM% / model / backend / tok/s / context% / agent state via
 *    `system-snapshot` IPC (the P12 SystemMonitorService)
 *  - offline indicator reflects the AI MODE (local-first) — not navigator
 *
 * Polling: 2s cadence (throttled inside the service per-subsystem), full
 * cleanup on unmount / project change. N/A when a metric is unavailable.
 * Modified-file count comes from the open-editor state (real).
 */

const POLL_MS = 2000;

export default function StatusBar() {
  const {
    activeFile,
    openFiles,
    projectPath,
    settings,
    aiMode,
    terminalVisible,
    toggleTerminal,
  } = useStore();

  const [git, setGit] = useState<{ branch: string; dirty: number } | null>(null);
  const [snap, setSnap] = useState<SystemMonitorSnapshot | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const poll = useCallback(async () => {
    // Real git status (only with an open project)
    if (projectPath) {
      try {
        const r = await window.nexAPI.gitStatus(projectPath);
        if (mountedRef.current) {
          setGit(r.success ? { branch: r.branch || '—', dirty: (r.files || []).length } : null);
        }
      } catch { setGit(null); }
    } else {
      setGit(null);
    }
    // Real system/AI/agent telemetry
    try {
      const r = await window.nexAPI.systemSnapshot();
      if (mountedRef.current && r.success && r.snapshot) setSnap(r.snapshot);
    } catch { /* snapshot unavailable → keep last */ }
  }, [projectPath]);

  useEffect(() => {
    mountedRef.current = true;
    poll();
    timerRef.current = setInterval(poll, POLL_MS);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [poll]);

  const activeFileData = openFiles.find((f) => f.path === activeFile);
  const modifiedCount = openFiles.filter((f) => f.modified).length;

  const rt = snap?.aiRuntime;
  const agent = snap?.agent;
  const generating = rt?.inferenceActive === true;
  const backendLabel = aiMode === 'local' ? 'LOCAL' : aiMode === 'online' ? (rt?.backend === 'online' ? 'ONLINE' : 'LOCAL') : 'AUTO';
  const contextPct = rt?.contextUsedTokens !== undefined && rt?.contextMaxTokens
    ? Math.round((rt.contextUsedTokens / rt.contextMaxTokens) * 100) : undefined;

  return (
    <div className="h-6 flex items-center justify-between px-3 bg-[#0d0d14] border-t border-nex-border text-[11px] text-nex-text-dim select-none shrink-0" role="status" aria-label="Status bar">
      {/* Left */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Real git branch */}
        {git ? (
          <span className="flex items-center gap-1 hover:text-nex-text cursor-pointer transition-colors" title={`branch: ${git.branch}${git.dirty ? ` · ${git.dirty} changed` : ' · clean'}`}>
            <GitBranch size={12} aria-hidden />
            <span>{git.branch}</span>
            {git.dirty > 0 && <span className="text-nex-warning">{git.dirty}±</span>}
          </span>
        ) : projectPath ? (
          <span className="flex items-center gap-1 text-nex-text-muted" title="not a git repository">
            <GitBranch size={12} aria-hidden /> —
          </span>
        ) : null}

        {/* Modified files (real, from editor state) */}
        {modifiedCount > 0 && (
          <span className="text-nex-accent">{modifiedCount} unsaved</span>
        )}

        {/* Agent activity (real) */}
        {agent && agent.queueState !== 'idle' && agent.queueState !== 'unknown' && (
          <span className="flex items-center gap-1 text-nex-accent" title={agent.currentStep || agent.currentTask || ''}>
            <Activity size={11} className={agent.queueState === 'running' ? 'animate-pulse' : ''} aria-hidden />
            <span className="capitalize">{agent.queueState}</span>
            {agent.stepProgress && <span className="text-nex-text-muted">{agent.stepProgress.current}/{agent.stepProgress.total}</span>}
          </span>
        )}
      </div>

      {/* Center */}
      <div className="flex items-center gap-3">
        {activeFileData && (
          <>
            <span className="capitalize">{activeFileData.language}</span>
            <span className="text-nex-text-muted">|</span>
            <span>UTF-8</span>
            <span className="text-nex-text-muted">|</span>
            <span>Spaces: {settings.tabSize}</span>
          </>
        )}
      </div>

      {/* Right: REAL telemetry */}
      <div className="flex items-center gap-3">
        {/* Live tok/s while generating */}
        {generating && rt?.lastTokensPerSecond !== undefined && (
          <span className="flex items-center gap-1 text-nex-accent" title="generation speed">
            <Zap size={11} aria-hidden />{Math.round(rt.lastTokensPerSecond)} tok/s
          </span>
        )}
        {/* Context usage */}
        {contextPct !== undefined && (
          <span className="text-nex-text-muted" title={`context ${rt?.contextUsedTokens}/${rt?.contextMaxTokens} tokens`}>
            ctx {contextPct}%
          </span>
        )}
        {/* CPU / RAM (real, from sampler) */}
        {snap && (
          <>
            <span className="flex items-center gap-1" title="CPU usage">
              <Cpu size={11} aria-hidden />{snap.cpu.usagePercent !== undefined ? `${Math.round(snap.cpu.usagePercent)}%` : 'N/A'}
            </span>
            <span className="flex items-center gap-1" title="RAM usage">
              <MemoryStick size={11} aria-hidden />{Math.round(snap.memory.usagePercent)}%
            </span>
          </>
        )}
        {/* AI mode / model */}
        <span
          className={`flex items-center gap-1 hover:text-nex-text cursor-pointer transition-colors ${generating ? 'text-nex-accent' : ''}`}
          title={rt?.activeModelName ? `${rt.activeModelName} · ${rt.runtimeType}` : `AI mode: ${backendLabel}`}
        >
          <Bot size={11} aria-hidden />
          <span>{rt?.activeModelName ? rt.activeModelName.slice(0, 18) : backendLabel}</span>
        </span>
        {/* Offline-first indicator (aiMode-based, honest) */}
        <span className="flex items-center gap-1" title={aiMode === 'local' ? 'Local-first mode (no network required)' : 'Online provider enabled'}>
          {aiMode === 'local' ? <WifiOff size={11} className="text-nex-accent" aria-hidden /> : <Wifi size={11} className="text-green-400" aria-hidden />}
        </span>
        {/* Terminal toggle */}
        <button
          onClick={toggleTerminal}
          aria-label="Toggle terminal"
          className={`flex items-center gap-1 hover:text-nex-text cursor-pointer transition-colors ${terminalVisible ? 'text-nex-accent' : ''}`}
          title="Toggle Terminal"
        >
          <Terminal size={11} aria-hidden />
        </button>
        {/* System cores (static, real) */}
        {snap && (
          <span className="flex items-center gap-1 hover:text-nex-text cursor-pointer transition-colors" title="CPU cores">
            <Cpu size={11} aria-hidden />{snap.cpu.threads}t
          </span>
        )}
        {/* Project name */}
        {projectPath && (
          <span className="text-nex-text-muted truncate max-w-[140px]">
            {projectPath.split(/[\\/]/).pop()}
          </span>
        )}
      </div>
    </div>
  );
}
