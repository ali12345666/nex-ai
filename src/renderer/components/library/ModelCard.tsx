/**
 * NEX AI — Model Card Component (Premium Redesign)
 *
 * Standard-size card with optimized typography and breathing room.
 * Visual hierarchy: model name prominent, secondary info smaller.
 *
 * Layout:
 *   Header: icon (36px) + model name (text-sm, font-semibold) + badges
 *   Body:   metadata grid (size, context, RAM, VRAM) — text-[11px]
 *   Footer: action buttons (icon + text, proper height)
 */

import React, { useState } from 'react';
import {
  Brain, Mic, Eye, Volume2, Cpu, HardDrive, Zap, Gauge,
  Download, Check, Trash2, Play, RefreshCw, AlertCircle, Loader2, X,
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
  requiredRAM?: number;
  requiredVRAM?: number;
  recommendedRAM?: number;
  recommendedVRAM?: number;
  speedScore?: number;
  qualityScore?: number;
  codingScore?: number;
  reasoningScore?: number;
  persianSupport?: boolean;
  multilingual?: boolean;
  status: ModelStatus;
  isActive?: boolean;
  installedPath?: string;
  downloadProgress?: number;
  downloadSpeed?: number;
  downloadEta?: number;
}

interface ModelCardProps {
  model: ModelCardData;
  onDownload?: (id: string) => void;
  onInstall?: (id: string) => void;
  onLoad?: (id: string) => void;
  onRemove?: (id: string) => void;
  onUpdate?: (id: string) => void;
  onCancelDownload?: (id: string) => void;
}

const TYPE_ICONS: Record<ModelType, React.ReactNode> = {
  llm: <Brain size={20} strokeWidth={1.5} />,
  'voice-stt': <Mic size={20} strokeWidth={1.5} />,
  'voice-tts': <Volume2 size={20} strokeWidth={1.5} />,
  vision: <Eye size={20} strokeWidth={1.5} />,
  embedding: <Cpu size={20} strokeWidth={1.5} />,
};

