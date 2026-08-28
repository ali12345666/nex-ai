/**
 * NEX AI — Download Card Component
 *
 * Professional download progress card with:
 *   - Real progress bar
 *   - Download percentage
 *   - Downloaded / total size
 *   - Download speed
 *   - Estimated time remaining (ETA)
 *   - Pause / Resume / Cancel / Retry buttons
 */

import React from 'react';
import {
  Download, Pause, Play, X, RefreshCw, Loader2, Check, AlertCircle, FileDown,
} from 'lucide-react';

export interface DownloadCardData {
  id: string;
  modelName: string;
  state: string; // queued | resolving | connecting | downloading | retrying | verifying | installing | completed | failed | cancelled
  progress: number; // 0-100
  receivedBytes: number;
  totalBytes: number; // 0 if unknown
  speed: number; // bytes/sec
  eta: number; // ms, -1 if unknown
  stageMessage?: string;
  stageMessageFa?: string;
  attempt?: number;
  maxAttempts?: number;
  failure?: string;
  source?: string;
}

interface DownloadCardProps {
  download: DownloadCardData;
  onCancel?: (id: string) => void;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  onRetry?: (id: string) => void;
}

function fmtBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec < 0) return '—';
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

function fmtEta(ms: number): string {
  if (!ms || ms < 0) return '—';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}m ${remSec}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

const STATE_META: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  queued: { color: '#94a3b8', icon: <Loader2 size={12} className="animate-spin" />, label: 'Queued' },
  resolving: { color: '#67e8f9', icon: <Loader2 size={12} className="animate-spin" />, label: 'Resolving' },
  connecting: { color: '#67e8f9', icon: <Loader2 size={12} className="animate-spin" />, label: 'Connecting' },
  downloading: { color: '#06b6d4', icon: <Download size={12} />, label: 'Downloading' },
  retrying: { color: '#fcd34d', icon: <RefreshCw size={12} className="animate-spin" />, label: 'Retrying' },
  verifying: { color: '#c4b5fd', icon: <Loader2 size={12} className="animate-spin" />, label: 'Verifying' },
  installing: { color: '#c4b5fd', icon: <Loader2 size={12} className="animate-spin" />, label: 'Installing' },
  completed: { color: '#86efac', icon: <Check size={12} />, label: 'Completed' },
  'download-failed': { color: '#fca5a5', icon: <AlertCircle size={12} />, label: 'Failed' },
  cancelled: { color: '#94a3b8', icon: <X size={12} />, label: 'Cancelled' },
};

export default function DownloadCard({ download, onCancel, onPause, onResume, onRetry }: DownloadCardProps) {
  const meta = STATE_META[download.state] || STATE_META.queued;
  const isDownloading = download.state === 'downloading';
  const isCompleted = download.state === 'completed';
  const isFailed = download.state === 'download-failed' || download.state === 'cancelled';
  const isActive = !isCompleted && !isFailed;
  const progress = download.progress || 0;

  return (
    <div
      className="nex-glass rounded-xl p-3 transition-all duration-300"
      style={{
        border: `1px solid ${isCompleted ? 'rgba(34,197,94,0.2)' : isFailed ? 'rgba(239,68,68,0.2)' : 'var(--nex-panel-border)'}`,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <div className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${meta.color}15`, color: meta.color }}>
          {meta.icon}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-medium truncate" style={{ color: 'var(--nex-text)' }}>{download.modelName}</h4>
          <div className="flex items-center gap-2 text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>
            <span style={{ color: meta.color }}>{meta.label}</span>
            {download.attempt && download.maxAttempts && download.attempt > 1 && (
              <span>attempt {download.attempt}/{download.maxAttempts}</span>
            )}
            {download.source && <span className="truncate">• {download.source}</span>}
          </div>
        </div>
        <span className="text-sm font-bold" style={{ color: meta.color }}>{Math.round(progress)}%</span>
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div
          className="h-full rounded-full transition-all duration-300 relative overflow-hidden"
          style={{
            width: `${progress}%`,
            background: isFailed
              ? 'linear-gradient(90deg, #ef444488, #ef4444)'
              : isCompleted
                ? 'linear-gradient(90deg, #22c55e88, #22c55e)'
                : 'linear-gradient(90deg, #06b6d488, #06b6d4)',
          }}
        >
          {isDownloading && (
            <div className="absolute inset-0 opacity-30" style={{
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
              animation: 'shimmer 1.5s infinite',
            }} />
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between text-[9px] mb-2" style={{ color: 'var(--nex-text-muted)' }}>
        <span>
          {fmtBytes(download.receivedBytes)} {download.totalBytes > 0 && `/ ${fmtBytes(download.totalBytes)}`}
        </span>
        {isDownloading && (
          <>
            <span>{fmtSpeed(download.speed)}</span>
            <span>ETA: {fmtEta(download.eta)}</span>
          </>
        )}
        {download.stageMessageFa && !isDownloading && (
          <span style={{ color: 'var(--nex-text-muted)' }}>{download.stageMessageFa}</span>
        )}
      </div>

      {/* Error message */}
      {download.failure && (
        <div className="flex items-start gap-1.5 p-2 rounded-lg mb-2 text-[9px]" style={{ background: 'rgba(239,68,68,0.08)', color: '#fca5a5' }}>
          <AlertCircle size={10} className="shrink-0 mt-0.5" />
          <span className="break-all">{download.failure}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {isActive && onCancel && (
          <button
            onClick={() => onCancel(download.id)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-medium transition-all nex-click"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            <X size={10} /> Cancel
          </button>
        )}
        {isDownloading && onPause && (
          <button
            onClick={() => onPause(download.id)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-medium transition-all nex-click"
            style={{ background: 'rgba(245,158,11,0.1)', color: '#fcd34d', border: '1px solid rgba(245,158,11,0.2)' }}
          >
            <Pause size={10} /> Pause
          </button>
        )}
        {(download.state === 'queued' || download.state === 'paused') && onResume && (
          <button
            onClick={() => onResume(download.id)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-medium transition-all nex-click"
            style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}
          >
            <Play size={10} /> Resume
          </button>
        )}
        {isFailed && onRetry && (
          <button
            onClick={() => onRetry(download.id)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-medium transition-all nex-click"
            style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}
          >
            <RefreshCw size={10} /> Retry
          </button>
        )}
        {isCompleted && (
          <span className="flex items-center gap-1 text-[9px] px-2 py-1 rounded-lg" style={{ background: 'rgba(34,197,94,0.1)', color: '#86efac' }}>
            <Check size={10} /> Ready to use
          </span>
        )}
      </div>
    </div>
  );
}
