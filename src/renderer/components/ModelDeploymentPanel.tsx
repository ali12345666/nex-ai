/**
 * NEX AI — Model Deployment Panel (Phase 61)
 *
 * Deploys real GGUF local models: import from disk, download from URL
 * (permission-gated), verify, test inference. Shows deployment status,
 * progress, and permission dialogs.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  PackageCheck, RefreshCw, Upload, Download, Trash2, ShieldCheck, AlertCircle,
  CheckCircle2, XCircle, Loader2, Zap, FileCheck, Gauge,
} from 'lucide-react';

const STAGE_META: Record<string, { color: string; label: string; labelFa: string }> = {
  'idle': { color: '#64748b', label: 'Idle', labelFa: 'بیکار' },
  'requesting-permission': { color: '#f59e0b', label: 'Requesting Permission', labelFa: 'درخواست اجازه' },
  'permission-denied': { color: '#ef4444', label: 'Permission Denied', labelFa: 'اجازه رد شد' },
  'downloading': { color: '#06b6d4', label: 'Downloading', labelFa: 'در حال دانلود' },
  'download-complete': { color: '#22c55e', label: 'Download Complete', labelFa: 'دانلود کامل شد' },
  'download-failed': { color: '#ef4444', label: 'Download Failed', labelFa: 'دانلود ناموفق' },
  'verifying': { color: '#8b5cf6', label: 'Verifying', labelFa: 'در حال تأیید' },
  'verification-passed': { color: '#22c55e', label: 'Verified', labelFa: 'تأیید شد' },
  'verification-failed': { color: '#ef4444', label: 'Verification Failed', labelFa: 'تأیید ناموفق' },
  'registering': { color: '#3b82f6', label: 'Registering', labelFa: 'در حال ثبت' },
  'registration-complete': { color: '#22c55e', label: 'Registered', labelFa: 'ثبت شد' },
  'registration-failed': { color: '#ef4444', label: 'Registration Failed', labelFa: 'ثبت ناموفق' },
  'testing-inference': { color: '#8b5cf6', label: 'Testing', labelFa: 'در حال آزمایش' },
  'inference-passed': { color: '#22c55e', label: 'Test Passed', labelFa: 'آزمایش موفق' },
  'inference-failed': { color: '#f59e0b', label: 'Test Failed', labelFa: 'آزمایش ناموفق' },
  'deployed': { color: '#22c55e', label: 'Deployed', labelFa: 'مستقر شد' },
  'rolled-back': { color: '#ef4444', label: 'Rolled Back', labelFa: 'بازگشت داده شد' },
};

function formatBytes(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function ModelDeploymentPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [importPath, setImportPath] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [pendingPermission, setPendingPermission] = useState<any>(null);
  const [permissionInput, setPermissionInput] = useState('');
  const [lastResult, setLastResult] = useState<any>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.nexAPI.modelDeployStatus();
      if (res.success) setStatus(res.status);
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

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

  const handleImport = async () => {
    if (!importPath.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await window.nexAPI.modelDeployImport(importPath);
      if (res.success && res.result?.success) {
        setLastResult(res.result);
        showToast('ok', `مدل مستقر شد: ${res.result.modelName}`);
      } else {
        setError(res.error || res.result?.error || 'وارد کردن ناموفق بود');
        if (res.result) setLastResult(res.result);
      }
      await refresh();
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async () => {
    if (!downloadUrl.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await window.nexAPI.modelDeployDownload({ url: downloadUrl });
      if (res.success && res.result?.success) {
        setLastResult(res.result);
        showToast('ok', `مدل دانلود و مستقر شد: ${res.result.modelName}`);
      } else {
        setError(res.error || res.result?.error || 'دانلود ناموفق بود');
        if (res.result) setLastResult(res.result);
      }
      await refresh();
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setBusy(false);
    }
  };

  const respondPermission = async (response: string) => {
    await window.nexAPI.modelDeployRespondPermission(response);
    setPendingPermission(null);
    setPermissionInput('');
  };

  const currentStage = status?.currentStage || 'idle';
  const stageMeta = STAGE_META[currentStage] || STAGE_META['idle'];

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        <div className="flex items-center gap-2">
          <PackageCheck size={16} style={{ color: 'var(--nex-accent)' }} />
          <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
            MODEL DEPLOYMENT
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: `${stageMeta.color}22`, color: stageMeta.color }}>
            {stageMeta.labelFa}
          </span>
        </div>
        <button onClick={refresh} disabled={loading} className="p-1 rounded transition-colors hover:bg-white/[0.06] disabled:opacity-50" style={{ color: 'var(--nex-text-muted)' }}>
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

        {/* Import from file */}
        <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Upload size={11} style={{ color: 'var(--nex-accent)' }} />
            <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>وارد کردن از فایل (ایمن)</span>
          </div>
          <div className="flex gap-1.5">
            <input value={importPath} onChange={(e) => setImportPath(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && importPath.trim()) handleImport(); }}
              placeholder="/path/to/model.gguf" className="flex-1 px-2 py-1 rounded-lg text-[11px] nex-focus" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }} />
            <button onClick={handleImport} disabled={busy || !importPath.trim()} className="nex-click nex-focus flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}>
              {busy ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />} وارد کردن
            </button>
          </div>
          <p className="text-[9px] mt-1" style={{ color: 'var(--nex-text-muted)' }}>وارد کردن فایل محلی ایمن است — نیازی به اجازه نیست.</p>
        </div>

        {/* Download from URL */}
        <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid rgba(245,158,11,0.3)' }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Download size={11} style={{ color: '#fcd34d' }} />
            <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>دانلود از URL (نیازمند اجازه)</span>
          </div>
          <div className="flex gap-1.5">
            <input value={downloadUrl} onChange={(e) => setDownloadUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && downloadUrl.trim()) handleDownload(); }}
              placeholder="https://huggingface.co/.../model.gguf" className="flex-1 px-2 py-1 rounded-lg text-[11px] nex-focus" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }} />
            <button onClick={handleDownload} disabled={busy || !downloadUrl.trim()} className="nex-click nex-focus flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50" style={{ background: 'rgba(245,158,11,0.15)', color: '#fcd34d', border: '1px solid rgba(245,158,11,0.3)' }}>
              {busy ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />} دانلود
            </button>
          </div>
          <p className="text-[9px] mt-1" style={{ color: 'var(--nex-text-muted)' }}>فقط HTTPS. قبل از دانلود نیازمند تأیید صریح است.</p>
        </div>

        {/* Last deployment result */}
        {lastResult && (
          <div className="p-2.5 rounded-lg nex-glass" style={{ border: `1px solid ${lastResult.success ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
            <div className="flex items-center gap-1.5 mb-2">
              {lastResult.success ? <CheckCircle2 size={11} style={{ color: 'var(--nex-success)' }} /> : <XCircle size={11} style={{ color: '#fca5a5' }} />}
              <span className="text-[10px] font-medium" style={{ color: 'var(--nex-text)' }}>نتیجه آخرین استقرار</span>
              <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded" style={{ background: `${(STAGE_META[lastResult.stage] || STAGE_META['idle']).color}22`, color: (STAGE_META[lastResult.stage] || STAGE_META['idle']).color }}>
                {(STAGE_META[lastResult.stage] || STAGE_META['idle']).labelFa}
              </span>
            </div>
            {lastResult.modelName && (
              <div className="text-[10px] mb-1" style={{ color: 'var(--nex-text)' }}>مدل: {lastResult.modelName}</div>
            )}
            {lastResult.verification && (
              <div className="text-[9px] mb-1" style={{ color: 'var(--nex-text-muted)' }}>
                تأیید: {lastResult.verification.passed ? '✓ موفق' : '✗ ناموفق'} • حجم: {formatBytes(lastResult.verification.sizeBytes)}
                {lastResult.verification.checksum && ` • SHA-256: ${lastResult.verification.checksum.slice(0, 12)}...`}
              </div>
            )}
            {lastResult.inferenceTest && (
              <div className="text-[9px] mb-1" style={{ color: 'var(--nex-text-muted)' }}>
                آزمایش: {lastResult.inferenceTest.status === 'passed' ? '✓ موفق' : lastResult.inferenceTest.status === 'failed' ? '✗ ناموفق' : '⊘ نادیده'} • {lastResult.inferenceTest.tokensPerSecond.toFixed(1)} توکن/ثانیه • {lastResult.inferenceTest.tokensGenerated} توکن
              </div>
            )}
            {lastResult.inferenceTest?.response && (
              <div className="text-[9px] p-1.5 rounded mt-1" style={{ background: 'var(--nex-bg)', color: 'var(--nex-text-muted)' }}>
                پاسخ: "{lastResult.inferenceTest.response.slice(0, 100)}..."
              </div>
            )}
            {lastResult.error && (
              <div className="text-[9px] mt-1" style={{ color: '#fca5a5' }}>خطا: {lastResult.error}</div>
            )}
          </div>
        )}

        {/* Deployment stats */}
        {status && (
          <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
            <div className="grid grid-cols-3 gap-2 text-[10px]">
              <div className="text-center">
                <div style={{ color: 'var(--nex-text-muted)' }}>مستقر شده</div>
                <div className="text-sm font-bold" style={{ color: 'var(--nex-success)' }}>{status.totalDeployed}</div>
              </div>
              <div className="text-center">
                <div style={{ color: 'var(--nex-text-muted)' }}>دانلود شده</div>
                <div className="text-sm font-bold" style={{ color: '#06b6d4' }}>{status.totalDownloaded}</div>
              </div>
              <div className="text-center">
                <div style={{ color: 'var(--nex-text-muted)' }}>وارد شده</div>
                <div className="text-sm font-bold" style={{ color: '#3b82f6' }}>{status.totalImported}</div>
              </div>
            </div>
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
            {pendingPermission.action?.reason && (
              <p className="text-[10px] mb-2" style={{ color: 'var(--nex-text-muted)' }}>{pendingPermission.action.reason}</p>
            )}
            {pendingPermission.sizeBytes && (
              <p className="text-[10px] mb-2" style={{ color: 'var(--nex-text-muted)' }}>حجم: {formatBytes(pendingPermission.sizeBytes)}</p>
            )}
            <p className="text-[10px] mb-2" style={{ color: 'var(--nex-text-muted)' }}>
              عبارت مورد نیاز: <span style={{ color: 'var(--nex-accent-text)' }}>{pendingPermission.requiredPhrase}</span>
            </p>
            <div className="flex gap-1.5">
              <input value={permissionInput} onChange={(e) => setPermissionInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && permissionInput.trim()) respondPermission(permissionInput); }}
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
          border: `1px solid ${toast.kind === 'ok' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          zIndex: 25,
        }}>{toast.msg}</div>
      )}
    </div>
  );
}
