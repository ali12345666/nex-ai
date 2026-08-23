import React, { useState, useEffect, useCallback } from 'react';
import {
  Brain, User, FolderKanban, ListChecks, Database, Clock,
  RefreshCw, Trash2, Loader2, AlertCircle, X, Tag, Search,
} from 'lucide-react';
import { useStore } from '../store/useStore';

/**
 * MemoryPanel (Phase 13 / P13-B)
 *
 * View/manage the 5-store memory architecture over IPC:
 * user / project / task / knowledge / session.
 * Project store is project-scoped (isolation); values arrive ALREADY
 * redacted from main (defense in depth).
 */

type StoreId = 'user' | 'project' | 'task' | 'knowledge' | 'session';

interface MemoryRow {
  key: string;
  value: any;
  type: string;
  tags: string[];
  updatedAt: number;
  expiresAt?: number;
}

const STORES: Array<{ id: StoreId; label: string; icon: React.ReactNode; hint: string }> = [
  { id: 'user', label: 'User', icon: <User size={11} />, hint: 'preferences & learned corrections' },
  { id: 'project', label: 'Project', icon: <FolderKanban size={11} />, hint: 'per-project lessons & decisions' },
  { id: 'task', label: 'Task', icon: <ListChecks size={11} />, hint: 'task history summaries' },
  { id: 'knowledge', label: 'Knowledge', icon: <Database size={11} />, hint: 'shared knowledge refs' },
  { id: 'session', label: 'Session', icon: <Clock size={11} />, hint: 'volatile (auto-expires)' },
];

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function MemoryPanel() {
  const { projectPath } = useStore();
  const [store, setStore] = useState<StoreId>('project');
  const [rows, setRows] = useState<MemoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    if (store === 'project' && !projectPath) { setRows([]); setError(null); return; }
    setLoading(true); setError(null);
    try {
      const res = await window.nexAPI.memoryList(store, projectPath || undefined);
      if (res.success) setRows(res.entries || []);
      else setError(res.error || 'load failed');
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }, [store, projectPath]);

  useEffect(() => { load(); }, [load]);

  const remove = async (key: string) => {
    try {
      await window.nexAPI.memoryDelete(store, key, projectPath || undefined);
      await load();
    } catch (err: any) { setError(err.message); }
  };

  const clearAll = async () => {
    setConfirmClear(false);
    try {
      await window.nexAPI.memoryClear(store, projectPath || undefined);
      await load();
    } catch (err: any) { setError(err.message); }
  };

  const shown = filter.trim()
    ? rows.filter((r) => `${r.key} ${JSON.stringify(r.value)}`.toLowerCase().includes(filter.toLowerCase()))
    : rows;

  const activeStore = STORES.find((s) => s.id === store)!;

  return (
    <div className="w-full h-full flex flex-col bg-nex-surface">
      <div className="px-3 py-2.5 border-b border-nex-border flex items-center gap-2">
        <Brain size={15} className="text-nex-accent" />
        <span className="text-sm font-semibold text-nex-text">Memory</span>
        <span className="text-[9px] text-nex-text-muted">({rows.length})</span>
        <button onClick={load} disabled={loading}
          className="ml-auto p-1 rounded text-nex-text-dim hover:text-nex-text hover:bg-nex-card transition-colors" title="Refresh">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
        {rows.length > 0 && (
          <button onClick={() => setConfirmClear(true)}
            className="p-1 rounded text-nex-text-dim hover:text-red-400 transition-colors" title={`Clear ${store} store`}>
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Store tabs */}
      <div className="px-2 py-1.5 border-b border-nex-border/50 flex gap-1 flex-wrap">
        {STORES.map((s) => (
          <button key={s.id} onClick={() => setStore(s.id)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-colors ${
              store === s.id
                ? 'border-nex-accent/60 bg-nex-accent/10 text-nex-accent-light'
                : 'border-nex-border bg-nex-card text-nex-text-dim hover:text-nex-text'
            }`}>
            {s.icon}{s.label}
          </button>
        ))}
      </div>
      <div className="px-3 py-1 text-[9px] text-nex-text-muted border-b border-nex-border/50">
        {activeStore.hint}{store === 'project' ? (projectPath ? ` · scoped to this project` : ' · requires an open project') : ''}
      </div>

      {/* Filter */}
      <div className="px-3 py-1.5 border-b border-nex-border/50 relative">
        <Search size={11} className="absolute left-5 top-1/2 -translate-y-1/2 text-nex-text-dim" />
        <input value={filter} onChange={(e) => setFilter(e.target.value)}
          placeholder="filter…"
          className="w-full bg-nex-card border border-nex-border rounded-lg pl-6 pr-2 py-1 text-[10px] text-nex-text placeholder-nex-text-muted outline-none focus:border-nex-accent/50" />
      </div>

      {error && (
        <div className="mx-3 mt-2 px-2 py-1 rounded bg-red-500/10 border border-red-500/25 text-[10px] text-red-400 flex items-center gap-1">
          <AlertCircle size={10} /> {error}
          <button onClick={() => setError(null)} className="ml-auto"><X size={10} /></button>
        </div>
      )}

      {confirmClear && (
        <div className="mx-3 mt-2 px-2 py-1.5 rounded bg-red-500/10 border border-red-500/30 text-[10px] text-red-300 flex items-center gap-2">
          <span className="flex-1">Clear ALL {store} memories? Cannot be undone.</span>
          <button onClick={clearAll} className="px-1.5 py-0.5 rounded bg-red-500/20 border border-red-500/40 text-red-300">Clear</button>
          <button onClick={() => setConfirmClear(false)} className="text-nex-text-dim">Cancel</button>
        </div>
      )}

      {/* Rows */}
      <div className="flex-1 overflow-y-auto px-2 py-1.5">
        {store === 'project' && !projectPath && (
          <p className="text-[10px] text-nex-text-dim text-center py-4">Open a project to view its memory.</p>
        )}
        {!loading && shown.length === 0 && !(store === 'project' && !projectPath) && (
          <p className="text-[10px] text-nex-text-dim text-center py-4">No memories in this store{filter ? ' matching filter' : ''}.</p>
        )}
        {shown.map((r) => (
          <MemoryRowView key={r.key} row={r} onRemove={() => remove(r.key)} />
        ))}
      </div>
    </div>
  );
}

function MemoryRowView({ row, onRemove }: { row: MemoryRow; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const valueStr = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
  const expired = row.expiresAt !== undefined && row.expiresAt < Date.now();
  return (
    <div className={`mb-1 rounded-md border ${expired ? 'border-nex-border/40 opacity-50' : 'border-nex-border/60'} bg-nex-card/60 hover:bg-nex-card transition-colors`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-1.5 px-2 py-1 text-left">
        <span className="text-[10px] font-mono text-nex-accent/80 truncate flex-1">{row.key}</span>
        {row.tags.slice(0, 2).map((t) => (
          <span key={t} className="text-[8px] px-1 rounded bg-nex-accent/10 text-nex-accent-light shrink-0 inline-flex items-center gap-0.5">
            <Tag size={7} />{t}
          </span>
        ))}
        <span className="text-[8px] text-nex-text-muted shrink-0">{timeAgo(row.updatedAt)}</span>
      </button>
      {open && (
        <div className="px-2.5 pb-1.5">
          <p className="text-[9px] text-nex-text-dim whitespace-pre-wrap break-words line-clamp-6">{valueStr.slice(0, 600)}</p>
          {expired && <p className="text-[8px] text-nex-text-muted mt-0.5">expired (cleanup pending)</p>}
          <button onClick={onRemove} className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-nex-text-dim hover:text-red-400 border border-nex-border hover:border-red-500/40 transition-colors">
            <Trash2 size={9} /> Remove
          </button>
        </div>
      )}
    </div>
  );
}
