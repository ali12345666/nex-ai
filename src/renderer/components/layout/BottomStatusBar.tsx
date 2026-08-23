/**
 * NEX AI — Bottom Status Dock (Phase 27)
 *
 * Real-time system metrics from the P12 SystemMonitorService.
 * Online/Offline, CPU, RAM, sparklines, network info.
 * All data REAL (system-snapshot IPC) — N/A when unavailable.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, Cpu, HardDrive, MemoryStick, Wifi, WifiOff, ArrowUp, ArrowDown } from 'lucide-react';
import type { SystemMonitorSnapshot } from '../../types/electron';

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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const pollRef = useRef<() => void>(() => {});

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

  const cpuHistory = useHistory(snap?.cpu.usagePercent);
  const ramHistory = useHistory(snap?.memory.usagePercent);
  const rt = snap?.aiRuntime;
  const isLocal = snap ? rt?.backend === 'local' || rt?.backend === 'none' : true;

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
      {/* Online/Offline */}
      <div className="flex items-center gap-2 shrink-0">
        {isLocal ? (
          <>
            <WifiOff size={12} style={{ color: 'var(--nex-accent)' }} />
            <span style={{ color: 'var(--nex-accent-text)', fontWeight: 500 }}>LOCAL</span>
            <span style={{ color: 'var(--nex-text-muted)' }}>offline-first</span>
          </>
        ) : (
          <>
            <Wifi size={12} style={{ color: 'var(--nex-success)' }} className="nex-animate-pulse" />
            <span style={{ color: 'var(--nex-success)', fontWeight: 500 }}>ONLINE</span>
            <span style={{ color: 'var(--nex-text-muted)' }}>connected</span>
          </>
        )}
      </div>

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

      {/* AI Model */}
      <div className="flex items-center gap-2">
        <Activity size={12} aria-hidden />
        <span style={{ color: 'var(--nex-text-dim)' }}>
          {rt?.activeModelName || 'no model'}
        </span>
        {rt?.lastTokensPerSecond !== undefined && rt.lastTokensPerSecond > 0 && (
          <span style={{ color: 'var(--nex-accent-text)' }}>{Math.round(rt.lastTokensPerSecond)} tok/s</span>
        )}
      </div>

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
