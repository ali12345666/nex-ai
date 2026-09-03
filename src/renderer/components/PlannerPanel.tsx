/**
 * NEX AI — Executive Planner Panel (Phase 57)
 *
 * Shows active multi-agent plans: task decomposition, swarm composition,
 * sub-task execution, self-evaluation, and permission-gated execution.
 *
 * The panel never executes anything directly — it sends IPC requests and
 * renders the resulting plan state. Every permission-requiring step is
 * gated by the PermissionGate (Phase 43) via the NexAgentExecutor (Phase 54).
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Network, RefreshCw, Play, Square, AlertCircle, CheckCircle2, XCircle,
  Loader2, Brain, Users, ShieldCheck, Sparkles, GitBranch, Target, Award,
  Cpu, Layers,
} from 'lucide-react';

// ─── Types (mirrors main-process interfaces, re-declared locally) ─────────

type SubTaskStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'denied' | 're-planning';
type PlanStatus = 'planning' | 'ready' | 'executing' | 'completed' | 'failed' | 'aborted';
type PersonalityType = 'professional' | 'technical' | 'friendly' | 'patient';

interface PlanSelfEvaluation {
  overallScore: number;
  completedSubTasks: number;
  failedSubTasks: number;
  deniedSubTasks: number;
  rePlannedSubTasks: number;
  verdict: 'excellent' | 'acceptable' | 'needs-review' | 'failed';
  verdictFa: string;
  notes: string[];
  notesFa: string[];
}

interface PlannerSubTask {
  id: string;
  index: number;
  description: string;
  descriptionFa: string;
  expertDomain: string;
  expertProfile: { name: string; nameFa: string };
  skills: Array<{ id: string; nameFa: string; requiredPermission: string }>;
  requiredPermission: string;
  knowledge: { results: unknown[]; installedPackCount: number; offline: boolean } | null;
  brainDecision: { modelName: string | null; taskFa: string } | null;
  status: SubTaskStatus;
  result?: string;
  evaluationScore?: number;
}

interface PlannerPlan {
  id: string;
  request: string;
  subTasks: PlannerSubTask[];
  status: PlanStatus;
  requiresPermission: boolean;
  swarmDomains: string[];
  swarmModelIds: string[];
  selfEvaluation: PlanSelfEvaluation | null;
  summary: string;
  summaryFa: string;
  log: string[];
}

interface PlannerStatus {
  active: boolean;
  currentPlan: PlannerPlan | null;
  totalPlansCreated: number;
  totalSubTasksExecuted: number;
  lastEvaluation: PlanSelfEvaluation | null;
}

const STATUS_META: Record<SubTaskStatus, { color: string; icon: React.ReactNode }> = {
  pending:      { color: '#64748b', icon: <RefreshCw size={10} /> },
  executing:    { color: '#06b6d4', icon: <Loader2 size={10} className="animate-spin" /> },
  completed:    { color: '#22c55e', icon: <CheckCircle2 size={10} /> },
  failed:       { color: '#ef4444', icon: <XCircle size={10} /> },
  denied:       { color: '#f59e0b', icon: <ShieldCheck size={10} /> },
  're-planning': { color: '#8b5cf6', icon: <GitBranch size={10} /> },
};

const PLAN_STATUS_COLOR: Record<PlanStatus, string> = {
  planning: '#64748b', ready: '#3b82f6', executing: '#06b6d4',
  completed: '#22c55e', failed: '#ef4444', aborted: '#f59e0b',
};

const DOMAIN_LABELS_FA: Record<string, string> = {
  'software-engineering': 'مهندسی نرم‌افزار',
  'electronics-engineering': 'مهندسی الکترونیک',
  'science': 'علوم',
  'business': 'کسب‌وکار',
  'creative': 'خلاقیت',
  'general': 'عمومی',
};

const PERSONALITIES: Array<{ id: PersonalityType; labelFa: string }> = [
  { id: 'professional', labelFa: 'حرفه‌ای' },
  { id: 'technical', labelFa: 'فنی' },
  { id: 'friendly', labelFa: 'دوستانه' },
  { id: 'patient', labelFa: 'صبور' },
];

// ─── Component ──────────────────────────────────────────────────────────────

export default function PlannerPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<PlannerStatus | null>(null);
  const [plan, setPlan] = useState<PlannerPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestInput, setRequestInput] = useState('');
  const [personality, setPersonality] = useState<PersonalityType>('professional');
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.nexAPI.plannerStatus();
      if (res.success) {
        setStatus(res.status || null);
        if (res.status?.currentPlan) setPlan(res.status.currentPlan);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load planner status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Subscribe to planner events
  useEffect(() => {
    const unsubs = [
      window.nexAPI.onPlannerPlanCreated(() => refresh()),
      window.nexAPI.onPlannerPlanUpdated(() => refresh()),
      window.nexAPI.onPlannerPlanCompleted(() => refresh()),
      window.nexAPI.onPlannerSubTaskStarted(() => refresh()),
      window.nexAPI.onPlannerSubTaskCompleted(() => refresh()),
      window.nexAPI.onPlannerSelfEvaluation(() => refresh()),
      window.nexAPI.onPlannerError((ev: any) => setError(ev?.message || 'Planner error')),
    ];
    return () => unsubs.forEach((u) => u());
  }, [refresh]);

  const showToast = (kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Actions ──

  const createPlan = async () => {
    if (!requestInput.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.nexAPI.plannerCreate(requestInput);
      if (res.success && res.plan) {
        setPlan(res.plan);
        showToast('ok', `برنامه ساخته شد — ${res.plan.subTasks.length} زیر-وظیفه`);
      } else {
        setError(res.error || 'ساخت برنامه ناموفق بود');
      }
    } catch (err: any) {
      setError(err?.message || 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  const executePlan = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.nexAPI.plannerExecute(plan);
      if (res.success && res.plan) {
        setPlan(res.plan);
        const ev = res.plan.selfEvaluation;
        if (ev) showToast('ok', `اجرا کامل شد — ارزیابی: ${ev.verdictFa} (${(ev.overallScore * 100).toFixed(0)}%)`);
      } else {
        setError(res.error || 'اجرا ناموفق بود');
      }
    } catch (err: any) {
      setError(err?.message || 'Execute failed');
    } finally {
      setBusy(false);
    }
  };

  const abortPlan = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const res = await window.nexAPI.plannerAbort(plan);
      if (res.success && res.plan) setPlan(res.plan);
      showToast('ok', 'برنامه لغو شد');
    } finally {
      setBusy(false);
    }
  };

  const changePersonality = async (p: PersonalityType) => {
    setPersonality(p);
    await window.nexAPI.plannerSetPersonality(p);
  };

  // ── Render ──

  const planColor = plan ? PLAN_STATUS_COLOR[plan.status] : '#64748b';
  const evalScore = plan?.selfEvaluation ? Math.round(plan.selfEvaluation.overallScore * 100) : null;

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        <div className="flex items-center gap-2">
          <Network size={16} style={{ color: 'var(--nex-accent)' }} />
          <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
            EXECUTIVE PLANNER
          </span>
          {status?.active && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(6,182,212,0.15)', color: '#67e8f9' }}>
              فعال
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

        {/* Request input */}
        <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Target size={11} style={{ color: 'var(--nex-accent)' }} />
            <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>
              درخواست جدید
            </span>
          </div>
          <textarea
            value={requestInput}
            onChange={(e) => setRequestInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && requestInput.trim()) { e.preventDefault(); createPlan(); } }}
            placeholder="مثلاً: یک مدار تغذیه ۵ ولت طراحی کن و سپس کد آردوینو را بنویس"
            rows={2}
            className="w-full px-2 py-1.5 rounded-lg text-[11px] nex-focus resize-none"
            style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }}
          />
          <div className="flex gap-1.5 mt-2">
            <button
              onClick={createPlan}
              disabled={busy || !requestInput.trim()}
              className="nex-click nex-focus flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50"
              style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}
            >
              {busy ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
              ساختن برنامه
            </button>
            {plan && (
              <>
                <button
                  onClick={executePlan}
                  disabled={busy || plan.status === 'executing'}
                  className="nex-click nex-focus flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50"
                  style={{ background: 'rgba(34,197,94,0.15)', color: '#86efac', border: '1px solid rgba(34,197,94,0.3)' }}
                >
                  <Play size={10} /> اجرا
                </button>
                <button
                  onClick={abortPlan}
                  disabled={busy || plan.status !== 'executing'}
                  className="nex-click nex-focus flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50"
                  style={{ background: 'transparent', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}
                >
                  <Square size={10} /> لغو
                </button>
              </>
            )}
          </div>
        </div>

        {/* Personality selector */}
        <div className="flex items-center gap-2 p-2 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
          <Brain size={11} style={{ color: 'var(--nex-accent)' }} className="shrink-0" />
          <span className="text-[10px] shrink-0" style={{ color: 'var(--nex-text-muted)' }}>شخصیت:</span>
          <select
            value={personality}
            onChange={(e) => changePersonality(e.target.value as PersonalityType)}
            className="flex-1 px-1.5 py-0.5 rounded text-[10px] nex-focus"
            style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }}
          >
            {PERSONALITIES.map((p) => (
              <option key={p.id} value={p.id}>{p.labelFa}</option>
            ))}
          </select>
        </div>

        {/* Current plan */}
        {plan && (
          <div className="p-2.5 rounded-lg nex-glass" style={{ border: `1px solid ${planColor}44` }}>
            {/* Plan header */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Layers size={12} style={{ color: planColor }} />
                <span className="text-[11px] font-medium" style={{ color: 'var(--nex-text)' }}>
                  برنامه {plan.id.slice(-6)}
                </span>
              </div>
              <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: `${planColor}22`, color: planColor }}>
                {plan.status}
              </span>
            </div>

            {/* Plan summary */}
            <p className="text-[10px] mb-2" style={{ color: 'var(--nex-text-muted)' }}>
              {plan.summaryFa}
            </p>

            {/* Swarm badges */}
            <div className="flex flex-wrap gap-1 mb-2">
              <div className="flex items-center gap-1">
                <Users size={9} style={{ color: 'var(--nex-text-muted)' }} />
                <span className="text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>swarm:</span>
              </div>
              {plan.swarmDomains.map((d) => (
                <span key={d} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>
                  {DOMAIN_LABELS_FA[d] || d}
                </span>
              ))}
              {plan.swarmModelIds.length > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5" style={{ background: 'rgba(139,92,246,0.15)', color: '#c4b5fd' }}>
                  <Cpu size={8} /> {plan.swarmModelIds.length} مدل
                </span>
              )}
            </div>

            {plan.requiresPermission && (
              <div className="flex items-center gap-1 mb-2 text-[9px] p-1 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: '#fcd34d' }}>
                <ShieldCheck size={9} />
                <span>این برنامه نیازمند اجازه برای اجراست</span>
              </div>
            )}

            {/* Sub-tasks */}
            <div className="space-y-1.5">
              <div className="text-[9px] font-medium tracking-wider mb-1" style={{ color: 'var(--nex-text-muted)' }}>
                زیر-وظایف ({plan.subTasks.length})
              </div>
              {plan.subTasks.map((st) => {
                const meta = STATUS_META[st.status] || STATUS_META.pending;
                return (
                  <div key={st.id} className="p-1.5 rounded text-[10px]" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)' }}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span style={{ color: meta.color }}>{meta.icon}</span>
                      <span className="font-medium" style={{ color: 'var(--nex-text)' }}>
                        {st.index + 1}. {st.description}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[8px] ml-4" style={{ color: 'var(--nex-text-muted)' }}>
                      <span>{DOMAIN_LABELS_FA[st.expertDomain] || st.expertDomain}</span>
                      {st.expertProfile?.nameFa && <span>• {st.expertProfile.nameFa}</span>}
                      {st.skills.length > 0 && <span>• {st.skills.length} مهارت</span>}
                      {st.brainDecision?.modelName && <span>• {st.brainDecision.modelName}</span>}
                      {st.knowledge && st.knowledge.results.length > 0 && (
                        <span>• {st.knowledge.results.length} سند</span>
                      )}
                    </div>
                    {st.result && (
                      <div className="mt-1 ml-4 text-[9px]" style={{ color: meta.color }}>
                        {st.result}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Self-evaluation */}
            {plan.selfEvaluation && (
              <div className="mt-2 p-2 rounded" style={{ background: 'var(--nex-bg)', border: `1px solid ${planColor}33` }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Award size={11} style={{ color: planColor }} />
                  <span className="text-[10px] font-medium" style={{ color: 'var(--nex-text)' }}>
                    خودارزیابی: {plan.selfEvaluation.verdictFa}
                  </span>
                  <span className="ml-auto text-[10px] font-bold" style={{ color: planColor }}>
                    {evalScore}%
                  </span>
                </div>
                <div className="flex gap-2 text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>
                  <span>✓ {plan.selfEvaluation.completedSubTasks}</span>
                  <span>✗ {plan.selfEvaluation.failedSubTasks}</span>
                  <span>⊘ {plan.selfEvaluation.deniedSubTasks}</span>
                </div>
                {plan.selfEvaluation.notesFa.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {plan.selfEvaluation.notesFa.map((n, i) => (
                      <div key={i} className="text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>• {n}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Execution log */}
            {plan.log.length > 0 && (
              <details className="mt-2">
                <summary className="text-[9px] cursor-pointer" style={{ color: 'var(--nex-text-muted)' }}>
                  لاگ اجرا ({plan.log.length})
                </summary>
                <div className="mt-1 max-h-24 overflow-y-auto nex-scroll space-y-0.5">
                  {plan.log.slice().reverse().map((line, i) => (
                    <div key={i} className="text-[8px] font-mono" style={{ color: 'var(--nex-text-muted)' }}>
                      {line}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {/* Stats */}
        {status && (
          <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
            <div className="grid grid-cols-3 gap-2 text-[10px]">
              <Stat label="برنامه‌ها" value={status.totalPlansCreated} />
              <Stat label="زیر-وظایف" value={status.totalSubTasksExecuted} />
              <Stat label="آخرین ارزیابی" value={status.lastEvaluation ? `${Math.round(status.lastEvaluation.overallScore * 100)}%` : '—'} />
            </div>
          </div>
        )}

        {/* Security note */}
        <div className="p-2 rounded-lg text-[9px] flex items-start gap-1.5" style={{ background: 'rgba(34,197,94,0.06)', color: 'var(--nex-text-muted)' }}>
          <ShieldCheck size={10} className="mt-0.5 shrink-0" style={{ color: 'var(--nex-success)' }} />
          <span>
            هر مرحله نیازمند اجازه از طریق PermissionGate است. عامل اجرایی هرگز عملیات خطرناک را بدون تأیید انجام نمی‌دهد.
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

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="text-center">
      <div className="text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>{label}</div>
      <div className="text-sm font-bold" style={{ color: 'var(--nex-text)' }}>{value}</div>
    </div>
  );
}
