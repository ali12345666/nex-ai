/**
 * NEX AI — Unified Library Center (Phase 66)
 *
 * Consolidates ALL downloadable/installable resources into ONE panel with
 * internal tabs. Replaces the scattered: Deploy, First Run, Models, Voice,
 * Local AI, Expertise, Universal Knowledge, Runtime panels.
 *
 * Tabs:
 *   1. Recommended — hardware-aware recommendations
 *   2. AI Models — GGUF model browser + install/remove
 *   3. Voice — Whisper STT + Piper TTS
 *   4. Runtime & Tools — llama.cpp, FFmpeg, etc.
 *   5. Knowledge — knowledge packs
 *   6. Installed — unified inventory
 *   7. Downloads — active/completed/failed downloads
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Library, RefreshCw, Star, Brain, Mic, Cpu, BookOpen, CheckCircle2,
  Download, AlertCircle, Loader2, Package, Globe, Zap, Trash2, Play,
  Pause, RotateCw, X, ShieldCheck,
} from 'lucide-react';

type Tab = 'recommended' | 'models' | 'voice' | 'tools' | 'knowledge' | 'installed' | 'downloads';

const TABS: Array<[Tab, string, React.ReactNode]> = [
  ['recommended', 'پیشنهادی', <Star size={11} />],
  ['models', 'مدل‌ها', <Brain size={11} />],
  ['voice', 'صوت', <Mic size={11} />],
  ['tools', 'ابزارها', <Cpu size={11} />],
  ['knowledge', 'دانش', <BookOpen size={11} />],
  ['installed', 'نصب‌شده', <CheckCircle2 size={11} />],
  ['downloads', 'دانلودها', <Download size={11} />],
];

export default function NexLibraryPanel() {
  const [tab, setTab] = useState<Tab>('recommended');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [installed, setInstalled] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [deployStatus, setDeployStatus] = useState<any>(null);
  const [progress, setProgress] = useState<any>(null);
  const [lastResult, setLastResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<any>(null);
  const [permissionInput, setPermissionInput] = useState('');
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, installedRes, statusRes, deployRes] = await Promise.all([
        window.nexAPI.ecosystemCatalog(),
        window.nexAPI.localRuntimeListModels(),
        window.nexAPI.interactionStatus(),
        window.nexAPI.modelDeployStatus(),
      ]);
      if (catRes.success) setCatalog(catRes.catalog || []);
      if (installedRes.success) setInstalled(installedRes.models || []);
      if (statusRes.success) setStatus(statusRes.status);
      if (deployRes.success) setDeployStatus(deployRes.status);
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Subscribe to download progress
  useEffect(() => {
    const unsub = window.nexAPI.onModelDeploymentProgress((prog: any) => setProgress(prog));
    return unsub;
  }, []);

  // Subscribe to permission requests
  useEffect(() => {
    const unsub = window.nexAPI.onModelDeploymentPermissionRequest((req: any) => {
      setPendingPermission(req);
      setPermissionInput('');
    });
    return unsub;
  }, []);

  const showToast = (kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const handleInstallModel = async (url: string, name?: string) => {
    setBusy(true); setError(null); setProgress(null); setLastResult(null);
    try {
      const res = await window.nexAPI.modelDeployDownload({ url, name });
      if (res.success && res.result?.success) {
        setLastResult(res.result);
        setHistory(prev => [res.result, ...prev].slice(0, 20));
        showToast('ok', `مدل نصب شد: ${res.result.modelName}`);
      } else {
        const errResult = res.result || { success: false, error: res.error, stage: 'failed', log: [] };
        setLastResult(errResult);
        setHistory(prev => [errResult, ...prev].slice(0, 20));
        setError(res.error || res.result?.error || 'نصب ناموفق بود');
      }
      await refresh();
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setBusy(false);
    }
  };

  const handleInstallRecommended = async () => {
    setBusy(true); setError(null); setProgress(null); setLastResult(null);
    try {
      const res = await window.nexAPI.firstrunInstallRecommended();
      if (res.success && res.result?.success) {
        setLastResult(res.result);
        showToast('ok', `مدل پیشنهادی نصب شد: ${res.result.modelName}`);
      } else {
        setError(res.error || res.result?.error || 'نصب ناموفق بود');
        if (res.result) setLastResult(res.result);
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveModel = async (modelId: string, name: string) => {
    setBusy(true);
    try {
      const res = await window.nexAPI.modelDeployRemove(modelId, true);
      if (res.success) {
        showToast('ok', `حذف شد: ${name}`);
        await refresh();
      } else {
        setError(res.error || 'حذف ناموفق بود');
      }
    } finally {
      setBusy(false);
    }
  };

  const respondPermission = async (response: string) => {
    await window.nexAPI.modelDeployRespondPermission(response);
    setPendingPermission(null);
    setPermissionInput('');
  };

  const installedNames = new Set(installed.map((m: any) => m.name.toLowerCase()));
  const recommended = catalog.filter((m: any) => m.recommendedTier === 'low' && m.isEssential).slice(0, 5);
  const isDeploying = busy || (progress && !['idle', 'deployed', 'rolled-back'].includes(progress.stage) && !progress.stage.includes('failed') && !progress.stage.includes('denied'));

  function formatBytes(n: number): string {
    if (!n) return '0 B';
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  function formatSpeed(bps: number): string {
    if (!bps) return '—';
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        <div className="flex items-center gap-2">
          <Library size={16} style={{ color: 'var(--nex-accent)' }} />
          <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>NEX LIBRARY</span>
          {status?.modelReady && <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: '#86efac' }}><CheckCircle2 size={8} /> آماده</span>}
          {isDeploying && <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#06b6d4' }} />}
        </div>
        <button onClick={refresh} disabled={loading} className="p-1 rounded transition-colors hover:bg-white/[0.06] disabled:opacity-50" style={{ color: 'var(--nex-text-muted)' }}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-3 py-2 shrink-0 overflow-x-auto nex-scroll" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        {TABS.map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)} className="nex-click nex-focus flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium whitespace-nowrap transition-all"
            style={{ background: tab === id ? 'var(--nex-accent-dim)' : 'transparent', color: tab === id ? 'var(--nex-accent-text)' : 'var(--nex-text-muted)', border: tab === id ? '1px solid var(--nex-accent-glow)' : '1px solid transparent' }}>
            {icon} {label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto nex-scroll p-3 space-y-3" style={{ maxHeight: 'calc(100vh - 200px)' }}>
        {error && (
          <div className="flex items-start gap-2 p-2 rounded-lg text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>
            <AlertCircle size={12} className="mt-0.5 shrink-0" /><span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto"><X size={10} /></button>
          </div>
        )}

        {/* ═══ Recommended ═══ */}
        {tab === 'recommended' && (
          <div className="space-y-2">
            <div className="text-[10px] font-medium" style={{ color: 'var(--nex-text-muted)' }}>پیشنهادی برای سخت‌افزار شما</div>
            {recommended.map((m: any) => (
              <div key={m.id} className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid rgba(34,197,94,0.2)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <Star size={12} style={{ color: 'var(--nex-success)' }} />
                  <span className="text-[11px] font-medium flex-1" style={{ color: 'var(--nex-text)' }}>{m.displayNameFa}</span>
                  {installedNames.has(m.name.toLowerCase()) ? (
                    <CheckCircle2 size={12} style={{ color: 'var(--nex-success)' }} />
                  ) : (
                    <button onClick={() => handleInstallModel(m.downloadUrl, m.name)} disabled={busy} className="nex-click nex-focus flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium disabled:opacity-50" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>
                      <Download size={8} /> نصب
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[9px] ml-4" style={{ color: 'var(--nex-text-muted)' }}>
                  <span>{m.sizeGB.toFixed(1)} GB</span><span>•</span>
                  <span>RAM {m.requiredRAM}GB</span>
                  {m.persianSupport && <><span>•</span><span style={{ color: '#86efac' }}>فارسی ✓</span></>}
                </div>
              </div>
            ))}
            {/* Quick install recommended button */}
            {!status?.modelReady && (
              <button onClick={handleInstallRecommended} disabled={busy} className="nex-click nex-focus w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[11px] font-bold disabled:opacity-50" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}>
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} نصب سریع مدل پیشنهادی (Qwen 0.5B)
              </button>
            )}
          </div>
        )}

        {/* ═══ AI Models ═══ */}
        {tab === 'models' && (
          <div className="space-y-1.5">
            {catalog.filter(m => m.type === 'llm').map((m: any) => {
              const isInstalled = installedNames.has(m.name.toLowerCase());
              return (
                <div key={m.id} className="p-2 rounded-lg nex-glass" style={{ border: `1px solid ${isInstalled ? 'rgba(34,197,94,0.15)' : 'var(--nex-panel-border)'}` }}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Brain size={11} style={{ color: 'var(--nex-accent)' }} />
                    <span className="text-[10px] font-medium flex-1 truncate" style={{ color: 'var(--nex-text)' }}>{m.displayNameFa}</span>
                    {isInstalled ? <CheckCircle2 size={10} style={{ color: 'var(--nex-success)' }} /> : <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: 'rgba(6,182,212,0.15)', color: '#67e8f9' }}>آماده</span>}
                  </div>
                  <div className="flex items-center gap-2 text-[8px] ml-4 mb-1" style={{ color: 'var(--nex-text-muted)' }}>
                    <span>{m.provider}</span><span>•</span><span>{m.parameterCount}</span><span>•</span><span>{m.quantization}</span><span>•</span><span>{m.sizeGB.toFixed(1)}GB</span><span>•</span><span>RAM {m.requiredRAM}GB</span>
                  </div>
                  <div className="flex gap-1 ml-4">
                    {!isInstalled && <button onClick={() => handleInstallModel(m.downloadUrl, m.name)} disabled={busy} className="nex-click nex-focus flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-medium disabled:opacity-50" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}><Download size={7} /> نصب</button>}
                    {isInstalled && <button onClick={() => handleRemoveModel(m.id, m.name)} disabled={busy} className="nex-click nex-focus flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-medium" style={{ background: 'transparent', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}><Trash2 size={7} /> حذف</button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ═══ Voice ═══ */}
        {tab === 'voice' && (
          <div className="space-y-1.5">
            {catalog.filter(m => m.type === 'voice-stt' || m.type === 'voice-tts').map((m: any) => {
              const isInstalled = installedNames.has(m.name.toLowerCase());
              return (
                <div key={m.id} className="p-2 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
                  <div className="flex items-center gap-1.5">
                    <Mic size={11} style={{ color: 'var(--nex-accent)' }} />
                    <span className="text-[10px] font-medium flex-1" style={{ color: 'var(--nex-text)' }}>{m.displayNameFa}</span>
                    {isInstalled ? <CheckCircle2 size={10} style={{ color: 'var(--nex-success)' }} /> : <button onClick={() => handleInstallModel(m.downloadUrl, m.name)} disabled={busy} className="nex-click nex-focus px-1.5 py-0.5 rounded text-[8px] font-medium disabled:opacity-50" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>نصب</button>}
                  </div>
                  <div className="text-[8px] ml-4" style={{ color: 'var(--nex-text-muted)' }}>{m.type === 'voice-stt' ? 'تشخیص گفتار' : 'تولید گفتار'} • {m.sizeGB.toFixed(1)} GB</div>
                </div>
              );
            })}
          </div>
        )}

        {/* ═══ Tools ═══ */}
        {tab === 'tools' && (
          <div className="space-y-2">
            <div className="text-[10px] font-medium" style={{ color: 'var(--nex-text-muted)' }}>ابزارهای رانتایم</div>
            <div className="p-2 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
              <div className="flex items-center gap-1.5"><Cpu size={11} style={{ color: 'var(--nex-accent)' }} /><span className="text-[10px] font-medium" style={{ color: 'var(--nex-text)' }}>llama.cpp (node-llama-cpp)</span><CheckCircle2 size={10} style={{ color: 'var(--nex-success)' }} /></div>
              <div className="text-[8px] ml-4" style={{ color: 'var(--nex-text-muted)' }}>موتور استنتاج GGUF — نصب شده به‌صورت بومی</div>
            </div>
            <div className="p-2 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
              <div className="flex items-center gap-1.5"><Cpu size={11} style={{ color: 'var(--nex-text-muted)' }} /><span className="text-[10px] font-medium" style={{ color: 'var(--nex-text)' }}>FFmpeg</span></div>
              <div className="text-[8px] ml-4" style={{ color: 'var(--nex-text-muted)' }}>پیش‌پردازش صوتی — برای نصب از پنل Setup استفاده کنید</div>
            </div>
          </div>
        )}

        {/* ═══ Knowledge ═══ */}
        {tab === 'knowledge' && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-medium" style={{ color: 'var(--nex-text-muted)' }}>بسته‌های دانش</div>
            <div className="p-2 rounded-lg nex-glass text-[10px]" style={{ border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text-muted)' }}>
              بسته‌های دانش را از پنل «Expertise» مدیریت کنید. این بخش در نسخه‌های بعدی统統一 خواهد شد.
            </div>
          </div>
        )}

        {/* ═══ Installed ═══ */}
        {tab === 'installed' && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-medium" style={{ color: 'var(--nex-text-muted)' }}>منابع نصب‌شده ({installed.length})</div>
            {installed.length === 0 ? (
              <div className="text-center py-6 text-[11px]" style={{ color: 'var(--nex-text-muted)' }}>هیچ منبعی نصب نشده</div>
            ) : (
              installed.map((m: any, i: number) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)' }}>
                  <CheckCircle2 size={11} style={{ color: 'var(--nex-success)' }} />
                  <span className="text-[10px] font-medium flex-1 truncate" style={{ color: 'var(--nex-text)' }}>{m.name}</span>
                  <span className="text-[8px]" style={{ color: 'var(--nex-text-muted)' }}>{formatBytes(m.sizeBytes)}</span>
                  {m.loaded && <span className="text-[7px] px-1 py-0.5 rounded" style={{ background: 'rgba(6,182,212,0.15)', color: '#67e8f9' }}>فعال</span>}
                  <button onClick={() => handleRemoveModel(m.id, m.name)} disabled={busy} className="nex-click nex-focus p-0.5 rounded" style={{ color: '#fca5a5' }}><Trash2 size={9} /></button>
                </div>
              ))
            )}
          </div>
        )}

        {/* ═══ Downloads ═══ */}
        {tab === 'downloads' && (
          <div className="space-y-2">
            {/* Active download */}
            {progress && isDeploying ? (
              <div className="p-3 rounded-lg nex-glass-strong" style={{ border: '1px solid rgba(6,182,212,0.3)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Loader2 size={14} className="animate-spin" style={{ color: '#06b6d4' }} />
                  <span className="text-[11px] font-medium" style={{ color: 'var(--nex-text)' }}>{progress.messageFa || 'در حال دانلود'}</span>
                  <span className="ml-auto text-sm font-bold" style={{ color: '#06b6d4' }}>{(progress.percent ?? 0).toFixed(0)}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: 'var(--nex-bg)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, progress.percent ?? 0)}%`, background: 'linear-gradient(90deg, #06b6d488, #06b6d4)' }} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>
                  <div>دانلود شده: {formatBytes(progress.bytesDownloaded ?? 0)}</div>
                  <div>سرعت: {formatSpeed(progress.speedBytesPerSec ?? 0)}</div>
                  {progress.totalBytes ? <div>کل: {formatBytes(progress.totalBytes)}</div> : null}
                </div>
              </div>
            ) : lastResult ? (
              <div className="p-2.5 rounded-lg nex-glass" style={{ border: `1px solid ${lastResult.success ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
                <div className="flex items-center gap-1.5 mb-1">
                  {lastResult.success ? <CheckCircle2 size={12} style={{ color: 'var(--nex-success)' }} /> : <AlertCircle size={12} style={{ color: '#fca5a5' }} />}
                  <span className="text-[10px] font-medium" style={{ color: 'var(--nex-text)' }}>{lastResult.success ? 'دانلود موفق' : 'دانلود ناموفق'}</span>
                </div>
                {lastResult.modelName && <div className="text-[9px]" style={{ color: 'var(--nex-text)' }}>{lastResult.modelName}</div>}
                {lastResult.error && <div className="text-[9px]" style={{ color: '#fca5a5' }}>{lastResult.error}</div>}
              </div>
            ) : (
              <div className="text-center py-6 text-[11px]" style={{ color: 'var(--nex-text-muted)' }}>دانلود فعالی وجود ندارد</div>
            )}

            {/* History */}
            {history.length > 0 && (
              <div className="space-y-1">
                <div className="text-[9px] font-medium" style={{ color: 'var(--nex-text-muted)' }}>تاریخچه</div>
                {history.map((h, i) => (
                  <div key={i} className="flex items-center gap-2 p-1.5 rounded text-[9px]" style={{ background: 'var(--nex-bg)' }}>
                    {h.success ? <CheckCircle2 size={9} style={{ color: 'var(--nex-success)' }} /> : <X size={9} style={{ color: '#fca5a5' }} />}
                    <span className="flex-1 truncate" style={{ color: 'var(--nex-text)' }}>{h.modelName || 'نامشخص'}</span>
                    {h.error && <span style={{ color: '#fca5a5' }}>{h.error.slice(0, 30)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Security note */}
        <div className="p-2 rounded-lg text-[9px] flex items-start gap-1.5" style={{ background: 'rgba(34,197,94,0.06)', color: 'var(--nex-text-muted)' }}>
          <ShieldCheck size={10} className="mt-0.5 shrink-0" style={{ color: 'var(--nex-success)' }} />
          <span>تمام دانلودها نیازمند اجازه صریح هستند. فقط HTTPS. تأیید چک‌سام. تمام استنتاج محلی و آفلاین است.</span>
        </div>
      </div>

      {/* Permission dialog */}
      {pendingPermission && (
        <div className="absolute inset-0 flex items-end p-3 pointer-events-none" style={{ zIndex: 20 }}>
          <div className="nex-glass-strong w-full p-3 rounded-xl pointer-events-auto" style={{ border: '1px solid var(--nex-accent-glow)' }}>
            <div className="flex items-center gap-1.5 mb-2">
              <ShieldCheck size={13} style={{ color: 'var(--nex-accent)' }} />
              <span className="text-[11px] font-medium" style={{ color: 'var(--nex-accent-text)' }}>درخواست اجازه</span>
            </div>
            <p className="text-[11px] mb-2" style={{ color: 'var(--nex-text)' }}>{pendingPermission.action?.description}</p>
            <p className="text-[10px] mb-2" style={{ color: 'var(--nex-text-muted)' }}>عبارت: <span style={{ color: 'var(--nex-accent-text)' }}>{pendingPermission.requiredPhrase}</span></p>
            <div className="flex gap-1.5">
              <input value={permissionInput} onChange={e => setPermissionInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && permissionInput.trim()) respondPermission(permissionInput); }}
                placeholder="عبارت تأیید..." className="flex-1 px-2 py-1 rounded-lg text-[11px] nex-focus" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }} autoFocus />
              <button onClick={() => respondPermission(permissionInput || 'نه')} disabled={!permissionInput.trim()} className="nex-click nex-focus px-2.5 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>ارسال</button>
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
