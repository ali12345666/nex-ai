/**
 * NEX AI — Model Advisor Panel (Phase 45 UI)
 *
 * Shows:
 *   1. Current model (name, size, performance)
 *   2. Hardware (CPU, RAM, GPU, VRAM)
 *   3. Recommendations (upgrade suggestions with improvement %)
 *   4. Model comparison (speed, quality, coding, reasoning, memory)
 *   5. Smart router status (current task category → selected model)
 *
 * CRITICAL: This panel NEVER downloads/installs/activates models.
 * All actions go through Phase 43 PermissionGate.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Cpu, HardDrive, MemoryStick, Gauge, TrendingUp,
  Sparkles, ArrowRight, CheckCircle2, XCircle, Loader2,
  GitCompare, Zap, Brain, Eye, Mic, FileText, ChevronDown,
} from 'lucide-react';

interface AdvisorState {
  loading: boolean;
  analysis: any | null;
  recommendations: any[];
  routerStatus: any | null;
  usageStats: any | null;
  comparison: any | null;
  error: string | null;
}

export default function ModelAdvisorPanel() {
  const [state, setState] = useState<AdvisorState>({
    loading: true,
    analysis: null,
    recommendations: [],
    routerStatus: null,
    usageStats: null,
    comparison: null,
    error: null,
  });
  const [comparing, setComparing] = useState<{ a: string; b: string } | null>(null);
  const [expandedRec, setExpandedRec] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [advisorRes, routerRes, usageRes] = await Promise.all([
        window.nexAPI.modelAdvisorStatus(),
        window.nexAPI.modelRouterStatus(),
        window.nexAPI.usageStats(),
      ]);
      setState({
        loading: false,
        analysis: advisorRes.success ? advisorRes.analysis : null,
        recommendations: advisorRes.success ? advisorRes.analysis?.recommendations || [] : [],
        routerStatus: routerRes.success ? routerRes.status : null,
        usageStats: usageRes.success ? usageRes.stats : null,
        comparison: null,
        error: null,
      });
    } catch (err: any) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCompare = useCallback(async (modelAId: string, modelBId: string) => {
    setComparing({ a: modelAId, b: modelBId });
    try {
      const res = await window.nexAPI.modelCompare(modelAId, modelBId);
      if (res.success) {
        setState((s) => ({ ...s, comparison: res.comparison }));
      }
    } catch { /* */ }
    setComparing(null);
  }, []);

  const handleReject = useCallback(async (recId: string) => {
    try {
      await window.nexAPI.advisorRejectRecommendation(recId);
      setState((s) => ({ ...s, recommendations: s.recommendations.filter((r) => r.catalogEntry?.id !== recId) }));
    } catch { /* */ }
  }, []);

  if (state.loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--nex-accent)' }} />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
        <XCircle size={32} style={{ color: 'var(--nex-error)' }} />
        <p className="text-xs" style={{ color: 'var(--nex-text-muted)' }}>Failed to load advisor: {state.error}</p>
        <button onClick={loadData} className="nex-click nex-focus px-3 py-1.5 rounded-lg text-xs font-medium nex-glass-accent" style={{ color: 'var(--nex-accent-text)' }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto nex-scrollbar">
      <div className="flex-1 p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={16} style={{ color: 'var(--nex-accent)' }} />
          <h2 className="text-sm font-semibold tracking-wide" style={{ color: 'var(--nex-text)' }}>
            AI Model Advisor
          </h2>
        </div>

        {/* Hardware Info */}
        {state.analysis?.profile && (
          <Card title="Hardware" icon={<Cpu size={12} />}>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <Stat label="CPU Cores" value={String(state.analysis.profile.cpuCores || 'N/A')} />
              <Stat label="Threads" value={String(state.analysis.profile.cpuThreads || 'N/A')} />
              <Stat label="RAM Total" value={formatGB(state.analysis.profile.ramTotalBytes)} />
              <Stat label="RAM Free" value={formatGB(state.analysis.profile.ramFreeBytes)} />
              {state.analysis.profile.gpu ? (
                <>
                  <Stat label="GPU" value={state.analysis.profile.gpu.name} />
                  <Stat label="VRAM" value={formatGB(state.analysis.profile.gpu.vramTotalBytes)} />
                  <Stat label="GPU Vendor" value={state.analysis.profile.gpu.vendor} />
                  <Stat label="Backend" value={state.analysis.profile.detectedBackend} />
                </>
              ) : (
                <div className="col-span-2 text-[var(--nex-text-muted)]">No GPU detected (CPU-only)</div>
              )}
            </div>
          </Card>
        )}

        {/* Installed Models */}
        {state.analysis?.installedModels && state.analysis.installedModels.length > 0 && (
          <Card title="Installed Models" icon={<HardDrive size={12} />}>
            <div className="space-y-1.5">
              {state.analysis.installedModels.slice(0, 5).map((m: any) => (
                <div key={m.id} className="flex items-center justify-between text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={10} style={{ color: 'var(--nex-success)' }} />
                    <span style={{ color: 'var(--nex-text)' }}>{m.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[var(--nex-text-muted)]">
                    <span>{m.category}</span>
                    <span>{formatBytes(m.sizeBytes)}</span>
                    {m.parameterCount && <span>({m.parameterCount})</span>}
                  </div>
                </div>
              ))}
              {state.analysis.totalDiskUsage > 0 && (
                <div className="text-[9px] pt-1 border-t border-[var(--nex-glass-border)] mt-1.5" style={{ color: 'var(--nex-text-muted)' }}>
                  Total disk usage: {formatBytes(state.analysis.totalDiskUsage)}
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Recommendations */}
        {state.recommendations.length > 0 ? (
          <Card title="Recommendations" icon={<TrendingUp size={12} />}>
            <div className="space-y-2">
              {state.recommendations.map((rec: any) => {
                const entry = rec.catalogEntry;
                if (!entry) return null;
                const isExpanded = expandedRec === entry.id;
                return (
                  <div
                    key={entry.id}
                    className="rounded-lg p-2.5"
                    style={{
                      background: 'var(--nex-glass-bg)',
                      border: '1px solid var(--nex-glass-border)',
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-semibold" style={{ color: 'var(--nex-accent-text)' }}>
                            {entry.name}
                          </span>
                          {rec.estimatedImprovement > 0 && (
                            <span className="text-[9px] px-1 rounded" style={{ background: 'var(--nex-success-dim, rgba(0,200,83,0.15))', color: 'var(--nex-success)' }}>
                              +{rec.estimatedImprovement}%
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] mt-0.5" style={{ color: 'var(--nex-text-muted)' }}>
                          {entry.sizeGB} GB · {entry.category} · {entry.quantization}
                        </p>
                      </div>
                      <button
                        onClick={() => setExpandedRec(isExpanded ? null : entry.id)}
                        className="p-0.5 rounded hover:bg-white/5"
                        style={{ color: 'var(--nex-text-muted)' }}
                      >
                        <ChevronDown size={12} className={isExpanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="mt-2 space-y-1.5 text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>
                        <p>{rec.reason}</p>
                        <div className="grid grid-cols-3 gap-1">
                          <MiniStat label="Quality" value={entry.qualityScore} />
                          <MiniStat label="Speed" value={entry.speedScore} />
                          <MiniStat label="Coding" value={entry.codingScore} />
                          <MiniStat label="Reasoning" value={entry.reasoningScore} />
                          <MiniStat label="Vision" value={entry.visionScore} />
                          <MiniStat label="Voice" value={entry.voiceScore} />
                        </div>
                        <div className="flex gap-1 pt-1">
                          <button
                            onClick={() => handleCompare('current', entry.id)}
                            disabled={!!comparing}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] nex-click"
                            style={{ background: 'var(--nex-glass-bg)', border: '1px solid var(--nex-glass-border)', color: 'var(--nex-text)' }}
                          >
                            <GitCompare size={10} /> Compare
                          </button>
                          <button
                            onClick={() => handleReject(entry.id)}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] nex-click"
                            style={{ color: 'var(--nex-text-muted)' }}
                          >
                            <XCircle size={10} /> Dismiss
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ) : (
          <Card title="Recommendations" icon={<TrendingUp size={12} />}>
            <p className="text-[10px] py-2 text-center" style={{ color: 'var(--nex-text-muted)' }}>
              No recommendations available. Your current models are well-matched to your hardware.
            </p>
          </Card>
        )}

        {/* Model Comparison */}
        {state.comparison && (
          <Card title="Model Comparison" icon={<GitCompare size={12} />}>
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-1 text-[9px] font-semibold" style={{ color: 'var(--nex-text-muted)' }}>
                <span>Metric</span>
                <span className="text-center">{state.comparison.modelA.name}</span>
                <span className="text-center">{state.comparison.modelB.name}</span>
              </div>
              {Object.entries(state.comparison.differences).map(([key, val]: [string, any]) => (
                <div key={key} className="grid grid-cols-3 gap-1 text-[10px]">
                  <span style={{ color: 'var(--nex-text-muted)' }}>{key}</span>
                  <div className="flex items-center justify-center gap-1">
                    <span style={{ color: val.delta > 0 ? 'var(--nex-success)' : 'var(--nex-text)' }}>{val.a}</span>
                    {val.delta > 0 && <span className="text-[8px]" style={{ color: 'var(--nex-success)' }}>↑</span>}
                  </div>
                  <div className="flex items-center justify-center gap-1">
                    <span style={{ color: val.delta < 0 ? 'var(--nex-success)' : 'var(--nex-text)' }}>{val.b}</span>
                    {val.delta < 0 && <span className="text-[8px]" style={{ color: 'var(--nex-success)' }}>↑</span>}
                  </div>
                </div>
              ))}
              <div className="text-[10px] pt-1 border-t border-[var(--nex-glass-border)]" style={{ color: 'var(--nex-accent-text)' }}>
                {state.comparison.recommendation}
              </div>
            </div>
          </Card>
        )}

        {/* Smart Router Status */}
        {state.routerStatus && (
          <Card title="Smart Router" icon={<Zap size={12} />}>
            <div className="space-y-1.5 text-[10px]">
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--nex-text-muted)' }}>Total models</span>
                <span style={{ color: 'var(--nex-text)' }}>{state.routerStatus.totalModels}</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--nex-text-muted)' }}>Runnable models</span>
                <span style={{ color: 'var(--nex-text)' }}>{state.routerStatus.runnableModels}</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--nex-text-muted)' }}>Primary workload</span>
                <span style={{ color: 'var(--nex-accent-text)' }}>{state.routerStatus.primaryWorkload || 'N/A'}</span>
              </div>
              {state.routerStatus.byCategory && Object.keys(state.routerStatus.byCategory).length > 0 && (
                <div className="pt-1 border-t border-[var(--nex-glass-border)]">
                  <p className="text-[9px] mb-1" style={{ color: 'var(--nex-text-muted)' }}>Models by category:</p>
                  {Object.entries(state.routerStatus.byCategory).map(([cat, count]) => (
                    <div key={cat} className="flex items-center justify-between text-[9px]">
                      <span style={{ color: 'var(--nex-text-muted)' }}>{cat}</span>
                      <span style={{ color: 'var(--nex-text)' }}>{String(count)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Usage Stats */}
        {state.usageStats && state.usageStats.totalTasks > 0 && (
          <Card title="Usage Patterns" icon={<Brain size={12} />}>
            <div className="space-y-1.5 text-[10px]">
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--nex-text-muted)' }}>Total tasks</span>
                <span style={{ color: 'var(--nex-text)' }}>{state.usageStats.totalTasks}</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--nex-text-muted)' }}>Failure rate</span>
                <span style={{ color: state.usageStats.failureRate > 20 ? 'var(--nex-error)' : 'var(--nex-text)' }}>
                  {state.usageStats.failureRate.toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--nex-text-muted)' }}>Avg latency</span>
                <span style={{ color: 'var(--nex-text)' }}>{Math.round(state.usageStats.avgLatencyMs)}ms</span>
              </div>
              {state.usageStats.byCategory && Object.keys(state.usageStats.byCategory).length > 0 && (
                <div className="pt-1 border-t border-[var(--nex-glass-border)]">
                  <p className="text-[9px] mb-1" style={{ color: 'var(--nex-text-muted)' }}>By category:</p>
                  {Object.entries(state.usageStats.byCategory).map(([cat, info]: [string, any]) => (
                    <div key={cat} className="flex items-center justify-between text-[9px]">
                      <span style={{ color: 'var(--nex-text-muted)' }}>{cat}</span>
                      <span style={{ color: 'var(--nex-text)' }}>{info.count} ({info.percent.toFixed(0)}%)</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Permission Notice */}
        <div className="rounded-lg p-2.5 text-[9px]" style={{ background: 'var(--nex-glass-bg)', border: '1px solid var(--nex-glass-border)', color: 'var(--nex-text-muted)' }}>
          <p className="flex items-center gap-1.5">
            <Brain size={10} />
            NEX AI never downloads, installs, or switches models without your explicit permission.
            Use the chat to approve any model installation.
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
        <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: 'var(--nex-text-muted)' }}>
          {title}
        </span>
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

function MiniStat({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? 'var(--nex-success)' : value >= 60 ? 'var(--nex-accent-text)' : 'var(--nex-text-muted)';
  return (
    <div className="flex flex-col items-center rounded p-1" style={{ background: 'var(--nex-glass-bg)' }}>
      <span className="text-[8px]" style={{ color: 'var(--nex-text-muted)' }}>{label}</span>
      <span className="text-[10px] font-semibold" style={{ color }}>{value}</span>
    </div>
  );
}

function formatGB(bytes: number): string {
  if (!bytes || bytes === 0) return '0 GB';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb < 1) return `${(gb * 1024).toFixed(0)} MB`;
  return `${gb.toFixed(1)} GB`;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
