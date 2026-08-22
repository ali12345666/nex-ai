import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import {
  Terminal as TerminalIcon,
  Plus,
  X,
  ChevronUp,
  ChevronDown,
  Trash2,
} from 'lucide-react';

export default function TerminalPanel() {
  const { terminalVisible, toggleTerminal, projectPath } = useStore();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!terminalRef.current || !terminalVisible) return;

    // Create terminal
    const term = new Terminal({
      theme: {
        background: '#0a0a0f',
        foreground: '#e2e8f0',
        cursor: '#6c5ce7',
        cursorAccent: '#0a0a0f',
        selectionBackground: 'rgba(108, 92, 231, 0.3)',
        selectionForeground: '#ffffff',
        black: '#1a1a2e',
        red: '#ff6b6b',
        green: '#00d2d3',
        yellow: '#feca57',
        blue: '#6c5ce7',
        magenta: '#a29bfe',
        cyan: '#00d2d3',
        white: '#e2e8f0',
        brightBlack: '#4a5568',
        brightRed: '#ff8787',
        brightGreen: '#22d3ee',
        brightYellow: '#fcd34d',
        brightBlue: '#818cf8',
        brightMagenta: '#c4b5fd',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Spawn terminal process
    window.nexAPI.terminalSpawn(projectPath || '');

    // Listen for output
    const cleanupOutput = window.nexAPI.onTerminalOutput((data) => {
      term.write(data);
    });

    const cleanupExit = window.nexAPI.onTerminalExit((code) => {
      term.writeln(`\r\n\x1b[33m[Process exited with code ${code}]\x1b[0m`);
    });

    // Forward user input
    const disposable = term.onData((data: string) => {
      window.nexAPI.terminalWrite(data);
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(terminalRef.current);

    setIsReady(true);

    return () => {
      disposable.dispose();
      cleanupOutput();
      cleanupExit();
      resizeObserver.disconnect();
      term.dispose();
      xtermRef.current = null;
    };
  }, [terminalVisible, projectPath]);

  if (!terminalVisible) return null;

  return (
    <div className="border-t border-nex-border bg-nex-bg flex flex-col" style={{ height: '250px' }}>
      {/* Terminal Header */}
      <div className="h-8 flex items-center justify-between px-3 bg-nex-surface border-b border-nex-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <TerminalIcon size={13} className="text-nex-accent" />
          <span className="text-xs font-medium text-nex-text-dim">Terminal</span>
          <span className="text-[10px] text-nex-text-muted">
            {projectPath?.split(/[\\/]/).pop() || 'home'}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => {
              if (xtermRef.current) {
                xtermRef.current.clear();
              }
            }}
            className="w-6 h-6 rounded flex items-center justify-center text-nex-text-dim hover:text-nex-text hover:bg-nex-card transition-all"
            title="Clear terminal"
          >
            <Trash2 size={11} />
          </button>
          <button
            onClick={toggleTerminal}
            className="w-6 h-6 rounded flex items-center justify-center text-nex-text-dim hover:text-nex-text hover:bg-nex-card transition-all"
            title="Close terminal"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Terminal Container */}
      <div ref={terminalRef} className="flex-1 overflow-hidden" />
    </div>
  );
}
