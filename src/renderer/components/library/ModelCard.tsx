/**
 * NEX AI — Model Card Component
 *
 * Professional card for displaying a model with full metadata, status badges,
 * and action buttons. Designed for the unified Library panel.
 *
 * Visual design: Glassmorphism card with:
 *   - Model icon + name + provider
 *   - Status badge (Installed / Downloading / Update Available / Recommended / Compatible)
 *   - Metadata grid: size, quantization, RAM, VRAM, speed, parameter count
 *   - Action buttons with states: Normal / Hover / Loading / Disabled / Success
 */

import React, { useState } from 'react';
import {
  Brain, Mic, Eye, Volume2, Cpu, HardDrive, Zap, Gauge,
  Download, Check, Trash2, Play, RefreshCw, AlertCircle, Loader2,
} from 'lucide-react';

export type ModelType = 'llm' | 'voice-stt' | 'voice-tts' | 'vision' | 'embedding';
export type ModelStatus = 'installed' | 'downloading' | 'update-available' | 'recommended' | 'compatible' | 'not-compatible' | 'available';
export type ButtonState = 'normal' | 'loading' | 'success' | 'disabled';

export interface ModelCardData {
  id: string;
  name: string;
  nameFa?: string;
  provider: string;
  type: ModelType;
  sizeBytes: number;
  quantization?: string;
  parameterCount?: string;
  architecture?: string;
  contextSize?: number;
  requiredRAM?: number; // bytes
  requiredVRAM?: number; // bytes
  recommendedRAM?: number;
  recommendedVRAM?: number;
  speedScore?: number; // 0-100
  qualityScore?: number;
  codingScore?: number;
  reasoningScore?: number;
  persianSupport?: boolean;
  multilingual?: boolean;
  status: ModelStatus;
  isActive?: boolean;
  installedPath?: string;
  downloadProgress?: number; // 0-100
  downloadSpeed?: number; // bytes/sec
  downloadEta?: number; // ms
}

interface ModelCardProps {
  model: ModelCardData;
  onDownload?: (id: string) => void;
  onInstall?: (id: string) => void;
  onLoad?: (id: string) => void;
  onRemove?: (id: string) => void;
  onUpdate?: (id: string) => void;
  onActivate?: (id: string) => void;
  compact?: boolean;
}

const TYPE_ICONS: Record<ModelType, React.ReactNode> = {
  llm: <Brain size={18} strokeWidth={1.5} />,
  'voice-stt': <Mic size={18} strokeWidth={1.5} />,
  'voice-tts': <Volume2 size={18} strokeWidth={1.5} />,
  vision: <Eye size={18} strokeWidth={1.5} />,
  embedding: <Cpu size={18} strokeWidth={1.5} />,
};

