/**
 * NEX AI — Runtime Setup Wizard Panel (Phase 46 UI)
 *
 * First-run setup center: shows system info, detected components,
 * missing components, and recommendations — all in Persian.
 *
 * CRITICAL: NEVER downloads/installs without explicit user permission.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Cpu, MemoryStick, Gauge, HardDrive, CheckCircle2, XCircle,
  Loader2, RefreshCw, Download, AlertTriangle, Sparkles,
  Wrench, Mic, Eye, Brain, FileText,
} from 'lucide-react';

interface SetupState {
  loading: boolean;
  state: any | null;
  summary: string | null;
  error: string | null;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  'llm': <Brain size={12} />,
  'voice-stt': <Mic size={12} />,
  'voice-tts': <Mic size={12} />,
  'vision': <Eye size={12} />,
  'tool': <Wrench size={12} />,
};

const TYPE_LABELS: Record<string, string> = {
  'llm': 'هوش مصنوعی',
  'voice-stt': 'تشخیص گفتار',
  'voice-tts': 'تولید گفتار',
  'vision': 'بینایی',
  'tool': 'ابزار',
};

export default function RuntimeSetupPanel() {
  const [setup, setSetup] = useState<SetupState>({
    loading: true,
    state: null,
    summary: null,
    error: null,
  });

  const scan = useCallback(async () => {
    setSetup((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await window.nexAPI.runtimeSetupSummary();
      setSetup({
        loading: false,
        state: res.success ? res.state : null,
        summary: res.success ? (res.summary ?? null) : null,
        error: res.success ? null : (res.error ?? 'Unknown error'),
      });
    } catch (err: any) {
      setSetup((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, []);

  useEffect(() => { scan(); }, [scan]);

  if (setup.loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin" style={{ color: 'var(--nex-accent)' }} />
          <span className="text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>در حال بررسی سیستم...</span>
        </div>
      </div>
    );
  }

  if (setup.error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
        <XCircle size={32} style={{ color: 'var(--nex-error)' }} />
        <p className="text-xs" style={{ color: 'var(--nex-text-muted)' }}>خطا: {setup.error}</p>
        <button onClick={scan} className="nex-click nex-focus px-3 py-1.5 rounded-lg text-xs nex-glass-accent" style={{ color: 'var(--nex-accent-text)' }}>
          تلاش مجدد
        </button>
      </div>
    );
  }

  const st = setup.state;

  return (
    <div className="flex flex-col h-full overflow-y-auto nex-scrollbar">
      <div className="flex-1 p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={16} style={{ color: 'var(--nex-accent)' }} />
            <h2 className="text-sm font-semibold tracking-wide" style={{ color: 'var(--nex-text)' }}>
              NEX Runtime Center
            </h2>
          </div>
          <button onClick={scan} className="flex items-center gap-1 nex-click p-1.5 rounded-lg text-[9px]" style={{ border: '1px solid var(--nex-glass-border)', color: 'var(--nex-text-muted)' }}>
            <RefreshCw size={10} /> اسکن مجدد
          </button>
        </div>

        {/* System Info */}
        {st?.hardware && (
          <Card title="سیستم" icon={<Cpu size={12} />}>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <Stat label="CPU" value={`${st.hardware.cpuCores || 'N/A'} هسته`} />
              <Stat label="Threads" value={String(st.hardware.cpuThreads || 'N/A')} />
              <Stat label="RAM" value={`${(st.hardware.ramTotalBytes / 1e9).toFixed(1)} GB`} />
              <Stat label="OS" value={st.os} />
              {st.hardware.gpu ? (
                <>
                  <Stat label="GPU" value={st.hardware.gpu.name} />
                  <Stat label="VRAM" value={`${(st.hardware.gpu.vramTotalBytes / 1e9).toFixed(1)} GB`} />
                  <Stat label="Backend" value={st.hardware.detectedBackend} />
                </>
              ) : (
                <div className="col-span-2" style={{ color: 'var(--nex-text-muted)' }}>GPU: ندارد (فقط CPU)</div>
              )}
              <Stat label="Portable" value={st.isPortable ? 'بله' : 'خیر'} />
            </div>
          </Card>
        )}

        {/* Component Status */}
        {st?.components && (
          <Card title="کامپوننت‌ها" icon={<HardDrive size={12} />}>
            <div className="space-y-1.5">
              {st.components.map((comp: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-[10px] py-1">
                  <div className="flex items-center gap-2">
                    {comp.status === 'installed' ? (
                      <CheckCircle2 size={12} style={{ color: 'var(--nex-success)' }} />
                    ) : comp.status === 'partial' ? (
                      <AlertTriangle size={12} style={{ color: 'var(--nex-warning)' }} />
                    ) : (
                      <XCircle size={12} style={{ color: 'var(--nex-error)' }} />
                    )}
                    <span style={{ color: 'var(--nex-text)' }}>{comp.name}</span>
                    {TYPE_ICONS[comp.type] && (
                      <span style={{ color: 'var(--nex-text-muted)' }}>{TYPE_ICONS[comp.type]}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span style={{ color: 'var(--nex-text-muted)' }}>{TYPE_LABELS[comp.type] || comp.type}</span>
                    {comp.isEssential && (
                      <span className="text-[8px] px-1 rounded" style={{ background: 'rgba(255,200,0,0.15)', color: 'var(--nex-warning)' }}>
                        ضروری
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {st.essentialMissing > 0 && (
                <div className="text-[9px] pt-2 mt-1.5 border-t border-[var(--nex-glass-border)]" style={{ color: 'var(--nex-error)' }}>
                  ⚠️ {st.essentialMissing} کامپوننت ضروری نصب نشده است
                </div>
              )}
              {st.essentialMissing === 0 && (
                <div className="text-[9px] pt-2 mt-1.5 border-t border-[var(--nex-glass-border)]" style={{ color: 'var(--nex-success)' }}>
                  ✓ تمام کامپوننت‌های ضروری نصب شده‌اند
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Recommendations */}
        {st?.recommendations && st.recommendations.length > 0 && (
          <Card title="پیشنهادات" icon={<Download size={12} />}>
            <div className="space-y-2">
              {st.recommendations.map((rec: any, i: number) => {
                const comp = rec.component;
                if (!comp) return null;
                return (
                  <div key={i} className="rounded-lg p-2.5" style={{ background: 'var(--nex-glass-bg)', border: '1px solid var(--nex-glass-border)' }}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-semibold" style={{ color: 'var(--nex-accent-text)' }}>{comp.name}</span>
                          <span className="text-[8px] px-1 rounded" style={{ background: 'var(--nex-glass-bg)', color: 'var(--nex-text-muted)' }}>
                            {TYPE_LABELS[comp.type] || comp.type}
                          </span>
                        </div>
                        <p className="text-[9px] mt-0.5" style={{ color: 'var(--nex-text-muted)' }}>{comp.purposeFa}</p>
                        <p className="text-[9px] mt-1" style={{ color: 'var(--nex-text-muted)' }}>
                          حجم: {(comp.sizeBytes / 1e9).toFixed(1)} GB
                        </p>
                        {comp.requiredVRAM > 0 && (
                          <p className="text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>
                            VRAM: {comp.requiredVRAM} GB
                          </p>
                        )}
                        <div className="flex items-center gap-1 mt-1">
                          <span className="text-[9px]" style={{
                            color: rec.hardwareFit === 'perfect' ? 'var(--nex-success)' :
                                   rec.hardwareFit === 'good' ? 'var(--nex-accent-text)' :
                                   'var(--nex-warning)'
                          }}>
                            {rec.hardwareFit === 'perfect' ? 'تطابق عالی' : rec.hardwareFit === 'good' ? 'تطابق خوب' : 'حداقل'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Permission Notice */}
        <div className="rounded-lg p-2.5 text-[9px]" style={{ background: 'var(--nex-glass-bg)', border: '1px solid var(--nex-glass-border)', color: 'var(--nex-text-muted)' }}>
          <p className="flex items-center gap-1.5">
            <AlertTriangle size={10} />
            NEX AI هرگز چیزی را بدون اجازه صریح شما دانلود یا نصب نمی‌کند.
            برای نصب هر کامپوننت، در چت "تایید می‌کنم" را بنویسید.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Helper Components ─────────────────────────────────────────────────────

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--nex-panel-solid)', border: '1px solid var(--nex-glass-border)' }}>
      <div className="flex items-center gap-1.5 mb-2">
        <span style={{ color: 'var(--nex-accent)' }}>{icon}</span>
        <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: 'var(--nex-text-muted)' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[var(--nex-text-muted)]">{label}</span>
      <span style={{ color: 'var(--nex-text)' }}>{value}</span>
    </div>
  );
}
