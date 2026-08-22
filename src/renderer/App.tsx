import React, { useEffect, useCallback } from 'react';
import { useStore } from './store/useStore';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import EditorPanel from './components/EditorPanel';
import ChatPanel from './components/ChatPanel';
import TerminalPanel from './components/TerminalPanel';
import FileExplorer from './components/FileExplorer';
import GitPanel from './components/GitPanel';
import SearchPanel from './components/SearchPanel';
import SnippetPanel from './components/SnippetPanel';
import DiagnosticsPanel from './components/DiagnosticsPanel';
import CommandPalette from './components/CommandPalette';
import StatusBar from './components/StatusBar';
import WelcomeScreen from './components/WelcomeScreen';
import SettingsPanel from './components/SettingsPanel';

const SIDEBAR_WIDTH = 240;

function SidebarContent() {
  const { sidebarView, projectPath } = useStore();

  const panelMap: Record<string, React.ReactNode> = {
    files: projectPath ? <FileExplorer /> : null,
    search: <SearchPanel />,
    git: projectPath ? <GitPanel /> : null,
    snippets: <SnippetPanel />,
    diagnostics: projectPath ? <DiagnosticsPanel /> : null,
  };

  const content = panelMap[sidebarView];
  if (!content) return null;

  return (
    <div className="bg-nex-surface border-r border-nex-border shrink-0" style={{ width: SIDEBAR_WIDTH }}>
      {content}
    </div>
  );
}

export default function App() {
  const {
    activePanel, openFiles, activeFile, terminalVisible,
    commandPaletteOpen, toggleCommandPalette, toggleTerminal, projectPath,
    updateSettings, setAIMode, setActiveLocalModel, setLocalModels,
  } = useStore();

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
    cleanups.push(window.nexAPI.onOpenSettings(() => useStore.getState().setActivePanel('settings')));
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
        const { settings: persisted, apiKey } = await window.nexAPI.settingsLoad();
        updateSettings(persisted);
        if (apiKey) {
          updateSettings({ aiApiKey: apiKey });
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

  const hasFiles = openFiles.length > 0;

  return (
    <div className="h-screen w-screen flex flex-col bg-nex-bg text-nex-text overflow-hidden">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <SidebarContent />

        {/* Main Area */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <div className="flex-1 overflow-hidden">
            {activePanel === 'settings' && <SettingsPanel />}
            {!hasFiles && activePanel === 'chat' && !projectPath && <WelcomeScreen />}
            {hasFiles && activePanel === 'editor' && <EditorPanel />}
            {activePanel === 'chat' && (hasFiles || projectPath) && <ChatPanel />}
          </div>
          {terminalVisible && <TerminalPanel />}
        </div>
      </div>

      <StatusBar />
      {commandPaletteOpen && <CommandPalette />}
    </div>
  );
}
