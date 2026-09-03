/**
 * NEX AI — Runtime Setup Panel (Phase 48 — Full UI Integration)
 *
 * Complete guided installer UI with:
 *   - System info (CPU, RAM, GPU, VRAM, OS)
 *   - Component status (installed/missing/partial)
 *   - Install buttons (Enable Voice, Enable Vision, Install Model, Optimize)
 *   - Permission dialog (Persian text + [تایید می‌کنم] / [لغو] buttons)
 *   - Progress UI (downloading %, verifying ✓, installing ✓, testing ✓, activated ✓)
 *   - First-launch wizard
 *
 * CRITICAL: NEVER downloads/installs without explicit user permission.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Cpu, HardDrive, CheckCircle2, XCircle, AlertTriangle, Sparkles,
  Loader2, RefreshCw, Download, Wrench, Mic, Eye, Brain, Rocket,
  Shield, Zap, Volume2,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────

interface SetupState {
  loading: boolean;
  state: any | null;
  summary: string | null;
  error: string | null;
}

interface PermissionDialog {
  visible: boolean;
  componentId: string;
  componentName: string;
  title: string;
  body: string;
  size: string;
  purpose: string;
  requirements: string;
  question: string;
}

interface InstallProgress {
  visible: boolean;
  componentId: string;
  componentName: string;
  stage: string;
  message: string;
  messageFa: string;
  percent: number;
  steps: Array<{ label: string; labelFa: string; status: 'pending' | 'active' | 'done' | 'failed' }>;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  'llm': <Brain size={12} />,
  'voice-stt': <Mic size={12} />,
  'voice-tts': <Volume2 size={12} />,
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

const DEFAULT_STEPS: InstallProgress['steps'] = [
  { label: 'Permission', labelFa: 'اجازه', status: 'pending' },
  { label: 'Download', labelFa: 'دانلود', status: 'pending' },
  { label: 'Verify', labelFa: 'بررسی', status: 'pending' },
  { label: 'Install', labelFa: 'نصب', status: 'pending' },
  { label: 'Test', labelFa: 'تست', status: 'pending' },
  { label: 'Activate', labelFa: 'فعال‌سازی', status: 'pending' },
];

// ─── Component ─────────────────────────────────────────────────────────────

export default function RuntimeSetupPanel() {
  const [setup, setSetup] = useState<SetupState>({
    loading: true, state: null, summary: null, error: null,
  });
  const [permDialog, setPermDialog] = useState<PermissionDialog>({
    visible: false, componentId: '', componentName: '',
    title: '', body: '', size: '', purpose: '', requirements: '', question: '',
  });
  const [progress, setProgress] = useState<InstallProgress>({
    visible: false, componentId: '', componentName: '',
    stage: '', message: '', messageFa: '', percent: 0, steps: DEFAULT_STEPS,
  });
  const [installing, setInstalling] = useState(false);
  const installResolveRef = useRef<((response: string) => void) | null>(null);

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

  // ─── Install handlers ────────────────────────────────────────────────

  const handleInstallClick = useCallback(async (componentId: string) => {
    if (installing) return;
    // Get Persian explanation
    const explRes = await window.nexAPI.componentExplanation(componentId);
    if (!explRes.success || !explRes.explanation) return;
    const expl = explRes.explanation;
    // Find component name from setup state
    const comp = setup.state?.components?.find((c: any) => c.catalogId === componentId);
    const name = comp?.name || componentId;

    // Show permission dialog
    setPermDialog({
      visible: true, componentId, componentName: name,
      title: expl.title, body: expl.body, size: expl.size,
      purpose: expl.purpose, requirements: expl.requirements, question: expl.question,
    });
  }, [installing, setup.state]);

  const handlePermissionResponse = useCallback(async (response: string) => {
    const componentId = permDialog.componentId;
    const componentName = permDialog.componentName;
    setPermDialog((d) => ({ ...d, visible: false }));

    if (response !== 'confirm') {
      // User cancelled
      return;
    }

    // Start installation with progress
    setInstalling(true);
    setProgress({
      visible: true, componentId, componentName,
      stage: 'requesting-permission',
      message: 'Requesting permission...', messageFa: 'درخواست اجازه...',
      percent: 0, steps: DEFAULT_STEPS.map((s, i) =>
        i === 0 ? { ...s, status: 'active' } : s
      ),
    });

    try {
      // Send permission response to backend
      await window.nexAPI.componentRespondPermission('تایید می‌کنم');

      // Update progress: permission done, download starting
      setProgress((p) => ({
        ...p, stage: 'downloading', message: 'Downloading...', messageFa: 'در حال دانلود...',
        percent: 0, steps: p.steps.map((s, i) =>
          i === 0 ? { ...s, status: 'done' } : i === 1 ? { ...s, status: 'active' } : s
        ),
      }));

      // Call component-install IPC
      const result = await window.nexAPI.componentInstall(componentId);

      // Update steps based on result
      if (result.success) {
        setProgress((p) => ({
          ...p, stage: 'activated', message: 'Completed!', messageFa: 'نصب با موفقیت انجام شد',
          percent: 100,
          steps: p.steps.map((s) => ({ ...s, status: 'done' as const })),
        }));
      } else {
        // Find which step failed
        const failedStep = result.stage || 'failed';
        setProgress((p) => ({
          ...p, stage: failedStep, message: result.error || 'Failed', messageFa: 'نصب ناموفق بود',
          steps: p.steps.map((s) => {
            if (s.labelFa === 'اجازه' && failedStep.includes('permission')) return { ...s, status: 'failed' as const };
            if (s.labelFa === 'دانلود' && failedStep.includes('download')) return { ...s, status: 'failed' as const };
            if (s.labelFa === 'بررسی' && failedStep.includes('verif')) return { ...s, status: 'failed' as const };
            if (s.labelFa === 'نصب' && failedStep.includes('install')) return { ...s, status: 'failed' as const };
            if (s.labelFa === 'تست' && failedStep.includes('health')) return { ...s, status: 'failed' as const };
            if (s.status === 'done') return s;
            if (s.status === 'active') return { ...s, status: 'failed' as const };
            return s;
          }),
        }));
      }

      // Auto-hide progress after 3 seconds
      setTimeout(() => {
        setProgress((p) => ({ ...p, visible: false }));
        setInstalling(false);
        scan(); // Re-scan after install
      }, 3000);
    } catch (err: any) {
      setProgress((p) => ({
        ...p, stage: 'failed', message: err.message, messageFa: 'خطا',
        steps: p.steps.map((s) => s.status === 'active' ? { ...s, status: 'failed' as const } : s),
      }));
      setTimeout(() => {
        setProgress((p) => ({ ...p, visible: false }));
        setInstalling(false);
      }, 3000);
    }
  }, [permDialog, scan]);

  const handleVoicePermission = useCallback(async () => {
    await window.nexAPI.componentRespondVoice();
  }, []);

  // ─── Quick install buttons ───────────────────────────────────────────

  const handleEnableVoice = useCallback(() => {
    // Find first missing voice component
    const missing = setup.state?.components?.find(
      (c: any) => (c.type === 'voice-stt' || c.type === 'voice-tts') && c.status !== 'installed'
    );
    if (missing) handleInstallClick(missing.catalogId);
  }, [setup.state, handleInstallClick]);

  const handleEnableVision = useCallback(() => {
    const missing = setup.state?.components?.find(
      (c: any) => c.type === 'vision' && c.status !== 'installed'
    );
    if (missing) handleInstallClick(missing.catalogId);
  }, [setup.state, handleInstallClick]);

  const handleInstallRecommended = useCallback(() => {
    // Find first recommendation
    const rec = setup.state?.recommendations?.[0];
    if (rec?.component?.id) handleInstallClick(rec.component.id);
  }, [setup.state, handleInstallClick]);

  const handleOptimize = useCallback(async () => {
    // Find the most impactful missing component
    const missing = setup.state?.components?.find(
      (c: any) => c.isEssential && c.status !== 'installed'
    );
    if (missing) {
      handleInstallClick(missing.catalogId);
    } else {
      const rec = setup.state?.recommendations?.[0];
      if (rec?.component?.id) handleInstallClick(rec.component.id);
    }
  }, [setup.state, handleInstallClick]);

  // ─── Render ──────────────────────────────────────────────────────────

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
    <div className="flex flex-col h-full overflow-y-auto nex-scrollbar relative">
      <div className="flex-1 p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Rocket size={16} style={{ color: 'var(--nex-accent)' }} />
            <h2 className="text-sm font-semibold tracking-wide" style={{ color: 'var(--nex-text)' }}>
              NEX Runtime Center
            </h2>
          </div>
          <button onClick={scan} disabled={installing} className="flex items-center gap-1 nex-click p-1.5 rounded-lg text-[9px] disabled:opacity-50" style={{ border: '1px solid var(--nex-glass-border)', color: 'var(--nex-text-muted)' }}>
            <RefreshCw size={10} /> اسکن مجدد
          </button>
        </div>

        {/* Quick Action Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <ActionBtn label="نصب مدل پیشنهادی" icon={<Brain size={12} />} onClick={handleInstallRecommended} disabled={installing || !st?.recommendations?.length} />
          <ActionBtn label="فعال کردن صدا" icon={<Mic size={12} />} onClick={handleEnableVoice} disabled={installing} />
          <ActionBtn label="فعال کردن بینایی" icon={<Eye size={12} />} onClick={handleEnableVision} disabled={installing} />
          <ActionBtn label="بهینه‌سازی برای سیستم من" icon={<Zap size={12} />} onClick={handleOptimize} disabled={installing} />
        </div>

        {/* System Info */}
        {st?.hardware && (
          <Card title="سیستم" icon={<Cpu size={12} />}>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <Stat label="CPU" value={`${st.hardware.cpuCores || 'N/A'} هسته`} />
              <Stat label="RAM" value={`${(st.hardware.ramTotalBytes / 1e9).toFixed(1)} GB`} />
              {st.hardware.gpu ? (
                <>
                  <Stat label="GPU" value={st.hardware.gpu.name} />
                  <Stat label="VRAM" value={`${(st.hardware.gpu.vramTotalBytes / 1e9).toFixed(1)} GB`} />
                </>
              ) : (
                <div className="col-span-2" style={{ color: 'var(--nex-text-muted)' }}>GPU: ندارد (فقط CPU)</div>
              )}
              <Stat label="OS" value={st.os} />
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
                    {TYPE_ICONS[comp.type]}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {comp.status !== 'installed' && (
                      <button
                        onClick={() => handleInstallClick(comp.catalogId)}
                        disabled={installing}
                        className="text-[8px] px-1.5 py-0.5 rounded nex-click disabled:opacity-50"
                        style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}
                      >
                        نصب
                      </button>
                    )}
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
              {st.recommendations.slice(0, 3).map((rec: any, i: number) => {
                const comp = rec.component;
                if (!comp) return null;
                return (
                  <div key={i} className="rounded-lg p-2.5" style={{ background: 'var(--nex-glass-bg)', border: '1px solid var(--nex-glass-border)' }}>
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-semibold" style={{ color: 'var(--nex-accent-text)' }}>{comp.name}</span>
                          <span className="text-[8px] px-1 rounded" style={{ background: 'var(--nex-glass-bg)', color: 'var(--nex-text-muted)' }}>
                            {TYPE_LABELS[comp.type] || comp.type}
                          </span>
                        </div>
                        <p className="text-[9px] mt-0.5" style={{ color: 'var(--nex-text-muted)' }}>{comp.purposeFa}</p>
                        <p className="text-[9px] mt-0.5" style={{ color: 'var(--nex-text-muted)' }}>
                          حجم: {(comp.sizeBytes / 1e9).toFixed(1)} GB
                        </p>
                        <div className="flex items-center gap-1 mt-1">
                          <span className="text-[9px]" style={{
                            color: rec.hardwareFit === 'perfect' ? 'var(--nex-success)' :
                                   rec.hardwareFit === 'good' ? 'var(--nex-accent-text)' : 'var(--nex-warning)'
                          }}>
                            {rec.hardwareFit === 'perfect' ? 'تطابق عالی' : rec.hardwareFit === 'good' ? 'تطابق خوب' : 'حداقل'}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleInstallClick(comp.id)}
                        disabled={installing}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[9px] nex-click disabled:opacity-50"
                        style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}
                      >
                        <Download size={10} /> نصب
                      </button>
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
            <Shield size={10} />
            NEX AI هرگز چیزی را بدون اجازه صریح شما دانلود یا نصب نمی‌کند.
            برای نصب، دکمه "تایید می‌کنم" را بزنید یا در چت تایید کنید.
          </p>
        </div>
      </div>

      {/* Permission Dialog Overlay */}
      {permDialog.visible && (
        <PermissionDialogUI
          dialog={permDialog}
          onConfirm={() => handlePermissionResponse('confirm')}
          onCancel={() => handlePermissionResponse('cancel')}
          onVoice={handleVoicePermission}
        />
      )}

      {/* Progress Overlay */}
      {progress.visible && (
        <ProgressUI progress={progress} />
      )}
    </div>
  );
}

// ─── Permission Dialog UI ──────────────────────────────────────────────────

function PermissionDialogUI({
  dialog, onConfirm, onCancel, onVoice,
}: {
  dialog: PermissionDialog;
  onConfirm: () => void;
  onCancel: () => void;
  onVoice: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="rounded-2xl p-5 max-w-sm w-full mx-4" style={{ background: 'var(--nex-panel-solid)', border: '1px solid var(--nex-glass-border)' }}>
        {/* Title */}
        <div className="flex items-center gap-2 mb-3">
          <Shield size={16} style={{ color: 'var(--nex-accent)' }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--nex-text)' }}>{dialog.title}</h3>
        </div>

        {/* Body */}
        <div className="space-y-2 text-[10px] mb-4">
          <div>
            <span style={{ color: 'var(--nex-text-muted)' }}>کامپوننت: </span>
            <span style={{ color: 'var(--nex-text)' }}>{dialog.componentName}</span>
          </div>
          <div>
            <span style={{ color: 'var(--nex-text-muted)' }}>حجم: </span>
            <span style={{ color: 'var(--nex-text)' }}>{dialog.size}</span>
          </div>
          <div>
            <span style={{ color: 'var(--nex-text-muted)' }}>کاربرد: </span>
            <span style={{ color: 'var(--nex-text)' }}>{dialog.purpose}</span>
          </div>
          <div>
            <span style={{ color: 'var(--nex-text-muted)' }}>نیاز: </span>
            <span style={{ color: 'var(--nex-text)' }}>{dialog.requirements}</span>
          </div>
          <div className="pt-1" style={{ color: 'var(--nex-text-muted)' }}>
            {dialog.question}
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onConfirm}
            className="flex-1 px-3 py-2 rounded-lg text-xs font-medium nex-click"
            style={{ background: 'var(--nex-accent)', color: 'var(--nex-bg)' }}
          >
            تایید می‌کنم
          </button>
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-2 rounded-lg text-xs font-medium nex-click"
            style={{ background: 'var(--nex-glass-bg)', color: 'var(--nex-text-muted)', border: '1px solid var(--nex-glass-border)' }}
          >
            لغو
          </button>
        </div>
        <button
          onClick={onVoice}
          className="w-full mt-2 px-3 py-1.5 rounded-lg text-[10px] nex-click flex items-center justify-center gap-1"
          style={{ color: 'var(--nex-text-muted)' }}
        >
          <Mic size={10} /> تایید با صدا
        </button>
      </div>
    </div>
  );
}

