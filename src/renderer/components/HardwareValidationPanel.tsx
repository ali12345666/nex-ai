/**
 * NEX AI — Hardware Validation Panel (Phase 65)
 *
 * Shows hardware diagnostics, inference benchmarks, and pipeline validation.
 * Lets the user run a full validation: hardware → model → inference → Persian → conversation.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity, RefreshCw, Cpu, HardDrive, Zap, Gauge, Play, CheckCircle2,
  XCircle, Loader2, ShieldCheck, AlertCircle, Brain, Globe, MessageSquare,
} from 'lucide-react';

function formatBytes(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function HardwareValidationPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [detailedStatus, setDetailedStatus] = useState<any>(null);
  const [validation, setValidation] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [diagRes, statusRes] = await Promise.all([
        window.nexAPI.hwDiagnostics(),
        window.nexAPI.hwDetailedStatus(),
      ]);
      if (diagRes.success) setDiagnostics(diagRes.diagnostics);
      if (statusRes.success) setDetailedStatus(statusRes.status);
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const showToast = (kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 5000);
  };

  const runValidation = async () => {
    setBusy(true); setError(null); setValidation(null);
    try {
      const res = await window.nexAPI.hwValidatePipeline();
      if (res.success) {
        setValidation(res.result);
        showToast(res.result.passed ? 'ok' : 'err',
          res.result.passed ? 'اعتبارسنجی کامل موفق بود ✅' : 'اعتبارسنجی ناقص بود');
      } else {
        setError(res.error || 'اعتبارسنجی ناموفق بود');
      }
      await refresh();
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        <div className="flex items-center gap-2">
          <Activity size={16} style={{ color: 'var(--nex-accent)' }} />
          <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>HARDWARE VALIDATION</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={runValidation} disabled={busy} className="nex-click nex-focus flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}>
            {busy ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />} اعتبارسنجی کامل
          </button>
          <button onClick={refresh} disabled={loading} className="p-1 rounded transition-colors hover:bg-white/[0.06] disabled:opacity-50" style={{ color: 'var(--nex-text-muted)' }}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto nex-scroll p-3 space-y-3" style={{ maxHeight: 'calc(100vh - 180px)' }}>
        {error && (
          <div className="flex items-start gap-2 p-2 rounded-lg text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>
            <AlertCircle size={12} className="mt-0.5 shrink-0" /><span>{error}</span>
          </div>
        )}

        {/* Hardware diagnostics */}
        {diagnostics && (
          <div className="p-3 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
            <div className="flex items-center gap-1.5 mb-2"><Cpu size={11} style={{ color: 'var(--nex-accent)' }} /><span className="text-[10px] font-medium" style={{ color: 'var(--nex-text-muted)' }}>سخت‌افزار</span></div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div><span style={{ color: 'var(--nex-text-muted)' }}>CPU:</span> <span style={{ color: 'var(--nex-text)' }}>{diagnostics.cpuModel}</span></div>
              <div><span style={{ color: 'var(--nex-text-muted)' }}>هسته/رشته:</span> <span style={{ color: 'var(--nex-text)' }}>{diagnostics.cpuCores}/{diagnostics.cpuThreads}</span></div>
              <div><span style={{ color: 'var(--nex-text-muted)' }}>RAM کل:</span> <span style={{ color: 'var(--nex-text)' }}>{formatBytes(diagnostics.ramTotalBytes)}</span></div>
              <div><span style={{ color: 'var(--nex-text-muted)' }}>RAM آزاد:</span> <span style={{ color: 'var(--nex-text)' }}>{formatBytes(diagnostics.ramFreeBytes)}</span></div>
              <div><span style={{ color: 'var(--nex-text-muted)' }}>RAM استفاده:</span> <span style={{ color: diagnostics.ramUsagePercent > 80 ? '#fca5a5' : 'var(--nex-text)' }}>{diagnostics.ramUsagePercent}%</span></div>
              <div><span style={{ color: 'var(--nex-text-muted)' }}>پلتفرم:</span> <span style={{ color: 'var(--nex-text)' }}>{diagnostics.platform}</span></div>
              {diagnostics.gpu && (
                <>
                  <div className="col-span-2"><span style={{ color: 'var(--nex-text-muted)' }}>GPU:</span> <span style={{ color: 'var(--nex-text)' }}>{diagnostics.gpu.name}</span></div>
                  <div><span style={{ color: 'var(--nex-text-muted)' }}>VRAM کل:</span> <span style={{ color: 'var(--nex-text)' }}>{formatBytes(diagnostics.gpu.vramTotalBytes)}</span></div>
                  <div><span style={{ color: 'var(--nex-text-muted)' }}>VRAM آزاد:</span> <span style={{ color: 'var(--nex-text)' }}>{formatBytes(diagnostics.gpu.vramFreeBytes)}</span></div>
                </>
              )}
              <div><span style={{ color: 'var(--nex-text-muted)' }}>backend:</span> <span style={{ color: diagnostics.llamaGpuBackend === 'cpu' ? '#f59e0b' : 'var(--nex-success)' }}>{diagnostics.llamaGpuBackend}</span></div>
              <div><span style={{ color: 'var(--nex-text-muted)' }}>RAM پردازش:</span> <span style={{ color: 'var(--nex-text)' }}>{formatBytes(diagnostics.processRssBytes)}</span></div>
            </div>
          </div>
        )}

        {/* Detailed runtime status */}
        {detailedStatus && (
          <div className="p-3 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
            <div className="flex items-center gap-1.5 mb-2"><Gauge size={11} style={{ color: 'var(--nex-accent)' }} /><span className="text-[10px] font-medium" style={{ color: 'var(--nex-text-muted)' }}>وضعیت رانتایم</span></div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div><span style={{ color: 'var(--nex-text-muted)' }}>مدل فعال:</span> <span style={{ color: 'var(--nex-text)' }}>{detailedStatus.modelName || 'نصب نیست'}</span></div>
              <div><span style={{ color: 'var(--nex-text-muted)' }}>بارگذاری شده:</span> <span style={{ color: detailedStatus.modelLoaded ? 'var(--nex-success)' : 'var(--nex-text-muted)' }}>{detailedStatus.modelLoaded ? '✓' : '✗'}</span></div>
              <div><span style={{ color: 'var(--nex-text-muted)' }}>حجم مدل:</span> <span style={{ color: 'var(--nex-text)' }}>{formatBytes(detailedStatus.modelSizeBytes)}</span></div>
              <div><span style={{ color: 'var(--nex-text-muted)' }}>پارامترها:</span> <span style={{ color: 'var(--nex-text)' }}>{detailedStatus.parameterCount || '—'}</span></div>
              <div><span style={{ color: 'var(--nex-text-muted)' }}>کوانتیزه:</span> <span style={{ color: 'var(--nex-text)' }}>{detailedStatus.quantization || '—'}</span></div>
              <div><span style={{ color: 'var(--nex-text-muted)' }}>کانتکست:</span> <span style={{ color: 'var(--nex-text)' }}>{detailedStatus.contextSize} توکن</span></div>
              <div><span style={{ color: 'var(--nex-text-muted)' }}>GPU layers:</span> <span style={{ color: 'var(--nex-text)' }}>{detailedStatus.gpuLayers === -1 ? 'خودکار' : detailedStatus.gpuLayers === 0 ? 'CPU' : detailedStatus.gpuLayers}</span></div>
              <div><span style={{ color: 'var(--nex-text-muted)' }}>GPU backend:</span> <span style={{ color: detailedStatus.gpuBackend === 'cpu' ? '#f59e0b' : 'var(--nex-success)' }}>{detailedStatus.gpuBackend}</span></div>
              <div><span style={{ color: 'var(--nex-text-muted)' }}>رشته‌ها:</span> <span style={{ color: 'var(--nex-text)' }}>{detailedStatus.threads}</span></div>
              <div><span style={{ color: 'var(--nex-text-muted)' }}>توکن/ثانیه:</span> <span style={{ color: 'var(--nex-accent)' }}>{detailedStatus.lastTokensPerSecond !== null ? detailedStatus.lastTokensPerSecond.toFixed(1) : '—'}</span></div>
              {detailedStatus.contextMaxTokens !== null && <div><span style={{ color: 'var(--nex-text-muted)' }}>ctx max:</span> <span style={{ color: 'var(--nex-text)' }}>{detailedStatus.contextMaxTokens}</span></div>}
              {detailedStatus.lastTokensGenerated !== null && <div><span style={{ color: 'var(--nex-text-muted)' }}>توکن آخرین:</span> <span style={{ color: 'var(--nex-text)' }}>{detailedStatus.lastTokensGenerated}</span></div>}
              {detailedStatus.inferenceActive && <div className="col-span-2"><span style={{ color: '#06b6d4' }}>● استنتاج فعال</span></div>}
            </div>
            {detailedStatus.hardwareVerdict && (
              <div className="mt-2 p-1.5 rounded text-[9px]" style={{ background: 'var(--nex-bg)', color: detailedStatus.hardwareVerdict.canRun ? 'var(--nex-success)' : '#fca5a5' }}>
                {detailedStatus.hardwareVerdict.canRun ? '✓' : '⚠'} {detailedStatus.hardwareVerdict.reason}
              </div>
            )}
          </div>
        )}

        {/* Validation result */}
        {validation && (
          <div className="p-3 rounded-lg nex-glass" style={{ border: `1px solid ${validation.passed ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
            <div className="flex items-center gap-1.5 mb-2">
              {validation.passed ? <CheckCircle2 size={14} style={{ color: 'var(--nex-success)' }} /> : <XCircle size={14} style={{ color: '#fca5a5' }} />}
              <span className="text-[12px] font-bold" style={{ color: validation.passed ? 'var(--nex-success)' : '#fca5a5' }}>
                {validation.passed ? 'اعتبارسنجی کامل موفق ✅' : 'اعتبارسنجی ناقص'}
              </span>
              <span className="ml-auto text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>{(validation.durationMs / 1000).toFixed(1)}s</span>
            </div>
            {/* Pipeline stages */}
            <div className="space-y-1 mb-2">
              {['hardware-diagnostics', 'model-check', 'inference-benchmark', 'persian-test', 'conversation-test'].map(stage => {
                const passed = validation.stagesPassed.includes(stage);
                const failed = validation.stagesFailed.includes(stage);
                const labels: Record<string, string> = { 'hardware-diagnostics': 'سخت‌افزار', 'model-check': 'بررسی مدل', 'inference-benchmark': 'بنچمارک استنتاج', 'persian-test': 'تست فارسی', 'conversation-test': 'تست مکالمه' };
                return (
                  <div key={stage} className="flex items-center gap-1.5 text-[10px]">
                    {passed ? <CheckCircle2 size={9} style={{ color: 'var(--nex-success)' }} /> : failed ? <XCircle size={9} style={{ color: '#fca5a5' }} /> : <Loader2 size={9} className="animate-spin" style={{ color: 'var(--nex-text-muted)' }} />}
                    <span style={{ color: passed ? 'var(--nex-success)' : failed ? '#fca5a5' : 'var(--nex-text-muted)' }}>{labels[stage] || stage}</span>
                  </div>
                );
              })}
            </div>
            {/* Benchmark */}
            {validation.benchmark?.inferenceCompleted && (
              <div className="p-2 rounded text-[10px] mb-1" style={{ background: 'var(--nex-bg)' }}>
                <div className="flex items-center gap-1 mb-1"><Zap size={9} style={{ color: 'var(--nex-accent)' }} /><span style={{ color: 'var(--nex-text-muted)' }}>بنچمارک</span></div>
                <div style={{ color: 'var(--nex-text)' }}>{validation.benchmark.tokensPerSecond.toFixed(1)} توکن/ثانیه • {validation.benchmark.tokensGenerated} توکن • {(validation.benchmark.durationMs / 1000).toFixed(1)}s</div>
                <div className="mt-1" style={{ color: 'var(--nex-text-muted)' }}>پاسخ: "{validation.benchmark.response.slice(0, 100)}..."</div>
              </div>
            )}
            {/* Persian test */}
            {validation.persianTest && (
              <div className="p-2 rounded text-[10px] mb-1" style={{ background: 'var(--nex-bg)' }}>
                <div className="flex items-center gap-1 mb-1"><Globe size={9} style={{ color: 'var(--nex-accent)' }} /><span style={{ color: 'var(--nex-text-muted)' }}>تست فارسی</span></div>
                <div style={{ color: 'var(--nex-text-muted)' }}>سوال: {validation.persianTest.prompt}</div>
                <div style={{ color: 'var(--nex-text)' }}>پاسخ: {validation.persianTest.response.slice(0, 100)}</div>
              </div>
            )}
            {/* Conversation test */}
            {validation.conversationTest && (
              <div className="p-2 rounded text-[10px]" style={{ background: 'var(--nex-bg)' }}>
                <div className="flex items-center gap-1 mb-1"><MessageSquare size={9} style={{ color: 'var(--nex-accent)' }} /><span style={{ color: 'var(--nex-text-muted)' }}>مکالمه ({validation.conversationTest.turns} نوبت)</span></div>
                {validation.conversationTest.responses.map((r: string, i: number) => (
                  <div key={i} className="text-[9px] mt-0.5" style={{ color: r.startsWith('[ERROR') ? '#fca5a5' : 'var(--text-muted)' }}>نوبت {i + 1}: {r.startsWith('[ERROR') ? r : `"${r.slice(0, 60)}..."`}</div>
                ))}
              </div>
            )}
            {/* Errors */}
            {validation.errors.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {validation.errors.map((e: string, i: number) => <div key={i} className="text-[9px]" style={{ color: '#fca5a5' }}>• {e}</div>)}
              </div>
            )}
          </div>
        )}

        <div className="p-2 rounded-lg text-[9px] flex items-start gap-1.5" style={{ background: 'rgba(34,197,94,0.06)', color: 'var(--nex-text-muted)' }}>
          <ShieldCheck size={10} className="mt-0.5 shrink-0" style={{ color: 'var(--nex-success)' }} />
          <span>تمام تست‌ها محلی و آفلاین هستند (node-llama-cpp). بدون API ابری. فقط خواندن سخت‌افزار — بدون تغییر فایل.</span>
        </div>
      </div>

      {toast && (
        <div className="absolute bottom-3 left-3 right-3 p-2 rounded-lg text-[11px] nex-animate-in pointer-events-none" style={{
          background: toast.kind === 'ok' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
          color: toast.kind === 'ok' ? '#86efac' : '#fca5a5',
          border: `1px solid ${toast.kind === 'ok' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`, zIndex: 25,
        }}>{toast.msg}</div>
      )}
    </div>
  );
}
