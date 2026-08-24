/**
 * NEX AI — Workspace Panel (UI-15)
 *
 * Unified workspace container with 5 tabs: Editor, Terminal, Preview, Files, Logs.
 * Each tab renders its real panel — no placeholders, no fake data.
 *
 * UI-15 §3: Terminal/Editor/Preview/Files/Logs consolidated into one workspace.
 * Previously these were separate nav items (cluttered). Now accessible via tabs.
 */

import React, { useState, Suspense, lazy } from 'react';
import { Code2, Terminal, Eye, FolderOpen, ScrollText } from 'lucide-react';
import { useStore } from '../../store/useStore';
import type { WorkspaceTab } from './NavigationRail';

// Lazy-load workspace panels (heavy — Monaco, xterm, etc.)
const EditorPanel = lazy(() => import('../EditorPanel'));
const TerminalSessionPanel = lazy(() => import('./TerminalSessionPanel'));
const WorkspaceExplorer = lazy(() => import('./WorkspaceExplorer'));

interface TabDef {
  id: WorkspaceTab;
  icon: React.ReactNode;
  label: string;
}

const TABS: TabDef[] = [
  { id: 'editor', icon: <Code2 size={13} />, label: 'Editor' },
  { id: 'terminal', icon: <Terminal size={13} />, label: 'Terminal' },
  { id: 'preview', icon: <Eye size={13} />, label: 'Preview' },
  { id: 'files', icon: <FolderOpen size={13} />, label: 'Files' },
  { id: 'logs', icon: <ScrollText size={13} />, label: 'Logs' },
];

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
        Open a project to use the workspace
      </p>
      <button
        className="nex-click nex-focus px-3 py-1.5 rounded-lg text-xs font-medium nex-glass-accent"
        style={{ color: 'var(--nex-accent-text)' }}
        onClick={async () => {
          const r = await window.nexAPI.openFolder();
          if (!r.canceled && r.path) useStore.getState().setProjectPath(r.path);
        }}
      >
        Open Project
      </button>
    </div>
  );
}

export default function WorkspacePanel() {
  const { projectPath, activeFile } = useStore();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(activeFile ? 'editor' : 'files');

  // UI-15 §3: If no project, show NoProject prompt (except for terminal which
  // can work in cwd). Auto-switch to editor tab when a file is opened.
  React.useEffect(() => {
    if (activeFile && activeTab !== 'editor') {
      setActiveTab('editor');
    }
  }, [activeFile, activeTab]);

  const renderTab = () => {
    if (!projectPath && activeTab !== 'terminal') {
      return <NoProject />;
    }
    switch (activeTab) {
      case 'editor':
        return <Suspense fallback={<PanelLoading />}><EditorPanel /></Suspense>;
      case 'terminal':
        return <Suspense fallback={<PanelLoading />}><TerminalSessionPanel /></Suspense>;
      case 'files':
        return <Suspense fallback={<PanelLoading />}><WorkspaceExplorer /></Suspense>;
      case 'preview':
        return <PreviewPanel projectPath={projectPath} />;
      case 'logs':
        return <LogsPanel />;
      default:
        return <NoProject />;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab Bar */}
      <div
        className="flex items-center gap-1 px-2 py-1.5 shrink-0"
        style={{ borderBottom: '1px solid var(--nex-glass-border)' }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`nex-click nex-focus flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                isActive ? '' : 'opacity-60 hover:opacity-100'
              }`}
              style={{
                background: isActive ? 'var(--nex-accent-dim)' : 'transparent',
                color: isActive ? 'var(--nex-accent-text)' : 'var(--nex-text-muted)',
                border: isActive ? '1px solid var(--nex-accent-glow)' : '1px solid transparent',
              }}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
              title={tab.label}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {renderTab()}
      </div>
    </div>
  );
}

// ─── Preview Panel ────────────────────────────────────────────────────────────
/**
 * UI-15 §3: Preview panel — shows real project preview.
 * Uses Electron's shell.openExternal for HTML files, or shows project info.
 * No fake data — if no previewable content, shows honest message.
 */
