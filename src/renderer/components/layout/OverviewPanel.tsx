/**
 * NEX AI — Overview Panel (UI-05)
 *
 * Replaces the dead WorkspacePanel placeholder for the 'home' nav item.
 * Shows real project info + quick links to other panels. Uses store data
 * (projectPath, recentProjects) — no new IPC needed.
 *
 * Pure renderer — no backend changes.
 */

import React from 'react';
import { Home, FolderOpen, Terminal, BookOpen, Activity, ChevronRight } from 'lucide-react';
import { useStore } from '../../store/useStore';

interface OverviewPanelProps {
  onNavigate: (view: 'terminal' | 'files' | 'knowledge' | 'monitor') => void;
}

interface QuickAction {
  icon: React.ReactNode;
  label: string;
  description: string;
  view: 'terminal' | 'files' | 'knowledge' | 'monitor';
}

const QUICK_ACTIONS: QuickAction[] = [
  { icon: <Terminal size={16} />, label: 'Terminal', description: 'Open project terminal session', view: 'terminal' },
  { icon: <FolderOpen size={16} />, label: 'Files', description: 'Browse project workspace', view: 'files' },
  { icon: <BookOpen size={16} />, label: 'Knowledge', description: 'Search documents & embeddings', view: 'knowledge' },
  { icon: <Activity size={16} />, label: 'System', description: 'Hardware monitor & telemetry', view: 'monitor' },
];

export default function OverviewPanel({ onNavigate }: OverviewPanelProps) {
  const { projectPath, setProjectPath } = useStore();
  const projectName = projectPath ? projectPath.split(/[\\/]/).pop() || projectPath : null;

  return (
    <div className="flex flex-col h-full overflow-y-auto nex-scrollbar p-4 gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Home size={16} style={{ color: 'var(--nex-accent)' }} aria-hidden />
        <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
          NEX OVERVIEW
        </span>
      </div>

      {/* Current project */}
      <div
        className="nex-glass p-4 rounded-lg"
        style={{ border: '1px solid var(--nex-glass-border)' }}
      >
        <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>
          Current Project
        </p>
        {projectPath ? (
          <>
            <p className="text-sm font-medium mt-1" style={{ color: 'var(--nex-text)' }}>
              {projectName}
            </p>
            <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--nex-text-muted)' }} title={projectPath}>
              {projectPath}
            </p>
          </>
        ) : (
          <div className="mt-2">
            <p className="text-xs" style={{ color: 'var(--nex-text-muted)' }}>
              No project opened.
            </p>
            <button
              onClick={() => window.nexAPI.openFolder()}
              className="nex-click nex-focus mt-2 px-3 py-1.5 rounded-lg text-xs font-medium nex-glass-accent"
              style={{ color: 'var(--nex-accent-text)' }}
            >
              Open Project
            </button>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div>
        <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--nex-text-muted)' }}>
          Quick Actions
        </p>
        <div className="grid grid-cols-1 gap-2">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.view}
              onClick={() => onNavigate(action.view)}
              className="nex-click nex-focus nex-glass p-3 rounded-lg flex items-center gap-3 text-left transition-all hover:nex-hover-lift"
              style={{ border: '1px solid var(--nex-glass-border)' }}
            >
              <span style={{ color: 'var(--nex-accent)' }}>{action.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium" style={{ color: 'var(--nex-text)' }}>
                  {action.label}
                </p>
                <p className="text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>
                  {action.description}
                </p>
              </div>
              <ChevronRight size={12} style={{ color: 'var(--nex-text-muted)' }} aria-hidden />
            </button>
          ))}
        </div>
      </div>

      {/* Recent projects — UI-05 note: recentProjects not exposed in store;
          the persistence layer (main process) tracks them but the renderer
          doesn't currently have access. Could be wired in a future UI phase. */}
    </div>
  );
}
