import React, { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import {
  GitBranch,
  AlertCircle,
  CheckCircle,
  Wifi,
  WifiOff,
  Cpu,
  Terminal,
  Bot,
} from 'lucide-react';

export default function StatusBar() {
  const {
    activeFile,
    openFiles,
    projectPath,
    settings,
    terminalVisible,
    toggleTerminal,
  } = useStore();
  const [isOnline, setIsOnline] = useState(true);
  const [systemInfo, setSystemInfo] = useState<any>(null);

  const activeFileData = openFiles.find((f) => f.path === activeFile);
  const modifiedCount = openFiles.filter((f) => f.modified).length;

  useEffect(() => {
    window.nexAPI.systemInfo().then(setSystemInfo);
  }, []);

  return (
    <div className="h-6 flex items-center justify-between px-3 bg-[#0d0d14] border-t border-nex-border text-[11px] text-nex-text-dim select-none shrink-0">
      {/* Left */}
      <div className="flex items-center gap-3">
        {/* Branch */}
        <div className="flex items-center gap-1 hover:text-nex-text cursor-pointer transition-colors">
          <GitBranch size={12} />
          <span>main</span>
        </div>

        {/* Errors/Warnings */}
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-0.5 hover:text-nex-text cursor-pointer transition-colors">
            <AlertCircle size={11} className="text-nex-error" />
            <span>0</span>
          </span>
          <span className="flex items-center gap-0.5 hover:text-nex-text cursor-pointer transition-colors">
            <AlertCircle size={11} className="text-nex-warning" />
            <span>0</span>
          </span>
        </div>

        {/* Modified files */}
        {modifiedCount > 0 && (
          <span className="text-nex-accent">
            {modifiedCount} unsaved
          </span>
        )}
      </div>

      {/* Center */}
      <div className="flex items-center gap-3">
        {activeFileData && (
          <>
            <span className="capitalize">{activeFileData.language}</span>
            <span className="text-nex-text-muted">|</span>
            <span>UTF-8</span>
            <span className="text-nex-text-muted">|</span>
            <span>Spaces: {settings.tabSize}</span>
          </>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-3">
        {/* AI Status */}
        <div
          className="flex items-center gap-1 hover:text-nex-text cursor-pointer transition-colors"
          title="AI Status"
        >
          <Bot size={11} className="text-nex-accent" />
          <span>NEX AI</span>
        </div>

        {/* Terminal toggle */}
        <button
          onClick={toggleTerminal}
          className={`flex items-center gap-1 hover:text-nex-text cursor-pointer transition-colors ${
            terminalVisible ? 'text-nex-accent' : ''
          }`}
          title="Toggle Terminal"
        >
          <Terminal size={11} />
        </button>

        {/* Connection */}
        <div className="flex items-center gap-1" title={isOnline ? 'Online' : 'Offline'}>
          {isOnline ? (
            <Wifi size={11} className="text-green-400" />
          ) : (
            <WifiOff size={11} className="text-nex-error" />
          )}
        </div>

        {/* System */}
        {systemInfo && (
          <div className="flex items-center gap-1 hover:text-nex-text cursor-pointer transition-colors" title="System Info">
            <Cpu size={11} />
            <span>{systemInfo.cpus} cores</span>
          </div>
        )}

        {/* Project name */}
        {projectPath && (
          <span className="text-nex-text-muted">
            {projectPath.split(/[\\/]/).pop()}
          </span>
        )}
      </div>
    </div>
  );
}
