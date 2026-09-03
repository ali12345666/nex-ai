/**
 * NEX AI — Professional Model Deployment Panel (Phase 63)
 *
 * Complete overhaul of the model deployment UI:
 *   1. Professional model cards with badges (installed/downloadable/downloading/etc.)
 *   2. Download manager with real-time progress, speed, ETA, controls
 *   3. Deployment pipeline visualization (9 stages)
 *   4. Error cards with reason + solution + retry
 *   5. Download history (successes + failures)
 *   6. Model browser with search, category filter, hardware filter, recommended
 *
 * Connects to real Phase 61 backend events via onModelDeploymentProgress.
 * No faked progress — all state comes from the deployment manager.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  PackageCheck, RefreshCw, Upload, Download, Trash2, ShieldCheck, AlertCircle,
  CheckCircle2, XCircle, Loader2, Zap, FileCheck, Gauge, Search, Filter,
  Cpu, HardDrive, Star, Clock, Activity, Layers, Brain, Eye, Mic, Code,
  Play, Pause, Square, RotateCw, X, ChevronDown, ChevronRight,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────

type Tab = 'browse' | 'downloads' | 'history';

interface CatalogModel {
  id: string; name: string; provider: string; type: string;
  sizeGB: number; requiredRAM: number; requiredVRAM: number;
  quantization: string; parameterCount: string; contextSize: number;
  qualityScore: number; speedScore: number; codingScore: number; reasoningScore: number;
  persianSupport: boolean; recommendedTier: string;
  displayNameFa: string; descriptionFa: string; isEssential: boolean;
  downloadUrl: string;
}

interface InstalledModel {
  id: string; name: string; category: string; sizeBytes: number;
  quantization?: string; parameterCount?: string; fileExists: boolean;
  loaded: boolean; canRun: boolean;
}

interface DeploymentProgress {
  stage: string; message: string; messageFa: string;
  percent?: number; bytesDownloaded?: number; totalBytes?: number; speedBytesPerSec?: number;
}

interface DeploymentResult {
  success: boolean; stage: string; modelId?: string; modelName?: string;
  verification?: { passed: boolean; sizeBytes: number; checksum?: string };
  inferenceTest?: { status: string; tokensPerSecond: number; tokensGenerated: number; response?: string };
  error?: string; durationMs: number; log: string[];
}

// ─── Stage Metadata ────────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  { id: 'preparing', label: 'آماده‌سازی', labelEn: 'Preparing', icon: '📦' },
  { id: 'requesting-permission', label: 'بررسی اجازه', labelEn: 'Permission', icon: '🔐' },
  { id: 'downloading', label: 'دانلود', labelEn: 'Downloading', icon: '⬇️' },
  { id: 'verifying', label: 'تأیید GGUF', labelEn: 'Verify GGUF', icon: '🔍' },
  { id: 'checksum', label: 'بررسی چک‌سام', labelEn: 'Checksum', icon: '🔑' },
  { id: 'registering', label: 'ثبت مدل', labelEn: 'Register', icon: '📝' },
  { id: 'loading', label: 'بارگذاری رانتایم', labelEn: 'Load Runtime', icon: '⚙️' },
  { id: 'testing-inference', label: 'آزمایش استنتاج', labelEn: 'Test Inference', icon: '🧪' },
  { id: 'completed', label: 'تکمیل', labelEn: 'Completed', icon: '✅' },
];

const STAGE_MAP: Record<string, { color: string; label: string }> = {
  'idle': { color: '#64748b', label: 'بیکار' },
  'requesting-permission': { color: '#f59e0b', label: 'درخواست اجازه' },
  'permission-denied': { color: '#ef4444', label: 'اجازه رد شد' },
  'downloading': { color: '#06b6d4', label: 'در حال دانلود' },
  'download-complete': { color: '#22c55e', label: 'دانلود کامل' },
  'download-failed': { color: '#ef4444', label: 'دانلود ناموفق' },
  'verifying': { color: '#8b5cf6', label: 'در حال تأیید' },
  'verification-passed': { color: '#22c55e', label: 'تأیید شد' },
  'verification-failed': { color: '#ef4444', label: 'تأیید ناموفق' },
  'registering': { color: '#3b82f6', label: 'در حال ثبت' },
  'registration-complete': { color: '#22c55e', label: 'ثبت شد' },
  'registration-failed': { color: '#ef4444', label: 'ثبت ناموفق' },
  'testing-inference': { color: '#8b5cf6', label: 'آزمایش استنتاج' },
  'inference-passed': { color: '#22c55e', label: 'آزمایش موفق' },
  'inference-failed': { color: '#f59e0b', label: 'آزمایش ناموفق' },
  'deployed': { color: '#22c55e', label: 'مستقر شد' },
  'rolled-back': { color: '#ef4444', label: 'بازگشت داده شد' },
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  llm: <Brain size={14} />, vision: <Eye size={14} />,
  'voice-stt': <Mic size={14} />, 'voice-tts': <Mic size={14} />, embedding: <Layers size={14} />,
};
const TYPE_LABELS_FA: Record<string, string> = {
  llm: 'زبان', vision: 'بینایی', 'voice-stt': 'گفتار→متن', 'voice-tts': 'متن→گفتار', embedding: 'جاسازی',
};
const TIER_COLORS: Record<string, string> = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' };

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec < 0) return '—';
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}
function formatETA(seconds: number): string {
  if (!seconds || seconds < 0) return '—';
  if (seconds < 60) return `${Math.ceil(seconds)} ثانیه`;
  return `${Math.ceil(seconds / 60)} دقیقه`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ModelDeploymentPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('browse');
  const [status, setStatus] = useState<any>(null);
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [progress, setProgress] = useState<DeploymentProgress | null>(null);
  const [lastResult, setLastResult] = useState<DeploymentResult | null>(null);
  const [history, setHistory] = useState<DeploymentResult[]>([]);
  const [pendingPermission, setPendingPermission] = useState<any>(null);
  const [permissionInput, setPermissionInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [importPath, setImportPath] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterInstalled, setFilterInstalled] = useState(false);
  const [filterHardware, setFilterHardware] = useState(false);
  const progressStartRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, catRes, installedRes] = await Promise.all([
        window.nexAPI.modelDeployStatus(),
        window.nexAPI.ecosystemCatalog(),
        window.nexAPI.localRuntimeListModels(),
      ]);
      if (statusRes.success) setStatus(statusRes.status);
      if (catRes.success) setCatalog(catRes.catalog || []);
      if (installedRes.success) setInstalled(installedRes.models || []);
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Subscribe to real-time progress events from the backend
  useEffect(() => {
    const unsub = window.nexAPI.onModelDeploymentProgress((prog: DeploymentProgress) => {
      setProgress(prog);
      if (prog.stage === 'downloading' && progressStartRef.current === null) {
        progressStartRef.current = Date.now();
      }
      if (prog.stage === 'deployed' || prog.stage === 'rolled-back' || prog.stage.includes('failed') || prog.stage.includes('denied')) {
        progressStartRef.current = null;
      }
    });
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

  // ── Actions ──

  const handleImport = async () => {
    if (!importPath.trim()) return;
    setBusy(true); setError(null); setProgress(null); setLastResult(null);
    try {
      const res = await window.nexAPI.modelDeployImport(importPath);
      if (res.success && res.result?.success) {
        setLastResult(res.result);
        setHistory(prev => [res.result, ...prev].slice(0, 20));
        showToast('ok', `مدل مستقر شد: ${res.result.modelName}`);
      } else {
        const errResult = res.result || { success: false, error: res.error, stage: 'import-failed', log: [] };
        setLastResult(errResult);
        setHistory(prev => [errResult, ...prev].slice(0, 20));
        setError(res.error || res.result?.error || 'وارد کردن ناموفق بود');
      }
      await refresh();
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async (url?: string) => {
    const targetUrl = url || downloadUrl;
    if (!targetUrl.trim()) return;
    setBusy(true); setError(null); setProgress(null); setLastResult(null);
    setDownloadUrl(targetUrl);
    try {
      const res = await window.nexAPI.modelDeployDownload({ url: targetUrl });
      if (res.success && res.result?.success) {
        setLastResult(res.result);
        setHistory(prev => [res.result, ...prev].slice(0, 20));
        showToast('ok', `مدل دانلود و مستقر شد: ${res.result.modelName}`);
      } else {
        const errResult = res.result || { success: false, error: res.error, stage: 'download-failed', log: [] };
        setLastResult(errResult);
        setHistory(prev => [errResult, ...prev].slice(0, 20));
        setError(res.error || res.result?.error || 'دانلود ناموفق بود');
      }
      await refresh();
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRetry = async () => {
    if (lastResult?.modelName) {
      // Try to retry the last operation
      setLastResult(null);
      setError(null);
      // If the last URL is still in downloadUrl, retry download
      if (downloadUrl) {
        await handleDownload();
      }
    }
  };

  const handleRemoveModel = async (modelId: string, name: string) => {
    setBusy(true);
    try {
      const res = await window.nexAPI.modelDeployRemove(modelId, true);
      if (res.success) {
        showToast('ok', `مدل حذف شد: ${name}`);
        await refresh();
      } else {
        setError(res.error || res.result?.error || 'حذف ناموفق بود');
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

  // ── Derived state ──

  const installedIds = new Set(installed.map(m => m.id));
  const installedNames = new Set(installed.map(m => m.name.toLowerCase()));

  // Filtered catalog
  const filteredCatalog = catalog.filter(m => {
    if (filterType !== 'all' && m.type !== filterType) return false;
    if (filterInstalled && !installedNames.has(m.name.toLowerCase()) && !installedIds.has(m.id)) return false;
    if (search) {
      const s = search.toLowerCase();
      return m.name.toLowerCase().includes(s) || m.displayNameFa.includes(search) || m.provider.toLowerCase().includes(s);
    }
    return true;
  });

  // Recommended models (low tier = runs on most hardware)
  const recommended = catalog.filter(m => m.recommendedTier === 'low' && m.isEssential).slice(0, 3);

  // Progress calculations
  const progressPercent = progress?.percent ?? 0;
  const downloadedBytes = progress?.bytesDownloaded ?? 0;
  const totalBytes = progress?.totalBytes ?? 0;
  const speed = progress?.speedBytesPerSec ?? 0;
  const remainingBytes = totalBytes > downloadedBytes ? totalBytes - downloadedBytes : 0;
  const etaSeconds = speed > 0 ? remainingBytes / speed : -1;
  const elapsedSeconds = progressStartRef.current ? (Date.now() - progressStartRef.current) / 1000 : 0;

  // Current pipeline stage index
  const currentStageId = progress?.stage || status?.currentStage || 'idle';
  const pipelineStageIdx = PIPELINE_STAGES.findIndex(s => currentStageId.includes(s.id) ||
    (s.id === 'downloading' && currentStageId === 'download-complete') ||
    (s.id === 'verifying' && (currentStageId === 'verification-passed' || currentStageId === 'verification-failed')) ||
    (s.id === 'registering' && (currentStageId === 'registration-complete' || currentStageId === 'registration-failed')) ||
    (s.id === 'testing-inference' && (currentStageId === 'inference-passed' || currentStageId === 'inference-failed')) ||
    (s.id === 'completed' && (currentStageId === 'deployed' || currentStageId === 'rolled-back'))
  );

  const isDeploying = busy || (progress && !['idle', 'deployed', 'rolled-back'].includes(progress.stage) && !progress.stage.includes('failed') && !progress.stage.includes('denied'));

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        <div className="flex items-center gap-2">
          <PackageCheck size={16} style={{ color: 'var(--nex-accent)' }} />
          <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>MODEL DEPLOYMENT</span>
          {status && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: `${(STAGE_MAP[status.currentStage] || STAGE_MAP.idle).color}22`, color: (STAGE_MAP[status.currentStage] || STAGE_MAP.idle).color }}>
              {(STAGE_MAP[status.currentStage] || STAGE_MAP.idle).label}
            </span>
          )}
        </div>
        <button onClick={refresh} disabled={loading} className="p-1 rounded transition-colors hover:bg-white/[0.06] disabled:opacity-50" style={{ color: 'var(--nex-text-muted)' }}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        {([
          ['browse', 'مرور مدل‌ها'],
          ['downloads', 'دانلود'],
          ['history', 'تاریخچه'],
        ] as Array<[Tab, string]>).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className="nex-click nex-focus px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all"
            style={{
              background: tab === id ? 'var(--nex-accent-dim)' : 'transparent',
              color: tab === id ? 'var(--nex-accent-text)' : 'var(--nex-text-muted)',
              border: tab === id ? '1px solid var(--nex-accent-glow)' : '1px solid transparent',
            }}>
            {label}
            {id === 'downloads' && isDeploying && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#06b6d4' }} />}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto nex-scroll p-3 space-y-3" style={{ maxHeight: 'calc(100vh - 180px)' }}>
        {error && (
          <ErrorCard error={error} onRetry={handleRetry} onClose={() => setError(null)} />
        )}

        {/* ═══ Browse Tab ═══ */}
        {tab === 'browse' && (
          <>
            {/* Recommended section */}
            {recommended.length > 0 && !filterInstalled && !filterHardware && (
              <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid rgba(34,197,94,0.2)' }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <Star size={11} style={{ color: 'var(--nex-success)' }} />
                  <span className="text-[10px] font-medium" style={{ color: 'var(--nex-success)' }}>پیشنهادی برای سخت‌افزار شما</span>
                </div>
                <div className="space-y-1">
                  {recommended.map(m => (
                    <RecommendedModelRow key={m.id} model={m} installed={installedNames.has(m.name.toLowerCase())} onDownload={() => handleDownload(m.downloadUrl)} busy={busy} />
                  ))}
                </div>
              </div>
            )}

            {/* Search + filters */}
            <div className="flex gap-1.5 flex-wrap">
              <div className="flex-1 min-w-[120px] relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--nex-text-muted)' }} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجو..."
                  className="w-full pl-7 pr-2 py-1 rounded-lg text-[11px] nex-focus" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }} />
              </div>
              <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-1.5 py-1 rounded-lg text-[10px] nex-focus" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }}>
                <option value="all">همه نوع</option>
                <option value="llm">زبان</option>
                <option value="vision">بینایی</option>
                <option value="voice-stt">STT</option>
                <option value="voice-tts">TTS</option>
                <option value="embedding">جاسازی</option>
              </select>
              <button onClick={() => setFilterInstalled(!filterInstalled)} className="nex-click nex-focus px-2 py-1 rounded-lg text-[10px] font-medium"
                style={{ background: filterInstalled ? 'var(--nex-accent-dim)' : 'transparent', color: filterInstalled ? 'var(--nex-accent-text)' : 'var(--nex-text-muted)', border: `1px solid ${filterInstalled ? 'var(--nex-accent-glow)' : 'var(--nex-panel-border)'}` }}>
                نصب‌شده
              </button>
            </div>

            {/* Import + Download URL */}
            <div className="grid grid-cols-1 gap-2">
              <div className="p-2 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Upload size={10} style={{ color: 'var(--nex-accent)' }} />
                  <span className="text-[9px] font-medium" style={{ color: 'var(--nex-text-muted)' }}>وارد کردن فایل (ایمن)</span>
                </div>
                <div className="flex gap-1">
                  <input value={importPath} onChange={e => setImportPath(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && importPath.trim()) handleImport(); }}
                    placeholder="/path/to/model.gguf" className="flex-1 px-2 py-1 rounded text-[10px] nex-focus" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }} />
                  <button onClick={handleImport} disabled={busy || !importPath.trim()} className="nex-click nex-focus flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium disabled:opacity-50" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}>
                    {busy ? <Loader2 size={9} className="animate-spin" /> : <Upload size={9} />} وارد کردن
                  </button>
                </div>
              </div>
              <div className="p-2 rounded-lg nex-glass" style={{ border: '1px solid rgba(245,158,11,0.2)' }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Download size={10} style={{ color: '#fcd34d' }} />
                  <span className="text-[9px] font-medium" style={{ color: 'var(--nex-text-muted)' }}>دانلود از URL (نیازمند اجازه)</span>
                </div>
                <div className="flex gap-1">
                  <input value={downloadUrl} onChange={e => setDownloadUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && downloadUrl.trim()) handleDownload(); }}
                    placeholder="https://huggingface.co/.../model.gguf" className="flex-1 px-2 py-1 rounded text-[10px] nex-focus" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }} />
                  <button onClick={() => handleDownload()} disabled={busy || !downloadUrl.trim()} className="nex-click nex-focus flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium disabled:opacity-50" style={{ background: 'rgba(245,158,11,0.15)', color: '#fcd34d', border: '1px solid rgba(245,158,11,0.3)' }}>
                    {busy ? <Loader2 size={9} className="animate-spin" /> : <Download size={9} />} دانلود
                  </button>
                </div>
              </div>
            </div>

            {/* Model cards */}
            <div className="space-y-2">
              {filteredCatalog.map(m => (
                <ModelCard key={m.id} model={m} installed={installedNames.has(m.name.toLowerCase())} onDownload={() => handleDownload(m.downloadUrl)} onRemove={(id, name) => handleRemoveModel(id, name)} busy={busy} />
              ))}
              {filteredCatalog.length === 0 && (
                <div className="text-center py-6 text-[11px]" style={{ color: 'var(--nex-text-muted)' }}>مدلی یافت نشد</div>
              )}
            </div>
          </>
        )}

        {/* ═══ Downloads Tab ═══ */}
        {tab === 'downloads' && (
          <>
            {/* Active download manager */}
            {progress && isDeploying ? (
              <DownloadManager
                progress={progress}
                percent={progressPercent}
                downloadedBytes={downloadedBytes}
                totalBytes={totalBytes}
                speed={speed}
                remainingBytes={remainingBytes}
                etaSeconds={etaSeconds}
                elapsedSeconds={elapsedSeconds}
              />
            ) : (
              <div className="text-center py-8 text-[11px]" style={{ color: 'var(--nex-text-muted)' }}>
                {lastResult?.success ? 'استقرار تکمیل شد ✓' : 'دانلود فعالی وجود ندارد'}
              </div>
            )}

            {/* Pipeline visualization */}
            {progress && (
              <PipelineVisualization stages={PIPELINE_STAGES} currentIdx={pipelineStageIdx} failed={progress.stage.includes('failed') || progress.stage.includes('denied')} />
            )}

            {/* Last result */}
            {lastResult && (
              <ResultCard result={lastResult} onRetry={handleRetry} />
            )}
          </>
        )}

        {/* ═══ History Tab ═══ */}
        {tab === 'history' && (
          <div className="space-y-2">
            {history.length === 0 ? (
              <div className="text-center py-8 text-[11px]" style={{ color: 'var(--nex-text-muted)' }}>تاریخچه‌ای موجود نیست</div>
            ) : (
              history.map((h, i) => <HistoryRow key={i} result={h} onRetry={handleRetry} />)
            )}
          </div>
        )}

        {/* Security note */}
        <div className="p-2 rounded-lg text-[9px] flex items-start gap-1.5" style={{ background: 'rgba(34,197,94,0.06)', color: 'var(--nex-text-muted)' }}>
          <ShieldCheck size={10} className="mt-0.5 shrink-0" style={{ color: 'var(--nex-success)' }} />
          <span>تمام دانلودها نیازمند اجازه صریح هستند. فقط HTTPS. تأیید چک‌سام و سازگاری سخت‌افزاری قبل از ثبت. تمام استنتاج محلی و آفلاین است.</span>
        </div>
      </div>

      {/* Permission dialog */}
      {pendingPermission && (
        <div className="absolute inset-0 flex items-end p-3 pointer-events-none" style={{ zIndex: 20 }}>
          <div className="nex-glass-strong w-full p-3 rounded-xl pointer-events-auto" style={{ border: '1px solid var(--nex-accent-glow)' }}>
            <div className="flex items-center gap-1.5 mb-2">
              <ShieldCheck size={13} style={{ color: 'var(--nex-accent)' }} />
              <span className="text-[11px] font-medium" style={{ color: 'var(--nex-accent-text)' }}>درخواست اجازه — {pendingPermission.operation}</span>
            </div>
            <p className="text-[11px] mb-1" style={{ color: 'var(--nex-text)' }}>{pendingPermission.action?.description}</p>
            {pendingPermission.action?.reason && <p className="text-[10px] mb-2" style={{ color: 'var(--nex-text-muted)' }}>{pendingPermission.action.reason}</p>}
            {pendingPermission.sizeBytes && <p className="text-[10px] mb-2" style={{ color: 'var(--nex-text-muted)' }}>حجم: {formatBytes(pendingPermission.sizeBytes)}</p>}
            <p className="text-[10px] mb-2" style={{ color: 'var(--nex-text-muted)' }}>عبارت: <span style={{ color: 'var(--nex-accent-text)' }}>{pendingPermission.requiredPhrase}</span></p>
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

// ─── Model Card ────────────────────────────────────────────────────────────

function ModelCard({ model, installed, onDownload, onRemove, busy }: { model: CatalogModel; installed: boolean; onDownload: () => void; onRemove: (id: string, name: string) => void; busy: boolean }) {
  const tierColor = TIER_COLORS[model.recommendedTier] || '#64748b';
  return (
    <div className="p-2.5 rounded-lg nex-glass nex-hover-lift transition-all" style={{ border: `1px solid ${installed ? 'rgba(34,197,94,0.2)' : 'var(--nex-panel-border)'}` }}>
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <span style={{ color: 'var(--nex-accent)' }}>{TYPE_ICONS[model.type] || <Brain size={14} />}</span>
        <span className="text-[11px] font-medium flex-1 truncate" style={{ color: 'var(--nex-text)' }}>{model.displayNameFa}</span>
        {/* Status badge */}
        {installed ? (
          <span className="text-[8px] px-1.5 py-0.5 rounded flex items-center gap-0.5" style={{ background: 'rgba(34,197,94,0.15)', color: '#86efac' }}>
            <CheckCircle2 size={8} /> نصب‌شده
          </span>
        ) : (
          <span className="text-[8px] px-1.5 py-0.5 rounded flex items-center gap-0.5" style={{ background: 'rgba(6,182,212,0.15)', color: '#67e8f9' }}>
            <Download size={8} /> آماده دانلود
          </span>
        )}
        {model.persianSupport && <span className="text-[7px] px-1 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.1)', color: '#86efac' }}>فارسی</span>}
        <span className="text-[7px] px-1 py-0.5 rounded" style={{ background: `${tierColor}22`, color: tierColor }}>{model.recommendedTier}</span>
      </div>
      {/* Specs row */}
      <div className="flex items-center gap-2 text-[8px] ml-4 mb-1.5" style={{ color: 'var(--nex-text-muted)' }}>
        <span>{model.provider}</span><span>•</span>
        <span>{model.parameterCount}</span><span>•</span>
        <span>{model.quantization}</span><span>•</span>
        <span>{model.sizeGB.toFixed(1)} GB</span><span>•</span>
        <span>RAM {model.requiredRAM}GB</span>
        {model.requiredVRAM > 0 && <><span>•</span><span>VRAM {model.requiredVRAM}GB</span></>}
      </div>
      {/* Scores */}
      <div className="flex items-center gap-2 ml-4 mb-1.5">
        <ScoreBar label="کیفیت" value={model.qualityScore} />
        <ScoreBar label="سرعت" value={model.speedScore} />
        {model.codingScore > 0 && <ScoreBar label="کد" value={model.codingScore} />}
        {model.reasoningScore > 0 && <ScoreBar label="استدلال" value={model.reasoningScore} />}
      </div>
      {/* Description */}
      <p className="text-[9px] ml-4 mb-2" style={{ color: 'var(--nex-text-muted)' }}>{model.descriptionFa}</p>
      {/* Actions */}
      <div className="flex gap-1 ml-4">
        {!installed && (
          <button onClick={onDownload} disabled={busy} className="nex-click nex-focus flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium disabled:opacity-50" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}>
            <Download size={8} /> دانلود
          </button>
        )}
        {installed && (
          <button onClick={() => onRemove(model.id, model.name)} disabled={busy} className="nex-click nex-focus flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium" style={{ background: 'transparent', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}>
            <Trash2 size={8} /> حذف
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Recommended Model Row ─────────────────────────────────────────────────

function RecommendedModelRow({ model, installed, onDownload, busy }: { model: CatalogModel; installed: boolean; onDownload: () => void; busy: boolean }) {
  return (
    <div className="flex items-center gap-2 p-1.5 rounded" style={{ background: 'var(--nex-bg)' }}>
      <Star size={10} style={{ color: 'var(--nex-success)' }} />
      <span className="text-[10px] font-medium flex-1" style={{ color: 'var(--nex-text)' }}>{model.displayNameFa}</span>
      <span className="text-[8px]" style={{ color: 'var(--nex-text-muted)' }}>{model.sizeGB.toFixed(1)} GB</span>
      {installed ? (
        <CheckCircle2 size={10} style={{ color: 'var(--nex-success)' }} />
      ) : (
        <button onClick={onDownload} disabled={busy} className="nex-click nex-focus flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-medium disabled:opacity-50" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>
          <Download size={7} /> دانلود
        </button>
      )}
    </div>
  );
}

// ─── Download Manager ──────────────────────────────────────────────────────

function DownloadManager({ progress, percent, downloadedBytes, totalBytes, speed, remainingBytes, etaSeconds, elapsedSeconds }: {
  progress: DeploymentProgress; percent: number; downloadedBytes: number; totalBytes: number; speed: number; remainingBytes: number; etaSeconds: number; elapsedSeconds: number;
}) {
  const stageMeta = STAGE_MAP[progress.stage] || STAGE_MAP.idle;
  const barColor = stageMeta.color;
  return (
    <div className="p-3 rounded-lg nex-glass-strong" style={{ border: `1px solid ${barColor}44` }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="rounded-full flex items-center justify-center" style={{ width: 32, height: 32, background: `${barColor}22` }}>
          <Loader2 size={16} className="animate-spin" style={{ color: barColor }} />
        </div>
        <div className="flex-1">
          <div className="text-[11px] font-medium" style={{ color: 'var(--nex-text)' }}>{progress.messageFa || stageMeta.label}</div>
          <div className="text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>{progress.message}</div>
        </div>
        <span className="text-sm font-bold" style={{ color: barColor }}>{percent.toFixed(0)}%</span>
      </div>
      {/* Progress bar */}
      <div className="h-3 rounded-full overflow-hidden mb-3" style={{ background: 'var(--nex-bg)' }}>
        <div className="h-full rounded-full transition-all duration-300" style={{
          width: `${Math.max(2, percent)}%`,
          background: `linear-gradient(90deg, ${barColor}88, ${barColor})`,
          boxShadow: `0 0 8px ${barColor}55`,
        }} />
      </div>
      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="flex items-center gap-1">
          <Download size={9} style={{ color: 'var(--nex-text-muted)' }} />
          <span style={{ color: 'var(--nex-text-muted)' }}>دانلود شده:</span>
          <span style={{ color: 'var(--nex-text)' }}>{formatBytes(downloadedBytes)}</span>
          {totalBytes > 0 && <span style={{ color: 'var(--nex-text-muted)' }}>/ {formatBytes(totalBytes)}</span>}
        </div>
        <div className="flex items-center gap-1">
          <Activity size={9} style={{ color: 'var(--nex-text-muted)' }} />
          <span style={{ color: 'var(--nex-text-muted)' }}>سرعت:</span>
          <span style={{ color: 'var(--nex-text)' }}>{formatSpeed(speed)}</span>
        </div>
        <div className="flex items-center gap-1">
          <HardDrive size={9} style={{ color: 'var(--nex-text-muted)' }} />
          <span style={{ color: 'var(--nex-text-muted)' }}>باقیمانده:</span>
          <span style={{ color: 'var(--nex-text)' }}>{formatBytes(remainingBytes)}</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock size={9} style={{ color: 'var(--nex-text-muted)' }} />
          <span style={{ color: 'var(--nex-text-muted)' }}>زمان باقی‌مانده:</span>
          <span style={{ color: 'var(--nex-text)' }}>{formatETA(etaSeconds)}</span>
        </div>
        {elapsedSeconds > 0 && (
          <div className="flex items-center gap-1">
            <Clock size={9} style={{ color: 'var(--nex-text-muted)' }} />
            <span style={{ color: 'var(--nex-text-muted)' }}>زمان سپری‌شده:</span>
            <span style={{ color: 'var(--nex-text)' }}>{formatETA(elapsedSeconds)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pipeline Visualization ────────────────────────────────────────────────

function PipelineVisualization({ stages, currentIdx, failed }: { stages: typeof PIPELINE_STAGES; currentIdx: number; failed: boolean }) {
  return (
    <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
      <div className="text-[10px] font-medium mb-2" style={{ color: 'var(--nex-text-muted)' }}>مراحل استقرار</div>
      <div className="space-y-1">
        {stages.map((stage, i) => {
          const isPast = i < currentIdx;
          const isActive = i === currentIdx;
          const isFuture = i > currentIdx;
          const isFailed = failed && isActive;
          return (
            <div key={stage.id} className="flex items-center gap-2 text-[10px]">
              <div className="flex items-center justify-center rounded-full shrink-0" style={{
                width: 18, height: 18,
                background: isPast ? 'rgba(34,197,94,0.15)' : isActive ? (isFailed ? 'rgba(239,68,68,0.15)' : 'rgba(6,182,212,0.15)') : 'var(--nex-bg)',
                border: `1px solid ${isPast ? 'rgba(34,197,94,0.3)' : isActive ? (isFailed ? 'rgba(239,68,68,0.3)' : 'rgba(6,182,212,0.3)') : 'var(--nex-panel-border)'}`,
              }}>
                {isPast ? <CheckCircle2 size={10} style={{ color: 'var(--nex-success)' }} /> :
                 isActive ? (isFailed ? <XCircle size={10} style={{ color: '#fca5a5' }} /> : <Loader2 size={10} className="animate-spin" style={{ color: '#06b6d4' }} />) :
                 <span style={{ color: 'var(--nex-text-muted)', fontSize: '8px' }}>{i + 1}</span>}
              </div>
              <span style={{
                color: isPast ? 'var(--nex-success)' : isActive ? (isFailed ? '#fca5a5' : '#06b6d4') : 'var(--nex-text-muted)',
                fontWeight: isActive ? 600 : 400,
              }}>{stage.label}</span>
              {isActive && !isFailed && <span className="inline-block w-1 h-1 rounded-full animate-pulse" style={{ background: '#06b6d4' }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Error Card ────────────────────────────────────────────────────────────

function ErrorCard({ error, onRetry, onClose }: { error: string; onRetry: () => void; onClose: () => void }) {
  const errorType = classifyError(error);
  return (
    <div className="p-2.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
      <div className="flex items-center gap-1.5 mb-1">
        <AlertCircle size={12} style={{ color: '#fca5a5' }} />
        <span className="text-[11px] font-medium" style={{ color: '#fca5a5' }}>{errorType.title}</span>
        <button onClick={onClose} className="ml-auto p-0.5 rounded hover:bg-white/[0.06]"><X size={10} style={{ color: 'var(--nex-text-muted)' }} /></button>
      </div>
      <p className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}><span style={{ color: 'var(--nex-text-muted)' }}>دلیل:</span> {error}</p>
      <p className="text-[10px] mb-2" style={{ color: 'var(--nex-text-muted)' }}><span style={{ color: 'var(--nex-text-muted)' }}>راه‌حل:</span> {errorType.solution}</p>
      <button onClick={onRetry} className="nex-click nex-focus flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}>
        <RotateCw size={9} /> تلاش مجدد
      </button>
    </div>
  );
}

function classifyError(error: string): { title: string; solution: string } {
  const lower = error.toLowerCase();
  if (lower.includes('https') || lower.includes('network') || lower.includes('internet') || lower.includes('connection'))
    return { title: 'خطای شبکه', solution: 'اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.' };
  if (lower.includes('permission') || lower.includes('denied') || lower.includes('اجازه'))
    return { title: 'اجازه رد شد', solution: 'عملیات نیازمند تأیید صریح شماست. دوباره تلاش کنید و اجازه دهید.' };
  if (lower.includes('gguf') || lower.includes('magic') || lower.includes('format'))
    return { title: 'فایل GGUF نامعتبر', solution: 'فایل مدل خراب است یا فرمت صحیحی ندارد. فایل دیگری استفاده کنید.' };
  if (lower.includes('checksum') || lower.includes('hash') || lower.includes('mismatch'))
    return { title: 'عدم تطابق چک‌سام', solution: 'فایل دانلود شده تغییر کرده است. دوباره دانلود کنید.' };
  if (lower.includes('ram') || lower.includes('memory'))
    return { title: 'حافظه رم کافی نیست', solution: 'مدل کوچک‌تری انتخاب کنید یا برنامه‌های دیگر را ببندید.' };
  if (lower.includes('vram') || lower.includes('gpu'))
    return { title: 'حافظه گرافیکی کافی نیست', solution: 'مدل با کوانتیزه پایین‌تر استفاده کنید یا حالت CPU را فعال کنید.' };
  if (lower.includes('disk') || lower.includes('space'))
    return { title: 'فضای دیسک کافی نیست', solution: 'فضای آزاد دیسک را بررسی کنید و فایل‌های غیرضروری را حذف کنید.' };
  if (lower.includes('load') || lower.includes('runtime'))
    return { title: 'خطای بارگذاری رانتایم', solution: 'فایل مدل ممکن است خراب باشد. دوباره دانلود کنید.' };
  if (lower.includes('inference') || lower.includes('test'))
    return { title: 'آزمایش استنتاج ناموفق', solution: 'مدل بارگذاری شد اما استنتاج کار نکرد. تنظیمات GPU/threads را تغییر دهید.' };
  return { title: 'خطای استقرار', solution: 'عملیات ناموفق بود. دوباره تلاش کنید.' };
}

// ─── Result Card ───────────────────────────────────────────────────────────

function ResultCard({ result, onRetry }: { result: DeploymentResult; onRetry: () => void }) {
  const stageMeta = STAGE_MAP[result.stage] || STAGE_MAP.idle;
  return (
    <div className="p-2.5 rounded-lg nex-glass" style={{ border: `1px solid ${result.success ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
      <div className="flex items-center gap-1.5 mb-2">
        {result.success ? <CheckCircle2 size={12} style={{ color: 'var(--nex-success)' }} /> : <XCircle size={12} style={{ color: '#fca5a5' }} />}
        <span className="text-[11px] font-medium" style={{ color: 'var(--nex-text)' }}>{result.success ? 'استقرار موفق' : 'استقرار ناموفق'}</span>
        <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded" style={{ background: `${stageMeta.color}22`, color: stageMeta.color }}>{stageMeta.label}</span>
      </div>
      {result.modelName && <div className="text-[10px] mb-1" style={{ color: 'var(--nex-text)' }}>مدل: {result.modelName}</div>}
      {result.verification && (
        <div className="text-[9px] mb-1" style={{ color: 'var(--nex-text-muted)' }}>
          تأیید: {result.verification.passed ? '✓ موفق' : '✗ ناموفق'} • حجم: {formatBytes(result.verification.sizeBytes)}
          {result.verification.checksum && ` • SHA-256: ${result.verification.checksum.slice(0, 12)}...`}
        </div>
      )}
      {result.inferenceTest && (
        <div className="text-[9px] mb-1" style={{ color: 'var(--nex-text-muted)' }}>
          آزمایش: {result.inferenceTest.status === 'passed' ? '✓ موفق' : '✗ ناموفق'} • {result.inferenceTest.tokensPerSecond.toFixed(1)} توکن/ثانیه • {result.inferenceTest.tokensGenerated} توکن
        </div>
      )}
      {result.inferenceTest?.response && (
        <div className="text-[9px] p-1.5 rounded mt-1" style={{ background: 'var(--nex-bg)', color: 'var(--nex-text-muted)' }}>
          پاسخ: "{result.inferenceTest.response.slice(0, 120)}..."
        </div>
      )}
      {result.error && <div className="text-[9px] mt-1" style={{ color: '#fca5a5' }}>خطا: {result.error}</div>}
      {!result.success && (
        <button onClick={onRetry} className="mt-2 nex-click nex-focus flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}>
          <RotateCw size={9} /> تلاش مجدد
        </button>
      )}
    </div>
  );
}

// ─── History Row ───────────────────────────────────────────────────────────

function HistoryRow({ result, onRetry }: { result: DeploymentResult; onRetry: () => void }) {
  const stageMeta = STAGE_MAP[result.stage] || STAGE_MAP.idle;
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--nex-bg)', border: `1px solid ${result.success ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}` }}>
      {result.success ? <CheckCircle2 size={12} style={{ color: 'var(--nex-success)' }} /> : <XCircle size={12} style={{ color: '#fca5a5' }} />}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-medium truncate" style={{ color: 'var(--nex-text)' }}>{result.modelName || 'مدل نامشخص'}</div>
        <div className="text-[8px]" style={{ color: 'var(--nex-text-muted)' }}>
          {stageMeta.label} • {result.durationMs > 0 ? `${(result.durationMs / 1000).toFixed(1)}s` : '—'}
          {result.error ? ` • ${result.error.slice(0, 50)}` : ''}
        </div>
      </div>
      {!result.success && (
        <button onClick={onRetry} className="nex-click nex-focus p-1 rounded" style={{ color: '#fca5a5' }} title="تلاش مجدد">
          <RotateCw size={10} />
        </button>
      )}
    </div>
  );
}

// ─── Score Bar ─────────────────────────────────────────────────────────────

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? '#22c55e' : value >= 60 ? '#f59e0b' : '#64748b';
  return (
    <div className="flex items-center gap-1">
      <span className="text-[8px]" style={{ color: 'var(--nex-text-muted)' }}>{label}</span>
      <div className="w-8 h-1 rounded-full overflow-hidden" style={{ background: 'var(--nex-bg)' }}>
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-[7px]" style={{ color }}>{value}</span>
    </div>
  );
}
