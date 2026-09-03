/**
 * NEX AI — Workspace Explorer (Phase 28)
 *
 * Real filesystem-backed project explorer using the NEX token system.
 * Features: lazy expansion, search, context menu, hidden files, refresh.
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  ChevronRight, ChevronDown, Folder, FolderOpen, File, FileCode, FileJson,
  FileText, FileTerminal, Search, RefreshCw, MoreVertical, Plus, FolderPlus,
  Trash2, Pencil, Copy, Terminal as TerminalIcon, Loader2,
} from 'lucide-react';
import { useStore } from '../../store/useStore';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  extension: string;
  size: number;
}

interface TreeNode extends FileNode {
  children?: FileNode[];
  expanded: boolean;
  loading: boolean;
}

function iconFor(ext: string, isDir: boolean): React.ReactNode {
  if (isDir) return <Folder size={12} />;
  const e = ext.toLowerCase();
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(e)) return <FileCode size={12} />;
  if (e === 'json') return <FileJson size={12} />;
  if (['md', 'txt', 'log', 'yml', 'yaml'].includes(e)) return <FileText size={12} />;
  if (['sh', 'bash', 'zsh'].includes(e)) return <FileTerminal size={12} />;
  return <File size={12} />;
}

export default function WorkspaceExplorer() {
  const { projectPath, setProjectPath, openFile } = useStore();
  const [tree, setTree] = useState<Map<string, TreeNode>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FileNode[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const workspaceName = projectPath?.split(/[\\/]/).pop() || 'No workspace';

  // Set workspace on mount / project change
  useEffect(() => {
    if (projectPath) {
      window.nexAPI.fsSetWorkspace(projectPath).catch(() => {});
      loadRoot();
    } else {
      setTree(new Map());
    }
  }, [projectPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRoot = useCallback(async () => {
    if (!projectPath) return;
    setRefreshing(true);
    try {
      await window.nexAPI.fsSetWorkspace(projectPath);
      const result = await window.nexAPI.fsServiceReaddir(projectPath, showHidden);
      const rootNode: TreeNode = {
        name: workspaceName,
        path: projectPath,
        isDirectory: true,
        extension: '',
        size: 0,
        expanded: true,
        loading: false,
        children: result.entries || [],
      };
      const newTree = new Map<string, TreeNode>();
      newTree.set(projectPath, rootNode);
      setTree(newTree);
    } catch { /* error state */ }
    setRefreshing(false);
  }, [projectPath, workspaceName, showHidden]);

  const toggleDir = useCallback(async (nodePath: string) => {
    const node = tree.get(nodePath);
    if (!node) return;

    if (node.expanded) {
      setTree(prev => {
        const next = new Map(prev);
        const n = next.get(nodePath);
        if (n) n.expanded = false;
        return next;
      });
      return;
    }

    // Expand: lazy-load children
    setTree(prev => {
      const next = new Map(prev);
      const n = next.get(nodePath);
      if (n) { n.expanded = true; n.loading = true; }
      return next;
    });

    try {
      const result = await window.nexAPI.fsServiceReaddir(nodePath, showHidden);
      setTree(prev => {
        const next = new Map(prev);
        const n = next.get(nodePath);
        if (n) { n.loading = false; n.children = result.entries || []; }
        // Create child TreeNodes for directories
        for (const child of result.entries || []) {
          if (child.isDirectory && !next.has(child.path)) {
            next.set(child.path, { ...child, expanded: false, loading: false });
          }
        }
        return next;
      });
    } catch {
      setTree(prev => {
        const next = new Map(prev);
        const n = next.get(nodePath);
        if (n) n.loading = false;
        return next;
      });
    }
  }, [tree, showHidden]);

  // Search with debounce
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || !projectPath) {
      setSearchResults(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await window.nexAPI.fsServiceSearch(query);
        setSearchResults(r.results || []);
      } catch { setSearchResults([]); }
    }, 300);
  }, [projectPath]);

  const handleFileClick = useCallback((node: FileNode) => {
    if (node.isDirectory) {
      toggleDir(node.path);
    } else {
      openFile(node.path).catch(() => {});
    }
  }, [toggleDir, openFile]);

  const handleOpenInTerminal = useCallback((dirPath: string) => {
    // Emit a custom event that the terminal panel listens to
    window.dispatchEvent(new CustomEvent('nex:open-terminal-here', { detail: { cwd: dirPath } }));
  }, []);

  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).catch(() => {});
  }, []);

  const handleCreate = useCallback(async (parentPath: string, isDir: boolean) => {
    const name = prompt(isDir ? 'Folder name:' : 'File name:');
    if (!name?.trim()) return;
    await window.nexAPI.fsServiceCreate(parentPath, name.trim(), isDir);
    // Refresh parent
    toggleDir(parentPath).then(() => toggleDir(parentPath)); // collapse+expand
  }, [toggleDir]);

  const handleDelete = useCallback(async (path: string) => {
    if (!confirm(`Delete ${path.split('/').pop()}?`)) return;
    await window.nexAPI.fsServiceDelete(path);
    loadRoot(); // refresh
  }, [loadRoot]);

  // Phase 116: Auto-refresh file tree when files change on disk.
  // This catches: agent write_file/edit_file, terminal commands, external
  // editor changes. Debounced 500ms to avoid spamming during batch writes.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const handler = () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        loadRoot();
      }, 500);
    };
    window.addEventListener('nex:fs-change', handler);
    return () => {
      window.removeEventListener('nex:fs-change', handler);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [loadRoot]);

  const renderNode = useCallback((node: TreeNode, depth: number): React.ReactNode => {
    const isExpanded = node.expanded;
    const hasChildren = node.children !== undefined;
    return (
      <div key={node.path}>
        <button
          onClick={() => handleFileClick(node)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({ x: e.clientX, y: e.clientY, node });
          }}
          className={`w-full flex items-center gap-1.5 px-2 py-[3px] text-[11px] rounded-md transition-colors cursor-pointer text-left ${
            'hover:bg-white/[0.04]'
          }`}
          style={{
            paddingLeft: `${8 + depth * 12}px`,
            color: node.isDirectory ? 'var(--nex-text-dim)' : 'var(--nex-text-muted)',
          }}
          title={node.path}
        >
          {node.isDirectory ? (
            isExpanded ? <ChevronDown size={10} className="shrink-0" /> : <ChevronRight size={10} className="shrink-0" />
          ) : (
            <span className="w-[10px] shrink-0" />
          )}
          <span className="shrink-0" style={{ color: node.isDirectory ? 'var(--nex-accent)' : 'var(--nex-text-muted)' }}>
            {iconFor(node.extension, node.isDirectory)}
          </span>
          <span className="truncate">{node.name}</span>
          {node.isDirectory && node.loading && (
            <Loader2 size={9} className="animate-spin ml-auto shrink-0" />
          )}
        </button>
        {node.isDirectory && isExpanded && hasChildren && (
          <div>
            {node.children!.map((child) => {
              const childNode = tree.get(child.path);
              if (childNode) return renderNode(childNode, depth + 1);
              // Inline leaf (file or collapsed dir)
              return (
                <button
                  key={child.path}
                  onClick={() => handleFileClick(child)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const fake: TreeNode = { ...child, expanded: false, loading: false };
                    setContextMenu({ x: e.clientX, y: e.clientY, node: fake });
                  }}
                  className="w-full flex items-center gap-1.5 px-2 py-[3px] text-[11px] rounded-md transition-colors cursor-pointer text-left hover:bg-white/[0.04]"
                  style={{ paddingLeft: `${8 + (depth + 1) * 12}px`, color: 'var(--nex-text-muted)' }}
                >
                  <span className="shrink-0">{iconFor(child.extension, child.isDirectory)}</span>
                  <span className="truncate">{child.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }, [tree, handleFileClick]); // eslint-disable-line

  const rootNode = projectPath ? tree.get(projectPath) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
              PROJECT EXPLORER
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowHidden(!showHidden)}
              className={`p-1 rounded transition-colors ${showHidden ? 'text-[var(--nex-accent)]' : 'text-[var(--nex-text-muted)]'} hover:text-[var(--nex-text)]`}
              title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
            >
              <span className="text-[9px] font-mono">.*</span>
            </button>
            <button
              onClick={loadRoot}
              disabled={refreshing}
              className="p-1 rounded text-[var(--nex-text-muted)] hover:text-[var(--nex-text)] transition-colors"
              title="Refresh"
            >
              <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        {/* Search */}
        <div className="relative">
          <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--nex-text-muted)]" />
          <input
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search workspace…"
            className="w-full bg-white/[0.03] border border-[var(--nex-glass-border)] rounded-md pl-6 pr-2 py-1 text-[10px] placeholder-[var(--nex-text-muted)] outline-none focus:border-[var(--nex-accent)]/30"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto nex-scroll px-1 py-1">
        {!projectPath ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-8">
            <Folder size={20} className="text-[var(--nex-text-muted)]" />
            <p className="text-[10px] text-[var(--nex-text-muted)]">Open a workspace</p>
            <button
              onClick={async () => {
                const r = await window.nexAPI.openFolder();
                if (!r.canceled && r.path) setProjectPath(r.path);
              }}
              className="px-3 py-1 rounded-md text-[10px] nex-glass-accent"
              style={{ color: 'var(--nex-accent-text)' }}
            >
              Open Folder
            </button>
          </div>
        ) : searchResults !== null ? (
          /* Search results */
          <div>
            <div className="px-2 py-1 text-[9px] text-[var(--nex-text-muted)]">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
            </div>
            {searchResults.map((f) => (
              <button
                key={f.path}
                onClick={() => !f.isDirectory && openFile(f.path).catch(() => {})}
                className="w-full flex items-center gap-2 px-3 py-1 text-[11px] rounded-md hover:bg-white/[0.04] text-left"
              >
                <span style={{ color: 'var(--nex-accent)' }}>{iconFor(f.extension, f.isDirectory)}</span>
                <span className="truncate" style={{ color: 'var(--nex-text-dim)' }}>{f.name}</span>
                <span className="ml-auto text-[9px] text-[var(--nex-text-muted)] truncate max-w-[80px]">
                  {f.path.replace(projectPath, '.')}
                </span>
              </button>
            ))}
          </div>
        ) : rootNode ? (
          renderNode(rootNode, 0)
        ) : (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={14} className="animate-spin text-[var(--nex-text-muted)]" />
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-[200] nex-glass-strong rounded-lg py-1 min-w-[140px]"
          style={{
            left: contextMenu.x, top: contextMenu.y,
            border: '1px solid var(--nex-panel-border)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          }}
          onMouseLeave={() => setContextMenu(null)}
        >
          {contextMenu.node.isDirectory && (
            <>
              <MenuItem icon={<TerminalIcon size={11} />} label="Open Terminal Here"
                onClick={() => { handleOpenInTerminal(contextMenu.node.path); setContextMenu(null); }} />
              <MenuItem icon={<Plus size={11} />} label="New File"
                onClick={() => { handleCreate(contextMenu.node.path, false); setContextMenu(null); }} />
              <MenuItem icon={<FolderPlus size={11} />} label="New Folder"
                onClick={() => { handleCreate(contextMenu.node.path, true); setContextMenu(null); }} />
            </>
          )}
          {!contextMenu.node.isDirectory && (
            <MenuItem icon={<File size={11} />} label="Open"
              onClick={() => { handleFileClick(contextMenu.node); setContextMenu(null); }} />
          )}
          <MenuItem icon={<Pencil size={11} />} label="Rename"
            onClick={async () => {
              const newName = prompt('New name:', contextMenu.node.name);
              if (newName?.trim()) {
                const parent = contextMenu.node.path.split('/').slice(0, -1).join('/');
                await window.nexAPI.fsServiceRename(contextMenu.node.path, `${parent}/${newName.trim()}`);
                loadRoot();
              }
              setContextMenu(null);
            }} />
          <MenuItem icon={<Copy size={11} />} label="Copy Path"
            onClick={() => { handleCopyPath(contextMenu.node.path); setContextMenu(null); }} />
          <div style={{ height: 1, background: 'var(--nex-glass-border)', margin: '2px 0' }} />
          <MenuItem icon={<Trash2 size={11} />} label="Delete" danger
            onClick={() => { handleDelete(contextMenu.node.path); setContextMenu(null); }} />
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-left transition-colors hover:bg-white/[0.06] ${
        danger ? 'text-red-400' : 'text-[var(--nex-text-dim)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
