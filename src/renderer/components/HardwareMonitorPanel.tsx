import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity, Cpu, HardDrive, MemoryStick, Gauge, Bot, Wrench,
  Loader2, RefreshCw, Zap, Thermometer, CircleDot,
} from 'lucide-react';
import type { SystemMonitorSnapshot } from '../types/electron';

/**
 * HardwareMonitorPanel (Phase 12 / P12-D)
 *
 * Live system/AI/agent telemetry via `system-snapshot` IPC → SystemMonitor
 * Service (renderer NEVER touches hardware APIs or processes).
 *
 * Polling: single interval (1s) — the service caches per-subsystem at its
 * own cadence, so a 1s poll is cheap. Timer + IPC errors handled; full
 * cleanup on unmount / project switch. N/A for unavailable metrics — never
 * fabricated values.
 */

type Snap = SystemMonitorSnapshot;

function fmtBytes(n?: number): string {
  if (n === undefined || n === null) return 'N/A';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function pct(v?: number): string {
  return v === undefined || v === null ? 'N/A' : `${Math.round(v)}%`;
}

function fmtMs(ms?: number): string {
  if (ms === undefined || ms === null) return 'N/A';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** ASCII-style meter bar (spec example): ███████░░░ 72% */
function Meter({ value, label, icon, warn = 80, danger = 92 }: {
  value?: number; label: string; icon?: React.ReactNode; warn?: number; danger?: number;
}) {
  const filled = value === undefined ? 0 : Math.round((value / 100) * 10);
  const bar = value === undefined ? '░'.repeat(10) : '█'.repeat(filled) + '░'.repeat(10 - filled);
  const color =
    value === undefined ? 'text-[var(--nex-text-muted)]'
    : value >= danger ? 'text-red-400'
    : value >= warn ? 'text-yellow-400'
    : 'text-[var(--nex-accent-text)]';
  return (
    <div className="flex items-center gap-2 py-0.5" title={label}>
      <span className="text-[var(--nex-text-muted)] shrink-0 flex items-center gap-1 w-[86px] text-[10px]">{icon}{label}</span>
      <span className={`font-mono text-[11px] tracking-tighter ${color} shrink-0`}>{bar}</span>
      <span className={`text-[10px] font-mono ml-auto ${color}`}>{pct(value)}</span>
    </div>
  );
}

function Row({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div className="flex items-baseline gap-2 text-[10px] py-[1px]" title={title}>
      <span className="text-[var(--nex-text-muted)] shrink-0">{label}</span>
      <span className="text-[var(--nex-text-dim)] truncate ml-auto text-right font-mono">{value}</span>
    </div>
  );
}

const NA = <span className="text-[var(--nex-text-muted)]">N/A</span>;
const val = (v?: number) => (v === undefined || v === null ? NA : String(v));

export default function HardwareMonitorPanel() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      const res = await window.nexAPI.systemSnapshot();
      if (!mountedRef.current) return;
      if (res.success && res.snapshot) {
        setSnap(res.snapshot);
        setError(null);
      } else {
        setError(res.error || 'snapshot failed');
      }
    } catch (err: any) {
      if (mountedRef.current) setError(err.message);
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    poll();
    if (!paused) {
      timerRef.current = setInterval(poll, 1000);
    }
    return () => {
      mountedRef.current = false;
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [poll, paused]);

  const refresh = () => { setRefreshing(true); poll(); };

  const rt = snap?.aiRuntime;
  const ag = snap?.agent;
  const backendColor = rt?.backend === 'online' ? 'text-emerald-400' : rt?.backend === 'local' ? 'text-sky-300' : 'text-[var(--nex-text-muted)]';
  const queueColor =
    ag?.queueState === 'running' ? 'text-[var(--nex-accent)]'
    : ag?.queueState === 'waiting-permission' ? 'text-yellow-400'
    : ag?.queueState === 'idle' ? 'text-[var(--nex-text-muted)]'
    : 'text-[var(--nex-text-dim)]';

  return (
    <div className="w-full h-full flex flex-col bg-[var(--nex-panel-solid)]">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-[var(--nex-glass-border)] flex items-center gap-2">
        <Activity size={15} className="text-[var(--nex-accent)]" />
        <span className="text-sm font-semibold text-[var(--nex-text)]">System Monitor</span>
        <button onClick={() => setPaused((p) => !p)}
          className={`ml-auto px-1.5 py-0.5 rounded text-[9px] border transition-colors ${paused ? 'text-yellow-400 border-yellow-500/40' : 'text-[var(--nex-text-dim)] border-[var(--nex-glass-border)] hover:text-[var(--nex-text)]'}`}
          title={paused ? 'Resume live updates' : 'Pause live updates (stops polling)'}>
          {paused ? 'PAUSED' : 'LIVE'}
        </button>
        <button onClick={refresh} disabled={refreshing}
          className="p-1 rounded text-[var(--nex-text-dim)] hover:text-[var(--nex-text)] hover:bg-white/[0.04] transition-colors"
          title="Refresh now">
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="mx-3 mt-2 px-2 py-1 rounded bg-red-500/10 border border-red-500/25 text-[10px] text-red-400">
          {error}
        </div>
      )}

      {!snap && !error && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-[var(--nex-text-muted)]" />
        </div>
      )}

      {snap && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2.5">
          {/* Meters */}
          <div className="p-2 rounded-lg bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)]/70">
            <div className="text-[9px] uppercase tracking-wider text-[var(--nex-text-muted)] mb-1">Hardware</div>
            <Meter label="CPU" value={snap.cpu.usagePercent} icon={<Cpu size={10} />} />
            <Meter label="RAM" value={snap.memory.usagePercent} icon={<MemoryStick size={10} />} />
            {(snap.gpus || []).map((g, i) => (
              <Meter key={i} label={`GPU${snap.gpus.length > 1 ? i + 1 : ''}`} value={g.utilizationPercent} icon={<Gauge size={10} />} />
            ))}
            {(snap.gpus || []).map((g, i) => (
              g.vramPercent !== undefined ? (
                <Meter key={`v${i}`} label="VRAM" value={g.vramPercent} icon={<Zap size={10} />} />
              ) : null
            ))}
          </div>

          {/* CPU details */}
          <div className="p-2 rounded-lg bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)]/70">
            <div className="text-[9px] uppercase tracking-wider text-[var(--nex-text-muted)] mb-1 flex items-center gap-1">
              <Cpu size={9} /> CPU
            </div>
            <Row label="model" value={<span title={snap.cpu.model}>{snap.cpu.model.split('@')[0].trim().slice(0, 26)}</span>} />
            <Row label="cores/threads" value={`${snap.cpu.cores} / ${snap.cpu.threads}`} />
            <Row label="frequency" value={snap.cpu.frequencyMHz ? `${snap.cpu.frequencyMHz} MHz` : NA} />
            <Row label="temperature" value={snap.cpu.temperatureC !== undefined ? `${snap.cpu.temperatureC} °C` : NA} />
            {snap.cpu.perCore && snap.cpu.perCore.length > 0 && (
              <div className="mt-1 pt-1 border-t border-[var(--nex-glass-border)]/50">
                <div className="text-[9px] text-[var(--nex-text-muted)] mb-0.5">per-core</div>
                <div className="grid grid-cols-2 gap-x-2">
                  {snap.cpu.perCore.slice(0, 16).map((v, i) => (
                    <Row key={i} label={`core ${i}`} value={`${Math.round(v)}%`} />
                  ))}
                </div>
                {snap.cpu.perCore.length > 16 && (
                  <div className="text-[9px] text-[var(--nex-text-muted)]">+{snap.cpu.perCore.length - 16} more…</div>
                )}
              </div>
            )}
          </div>

          {/* Memory details */}
          <div className="p-2 rounded-lg bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)]/70">
            <div className="text-[9px] uppercase tracking-wider text-[var(--nex-text-muted)] mb-1 flex items-center gap-1">
              <HardDrive size={9} /> Memory
            </div>
            <Row label="used" value={fmtBytes(snap.memory.usedBytes)} />
            <Row label="free" value={fmtBytes(snap.memory.freeBytes)} />
            <Row label="total" value={fmtBytes(snap.memory.totalBytes)} />
          </div>

          {/* GPU details */}
          {(snap.gpus || []).map((g, i) => (
            <div key={i} className="p-2 rounded-lg bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)]/70">
              <div className="text-[9px] uppercase tracking-wider text-[var(--nex-text-muted)] mb-1 flex items-center gap-1">
                <Gauge size={9} /> GPU{i + 1}
              </div>
              <Row label="name" value={<span title={g.name}>{g.name.slice(0, 28)}</span>} />
              <Row label="vendor / src" value={`${g.vendor} · ${g.source}`} />
              <Row label="utilization" value={pct(g.utilizationPercent)} />
              <Row label="vram" value={g.vramUsedBytes !== undefined ? `${fmtBytes(g.vramUsedBytes)} / ${fmtBytes(g.vramTotalBytes)}` : NA} />
              <Row label="temperature" value={g.temperatureC !== undefined ? <span className="flex items-center gap-1 justify-end"><Thermometer size={9} />{g.temperatureC} °C</span> : NA} />
              <Row label="power" value={g.powerWatts !== undefined ? `${g.powerWatts} W` : NA} />
              <Row label="driver" value={g.driverVersion || NA} />
            </div>
          ))}

          {/* AI Runtime */}
          <div className="p-2 rounded-lg bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)]/70">
            <div className="text-[9px] uppercase tracking-wider text-[var(--nex-text-muted)] mb-1 flex items-center gap-1">
              <Bot size={9} /> AI Runtime
            </div>
            <Row label="backend" value={<span className={backendColor}>{rt?.backend ?? '—'} · {rt?.runtimeType ?? '—'}</span>} />
            <Row label="model" value={rt?.activeModelName || NA} title={rt?.activeModelName} />
            <Row label="state" value={
              <span className="flex items-center gap-1 justify-end">
                {rt?.inferenceActive && <CircleDot size={9} className="text-[var(--nex-accent)] animate-pulse" />}
                {rt?.modelLoaded ? (rt?.inferenceActive ? 'inferring' : 'loaded') : 'no model'}
              </span>
            } />
            <Row label="tokens/sec" value={val(rt?.lastTokensPerSecond)} />
            <Row label="prompt/gen" value={rt?.lastPromptTokens !== undefined ? `${rt.lastPromptTokens} / ${rt.lastGeneratedTokens ?? '—'}` : NA} />
            <Row label="duration" value={fmtMs(rt?.lastInferenceDurationMs)} />
            <Row label="load time" value={fmtMs(rt?.lastModelLoadMs)} />
            <Row label="context" value={
              rt?.contextUsedTokens !== undefined && rt?.contextMaxTokens
                ? `${rt.contextUsedTokens}/${rt.contextMaxTokens} (${Math.round((rt.contextUsedTokens / rt.contextMaxTokens) * 100)}%)`
                : NA
            } />
            <Row label="gpu backend" value={rt?.gpuBackend || NA} />
          </div>

          {/* Agent */}
          <div className="p-2 rounded-lg bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)]/70">
            <div className="text-[9px] uppercase tracking-wider text-[var(--nex-text-muted)] mb-1 flex items-center gap-1">
              <Wrench size={9} /> Agent
            </div>
            <Row label="state" value={<span className={queueColor}>{ag?.queueState ?? 'unknown'}</span>} />
            <Row label="task" value={ag?.currentTask || NA} title={ag?.currentTask} />
            <Row label="step" value={
              ag?.stepProgress ? `${ag.stepProgress.current}/${ag.stepProgress.total}${ag.currentStep ? '' : ''}` : NA
            } />
            {ag?.currentStep && <Row label="" value={<span className="text-[9px]">{ag.currentStep}</span>} title={ag.currentStep} />}
            <Row label="tool" value={ag?.activeTool ? <span className="flex items-center gap-1 justify-end"><Loader2 size={9} className="animate-spin" />{ag.activeTool}</span> : NA} />
            <Row label="tool time" value={fmtMs(ag?.toolDurationMs)} />
            {ag?.cancelled && <Row label="" value={<span className="text-red-400">CANCELLED</span>} />}
          </div>

          {/* Footer meta */}
          <div className="text-[8px] text-[var(--nex-text-muted)] px-1 pb-1 flex items-center justify-between">
            <span>{snap.platform} · {new Date(snap.timestamp).toLocaleTimeString()}</span>
            {snap.degradedSources.length > 0 && (
              <span title={`unavailable sources: ${snap.degradedSources.join(', ')}`}>
                {snap.degradedSources.length} source(s) N/A
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
