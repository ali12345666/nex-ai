import React from 'react';
import { useStore } from '../store/useStore';
import RecentProjects from './RecentProjects';
import {
  Bot,
  FolderOpen,
  FileCode,
  Terminal,
  Sparkles,
  Zap,
  Code2,
  Globe,
} from 'lucide-react';

export default function WelcomeScreen() {
  const { setProjectPath, setActivePanel } = useStore();

  const handleOpenFolder = async () => {
    const result = await window.nexAPI.openFolder();
    if (!result.canceled && result.path) {
      setProjectPath(result.path);
      // Save to recent
      (window as any).__recentProjectsAdd?.(result.path);
    }
  };

  const quickActions = [
    {
      icon: <FolderOpen size={20} />,
      label: 'Open Folder',
      description: 'Open a project folder to start working',
      action: handleOpenFolder,
      color: 'text-nex-accent',
    },
    {
      icon: <FileCode size={20} />,
      label: 'Open File',
      description: 'Open a single file for quick editing',
      action: async () => {
        const result = await window.nexAPI.openFile();
        if (!result.canceled && result.path) {
          useStore.getState().openFile(result.path);
        }
      },
      color: 'text-nex-success',
    },
    {
      icon: <Terminal size={20} />,
      label: 'New Terminal',
      description: 'Open a terminal in your home directory',
      action: () => {
        useStore.getState().setTerminalVisible(true);
      },
      color: 'text-nex-warning',
    },
  ];

  const features = [
    { icon: <Sparkles size={16} />, label: 'AI-Powered Coding' },
    { icon: <Zap size={16} />, label: 'Smart Debugging' },
    { icon: <Code2 size={16} />, label: 'All Languages' },
    { icon: <Globe size={16} />, label: 'Online & Offline' },
  ];

  return (
    <div className="h-full flex items-center justify-center bg-nex-bg">
      <div className="text-center max-w-lg animate-in">
        {/* Logo */}
        <div className="mb-8 relative inline-block">
          <div className="w-24 h-24 rounded-2xl nex-gradient flex items-center justify-center glow-accent-strong mx-auto">
            <Bot size={48} className="text-white" />
          </div>
          <div className="absolute -inset-4 rounded-3xl border border-nex-accent/10 animate-pulse" />
        </div>

        {/* Title */}
        <h1 className="text-4xl font-bold mb-2">
          <span className="nex-gradient bg-clip-text text-transparent">
            NEX AI
          </span>
        </h1>
        <p className="text-nex-text-dim text-lg mb-2">
          Advanced AI-Powered Code Assistant
        </p>
        <p className="text-nex-text-muted text-sm mb-10">
          Professional coding environment with intelligent AI assistance
        </p>

        {/* Quick Actions */}
        <div className="flex gap-3 justify-center mb-10">
          {quickActions.map((action) => (
            <button
              key={action.label}
              onClick={action.action}
              className="group flex items-center gap-3 px-5 py-3.5 bg-nex-card border border-nex-border rounded-xl hover:border-nex-accent/30 hover:glow-accent transition-all duration-200"
            >
              <div className={`${action.color} group-hover:scale-110 transition-transform`}>
                {action.icon}
              </div>
              <div className="text-left">
                <div className="text-sm font-medium text-nex-text">{action.label}</div>
                <div className="text-xs text-nex-text-muted">{action.description}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Feature Tags */}
        <div className="flex gap-3 justify-center">
          {features.map((feat) => (
            <div
              key={feat.label}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-nex-surface border border-nex-border rounded-full text-xs text-nex-text-dim"
            >
              {feat.icon}
              {feat.label}
            </div>
          ))}
        </div>

        {/* Recent Projects */}
        <RecentProjects />

        {/* Keyboard Shortcuts */}
        <div className="mt-10 text-xs text-nex-text-muted">
          <span className="opacity-60">Press </span>
          <kbd className="px-1.5 py-0.5 bg-nex-card border border-nex-border rounded text-nex-text-dim font-mono">
            Ctrl+P
          </kbd>
          <span className="opacity-60"> for Command Palette</span>
        </div>
      </div>
    </div>
  );
}
