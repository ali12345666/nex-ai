/**
 * NEX AI — Navigation Rail (Phase 27)
 *
 * Vertical glass rail with futuristic icons. Active item has cyan glow.
 * Floats with rounded corners and subtle border.
 */

import React from 'react';
import {
  Zap, Terminal, FolderOpen, Code2, Bot, Database, GitBranch,
  Wrench, Settings, Brain, BookOpen, Puzzle, Activity,
} from 'lucide-react';

export type NexView =
  | 'home' | 'terminal' | 'files' | 'code' | 'agents' | 'knowledge'
  | 'memory' | 'git' | 'tools' | 'plugins' | 'monitor' | 'settings';

interface NavItem {
  id: NexView;
  icon: React.ReactNode;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home', icon: <Zap size={20} strokeWidth={1.5} />, label: 'NEX Home' },
  { id: 'terminal', icon: <Terminal size={20} strokeWidth={1.5} />, label: 'Terminal' },
  { id: 'files', icon: <FolderOpen size={20} strokeWidth={1.5} />, label: 'Files' },
  { id: 'code', icon: <Code2 size={20} strokeWidth={1.5} />, label: 'Code' },
  { id: 'agents', icon: <Bot size={20} strokeWidth={1.5} />, label: 'Agents' },
  { id: 'knowledge', icon: <BookOpen size={20} strokeWidth={1.5} />, label: 'Knowledge' },
  { id: 'memory', icon: <Brain size={20} strokeWidth={1.5} />, label: 'Memory' },
  { id: 'git', icon: <GitBranch size={20} strokeWidth={1.5} />, label: 'Git' },
  { id: 'tools', icon: <Wrench size={20} strokeWidth={1.5} />, label: 'Tools' },
  { id: 'plugins', icon: <Puzzle size={20} strokeWidth={1.5} />, label: 'Plugins' },
  { id: 'monitor', icon: <Activity size={20} strokeWidth={1.5} />, label: 'System' },
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
