/**
 * NEX AI — Local AI Runtime Panel (Phase 58)
 *
 * Shows the active local AI runtime: installed models, loaded model,
 * memory/VRAM usage, tokens/sec, runtime status, and load/unload buttons.
 * All actions go through IPC → MultiModelRuntimeManager. The panel never
 * touches models or inference directly.
 *
 * Security: loading/unloading/running models are SAFE actions (they only
 * read disk files the user already placed). No permission gate needed for
 * these — but model INSTALLATION (downloading new models) is NOT available
 * here; that goes through the Runtime Setup panel + PermissionGate.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Cpu, HardDrive, Zap, Activity, RefreshCw, Play, Square, AlertCircle,
  CheckCircle2, XCircle, Loader2, Gauge, MemoryStick, Server, ShieldCheck,
  Brain, Network,
} from 'lucide-react';

// ─── Types (mirrors main-process interfaces) ──────────────────────────────

interface InstalledModelSummary {
  id: string;
  name: string;
  category: string;
  sizeBytes: number;
  contextSize: number;
  gpuLayers: number;
  quantization?: string;
  parameterCount?: string;
  architecture?: string;
  capabilities?: string[];
  fileExists: boolean;
  lastUsedAt?: number;
  loaded: boolean;
  canRun: boolean;
  hardwareVerdict: { canRun: boolean; reason: string; suggestedGpuLayers: number; suggestedThreads: number; suggestedContextSize: number; estimatedLoadSeconds: number };
}

interface RuntimeStatus {
  active: boolean;
  backend: string;
  loadedModelId: string | null;
  loadedModelName: string | null;
  gpuBackend: string;
  installedModels: number;
  modelsByCategory: Record<string, number>;
  lastInference: { tokensPerSecond?: number; generatedTokens?: number; durationMs?: number; active?: boolean; contextMaxTokens?: number } | null;
  hardware: any | null;
  healthy: boolean;
}

const CATEGORY_LABELS_FA: Record<string, string> = {
  general: 'عمومی',
  coding: 'کدنویسی',
  reasoning: 'استدلال',
  fast: 'سریع',
  vision: 'بینایی',
  embedding: 'جاسازی',
  reranker: 'بازرتبه‌ساز',
  speech: 'گفتار',
  image: 'تصویر',
};

const CATEGORY_COLORS: Record<string, string> = {
  general: '#3b82f6',
  coding: '#22c55e',
  reasoning: '#8b5cf6',
  fast: '#06b6d4',
  vision: '#ec4899',
  embedding: '#f59e0b',
  speech: '#10b981',
};

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function LocalRuntimePanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<InstalledModelSummary[]>([]);
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listRes, statusRes] = await Promise.all([
        window.nexAPI.localRuntimeListModels(),
        window.nexAPI.localRuntimeStatus(),
      ]);
      if (listRes.success) setModels(listRes.models || []);
      if (statusRes.success) setStatus(statusRes.status || null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load runtime status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Poll for live telemetry (tokens/sec updates during inference)
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  const showToast = (kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Actions ──

  const loadModel = async (modelId: string) => {
    setBusy(modelId);
    setError(null);
    try {
      const res = await window.nexAPI.localRuntimeLoadModel(modelId);
      if (res.success) {
        showToast('ok', 'مدل بارگذاری شد');
      } else {
        setError(res.error || 'بارگذاری ناموفق بود');
      }
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Load failed');
    } finally {
      setBusy(null);
    }
  };

  const unloadModel = async () => {
    setBusy('unload');
    try {
      const res = await window.nexAPI.localRuntimeUnloadModel();
      if (res.success) showToast('ok', 'مدل تخلیه شد');
      else setError(res.error || 'تخلیه ناموفق بود');
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const abortInference = async () => {
    await window.nexAPI.localRuntimeAbort();
    showToast('ok', 'استنتاج لغو شد');
    refresh();
  };

  // ── Render ──

  const loadedModel = models.find((m) => m.loaded);
  const loadedColor = loadedModel ? (CATEGORY_COLORS[loadedModel.category] || '#3b82f6') : '#64748b';
  const tokensPerSec = status?.lastInference?.tokensPerSecond;
  const inferenceActive = status?.lastInference?.active;

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        <div className="flex items-center gap-2">
          <Cpu size={16} style={{ color: 'var(--nex-accent)' }} />
          <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
            LOCAL AI RUNTIME
          </span>
          {status?.healthy ? (
            <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: '#86efac' }}>
              <CheckCircle2 size={8} /> سالم
            </span>
          ) : (
            <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}>
              <XCircle size={8} /> ناسالم
            </span>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="p-1 rounded transition-colors hover:bg-white/[0.06] disabled:opacity-50"
          style={{ color: 'var(--nex-text-muted)' }}
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto nex-scroll p-3 space-y-3" style={{ maxHeight: 'calc(100vh - 180px)' }}>
        {error && (
          <div className="flex items-start gap-2 p-2 rounded-lg text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Runtime status card */}
        <div className="p-3 rounded-lg nex-glass" style={{ border: `1px solid ${loadedColor}44` }}>
          <div className="flex items-center gap-3 mb-2">
            <div
              className="rounded-full flex items-center justify-center shrink-0"
              style={{
                width: 40, height: 40,
                background: `radial-gradient(circle at 40% 40%, ${loadedColor} 0%, ${loadedColor}88 60%, transparent 100%)`,
                boxShadow: `0 0 16px ${loadedColor}55`,
              }}
            >
              <Server size={16} style={{ color: '#fff' }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium truncate" style={{ color: 'var(--nex-text)' }}>
                {loadedModel ? loadedModel.name : 'هیچ مدلی بارگذاری نشده'}
              </div>
              <div className="text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>
                Backend: {status?.backend || 'llamacpp'} • GPU: {status?.gpuBackend || 'cpu'}
              </div>
            </div>
            {loadedModel && (
              <button
                onClick={unloadModel}
                disabled={busy === 'unload'}
                className="nex-click nex-focus flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50"
                style={{ background: 'transparent', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}
                title="تخلیه مدل"
              >
                {busy === 'unload' ? <Loader2 size={10} className="animate-spin" /> : <Square size={10} />}
                تخلیه
              </button>
            )}
          </div>

          {/* Telemetry grid */}
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <Telemetry
              icon={<Gauge size={10} />}
              label="توکن/ثانیه"
              value={tokensPerSec ? tokensPerSec.toFixed(1) : '—'}
              highlight={inferenceActive}
            />
            <Telemetry
              icon={<Activity size={10} />}
              label="استنتاج"
              value={inferenceActive ? 'فعال' : (status?.lastInference ? 'تکمیل' : '—')}
              highlight={inferenceActive}
            />
            <Telemetry
              icon={<Cpu size={10} />}
              label="مدل‌ها"
              value={`${status?.installedModels ?? 0} نصب`}
            />
            <Telemetry
              icon={<MemoryStick size={10} />}
              label="کانتکست"
              value={status?.lastInference?.contextMaxTokens ? `${status.lastInference.contextMaxTokens}` : '—'}
            />
          </div>

          {/* Categories */}
          {status?.modelsByCategory && Object.keys(status.modelsByCategory).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {Object.entries(status.modelsByCategory).map(([cat, count]) => (
                <span key={cat} className="text-[9px] px-1.5 py-0.5 rounded" style={{
                  background: `${CATEGORY_COLORS[cat] || '#3b82f6'}22`,
                  color: CATEGORY_COLORS[cat] || '#3b82f6',
                }}>
                  {CATEGORY_LABELS_FA[cat] || cat}: {count as number}
                </span>
              ))}
            </div>
          )}

          {/* Abort button (during inference) */}
          {inferenceActive && (
            <button
              onClick={abortInference}
              className="mt-2 w-full nex-click nex-focus flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}
            >
              <Square size={10} /> لغو استنتاج
            </button>
          )}
        </div>

        {/* Hardware card */}
        {status?.hardware && (
          <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
            <div className="flex items-center gap-1.5 mb-2">
              <HardDrive size={11} style={{ color: 'var(--nex-text-muted)' }} />
              <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>
                سخت‌افزار
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div>
                <div style={{ color: 'var(--nex-text-muted)' }}>CPU</div>
                <div style={{ color: 'var(--nex-text)' }}>{status.hardware.cpuCores} هسته / {status.hardware.cpuThreads} رشته</div>
              </div>
              <div>
                <div style={{ color: 'var(--nex-text-muted)' }}>RAM</div>
                <div style={{ color: 'var(--nex-text)' }}>{formatBytes(status.hardware.ramTotalBytes)}</div>
              </div>
              {status.hardware.gpu && (
                <>
                  <div>
                    <div style={{ color: 'var(--nex-text-muted)' }}>GPU</div>
                    <div style={{ color: 'var(--nex-text)' }}>{status.hardware.gpu.name}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--nex-text-muted)' }}>VRAM</div>
                    <div style={{ color: 'var(--nex-text)' }}>{formatBytes(status.hardware.gpu.vramTotalBytes)}</div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Installed models list */}
        <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Network size={11} style={{ color: 'var(--nex-accent)' }} />
            <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>
              مدل‌های نصب‌شده ({models.length})
            </span>
          </div>
          {models.length === 0 ? (
            <div className="text-center py-4 text-[11px]" style={{ color: 'var(--nex-text-muted)' }}>
              هیچ مدلی نصب نشده. از پنل Setup یک مدل GGUF اضافه کنید.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto nex-scroll">
              {models.map((m) => {
                const catColor = CATEGORY_COLORS[m.category] || '#3b82f6';
                return (
                  <div key={m.id} className="p-1.5 rounded text-[10px]" style={{
                    background: m.loaded ? `${catColor}11` : 'var(--nex-bg)',
                    border: `1px solid ${m.loaded ? `${catColor}55` : 'var(--nex-panel-border)'}`,
                  }}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      {m.loaded ? (
                        <CheckCircle2 size={10} style={{ color: catColor }} className="shrink-0" />
                      ) : (
                        <Brain size={10} style={{ color: 'var(--nex-text-muted)' }} className="shrink-0" />
                      )}
                      <span className="font-medium truncate flex-1" style={{ color: 'var(--nex-text)' }}>
                        {m.name}
                      </span>
                      {!m.canRun && (
                        <span title={m.hardwareVerdict.reason} className="text-[8px]" style={{ color: '#fca5a5' }}>
                          ⚠ غیرقابل‌اجرا
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[8px] ml-4" style={{ color: 'var(--nex-text-muted)' }}>
                      <span>{CATEGORY_LABELS_FA[m.category] || m.category}</span>
                      <span>•</span>
                      <span>{formatBytes(m.sizeBytes)}</span>
                      {m.quantization && <><span>•</span><span>{m.quantization}</span></>}
                      {m.parameterCount && <><span>•</span><span>{m.parameterCount}</span></>}
                      <span>•</span>
                      <span>ctx {m.contextSize}</span>
                    </div>
                    {!m.loaded && m.canRun && (
                      <button
                        onClick={() => loadModel(m.id)}
                        disabled={busy !== null}
                        className="mt-1 ml-4 nex-click nex-focus flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium disabled:opacity-50"
                        style={{ background: `${catColor}22`, color: catColor, border: `1px solid ${catColor}44` }}
                      >
                        {busy === m.id ? <Loader2 size={8} className="animate-spin" /> : <Play size={8} />}
                        بارگذاری
                      </button>
                    )}
                    {!m.canRun && (
                      <div className="mt-0.5 ml-4 text-[8px]" style={{ color: 'var(--nex-text-muted)' }}>
                        {m.hardwareVerdict.reason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Security note */}
        <div className="p-2 rounded-lg text-[9px] flex items-start gap-1.5" style={{ background: 'rgba(34,197,94,0.06)', color: 'var(--nex-text-muted)' }}>
          <ShieldCheck size={10} className="mt-0.5 shrink-0" style={{ color: 'var(--nex-success)' }} />
          <span>
            تمام استنتاج محلی و آفلاین است (node-llama-cpp). هیچ API ابری استفاده نمی‌شود. بارگذاری/تخلیه مدل ایمن است (فقط فایل دیسک را می‌خواند). نصب مدل جدید نیازمند اجازه است.
          </span>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-3 left-3 right-3 p-2 rounded-lg text-[11px] nex-animate-in pointer-events-none" style={{
          background: toast.kind === 'ok' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
          color: toast.kind === 'ok' ? '#86efac' : '#fca5a5',
          border: `1px solid ${toast.kind === 'ok' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          zIndex: 25,
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function Telemetry({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="p-1.5 rounded" style={{ background: 'var(--nex-bg)' }}>
      <div className="flex items-center gap-1" style={{ color: 'var(--nex-text-muted)' }}>
        {icon}
        <span className="text-[9px]">{label}</span>
      </div>
      <div className="text-sm font-bold" style={{ color: highlight ? 'var(--nex-accent)' : 'var(--nex-text)' }}>
        {value}
      </div>
    </div>
  );
}
