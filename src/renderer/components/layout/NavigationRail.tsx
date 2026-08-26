/**
 * NEX AI — Navigation Rail (UI-15 Consolidation)
 *
 * Minimal 5-item navigation: Chat, Workspace, Memory, Knowledge, Settings.
 * All other panels (Git, Diagnostics, Plugins, Hardware, Terminal, Editor,
 * Files, Preview, Logs, Agents, Tools) are accessible via Workspace tabs
 * or Settings — NOT as separate nav items.
 */

import React from 'react';
import {
  MessageSquare, LayoutGrid, Brain, BookOpen, Settings, Sparkles, Rocket, GraduationCap, Mic, Network, Cpu,
} from 'lucide-react';

export type NexView = 'chat' | 'workspace' | 'memory' | 'knowledge' | 'settings' | 'advisor' | 'runtime' | 'expertise' | 'voice' | 'planner' | 'localai';

/** Workspace sub-tabs — accessible when view === 'workspace'. */
export type WorkspaceTab = 'editor' | 'terminal' | 'preview' | 'files' | 'logs';

interface NavItem {
  id: NexView;
  icon: React.ReactNode;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'chat', icon: <MessageSquare size={20} strokeWidth={1.5} />, label: 'Chat' },
  { id: 'workspace', icon: <LayoutGrid size={20} strokeWidth={1.5} />, label: 'Workspace' },
  { id: 'advisor', icon: <Sparkles size={20} strokeWidth={1.5} />, label: 'Advisor' },
  { id: 'runtime', icon: <Rocket size={20} strokeWidth={1.5} />, label: 'Setup' },
  { id: 'memory', icon: <Brain size={20} strokeWidth={1.5} />, label: 'Memory' },
  { id: 'knowledge', icon: <BookOpen size={20} strokeWidth={1.5} />, label: 'Knowledge' },
  { id: 'expertise', icon: <GraduationCap size={20} strokeWidth={1.5} />, label: 'Expertise' },
  { id: 'voice', icon: <Mic size={20} strokeWidth={1.5} />, label: 'Voice' },
  { id: 'planner', icon: <Network size={20} strokeWidth={1.5} />, label: 'Planner' },
  { id: 'localai', icon: <Cpu size={20} strokeWidth={1.5} />, label: 'Local AI' },
  { id: 'settings', icon: <Settings size={20} strokeWidth={1.5} />, label: 'Settings' },
];

export interface NavigationRailProps {
  active: NexView;
  onNavigate: (view: NexView) => void;
}

export default function NavigationRail({ active, onNavigate }: NavigationRailProps) {
  return (
    <nav
      className="nex-glass-strong nex-glow-sm flex flex-col items-center gap-1 py-4 px-2 shrink-0"
      style={{
        width: 'var(--nex-nav-width)',
        borderRadius: 'var(--nex-radius-lg)',
        margin: '8px 0 8px 8px',
        zIndex: 10,
      }}
      aria-label="Main navigation"
      role="navigation"
    >
      {/* NEX Logo */}
      <div
        className="flex items-center justify-center mb-4 mt-1 select-none"
        style={{ width: 36, height: 36 }}
        aria-label="NEX AI"
      >
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: 32, height: 32,
            background: 'radial-gradient(circle at 40% 40%, var(--nex-accent) 0%, var(--nex-accent-secondary) 60%, transparent 100%)',
            boxShadow: '0 0 12px var(--nex-accent-glow)',
          }}
        >
          <span className="text-[9px] font-bold" style={{ color: 'var(--nex-bg)', letterSpacing: '0.05em' }}>NX</span>
        </div>
      </div>

      {NAV_ITEMS.map((item) => {
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`nex-click nex-focus relative flex items-center justify-center rounded-xl transition-all duration-200 ${
              isActive ? 'text-[var(--nex-accent)]' : 'text-[var(--nex-text-muted)] hover:text-[var(--nex-text-dim)]'
            }`}
            style={{
              width: 44, height: 44,
              background: isActive ? 'var(--nex-accent-dim)' : 'transparent',
              border: isActive ? '1px solid var(--nex-accent-glow)' : '1px solid transparent',
              boxShadow: isActive ? '0 0 12px var(--nex-accent-glow)' : 'none',
            }}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            title={item.label}
          >
            {item.icon}
            {isActive && (
              <span
                className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full"
                style={{ width: 2, height: 20, background: 'var(--nex-accent)' }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