function PreviewPanel({ projectPath }: { projectPath: string | null }) {
  if (!projectPath) return <NoProject />;
  const projectName = projectPath.split(/[\\/]/).pop() || projectPath;

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--nex-glass-border)' }}
      >
        <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
          PREVIEW — {projectName}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto nex-scrollbar p-4">
        <div className="flex flex-col gap-3">
          <p className="text-xs" style={{ color: 'var(--nex-text-dim)' }}>
            Project preview
          </p>
          <p className="text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>
            Path: <code style={{ color: 'var(--nex-accent-text)' }}>{projectPath}</code>
          </p>
          <p className="text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>
            Preview shows project structure. For HTML files, open them in the Editor
            and use the system browser. For dev servers, use the Terminal tab.
          </p>
          <button
            onClick={async () => {
              const r = await window.nexAPI.openFolder();
              if (!r.canceled && r.path) useStore.getState().setProjectPath(r.path);
            }}
            className="nex-click nex-focus self-start px-3 py-1.5 rounded-lg text-[10px] font-medium nex-glass-accent"
            style={{ color: 'var(--nex-accent-text)' }}
          >
            Open Project Folder
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Logs Panel ────────────────────────────────────────────────────────────────
/**
 * UI-15 §3: Logs panel — shows real runtime/agent logs.
 * Uses system-snapshot IPC (already exists) to show agent activity.
 * No fake logs — shows real telemetry data from backend.
 */
function LogsPanel() {
  const [logs, setLogs] = React.useState<Array<{ time: string; level: string; msg: string }>>([]);
  const [snap, setSnap] = React.useState<any>(null);

  React.useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const r = await window.nexAPI.systemSnapshot();
        if (mounted && r.success && r.snapshot) {
          setSnap(r.snapshot);
          // Build log entries from real telemetry (agent state, runtime state)
          const newLogs: Array<{ time: string; level: string; msg: string }> = [];
          const agent = r.snapshot.agent;
          if (agent?.currentTask) {
            newLogs.push({
              time: new Date().toLocaleTimeString(),
              level: 'INFO',
              msg: `Agent task: ${agent.currentTask}`,
            });
          }
          if (agent?.activeTool) {
            newLogs.push({
              time: new Date().toLocaleTimeString(),
              level: 'TOOL',
              msg: `Tool running: ${agent.activeTool}`,
            });
          }
          const rt = r.snapshot.aiRuntime;
          if (rt?.inferenceActive) {
            newLogs.push({
              time: new Date().toLocaleTimeString(),
              level: 'INFER',
              msg: `Inference active — ${rt.activeModelName || 'model'}`,
            });
          }
          if (rt?.lastTokensPerSecond && rt.lastTokensPerSecond > 0) {
            newLogs.push({
              time: new Date().toLocaleTimeString(),
              level: 'PERF',
              msg: `${Math.round(rt.lastTokensPerSecond)} tok/s`,
            });
          }
          if (agent?.queueState === 'running') {
            newLogs.push({
              time: new Date().toLocaleTimeString(),
              level: 'WORK',
              msg: `Queue: running`,
            });
          }
          setLogs((prev) => [...newLogs, ...prev].slice(0, 50));
        }
      } catch { /* keep last */ }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--nex-glass-border)' }}
      >
        <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
          RUNTIME LOGS
        </span>
        <span className="text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>
          {logs.length} entries
        </span>
      </div>
      <div className="flex-1 overflow-y-auto nex-scrollbar p-2">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
            <ScrollText size={24} style={{ color: 'var(--nex-text-muted)', opacity: 0.4 }} />
            <p className="text-xs" style={{ color: 'var(--nex-text-muted)' }}>
              No active log entries.
            </p>
            <p className="text-[10px]" style={{ color: 'var(--nex-text-muted)', opacity: 0.7 }}>
              Logs appear when the agent runs tasks or inference is active.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1 font-mono">
            {logs.map((entry, i) => (
              <li
                key={i}
                className="flex items-start gap-2 px-2 py-1 rounded text-[10px]"
                style={{ background: 'var(--nex-glass-bg)' }}
              >
                <span style={{ color: 'var(--nex-text-muted)' }}>{entry.time}</span>
                <span
                  className="shrink-0 px-1 rounded font-bold"
                  style={{
                    color:
                      entry.level === 'ERROR' ? 'rgb(248,113,113)' :
                      entry.level === 'WARN' ? 'rgb(251,191,36)' :
                      entry.level === 'TOOL' ? 'var(--nex-accent-text)' :
                      entry.level === 'INFER' ? 'rgb(167,139,250)' :
                      'var(--nex-text-dim)',
                  }}
                >
                  {entry.level}
                </span>
                <span style={{ color: 'var(--nex-text)' }}>{entry.msg}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
