import React, { useEffect, useCallback, useState } from 'react';
import { useStore } from './store/useStore';
import CommandPalette from './components/CommandPalette';
import PermissionPrompt from './components/agent/PermissionPrompt';
import AgentDiffViewer from './components/agent/AgentDiffViewer';

// UI-08: removed 15 dead legacy imports (TitleBar, Sidebar, EditorPanel,
// ChatPanel, TerminalPanel, FileExplorer, GitPanel, SearchPanel, SnippetPanel,
// DiagnosticsPanel, ModelsPanel, KnowledgePanel, HardwareMonitorPanel,
// MemoryPanel, PluginsPanel, WelcomeScreen, SettingsPanel). These were only
// imported for the legacy fallback layout which was never reached — the
// static AppShell import is always non-null, so the fallback was dead code.

// Phase 27: NEX Command Center — new AppShell with orb/rail/chat/dock.
// Phase 36 FIX: require() is undefined in Vite production browser builds.
// This caused AppShell to NEVER load (silent fallback to legacy) in production.
// Solution: use a static import (always works in both dev and production).
import AppShell from './components/layout/AppShell';

// Phase 35: ErrorBoundary — catches render errors, prevents white-screen
import NexErrorBoundary from './components/layout/NexErrorBoundary';

function App() {
  const {
    openFiles, activeFile, terminalVisible,
    commandPaletteOpen, toggleCommandPalette, toggleTerminal, projectPath,
    updateSettings, setAIMode, setActiveLocalModel, setLocalModels,
  } = useStore();

  // ── Permission Prompt state ──
  const [pendingPermission, setPendingPermission] = useState<any>(null);

  // ── Agent Diff Viewer state ──
  const [pendingDiffs, setPendingDiffs] = useState<any[]>([]);
  const [showDiffViewer, setShowDiffViewer] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  // ── Agent events for ChatPanel display ──
  const [agentEvents, setAgentEvents] = useState<any[]>([]);

  // Listen for permission requests
  useEffect(() => {
    const cleanup = window.nexAPI.onPermissionRequest((request) => {
      setPendingPermission(request);
    });
    return cleanup;
  }, []);

  // Listen for agent events (especially diff_proposed)
  useEffect(() => {
    const cleanup = window.nexAPI.onAgentEvent((event) => {
      // Keep last 50 events
      setAgentEvents((prev) => [...prev.slice(-49), event]);

      // Auto-show diff viewer when a diff is proposed
      if (event.type === 'diff_proposed') {
        setActiveTaskId(event.taskId);
        setShowDiffViewer(true);
        // Refresh diffs list
        window.nexAPI.agentListPendingDiffs(event.taskId).then((diffs) => {
          setPendingDiffs(diffs);
        }).catch(() => {});
      }
      // Auto-hide diff viewer when all are accepted/rejected
      if (event.type === 'diff_accepted' || event.type === 'diff_rejected') {
        if (activeTaskId) {
          window.nexAPI.agentListPendingDiffs(activeTaskId).then((diffs) => {
            setPendingDiffs(diffs);
            if (diffs.length === 0) {
              setShowDiffViewer(false);
            }
          }).catch(() => {});
        }
      }
    });
    return cleanup;
  }, [activeTaskId]);

  const handlePermissionRespond = (response: any) => {
    window.nexAPI.permissionRespond(response);
    setPendingPermission(null);
  };

  const handleAcceptDiff = async (changeId: string) => {
    if (!activeTaskId) return;
    await window.nexAPI.agentAcceptDiff(activeTaskId, changeId);
    const diffs = await window.nexAPI.agentListPendingDiffs(activeTaskId);
    setPendingDiffs(diffs);
    if (diffs.length === 0) setShowDiffViewer(false);
  };

  const handleRejectDiff = async (changeId: string, reason?: string) => {
    if (!activeTaskId) return;
    await window.nexAPI.agentRejectDiff(activeTaskId, changeId, reason);
    const diffs = await window.nexAPI.agentListPendingDiffs(activeTaskId);
    setPendingDiffs(diffs);
    if (diffs.length === 0) setShowDiffViewer(false);
  };

  const handleAcceptAll = async () => {
    if (!activeTaskId) return;
    await window.nexAPI.agentAcceptAllDiffs(activeTaskId);
    setPendingDiffs([]);
    setShowDiffViewer(false);
  };

  const handleRejectAll = async () => {
    if (!activeTaskId) return;
    await window.nexAPI.agentRejectAllDiffs(activeTaskId, 'Rejected all (user)');
    setPendingDiffs([]);
    setShowDiffViewer(false);
  };

  // ── Keyboard Shortcuts ──
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'p') { e.preventDefault(); toggleCommandPalette(); }
    if ((e.metaKey || e.ctrlKey) && e.key === '`') { e.preventDefault(); toggleTerminal(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (activeFile) useStore.getState().saveFile(activeFile); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'w') { e.preventDefault(); if (activeFile) useStore.getState().closeFile(activeFile); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      const projectPath = useStore.getState().projectPath;
      if (projectPath) {
        useStore.getState().setActivePanel('editor');
        window.dispatchEvent(new CustomEvent('nex-new-file', { detail: { path: projectPath } }));
      }
    }
  }, [activeFile, toggleCommandPalette, toggleTerminal]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── IPC Events + File Watcher ──
  useEffect(() => {
    const cleanups: (() => void)[] = [];
    cleanups.push(window.nexAPI.onNewTerminal(() => useStore.getState().setTerminalVisible(true)));
    cleanups.push(window.nexAPI.onKillTerminal(() => useStore.getState().setTerminalVisible(false)));
    cleanups.push(window.nexAPI.onOpenSettings(() => {
      // UI-06: dispatch nex:navigate (AppShell listens for this).
      window.dispatchEvent(new CustomEvent('nex:navigate', { detail: { view: 'settings' } }));
    }));
    cleanups.push(window.nexAPI.onFsChange((change) => console.log('File changed:', change)));
    return () => cleanups.forEach((fn) => fn());
  }, []);

  useEffect(() => {
    if (projectPath) {
      window.nexAPI.fsWatch(projectPath);
      return () => { window.nexAPI.fsUnwatch(); };
    }
  }, [projectPath]);

  // ── Phase 2: Load persisted settings on startup ──
  // Survives close, restart, crash — settings live in userData/config.json
  // and API keys live in encrypted secrets.json.
  useEffect(() => {
    (async () => {
      try {
        const { settings: persisted, apiKey, glmApiKey } = await window.nexAPI.settingsLoad();
        updateSettings(persisted);
        if (apiKey) {
          updateSettings({ aiApiKey: apiKey });
        }
        // Phase 8 / P8-A: GLM API key (encrypted at rest, same secrets store)
        if (glmApiKey !== undefined && glmApiKey !== null && glmApiKey !== '') {
          updateSettings({ glmApiKey });
        }
        if (persisted.aiMode) {
          setAIMode(persisted.aiMode);
        }
        // Load local models registry (Phase 4 will populate this)
        const all = await window.nexAPI.configGetAll();
        if (all?.localModels) {
          setLocalModels(all.localModels);
          if (persisted.activeLocalModelId) {
            setActiveLocalModel(persisted.activeLocalModelId);
          }
        }
        // Restore recent projects
        if (all?.recentProjects && !projectPath) {
          // Don't auto-open — let user pick from WelcomeScreen
        }
      } catch (err) {
        console.error('[NEX AI] Failed to load settings:', err);
      }
    })();
  }, [updateSettings, setAIMode, setActiveLocalModel, setLocalModels]);

  // UI-08: removed dead legacy layout (was lines 253-299). The static AppShell
  // import is always non-null, so the old conditional check was always true
  // and the legacy fallback branch was unreachable dead code. Now AppShell
  // is rendered directly below.

  return (
    <NexErrorBoundary>
      <AppShell />
      {commandPaletteOpen && <CommandPalette />}
      <PermissionPrompt
        request={pendingPermission}
        onRespond={handlePermissionRespond}
      />
      {showDiffViewer && pendingDiffs.length > 0 && (
        <AgentDiffViewer
          diffs={pendingDiffs}
          onAccept={handleAcceptDiff}
          onReject={handleRejectDiff}
          onAcceptAll={handleAcceptAll}
          onRejectAll={handleRejectAll}
          onClose={() => setShowDiffViewer(false)}
        />
      )}
    </NexErrorBoundary>
  );
}

export default App;
