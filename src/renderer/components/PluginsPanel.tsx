import React, { useState, useEffect, useCallback } from 'react';
import { Puzzle, RefreshCw, ToggleLeft, ToggleRight, ShieldAlert, Loader2, AlertCircle, X, Package } from 'lucide-react';

/**
 * PluginsPanel (Phase 15 / P15-C)
 *
 * Manifest-level plugin management ONLY (discovery/validation/enable
 * state). Plugin code activation arrives with the dedicated loader/sandbox
 * phase — the panel states that explicitly so expectations are honest.
 */

interface PluginEntry {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  permissions: Array<{ type: string; scope: string; reason: string }>;
  provides: { tools: string[]; knowledgeDomains: any[]; runtimes: any[]; uiExtensions: string[] };
  enabled: boolean;
  installedAt: number;
}

interface InvalidEntry { dir: string; reason: string }

export default function PluginsPanel() {
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [invalid, setInvalid] = useState<InvalidEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await window.nexAPI.pluginsList();
      if (res.success) {
        setPlugins(res.plugins || []);
        setInvalid(res.invalid || []);
      } else setError(res.error || 'failed to list plugins');
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (id: string, next: boolean) => {
    setBusy(id);
    try {
      const res = await window.nexAPI.pluginsSetEnabled(id, next);
      if (!res.success) setError(res.error || 'failed');
      await load();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(null); }
  };

  return (
    <div className="w-full h-full flex flex-col bg-[var(--nex-panel-solid)]">
      <div className="px-3 py-2.5 border-b border-[var(--nex-glass-border)] flex items-center gap-2">
        <Puzzle size={15} className="text-[var(--nex-accent)]" />
        <span className="text-sm font-semibold text-[var(--nex-text)]">Plugins</span>
        <span className="text-[9px] text-[var(--nex-text-muted)]">({plugins.length})</span>
        <button onClick={load} disabled={loading}
          className="ml-auto p-1 rounded text-[var(--nex-text-dim)] hover:text-[var(--nex-text)] hover:bg-white/[0.04] transition-colors" title="Rescan">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="px-3 py-1.5 border-b border-[var(--nex-glass-border)]/50 text-[9px] text-[var(--nex-text-muted)]">
        Manifest-level management. Place plugin folders under <span className="font-mono">userData/plugins/</span>. Code activation ships with the loader/sandbox phase.
      </div>

      {error && (
        <div className="mx-3 mt-2 px-2 py-1 rounded bg-red-500/10 border border-red-500/25 text-[10px] text-red-400 flex items-center gap-1">
          <AlertCircle size={10} /> {error}
          <button onClick={() => setError(null)} className="ml-auto"><X size={10} /></button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {plugins.length === 0 && !loading && (
          <div className="text-center py-8">
            <Package size={26} className="text-[var(--nex-text-muted)] mx-auto mb-2" />
            <p className="text-[11px] text-[var(--nex-text-dim)]">No plugins discovered.</p>
          </div>
        )}
        {plugins.map((p) => (
          <div key={p.id} className={`p-2 rounded-lg border transition-colors ${p.enabled ? 'border-[var(--nex-accent)]/30 bg-[var(--nex-accent-dim)]' : 'border-[var(--nex-glass-border)] bg-[var(--nex-glass-bg)]'}`}>
            <div className="flex items-center gap-2">
              <Puzzle size={13} className={p.enabled ? 'text-[var(--nex-accent)]' : 'text-[var(--nex-text-muted)]'} />
              <span className="text-[11px] font-medium text-[var(--nex-text)] truncate flex-1">{p.name}</span>
              <span className="text-[9px] font-mono text-[var(--nex-text-muted)]">v{p.version}</span>
              <button onClick={() => toggle(p.id, !p.enabled)} disabled={busy === p.id}
                className={`shrink-0 transition-colors ${p.enabled ? 'text-[var(--nex-accent)]' : 'text-[var(--nex-text-muted)] hover:text-[var(--nex-text)]'}`}
                title={p.enabled ? 'Disable (bookkeeping — code loads only after the loader phase)' : 'Enable'}>
                {busy === p.id ? <Loader2 size={14} className="animate-spin" /> : p.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
              </button>
            </div>
            <div className="text-[9px] text-[var(--nex-text-muted)] mt-0.5 truncate" title={p.id}>{p.id} · {p.author}</div>
            <p className="text-[10px] text-[var(--nex-text-dim)] mt-1 line-clamp-2">{p.description}</p>
            {p.permissions.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {p.permissions.map((perm, i) => (
                  <span key={i} title={perm.reason}
                    className="inline-flex items-center gap-0.5 text-[8px] px-1 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                    <ShieldAlert size={7} />{perm.type}: {perm.scope}
                  </span>
                ))}
              </div>
            )}
            {p.provides.tools.length > 0 && (
              <div className="text-[9px] text-[var(--nex-text-muted)] mt-1">provides tools: {p.provides.tools.join(', ')}</div>
            )}
          </div>
        ))}

        {invalid.length > 0 && (
          <div className="mt-2">
            <div className="text-[9px] uppercase tracking-wider text-[var(--nex-text-muted)] mb-1">Invalid discoveries</div>
            {invalid.map((d, i) => (
              <div key={i} className="px-2 py-1 rounded border border-red-500/20 bg-red-500/5 mb-1">
                <div className="text-[9px] font-mono text-[var(--nex-text-dim)] truncate">{d.dir}</div>
                <div className="text-[9px] text-red-400">{d.reason}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
