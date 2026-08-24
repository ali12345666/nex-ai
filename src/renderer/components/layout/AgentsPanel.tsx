/**
 * NEX AI — Agents Panel (UI-05)
 *
 * Lists agent tasks via the existing `agent-list-tasks` IPC (was orphan
 * handler per audit 1-c — wired but no UI consumed it). Shows real task
 * state, supports delete. Loading/empty/error states.
 *
 * Pure renderer — no backend changes (IPC already exists).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Bot, Trash2, RefreshCw, Plus } from 'lucide-react';

interface AgentTask {
  id: string;
  prompt?: string;
  status?: string;
  createdAt?: number;
  updatedAt?: number;
  currentStep?: string;
}

export default function AgentsPanel() {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.nexAPI.agentListTasks();
      setTasks(Array.isArray(result) ? result : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load agent tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Poll every 3s for live updates (agent tasks change state).
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await window.nexAPI.agentDeleteTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (err: any) {
      setError(err?.message || 'Failed to delete task');
    }
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--nex-glass-border)' }}
      >
        <div className="flex items-center gap-2">
          <Bot size={14} style={{ color: 'var(--nex-accent)' }} aria-hidden />
          <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
            AGENT TASKS
          </span>
          <span className="text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>
            ({tasks.length})
          </span>
        </div>
        <button
          onClick={load}
          className="nex-click nex-focus p-1 rounded transition-colors hover:bg-white/[0.06]"
          style={{ color: 'var(--nex-text-muted)' }}
          aria-label="Refresh agent tasks"
          title="Refresh"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto nex-scrollbar p-3">
        {loading && tasks.length === 0 ? (
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
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
            <Bot size={32} style={{ color: 'var(--nex-text-muted)', opacity: 0.4 }} />
            <p className="text-xs" style={{ color: 'var(--nex-text-muted)' }}>
              No agent tasks.
            </p>
            <p className="text-[10px]" style={{ color: 'var(--nex-text-muted)', opacity: 0.7 }}>
              Tasks are created when the AI agent runs multi-step operations.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="nex-glass p-3 rounded-lg flex items-start gap-2"
                style={{ border: '1px solid var(--nex-glass-border)' }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs truncate" style={{ color: 'var(--nex-text)' }}>
                    {task.prompt || task.currentStep || `(task ${task.id.slice(0, 8)})`}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {task.status && (
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider"
                        style={{
                          color: task.status === 'running' ? 'var(--nex-success)' :
                                 task.status === 'error' ? 'var(--nex-error, #ef4444)' :
                                 'var(--nex-text-muted)',
                          background: 'var(--nex-glass-border)',
                        }}
                      >
                        {task.status}
                      </span>
                    )}
                    {task.currentStep && (
                      <span className="text-[10px] truncate" style={{ color: 'var(--nex-text-muted)' }}>
                        → {task.currentStep}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(task.id)}
                  className="nex-click nex-focus p-1 rounded transition-colors hover:bg-white/[0.06] shrink-0"
                  style={{ color: 'var(--nex-text-muted)' }}
                  aria-label={`Delete task ${task.id}`}
                  title="Delete task"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
