/**
 * NEX AI — App Shell (Phase 27)
 *
 * Futuristic command-center layout:
 *   ┌─────────────────────────────────────────────────────┐
 *   │ NAV │ Terminal/Project │   NEX AI ORB   │  AI CHAT  │
 *   │     │                  │                │           │
 *   ├─────────────────────────────────────────────────────┤
 *   │              BOTTOM STATUS DOCK                     │
 *   └─────────────────────────────────────────────────────┘
 *
 * Orb is the visual heart — always center, always alive.
 * Chat is floating glass panel on the right.
 * Left workspace shows terminal + project explorer.
 * All panels use the token system from styles/tokens.css.
 */

import React, { useState, useCallback, Suspense, lazy } from 'react';
import NavigationRail, { type NexView } from './NavigationRail';
import BottomStatusBar from './BottomStatusBar';

// Lazy-load the orb (heavy Three.js bundle)
const NexOrb = lazy(() => import('../orb/NexOrb'));

// Lazy-load chat panel (uses existing ChatPanel but wrapped)
// Phase 29: Real chat panel using NEX token system
const NexChatPanel = lazy(() => import('../chat/NexChatPanel'));
// Phase 28: Real terminal + workspace explorer
const TerminalSessionPanel = lazy(() => import('./TerminalSessionPanel'));
const WorkspaceExplorer = lazy(() => import('./WorkspaceExplorer'));
const KnowledgePanel = lazy(() => import('../KnowledgePanel'));
const MemoryPanel = lazy(() => import('../MemoryPanel'));
const PluginsPanel = lazy(() => import('../PluginsPanel'));
const HardwareMonitorPanel = lazy(() => import('../HardwareMonitorPanel'));
const SettingsPanel = lazy(() => import('../SettingsPanel'));

import { useStore } from '../../store/useStore';