// ─── Progress UI ───────────────────────────────────────────────────────────

function ProgressUI({ progress }: { progress: InstallProgress }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="rounded-2xl p-5 max-w-sm w-full mx-4" style={{ background: 'var(--nex-panel-solid)', border: '1px solid var(--nex-glass-border)' }}>
        {/* Title */}
        <div className="flex items-center gap-2 mb-3">
          {progress.stage === 'activated' ? (
            <CheckCircle2 size={16} style={{ color: 'var(--nex-success)' }} />
          ) : progress.stage.includes('failed') ? (
            <XCircle size={16} style={{ color: 'var(--nex-error)' }} />
          ) : (
            <Loader2 size={16} className="animate-spin" style={{ color: 'var(--nex-accent)' }} />
          )}
          <h3 className="text-xs font-semibold" style={{ color: 'var(--nex-text)' }}>
            {progress.messageFa}
          </h3>
        </div>

        {/* Component name */}
        <p className="text-[10px] mb-3" style={{ color: 'var(--nex-text-muted)' }}>
          {progress.componentName}
        </p>

        {/* Progress bar */}
        {progress.percent > 0 && progress.percent < 100 && (
          <div className="w-full h-1.5 rounded-full mb-3" style={{ background: 'var(--nex-glass-bg)' }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${progress.percent}%`, background: 'var(--nex-accent)' }}
            />
          </div>
        )}

        {/* Steps */}
        <div className="space-y-1.5">
          {progress.steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px]">
              {step.status === 'done' ? (
                <CheckCircle2 size={10} style={{ color: 'var(--nex-success)' }} />
              ) : step.status === 'active' ? (
                <Loader2 size={10} className="animate-spin" style={{ color: 'var(--nex-accent)' }} />
              ) : step.status === 'failed' ? (
                <XCircle size={10} style={{ color: 'var(--nex-error)' }} />
              ) : (
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--nex-glass-bg)', border: '1px solid var(--nex-glass-border)' }} />
              )}
              <span style={{
                color: step.status === 'done' ? 'var(--nex-text)' :
                       step.status === 'active' ? 'var(--nex-accent-text)' :
                       step.status === 'failed' ? 'var(--nex-error)' :
                       'var(--nex-text-muted)'
              }}>
                {step.labelFa}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Helper Components ─────────────────────────────────────────────────────

function ActionBtn({ label, icon, onClick, disabled }: { label: string; icon: React.ReactNode; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-medium nex-click nex-focus disabled:opacity-50"
      style={{ background: 'var(--nex-glass-bg)', border: '1px solid var(--nex-glass-border)', color: 'var(--nex-text)' }}
    >
      <span style={{ color: 'var(--nex-accent)' }}>{icon}</span>
      {label}
    </button>
  );
}

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
