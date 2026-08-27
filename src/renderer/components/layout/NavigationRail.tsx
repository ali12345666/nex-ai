/**
 * NEX AI — Navigation Rail (Phase 66 consolidation)
 *
 * Cleaned up navigation: consolidated 17 items into 8 clean items.
 *
 * Removed/merged into Library:
 *   - advisor → Library > Recommended
 *   - runtime → Library > Tools
 *   - expertise → Library > Knowledge
 *   - voice → Library > Voice
 *   - localai → Library > Installed
 *   - ecosystem → Library > Models
 *   - uknowledge → Library > Knowledge
 *   - deploy → Library > Downloads
 *   - firstrun → Library > Recommended
 *   - hwvalid → Validation
 *   - interact → Interact
 *   - knowledge → Library > Knowledge (project knowledge kept separate for now)
 *
 * Kept separate:
 *   - chat → Chat (primary)
 *   - workspace → Workspace (terminal/editor/files)
 *   - memory → Memory (semantic memory)
 *   - planner → Planner (executive planner)
 *   - library → Library (ALL resources: models/voice/tools/knowledge/downloads)
 *   - interact → Interact (basic interaction test)
 *   - validation → Validation (hardware diagnostics)
 *   - settings → Settings
 */
import React from 'react';
import {
  MessageSquare, LayoutGrid, Brain, Library, Settings, Network, Activity, Gauge, Mic,
} from 'lucide-react';

export type NexView = 'chat' | 'workspace' | 'memory' | 'library' | 'planner' | 'interact' | 'validation' | 'settings' | 'voice';

/** Workspace sub-tabs — accessible when view === 'workspace'. */
export type WorkspaceTab = 'editor' | 'terminal' | 'preview' | 'files' | 'logs';

interface NavItem {
  id: NexView;
  icon: React.ReactNode;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'chat',       icon: <MessageSquare size={20} strokeWidth={1.5} />, label: 'Chat' },
  { id: 'workspace',  icon: <LayoutGrid size={20} strokeWidth={1.5} />,   label: 'Workspace' },
  { id: 'library',    icon: <Library size={20} strokeWidth={1.5} />,      label: 'Library' },
  { id: 'voice',      icon: <Mic size={20} strokeWidth={1.5} />,          label: 'Voice' },
  { id: 'planner',    icon: <Network size={20} strokeWidth={1.5} />,      label: 'Planner' },
  { id: 'interact',   icon: <Activity size={20} strokeWidth={1.5} />,     label: 'Interact' },
  { id: 'validation', icon: <Gauge size={20} strokeWidth={1.5} />,        label: 'Validation' },
  { id: 'memory',     icon: <Brain size={20} strokeWidth={1.5} />,        label: 'Memory' },
  { id: 'settings',   icon: <Settings size={20} strokeWidth={1.5} />,     label: 'Settings' },
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
