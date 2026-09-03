/**
 * NEX AI — Model Details Modal
 *
 * Professional glassmorphism modal shown before download.
 * Displays full model metadata, hardware compatibility, download source,
 * and confirm/cancel buttons.
 *
 * Flow: ModelCard [Download] → ModelDetailsModal → [Start Download] → download begins
 */

import React, { useState } from 'react';
import {
  X, Download, Check, AlertCircle, Cpu, HardDrive, Zap, Gauge,
  Brain, Mic, Eye, Volume2, Globe, Copy, Loader2, RefreshCw,
} from 'lucide-react';
import type { ModelCardData } from './ModelCard';

interface ModelDetailsModalProps {
  model: ModelCardData;
  onClose: () => void;
  onConfirmDownload: (model: ModelCardData) => void;
  hardware?: {
    gpu?: string;
    ram?: string;
    vram?: string;
    backend?: string;
    compatible?: boolean;
  };
  downloadUrl?: string;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  llm: <Brain size={24} strokeWidth={1.5} />,
  'voice-stt': <Mic size={24} strokeWidth={1.5} />,
  'voice-tts': <Volume2 size={24} strokeWidth={1.5} />,
  vision: <Eye size={24} strokeWidth={1.5} />,
  embedding: <Cpu size={24} strokeWidth={1.5} />,
};

function fmtSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtGB(bytes: number): string {
  if (!bytes) return '—';
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(0)} GB`;
}

function DetailRow({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
      {icon && <span className="shrink-0" style={{ color: 'var(--nex-text-muted)' }}>{icon}</span>}
      <span className="text-[11px] shrink-0 w-28" style={{ color: 'var(--nex-text-muted)' }}>{label}</span>
      <span className="text-[11px] font-medium ml-auto text-right truncate" style={{ color: 'var(--nex-text)' }}>{value || '—'}</span>
    </div>
  );
}

export default function ModelDetailsModal({ model, onClose, onConfirmDownload, hardware, downloadUrl }: ModelDetailsModalProps) {
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleConfirm = () => {
    setDownloading(true);
    onConfirmDownload(model);
    // Close after a short delay to show the loading state
    setTimeout(() => {
      setDownloading(false);
      onClose();
    }, 1000);
  };

  const handleCopyLink = () => {
    if (downloadUrl) {
      navigator.clipboard.writeText(downloadUrl).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const capabilities: string[] = [];
  if (model.type === 'llm') capabilities.push('Chat', 'Completion');
  if (model.codingScore !== undefined && model.codingScore > 0) capabilities.push('Coding');
  if (model.reasoningScore !== undefined && model.reasoningScore > 0) capabilities.push('Reasoning');
  if (model.type === 'vision') capabilities.push('Vision');
  if (model.persianSupport) capabilities.push('Persian');
  if (model.multilingual) capabilities.push('Multilingual');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="nex-glass-strong rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto nex-scroll"
        onClick={(e) => e.stopPropagation()}
        style={{ border: '1px solid var(--nex-glass-border)' }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-5" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
          <div
            className="shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}
          >
            {TYPE_ICONS[model.type] || <Brain size={24} />}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold truncate" style={{ color: 'var(--nex-text)' }} title={model.name}>
              {model.name}
            </h2>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--nex-text-muted)' }}>
              {model.provider}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors hover:bg-white/[0.06]" style={{ color: 'var(--nex-text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Model Info */}
          <div>
            <h3 className="text-[10px] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--nex-text-muted)' }}>
              Model Information
            </h3>
            <DetailRow label="Name" value={model.name} icon={<Brain size={11} />} />
            <DetailRow label="Provider" value={model.provider} icon={<Globe size={11} />} />
            <DetailRow label="Parameters" value={model.parameterCount} icon={<Cpu size={11} />} />
            <DetailRow label="Format" value="GGUF" icon={<HardDrive size={11} />} />
            <DetailRow label="Quantization" value={model.quantization} icon={<Zap size={11} />} />
            <DetailRow label="File Size" value={fmtSize(model.sizeBytes)} icon={<HardDrive size={11} />} />
            <DetailRow label="Context" value={model.contextSize ? (model.contextSize >= 1024 ? `${model.contextSize / 1024}K` : model.contextSize) : undefined} icon={<Gauge size={11} />} />
            <DetailRow label="RAM Required" value={model.requiredRAM ? fmtGB(model.requiredRAM) : undefined} icon={<Cpu size={11} />} />
            <DetailRow label="VRAM Required" value={model.requiredVRAM ? fmtGB(model.requiredVRAM) : undefined} icon={<Zap size={11} />} />
            {capabilities.length > 0 && (
              <DetailRow label="Capabilities" value={capabilities.join(' · ')} icon={<Check size={11} />} />
            )}
          </div>

          {/* Hardware Compatibility */}
          {hardware && (
            <div>
              <h3 className="text-[10px] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--nex-text-muted)' }}>
                Hardware Compatibility
              </h3>
              <div
                className="rounded-lg p-3"
                style={{
                  background: hardware.compatible ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                  border: `1px solid ${hardware.compatible ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}`,
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  {hardware.compatible ? (
                    <Check size={14} style={{ color: '#86efac' }} />
                  ) : (
                    <AlertCircle size={14} style={{ color: '#fca5a5' }} />
                  )}
                  <span className="text-[11px] font-medium" style={{ color: hardware.compatible ? '#86efac' : '#fca5a5' }}>
                    {hardware.compatible ? 'Compatible with your system' : 'May not run optimally'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  {hardware.gpu && (
                    <div>
                      <span style={{ color: 'var(--nex-text-muted)' }}>GPU:</span>
                      <span className="ml-1" style={{ color: 'var(--nex-text)' }}>{hardware.gpu}</span>
                    </div>
                  )}
                  {hardware.ram && (
                    <div>
                      <span style={{ color: 'var(--nex-text-muted)' }}>RAM:</span>
                      <span className="ml-1" style={{ color: 'var(--nex-text)' }}>{hardware.ram}</span>
                    </div>
                  )}
                  {hardware.vram && (
                    <div>
                      <span style={{ color: 'var(--nex-text-muted)' }}>VRAM:</span>
                      <span className="ml-1" style={{ color: 'var(--nex-text)' }}>{hardware.vram}</span>
                    </div>
                  )}
                  {hardware.backend && (
                    <div>
                      <span style={{ color: 'var(--nex-text-muted)' }}>Backend:</span>
                      <span className="ml-1" style={{ color: 'var(--nex-text)' }}>{hardware.backend}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Download Source */}
          {downloadUrl && (
            <div>
              <h3 className="text-[10px] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--nex-text-muted)' }}>
                Download Source
              </h3>
              <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)' }}>
                <code className="flex-1 text-[10px] truncate" style={{ color: 'var(--nex-text-muted)' }}>
                  {downloadUrl}
                </code>
                <button
                  onClick={handleCopyLink}
                  className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[9px] font-medium transition-all nex-click"
                  style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}
                >
                  {copied ? <Check size={10} /> : <Copy size={10} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer: Action buttons */}
        <div className="flex items-center gap-3 p-5" style={{ borderTop: '1px solid var(--nex-glass-border)' }}>
          <button
            onClick={onClose}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-[11px] font-medium transition-all nex-click"
            style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--nex-text-muted)', border: '1px solid var(--nex-panel-border)' }}
          >
            <X size={12} /> Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={downloading}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-[11px] font-medium transition-all nex-click disabled:opacity-50"
            style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}
          >
            {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            {downloading ? 'Starting...' : 'Start Download'}
          </button>
        </div>
      </div>
    </div>
  );
}
