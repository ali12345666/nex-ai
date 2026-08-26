/**
 * NEX AI — Advanced Model Ecosystem Panel (Phase 59)
 *
 * Shows the complete local AI model ecosystem: catalog browser, installed
 * models, recommendations, comparison, hardware compatibility, and
 * multi-model collaboration. All actions go through IPC. The panel never
 * downloads/installs models directly — installation goes through the
 * Runtime Setup panel + PermissionGate.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Boxes, RefreshCw, Search, Star, Cpu, HardDrive, Zap, Eye, Mic, Code,
  Brain, AlertCircle, CheckCircle2, XCircle, Loader2, ShieldCheck, Layers,
  GitCompare, Users,
} from 'lucide-react';

type Tab = 'catalog' | 'installed' | 'advisor' | 'compare';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  llm: <Brain size={12} />,
  vision: <Eye size={12} />,
  'voice-stt': <Mic size={12} />,
  'voice-tt': <Mic size={12} />,
  embedding: <Layers size={12} />,
};

const TYPE_LABELS_FA: Record<string, string> = {
  llm: 'زبان',
  vision: 'بینایی',
  'voice-stt': 'گفتار به متن',
  'voice-tts': 'متن به گفتار',
  embedding: 'جاسازی',
};

const TIER_COLORS: Record<string, string> = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#ef4444',
};

function formatGB(gb: number): string {
  if (gb < 1) return `${(gb * 1024).toFixed(0)} MB`;
  return `${gb.toFixed(1)} GB`;
}

export default function ModelEcosystemPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('catalog');
  const [catalog, setCatalog] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [installed, setInstalled] = useState<any[]>([]);
  const [recommendation, setRecommendation] = useState<any>(null);
  const [collaboration, setCollaboration] = useState<any>(null);
  const [comparison, setComparison] = useState<any>(null);
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [taskInput, setTaskInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catRes, statusRes] = await Promise.all([
        window.nexAPI.ecosystemCatalog(),
        window.nexAPI.ecosystemStatus(),
      ]);
      if (catRes.success) setCatalog(catRes.catalog || []);
      if (statusRes.success) setStatus(statusRes.status || null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load ecosystem');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const showToast = (kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const loadInstalled = async () => {
    const res = await window.nexAPI.ecosystemInstalledWithCatalog();
    if (res.success) setInstalled(res.models || []);
  };

  useEffect(() => { if (tab === 'installed') loadInstalled(); }, [tab]);

  const runAdvisor = async () => {
    if (!taskInput.trim()) return;
    setBusy(true);
    try {
      const [recRes, collabRes] = await Promise.all([
        window.nexAPI.ecosystemRecommend({ request: taskInput }),
        window.nexAPI.ecosystemCollaboration({ request: taskInput }),
      ]);
      if (recRes.success) setRecommendation(recRes.recommendation);
      if (collabRes.success) setCollaboration(collabRes.collaboration);
    } catch (err: any) {
      setError(err?.message || 'Advisor failed');
    } finally {
      setBusy(false);
    }
  };

  const runCompare = async () => {
    if (!compareA || !compareB || compareA === compareB) return;
    setBusy(true);
    try {
      const res = await window.nexAPI.ecosystemCompare(compareA, compareB);
      if (res.success) setComparison(res.comparison);
      else setError(res.error || 'مقایسه ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  // Filtered catalog
  const filteredCatalog = catalog.filter((m) => {
    if (filterType !== 'all' && m.type !== filterType) return false;
    if (search) {
      const s = search.toLowerCase();
      return m.name.toLowerCase().includes(s) || m.displayNameFa.includes(search) || m.provider.toLowerCase().includes(s);
    }
    return true;
  });

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        <div className="flex items-center gap-2">
          <Boxes size={16} style={{ color: 'var(--nex-accent)' }} />
          <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
            MODEL ECOSYSTEM
          </span>
          {status && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>
              {status.totalCatalogModels} مدل
            </span>
          )}
        </div>
        <button onClick={refresh} disabled={loading} className="p-1 rounded transition-colors hover:bg-white/[0.06] disabled:opacity-50" style={{ color: 'var(--nex-text-muted)' }} title="Refresh">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        {([
          ['catalog', 'کاتالوگ'],
          ['installed', 'نصب‌شده'],
          ['advisor', 'مشاور'],
          ['compare', 'مقایسه'],
        ] as Array<[Tab, string]>).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className="nex-click nex-focus px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all"
            style={{
              background: tab === id ? 'var(--nex-accent-dim)' : 'transparent',
              color: tab === id ? 'var(--nex-accent-text)' : 'var(--nex-text-muted)',
              border: tab === id ? '1px solid var(--nex-accent-glow)' : '1px solid transparent',
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto nex-scroll p-3 space-y-3" style={{ maxHeight: 'calc(100vh - 180px)' }}>
        {error && (
          <div className="flex items-start gap-2 p-2 rounded-lg text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Catalog tab */}
        {tab === 'catalog' && (
          <>
            {/* Search + filter */}
            <div className="flex gap-1.5">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجو..."
                className="flex-1 px-2 py-1 rounded-lg text-[11px] nex-focus" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }} />
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
                className="px-1.5 py-1 rounded-lg text-[10px] nex-focus" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }}>
                <option value="all">همه</option>
                <option value="llm">زبان</option>
                <option value="vision">بینایی</option>
                <option value="voice-stt">STT</option>
                <option value="voice-tts">TTS</option>
                <option value="embedding">جاسازی</option>
              </select>
            </div>

            {/* Catalog list */}
            <div className="space-y-1.5">
              {filteredCatalog.map((m) => {
                const tierColor = TIER_COLORS[m.recommendedTier] || '#64748b';
                return (
                  <div key={m.id} className="p-2 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span style={{ color: 'var(--nex-accent)' }}>{TYPE_ICONS[m.type] || <Boxes size={12} />}</span>
                      <span className="text-[11px] font-medium flex-1 truncate" style={{ color: 'var(--nex-text)' }}>{m.displayNameFa}</span>
                      {m.persianSupport && <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: '#86efac' }}>فارسی</span>}
                      <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: `${tierColor}22`, color: tierColor }}>{m.recommendedTier}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[8px] ml-4" style={{ color: 'var(--nex-text-muted)' }}>
                      <span>{m.provider}</span><span>•</span>
                      <span>{m.parameterCount}</span><span>•</span>
                      <span>{m.quantization}</span><span>•</span>
                      <span>{formatGB(m.sizeGB)}</span><span>•</span>
                      <span>RAM {m.requiredRAM}GB</span>
                      {m.requiredVRAM > 0 && <><span>•</span><span>VRAM {m.requiredVRAM}GB</span></>}
                    </div>
                    <div className="flex items-center gap-2 mt-1 ml-4 text-[8px]">
                      <Score label="کیفیت" value={m.qualityScore} />
                      <Score label="سرعت" value={m.speedScore} />
                      {m.codingScore > 0 && <Score label="کد" value={m.codingScore} />}
                      {m.reasoningScore > 0 && <Score label="استدلال" value={m.reasoningScore} />}
                    </div>
                    <p className="text-[9px] mt-1 ml-4" style={{ color: 'var(--nex-text-muted)' }}>{m.descriptionFa}</p>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Installed tab */}
        {tab === 'installed' && (
          installed.length === 0 ? (
            <div className="text-center py-8 text-[11px]" style={{ color: 'var(--nex-text-muted)' }}>
              هیچ مدلی نصب نشده. از پنل Setup مدل اضافه کنید.
            </div>
          ) : (
            <div className="space-y-1.5">
              {installed.map((item, i) => (
                <div key={i} className="p-2 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={10} style={{ color: 'var(--nex-success)' }} />
                    <span className="text-[11px] font-medium flex-1 truncate" style={{ color: 'var(--nex-text)' }}>{item.installed.name}</span>
                    {item.catalogEntry && (
                      <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>
                        {item.catalogEntry.displayNameFa}
                      </span>
                    )}
                  </div>
                  {item.profile && (
                    <div className="mt-1 ml-4 text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>
                      <span>نقش: {item.profile.roleFa}</span> • <span>سرعت: {item.profile.speed}</span> • <span>کیفیت: {item.profile.quality}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {/* Advisor tab */}
        {tab === 'advisor' && (
          <>
            <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
              <div className="flex items-center gap-1.5 mb-2">
                <Zap size={11} style={{ color: 'var(--nex-accent)' }} />
                <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>تست مشاور هوشمند</span>
              </div>
              <div className="flex gap-1.5">
                <input value={taskInput} onChange={(e) => setTaskInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && taskInput.trim()) runAdvisor(); }}
                  placeholder="مثلاً: برنامه نویسی پایتون" className="flex-1 px-2 py-1 rounded-lg text-[11px] nex-focus" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }} />
                <button onClick={runAdvisor} disabled={busy || !taskInput.trim()} className="nex-click nex-focus px-2 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}>
                  {busy ? <Loader2 size={10} className="animate-spin" /> : <Star size={10} />} پیشنهاد
                </button>
              </div>
            </div>

            {recommendation && (
              <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-accent-glow)' }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <Star size={11} style={{ color: 'var(--nex-accent)' }} />
                  <span className="text-[10px] font-medium" style={{ color: 'var(--nex-accent-text)' }}>پیشنهاد مشاور</span>
                </div>
                <p className="text-[11px] font-medium mb-1" style={{ color: 'var(--nex-text)' }}>{recommendation.catalogEntry?.displayNameFa}</p>
                <p className="text-[10px] mb-2" style={{ color: 'var(--nex-text-muted)' }}>{recommendation.reasonFa}</p>
                <div className="flex flex-wrap gap-1">
                  {recommendation.alreadyInstalled ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5" style={{ background: 'rgba(34,197,94,0.15)', color: '#86efac' }}>
                      <CheckCircle2 size={8} /> نصب‌شده
                    </span>
                  ) : (
                    <span className="text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5" style={{ background: 'rgba(245,158,11,0.15)', color: '#fcd34d' }}>
                      <AlertCircle size={8} /> نیازمند نصب
                    </span>
                  )}
                  {recommendation.canRun ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: '#86efac' }}>قابل‌اجرا</span>
                  ) : (
                    <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}>سخت‌افزار ناکافی</span>
                  )}
                </div>
              </div>
            )}

            {collaboration && (
              <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <Users size={11} style={{ color: 'var(--nex-accent)' }} />
                  <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>همکاری چندمدلی</span>
                </div>
                <p className="text-[10px] mb-2" style={{ color: 'var(--nex-text-muted)' }}>{collaboration.summaryFa}</p>
                <div className="space-y-1">
                  {collaboration.roleAssignments?.map((ra: any, i: number) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                      <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>{ra.role}</span>
                      <span className="flex-1 truncate" style={{ color: 'var(--nex-text)' }}>{ra.catalogEntry?.displayNameFa || 'ناموجود'}</span>
                      {ra.installed ? <CheckCircle2 size={10} style={{ color: 'var(--nex-success)' }} /> : <XCircle size={10} style={{ color: '#fca5a5' }} />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Compare tab */}
        {tab === 'compare' && (
          <>
            <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
              <div className="flex items-center gap-1.5 mb-2">
                <GitCompare size={11} style={{ color: 'var(--nex-accent)' }} />
                <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>مقایسه دو مدل</span>
              </div>
              <div className="space-y-1.5">
                <select value={compareA} onChange={(e) => setCompareA(e.target.value)} className="w-full px-2 py-1 rounded-lg text-[11px] nex-focus" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }}>
                  <option value="">مدل A...</option>
                  {catalog.map((m) => <option key={m.id} value={m.id}>{m.displayNameFa}</option>)}
                </select>
                <select value={compareB} onChange={(e) => setCompareB(e.target.value)} className="w-full px-2 py-1 rounded-lg text-[11px] nex-focus" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }}>
                  <option value="">مدل B...</option>
                  {catalog.map((m) => <option key={m.id} value={m.id}>{m.displayNameFa}</option>)}
                </select>
                <button onClick={runCompare} disabled={busy || !compareA || !compareB || compareA === compareB} className="nex-click nex-focus w-full px-2 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}>
                  {busy ? <Loader2 size={10} className="animate-spin" /> : <GitCompare size={10} />} مقایسه
                </button>
              </div>
            </div>

            {comparison && (
              <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-medium" style={{ color: 'var(--nex-text)' }}>
                    {comparison.modelA.name} vs {comparison.modelB.name}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>
                    برنده: {comparison.overallWinner}
                  </span>
                </div>
                <p className="text-[10px] mb-2" style={{ color: 'var(--nex-text-muted)' }}>{comparison.recommendationFa}</p>
                <div className="space-y-1">
                  {Object.entries(comparison.differences).map(([metric, d]: [string, any]) => (
                    <div key={metric} className="flex items-center gap-2 text-[10px]">
                      <span className="flex-1" style={{ color: 'var(--nex-text-muted)' }}>{metric}</span>
                      <span style={{ color: d.winner === 'A' ? 'var(--nex-success)' : 'var(--nex-text-muted)' }}>{d.a}</span>
                      <span style={{ color: 'var(--nex-text-muted)' }}>vs</span>
                      <span style={{ color: d.winner === 'B' ? 'var(--nex-success)' : 'var(--nex-text-muted)' }}>{d.b}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Security note */}
        <div className="p-2 rounded-lg text-[9px] flex items-start gap-1.5" style={{ background: 'rgba(34,197,94,0.06)', color: 'var(--nex-text-muted)' }}>
          <ShieldCheck size={10} className="mt-0.5 shrink-0" style={{ color: 'var(--nex-success)' }} />
          <span>هیچ دانلود خودکار نیست. نصب مدل نیازمند اجازه از طریق PermissionGate است. تمام تحلیل محلی است.</span>
        </div>
      </div>

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

function Score({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? '#22c55e' : value >= 60 ? '#f59e0b' : '#64748b';
  return (
    <span className="flex items-center gap-0.5" style={{ color: 'var(--nex-text-muted)' }}>
      {label}: <span style={{ color }}>{value}</span>
    </span>
  );
}
