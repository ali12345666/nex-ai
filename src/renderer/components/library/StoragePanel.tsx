/**
 * NEX AI — Storage Panel Component
 *
 * Shows storage usage visualization:
 *   - Used / total space
 *   - Model count
 *   - Breakdown by type
 *   - Low space warning
 */

import React from 'react';
import { HardDrive, AlertTriangle, Brain, Mic, Eye, Cpu } from 'lucide-react';

export interface StorageData {
  usedBytes: number;
  totalBytes: number;
  modelCount: number;
  // Breakdown by type
  llmBytes?: number;
  voiceBytes?: number;
  visionBytes?: number;
  embeddingBytes?: number;
}

interface StoragePanelProps {
  storage: StorageData | null;
}

function fmtGB(bytes: number): string {
  if (!bytes) return '0 GB';
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const TYPE_BREAKDOWN = [
  { key: 'llmBytes', label: 'Models', icon: <Brain size={11} />, color: '#8b5cf6' },
  { key: 'voiceBytes', label: 'Voice', icon: <Mic size={11} />, color: '#06b6d4' },
  { key: 'visionBytes', label: 'Vision', icon: <Eye size={11} />, color: '#22c55e' },
  { key: 'embeddingBytes', label: 'Embed', icon: <Cpu size={11} />, color: '#f59e0b' },
] as const;

export default function StoragePanel({ storage }: StoragePanelProps) {
  if (!storage) {
    return (
      <div className="nex-glass rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <HardDrive size={14} style={{ color: 'var(--nex-text-muted)' }} />
          <span className="text-[11px] font-medium" style={{ color: 'var(--nex-text-muted)' }}>Storage</span>
        </div>
        <p className="text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>Calculating...</p>
      </div>
    );
  }

  const usedPct = storage.totalBytes > 0 ? (storage.usedBytes / storage.totalBytes) * 100 : 0;
  const isLowSpace = usedPct > 85;

  return (
    <div
      className="nex-glass rounded-xl p-4"
      style={{ border: `1px solid ${isLowSpace ? 'rgba(245,158,11,0.3)' : 'var(--nex-panel-border)'}` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <HardDrive size={14} style={{ color: isLowSpace ? '#fcd34d' : 'var(--nex-accent)' }} />
          <span className="text-[11px] font-medium" style={{ color: 'var(--nex-text)' }}>Storage</span>
        </div>
        {isLowSpace && (
          <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full"
            style={{ background: 'rgba(245,158,11,0.15)', color: '#fcd34d' }}>
            <AlertTriangle size={9} /> Low Space
          </span>
        )}
      </div>

      {/* Usage bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-[10px] mb-1">
          <span style={{ color: 'var(--nex-text)' }}>{fmtGB(storage.usedBytes)}</span>
          <span style={{ color: 'var(--nex-text-muted)' }}>/ {fmtGB(storage.totalBytes)}</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(100, usedPct)}%`,
              background: isLowSpace
                ? 'linear-gradient(90deg, #f59e0b88, #f59e0b)'
                : 'linear-gradient(90deg, var(--nex-accent), var(--nex-accent-secondary))',
            }}
          />
        </div>
        <p className="text-[9px] mt-1" style={{ color: 'var(--nex-text-muted)' }}>
          {usedPct.toFixed(1)}% used • {storage.modelCount} models
        </p>
      </div>

      {/* Breakdown by type */}
      <div className="space-y-1.5">
        {TYPE_BREAKDOWN.map(({ key, label, icon, color }) => {
          const bytes = (storage as any)[key] as number | undefined;
          if (!bytes) return null;
          const pct = storage.usedBytes > 0 ? (bytes / storage.usedBytes) * 100 : 0;
          return (
            <div key={key} className="flex items-center gap-2 text-[9px]">
              <span style={{ color }}>{icon}</span>
              <span className="w-12 shrink-0" style={{ color: 'var(--nex-text-muted)' }}>{label}</span>
              <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
              </div>
              <span className="w-12 text-right" style={{ color: 'var(--nex-text-muted)' }}>{fmtGB(bytes)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
