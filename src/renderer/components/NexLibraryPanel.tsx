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
  // ── Phase 72: Test Connection state ──
  const [connectionTest, setConnectionTest] = useState<any | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  // ── Phase 72: Unified Model Download Manager state ──
  const [downloadableModels, setDownloadableModels] = useState<any[]>([]);
  const [unifiedDownloads, setUnifiedDownloads] = useState<Map<string, any>>(new Map());
  const [showImportDialog, setShowImportDialog] = useState(false);

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
      const [catRes, installedRes, statusRes, dlModelsRes] = await Promise.all([
        window.nexAPI.ecosystemCatalog(),
        window.nexAPI.localRuntimeListModels(),
        window.nexAPI.interactionStatus(),
        window.nexAPI.modelDownloadList(),
      ]);
      if (catRes.success) setCatalog(catRes.catalog || []);
      if (installedRes.success) setInstalled(installedRes.models || []);
      if (statusRes.success) setStatus(statusRes.status);
      if (dlModelsRes.success) setDownloadableModels(dlModelsRes.models || []);
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
      // Phase 71/72: Pass detailed error info (code/stage/host/expected/classification/cdnHost) to store
      failDownload(ev.id, ev.error, {
        code: ev.result?.errorCode || ev.code,
        stage: ev.result?.errorStage || ev.stage,
        host: ev.result?.errorHost || ev.host,
        bytesExpected: ev.result?.bytesExpected || ev.bytesExpected,
        classification: ev.result?.errorClassification,
        cdnHost: ev.result?.cdnHost,
        hasAlternativeSource: ev.result?.hasAlternativeSource,
      });
      const code = ev.result?.errorCode || ev.code || 'UNKNOWN';
      const stage = ev.result?.errorStage || ev.stage || 'unknown';
      const host = ev.result?.errorHost || ev.host || 'unknown';
      const received = ev.result?.bytesDownloaded || ev.bytesDownloaded || 0;
      const expected = ev.result?.bytesExpected || ev.bytesExpected || 0;
      const classification = ev.result?.errorClassification;
      console.log('[INSTALL:ERROR] Download failed — code:', code, 'stage:', stage, 'host:', host, 'received:', received, 'expected:', expected, 'classification:', classification);
      // Phase 72: CDN-specific toast message
      if (classification === 'cdn-connection-failure') {
        setToast({ kind: 'err', msg: `CDN هاگینگ‌فیس مسدود است — از منبع جایگزین استفاده کنید` });
      } else {
        setToast({ kind: 'err', msg: `دانلود ناموفق: ${code} @ ${stage}` });
      }
    });

    // Subscribe to permission requests
    const unsubPerm = window.nexAPI.onModelDeploymentPermissionRequest((req: any) => {
      setPendingPermission(req);
      setPermissionInput('');
    });

    // ── Phase 72: Unified Model Download Manager progress ──
    const unsubUnified = window.nexAPI.onModelDownloadProgress((progress) => {
      setUnifiedDownloads((prev) => {
        const next = new Map(prev);
        next.set(progress.downloadId, progress);
        return next;
      });
      // Refresh installed list when completed
      if (progress.state === 'completed') {
        setToast({ kind: 'ok', msg: `مدل نصب شد: ${progress.modelName}` });
        refresh();
      }
      // Show error toast on failure
      if (progress.state === 'download-failed' && progress.failure) {
        const f = progress.failure;
        if (f.classification === 'CDN_UNREACHABLE') {
          setToast({ kind: 'err', msg: `CDN مسدود است — منبع جایگزین امتحان شد` });
        } else {
          setToast({ kind: 'err', msg: `دانلود ناموفق: ${f.classification}` });
        }
      }
    });

    return () => {
      unsubState();
      unsubCompleted();
      unsubError();
      unsubPerm();
      unsubUnified();
    };
  }, []);

  const showToast = (kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Install actions ──
  // Phase 70: These IPC calls now BLOCK until the permission dialog is
  // resolved. The "Download started" toast ONLY appears after the main
  // process returns {success:true, downloadId} — which only happens AFTER
  // the user explicitly approved the permission.
  //
  // If the user denies (Cancel), the IPC returns {status:'permission-denied'}
  // and NO toast is shown.

  const handleInstallModel = async (url: string, name?: string) => {
    setError(null);
    console.log('[INSTALL:01] CLICK — handleInstallModel — url:', url, 'name:', name);
    try {
      const res = await window.nexAPI.downloadStart({ url, name });
      console.log('[INSTALL:RESPONSE] success:', res.success, 'status:', res.status, 'downloadId:', res.downloadId);
      if (res.success && res.downloadId) {
        // Permission was APPROVED + downloadId was created + download started.
        // The download store entry will be created by the download:state event.
        showToast('ok', 'دانلود شروع شد');
      } else if (res.status === 'permission-denied') {
        // User cancelled — no toast, no error. Silent.
        console.log('[INSTALL:CANCELLED] User denied permission — no download started');
      } else if (res.status === 'invalid-url') {
        setError(res.error || 'آدرس نامعتبر است');
      } else {
        console.log('[INSTALL:ERROR] stage:ipc — error:', res.error);
        setError(res.error || 'شروع دانلود ناموفق بود');
      }
    } catch (err: any) {
      console.log('[INSTALL:ERROR] stage:renderer-catch — error:', err?.message);
      console.log('[INSTALL:ERROR] stack:', err?.stack);
      setError(err?.message);
    }
  };

  const handleInstallRecommended = async () => {
    setError(null);
    console.log('[INSTALL:01] CLICK — handleInstallRecommended');
    try {
      const res = await window.nexAPI.downloadStartRecommended();
      console.log('[INSTALL:RESPONSE] success:', res.success, 'status:', res.status, 'downloadId:', res.downloadId);
      if (res.success && res.downloadId) {
        showToast('ok', 'دانلود مدل پیشنهادی شروع شد');
      } else if (res.status === 'permission-denied') {
        console.log('[INSTALL:CANCELLED] User denied permission — no download started');
      } else {
        console.log('[INSTALL:ERROR] stage:ipc — error:', res.error);
        setError(res.error || 'شروع دانلود ناموفق بود');
      }
    } catch (err: any) {
      console.log('[INSTALL:ERROR] stage:renderer-catch — error:', err?.message);
      console.log('[INSTALL:ERROR] stack:', err?.stack);
      setError(err?.message);
    }
  };

  // ── Phase 72: Test Connection — tests HuggingFace + CDN + ModelScope ──
  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionTest(null);
    try {
      console.log('[TEST_CONNECTION] Testing 3 hosts...');
      const res = await window.nexAPI.downloadTestConnection();
      if (res.success && res.results) {
        setConnectionTest(res.results);
        console.log('[TEST_CONNECTION] Results:', res.results);
        if (res.results.recommendation.includes('CDN blocked')) {
          showToast('err', 'CDN هاگینگ‌فیس مسدود است — از منبع جایگزین استفاده کنید');
        } else if (res.results.recommendation.includes('All hosts reachable')) {
          showToast('ok', 'تمام میزبان‌ها در دسترس هستند');
        } else {
          showToast('ok', 'تست اتصال انجام شد');
        }
      } else {
        setError(res.error || 'تست اتصال ناموفق بود');
      }
    } catch (err: any) {
      console.log('[TEST_CONNECTION] Error:', err?.message);
      setError(err?.message);
    } finally {
      setTestingConnection(false);
    }
  };

  // ── Phase 72: Install from alternative source (ModelScope) ──
  const handleInstallAlternative = async () => {
    setError(null);
    console.log('[INSTALL:01] CLICK — handleInstallAlternative (ModelScope)');
    try {
      const res = await window.nexAPI.downloadStartAlternative();
      console.log('[INSTALL:RESPONSE] success:', res.success, 'status:', res.status, 'downloadId:', res.downloadId);
      if (res.success && res.downloadId) {
        showToast('ok', 'دانلود از منبع جایگزین (ModelScope) شروع شد');
      } else if (res.status === 'permission-denied') {
        console.log('[INSTALL:CANCELLED] User denied permission — no download started');
      } else {
        console.log('[INSTALL:ERROR] stage:ipc — error:', res.error);
        setError(res.error || 'شروع دانلود ناموفق بود');
      }
    } catch (err: any) {
      console.log('[INSTALL:ERROR] stage:renderer-catch — error:', err?.message);
      setError(err?.message);
    }
  };

  // ── Phase 72: Unified Model Download Manager handlers ──
  const handleUnifiedDownload = async (modelId: string) => {
    setError(null);
    console.log('[MODEL_DOWNLOAD:01] CLICK — model:', modelId);
    try {
      const res = await window.nexAPI.modelDownloadStart(modelId);
      if (res.success && res.downloadId) {
        showToast('ok', 'دانلود شروع شد (چند منبعی)');
      } else if (res.status === 'permission-denied') {
        console.log('[MODEL_DOWNLOAD:CANCELLED] Permission denied');
      } else {
        setError(res.error || 'شروع دانلود ناموفق بود');
      }
    } catch (err: any) {
      setError(err?.message);
    }
  };

  const handleCancelUnifiedDownload = async (downloadId: string) => {
    try {
      await window.nexAPI.modelDownloadCancel(downloadId);
      showToast('ok', 'دانلود لغو شد');
    } catch (err: any) {
      setError(err?.message);
    }
  };

  const handleTestSources = async (modelId: string) => {
    setTestingConnection(true);
    try {
      const res = await window.nexAPI.modelDownloadTestSources(modelId);
      if (res.success && res.results) {
        setConnectionTest({ sources: res.results });
      }
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleImportLocalModel = async () => {
    // Use Electron's native file dialog via IPC
    try {
      // We'll use the showOpenDialog IPC if available, otherwise prompt
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.gguf';
      input.onchange = async (e: any) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const filePath = (file as any).path; // Electron exposes .path on File objects
        if (!filePath) {
          setError('Cannot get file path — use drag & drop or Electron dialog');
          return;
        }
        console.log('[MODEL_IMPORT] Importing:', filePath);
        const res = await window.nexAPI.modelDownloadImportLocal(filePath, {
          filename: file.name,
          name: file.name.replace(/\.gguf$/i, ''),
        });
        if (res.success) {
          showToast('ok', `مدل ایمپورت شد: ${file.name}`);
          refresh();
        } else {
          setError(res.error || 'ایمپورت ناموفق بود');
        }
      };
      input.click();
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
          {/* Phase 72: Unified Model Download Manager — Multi-source + Import */}
          <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid rgba(6,182,212,0.2)' }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Package size={11} style={{ color: 'var(--nex-accent)' }} />
              <span className="text-[10px] font-medium" style={{ color: 'var(--nex-text)' }}>مدیریت دانلود مدل (چند منبعی)</span>
            </div>
            {/* Downloadable models with multi-source */}
            {downloadableModels.map((m: any) => {
              const isInstalled = installedNames.has(m.name.toLowerCase()) || installed.some((i: any) => i.name?.includes(m.name));
              const activeDl = Array.from(unifiedDownloads.values()).find((d: any) => d.modelId === m.id && !['completed', 'download-failed', 'cancelled'].includes(d.state));
              return (
                <div key={m.id} className="p-2 rounded-lg mb-2" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Brain size={10} style={{ color: 'var(--nex-accent)' }} />
                    <span className="text-[10px] font-medium flex-1 truncate" style={{ color: 'var(--nex-text)' }}>{m.nameFa || m.name}</span>
                    {isInstalled ? (
                      <CheckCircle2 size={10} style={{ color: 'var(--nex-success)' }} />
                    ) : activeDl ? (
                      <Loader2 size={10} className="animate-spin" style={{ color: '#06b6d4' }} />
                    ) : (
                      <button onClick={() => handleUnifiedDownload(m.id)} className="nex-click nex-focus flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-medium" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>
                        <Download size={7} /> نصب
                      </button>
                    )}
                  </div>
                  {/* Sources list */}
                  <div className="ml-4 mb-1 space-y-0.5">
                    {m.sources?.map((s: any, i: number) => (
                      <div key={i} className="flex items-center gap-1 text-[8px]" style={{ color: 'var(--nex-text-muted)' }}>
                        <span className="px-1 rounded" style={{ background: 'rgba(6,182,212,0.1)', color: '#67e8f9' }}>{s.label}</span>
                        <span>اولویت: {s.priority}</span>
                      </div>
                    ))}
                  </div>
                  {/* Active download progress */}
                  {activeDl && (
                    <div className="mt-1">
                      <div className="flex items-center gap-1 text-[8px] mb-0.5" style={{ color: 'var(--nex-text-muted)' }}>
                        <span>وضعیت: {activeDl.state}</span>
                        {activeDl.currentSource && <span>• منبع: {activeDl.currentSource.label}</span>}
                        {activeDl.attempt && <span>• تلاش: {activeDl.attempt}/{activeDl.maxAttempts}</span>}
                      </div>
                      {activeDl.percentage !== null && (
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--nex-bg)' }}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, activeDl.percentage)}%`, background: 'linear-gradient(90deg, #06b6d488, #06b6d4)' }} />
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-0.5 text-[8px]" style={{ color: 'var(--nex-text-muted)' }}>
                        <span>{formatBytes(activeDl.receivedBytes)} / {activeDl.totalBytes > 0 ? formatBytes(activeDl.totalBytes) : '?'}</span>
                        <button onClick={() => handleCancelUnifiedDownload(activeDl.downloadId)} className="nex-click text-[8px]" style={{ color: '#fca5a5' }}>لغو</button>
                      </div>
                    </div>
                  )}
                  {/* Test sources button */}
                  {!isInstalled && !activeDl && (
                    <button onClick={() => handleTestSources(m.id)} disabled={testingConnection} className="nex-click nex-focus ml-4 text-[8px] px-1.5 py-0.5 rounded disabled:opacity-50" style={{ color: 'var(--nex-text-muted)', border: '1px solid var(--nex-panel-border)' }}>
                      تست منابع
                    </button>
                  )}
                </div>
              );
            })}
            {/* Manual import button */}
            <button onClick={handleImportLocalModel} className="nex-click nex-focus w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-medium mt-2" style={{ background: 'rgba(34,197,94,0.1)', color: '#86efac', border: '1px solid rgba(34,197,94,0.2)' }}>
              <Package size={11} /> ایمپورت فایل GGUF محلی
            </button>
          </div>

          {/* Phase 72: Test Connection + Alternative Source */}
          <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Globe size={11} style={{ color: 'var(--nex-accent)' }} />
              <span className="text-[10px] font-medium" style={{ color: 'var(--nex-text)' }}>تست اتصال شبکه</span>
            </div>
            <button onClick={handleTestConnection} disabled={testingConnection} className="nex-click nex-focus w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-medium mb-2 disabled:opacity-50" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}>
              {testingConnection ? <Loader2 size={11} className="animate-spin" /> : <Globe size={11} />}
              {testingConnection ? 'در حال تست...' : 'تست اتصال به HuggingFace و CDN'}
            </button>
            {connectionTest && (
              <div className="space-y-1 text-[9px]">
                <div className="flex items-center gap-1.5">
                  <span style={{ color: 'var(--nex-text-muted)' }}>huggingface.co:</span>
                  {connectionTest.huggingface?.reachable ? (
                    <span style={{ color: '#86efac' }}>✓ {connectionTest.huggingface.statusCode} ({connectionTest.huggingface.latencyMs}ms)</span>
                  ) : (
                    <span style={{ color: '#fca5a5' }}>✗ {connectionTest.huggingface?.error || 'ناموفق'}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span style={{ color: 'var(--nex-text-muted)' }}>us.aws.cdn.hf.co:</span>
                  {connectionTest.cdn?.reachable ? (
                    <span style={{ color: '#86efac' }}>✓ {connectionTest.cdn.statusCode} ({connectionTest.cdn.latencyMs}ms)</span>
                  ) : (
                    <span style={{ color: '#fca5a5' }}>✗ {connectionTest.cdn?.error || 'ناموفق'}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span style={{ color: 'var(--nex-text-muted)' }}>modelscope.cn:</span>
                  {connectionTest.alternative?.reachable ? (
                    <span style={{ color: '#86efac' }}>✓ {connectionTest.alternative.statusCode} ({connectionTest.alternative.latencyMs}ms)</span>
                  ) : (
                    <span style={{ color: '#fca5a5' }}>✗ {connectionTest.alternative?.error || 'ناموفق'}</span>
                  )}
                </div>
                {connectionTest.recommendation && (
                  <div className="mt-1 p-1.5 rounded text-[9px]" style={{ background: connectionTest.recommendation.includes('CDN blocked') ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.06)', color: connectionTest.recommendation.includes('CDN blocked') ? '#fca5a5' : '#86efac' }}>
                    {connectionTest.recommendation}
                  </div>
                )}
              </div>
            )}
            {/* Alternative source button — shown when CDN is blocked */}
            {connectionTest?.recommendation?.includes('CDN blocked') && (
              <button onClick={handleInstallAlternative} className="nex-click nex-focus w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-bold mt-2" style={{ background: 'rgba(34,197,94,0.15)', color: '#86efac', border: '1px solid rgba(34,197,94,0.3)' }}>
                <Download size={11} /> دانلود از منبع جایگزین (ModelScope)
              </button>
            )}
          </div>

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
                  {dl.error && <div className="text-[9px] mb-1" style={{ color: '#fca5a5' }}>{dl.error}</div>}
                  {/* Phase 71: Detailed error info */}
                  {dl.status === 'download-failed' && (dl.errorCode || dl.errorStage || dl.errorHost) && (
                    <div className="text-[8px] mt-1 p-1.5 rounded font-mono space-y-0.5" style={{ background: 'rgba(239,68,68,0.06)', color: 'var(--nex-text-muted)', border: '1px solid rgba(239,68,68,0.1)' }}>
                      {dl.errorCode && <div>Error: <span style={{ color: '#fca5a5' }}>{dl.errorCode}</span></div>}
                      {dl.errorStage && <div>Stage: <span style={{ color: '#fca5a5' }}>{dl.errorStage}</span></div>}
                      {dl.errorHost && <div>Host: <span style={{ color: '#fca5a5' }}>{dl.errorHost}</span></div>}
                      <div>Received: {formatBytes(dl.downloadedBytes || 0)}{dl.bytesExpected ? ` / ${formatBytes(dl.bytesExpected)}` : ''}</div>
                    </div>
                  )}
                  {/* Phase 72: CDN failure — show alternative source button */}
                  {dl.status === 'download-failed' && dl.errorClassification === 'cdn-connection-failure' && dl.hasAlternativeSource && (
                    <div className="mt-2 p-1.5 rounded text-[9px]" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                      <div className="mb-1" style={{ color: '#fca5a5' }}>⚠ CDN هاگینگ‌فیس مسدود است</div>
                      <div className="mb-1.5" style={{ color: 'var(--nex-text-muted)' }}>سرور مدل در دسترس است، اما اتصال به CDN دانلود مسدود می‌شود.</div>
                      <button onClick={handleInstallAlternative} className="nex-click nex-focus w-full flex items-center justify-center gap-1 px-2 py-1 rounded text-[9px] font-bold" style={{ background: 'rgba(34,197,94,0.15)', color: '#86efac', border: '1px solid rgba(34,197,94,0.3)' }}>
                        <Download size={9} /> دانلود از ModelScope (منبع جایگزین)
                      </button>
                    </div>
                  )}
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
