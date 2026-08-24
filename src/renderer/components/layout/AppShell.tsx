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
// UI-15: Workspace panel (consolidates Editor/Terminal/Preview/Files/Logs into tabs)
const WorkspacePanel = lazy(() => import('./WorkspacePanel'));
const KnowledgePanel = lazy(() => import('../KnowledgePanel'));
const MemoryPanel = lazy(() => import('../MemoryPanel'));
const SettingsPanel = lazy(() => import('../SettingsPanel'));

import { useStore } from '../../store/useStore';

export default function AppShell() {
  const [view, setView] = useState<NexView>('chat');
  // Phase 30: Voice state for the Orb (audio level stays in ref, NOT React state)
  const [orbState, setOrbState] = useState<NexOrbState>('idle');
  // Phase 31: theme-aware orb colors (re-resolved on theme change)
  const [orbColors, setOrbColors] = useState(() => getOrbColors());
  const orbAudioRef = useRef<number>(0);
  // UI-14 §3: voiceActive state removed — voice is now Always-Ready.
  // No toggle button, auto-starts on app boot, auto-restarts after commands.
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
  // UI-04: EditorPanel now lives inside WorkspacePanel (UI-15 consolidation).
  // AppShell no longer needs activeFile/closeFile — Workspace handles it.
  const { projectPath } = useStore();

  const navigate = useCallback((v: NexView) => setView(v), []);

  // UI-06: Listen for nex:navigate CustomEvent from CommandPalette.
  // Replaces the dead setActivePanel/setSidebarView store calls that AppShell
  // never read — 9 of 12 commands were silent no-ops before this fix.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { view: NexView } | undefined;
      if (detail?.view) {
        setView(detail.view);
      }
    };
    window.addEventListener('nex:navigate', handler);
    return () => window.removeEventListener('nex:navigate', handler);
  }, []);

  // UI-06: Listen for nex:focus-chat — focuses the always-visible chat input.
  // Dispatched by CommandPalette's 'AI Chat' command.
  useEffect(() => {
    const handler = () => {
      // Re-dispatch so NexChatPanel (which is lazy-loaded) can listen.
      // Use a second event so we don't couple AppShell to chat internals.
      window.dispatchEvent(new CustomEvent('nex:focus-chat-input'));
    };
    window.addEventListener('nex:focus-chat', handler);
    return () => window.removeEventListener('nex:focus-chat', handler);
  }, []);

  // Phase 34: Ctrl+K → open history + focus search
  useEffect(() => {
    const handler = () => {
      setHistoryOpen(true);
      // ConversationHistory listens for this to focus its search input
      window.dispatchEvent(new CustomEvent('nex:focus-history-search'));
    };
    window.addEventListener('nex:open-history-search', handler);
    return () => window.removeEventListener('nex:open-history-search', handler);
  }, []);

  // UI-15: Escape editor handler removed — EditorPanel now lives in WorkspacePanel
  // which handles its own keyboard shortcuts internally.

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
  // UI-14 §3: Voice is Always-Ready — auto-starts on app boot (no toggle button).
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

    // UI-14 §3: Always-Ready Voice — auto-start listening on app boot.
    // VoiceController.start() enables microphone + STT. If permission not
    // granted yet, browser will prompt. After each command completes,
    // VoiceService auto-restarts STT (via _shouldRestartSTT flag).
    voiceController.start().catch(() => {
      // Permission denied or mic unavailable — orb stays idle, chat still works via keyboard.
    });

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
  // UI-15: Consolidated to 5 views — Chat, Workspace, Memory, Knowledge, Settings.
  // All other panels (Git/Diagnostics/Plugins/Hardware/Agents/Tools) accessible
  // via Settings or Workspace tabs (no separate nav items).
  const leftPanel = () => {
    switch (view) {
      case 'chat': return null; // Chat is rendered as the right panel
      case 'workspace': return <Suspense fallback={<PanelLoading />}><WorkspacePanel /></Suspense>;
      case 'knowledge': return <Suspense fallback={<PanelLoading />}><KnowledgePanel /></Suspense>;
      case 'memory': return <Suspense fallback={<PanelLoading />}><MemoryPanel /></Suspense>;
      case 'settings': return <Suspense fallback={<PanelLoading />}><SettingsPanel /></Suspense>;
      default: return <NoProject />;
    }
  };

  // UI-15 §2: When view === 'chat', the left workspace area shows the orb
  // (not a panel). When view !== 'chat', the orb is hidden and the selected
  // panel fills the center. Chat panel stays on the right always.
  const showOrb = view === 'chat';

  return (
    <div
      className="nex-cosmic-bg nex-stars flex flex-col h-screen w-screen overflow-hidden"
      style={{ background: 'var(--nex-bg)', color: 'var(--nex-text)' }}
    >
      {/* Main row: Nav + Workspace + Orb + Chat */}
      <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>

        {/* Left: Navigation Rail */}
        <NavigationRail active={view} onNavigate={navigate} />

      {/* Main row: Nav + Center + Chat
          UI-15 BUGFIX: Removed the separate 300px left workspace panel div that
          was causing DOUBLE PANEL RENDERING. Previously leftPanel() was called
          both in the left workspace div AND in the center area, rendering two
          instances of the same panel. Now there is ONE source of truth:
          the center area renders either the Orb (chat view) or the active panel
          (non-chat views). No duplicate rendering. */}

        {/* Center: Orb (ALWAYS visible) + floating panel overlay (when non-chat view).
            UI-16: Orb is persistent — panels float as overlays, never cover Orb fully.
            Layout: [ floating panel | ORB ] within center area. */}
        <div
          className="flex-1 flex items-center justify-center relative overflow-hidden"
          style={{ minWidth: 0 }}
        >
          {/* Orb is ALWAYS rendered — persistent center visual.
              When a panel is open, Orb shrinks to make room but stays visible. */}
          <div
            className="flex flex-col items-center justify-center relative shrink-0"
            style={{
              width: showOrb ? 'min(72vh, 48vw)' : 'min(42vh, 28vw)',
              height: showOrb ? 'min(72vh, 48vw)' : 'min(42vh, 28vw)',
              minHeight: showOrb ? 280 : 200,
              minWidth: showOrb ? 280 : 200,
              transition: 'width 0.3s ease, height 0.3s ease',
            }}
          >
            {/* UI-16 §13: Orb header — ONLY "NEX AI", minimal, no subtitle */}
            {showOrb && (
              <div className="mb-2 select-none pointer-events-none">
                <div
                  className="text-sm font-medium tracking-[0.3em]"
                  style={{ color: 'var(--nex-text)' }}
                  aria-label="NEX AI"
                >
                  NEX AI
                </div>
              </div>
            )}

            <Suspense fallback={<OrbLoading />}>
              <NexOrb
                state={orbState}
                audioLevelRef={orbAudioRef}
                primaryColor={orbColors.primary}
                secondaryColor={orbColors.secondary}
                quality="high"
                className="w-full h-full"
              />
              {partialTranscript && (
                <div
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 nex-glass px-3 py-1.5 rounded-full text-[10px] max-w-[70%] truncate nex-animate-in"
                  style={{ color: 'var(--nex-accent-text)' }}
                  aria-live="polite"
                >
                  "{partialTranscript}"
                </div>
              )}
            </Suspense>
          </div>

          {/* UI-16: Floating panel overlay — when non-chat view, panel renders
              as a floating panel BESIDE the Orb (not covering it).
              Panel takes ~55% of center width, Orb takes ~45%. */}
          {!showOrb && leftPanel() && (
            <div
              className="nex-glass-strong flex flex-col overflow-hidden nex-animate-in shrink-0"
              style={{
                width: 'min(480px, 55%)',
                maxWidth: '55%',
                height: 'calc(100% - 16px)',
                borderRadius: 'var(--nex-radius-lg)',
                margin: '8px',
                border: '1px solid var(--nex-panel-border)',
              }}
            >
              {leftPanel()}
            </div>
          )}
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

// UI-05: WorkspacePanel placeholder function removed — all 12 nav items
// now route to real panels (OverviewPanel, AgentsPanel, ToolsPanel, GitPanel).
// The fake "Panel integrates with existing backend" placeholder is gone.
