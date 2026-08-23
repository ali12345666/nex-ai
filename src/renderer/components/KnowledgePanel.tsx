import React, { useState, useEffect, useCallback } from 'react';
import {
  BookOpen, RefreshCw, FileText, Layers, HardDrive, Cpu, ShieldCheck,
  Loader2, AlertCircle, X, ChevronRight, ChevronDown, Wrench,
  Plus, FolderPlus, Trash2, RotateCw,
} from 'lucide-react';
import { useStore } from '../store/useStore';

/**
 * KnowledgePanel (Phase 10 / P10-A)
 *
 * Local Knowledge / RAG control panel. ALL operations go through IPC →
 * Main → KnowledgeService — the renderer never touches the knowledge
 * filesystem itself.
 *
 * P10-A: live stats (documents/chunks/index/embedding backend/status)
 *        + document list + rebuild/refresh.
 * P10-B: add files (multi-pick) / add folder (guarded scan) / delete /
 *        re-index single document.
 * (P10-C adds search.)
 */

interface KnowledgeDoc {
  id: string;
  title: string;
  format: string;
  domain?: string;
  sourcePath?: string;
  chunkCount: number;
  sizeBytes: number;
  indexedAt?: number;
}

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function timeAgo(ts?: number): string {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function KnowledgePanel() {
  const { projectPath } = useStore();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [stats, setStats] = useState<{
    documents: number; chunks: number; sizeBytes?: number;
    embedding?: { backend: string; dimension?: number; offline: boolean; modelPath?: string };
  } | null>(null);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    setError(null);
    try {
      const [st, ls] = await Promise.all([
        window.nexAPI.knowledgeStats(projectPath),
        window.nexAPI.knowledgeList(projectPath),
      ]);
      if (st.success) setStats({ documents: st.documents || 0, chunks: st.chunks || 0, embedding: st.embedding });
      else setError(st.error || 'stats failed');
      if (ls.success) setDocs(ls.documents || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── P10-B: document management (all via IPC → Main → KnowledgeService) ──
  const addFiles = async () => {
    if (!projectPath) return;
    setBusy('add-files'); setError(null);
    try {
      const pick = await window.nexAPI.dialogOpenFiles();
      if (pick.canceled || !pick.paths?.length) return;
      const res = await window.nexAPI.knowledgeIngestMany(projectPath, pick.paths);
      if (!res.success) { setError(res.error || 'ingest failed'); }
      else {
        const rs = res.reports || [];
        const failed = rs.filter((r: any) => r.status === 'rejected' || r.status === 'unsupported');
        if (failed.length > 0) setError(`${failed.length} of ${rs.length} file(s) not indexed — ${failed[0].reason || failed[0].status}`);
      }
      await refresh();
    } catch (err: any) { setError(err.message); } finally { setBusy(null); }
  };

  const addFolder = async () => {
    if (!projectPath) return;
    setBusy('add-folder'); setError(null);
    try {
      const pick = await window.nexAPI.dialogOpenFolder();
      if (pick.canceled || !pick.path) return;
      const res = await window.nexAPI.knowledgeIngestFolder(projectPath, pick.path);
      if (!res.success) { setError(res.error || 'folder ingest failed'); }
      else if (res.scan && res.scan.rejectedCount > 0) {
        setError(`${res.scan.rejectedCount} file(s) rejected by security guards`);
      }
      await refresh();
    } catch (err: any) { setError(err.message); } finally { setBusy(null); }
  };

  const removeDoc = async (id: string) => {
    if (!projectPath) return;
    setBusy(`del:${id}`);
    try { await window.nexAPI.knowledgeRemove(projectPath, id); await refresh(); }
    catch (err: any) { setError(err.message); } finally { setBusy(null); }
  };

  const reindexDoc = async (doc: KnowledgeDoc) => {
    if (!projectPath || !doc.sourcePath) return;
    setBusy(`re:${doc.id}`);
    try { await window.nexAPI.knowledgeIngest(projectPath, doc.sourcePath); await refresh(); }
    catch (err: any) { setError(err.message); } finally { setBusy(null); }
  };

  const rebuild = async () => {
    if (!projectPath) return;
    setBusy('rebuild');
    setError(null);
    try {
      const res = await window.nexAPI.knowledgeRebuild(projectPath);
      if (!res.success) setError(res.error || 'rebuild failed');
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const projectName = projectPath ? projectPath.split(/[\\/]/).filter(Boolean).pop() || projectPath : null;

  return (
    <div className="w-full h-full flex flex-col bg-nex-surface">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-nex-border flex items-center gap-2">
        <BookOpen size={15} className="text-nex-accent" />
        <span className="text-sm font-semibold text-nex-text">Knowledge Base</span>
        <button onClick={refresh} disabled={loading}
          className="ml-auto p-1 rounded text-nex-text-dim hover:text-nex-text hover:bg-nex-card transition-colors"
          title="Refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* No project */}
      {!projectPath && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <BookOpen size={28} className="text-nex-text-muted" />
          <p className="text-xs text-nex-text-dim">Open a project to use its local knowledge base.</p>
        </div>
      )}

      {projectPath && (
        <div className="flex-1 overflow-y-auto">
          {/* Project + Status */}
          <div className="px-3 py-2 border-b border-nex-border/50">
            <div className="flex items-center gap-1.5 text-[11px] text-nex-text-dim">
              <span className="text-nex-text-muted">Project:</span>
              <span className="truncate font-medium text-nex-text">{projectName}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] mt-1">
              <ShieldCheck size={11} className="text-emerald-400" />
              <span className="text-emerald-400">Offline Ready</span>
              <span className="text-nex-text-muted">· fully local</span>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-1.5 px-3 py-2.5">
            <Stat icon={<FileText size={11} />} label="Documents" value={stats ? String(stats.documents) : '—'} />
            <Stat icon={<Layers size={11} />} label="Chunks" value={stats ? stats.chunks.toLocaleString() : '—'} />
            <Stat icon={<HardDrive size={11} />} label="Index" value={stats && stats.documents > 0 ? 'Ready' : 'Empty'} />
            <Stat
              icon={<Cpu size={11} />}
              label="Embedding"
              value={
                stats?.embedding
                  ? stats.embedding.backend === 'hash'
                    ? `Local (hash${stats.embedding.dimension ? `, ${stats.embedding.dimension}d` : ''})`
                    : stats.embedding.backend === 'llamacpp'
                    ? 'Local GGUF'
                    : 'Local'
                  : '—'
              }
              title={stats?.embedding?.modelPath}
            />
          </div>

          {/* Actions (P10-B) */}
          <div className="px-3 pb-2.5 flex flex-wrap gap-1.5">
            <ActionBtn onClick={addFiles} busy={busy === 'add-files'} icon={<Plus size={11} />} label="Add Files" />
            <ActionBtn onClick={addFolder} busy={busy === 'add-folder'} icon={<FolderPlus size={11} />} label="Add Folder" />
            <ActionBtn onClick={rebuild} busy={busy === 'rebuild'} icon={<Wrench size={11} />} label="Rebuild Index" />
          </div>

          {/* Error strip */}
          {error && (
            <div className="mx-3 mb-2 px-2 py-1.5 rounded bg-red-500/10 border border-red-500/25 flex items-start gap-1.5">
              <AlertCircle size={11} className="text-red-400 mt-0.5 shrink-0" />
              <span className="text-[10px] text-red-400 break-words flex-1">{error}</span>
              <button onClick={() => setError(null)} className="text-red-400/70 hover:text-red-400 shrink-0">
                <X size={10} />
              </button>
            </div>
          )}

          {/* Document list */}
          <div className="px-3 py-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-wider text-nex-text-muted">
                Documents ({docs.length})
              </span>
            </div>
            {docs.length === 0 && !loading && (
              <p className="text-[11px] text-nex-text-dim py-2 text-center">
                No documents indexed yet.
              </p>
            )}
            {docs.map((d) => (
              <DocRow key={d.id} doc={d} busy={busy} onReindex={() => reindexDoc(d)} onDelete={() => removeDoc(d.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Stat({ icon, label, value, title }: { icon: React.ReactNode; label: string; value: string; title?: string }) {
  return (
    <div className="p-2 rounded-lg bg-nex-card border border-nex-border/70" title={title}>
      <div className="flex items-center gap-1 text-nex-text-muted mb-0.5">
        {icon}
        <span className="text-[9px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-[12px] font-medium text-nex-text truncate">{value}</div>
    </div>
  );
}

function ActionBtn({ onClick, busy, icon, label }: { onClick: () => void; busy: boolean; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-nex-card border border-nex-border text-nex-text-dim hover:text-nex-text hover:border-nex-accent/40 transition-colors disabled:opacity-50">
      {busy ? <Loader2 size={10} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

function DocRow({ doc, busy, onReindex, onDelete }: {
  doc: KnowledgeDoc;
  busy: string | null;
  onReindex: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-0.5 rounded-md border border-transparent hover:border-nex-border/60 hover:bg-nex-card/60 transition-colors">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-1 px-1.5 py-1 text-left">
        {open ? <ChevronDown size={10} className="text-nex-text-muted shrink-0" /> : <ChevronRight size={10} className="text-nex-text-muted shrink-0" />}
        <FileText size={10} className="text-nex-accent/70 shrink-0" />
        <span className="text-[11px] text-nex-text truncate flex-1">{doc.title}</span>
        <span className="text-[9px] text-nex-text-muted shrink-0">{doc.chunkCount} chunks</span>
      </button>
      {open && (
        <div className="px-3 pb-1.5 pt-0.5">
          <div className="text-[9px] text-nex-text-muted space-y-0.5 mb-1.5">
            <div className="truncate" title={doc.sourcePath}>path: {doc.sourcePath || '—'}</div>
            <div>format: {doc.format} · size: {formatBytes(doc.sizeBytes)}</div>
            <div>indexed: {timeAgo(doc.indexedAt)}{doc.domain ? ` · domain: ${doc.domain}` : ''}</div>
          </div>
          <div className="flex gap-1">
            <button onClick={onReindex} disabled={busy === `re:${doc.id}`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-nex-text-dim hover:text-nex-accent border border-nex-border hover:border-nex-accent/40 transition-colors disabled:opacity-50">
              {busy === `re:${doc.id}` ? <Loader2 size={9} className="animate-spin" /> : <RotateCw size={9} />}
              Re-index
            </button>
            <button onClick={onDelete} disabled={busy === `del:${doc.id}`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-nex-text-dim hover:text-red-400 border border-nex-border hover:border-red-500/40 transition-colors disabled:opacity-50">
              {busy === `del:${doc.id}` ? <Loader2 size={9} className="animate-spin" /> : <Trash2 size={9} />}
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
