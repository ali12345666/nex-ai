/**
 * NEX AI — Tools Panel (UI-05)
 *
 * Lists available agent tools via the existing `agent-list-tools` IPC
 * (was orphan handler per audit 1-c — wired but no UI consumed it).
 * Shows tool name, description, and capabilities. Loading/empty/error.
 *
 * Pure renderer — no backend changes (IPC already exists).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Wrench, RefreshCw } from 'lucide-react';

interface AgentTool {
  name: string;
  description?: string;
  category?: string;
  capabilities?: string[];
}

export default function ToolsPanel() {
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.nexAPI.agentListTools();
      setTools(Array.isArray(result) ? result : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load tools');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--nex-glass-border)' }}
      >
        <div className="flex items-center gap-2">
          <Wrench size={14} style={{ color: 'var(--nex-accent)' }} aria-hidden />
          <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
            AGENT TOOLS
          </span>
          <span className="text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>
            ({tools.length})
          </span>
        </div>
        <button
          onClick={load}
          className="nex-click nex-focus p-1 rounded transition-colors hover:bg-white/[0.06]"
          style={{ color: 'var(--nex-text-muted)' }}
          aria-label="Refresh tools list"
          title="Refresh"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto nex-scrollbar p-3">
        {loading && tools.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div
              className="w-5 h-5 rounded-full border-2 border-transparent animate-spin"
              style={{ borderTopColor: 'var(--nex-accent)', borderRightColor: 'var(--nex-accent-dim)' }}
            />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
            <p className="text-xs" style={{ color: 'var(--nex-error, #ef4444)' }}>{error}</p>
            <button
              onClick={load}
              className="nex-click nex-focus px-3 py-1 rounded text-[10px] nex-glass"
              style={{ color: 'var(--nex-accent-text)' }}
            >
              Retry
            </button>
          </div>
        ) : tools.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
            <Wrench size={32} style={{ color: 'var(--nex-text-muted)', opacity: 0.4 }} />
            <p className="text-xs" style={{ color: 'var(--nex-text-muted)' }}>
              No tools registered.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {tools.map((tool, i) => (
              <li
                key={tool.name || i}
                className="nex-glass p-3 rounded-lg"
                style={{ border: '1px solid var(--nex-glass-border)' }}
              >
                <div className="flex items-center gap-2">
                  <Wrench size={11} style={{ color: 'var(--nex-accent-text)' }} aria-hidden />
                  <span className="text-xs font-medium" style={{ color: 'var(--nex-text)' }}>
                    {tool.name}
                  </span>
                  {tool.category && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider"
                      style={{ color: 'var(--nex-text-muted)', background: 'var(--nex-glass-border)' }}
                    >
                      {tool.category}
                    </span>
                  )}
                </div>
                {tool.description && (
                  <p className="text-[10px] mt-1.5" style={{ color: 'var(--nex-text-muted)' }}>
                    {tool.description}
                  </p>
                )}
                {tool.capabilities && tool.capabilities.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {tool.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="text-[9px] px-1 py-0.5 rounded"
                        style={{ color: 'var(--nex-accent-text)', background: 'var(--nex-accent-dim)' }}
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