export default function AppShell() {
  const [view, setView] = useState<NexView>('home');
  const { projectPath } = useStore();

  const navigate = useCallback((v: NexView) => setView(v), []);

  // Left workspace content based on active view
  const leftPanel = () => {
    if (!projectPath && view !== 'terminal' && view !== 'settings') {
      return <NoProject />;
    }
    switch (view) {
      case 'terminal': return <Suspense fallback={<PanelLoading />}><TerminalSessionPanel /></Suspense>;
      case 'files':
      case 'code': return <Suspense fallback={<PanelLoading />}><WorkspaceExplorer /></Suspense>;
      case 'knowledge': return <Suspense fallback={<PanelLoading />}><KnowledgePanel /></Suspense>;
      case 'memory': return <Suspense fallback={<PanelLoading />}><MemoryPanel /></Suspense>;
      case 'plugins': return <Suspense fallback={<PanelLoading />}><PluginsPanel /></Suspense>;
      case 'monitor': return <Suspense fallback={<PanelLoading />}><HardwareMonitorPanel /></Suspense>;
      case 'settings': return <Suspense fallback={<PanelLoading />}><SettingsPanel /></Suspense>;
      case 'agents':
      case 'git':
      case 'tools':
      default: return <WorkspacePanel view={view} />;
    }
  };

  return (
    <div
      className="nex-cosmic-bg nex-stars flex flex-col h-screen w-screen overflow-hidden"
      style={{ background: 'var(--nex-bg)', color: 'var(--nex-text)' }}
    >
      {/* Main row: Nav + Workspace + Orb + Chat */}
      <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>

        {/* Left: Navigation Rail */}
        <NavigationRail active={view} onNavigate={navigate} />

        {/* Left Workspace (Terminal / Project Explorer / Panels) */}
        <div
          className="nex-glass flex flex-col overflow-hidden"
          style={{
            width: 300,
            minWidth: 260,
            borderRadius: 'var(--nex-radius-lg)',
            margin: '8px 4px',
          }}
        >
          <div className="flex-1 overflow-hidden">{leftPanel()}</div>
        </div>

        {/* Center: NEX AI Orb */}
        <div
          className="flex-1 flex flex-col items-center justify-center relative"
          style={{ minWidth: 0 }}
        >
          {/* Branding above orb */}
          <div className="flex flex-col items-center gap-1 mb-8 select-none pointer-events-none">
            <div className="nex-brand-title text-4xl sm:text-5xl lg:text-6xl" aria-label="NEX">
              N E X
            </div>
            <div className="nex-brand-subtitle" aria-label="AI Assistant">
              AI ASSISTANT
            </div>
          </div>

          {/* Orb container */}
          <div
            className="relative"
            style={{
              width: 'min(42vh, 38vw)',
              height: 'min(42vh, 38vw)',
              minHeight: 220,
              minWidth: 220,
            }}
          >
            <Suspense fallback={<OrbLoading />}>
              <NexOrb
                state="idle"
                audioLevel={0}
                primaryColor="var(--nex-orb-primary)"
                secondaryColor="var(--nex-orb-secondary)"
                quality="high"
                className="w-full h-full"
              />
            </Suspense>
          </div>
        </div>

        {/* Right: AI Chat Panel */}
        <div
          className="nex-glass-accent nex-hover-lift flex flex-col overflow-hidden"
          style={{
            width: 360,
            minWidth: 320,
            maxWidth: 420,
            borderRadius: 'var(--nex-radius-lg)',
            margin: '8px 8px 8px 4px',
            border: '1px solid var(--nex-panel-border)',
          }}
        >
          {/* Chat Header */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            style={{ borderBottom: '1px solid var(--nex-glass-border)' }}
          >
            <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
              NEX AI CHAT
            </span>
            <div className="flex items-center gap-1">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full nex-animate-pulse"
                style={{ background: 'var(--nex-success)' }}
                title="Ready"
              />
            </div>
          </div>

          {/* Chat Body */}
          <div className="flex-1 overflow-hidden">
            <Suspense fallback={<PanelLoading />}>
              <NexChatPanel />
            </Suspense>
          </div>
        </div>
      </div>

      {/* Bottom: Status Dock */}
      <BottomStatusBar />
    </div>
  );
}

// ─── Helper components ──────────────────────────────────────────────────────

function PanelLoading() {
  return (
    <div className="flex items-center justify-center h-full">
      <div
        className="w-6 h-6 rounded-full border-2 border-transparent animate-spin"
        style={{ borderTopColor: 'var(--nex-accent)', borderRightColor: 'var(--nex-accent-dim)' }}
      />
    </div>
  );
}

function OrbLoading() {
  return (
    <div className="flex items-center justify-center w-full h-full">
      <div
        className="w-16 h-16 rounded-full nex-animate-breathe"
        style={{
          background: 'radial-gradient(circle at 40% 40%, var(--nex-accent-dim) 0%, transparent 70%)',
          boxShadow: '0 0 30px var(--nex-accent-glow)',
        }}
      />
    </div>
  );
}

function NoProject() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
      <div
        className="flex items-center justify-center w-12 h-12 rounded-full"
        style={{ background: 'var(--nex-accent-dim)', border: '1px solid var(--nex-panel-border)' }}
      >
        <span className="text-lg" style={{ color: 'var(--nex-accent)' }}>NX</span>
      </div>
      <p className="text-xs" style={{ color: 'var(--nex-text-muted)' }}>
        Open a project to get started
      </p>
      <button
        className="nex-click nex-focus px-3 py-1.5 rounded-lg text-xs font-medium nex-glass-accent"
        style={{ color: 'var(--nex-accent-text)' }}
        onClick={() => window.nexAPI.openFolder()}
      >
        Open Project
      </button>
    </div>
  );
}

function WorkspacePanel({ view }: { view: NexView }) {
  const labels: Record<string, string> = {
    agents: 'Agent Tasks', git: 'Source Control', tools: 'Tool Manager',
    home: 'Overview', code: 'Code Editor',
  };
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <div
        className="flex items-center justify-center w-14 h-14 rounded-full nex-glass-accent"
        style={{ border: '1px solid var(--nex-panel-border)' }}
      >
        <span className="text-lg" style={{ color: 'var(--nex-accent)' }}>NX</span>
      </div>
      <p className="text-sm font-medium" style={{ color: 'var(--nex-text-dim)' }}>
        {labels[view] || view}
      </p>
      <p className="text-xs" style={{ color: 'var(--nex-text-muted)' }}>
        Panel integrates with existing backend
      </p>
    </div>
  );
}
