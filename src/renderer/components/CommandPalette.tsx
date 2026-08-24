import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import {
  Search,
  FileCode,
  Terminal,
  Settings,
  FolderOpen,
  Save,
  Sparkles,
  Type,
  X,
  BookOpen,
  Brain,
} from 'lucide-react';
import type { NexView } from './layout/NavigationRail';

interface Command {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
  category: string;
}

/**
 * UI-06: dispatch a `nex:navigate` CustomEvent that AppShell listens for.
 * Replaces the dead setActivePanel/setSidebarView store calls that AppShell
 * never read — 9 of 12 commands were silent no-ops before this fix.
 */
function navigateTo(view: NexView): void {
  window.dispatchEvent(new CustomEvent('nex:navigate', { detail: { view } }));
}

/** UI-06: focus the always-visible chat input (replaces dead 'open-chat'). */
function focusChat(): void {
  window.dispatchEvent(new CustomEvent('nex:focus-chat'));
}

export default function CommandPalette() {
  const {
    toggleCommandPalette,
    saveFile,
    activeFile,
    updateSettings,
    setProjectPath,
  } = useStore();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = [
    {
      id: 'open-folder',
      label: 'Open Folder',
      description: 'Open a project folder',
      icon: <FolderOpen size={16} />,
      category: 'File',
      action: async () => {
        const result = await window.nexAPI.openFolder();
        if (!result.canceled && result.path) {
          setProjectPath(result.path);
        }
        toggleCommandPalette();
      },
    },
    {
      id: 'save-file',
      label: 'Save File',
      description: 'Save the current file',
      icon: <Save size={16} />,
      category: 'File',
      action: () => {
        if (activeFile) saveFile(activeFile);
        toggleCommandPalette();
      },
    },
    {
      id: 'open-workspace',
      label: 'Workspace',
      description: 'Open editor, terminal, files, preview, logs',
      icon: <Terminal size={16} />,
      category: 'View',
      action: () => {
        navigateTo('workspace');
        toggleCommandPalette();
      },
    },
    {
      id: 'open-chat',
      label: 'AI Chat',
      description: 'Focus the AI assistant chat input',
      icon: <Sparkles size={16} />,
      category: 'View',
      action: () => {
        focusChat();
        toggleCommandPalette();
      },
    },
    {
      id: 'open-settings',
      label: 'Settings',
      description: 'Open application settings',
      icon: <Settings size={16} />,
      category: 'Preferences',
      action: () => {
        navigateTo('settings');
        toggleCommandPalette();
      },
    },
    // UI-15: Consolidated navigation commands (5 main views only)
    {
      id: 'view-knowledge',
      label: 'Knowledge Base',
      description: 'Open the local knowledge/RAG panel',
      icon: <BookOpen size={16} />,
      category: 'View',
      action: () => {
        navigateTo('knowledge');
        toggleCommandPalette();
      },
    },
    {
      id: 'view-memory',
      label: 'Memory',
      description: 'Browse the 5-store agent memory',
      icon: <Brain size={16} />,
      category: 'View',
      action: () => {
        navigateTo('memory');
        toggleCommandPalette();
      },
    },
    {
      id: 'increase-font',
      label: 'Increase Font Size',
      description: 'Make text larger',
      icon: <Type size={16} />,
      category: 'View',
      action: () => {
        updateSettings({ fontSize: useStore.getState().settings.fontSize + 1 });
        toggleCommandPalette();
      },
    },
    {
      id: 'decrease-font',
      label: 'Decrease Font Size',
      description: 'Make text smaller',
      icon: <Type size={16} />,
      category: 'View',
      action: () => {
        updateSettings({ fontSize: Math.max(10, useStore.getState().settings.fontSize - 1) });
        toggleCommandPalette();
      },
    },
  ];

  const filtered = commands.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(query.toLowerCase()) ||
      cmd.description.toLowerCase().includes(query.toLowerCase()) ||
      cmd.category.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const executeCommand = useCallback(
    (cmd: Command) => {
      cmd.action();
    },
    []
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      toggleCommandPalette();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        executeCommand(filtered[selectedIndex]);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm animate-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) toggleCommandPalette();
      }}
    >
      <div className="w-full max-w-[560px] mx-4 bg-[var(--nex-panel-solid)] border border-[var(--nex-glass-border)] rounded-xl shadow-2xl overflow-hidden animate-in nex-glow-sm">
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--nex-glass-border)]">
          <Search size={18} className="text-[var(--nex-text-dim)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-sm text-[var(--nex-text)] placeholder-[var(--nex-text-muted)] outline-none"
          />
          <button
            onClick={toggleCommandPalette}
            className="text-[var(--nex-text-dim)] hover:text-[var(--nex-text)] transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--nex-text-muted)]">
              No commands found
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === selectedIndex
                    ? 'bg-[var(--nex-accent-dim)] text-[var(--nex-text)]'
                    : 'text-[var(--nex-text-dim)] hover:bg-white/[0.04] hover:text-[var(--nex-text)]'
                }`}
                onClick={() => executeCommand(cmd)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className={i === selectedIndex ? 'text-[var(--nex-accent)]' : 'text-[var(--nex-text-muted)]'}>
                  {cmd.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{cmd.label}</div>
                  <div className="text-xs text-[var(--nex-text-muted)] truncate">{cmd.description}</div>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--nex-glass-bg)] text-[var(--nex-text-muted)] shrink-0">
                  {cmd.category}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-[var(--nex-glass-border)] text-[10px] text-[var(--nex-text-muted)]">
          <span>
            <kbd className="px-1 py-0.5 bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)] rounded">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)] rounded">↵</kbd> select
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)] rounded">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
