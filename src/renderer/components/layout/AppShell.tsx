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
// UI-04: EditorPanel — lazy-loaded, rendered as floating overlay when a file is opened
const EditorPanel = lazy(() => import('../EditorPanel'));
// UI-05: previously-dead nav items now wired to real panels.
const GitPanel = lazy(() => import('../GitPanel'));
const AgentsPanel = lazy(() => import('./AgentsPanel'));
const ToolsPanel = lazy(() => import('./ToolsPanel'));
const OverviewPanel = lazy(() => import('./OverviewPanel'));

import { useStore } from '../../store/useStore';

export default function AppShell() {
  const [view, setView] = useState<NexView>('home');
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
  // UI-04: read openFiles/activeFile/closeFile from store so clicking a file
  // in WorkspaceExplorer actually displays the editor (was previously a
  // silent no-op — openFile() set activePanel='editor' but AppShell never
  // rendered EditorPanel).
  const { projectPath, activeFile, closeFile } = useStore();

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

  // UI-04: Escape key closes the editor overlay (returns to Orb view).
  // Improves UX — no need to click the small X button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeFile && !historyOpen) {
        // Don't intercept if user is typing in an input/textarea
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
        closeFile(activeFile);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeFile, closeFile, historyOpen]);

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
  const leftPanel = () => {
    if (!projectPath && view !== 'terminal' && view !== 'settings' && view !== 'home') {
      return <NoProject />;
    }
    switch (view) {
      case 'home': return <Suspense fallback={<PanelLoading />}><OverviewPanel onNavigate={navigate as any} /></Suspense>;
      case 'terminal': return <Suspense fallback={<PanelLoading />}><TerminalSessionPanel /></Suspense>;
      case 'files':
      case 'code': return <Suspense fallback={<PanelLoading />}><WorkspaceExplorer /></Suspense>;
      case 'agents': return <Suspense fallback={<PanelLoading />}><AgentsPanel /></Suspense>;
      case 'tools': return <Suspense fallback={<PanelLoading />}><ToolsPanel /></Suspense>;
      case 'git': return <Suspense fallback={<PanelLoading />}><GitPanel /></Suspense>;
      case 'knowledge': return <Suspense fallback={<PanelLoading />}><KnowledgePanel /></Suspense>;
      case 'memory': return <Suspense fallback={<PanelLoading />}><MemoryPanel /></Suspense>;
      case 'plugins': return <Suspense fallback={<PanelLoading />}><PluginsPanel /></Suspense>;
      case 'monitor': return <Suspense fallback={<PanelLoading />}><HardwareMonitorPanel /></Suspense>;
      case 'settings': return <Suspense fallback={<PanelLoading />}><SettingsPanel /></Suspense>;
      default: return <NoProject />;
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

        {/* Center: NEX AI Orb (or EditorPanel overlay when a file is open) */}
        <div
          className="flex-1 flex flex-col items-center justify-center relative"
          style={{ minWidth: 0 }}
        >
          {/* UI-04: EditorPanel overlay — shown when a file is open, hides the
              Orb + branding. Closing all files returns to the Orb view.
              EditorPanel reads openFiles/activeFile directly from the store. */}
          {activeFile ? (
            <div
              className="absolute inset-0 nex-glass-strong flex flex-col overflow-hidden nex-animate-in"
              style={{
                borderRadius: 'var(--nex-radius-lg)',
                margin: '8px 4px',
                border: '1px solid var(--nex-panel-border)',
              }}
            >
              {/* Editor header with close button */}
              <div
                className="flex items-center justify-between px-3 py-2 shrink-0"
                style={{ borderBottom: '1px solid var(--nex-glass-border)' }}
              >
                <span
                  className="text-[10px] font-medium tracking-wider truncate"
                  style={{ color: 'var(--nex-accent-text)' }}
                  title={activeFile}
                >
                  {activeFile.split(/[\\/]/).pop() || activeFile}
                </span>
                <button
                  onClick={() => closeFile(activeFile)}
                  className="nex-click nex-focus p-1 rounded transition-colors hover:bg-white/[0.06]"
                  style={{ color: 'var(--nex-text-muted)' }}
                  aria-label="Close editor and return to Orb"
                  title="Close editor (Esc)"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {/* Editor body */}
              <div className="flex-1 overflow-hidden">
                <Suspense fallback={<PanelLoading />}>
                  <EditorPanel />
                </Suspense>
              </div>
            </div>
          ) : (
            <>
              {/* UI-14 §2: Compact header — was text-4xl/5xl/6xl + mb-8 (huge).
                  Now text-base/sm + mb-2 (minimal). Subtitle is subtle one-liner.
                  "NEX AI / Local Intelligence • Always Ready" per directive. */}
              <div className="flex flex-col items-center gap-0.5 mb-2 select-none pointer-events-none">
                <div className="nex-brand-title text-base sm:text-lg font-medium tracking-[0.3em]" aria-label="NEX AI" style={{ color: 'var(--nex-text)' }}>
                  NEX AI
                </div>
                <div className="nex-brand-subtitle text-[9px] sm:text-[10px] tracking-wider opacity-60" aria-label="Local Intelligence, Always Ready">
                  LOCAL INTELLIGENCE • ALWAYS READY
                </div>
              </div>

              {/* Orb container
                  UI-13: orb size increased ~2x (was min(42vh, 38vw) → now min(72vh, 48vw)).
                  UI-14: mb reduced from 8 to 2 (header is now compact, more room for orb).
                  Responsive: on 1080p → ~778px, 1440p → ~1037px, 1280x720 → ~518px.
                  Caps ensure it never overflows horizontally (48vw < available center
                  width on standard layouts) and stays within viewport height (72vh
                  leaves room for branding + status bar). */}
              <div
                className="relative"
                style={{
                  width: 'min(72vh, 48vw)',
                  height: 'min(72vh, 48vw)',
                  minHeight: 280,
                  minWidth: 280,
                }}
              >
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
                  {/* UI-14 §3: Voice toggle button REMOVED.
                      Voice is now Always-Ready — auto-starts on app boot,
                      auto-restarts after each command, and supports interruption.
                      See AppShell useEffect for voiceController.start() call. */}
                </Suspense>
              </div>
            </>
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
