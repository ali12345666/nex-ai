import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import {
  Search,
  FileCode,
  Terminal,
  Settings,
  FolderOpen,
  Save,
  Copy,
  Sparkles,
  Moon,
  Type,
  X,
} from 'lucide-react';

interface Command {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
  category: string;
}

export default function CommandPalette() {
  const {
    toggleCommandPalette,
    setActivePanel,
    setTerminalVisible,
    toggleTerminal,
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
      id: 'toggle-terminal',
      label: 'Toggle Terminal',
      description: 'Show or hide the integrated terminal',
      icon: <Terminal size={16} />,
      category: 'View',
      action: () => {
        toggleTerminal();
        toggleCommandPalette();
      },
    },
    {
      id: 'open-chat',
      label: 'AI Chat',
      description: 'Open the AI assistant chat',
      icon: <Sparkles size={16} />,
      category: 'View',
      action: () => {
        setActivePanel('chat');
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
        setActivePanel('settings');
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
      <div className="w-full max-w-[560px] mx-4 bg-nex-surface border border-nex-border rounded-xl shadow-2xl overflow-hidden animate-in glow-accent">
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-nex-border">
          <Search size={18} className="text-nex-text-dim shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-sm text-nex-text placeholder-nex-text-muted outline-none"
          />
          <button
            onClick={toggleCommandPalette}
            className="text-nex-text-dim hover:text-nex-text transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-nex-text-muted">
              No commands found
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === selectedIndex
                    ? 'bg-nex-accent/10 text-nex-text'
                    : 'text-nex-text-dim hover:bg-nex-card hover:text-nex-text'
                }`}
                onClick={() => executeCommand(cmd)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className={i === selectedIndex ? 'text-nex-accent' : 'text-nex-text-muted'}>
                  {cmd.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{cmd.label}</div>
                  <div className="text-xs text-nex-text-muted truncate">{cmd.description}</div>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-nex-card text-nex-text-muted shrink-0">
                  {cmd.category}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-nex-border text-[10px] text-nex-text-muted">
          <span>
            <kbd className="px-1 py-0.5 bg-nex-card border border-nex-border rounded">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-nex-card border border-nex-border rounded">↵</kbd> select
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-nex-card border border-nex-border rounded">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
