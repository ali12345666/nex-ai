/**
 * NEX AI — Expert Knowledge Center Panel (Phase 55)
 *
 * Shows the offline expert knowledge packs: installed, missing, and
 * recommended. Lets the user install / remove / update packs — every action
 * is permission-gated (Phase 43 PermissionGate). The panel never performs
 * any operation autonomously; it only sends requests and renders the
 * resulting permission dialog.
 *
 * Layout:
 *   ┌──────────────────────────────────────┐
 *   │ Header (icon + title + status + ⟳)   │
 *   ├──────────────────────────────────────┤
 *   │ Tabs: Installed | Missing | Advisor   │
 *   ├──────────────────────────────────────┤
 *   │ Pack list (cards)                    │
 *   │  - name, domain, size, version       │
 *   │  - capabilities                      │
 *   │  - Install / Remove / Update buttons │
 *   ├──────────────────────────────────────┤
 *   │ Knowledge Advisor (Persian rec)      │
 *   ├──────────────────────────────────────┤
 *   │ Permission dialog (when pending)     │
 *   └──────────────────────────────────────┘
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  GraduationCap, RefreshCw, Download, Trash2, RotateCw, ShieldCheck,
  Loader2, AlertCircle, CheckCircle2, Package, BookOpen, Cpu, CircuitBoard,
  FlaskConical, Cloud, HardDrive, FileText, Lock, Sparkles,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────

interface KnowledgePackDoc {
  id: string;
  title: string;
  titleFa: string;
  format: string;
  ragDomain: string;
  sizeBytes: number;
}

interface KnowledgePack {
  id: string;
  domain: string;
  name: string;
  nameFa: string;
  description: string;
  descriptionFa: string;
  sizeBytes: number;
  version: string;
  sources: string[];
  sourcesFa: string[];
  documents: KnowledgePackDoc[];
  embeddingStatus: string;
  installed: boolean;
  permissions: string;
  capabilities: string[];
  capabilitiesFa: string[];
  checksum: string;
  sourceUrl?: string;
}

interface KnowledgeStatus {
  totalPacks: number;
  installedPacks: number;
  missingPacks: number;
  recommendedPacks: number;
  totalDocuments: number;
  installedDocuments: number;
  totalSizeBytes: number;
  domains: Array<{ domain: string; installed: number; missing: number; total: number }>;
  offline: boolean;
}

interface StorageInfo {
  totalBytes: number;
  packCount: number;
  contentDir: string;
  byDomain: Array<{ domain: string; packs: number; bytes: number }>;
}

interface PendingPermission {
  operation: 'install' | 'remove' | 'update' | 'download';
  packId: string;
  packName: string;
  action: { description: string; reason?: string; sizeBytes?: number };
  explanation: string;
  requiredPhrase: string;
}

type Tab = 'installed' | 'missing' | 'advisor';

const DOMAIN_ICONS: Record<string, React.ReactNode> = {
  'software-engineering': <Cpu size={14} strokeWidth={1.5} />,
  'electronics-engineering': <CircuitBoard size={14} strokeWidth={1.5} />,
  'ai-engineering': <Sparkles size={14} strokeWidth={1.5} />,
  'system-architecture': <Cloud size={14} strokeWidth={1.5} />,
  'science': <FlaskConical size={14} strokeWidth={1.5} />,
};

const DOMAIN_LABELS_FA: Record<string, string> = {
  'software-engineering': 'مهندسی نرم‌افزار',
  'electronics-engineering': 'مهندسی الکترونیک',
  'ai-engineering': 'مهندسی هوش مصنوعی',
  'system-architecture': 'معماری سیستم',
  'science': 'علوم',
};

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ExpertKnowledgePanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [packs, setPacks] = useState<KnowledgePack[]>([]);
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [tab, setTab] = useState<Tab>('installed');
  const [advisorDomain, setAdvisorDomain] = useState<string>('electronics-engineering');
  const [advisorMessage, setAdvisorMessage] = useState<string | null>(null);
  const [capabilitiesMessage, setCapabilitiesMessage] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [permissionInput, setPermissionInput] = useState('');
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listRes, statusRes, storageRes] = await Promise.all([
        window.nexAPI.expertKnowledgeList(),
        window.nexAPI.expertKnowledgeStatus(),
        window.nexAPI.knowledgePackStorage(),
      ]);
      if (listRes.success) setPacks(listRes.packs || []);
      if (statusRes.success) setStatus(statusRes.status || null);
      if (storageRes.success) setStorage(storageRes.storage || null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load knowledge packs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Subscribe to permission requests from the main process
  useEffect(() => {
    const unsub = window.nexAPI.onKnowledgePackPermissionRequest((req: any) => {
      setPendingPermission(req);
      setPermissionInput('');
    });
    return unsub;
  }, []);

  const showToast = (kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const installedPacks = packs.filter((p) => p.installed);
  const missingPacks = packs.filter((p) => !p.installed);

  // ── Actions ──

  const installPack = async (packId: string) => {
    setBusy(packId);
    setError(null);
    try {
      const res = await window.nexAPI.knowledgePackInstall(packId);
      if (res.success && res.result?.success) {
        showToast('ok', `بسته نصب شد — ${res.result.documentCount} سند ایندکس شد`);
      } else if (res.success && res.result?.approved === false) {
        showToast('err', 'اجازه داده نشد');
      } else {
        setError(res.error || res.result?.reason || 'نصب ناموفق بود');
      }
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Install failed');
    } finally {
      setBusy(null);
    }
  };

  const removePack = async (packId: string) => {
    setBusy(packId);
    setError(null);
    try {
      const res = await window.nexAPI.knowledgePackRemove(packId);
      if (res.success && res.result?.success) {
        showToast('ok', 'بسته حذف شد');
      } else if (res.success && res.result?.approved === false) {
        showToast('err', 'اجازه حذف داده نشد');
      } else {
        setError(res.error || res.result?.reason || 'حذف ناموفق بود');
      }
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Remove failed');
    } finally {
      setBusy(null);
    }
  };

  const updatePack = async (packId: string) => {
    setBusy(packId);
    setError(null);
    try {
      const res = await window.nexAPI.knowledgePackUpdate(packId);
      if (res.success && res.result?.success) {
        showToast('ok', 'بسته به‌روزرسانی شد');
      } else if (res.success && res.result?.approved === false) {
        showToast('err', 'اجازه به‌روزرسانی داده نشد');
      } else {
        setError(res.error || res.result?.reason || 'به‌روزرسانی ناموفق بود');
      }
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Update failed');
    } finally {
      setBusy(null);
    }
  };

  const verifyPack = async (packId: string) => {
    setBusy(`verify-${packId}`);
    try {
      const res = await window.nexAPI.knowledgePackVerify(packId);
      if (res.success && res.verification?.valid) {
        showToast('ok', 'چک‌سام صحیح است ✓');
      } else {
        showToast('err', 'چک‌سام نامعتبر — احتمال دستکاری');
      }
    } finally {
      setBusy(null);
    }
  };

  const loadAdvisor = async (domain: string) => {
    setAdvisorDomain(domain);
    setAdvisorMessage(null);
    const res = await window.nexAPI.expertKnowledgeRecommendationFa(domain);
    if (res.success) setAdvisorMessage(res.message || '');
    const capRes = await window.nexAPI.expertKnowledgeCapabilitiesFa(domain);
    if (capRes.success) setCapabilitiesMessage(capRes.message || '');
  };

  useEffect(() => { loadAdvisor(advisorDomain); /* eslint-disable-next-line */ }, []);

  const respondPermission = async (response: string) => {
    await window.nexAPI.knowledgePackRespondPermission(response);
    setPendingPermission(null);
    setPermissionInput('');
  };

  // ── Render ──

  const headerStat = status ? `${status.installedPacks}/${status.totalPacks} نصب‌شده` : '...';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        <div className="flex items-center gap-2">
          <GraduationCap size={16} style={{ color: 'var(--nex-accent)' }} />
          <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
            EXPERT KNOWLEDGE
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>
            {headerStat}
          </span>
          {status?.offline && (
            <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--nex-text-muted)' }} title="Fully offline">
              <Lock size={9} /> آفلاین
            </span>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="p-1 rounded transition-colors hover:bg-white/[0.06] disabled:opacity-50"
          style={{ color: 'var(--nex-text-muted)' }}
          title="Refresh"
          aria-label="Refresh knowledge packs"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        {([
          ['installed', `نصب‌شده (${installedPacks.length})`],
          ['missing', `نصب‌نشده (${missingPacks.length})`],
          ['advisor', 'پیشنهاد'],
        ] as Array<[Tab, string]>).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="nex-click nex-focus px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all"
            style={{
              background: tab === id ? 'var(--nex-accent-dim)' : 'transparent',
              color: tab === id ? 'var(--nex-accent-text)' : 'var(--nex-text-muted)',
              border: tab === id ? '1px solid var(--nex-accent-glow)' : '1px solid transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto nex-scroll p-3" style={{ maxHeight: 'calc(100vh - 180px)' }}>
        {error && (
          <div className="flex items-start gap-2 mb-3 p-2 rounded-lg text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center h-32">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--nex-accent)' }} />
          </div>
        )}

        {!loading && tab === 'installed' && (
          installedPacks.length === 0 ? (
            <EmptyState
              icon={<Package size={24} />}
              title="هنوز هیچ بسته‌ای نصب نشده"
              hint="به تب «نصب‌نشده» بروید و یک بسته دانش نصب کنید."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {installedPacks.map((pack) => (
                <PackCard
                  key={pack.id}
                  pack={pack}
                  busy={busy === pack.id}
                  verifying={busy === `verify-${pack.id}`}
                  onRemove={() => removePack(pack.id)}
                  onUpdate={() => updatePack(pack.id)}
                  onVerify={() => verifyPack(pack.id)}
                />
              ))}
            </div>
          )
        )}

        {!loading && tab === 'missing' && (
          missingPacks.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={24} />}
              title="همه بسته‌ها نصب شده‌اند"
              hint="دانش کامل است. نیازی به بسته جدید نیست."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {missingPacks.map((pack) => (
                <PackCard
                  key={pack.id}
                  pack={pack}
                  busy={busy === pack.id}
                  verifying={busy === `verify-${pack.id}`}
                  onInstall={() => installPack(pack.id)}
                  onVerify={() => verifyPack(pack.id)}
                />
              ))}
            </div>
          )
        )}

        {!loading && tab === 'advisor' && (
          <div className="flex flex-col gap-3">
            {/* Domain selector */}
            <div className="flex flex-wrap gap-1">
              {Object.entries(DOMAIN_LABELS_FA).map(([dom, label]) => (
                <button
                  key={dom}
                  onClick={() => loadAdvisor(dom)}
                  className="nex-click nex-focus px-2 py-1 rounded-lg text-[10px] flex items-center gap-1"
                  style={{
                    background: advisorDomain === dom ? 'var(--nex-accent-dim)' : 'transparent',
                    color: advisorDomain === dom ? 'var(--nex-accent-text)' : 'var(--nex-text-muted)',
                    border: advisorDomain === dom ? '1px solid var(--nex-accent-glow)' : '1px solid var(--nex-panel-border)',
                  }}
                >
                  {DOMAIN_ICONS[dom]}
                  {label}
                </button>
              ))}
            </div>

            {/* Recommendation */}
            {advisorMessage && (
              <div className="p-3 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles size={12} style={{ color: 'var(--nex-accent)' }} />
                  <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
                    پیشنهاد NEX
                  </span>
                </div>
                <pre className="whitespace-pre-wrap text-[11px] leading-relaxed" style={{ color: 'var(--nex-text)', fontFamily: 'inherit' }}>
                  {advisorMessage}
                </pre>
              </div>
            )}

            {/* Capabilities (what NEX can/cannot do) */}
            {capabilitiesMessage && (
              <div className="p-3 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <ShieldCheck size={12} style={{ color: 'var(--nex-success)' }} />
                  <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>
                    قابلیت‌های فعلی
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--nex-text)' }}>
                  {capabilitiesMessage}
                </p>
              </div>
            )}

            {/* Storage summary */}
            {storage && (
              <div className="p-3 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <HardDrive size={12} style={{ color: 'var(--nex-text-muted)' }} />
                  <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>
                    فضای ذخیره‌سازی
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div style={{ color: 'var(--nex-text-muted)' }}>کل استفاده</div>
                    <div style={{ color: 'var(--nex-text)' }}>{formatBytes(storage.totalBytes)}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--nex-text-muted)' }}>تعداد بسته</div>
                    <div style={{ color: 'var(--nex-text)' }}>{storage.packCount}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Permission dialog */}
      {pendingPermission && (
        <div className="absolute inset-0 flex items-end p-3 pointer-events-none" style={{ zIndex: 20 }}>
          <div className="nex-glass-strong w-full p-3 rounded-xl pointer-events-auto" style={{ border: '1px solid var(--nex-accent-glow)' }}>
            <div className="flex items-center gap-1.5 mb-2">
              <ShieldCheck size={13} style={{ color: 'var(--nex-accent)' }} />
              <span className="text-[11px] font-medium" style={{ color: 'var(--nex-accent-text)' }}>
                درخواست اجازه — {pendingPermission.operation}
              </span>
            </div>
            <p className="text-[11px] mb-1" style={{ color: 'var(--nex-text)' }}>
              {pendingPermission.action.description}
            </p>
            {pendingPermission.action.reason && (
              <p className="text-[10px] mb-2" style={{ color: 'var(--nex-text-muted)' }}>
                {pendingPermission.action.reason}
              </p>
            )}
            {pendingPermission.action.sizeBytes && (
              <p className="text-[10px] mb-2" style={{ color: 'var(--nex-text-muted)' }}>
                حجم: {formatBytes(pendingPermission.action.sizeBytes)}
              </p>
            )}
            <p className="text-[10px] mb-2" style={{ color: 'var(--nex-text-muted)' }}>
              عبارت مورد نیاز: <span style={{ color: 'var(--nex-accent-text)' }}>{pendingPermission.requiredPhrase}</span>
            </p>
            <div className="flex gap-1.5">
              <input
                value={permissionInput}
                onChange={(e) => setPermissionInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && permissionInput.trim()) respondPermission(permissionInput); }}
                placeholder="عبارت تایید را تایپ کنید..."
                className="flex-1 px-2 py-1 rounded-lg text-[11px] nex-focus"
                style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }}
                autoFocus
              />
              <button
                onClick={() => respondPermission(permissionInput || 'نه')}
                disabled={!permissionInput.trim()}
                className="nex-click nex-focus px-2.5 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50"
                style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}
              >
                ارسال
              </button>
              <button
                onClick={() => respondPermission('نه')}
                className="nex-click nex-focus px-2.5 py-1 rounded-lg text-[10px] font-medium"
                style={{ background: 'transparent', color: 'var(--nex-text-muted)', border: '1px solid var(--nex-panel-border)' }}
              >
                رد
              </button>
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
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── Pack Card ──────────────────────────────────────────────────────────────

