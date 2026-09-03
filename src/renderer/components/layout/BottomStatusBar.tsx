/**
 * NEX AI — Bottom Status Dock (Phase 27 + UI-02 connectivity control)
 *
 * Real-time system metrics from the P12 SystemMonitorService.
 * Online/Offline, CPU, RAM, sparklines, network info.
 * All data REAL (system-snapshot IPC) — N/A when unavailable.
 *
 * UI-02 changes:
 *   - LOCAL/ONLINE indicator replaced with a real 3-state toggle:
 *     LOCAL → ONLINE → AUTO → LOCAL (cycles on click).
 *   - Single source of truth: aiMode from persisted settings (not runtime
 *     backend status). The runtime status (LOCAL/ONLINE backend) is now
 *     shown as a small subtext indicator next to the mode.
 *   - On click, settings are reloaded, aiMode mutated, and persisted via
 *     the existing `settings-save` IPC. The main process enforces the
 *     new mode server-side (see src/main/ai/ai-mode.ts).
 *   - Network availability is shown as a small dot (green=online, gray=offline)
 *     and is read from `navigator.onLine` (browser API, no IPC needed).
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, Cpu, MemoryStick, Wifi, WifiOff, Cloud, Cpu as CpuIcon, Zap, Gauge, Bot, HardDrive } from 'lucide-react';
import type { SystemMonitorSnapshot } from '../../types/electron';

type AIMode = 'local' | 'online' | 'auto';

const MODE_CYCLE: AIMode[] = ['local', 'online', 'auto'];

const MODE_LABEL: Record<AIMode, string> = {
  local: 'LOCAL',
  online: 'ONLINE',
  auto: 'AUTO',
};

const MODE_DESCRIPTION: Record<AIMode, string> = {
  local: 'Local-only. No external calls. Works fully offline.',
  online: 'Online providers (if network available). Local still allowed.',
  auto: 'Renderer decides; tries local first, falls back to online.',
};

/** Rolling history for sparklines */
function useHistory(value: number | undefined, maxLen = 30): number[] {
  const [history, setHistory] = useState<number[]>([]);
  useEffect(() => {
    if (value !== undefined) {
      setHistory((prev) => [...prev.slice(-(maxLen - 1)), value]);
    }
  }, [value, maxLen]);
  return history;
}

