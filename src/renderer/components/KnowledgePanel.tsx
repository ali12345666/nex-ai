import React, { useState, useEffect, useCallback } from 'react';
import {
  BookOpen, RefreshCw, FileText, Layers, HardDrive, Cpu, ShieldCheck,
  Loader2, AlertCircle, X, ChevronRight, ChevronDown, Wrench,
  Plus, FolderPlus, Trash2, RotateCw, Search, Settings2, Check, Eye,
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
 * P10-C: knowledge search — query → ranked results → score → document →
 *        snippet → citation (file → line range), fully local.
 * P10-D/E: embedding backend selector — offline Hash (default) or a LOCAL
 *        GGUF embedding model from the registry (independent from the chat
 *        model; switching prompts an index rebuild).
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

interface SearchHit {
  documentId: string;
  title: string;
  source?: string;
  startLine?: number;
  endLine?: number;
  section?: string;
  symbols?: string[];
  jsonPath?: string;
  rowRange?: string;
  score: number;
  snippet: string;
  citation?: string;
}

interface EmbeddingModelEntry {
  id: string;
  name: string;
  fileExists: boolean;
  category: string;
}

interface EmbeddingState {
  backend: 'hash' | 'llamacpp';
  modelId: string | null;
  modelPath: string | null;
  fallbackReason: string | null;
  embeddingModels: EmbeddingModelEntry[];
  otherModels: EmbeddingModelEntry[];
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

  // ── P10-C: search (IPC → Main → HybridRetriever; fully local) ──
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const runSearch = async () => {
    const q = query.trim();
    if (!projectPath || !q) return;
    setSearching(true); setError(null);
    try {
      const res = await window.nexAPI.knowledgeSearch(projectPath, q, 8);
      if (res.success) setSearchResults(res.results || []);
      else setError(res.error || 'search failed');
    } catch (err: any) { setError(err.message); }
    finally { setSearching(false); }
  };

  const rebuild = async () => {
    if (!projectPath) return;
    setBusy('rebuild');    setError(null);
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

  // ── P11-F: Knowledge Viewer (open document → chunks + metadata) ──
  const [viewDoc, setViewDoc] = useState<{
    document: NonNullable<Awaited<ReturnType<typeof window.nexAPI.knowledgeChunks>>['document']>;
    embedding?: NonNullable<Awaited<ReturnType<typeof window.nexAPI.knowledgeChunks>>['embedding']>;
    chunks: NonNullable<Awaited<ReturnType<typeof window.nexAPI.knowledgeChunks>>['chunks']>;
  } | null>(null);
  const [viewBusy, setViewBusy] = useState(false);

  const openDoc = async (id: string) => {
    if (!projectPath) return;
    setViewBusy(true); setError(null);
    try {
      const res = await window.nexAPI.knowledgeChunks(projectPath, id);
      if (res.success && res.document && res.chunks) {
        setViewDoc({ document: res.document, embedding: res.embedding, chunks: res.chunks });
      } else {
        setError(res.error || 'cannot open document');
      }
    } catch (err: any) { setError(err.message); }
    finally { setViewBusy(false); }
  };

  // ── P10-D/E: embedding backend state (hash default / local GGUF) ──
  const [embState, setEmbState] = useState<EmbeddingState | null>(null);
  const [embOpen, setEmbOpen] = useState(false);
  const [embBusy, setEmbBusy] = useState(false);
  const [needsRebuildBanner, setNeedsRebuildBanner] = useState(false);

  const loadEmbedding = useCallback(async () => {
    try {
      const res = await window.nexAPI.knowledgeEmbeddingGet();
      if (res.success && res.current) {
        setEmbState({
          backend: res.current.backend,
          modelId: res.current.modelId,
          modelPath: res.current.modelPath,
          fallbackReason: res.current.fallbackReason,
          embeddingModels: (res.embeddingModels || []) as EmbeddingModelEntry[],
          otherModels: (res.otherModels || []) as EmbeddingModelEntry[],
        });
      }
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadEmbedding(); }, [loadEmbedding]);

  const selectEmbedding = async (modelId: string | null) => {
    setEmbBusy(true); setError(null);
    try {
      const res = await window.nexAPI.knowledgeEmbeddingSet(modelId);
      if (!res.success) setError(res.error || 'failed to set embedding backend');
      else if (res.needsRebuild) setNeedsRebuildBanner(true);
      await loadEmbedding();
      await refresh();
    } catch (err: any) { setError(err.message); } finally { setEmbBusy(false); }
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

          {/* Embedding backend selector (P10-D/E) */}
          <div className="px-3 pb-2.5 border-b border-nex-border/50">
            <button onClick={() => setEmbOpen(!embOpen)}
              className="w-full flex items-center gap-1.5 text-[10px] text-nex-text-dim hover:text-nex-text transition-colors">
              <Settings2 size={10} />
              <span className="uppercase tracking-wider">Embedding Backend</span>
              <span className="ml-auto flex items-center gap-1 text-nex-text-muted normal-case">
                {embBusy && <Loader2 size={9} className="animate-spin" />}
                {embState ? (embState.backend === 'hash' ? 'Hash (offline)' : 'GGUF model') : '…'}
                {embOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              </span>
            </button>
            {embOpen && embState && (
              <div className="mt-1.5 space-y-1">
                {embState.fallbackReason && (
                  <div className="text-[9px] text-yellow-400 px-2 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded">
                    {embState.fallbackReason}
                  </div>
                )}
                <EmbOption
                  active={embState.modelId === null}
                  onClick={() => selectEmbedding(null)}
                  disabled={embBusy}
                  title="Hash Embedder (built-in)"
                  desc="Offline · deterministic · zero setup · 256d"
                />
                {embState.embeddingModels.length > 0 && (
                  <div className="text-[9px] uppercase tracking-wider text-nex-text-muted pt-1">Embedding models</div>
                )}
                {embState.embeddingModels.map((m) => (
                  <EmbOption
                    key={m.id}
                    active={embState.modelId === m.id}
                    onClick={() => selectEmbedding(m.id)}
                    disabled={embBusy || !m.fileExists}
                    title={m.name + (m.fileExists ? '' : ' (file missing)')}
                    desc="Local GGUF · via llama.cpp"
                  />
                ))}
                {embState.otherModels.length > 0 && (
                  <details className="pt-1">
                    <summary className="text-[9px] uppercase tracking-wider text-nex-text-muted cursor-pointer select-none">
                      Advanced — any registered GGUF ({embState.otherModels.length})
                    </summary>
                    <div className="mt-1 space-y-1">
                      {embState.otherModels.map((m) => (
                        <EmbOption
                          key={m.id}
                          active={embState.modelId === m.id}
                          onClick={() => selectEmbedding(m.id)}
                          disabled={embBusy || !m.fileExists}
                          title={m.name + (m.fileExists ? '' : ' (file missing)')}
                          desc={`${m.category} model · usually NOT embedding-capable`}
                        />
                      ))}
                    </div>
                  </details>
                )}
                <p className="text-[9px] text-nex-text-muted pt-0.5">
                  Independent from the chat model. Switching backends changes vector dimensions → Rebuild Index required.
                </p>
              </div>
            )}
            {needsRebuildBanner && (
              <div className="mt-2 px-2 py-1.5 rounded bg-yellow-500/10 border border-yellow-500/25 flex items-center gap-1.5">
                <AlertCircle size={11} className="text-yellow-400 shrink-0" />
                <span className="text-[9px] text-yellow-400 flex-1">Backend switched — run Rebuild Index to re-embed all documents.</span>
                <button onClick={() => { setNeedsRebuildBanner(false); rebuild(); }} className="text-[9px] text-yellow-300 underline shrink-0">Rebuild</button>
              </div>
            )}
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

          {/* Search (P10-C) */}
          <div className="px-3 pb-2.5 border-b border-nex-border/50">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nex-text-dim" />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); if (searchResults) setSearchResults(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                placeholder="Search knowledge…"
                className="w-full bg-nex-card border border-nex-border rounded-lg pl-7 pr-2 py-1.5 text-[11px] text-nex-text placeholder-nex-text-muted outline-none focus:border-nex-accent/50"
              />
              {searching && <Loader2 size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-nex-accent" />}
            </div>

            {/* Results: score → document → snippet → citation */}
            {searchResults && (
              <div className="mt-2">
                <div className="text-[10px] uppercase tracking-wider text-nex-text-muted mb-1.5">
                  Results ({searchResults.length})
                </div>
                {searchResults.length === 0 && (
                  <p className="text-[11px] text-nex-text-dim py-1">No matches.</p>
                )}
                {searchResults.map((r, i) => (
                  <div key={`${r.documentId}-${i}`} className="mb-2 p-2 rounded-lg bg-nex-card border border-nex-border/70">
                    <div className="flex items-center gap-1.5 mb-1">
                      <FileText size={10} className="text-nex-accent/70 shrink-0" />
                      <span className="text-[11px] font-medium text-nex-text truncate flex-1" title={r.title}>{r.title}</span>
                      <span className="text-[9px] text-nex-accent font-mono shrink-0" title="relevance score">{r.score.toFixed(3)}</span>
                    </div>
                    <p className="text-[10px] text-nex-text-dim leading-snug line-clamp-3 whitespace-pre-wrap">{r.snippet}</p>
                    <div className="text-[9px] text-nex-text-muted mt-1 truncate" title={r.source}>
                      {r.source || r.title}
                      {r.startLine !== undefined
                        ? ` → lines ${r.startLine}${r.endLine !== undefined ? `-${r.endLine}` : ''}`
                        : ''}
                      {r.section ? ` · § ${r.section}` : ''}
                      {r.citation ? '' : ''}
                    </div>
                    {r.citation && (
                      <div className="text-[9px] text-nex-accent/80 mt-0.5 truncate font-mono" title="citation">
                        {r.citation}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Knowledge Viewer (P11-F) */}
          {viewDoc && (
            <div className="px-3 py-2 border-b border-nex-border/50 bg-nex-bg/30">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Eye size={11} className="text-nex-accent shrink-0" />
                <span className="text-[11px] font-medium text-nex-text truncate flex-1">{viewDoc.document.title}</span>
                <button onClick={() => setViewDoc(null)} className="text-nex-text-dim hover:text-nex-text shrink-0" title="Close viewer">
                  <X size={11} />
                </button>
              </div>
              <div className="text-[9px] text-nex-text-muted space-y-0.5 mb-1.5">
                <div className="truncate" title={viewDoc.document.sourcePath}>path: {viewDoc.document.sourcePath || '—'}</div>
                <div>
                  format: {viewDoc.document.format}
                  {viewDoc.document.language ? ` · lang: ${viewDoc.document.language}` : ''}
                  {typeof viewDoc.document.symbolCount === 'number' ? ` · symbols: ${viewDoc.document.symbolCount}` : ''}
                  {` · chunks: ${viewDoc.chunks.length}`}
                </div>
                {viewDoc.document.imports && viewDoc.document.imports.length > 0 && (
                  <div className="truncate" title={viewDoc.document.imports.join(', ')}>imports: {viewDoc.document.imports.slice(0, 5).join(', ')}{viewDoc.document.imports.length > 5 ? ' …' : ''}</div>
                )}
                <div>
                  index: {viewDoc.document.chunkCount ? 'Ready' : '—'} · size: {formatBytes(viewDoc.document.sizeBytes || 0)} · indexed: {timeAgo(viewDoc.document.indexedAt)}
                </div>
                {viewDoc.embedding && (
                  <div>
                    embedding: {viewDoc.embedding.backend === 'hash' ? `Local hash${viewDoc.embedding.dimension ? ` (${viewDoc.embedding.dimension}d)` : ''}` : 'Local GGUF'} · offline: yes
                  </div>
                )}
              </div>
              <div className="text-[9px] uppercase tracking-wider text-nex-text-muted mb-1">Chunks ({viewDoc.chunks.length})</div>
              <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                {viewDoc.chunks.map((c) => (
                  <div key={c.id} className={`p-1.5 rounded border ${c.suspectedInjection ? 'border-yellow-500/40 bg-yellow-500/5' : 'border-nex-border/60 bg-nex-card/60'}`}>
                    <div className="flex items-center gap-1 text-[9px]">
                      <span className="text-nex-text-muted font-mono">#{c.index}</span>
                      {c.startLine !== undefined && (
                        <span className="text-nex-text-dim font-mono">
                          {c.jsonPath ? c.jsonPath : c.rowRange ? c.rowRange : `L${c.startLine}${c.endLine !== undefined ? `-${c.endLine}` : ''}`}
                        </span>
                      )}
                      {c.sectionTitle && <span className="text-nex-accent/70 truncate">§ {c.sectionTitle}</span>}
                      {c.symbols && c.symbols.length > 0 && (
                        <span className="text-nex-accent/80 truncate flex-1" title={c.symbols.join(', ')}>{c.symbols.slice(0, 2).join(' + ')}</span>
                      )}
                      <span className="text-nex-text-muted ml-auto shrink-0">{c.chars}c</span>
                    </div>
                    {c.suspectedInjection && <div className="text-[8px] text-yellow-400 mt-0.5">⚠ injection-suspected (stored as data)</div>}
                    <p className="text-[9px] text-nex-text-dim mt-0.5 line-clamp-2 whitespace-pre-wrap">{c.preview}</p>
                  </div>
                ))}
              </div>
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
              <DocRow key={d.id} doc={d} busy={busy} onReindex={() => reindexDoc(d)} onDelete={() => removeDoc(d.id)} onView={() => openDoc(d.id)} viewBusy={viewBusy} />
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

function EmbOption({ active, onClick, disabled, title, desc }: {
  active: boolean; onClick: () => void; disabled: boolean; title: string; desc: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-full text-left px-2 py-1.5 rounded-md border transition-colors flex items-start gap-1.5 disabled:opacity-40 ${
        active ? 'border-nex-accent/60 bg-nex-accent/10' : 'border-nex-border bg-nex-card hover:border-nex-border-light'
      }`}>
      <span className={`mt-0.5 shrink-0 ${active ? 'text-nex-accent' : 'text-transparent'}`}><Check size={10} /></span>
      <span className="min-w-0">
        <span className="block text-[10px] font-medium text-nex-text truncate">{title}</span>
        <span className="block text-[9px] text-nex-text-muted">{desc}</span>
      </span>
    </button>
  );
}

function DocRow({ doc, busy, onReindex, onDelete, onView, viewBusy }: {
  doc: KnowledgeDoc;
  busy: string | null;
  onReindex: () => void;
  onDelete: () => void;
  onView: () => void;
  viewBusy: boolean;
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
            <button onClick={onView} disabled={viewBusy}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-nex-text-dim hover:text-nex-accent border border-nex-border hover:border-nex-accent/40 transition-colors disabled:opacity-50">
              <Eye size={9} />
              View
            </button>
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