interface PackCardProps {
  pack: KnowledgePack;
  busy: boolean;
  verifying: boolean;
  onInstall?: () => void;
  onRemove?: () => void;
  onUpdate?: () => void;
  onVerify: () => void;
}

function PackCard({ pack, busy, verifying, onInstall, onRemove, onUpdate, onVerify }: PackCardProps) {
  return (
    <div className="p-2.5 rounded-lg nex-glass nex-hover-lift transition-all" style={{ border: '1px solid var(--nex-panel-border)' }}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            {DOMAIN_ICONS[pack.domain] || <BookOpen size={14} />}
            <span className="text-[11px] font-medium truncate" style={{ color: 'var(--nex-text)' }}>
              {pack.nameFa}
            </span>
            {pack.installed && (
              <CheckCircle2 size={11} style={{ color: 'var(--nex-success)' }} className="shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-2 text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>
            <span>{DOMAIN_LABELS_FA[pack.domain] || pack.domain}</span>
            <span>•</span>
            <span>v{pack.version}</span>
            <span>•</span>
            <span>{formatBytes(pack.sizeBytes)}</span>
            <span>•</span>
            <span>{pack.documents.length} سند</span>
          </div>
        </div>
      </div>

      <p className="text-[10px] mb-1.5 leading-relaxed" style={{ color: 'var(--nex-text-muted)' }}>
        {pack.descriptionFa}
      </p>

      {pack.capabilitiesFa.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {pack.capabilitiesFa.map((cap) => (
            <span key={cap} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>
              {cap}
            </span>
          ))}
        </div>
      )}

      {pack.sourcesFa.length > 0 && (
        <div className="flex items-center gap-1 mb-2 text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>
          <FileText size={9} />
          <span>{pack.sourcesFa.join('، ')}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-1 flex-wrap">
        {!pack.installed && onInstall && (
          <button
            onClick={onInstall}
            disabled={busy}
            className="nex-click nex-focus flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50"
            style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}
          >
            {busy ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
            نصب
          </button>
        )}
        {pack.installed && onRemove && (
          <button
            onClick={onRemove}
            disabled={busy}
            className="nex-click nex-focus flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50"
            style={{ background: 'transparent', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}
          >
            {busy ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
            حذف
          </button>
        )}
        {pack.installed && onUpdate && (
          <button
            onClick={onUpdate}
            disabled={busy}
            className="nex-click nex-focus flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50"
            style={{ background: 'transparent', color: 'var(--nex-text-muted)', border: '1px solid var(--nex-panel-border)' }}
          >
            <RotateCw size={10} />
            به‌روزرسانی
          </button>
        )}
        <button
          onClick={onVerify}
          disabled={verifying}
          className="nex-click nex-focus flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50"
          style={{ background: 'transparent', color: 'var(--nex-text-muted)', border: '1px solid var(--nex-panel-border)' }}
          title="بررسی چک‌سام"
        >
          {verifying ? <Loader2 size={10} className="animate-spin" /> : <ShieldCheck size={10} />}
          بررسی
        </button>
      </div>
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-32 gap-2 text-center px-4">
      <div style={{ color: 'var(--nex-text-muted)' }}>{icon}</div>
      <p className="text-[11px] font-medium" style={{ color: 'var(--nex-text)' }}>{title}</p>
      <p className="text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>{hint}</p>
    </div>
  );
}
