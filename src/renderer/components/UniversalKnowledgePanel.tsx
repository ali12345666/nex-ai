/**
 * NEX AI — Universal Knowledge Center Panel (Phase 60)
 *
 * Shows the multidisciplinary knowledge ecosystem: domains, installed/missing
 * packs, expert knowledge routing, multilingual RAG search, and the knowledge
 * graph. All actions go through IPC. No automatic downloads — pack
 * installation goes through the Expertise panel + PermissionGate (Phase 55).
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Globe, RefreshCw, Search, Network, Brain, BookOpen, Layers, AlertCircle,
  CheckCircle2, XCircle, Loader2, ShieldCheck, Zap, GitBranch, Mic,
} from 'lucide-react';

type Tab = 'domains' | 'search' | 'graph' | 'status';

const DOMAIN_ICONS: Record<string, React.ReactNode> = {
  'software-engineering': <Layers size={12} />,
  'electronics-engineering': <Zap size={12} />,
  'ai-engineering': <Brain size={12} />,
  'system-architecture': <Network size={12} />,
  'science': <Globe size={12} />,
  'architecture': <Network size={12} />,
  'mechanical': <Zap size={12} />,
  'business': <Brain size={12} />,
  'economics': <Globe size={12} />,
};

export default function UniversalKnowledgePanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('domains');
  const [domains, setDomains] = useState<any[]>([]);
  const [packs, setPacks] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<any>(null);
  const [routeQuery, setRouteQuery] = useState('');
  const [routeResult, setRouteResult] = useState<any>(null);
  const [graphResult, setGraphResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [domRes, packRes, statusRes] = await Promise.all([
        window.nexAPI.universalKnowledgeDomains(),
        window.nexAPI.universalKnowledgePacks(),
        window.nexAPI.universalKnowledgeStatus(),
      ]);
      if (domRes.success) setDomains(domRes.domains || []);
      if (packRes.success) setPacks(packRes.packs || []);
      if (statusRes.success) setStatus(statusRes.status || null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load universal knowledge');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const showToast = (kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const runSearch = async () => {
    if (!searchQuery.trim()) return;
    setBusy(true);
    try {
      const res = await window.nexAPI.universalKnowledgeSearch(searchQuery);
      if (res.success) setSearchResult(res.result);
      else setError(res.error || 'جستجو ناموفق بود');
    } catch (err: any) {
      setError(err?.message || 'Search failed');
    } finally {
      setBusy(false);
    }
  };

  const runRoute = async () => {
    if (!routeQuery.trim()) return;
    setBusy(true);
    try {
      const res = await window.nexAPI.universalKnowledgeRoute({ request: routeQuery });
      if (res.success) setRouteResult(res.route);
      else setError(res.error || 'مسیریابی ناموفق بود');
    } catch (err: any) {
      setError(err?.message || 'Route failed');
    } finally {
      setBusy(false);
    }
  };

  const queryGraph = async (domain?: string) => {
    setBusy(true);
    try {
      const res = await window.nexAPI.universalKnowledgeGraph(domain ? { domain } : {});
      if (res.success) setGraphResult(res.result);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { if (tab === 'graph' && !graphResult) queryGraph(); }, [tab]);

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        <div className="flex items-center gap-2">
          <Globe size={16} style={{ color: 'var(--nex-accent)' }} />
          <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
            UNIVERSAL KNOWLEDGE
          </span>
          {status && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>
              {status.totalDomains} حوزه
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
          ['domains', 'حوزه‌ها'],
          ['search', 'جستجو'],
          ['graph', 'گراف'],
          ['status', 'وضعیت'],
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

        {/* Domains tab */}
        {tab === 'domains' && (
          <>
            {/* Expert knowledge routing test */}
            <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
              <div className="flex items-center gap-1.5 mb-2">
                <GitBranch size={11} style={{ color: 'var(--nex-accent)' }} />
                <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>مسیریابی دانش تخصصی</span>
              </div>
              <div className="flex gap-1.5">
                <input value={routeQuery} onChange={(e) => setRouteQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && routeQuery.trim()) runRoute(); }}
                  placeholder="مثلاً: طراحی مدار تغذیه ۱۲ ولت" className="flex-1 px-2 py-1 rounded-lg text-[11px] nex-focus" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }} />
                <button onClick={runRoute} disabled={busy || !routeQuery.trim()} className="nex-click nex-focus px-2 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}>
                  {busy ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />} مسیریابی
                </button>
              </div>
            </div>

            {/* Route result */}
            {routeResult && (
              <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-accent-glow)' }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <Brain size={11} style={{ color: 'var(--nex-accent)' }} />
                  <span className="text-[10px] font-medium" style={{ color: 'var(--nex-accent-text)' }}>نتیجه مسیریابی</span>
                </div>
                <p className="text-[10px] mb-2" style={{ color: 'var(--nex-text-muted)' }}>{routeResult.summaryFa}</p>
                <div className="flex flex-wrap gap-1 mb-2">
                  <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>
                    متخصص: {routeResult.expertRoute?.expert?.nameFa}
                  </span>
                  {routeResult.knowledgeDomain && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(139,92,246,0.15)', color: '#c4b5fd' }}>
                      دانش: {routeResult.knowledgeDomain}
                    </span>
                  )}
                  {routeResult.recommendedModelType && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(6,182,212,0.15)', color: '#67e8f9' }}>
                      مدل: {routeResult.recommendedModelType}
                    </span>
                  )}
                </div>
                {routeResult.recommendedPack && (
                  <div className="text-[10px] p-1.5 rounded" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)' }}>
                    <div className="flex items-center gap-1">
                      <BookOpen size={9} />
                      <span style={{ color: 'var(--nex-text)' }}>{routeResult.recommendedPack.nameFa}</span>
                      {routeResult.packInstalled ? (
                        <CheckCircle2 size={9} style={{ color: 'var(--nex-success)' }} className="mr-auto" />
                      ) : (
                        <XCircle size={9} style={{ color: '#fca5a5' }} className="mr-auto" />
                      )}
                    </div>
                    {routeResult.missingKnowledge && (
                      <p className="mt-1 text-[9px]" style={{ color: '#fcd34d' }}>{routeResult.missingDescriptionFa}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Domain list */}
            <div className="space-y-1.5">
              <div className="text-[9px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>حوزه‌های دانش ({domains.length})</div>
              {domains.map((d: any) => (
                <div key={d.domain} className="p-2 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span style={{ color: 'var(--nex-accent)' }}>{DOMAIN_ICONS[d.domain] || <Globe size={12} />}</span>
                    <span className="text-[11px] font-medium flex-1" style={{ color: 'var(--nex-text)' }}>{d.nameFa}</span>
                    {d.persianSupport && <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: '#86efac' }}>فارسی</span>}
                  </div>
                  <p className="text-[9px] mb-1" style={{ color: 'var(--nex-text-muted)' }}>{d.descriptionFa}</p>
                  <div className="flex flex-wrap gap-1 ml-4">
                    {d.subdomains?.map((s: any) => (
                      <span key={s.id} className="text-[8px] px-1 py-0.5 rounded" style={{ background: 'var(--nex-bg)', color: 'var(--nex-text-muted)' }}>
                        {s.nameFa}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Phase 60 packs */}
            <div className="space-y-1.5">
              <div className="text-[9px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>بسته‌های دانش فاز ۶۰ ({packs.length})</div>
              {packs.map((p: any) => (
                <div key={p.id} className="p-2 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <BookOpen size={10} style={{ color: 'var(--nex-text-muted)' }} />
                    <span className="text-[10px] font-medium flex-1" style={{ color: 'var(--nex-text)' }}>{p.nameFa}</span>
                    {p.isPhase60New && <span className="text-[7px] px-1 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.15)', color: '#fcd34d' }}>جدید</span>}
                  </div>
                  <div className="flex items-center gap-2 text-[8px] ml-4" style={{ color: 'var(--nex-text-muted)' }}>
                    <span>{DOMAIN_LABELS_FA[p.domain] || p.domain}</span>
                    <span>•</span>
                    <span>{p.documentCount} سند</span>
                    {p.persianSupport && <><span>•</span><span>فارسی</span></>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Search tab */}
        {tab === 'search' && (
          <>
            <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
              <div className="flex items-center gap-1.5 mb-2">
                <Search size={11} style={{ color: 'var(--nex-accent)' }} />
                <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>جستجوی چندزبانه (RAG)</span>
              </div>
              <div className="flex gap-1.5">
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && searchQuery.trim()) runSearch(); }}
                  placeholder="جستجو در پایگاه دانش..." className="flex-1 px-2 py-1 rounded-lg text-[11px] nex-focus" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }} />
                <button onClick={runSearch} disabled={busy || !searchQuery.trim()} className="nex-click nex-focus px-2 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}>
                  {busy ? <Loader2 size={10} className="animate-spin" /> : <Search size={10} />} جستجو
                </button>
              </div>
            </div>

            {searchResult && (
              <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <Globe size={11} style={{ color: 'var(--nex-accent)' }} />
                  <span className="text-[10px] font-medium" style={{ color: 'var(--nex-accent-text)' }}>نتیجه جستجو</span>
                  <span className="ml-auto text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>
                    زبان: {searchResult.detectedLanguage}
                    {searchResult.persianNormalized && ' (نرمال‌شده)'}
                  </span>
                </div>
                {searchResult.results?.results?.length > 0 ? (
                  <div className="space-y-1">
                    {searchResult.results.results.slice(0, 5).map((r: any, i: number) => (
                      <div key={i} className="p-1.5 rounded text-[10px]" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)' }}>
                        <div className="flex items-center gap-1 mb-0.5">
                          <span className="font-medium" style={{ color: 'var(--nex-text)' }}>{r.documentTitle}</span>
                          <span className="ml-auto text-[8px]" style={{ color: 'var(--nex-accent)' }}>امتیاز: {r.score.toFixed(2)}</span>
                        </div>
                        <p className="text-[9px] line-clamp-2" style={{ color: 'var(--nex-text-muted)' }}>{r.content.slice(0, 150)}...</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>نتیجه‌ای یافت نشد. ممکن است هیچ بسته دانشی نصب نباشد.</p>
                )}
              </div>
            )}
          </>
        )}

        {/* Graph tab */}
        {tab === 'graph' && graphResult && (
          <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Network size={11} style={{ color: 'var(--nex-accent)' }} />
              <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>گراف دانش</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px] mb-2">
              <div><span style={{ color: 'var(--nex-text-muted)' }}>گره‌ها:</span> <span style={{ color: 'var(--nex-text)' }}>{graphResult.nodes?.length || 0}</span></div>
              <div><span style={{ color: 'var(--nex-text-muted)' }}>مفاهیم مرتبط:</span> <span style={{ color: 'var(--nex-text)' }}>{graphResult.relatedConcepts?.length || 0}</span></div>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto nex-scroll">
              {graphResult.nodes?.slice(0, 20).map((n: any) => (
                <div key={n.id} className="flex items-center gap-1.5 text-[10px] p-1 rounded" style={{ background: 'var(--nex-bg)' }}>
                  <span style={{ color: n.type === 'domain' ? 'var(--nex-accent)' : n.type === 'subdomain' ? '#8b5cf6' : 'var(--nex-text-muted)' }}>
                    {n.type === 'domain' ? '●' : n.type === 'subdomain' ? '▸' : '◦'}
                  </span>
                  <span style={{ color: 'var(--nex-text)' }}>{n.labelFa || n.label}</span>
                  <span className="ml-auto text-[8px]" style={{ color: 'var(--nex-text-muted)' }}>{n.type}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status tab */}
        {tab === 'status' && status && (
          <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <Stat label="حوزه‌ها" value={status.totalDomains} />
              <Stat label="زیرحوزه‌ها" value={status.totalSubdomains} />
              <Stat label="مفاهیم" value={status.totalConcepts} />
              <Stat label="بسته‌ها" value={status.totalPacks} />
              <Stat label="بسته‌های جدید" value={status.phase60NewPacks} />
              <Stat label="حوزه‌های فارسی" value={status.persianSupportDomains} />
              <Stat label="گره‌های گراف" value={status.knowledgeGraphSize?.nodes} />
              <Stat label="یال‌های گراف" value={status.knowledgeGraphSize?.edges} />
              <Stat label="نصب‌شده" value={status.installedPacks} />
              <Stat label="نصب‌نشده" value={status.missingPacks} />
            </div>
            <div className="mt-2 space-y-1">
              <div className="text-[9px] font-medium tracking-wider mb-1" style={{ color: 'var(--nex-text-muted)' }}>وضعیت حوزه‌ها</div>
              {status.domains?.map((d: any) => (
                <div key={d.domain} className="flex items-center gap-2 text-[9px] p-1 rounded" style={{ background: 'var(--nex-bg)' }}>
                  <span className="flex-1" style={{ color: 'var(--nex-text)' }}>{d.nameFa}</span>
                  <span style={{ color: 'var(--nex-success)' }}>✓{d.installedCount}</span>
                  <span style={{ color: '#fca5a5' }}>✗{d.missingCount}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Security note */}
        <div className="p-2 rounded-lg text-[9px] flex items-start gap-1.5" style={{ background: 'rgba(34,197,94,0.06)', color: 'var(--nex-text-muted)' }}>
          <ShieldCheck size={10} className="mt-0.5 shrink-0" style={{ color: 'var(--nex-success)' }} />
          <span>تمام بازیابی دانش محلی و آفلاین است. نصب بسته نیازمند اجازه است. هیچ دانلود خودکار نیست.</span>
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

const DOMAIN_LABELS_FA: Record<string, string> = {
  'software-engineering': 'نرم‌افزار',
  'electronics-engineering': 'الکترونیک',
  'ai-engineering': 'هوش مصنوعی',
  'system-architecture': 'معماری سیستم',
  'science': 'علوم',
  'architecture': 'معماری',
  'mechanical': 'مکانیک',
  'business': 'کسب‌وکار',
  'economics': 'اقتصاد',
};

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="text-center">
      <div className="text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>{label}</div>
      <div className="text-sm font-bold" style={{ color: 'var(--nex-text)' }}>{value ?? '—'}</div>
    </div>
  );
}
