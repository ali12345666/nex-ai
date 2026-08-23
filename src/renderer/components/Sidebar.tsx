import React from 'react';
import { useStore, type SidebarView } from '../store/useStore';
import {
  Files, Search, GitBranch, MessageSquare, Terminal, Settings, BookOpen, Activity, Brain, Puzzle,
  PanelLeftClose, PanelLeft, Bot, Code2, AlertTriangle, ArrowLeftRight,
  Cpu,
} from 'lucide-react';

export default function Sidebar() {
  const {
    sidebarCollapsed, toggleSidebar,
    sidebarView, setSidebarView,
    activePanel, setActivePanel,
    toggleTerminal, terminalVisible,
  } = useStore();

  const topItems = [
    { id: 'files' as SidebarView, icon: <Files size={20} />, label: 'Explorer' },
    { id: 'search' as SidebarView, icon: <Search size={20} />, label: 'Search' },
    { id: 'git' as SidebarView, icon: <GitBranch size={20} />, label: 'Source Control' },
    { id: 'models' as SidebarView, icon: <Cpu size={20} />, label: 'Local Models' },
    { id: 'knowledge' as SidebarView, icon: <BookOpen size={20} />, label: 'Knowledge' },
    { id: 'system' as SidebarView, icon: <Activity size={20} />, label: 'System Monitor' },
    { id: 'memory' as SidebarView, icon: <Brain size={20} />, label: 'Memory' },
    { id: 'plugins' as SidebarView, icon: <Puzzle size={20} />, label: 'Plugins' },
    { id: 'snippets' as SidebarView, icon: <Code2 size={20} />, label: 'Snippets' },
    { id: 'diagnostics' as SidebarView, icon: <AlertTriangle size={20} />, label: 'Problems' },
  ];

  const bottomItems = [
    { id: 'chat', icon: <MessageSquare size={20} />, label: 'AI Chat', panel: 'chat' as const },
    { id: 'terminal', icon: <Terminal size={20} />, label: 'Terminal', panel: 'terminal' as const },
    { id: 'settings', icon: <Settings size={20} />, label: 'Settings', panel: 'settings' as const },
  ];

  const isTopActive = (id: SidebarView) => sidebarView === id && activePanel !== 'settings';
  const isBottomActive = (id: string) => {
    if (id === 'chat') return activePanel === 'chat';
    if (id === 'terminal') return terminalVisible;
    if (id === 'settings') return activePanel === 'settings';
    return false;
  };

  const handleTopClick = (id: SidebarView) => { setSidebarView(id); setActivePanel('editor'); };
  const handleBottomClick = (id: string) => {
    if (id === 'chat') setActivePanel('chat');
    else if (id === 'terminal') toggleTerminal();
    else if (id === 'settings') setActivePanel('settings');
  };

  const SidebarButton = ({ id, icon, label, active, onClick }: { id: string; icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) => (
    <button onClick={onClick}
      className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all relative ${active ? 'text-nex-accent bg-nex-accent/10' : 'text-nex-text-dim hover:text-nex-text hover:bg-nex-card'}`}
      title={label}>
      {active && <div className="absolute left-0 w-[2px] h-5 bg-nex-accent rounded-r-full" />}
      {icon}
    </button>
  );

  return (
    <div className="w-[48px] bg-nex-surface border-r border-nex-border flex flex-col items-center py-2 shrink-0">
      <button onClick={toggleSidebar} className="w-8 h-8 rounded-md flex items-center justify-center text-nex-text-dim hover:text-nex-text hover:bg-nex-card transition-all mb-2" title="Toggle sidebar">
        {sidebarCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
      </button>
      <div className="w-8 h-8 rounded-lg nex-gradient flex items-center justify-center mb-4">
        <Bot size={16} className="text-white" />
      </div>
      <div className="flex flex-col gap-1 flex-1">
        {topItems.map((item) => (
          <SidebarButton key={item.id} id={item.id} icon={item.icon} label={item.label} active={isTopActive(item.id)} onClick={() => handleTopClick(item.id)} />
        ))}
      </div>
      <div className="flex flex-col gap-1">
        {bottomItems.map((item) => (
          <SidebarButton key={item.id} id={item.id} icon={item.icon} label={item.label} active={isBottomActive(item.id)} onClick={() => handleBottomClick(item.id)} />
        ))}
      </div>
    </div>
  );
}
