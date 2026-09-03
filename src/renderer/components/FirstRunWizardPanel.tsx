/**
 * NEX AI — First-Run Wizard Panel (Phase 64)
 *
 * Shows the first-run model activation wizard when no model is installed.
 * Provides one-click "Install Recommended Model" (Qwen2.5 0.5B) and
 * displays the activation pipeline progress.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Rocket, Download, CheckCircle2, Loader2, AlertCircle, Brain, Zap,
  ShieldCheck, Cpu, HardDrive, Globe, Sparkles, X,
} from 'lucide-react';

function formatBytes(n: number): string {
  if (!n) return '0 B';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function FirstRunWizardPanel() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<any>(null);
  const [recommended, setRecommended] = useState<any>(null);
  const [installing, setInstalling] = useState(false);
  const [activationResult, setActivationResult] = useState<any>(null);
  const [interactionResult, setInteractionResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [showPermission, setShowPermission] = useState(false);
  const [permissionInput, setPermissionInput] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [stateRes, modelRes] = await Promise.all([
        window.nexAPI.firstrunState(),
        window.nexAPI.firstrunRecommendedModel(),
      ]);
      if (stateRes.success) setState(stateRes.state);
      if (modelRes.success) setRecommended(modelRes.model);
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Subscribe to permission requests (reuse the deployment panel's permission channel)
  useEffect(() => {
    const unsub = window.nexAPI.onModelDeploymentPermissionRequest((req: any) => {
      setShowPermission(true);
      setPermissionInput('');
    });
    return unsub;
  }, []);

  const showToast = (kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 5000);
  };

  const handleInstall = async () => {
    setInstalling(true); setError(null); setActivationResult(null); setInteractionResult(null);
    try {
      const res = await window.nexAPI.firstrunInstallRecommended();
      if (res.success && res.result?.success) {
        setActivationResult(res.result);
        showToast('ok', `مدل نصب و فعال شد: ${res.result.modelName}`);
        // Test interaction
        const testRes = await window.nexAPI.firstrunTestInteraction('سلام، خودت را معرفی کن.');
        if (testRes.success && testRes.result?.success) {
          setInteractionResult(testRes.result);
          showToast('ok', 'NEX Brain آماده است! ✅');
        }
      } else {
        setError(res.error || res.result?.error || 'نصب ناموفق بود');
        if (res.result) setActivationResult(res.result);
      }
      await refresh();
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setInstalling(false);
    }
  };

  const respondPermission = async (response: string) => {
    await window.nexAPI.modelDeployRespondPermission(response);
    setShowPermission(false);
    setPermissionInput('');
  };

  const brainReady = state?.brainReady ?? false;

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        <div className="flex items-center gap-2">
          <Rocket size={16} style={{ color: 'var(--nex-accent)' }} />
          <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>FIRST RUN</span>
          {brainReady && (
            <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: '#86efac' }}>
              <CheckCircle2 size={8} /> NEX Brain Ready
            </span>
          )}
        </div>
        <button onClick={refresh} disabled={loading} className="p-1 rounded transition-colors hover:bg-white/[0.06] disabled:opacity-50" style={{ color: 'var(--nex-text-muted)' }}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Rocket size={12} />}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto nex-scroll p-4 space-y-4" style={{ maxHeight: 'calc(100vh - 180px)' }}>
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium mb-1">خطا</div>
              <div>{error}</div>
            </div>
          </div>
        )}

        {/* ═══ No model installed → Wizard ═══ */}
        {state?.needsModel && !installing && !activationResult?.success && (
          <div className="text-center py-4">
            <div className="flex items-center justify-center mb-4">
              <div className="rounded-full flex items-center justify-center" style={{ width: 64, height: 64, background: 'var(--nex-accent-dim)', border: '2px solid var(--nex-accent-glow)' }}>
                <Brain size={28} style={{ color: 'var(--nex-accent)' }} />
              </div>
            </div>
            <h2 className="text-sm font-bold mb-2" style={{ color: 'var(--nex-text)' }}>NEX به یک مدل هوش مصنوعی محلی نیاز دارد</h2>
            <p className="text-[11px] mb-4" style={{ color: 'var(--nex-text-muted)' }}>
              برای شروع، یک مدل سبک و سریع پیشنهاد می‌شود که روی هر سخت‌افزاری کار می‌کند.
            </p>

            {/* Recommended model card */}
            {recommended && (
              <div className="p-4 rounded-xl nex-glass-strong text-right" style={{ border: '1px solid var(--nex-accent-glow)', maxWidth: 360, margin: '0 auto' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={14} style={{ color: 'var(--nex-accent)' }} />
                  <span className="text-[11px] font-medium" style={{ color: 'var(--nex-accent-text)' }}>مدل پیشنهادی</span>
                </div>
                <div className="text-[13px] font-bold mb-1" style={{ color: 'var(--nex-text)' }}>{recommended.nameFa}</div>
                <div className="text-[10px] mb-3" style={{ color: 'var(--nex-text-muted)' }}>{recommended.descriptionFa}</div>
                <div className="grid grid-cols-2 gap-2 text-[10px] mb-3">
                  <div className="flex items-center gap-1">
                    <HardDrive size={9} style={{ color: 'var(--nex-text-muted)' }} />
                    <span style={{ color: 'var(--nex-text-muted)' }}>حجم:</span>
                    <span style={{ color: 'var(--nex-text)' }}>{recommended.sizeGB} GB</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Cpu size={9} style={{ color: 'var(--nex-text-muted)' }} />
                    <span style={{ color: 'var(--nex-text-muted)' }}>RAM:</span>
                    <span style={{ color: 'var(--nex-text)' }}>{recommended.requiredRAM} GB</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Zap size={9} style={{ color: 'var(--nex-text-muted)' }} />
                    <span style={{ color: 'var(--nex-text-muted)' }}>VRAM:</span>
                    <span style={{ color: 'var(--nex-text)' }}>{recommended.requiredVRAM === 0 ? 'بدون GPU' : `${recommended.requiredVRAM} GB`}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Globe size={9} style={{ color: 'var(--nex-text-muted)' }} />
                    <span style={{ color: 'var(--nex-text-muted)' }}>فارسی:</span>
                    <span style={{ color: recommended.persianSupport ? 'var(--nex-success)' : 'var(--nex-text-muted)' }}>
                      {recommended.persianSupport ? '✓' : '✗'}
                    </span>
                  </div>
                </div>
                <p className="text-[9px] p-2 rounded mb-3" style={{ background: 'rgba(34,197,94,0.06)', color: 'var(--nex-text-muted)' }}>
                  {recommended.reasonFa}
                </p>
                <button onClick={handleInstall} disabled={installing}
                  className="nex-click nex-focus w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-bold disabled:opacity-50"
                  style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}>
                  <Download size={14} /> نصب مدل پیشنهادی
                </button>
                <p className="text-[9px] mt-2" style={{ color: 'var(--nex-text-muted)' }}>
                  دانلود نیازمند اجازه شماست. فقط HTTPS. تمام پردازش محلی است.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ═══ Installing → Progress ═══ */}
        {installing && (
          <div className="text-center py-8">
            <Loader2 size={32} className="animate-spin mx-auto mb-4" style={{ color: 'var(--nex-accent)' }} />
            <h2 className="text-sm font-bold mb-2" style={{ color: 'var(--nex-text)' }}>در حال نصب مدل...</h2>
            <p className="text-[11px]" style={{ color: 'var(--nex-text-muted)' }}>
              دانلود → تأیید → ثبت → آزمایش استنتاج
            </p>
            <p className="text-[10px] mt-2" style={{ color: 'var(--nex-text-muted)' }}>
              لطفاً صبر کنید. این ممکن است چند دقیقه طول بکشد.
            </p>
          </div>
        )}

        {/* ═══ Activation result ═══ */}
        {activationResult && (
          <div className="p-4 rounded-xl nex-glass" style={{ border: `1px solid ${activationResult.success ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
            <div className="flex items-center gap-2 mb-3">
              {activationResult.success ? <CheckCircle2 size={16} style={{ color: 'var(--nex-success)' }} /> : <X size={16} style={{ color: '#fca5a5' }} />}
              <span className="text-[12px] font-bold" style={{ color: 'var(--nex-text)' }}>
                {activationResult.success ? 'مدل با موفقیت فعال شد!' : 'فعال‌سازی ناموفق بود'}
              </span>
            </div>
            {activationResult.modelName && (
              <div className="text-[11px] mb-2" style={{ color: 'var(--nex-text)' }}>مدل: {activationResult.modelName}</div>
            )}
            {activationResult.inferenceTested && (
              <div className="text-[10px] mb-2" style={{ color: 'var(--nex-text-muted)' }}>
                آزمایش استنتاج: ✓ موفق • {activationResult.tokensPerSecond.toFixed(1)} توکن/ثانیه
              </div>
            )}
            {activationResult.error && (
              <div className="text-[10px] mb-2" style={{ color: '#fca5a5' }}>خطا: {activationResult.error}</div>
            )}
            {activationResult.durationMs > 0 && (
              <div className="text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>
                مدت زمان: {(activationResult.durationMs / 1000).toFixed(1)} ثانیه
              </div>
            )}
          </div>
        )}

        {/* ═══ Interaction test result ═══ */}
        {interactionResult && interactionResult.success && (
          <div className="p-4 rounded-xl nex-glass-strong" style={{ border: '1px solid var(--nex-accent-glow)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Brain size={16} style={{ color: 'var(--nex-accent)' }} />
              <span className="text-[12px] font-bold" style={{ color: 'var(--nex-accent-text)' }}>NEX Brain آماده است! ✅</span>
            </div>
            <div className="p-3 rounded-lg mb-2" style={{ background: 'var(--nex-bg)' }}>
              <div className="text-[10px] mb-1" style={{ color: 'var(--nex-text-muted)' }}>سوال آزمایشی:</div>
              <div className="text-[11px]" style={{ color: 'var(--nex-text)' }}>سلام، خودت را معرفی کن.</div>
            </div>
            <div className="p-3 rounded-lg" style={{ background: 'var(--nex-bg)' }}>
              <div className="text-[10px] mb-1" style={{ color: 'var(--nex-accent)' }}>پاسخ NEX:</div>
              <div className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--nex-text)' }}>
                {interactionResult.response || '(پاسخ خالی)'}
              </div>
              <div className="text-[9px] mt-2" style={{ color: 'var(--nex-text-muted)' }}>
                زبان: {interactionResult.responseLanguage === 'fa' ? 'فارسی' : 'English'} • {interactionResult.tokensPerSecond.toFixed(1)} توکن/ثانیه • {interactionResult.tokensGenerated} توکن
              </div>
            </div>
            <p className="text-[10px] mt-2 text-center" style={{ color: 'var(--nex-success)' }}>
              ✓ تمام پردازش محلی و آفلاین است. هیچ API ابری استفاده نشد.
            </p>
          </div>
        )}

        {/* ═══ Brain ready (model already installed) ═══ */}
        {brainReady && !installing && !activationResult && (
          <div className="text-center py-8">
            <div className="flex items-center justify-center mb-4">
              <div className="rounded-full flex items-center justify-center" style={{ width: 64, height: 64, background: 'rgba(34,197,94,0.15)', border: '2px solid rgba(34,197,94,0.3)' }}>
                <CheckCircle2 size={28} style={{ color: 'var(--nex-success)' }} />
              </div>
            </div>
            <h2 className="text-sm font-bold mb-2" style={{ color: 'var(--nex-success)' }}>NEX Brain آماده است</h2>
            <p className="text-[11px]" style={{ color: 'var(--nex-text-muted)' }}>
              مدل فعال: {state?.activeModelName || 'نامشخص'}
            </p>
            <p className="text-[10px] mt-1" style={{ color: 'var(--nex-text-muted)' }}>
              می‌توانید از پنل Interact با NEX گفتگو کنید.
            </p>
          </div>
        )}

        {/* Security note */}
        <div className="p-2 rounded-lg text-[9px] flex items-start gap-1.5" style={{ background: 'rgba(34,197,94,0.06)', color: 'var(--nex-text-muted)' }}>
          <ShieldCheck size={10} className="mt-0.5 shrink-0" style={{ color: 'var(--nex-success)' }} />
          <span>دانلود نیازمند اجازه صریح است. فقط HTTPS. تأیید چک‌سام و سازگاری سخت‌افزاری. تمام استنتاج محلی و آفلاین (node-llama-cpp).</span>
        </div>
      </div>

      {/* Permission dialog */}
      {showPermission && (
        <div className="absolute inset-0 flex items-end p-3 pointer-events-none" style={{ zIndex: 20 }}>
          <div className="nex-glass-strong w-full p-3 rounded-xl pointer-events-auto" style={{ border: '1px solid var(--nex-accent-glow)' }}>
            <div className="flex items-center gap-1.5 mb-2">
              <ShieldCheck size={13} style={{ color: 'var(--nex-accent)' }} />
              <span className="text-[11px] font-medium" style={{ color: 'var(--nex-accent-text)' }}>درخواست اجازه دانلود</span>
            </div>
            <p className="text-[11px] mb-2" style={{ color: 'var(--nex-text)' }}>دانلود مدل Qwen2.5 0.5B (~0.4 GB)</p>
            <p className="text-[10px] mb-2" style={{ color: 'var(--nex-text-muted)' }}>عبارت: <span style={{ color: 'var(--nex-accent-text)' }}>تایید می‌کنم</span></p>
            <div className="flex gap-1.5">
              <input value={permissionInput} onChange={e => setPermissionInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && permissionInput.trim()) respondPermission(permissionInput); }}
                placeholder="عبارت تأیید..." className="flex-1 px-2 py-1 rounded-lg text-[11px] nex-focus" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }} autoFocus />
              <button onClick={() => respondPermission(permissionInput || 'نه')} disabled={!permissionInput.trim()} className="nex-click nex-focus px-2.5 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}>ارسال</button>
              <button onClick={() => respondPermission('نه')} className="nex-click nex-focus px-2.5 py-1 rounded-lg text-[10px] font-medium" style={{ background: 'transparent', color: 'var(--nex-text-muted)', border: '1px solid var(--nex-panel-border)' }}>رد</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
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
