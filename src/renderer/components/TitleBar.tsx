import React from 'react';
import {
  Minus,
  Square,
  X,
  Maximize2,
  Bot,
} from 'lucide-react';

export default function TitleBar() {
  return (
    <div className="h-[38px] flex items-center justify-between bg-nex-bg border-b border-nex-border select-none titlebar-drag">
      {/* Left: Logo & Title */}
      <div className="flex items-center gap-2 pl-3 titlebar-no-drag">
        <div className="w-6 h-6 rounded-md nex-gradient flex items-center justify-center">
          <Bot size={14} className="text-white" />
        </div>
        <span className="text-sm font-semibold tracking-wide text-nex-text">
          NEX AI
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-nex-accent/20 text-nex-accent-light font-medium">
          v1.0
        </span>
      </div>

      {/* Center: Tab indicators (when files are open) */}
      <div className="flex-1" />

      {/* Right: Window Controls */}
      <div className="flex items-center titlebar-no-drag">
        <button
          onClick={() => window.nexAPI.windowMinimize()}
          className="w-11 h-[38px] flex items-center justify-center hover:bg-white/5 transition-colors"
          title="Minimize"
        >
          <Minus size={14} className="text-nex-text-dim" />
        </button>
        <button
          onClick={() => window.nexAPI.windowMaximize()}
          className="w-11 h-[38px] flex items-center justify-center hover:bg-white/5 transition-colors"
          title="Maximize"
        >
          <Maximize2 size={12} className="text-nex-text-dim" />
        </button>
        <button
          onClick={() => window.nexAPI.windowClose()}
          className="w-11 h-[38px] flex items-center justify-center hover:bg-red-500/80 hover:text-white transition-colors rounded-tr-lg"
          title="Close"
        >
          <X size={14} className="text-nex-text-dim" />
        </button>
      </div>
    </div>
  );
}
