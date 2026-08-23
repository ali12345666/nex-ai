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

import React, { useState, useCallback, useEffect, useRef, Suspense, lazy } from 'react';
import NavigationRail, { type NexView } from './NavigationRail';
import BottomStatusBar from './BottomStatusBar';

// Lazy-load the orb (heavy Three.js bundle)
const NexOrb = lazy(() => import('../orb/NexOrb'));

// Phase 30: Voice — connect Orb to voice system (audio reactivity)
import { voiceController } from '../../services/voice-controller';
import type { NexOrbState } from '../orb/orb-state';
// Phase 31: Theme-aware Orb colors (resolve CSS vars → hex for Three.js)
import { getOrbColors, getCurrentTheme } from '../../lib/theme-engine';
// Phase 32: Conversation Center
const ConversationHistory = lazy(() => import('../chat/ConversationHistory'));

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
  // Phase 30: Voice state for the Orb (audio level stays in ref, NOT React state)
  const [orbState, setOrbState] = useState<NexOrbState>('idle');
  // Phase 31: theme-aware orb colors (re-resolved on theme change)
  const [orbColors, setOrbColors] = useState(() => getOrbColors());
  const orbAudioRef = useRef<number>(0);
  const [voiceActive, setVoiceActive] = useState(false);
  // Phase 32: Conversation state
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Phase 32: Conversation events
  const handleConversationSelect = useCallback((id: string) => {
    setActiveConversationId(id);
    window.dispatchEvent(new CustomEvent('nex:load-conversation', { detail: { id } }));
  }, []);
  const handleConversationNew = useCallback(() => {
    setActiveConversationId(null);
    window.dispatchEvent(new CustomEvent('nex:new-conversation'));
  }, []);
  const handleConversationDelete = useCallback(async (id: string) => {
    await window.nexAPI.conversationDelete(id).catch(() => {});
    if (id === activeConversationId) handleConversationNew();
  }, [activeConversationId, handleConversationNew]);
  const handleConversationRename = useCallback(async (id: string, title: string) => {
    await window.nexAPI.conversationRename(id, title).catch(() => {});
  }, []);
  const [partialTranscript, setPartialTranscript] = useState<string | null>(null);
  const orbAudioSubRef = useRef<(() => void) | null>(null);
  const orbStateSubRef = useRef<(() => void) | null>(null);
  const { projectPath } = useStore();

  const navigate = useCallback((v: NexView) => setView(v), []);

  // Phase 31: Watch for theme changes → re-resolve orb colors
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setOrbColors(getOrbColors());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  // Phase 30: Voice → Orb wiring (state + audio level via refs, not React state for audio)
  useEffect(() => {
    // Subscribe to orb state changes
    const unsubState = voiceController.subscribeOrbState((state) => {
      setOrbState(state);
    });
    // Subscribe to audio level (stored in ref — Orb reads it via useFrame)
    const unsubAudio = voiceController.subscribeOrbAudio((level) => {
      orbAudioRef.current = level;
    });
    // Set callbacks for chat integration
    voiceController.setCallbacks({
      onPartialTranscript: (text) => setPartialTranscript(text),
      onFinalTranscript: (text) => {
        setPartialTranscript(null);
        // Final transcript goes to chat via a custom event (ChatPanel listens)
        window.dispatchEvent(new CustomEvent('nex:voice-transcript', { detail: { text } }));
      },
      onVoiceError: () => setPartialTranscript(null),
    });
    orbStateSubRef.current = unsubState;
    orbAudioSubRef.current = unsubAudio;
    return () => {
      unsubState();
      unsubAudio();
      voiceController.setCallbacks({});
      orbStateSubRef.current = null;
      orbAudioSubRef.current = null;
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => { voiceController.dispose(); };
  }, []);

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
                state={orbState}
                audioLevel={orbAudioRef.current}
                primaryColor={orbColors.primary}
                secondaryColor={orbColors.secondary}
                quality="high"
                className="w-full h-full"
              />
              {/* Phase 30: Voice transcript display */}
              {partialTranscript && (
                <div
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 nex-glass px-3 py-1.5 rounded-full text-[10px] max-w-[70%] truncate nex-animate-in"
                  style={{ color: 'var(--nex-accent-text)' }}
                  aria-live="polite"
                >
                  "{partialTranscript}"
                </div>
              )}
              {/* Phase 30: Voice toggle (subtle indicator, not a big button) */}
              <button
                onClick={() => { voiceController.toggle(); setVoiceActive(!voiceActive); }}
                className="absolute bottom-4 right-4 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-medium nex-glass nex-click transition-all"
                style={{
                  color: voiceActive ? 'var(--nex-accent)' : 'var(--nex-text-muted)',
                  border: voiceActive ? '1px solid var(--nex-accent-glow)' : '1px solid var(--nex-glass-border)',
                }}
                aria-label={voiceActive ? 'Stop voice input' : 'Start voice input'}
                title={voiceActive ? 'Voice active — click to stop' : 'Click to start voice'}
              >
                <span
                  className={voiceActive ? 'inline-block w-1.5 h-1.5 rounded-full animate-pulse' : 'inline-block w-1.5 h-1.5 rounded-full'}
                  style={{ background: voiceActive ? 'var(--nex-accent)' : 'var(--nex-text-muted)' }}
                />
                {voiceActive ? 'LISTENING' : 'VOICE'}
              </button>
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
            <div className="flex items-center gap-2 relative">
              {/* Phase 32: History button */}
              <button
                onClick={() => setHistoryOpen(!historyOpen)}
                className="p-1 rounded transition-colors hover:bg-white/[0.06]"
                style={{ color: historyOpen ? 'var(--nex-accent)' : 'var(--nex-text-muted)' }}
                title="Conversation history"
                aria-label="Conversation history"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 8v4l3 3"/>
                  <circle cx="12" cy="12" r="10"/>
                </svg>
              </button>
              {historyOpen && (
                <Suspense fallback={null}>
                  <ConversationHistory
                    activeId={activeConversationId}
                    onSelect={handleConversationSelect}
                    onNew={handleConversationNew}
                    onDelete={handleConversationDelete}
                    onRename={handleConversationRename}
                    onClose={() => setHistoryOpen(false)}
                  />
                </Suspense>
              )}
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