const STATUS_BADGES: Record<ModelStatus, { label: string; color: string; bg: string }> = {
  installed: { label: 'Installed', color: '#86efac', bg: 'rgba(34,197,94,0.15)' },
  downloading: { label: 'Downloading', color: '#67e8f9', bg: 'rgba(6,182,212,0.15)' },
  'update-available': { label: 'Update', color: '#fcd34d', bg: 'rgba(245,158,11,0.15)' },
  recommended: { label: 'Recommended', color: '#c4b5fd', bg: 'rgba(139,92,246,0.15)' },
  compatible: { label: 'Compatible', color: '#86efac', bg: 'rgba(34,197,94,0.1)' },
  'not-compatible': { label: 'Not Compatible', color: '#fca5a5', bg: 'rgba(239,68,68,0.15)' },
  available: { label: 'Available', color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
};

function fmtSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fmtGB(bytes: number): string {
  if (!bytes) return '—';
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(0)} GB`;
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] w-12 shrink-0" style={{ color: 'var(--nex-text-muted)' }}>{label}</span>
      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-[9px] w-6 text-right" style={{ color: 'var(--nex-text-muted)' }}>{value}</span>
    </div>
  );
}

export default function ModelCard({
  model,
  onDownload,
  onInstall,
  onLoad,
  onRemove,
  onUpdate,
  onActivate,
  compact = false,
}: ModelCardProps) {
  const [btnState, setBtnState] = useState<Record<string, ButtonState>>({});
  const badge = STATUS_BADGES[model.status];
  const isDownloading = model.status === 'downloading';
  const isInstalled = model.status === 'installed' || model.isActive;
  const isNotCompatible = model.status === 'not-compatible';

  const handleAction = (action: string, fn?: (id: string) => void) => {
    if (!fn || btnState[action] === 'loading' || btnState[action] === 'disabled') return;
    setBtnState((prev) => ({ ...prev, [action]: 'loading' }));
    Promise.resolve(fn(model.id))
      .then(() => {
        setBtnState((prev) => ({ ...prev, [action]: 'success' }));
        setTimeout(() => setBtnState((prev) => ({ ...prev, [action]: 'normal' })), 2000);
      })
      .catch(() => setBtnState((prev) => ({ ...prev, [action]: 'normal' })));
  };

  const btnLoading = (action: string) => btnState[action] === 'loading';
  const btnSuccess = (action: string) => btnState[action] === 'success';

  return (
    <div
      className="nex-glass rounded-xl p-4 transition-all duration-300 hover:scale-[1.01] hover:shadow-lg"
      style={{
        border: `1px solid ${model.isActive ? 'var(--nex-accent-glow)' : 'var(--nex-panel-border)'}`,
        opacity: isNotCompatible ? 0.6 : 1,
      }}
    >
      {/* Header: icon + name + badges */}
      <div className="flex items-start gap-3 mb-3">
        <div
          className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}
        >
          {TYPE_ICONS[model.type]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--nex-text)' }}>
              {model.name}
            </h3>
            {model.isActive && (
              <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full"
                style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--nex-accent)' }} />
                ACTIVE
              </span>
            )}
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: badge.bg, color: badge.color }}>
              {badge.label}
            </span>
            {model.persianSupport && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.1)', color: '#86efac' }}>
                فارسی
              </span>
            )}
          </div>
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--nex-text-muted)' }}>
            {model.provider}{model.parameterCount ? ` • ${model.parameterCount}` : ''}{model.quantization ? ` • ${model.quantization}` : ''}
          </p>
        </div>
      </div>

      {/* Download progress bar (if downloading) */}
      {isDownloading && model.downloadProgress !== undefined && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-[9px] mb-1">
            <span style={{ color: 'var(--nex-text-muted)' }}>
              {model.downloadSpeed ? `${fmtSize(model.downloadSpeed)}/s` : 'Connecting...'}
            </span>
            <span style={{ color: '#67e8f9' }}>{Math.round(model.downloadProgress)}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${model.downloadProgress}%`,
                background: 'linear-gradient(90deg, #06b6d488, #06b6d4)',
              }}
            />
          </div>
        </div>
      )}

      {/* Metadata grid */}
      {!compact && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-3 text-[10px]">
          <div className="flex items-center gap-1.5">
            <HardDrive size={11} style={{ color: 'var(--nex-text-muted)' }} />
            <span style={{ color: 'var(--nex-text-muted)' }}>Size:</span>
            <span style={{ color: 'var(--nex-text)' }}>{fmtSize(model.sizeBytes)}</span>
          </div>
          {model.contextSize && (
            <div className="flex items-center gap-1.5">
              <Gauge size={11} style={{ color: 'var(--nex-text-muted)' }} />
              <span style={{ color: 'var(--nex-text-muted)' }}>Context:</span>
              <span style={{ color: 'var(--nex-text)' }}>{model.contextSize >= 1024 ? `${model.contextSize / 1024}K` : model.contextSize}</span>
            </div>
          )}
          {model.requiredRAM ? (
            <div className="flex items-center gap-1.5">
              <Cpu size={11} style={{ color: 'var(--nex-text-muted)' }} />
              <span style={{ color: 'var(--nex-text-muted)' }}>RAM:</span>
              <span style={{ color: isNotCompatible ? '#fca5a5' : 'var(--nex-text)' }}>{fmtGB(model.requiredRAM)}</span>
            </div>
          ) : null}
          {model.requiredVRAM ? (
            <div className="flex items-center gap-1.5">
              <Zap size={11} style={{ color: 'var(--nex-text-muted)' }} />
              <span style={{ color: 'var(--nex-text-muted)' }}>VRAM:</span>
              <span style={{ color: isNotCompatible ? '#fca5a5' : 'var(--nex-text)' }}>{fmtGB(model.requiredVRAM)}</span>
            </div>
          ) : null}
        </div>
      )}

      {/* Score bars (for LLM models) */}
      {!compact && model.type === 'llm' && (model.qualityScore || model.speedScore) && (
        <div className="space-y-1 mb-3">
          {model.qualityScore !== undefined && <ScoreBar label="Quality" value={model.qualityScore} color="#8b5cf6" />}
          {model.speedScore !== undefined && <ScoreBar label="Speed" value={model.speedScore} color="#06b6d4" />}
          {model.codingScore !== undefined && <ScoreBar label="Coding" value={model.codingScore} color="#22c55e" />}
          {model.reasoningScore !== undefined && <ScoreBar label="Reasoning" value={model.reasoningScore} color="#f59e0b" />}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Download button */}
        {!isInstalled && !isDownloading && (
          <button
            onClick={() => handleAction('download', onDownload)}
            disabled={btnLoading('download') || isNotCompatible}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all nex-click disabled:opacity-40"
            style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}
          >
            {btnLoading('download') ? <Loader2 size={11} className="animate-spin" /> : btnSuccess('download') ? <Check size={11} /> : <Download size={11} />}
            {btnLoading('download') ? 'Downloading...' : btnSuccess('download') ? 'Started' : 'Download'}
          </button>
        )}

        {/* Install button (for local import) */}
        {!isInstalled && !isDownloading && onInstall && (
          <button
            onClick={() => handleAction('install', onInstall)}
            disabled={btnLoading('install')}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all nex-click"
            style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--nex-text)', border: '1px solid var(--nex-panel-border)' }}
          >
            {btnLoading('install') ? <Loader2 size={11} className="animate-spin" /> : <HardDrive size={11} />}
            Install
          </button>
        )}

        {/* Load / Activate button */}
        {isInstalled && onLoad && (
          <button
            onClick={() => handleAction('load', onLoad)}
            disabled={btnLoading('load') || model.isActive}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all nex-click disabled:opacity-40"
            style={{ background: model.isActive ? 'rgba(34,197,94,0.15)' : 'var(--nex-accent-dim)', color: model.isActive ? '#86efac' : 'var(--nex-accent-text)', border: `1px solid ${model.isActive ? 'rgba(34,197,94,0.3)' : 'var(--nex-accent-glow)'}` }}
          >
            {btnLoading('load') ? <Loader2 size={11} className="animate-spin" /> : btnSuccess('load') ? <Check size={11} /> : <Play size={11} />}
            {btnLoading('load') ? 'Loading...' : btnSuccess('load') ? 'Loaded' : model.isActive ? 'Active' : 'Load'}
          </button>
        )}

        {/* Update button */}
        {model.status === 'update-available' && onUpdate && (
          <button
            onClick={() => handleAction('update', onUpdate)}
            disabled={btnLoading('update')}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all nex-click"
            style={{ background: 'rgba(245,158,11,0.15)', color: '#fcd34d', border: '1px solid rgba(245,158,11,0.3)' }}
          >
            {btnLoading('update') ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Update
          </button>
        )}

        {/* Remove button */}
        {isInstalled && onRemove && (
          <button
            onClick={() => handleAction('remove', onRemove)}
            disabled={btnLoading('remove') || model.isActive}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all nex-click disabled:opacity-40 ml-auto"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            {btnLoading('remove') ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
            Remove
          </button>
        )}
      </div>

      {/* Not-compatible warning */}
      {isNotCompatible && (
        <div className="flex items-center gap-1.5 mt-2 text-[9px]" style={{ color: '#fca5a5' }}>
          <AlertCircle size={10} />
          <span>Not compatible with your hardware</span>
        </div>
      )}
    </div>
  );
}