/** Minimal SVG sparkline */
function Sparkline({ data, color, width = 48, height = 16 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return <div style={{ width, height }} />;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`)
    .join(' ');
  return (
    <svg width={width} height={height} aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1" opacity="0.7" strokeLinejoin="round" />
    </svg>
  );
}

export default function BottomStatusBar() {
  const [snap, setSnap] = useState<SystemMonitorSnapshot | null>(null);
  const [aiMode, setAiModeState] = useState<AIMode>('local');
  const [modeSwitching, setModeSwitching] = useState(false);
  const [networkOnline, setNetworkOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const pollRef = useRef<() => void>(() => {});

  // Poll SystemMonitor snapshots every 2s.
  const poll = useCallback(async () => {
    try {
      const r = await window.nexAPI.systemSnapshot();
      if (mountedRef.current && r.success && r.snapshot) setSnap(r.snapshot);
    } catch { /* keep last snapshot */ }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    pollRef.current = poll;
    poll();
    timerRef.current = setInterval(() => pollRef.current(), 2000);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [poll]);

  // UI-02: Load persisted aiMode from settings on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await window.nexAPI.settingsLoad();
        if (!cancelled && r?.settings?.aiMode) {
          setAiModeState(r.settings.aiMode as AIMode);
        }
      } catch { /* keep default 'local' */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // UI-02: Subscribe to browser online/offline events.
  useEffect(() => {
    const onOnline = () => setNetworkOnline(true);
    const onOffline = () => setNetworkOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // UI-02: Cycle through modes on click — LOCAL → ONLINE → AUTO → LOCAL.
  // Saves via the existing `settings-save` IPC; backend enforces server-side.
  const cycleMode = useCallback(async () => {
    if (modeSwitching) return;
    setModeSwitching(true);
    try {
      // Load fresh settings (in case user changed them elsewhere).
      const loaded = await window.nexAPI.settingsLoad();
      const currentSettings = loaded?.settings || {};
      const currentMode = (currentSettings.aiMode as AIMode) || 'local';
      const nextMode = MODE_CYCLE[(MODE_CYCLE.indexOf(currentMode) + 1) % MODE_CYCLE.length];
      const updatedSettings = { ...currentSettings, aiMode: nextMode };
      const result = await window.nexAPI.settingsSave(updatedSettings);
      if (result?.success) {
        setAiModeState(nextMode);
      }
    } catch (err) {
      // Silently fail — keep current mode. Log for debugging only.
      console.warn('[NEX AI] Failed to switch aiMode:', err);
    } finally {
      setModeSwitching(false);
    }
  }, [modeSwitching]);

  const cpuHistory = useHistory(snap?.cpu.usagePercent);
  const ramHistory = useHistory(snap?.memory.usagePercent);
  const rt = snap?.aiRuntime;
  // UI-02: runtime backend status — separate concept from aiMode.
  // Shows whether a local or online backend is ACTUALLY running right now.
  const runtimeBackend = rt?.backend;
  const runtimeLabel = runtimeBackend === 'local'
    ? 'local runtime'
    : runtimeBackend && runtimeBackend !== 'none'
      ? `${runtimeBackend} runtime`
      : 'no runtime';

  // UI-03: GPU/VRAM/agent telemetry — all from snapshot, N/A when undefined.
  const gpu = snap?.gpus?.[0];
  const gpuPercent = gpu?.utilizationPercent;
  const vramPercent = gpu?.vramPercent;
  const agent = snap?.agent;
  const agentActive = agent && agent.queueState !== 'idle' && agent.queueState !== 'unknown';
  const agentLabel = agentActive
    ? (agent.activeTool
        ? `tool: ${agent.activeTool}`
        : agent.currentTask
          ? `task: ${agent.currentTask.slice(0, 24)}${agent.currentTask.length > 24 ? '…' : ''}`
          : agent.queueState)
    : null;

  // Mode-specific styling.
  const modeColor = aiMode === 'local'
    ? 'var(--nex-accent)'
    : aiMode === 'online'
      ? (networkOnline ? 'var(--nex-success)' : 'var(--nex-warning, #f59e0b)')
      : 'var(--nex-text-dim)';

  const ModeIcon = aiMode === 'local' ? CpuIcon : aiMode === 'online' ? Cloud : Zap;

  return (
    <footer
      className="nex-glass-strong flex items-center gap-6 px-5 shrink-0 select-none"
      style={{
        height: 42,
        borderRadius: 'var(--nex-radius-lg)',
        margin: '0 8px 8px 8px',
        zIndex: 10,
        fontSize: 10,
        color: 'var(--nex-text-muted)',
      }}
      role="status"
      aria-label="System status bar"
    >
      {/* UI-02: aiMode toggle (clickable — cycles LOCAL → ONLINE → AUTO) */}
      <button
        onClick={cycleMode}
        disabled={modeSwitching}
        className="flex items-center gap-2 shrink-0 nex-click nex-focus rounded-md px-2 py-1 transition-all"
        style={{
          color: modeColor,
          border: '1px solid var(--nex-glass-border)',
          cursor: modeSwitching ? 'wait' : 'pointer',
          opacity: modeSwitching ? 0.6 : 1,
        }}
        aria-label={`AI mode: ${MODE_LABEL[aiMode]}. Click to cycle to next mode.`}
        title={MODE_DESCRIPTION[aiMode]}
      >
        <ModeIcon size={12} aria-hidden />
        <span style={{ fontWeight: 500 }}>{MODE_LABEL[aiMode]}</span>
        {/* Network availability dot (only meaningful for online/auto modes) */}
        {aiMode !== 'local' && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              background: networkOnline ? 'var(--nex-success)' : 'var(--nex-text-muted)',
              boxShadow: networkOnline ? '0 0 4px var(--nex-success)' : 'none',
            }}
            aria-label={networkOnline ? 'Network online' : 'Network offline'}
            title={networkOnline ? 'Network online' : 'Network offline'}
          />
        )}
        <span style={{ color: 'var(--nex-text-muted)', fontSize: 9 }}>{runtimeLabel}</span>
      </button>

      {/* Divider */}
      <div style={{ width: 1, height: 18, background: 'var(--nex-glass-border)' }} />

      {/* CPU */}
      <div className="flex items-center gap-2">
        <Cpu size={12} aria-hidden />
        <span>CPU</span>
        <span style={{ color: 'var(--nex-text-dim)', fontWeight: 500, minWidth: 32 }}>
          {snap?.cpu.usagePercent !== undefined ? `${Math.round(snap.cpu.usagePercent)}%` : 'N/A'}
        </span>
        <Sparkline data={cpuHistory} color="var(--nex-accent)" />
      </div>

      {/* RAM */}
      <div className="flex items-center gap-2">
        <MemoryStick size={12} aria-hidden />
        <span>RAM</span>
        <span style={{ color: 'var(--nex-text-dim)', fontWeight: 500, minWidth: 32 }}>
          {snap ? `${Math.round(snap.memory.usagePercent)}%` : 'N/A'}
        </span>
        <Sparkline data={ramHistory} color="var(--nex-accent-secondary)" />
      </div>

      {/* UI-03: GPU (only when a GPU is reported by backend) */}
      {gpu && (
        <div className="flex items-center gap-2">
          <Gauge size={12} aria-hidden />
          <span>GPU</span>
          <span style={{ color: 'var(--nex-text-dim)', fontWeight: 500, minWidth: 32 }}>
            {gpuPercent !== undefined ? `${Math.round(gpuPercent)}%` : 'N/A'}
          </span>
        </div>
      )}

      {/* UI-03: VRAM (only when VRAM data is available) */}
      {gpu && vramPercent !== undefined && (
        <div className="flex items-center gap-2">
          <HardDrive size={12} aria-hidden />
          <span>VRAM</span>
          <span style={{ color: 'var(--nex-text-dim)', fontWeight: 500, minWidth: 32 }}>
            {`${Math.round(vramPercent)}%`}
          </span>
        </div>
      )}

      {/* AI Model */}
      <div className="flex items-center gap-2">
        <Activity size={12} aria-hidden />
        <span style={{ color: 'var(--nex-text-dim)' }}>
          {rt?.activeModelName || 'no model'}
        </span>
        {rt?.lastTokensPerSecond !== undefined && rt.lastTokensPerSecond > 0 && (
          <span style={{ color: 'var(--nex-accent-text)' }}>{Math.round(rt.lastTokensPerSecond)} tok/s</span>
        )}
        {/* UI-03: context usage (only when contextMaxTokens is populated) */}
        {rt?.contextMaxTokens !== undefined && rt.contextMaxTokens > 0 && (
          <span style={{ color: 'var(--nex-text-muted)' }}>
            ctx {rt.contextUsedTokens !== undefined ? `${Math.round(rt.contextUsedTokens / rt.contextMaxTokens * 100)}%` : '0%'}
          </span>
        )}
      </div>

      {/* UI-03: Agent state (only when an agent task is active) */}
      {agentLabel && agent && (
        <div
          className="flex items-center gap-2 nex-glass px-2 py-0.5 rounded-md"
          style={{ border: '1px solid var(--nex-glass-border)' }}
          title={`Agent: ${agent.queueState}${agent.currentTask ? ` — ${agent.currentTask}` : ''}`}
        >
          <Bot size={12} aria-hidden style={{ color: 'var(--nex-accent-text)' }} />
          <span style={{ color: 'var(--nex-accent-text)', fontWeight: 500 }}>
            {agentLabel}
          </span>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: Project */}
      {snap && (
        <div className="flex items-center gap-2 shrink-0">
          <span style={{ color: 'var(--nex-text-dim)' }}>{snap.cpu.threads} cores</span>
        </div>
      )}
    </footer>
  );
}
