/**
 * NEX AI — Model Card Component (Compact Redesign)
 *
 * Professional, compact card for displaying a model with:
 *   - Header: icon + name (font-weight 600) + provider + status badge
 *   - Body: compact metadata grid (size, context, RAM, VRAM)
 *   - Footer: action buttons (smaller, icon+text, clear states)
 *
 * Button logic:
 *   - Not installed: [Download] → after download → [Install]
 *   - Installed: [Load] [Remove] + [Update] (only if update available)
 *   - Downloading: progress bar + [Cancel]
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
  llm: <Brain size={16} strokeWidth={1.5} />,
  'voice-stt': <Mic size={16} strokeWidth={1.5} />,
  'voice-tts': <Volume2 size={16} strokeWidth={1.5} />,
  vision: <Eye size={16} strokeWidth={1.5} />,
  embedding: <Cpu size={16} strokeWidth={1.5} />,
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

  // Smaller button style
  const btnClass = "flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium transition-all nex-click disabled:opacity-40 disabled:pointer-events-none";

  return (
    <div
      className="nex-glass rounded-lg p-3 transition-all duration-200 hover:shadow-md"
      style={{
        border: `1px solid ${model.isActive ? 'var(--nex-accent-glow)' : 'var(--nex-panel-border)'}`,
        opacity: isNotCompatible ? 0.55 : 1,
      }}
    >
      {/* ── Header: icon + name + badges ── */}
      <div className="flex items-start gap-2.5 mb-2">
        <div
          className="shrink-0 w-8 h-8 rounded-md flex items-center justify-center"
          style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}
        >
          {TYPE_ICONS[model.type]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-xs font-semibold truncate flex-1 min-w-0" style={{ color: 'var(--nex-text)', fontWeight: 600 }}>
              {model.name}
            </h3>
            {model.isActive && (
              <span className="flex items-center gap-0.5 text-[8px] px-1 py-0.5 rounded shrink-0"
                style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>
                <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: 'var(--nex-accent)' }} />
                ACTIVE
              </span>
            )}
            <span className="text-[8px] px-1.5 py-0.5 rounded font-medium shrink-0" style={{ background: badge.bg, color: badge.color }}>
              {badge.label}
            </span>
            {model.persianSupport && (
              <span className="text-[8px] px-1 py-0.5 rounded shrink-0" style={{ background: 'rgba(34,197,94,0.08)', color: '#86efac' }}>
                FA
              </span>
            )}
          </div>
          <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--nex-text-muted)' }}>
            {model.provider}{model.parameterCount ? ` · ${model.parameterCount}` : ''}{model.quantization ? ` · ${model.quantization}` : ''}
          </p>
        </div>
      </div>

      {/* ── Download progress (if downloading) ── */}
      {isDownloading && model.downloadProgress !== undefined && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-[9px] mb-0.5">
            <span style={{ color: 'var(--nex-text-muted)' }}>
              {model.downloadSpeed ? fmtSpeed(model.downloadSpeed) : 'Connecting...'}
            </span>
            <span style={{ color: '#67e8f9' }}>{Math.round(model.downloadProgress)}%</span>
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-full rounded-full transition-all duration-300"
              style={{ width: `${model.downloadProgress}%`, background: 'linear-gradient(90deg, #06b6d488, #06b6d4)' }} />
          </div>
        </div>
      )}

      {/* ── Metadata grid (compact) ── */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-2.5 text-[10px]">
        <div className="flex items-center gap-1">
          <HardDrive size={10} style={{ color: 'var(--nex-text-muted)' }} />
          <span style={{ color: 'var(--nex-text-muted)' }}>Size</span>
          <span className="ml-auto font-medium" style={{ color: 'var(--nex-text)' }}>{fmtSize(model.sizeBytes)}</span>
        </div>
        {model.contextSize ? (
          <div className="flex items-center gap-1">
            <Gauge size={10} style={{ color: 'var(--nex-text-muted)' }} />
            <span style={{ color: 'var(--nex-text-muted)' }}>Ctx</span>
            <span className="ml-auto font-medium" style={{ color: 'var(--nex-text)' }}>
              {model.contextSize >= 1024 ? `${(model.contextSize / 1024).toFixed(0)}K` : model.contextSize}
            </span>
          </div>
        ) : <div />}
        {model.requiredRAM ? (
          <div className="flex items-center gap-1">
            <Cpu size={10} style={{ color: 'var(--nex-text-muted)' }} />
            <span style={{ color: 'var(--nex-text-muted)' }}>RAM</span>
            <span className="ml-auto font-medium" style={{ color: isNotCompatible ? '#fca5a5' : 'var(--nex-text)' }}>{fmtGB(model.requiredRAM)}</span>
          </div>
        ) : <div />}
        {model.requiredVRAM ? (
          <div className="flex items-center gap-1">
            <Zap size={10} style={{ color: 'var(--nex-text-muted)' }} />
            <span style={{ color: 'var(--nex-text-muted)' }}>VRAM</span>
            <span className="ml-auto font-medium" style={{ color: isNotCompatible ? '#fca5a5' : 'var(--nex-text)' }}>{fmtGB(model.requiredVRAM)}</span>
          </div>
        ) : <div />}
      </div>

      {/* ── Footer: Action buttons ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* NOT INSTALLED: Download + Cancel */}
        {!isInstalled && !isDownloading && (
          <button
            onClick={() => handleAction('download', onDownload)}
            disabled={btnLoading('download') || isNotCompatible}
            className={btnClass}
            style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}
          >
            {btnLoading('download') ? <Loader2 size={10} className="animate-spin" /> : btnSuccess('download') ? <Check size={10} /> : <Download size={10} />}
            {btnLoading('download') ? '...' : btnSuccess('download') ? '✓' : 'Download'}
          </button>
        )}

        {/* Downloading: Cancel */}
        {isDownloading && onCancelDownload && (
          <button
            onClick={() => handleAction('cancel', onCancelDownload)}
            className={btnClass}
            style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            <X size={10} /> Cancel
          </button>
        )}

        {/* INSTALLED: Load + Remove + Update */}
        {isInstalled && (
          <>
            <button
              onClick={() => handleAction('load', onLoad)}
              disabled={btnLoading('load') || model.isActive}
              className={btnClass}
              style={{
                background: model.isActive ? 'rgba(34,197,94,0.12)' : 'var(--nex-accent-dim)',
                color: model.isActive ? '#86efac' : 'var(--nex-accent-text)',
                border: `1px solid ${model.isActive ? 'rgba(34,197,94,0.25)' : 'var(--nex-accent-glow)'}`,
              }}
            >
              {btnLoading('load') ? <Loader2 size={10} className="animate-spin" /> : btnSuccess('load') ? <Check size={10} /> : <Play size={10} />}
              {btnLoading('load') ? '...' : btnSuccess('load') ? '✓' : model.isActive ? 'Active' : 'Load'}
            </button>
            {hasUpdate && onUpdate && (
              <button
                onClick={() => handleAction('update', onUpdate)}
                disabled={btnLoading('update')}
                className={btnClass}
                style={{ background: 'rgba(245,158,11,0.12)', color: '#fcd34d', border: '1px solid rgba(245,158,11,0.25)' }}
              >
                {btnLoading('update') ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                Update
              </button>
            )}
            {onRemove && (
              <button
                onClick={() => handleAction('remove', onRemove)}
                disabled={btnLoading('remove') || model.isActive}
                className={`${btnClass} ml-auto`}
                style={{ background: 'rgba(239,68,68,0.08)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.15)' }}
              >
                {btnLoading('remove') ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
              </button>
            )}
          </>
        )}
      </div>

      {/* Not-compatible warning */}
      {isNotCompatible && (
        <div className="flex items-center gap-1 mt-1.5 text-[9px]" style={{ color: '#fca5a5' }}>
          <AlertCircle size={9} />
          <span>Not compatible with your hardware</span>
        </div>
      )}
    </div>
  );
}