const STATUS_BADGES: Record<ModelStatus, { label: string; color: string; bg: string }> = {
  installed: { label: 'Installed', color: '#86efac', bg: 'rgba(34,197,94,0.12)' },
  downloading: { label: 'Downloading', color: '#67e8f9', bg: 'rgba(6,182,212,0.12)' },
  'update-available': { label: 'Update', color: '#fcd34d', bg: 'rgba(245,158,11,0.12)' },
  recommended: { label: 'Recommended', color: '#c4b5fd', bg: 'rgba(139,92,246,0.12)' },
  compatible: { label: 'Compatible', color: '#86efac', bg: 'rgba(34,197,94,0.08)' },
  'not-compatible': { label: 'Incompatible', color: '#fca5a5', bg: 'rgba(239,68,68,0.12)' },
  available: { label: 'Available', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
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

function fmtSpeed(bytesPerSec: number): string {
  if (!bytesPerSec) return '—';
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

export default function ModelCard({
  model,
  onDownload,
  onInstall,
  onLoad,
  onRemove,
  onUpdate,
  onCancelDownload,
}: ModelCardProps) {
  const [btnState, setBtnState] = useState<Record<string, ButtonState>>({});
  const badge = STATUS_BADGES[model.status];
  const isDownloading = model.status === 'downloading';
  const isInstalled = model.status === 'installed' || model.isActive;
  const isNotCompatible = model.status === 'not-compatible';
  const hasUpdate = model.status === 'update-available';

  const handleAction = (action: string, fn?: (id: string) => void) => {
    if (!fn || btnState[action] === 'loading') return;
    setBtnState((prev) => ({ ...prev, [action]: 'loading' }));
    Promise.resolve(fn(model.id))
      .then(() => {
        setBtnState((prev) => ({ ...prev, [action]: 'success' }));
        setTimeout(() => setBtnState((prev) => ({ ...prev, [action]: 'normal' })), 1500);
      })
      .catch(() => setBtnState((prev) => ({ ...prev, [action]: 'normal' })));
  };

  const btnLoading = (action: string) => btnState[action] === 'loading';
  const btnSuccess = (action: string) => btnState[action] === 'success';

  return (
    <div
      className="nex-glass rounded-xl p-4 transition-all duration-200 hover:shadow-lg"
      style={{
        border: `1px solid ${model.isActive ? 'var(--nex-accent-glow)' : 'var(--nex-panel-border)'}`,
        opacity: isNotCompatible ? 0.55 : 1,
      }}
    >
      {/* ── Header: icon + name (with tooltip) + provider ── */}
      <div className="flex items-start gap-3 mb-2.5">
        <div
          className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}
        >
          {TYPE_ICONS[model.type]}
        </div>
        {/* Model info: takes all available space, truncates name */}
        <div className="flex-1 min-w-0">
          {/* Name row: name takes full width, truncates with tooltip */}
          <h3
            className="text-sm font-semibold leading-tight overflow-hidden text-ellipsis whitespace-nowrap"
            style={{ color: 'var(--nex-text)' }}
            title={model.name}
          >
            {model.name}
          </h3>
          {/* Provider row: separate line, small + muted */}
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--nex-text-muted)', opacity: 0.7 }}>
            {model.provider}
          </p>
        </div>
      </div>

      {/* ── Badge row: separate from header, wraps cleanly ── */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {model.isActive && (
          <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
            style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--nex-accent)' }} />
            ACTIVE
          </span>
        )}
        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0" style={{ background: badge.bg, color: badge.color }}>
          {badge.label}
        </span>
        {model.persianSupport && (
          <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'rgba(34,197,94,0.08)', color: '#86efac' }}>
            فارسی
          </span>
        )}
        {model.parameterCount && (
          <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--nex-text-muted)' }}>
            {model.parameterCount}
          </span>
        )}
        {model.quantization && (
          <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--nex-text-muted)' }}>
            {model.quantization}
          </span>
        )}
      </div>

      {/* ── Download progress (if downloading) ── */}
      {isDownloading && model.downloadProgress !== undefined && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span style={{ color: 'var(--nex-text-muted)' }}>
              {model.downloadSpeed ? fmtSpeed(model.downloadSpeed) : 'Connecting...'}
            </span>
            <span style={{ color: '#67e8f9' }}>{Math.round(model.downloadProgress)}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-full rounded-full transition-all duration-300"
              style={{ width: `${model.downloadProgress}%`, background: 'linear-gradient(90deg, #06b6d488, #06b6d4)' }} />
          </div>
        </div>
      )}

      {/* ── Body: Metadata grid (fixed 2-col, no overflow) ── */}
      <div className="grid mb-3 text-[11px]" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.5rem 1rem' }}>
        <div className="flex items-center gap-1.5 min-w-0">
          <HardDrive size={11} className="shrink-0" style={{ color: 'var(--nex-text-muted)' }} />
          <span className="shrink-0" style={{ color: 'var(--nex-text-muted)' }}>Size</span>
          <span className="ml-auto font-medium truncate" style={{ color: 'var(--nex-text)' }}>{fmtSize(model.sizeBytes)}</span>
        </div>
        {model.contextSize ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <Gauge size={11} className="shrink-0" style={{ color: 'var(--nex-text-muted)' }} />
            <span className="shrink-0" style={{ color: 'var(--nex-text-muted)' }}>Ctx</span>
            <span className="ml-auto font-medium truncate" style={{ color: 'var(--nex-text)' }}>
              {model.contextSize >= 1024 ? `${(model.contextSize / 1024).toFixed(0)}K` : model.contextSize}
            </span>
          </div>
        ) : <div />}
        {model.requiredRAM ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <Cpu size={11} className="shrink-0" style={{ color: 'var(--nex-text-muted)' }} />
            <span className="shrink-0" style={{ color: 'var(--nex-text-muted)' }}>RAM</span>
            <span className="ml-auto font-medium truncate" style={{ color: isNotCompatible ? '#fca5a5' : 'var(--nex-text)' }}>{fmtGB(model.requiredRAM)}</span>
          </div>
        ) : <div />}
        {model.requiredVRAM ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <Zap size={11} className="shrink-0" style={{ color: 'var(--nex-text-muted)' }} />
            <span className="shrink-0" style={{ color: 'var(--nex-text-muted)' }}>VRAM</span>
            <span className="ml-auto font-medium truncate" style={{ color: isNotCompatible ? '#fca5a5' : 'var(--nex-text)' }}>{fmtGB(model.requiredVRAM)}</span>
          </div>
        ) : <div />}
      </div>

      {/* ── Footer: Action buttons (flex, space-between, no overflow) ── */}
      <div className="flex items-center gap-2 flex-wrap justify-between">
        {/* NOT INSTALLED: Download */}
        {!isInstalled && !isDownloading && (
          <button
            onClick={() => handleAction('download', onDownload)}
            disabled={btnLoading('download') || isNotCompatible}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all nex-click disabled:opacity-40 disabled:pointer-events-none"
            style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}
          >
            {btnLoading('download') ? <Loader2 size={11} className="animate-spin" /> : btnSuccess('download') ? <Check size={11} /> : <Download size={11} />}
            {btnLoading('download') ? 'Downloading...' : btnSuccess('download') ? 'Started' : 'Download'}
          </button>
        )}

        {/* Downloading: Cancel */}
        {isDownloading && onCancelDownload && (
          <button
            onClick={() => handleAction('cancel', onCancelDownload)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all nex-click"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            <X size={11} /> Cancel
          </button>
        )}

        {/* INSTALLED: Load + Update + Remove */}
        {isInstalled && (
          <>
            <button
              onClick={() => handleAction('load', onLoad)}
              disabled={btnLoading('load') || model.isActive}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all nex-click disabled:opacity-40"
              style={{
                background: model.isActive ? 'rgba(34,197,94,0.12)' : 'var(--nex-accent-dim)',
                color: model.isActive ? '#86efac' : 'var(--nex-accent-text)',
                border: `1px solid ${model.isActive ? 'rgba(34,197,94,0.25)' : 'var(--nex-accent-glow)'}`,
              }}
            >
              {btnLoading('load') ? <Loader2 size={11} className="animate-spin" /> : btnSuccess('load') ? <Check size={11} /> : <Play size={11} />}
              {btnLoading('load') ? 'Loading...' : btnSuccess('load') ? 'Loaded' : model.isActive ? 'Active' : 'Load'}
            </button>
            {hasUpdate && onUpdate && (
              <button
                onClick={() => handleAction('update', onUpdate)}
                disabled={btnLoading('update')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all nex-click"
                style={{ background: 'rgba(245,158,11,0.12)', color: '#fcd34d', border: '1px solid rgba(245,158,11,0.25)' }}
              >
                {btnLoading('update') ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                Update
              </button>
            )}
            {onRemove && (
              <button
                onClick={() => handleAction('remove', onRemove)}
                disabled={btnLoading('remove') || model.isActive}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all nex-click disabled:opacity-40"
                style={{ background: 'rgba(239,68,68,0.08)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.15)' }}
              >
                {btnLoading('remove') ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                Remove
              </button>
            )}
          </>
        )}
      </div>

      {/* Not-compatible warning */}
      {isNotCompatible && (
        <div className="flex items-center gap-1.5 mt-2.5 text-[10px]" style={{ color: '#fca5a5' }}>
          <AlertCircle size={11} />
          <span>Not compatible with your hardware</span>
        </div>
      )}
    </div>
  );
}
