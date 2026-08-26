/**
 * NEX AI — Unified Library Center (Phase 68 rewrite)
 *
 * Download state lives in useDownloadStore (Zustand) — NOT in component state.
 * This means downloads survive tab switches, panel unmounts, and navigation.
 *
 * Architecture:
 *   Main Process → IPC events → useDownloadStore → Components
 *
 * The Library panel reads from the store; it does not own download state.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Library, RefreshCw, Star, Brain, Mic, Cpu, BookOpen, CheckCircle2,
  Download, AlertCircle, Loader2, Package, Globe, Zap, Trash2,
  Pause, RotateCw, X, ShieldCheck,
} from 'lucide-react';
import { useDownloadStore, isDownloading, type DownloadEntry } from '../store/download-store';

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

export default function NexLibraryPanel() {
  // ── Tab state (local — just which tab is visible) ──
  const [tab, setTab] = useState<Tab>('recommended');

  // ── Catalog/installed state (local — read-only data) ──
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [installed, setInstalled] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [permissionInput, setPermissionInput] = useState('');
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // ── Download state (ZUSTAND STORE — survives component unmount) ──
  const downloads = useDownloadStore((s) => s.downloads);
  const history = useDownloadStore((s) => s.history);
  const pendingPermission = useDownloadStore((s) => s.pendingPermission);
  const startDownload = useDownloadStore((s) => s.startDownload);
  const updateProgress = useDownloadStore((s) => s.updateProgress);
  const completeDownload = useDownloadStore((s) => s.completeDownload);
  const failDownload = useDownloadStore((s) => s.failDownload);
  const setPendingPermission = useDownloadStore((s) => s.setPendingPermission);
  const addToHistory = useDownloadStore((s) => s.addToHistory);
  const syncFromMain = useDownloadStore((s) => s.syncFromMain);

  // ── Refresh catalog/installed ──
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, installedRes, statusRes] = await Promise.all([
        window.nexAPI.ecosystemCatalog(),
        window.nexAPI.localRuntimeListModels(),
        window.nexAPI.interactionStatus(),
      ]);
      if (catRes.success) setCatalog(catRes.catalog || []);
      if (installedRes.success) setInstalled(installedRes.models || []);
      if (statusRes.success) setStatus(statusRes.status);
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // ── On mount: sync download state from main process ──
  useEffect(() => {
    // Fetch active downloads from main process
    window.nexAPI.downloadGetActive().then((res) => {
      if (res.success && res.downloads) {
        syncFromMain(res.downloads);
      }
    });

    // Subscribe to download state events
    const unsubState = window.nexAPI.onDownloadState((state) => {
      // Update store from main process events
      const existing = useDownloadStore.getState().downloads.find((d) => d.id === state.id);
      if (existing) {
        updateProgress(state.id, state);
      } else {
        // New download — add to store
        useDownloadStore.setState((s) => ({
          downloads: [...s.downloads, state],
          activeDownloadId: state.id,
        }));
      }
    });

    const unsubCompleted = window.nexAPI.onDownloadCompleted((ev) => {
      completeDownload(ev.id, ev.result);
      addToHistory(ev.result);
      if (ev.result?.success) {
        setToast({ kind: 'ok', msg: `مدل نصب شد: ${ev.result.modelName}` });
        refresh(); // Refresh installed list
      }
    });

    const unsubError = window.nexAPI.onDownloadError((ev) => {
      failDownload(ev.id, ev.error);
      setToast({ kind: 'err', msg: `دانلود ناموفق: ${ev.error}` });
    });

    // Subscribe to permission requests
    const unsubPerm = window.nexAPI.onModelDeploymentPermissionRequest((req: any) => {
      setPendingPermission(req);
      setPermissionInput('');
    });

    return () => {
      unsubState();
      unsubCompleted();
      unsubError();
      unsubPerm();
    };
  }, []);

  const showToast = (kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Install actions ──
  // These call the new non-blocking IPC handlers that return immediately
  // with a downloadId. The download continues in the main process.

  const handleInstallModel = async (url: string, name?: string) => {
    setError(null);
    try {
      const res = await window.nexAPI.downloadStart({ url, name });
      if (res.success && res.downloadId) {
        // Store entry will be created by the download:state event
        showToast('ok', 'دانلود شروع شد');
      } else {
        setError(res.error || 'شروع دانلود ناموفق بود');
      }
    } catch (err: any) {
      setError(err?.message);
    }
  };

  const handleInstallRecommended = async () => {
    setError(null);
    try {
      const res = await window.nexAPI.downloadStartRecommended();
      if (res.success && res.downloadId) {
        showToast('ok', 'دانلود مدل پیشنهادی شروع شد');
      } else {
        setError(res.error || 'شروع دانلود ناموفق بود');
      }
    } catch (err: any) {
      setError(err?.message);
    }
  };

  const handleRemoveModel = async (modelId: string, name: string) => {
    try {
      const res = await window.nexAPI.modelDeployRemove(modelId, true);
      if (res.success) {
        showToast('ok', `حذف شد: ${name}`);
        await refresh();
      } else {
        setError(res.error || 'حذف ناموفق بود');
      }
    } catch (err: any) {
      setError(err?.message);
    }
  };

  const respondPermission = async (response: string) => {
    await window.nexAPI.modelDeployRespondPermission(response);
    setPendingPermission(null);
    setPermissionInput('');
  };

  // ── Derived state ──
  const installedNames = new Set(installed.map((m: any) => m.name.toLowerCase()));
  const recommended = catalog.filter((m: any) => m.recommendedTier === 'low' && m.isEssential).slice(0, 5);
  const activeDownloads = downloads.filter((d: DownloadEntry) =>
    !['deployed', 'download-failed', 'rolled-back', 'permission-denied'].includes(d.status)
  );
  const completedDownloads = downloads.filter((d: DownloadEntry) =>
    ['deployed', 'download-failed', 'rolled-back', 'permission-denied'].includes(d.status)
  );

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        <div className="flex items-center gap-2">
          <Library size={16} style={{ color: 'var(--nex-accent)' }} />
          <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>NEX LIBRARY</span>
          {status?.modelReady && <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: '#86efac' }}><CheckCircle2 size={8} /> آماده</span>}
          {activeDownloads.length > 0 && <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#06b6d4' }} />}
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
            {id === 'downloads' && activeDownloads.length > 0 && <span className="text-[8px] px-1 rounded" style={{ background: '#06b6d4', color: '#fff' }}>{activeDownloads.length}</span>}
          </button>
        ))}
      </div>

      {/* Body — all tabs kept mounted with display:none for persistence */}
      <div className="flex-1 overflow-y-auto nex-scroll" style={{ maxHeight: 'calc(100vh - 200px)' }}>
        {error && (
          <div className="flex items-start gap-2 p-2 rounded-lg text-[11px] mx-3 mt-3" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>
            <AlertCircle size={12} className="mt-0.5 shrink-0" /><span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto"><X size={10} /></button>
          </div>
        )}

        {/* ═══ Recommended ═══ */}
        <div style={{ display: tab === 'recommended' ? 'block' : 'none' }} className="p-3 space-y-2">
          <div className="text-[10px] font-medium" style={{ color: 'var(--nex-text-muted)' }}>پیشنهادی برای سخت‌افزار شما</div>
          {recommended.map((m: any) => (
            <div key={m.id} className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid rgba(34,197,94,0.2)' }}>
              <div className="flex items-center gap-2 mb-1">
                <Star size={12} style={{ color: 'var(--nex-success)' }} />
                <span className="text-[11px] font-medium flex-1" style={{ color: 'var(--nex-text)' }}>{m.displayNameFa}</span>
                {installedNames.has(m.name.toLowerCase()) ? (
                  <CheckCircle2 size={12} style={{ color: 'var(--nex-success)' }} />
                ) : (
                  <button onClick={() => handleInstallModel(m.downloadUrl, m.name)} className="nex-click nex-focus flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>
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
          {!status?.modelReady && (
            <button onClick={handleInstallRecommended} className="nex-click nex-focus w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[11px] font-bold" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}>
              {activeDownloads.length > 0 ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} نصب سریع مدل پیشنهادی (Qwen 0.5B)
            </button>
          )}
        </div>

        {/* ═══ AI Models ═══ */}
        <div style={{ display: tab === 'models' ? 'block' : 'none' }} className="p-3 space-y-1.5">
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
                  {!isInstalled && <button onClick={() => handleInstallModel(m.downloadUrl, m.name)} className="nex-click nex-focus flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-medium" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}><Download size={7} /> نصب</button>}
                  {isInstalled && <button onClick={() => handleRemoveModel(m.id, m.name)} className="nex-click nex-focus flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-medium" style={{ background: 'transparent', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}><Trash2 size={7} /> حذف</button>}
                </div>
              </div>
            );
          })}
        </div>

        {/* ═══ Voice ═══ */}
        <div style={{ display: tab === 'voice' ? 'block' : 'none' }} className="p-3 space-y-1.5">
          {catalog.filter(m => m.type === 'voice-stt' || m.type === 'voice-tts').map((m: any) => {
            const isInstalled = installedNames.has(m.name.toLowerCase());
            return (
              <div key={m.id} className="p-2 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
                <div className="flex items-center gap-1.5">
                  <Mic size={11} style={{ color: 'var(--nex-accent)' }} />
                  <span className="text-[10px] font-medium flex-1" style={{ color: 'var(--nex-text)' }}>{m.displayNameFa}</span>
                  {isInstalled ? <CheckCircle2 size={10} style={{ color: 'var(--nex-success)' }} /> : <button onClick={() => handleInstallModel(m.downloadUrl, m.name)} className="nex-click nex-focus px-1.5 py-0.5 rounded text-[8px] font-medium" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>نصب</button>}
                </div>
                <div className="text-[8px] ml-4" style={{ color: 'var(--nex-text-muted)' }}>{m.type === 'voice-stt' ? 'تشخیص گفتار' : 'تولید گفتار'} • {m.sizeGB.toFixed(1)} GB</div>
              </div>
            );
          })}
        </div>

        {/* ═══ Tools ═══ */}
        <div style={{ display: tab === 'tools' ? 'block' : 'none' }} className="p-3 space-y-2">
          <div className="text-[10px] font-medium" style={{ color: 'var(--nex-text-muted)' }}>ابزارهای رانتایم</div>
          <div className="p-2 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
            <div className="flex items-center gap-1.5"><Cpu size={11} style={{ color: 'var(--nex-accent)' }} /><span className="text-[10px] font-medium" style={{ color: 'var(--nex-text)' }}>llama.cpp (node-llama-cpp)</span><CheckCircle2 size={10} style={{ color: 'var(--nex-success)' }} /></div>
            <div className="text-[8px] ml-4" style={{ color: 'var(--nex-text-muted)' }}>موتور استنتاج GGUF — نصب شده به‌صورت بومی</div>
          </div>
        </div>

        {/* ═══ Knowledge ═══ */}
        <div style={{ display: tab === 'knowledge' ? 'block' : 'none' }} className="p-3 space-y-1.5">
          <div className="text-[10px] font-medium" style={{ color: 'var(--nex-text-muted)' }}>بسته‌های دانش</div>
          <div className="p-2 rounded-lg nex-glass text-[10px]" style={{ border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text-muted)' }}>
            مدیریت بسته‌های دانش به‌زودی در این پنل統一 خواهد شد.
          </div>
        </div>

        {/* ═══ Installed ═══ */}
        <div style={{ display: tab === 'installed' ? 'block' : 'none' }} className="p-3 space-y-1.5">
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
                <button onClick={() => handleRemoveModel(m.id, m.name)} className="nex-click nex-focus p-0.5 rounded" style={{ color: '#fca5a5' }}><Trash2 size={9} /></button>
              </div>
            ))
          )}
        </div>

        {/* ═══ Downloads ═══ */}
        <div style={{ display: tab === 'downloads' ? 'block' : 'none' }} className="p-3 space-y-2">
          {/* Active downloads */}
          {activeDownloads.length === 0 && completedDownloads.length === 0 ? (
            <div className="text-center py-6 text-[11px]" style={{ color: 'var(--nex-text-muted)' }}>دانلود فعالی وجود ندارد</div>
          ) : (
            <>
              {activeDownloads.map((dl: DownloadEntry) => (
                <div key={dl.id} className="p-3 rounded-lg nex-glass-strong" style={{ border: '1px solid rgba(6,182,212,0.3)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    {dl.status === 'downloading' || dl.status === 'requesting-permission' ? (
                      <Loader2 size={14} className="animate-spin" style={{ color: '#06b6d4' }} />
                    ) : null}
                    <span className="text-[11px] font-medium" style={{ color: 'var(--nex-text)' }}>{dl.modelName}</span>
                    <span className="ml-auto text-sm font-bold" style={{ color: '#06b6d4' }}>{(dl.progress ?? 0).toFixed(0)}%</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: 'var(--nex-bg)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, dl.progress ?? 0)}%`, background: 'linear-gradient(90deg, #06b6d488, #06b6d4)' }} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>
                    <div>دانلود شده: {formatBytes(dl.downloadedBytes ?? 0)}</div>
                    <div>سرعت: {formatSpeed(dl.speedBytesPerSec ?? 0)}</div>
                    {dl.totalBytes > 0 && <div>کل: {formatBytes(dl.totalBytes)}</div>}
                    <div>وضعیت: {dl.stageMessageFa || dl.status}</div>
                  </div>
                </div>
              ))}

              {/* Completed/failed downloads */}
              {completedDownloads.map((dl: DownloadEntry) => (
                <div key={dl.id} className="p-2.5 rounded-lg nex-glass" style={{ border: `1px solid ${dl.status === 'deployed' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    {dl.status === 'deployed' ? <CheckCircle2 size={12} style={{ color: 'var(--nex-success)' }} /> : <AlertCircle size={12} style={{ color: '#fca5a5' }} />}
                    <span className="text-[10px] font-medium" style={{ color: 'var(--nex-text)' }}>{dl.modelName}</span>
                    <span className="ml-auto text-[8px]" style={{ color: 'var(--nex-text-muted)' }}>{dl.status}</span>
                  </div>
                  {dl.error && <div className="text-[9px]" style={{ color: '#fca5a5' }}>{dl.error}</div>}
                </div>
              ))}
            </>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="space-y-1">
              <div className="text-[9px] font-medium" style={{ color: 'var(--nex-text-muted)' }}>تاریخچه</div>
              {history.map((h: any, i: number) => (
                <div key={i} className="flex items-center gap-2 p-1.5 rounded text-[9px]" style={{ background: 'var(--nex-bg)' }}>
                  {h.success ? <CheckCircle2 size={9} style={{ color: 'var(--nex-success)' }} /> : <X size={9} style={{ color: '#fca5a5' }} />}
                  <span className="flex-1 truncate" style={{ color: 'var(--nex-text)' }}>{h.modelName || 'نامشخص'}</span>
                  {h.error && <span style={{ color: '#fca5a5' }}>{h.error.slice(0, 30)}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Security note */}
        <div className="p-2 mx-3 mb-3 rounded-lg text-[9px] flex items-start gap-1.5" style={{ background: 'rgba(34,197,94,0.06)', color: 'var(--nex-text-muted)' }}>
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
