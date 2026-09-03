import React, { useEffect, useState, useCallback } from 'react';
import { useStore } from '../store/useStore';
import InputDialog from './InputDialog';
import {
  ChevronRight, ChevronDown, File, Folder, FolderOpen, FileCode, FileText,
  FileJson, FileImage, Settings as SettingsIcon, RefreshCw, Plus, MoreHorizontal,
  Pencil, Trash2, Copy,
} from 'lucide-react';

interface FileNode { name: string; path: string; isDirectory: boolean; children?: FileNode[]; }

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, React.ReactNode> = {
    ts: <FileCode size={14} className="text-blue-400" />, tsx: <FileCode size={14} className="text-blue-300" />,
    js: <FileCode size={14} className="text-yellow-400" />, jsx: <FileCode size={14} className="text-yellow-300" />,
    py: <FileCode size={14} className="text-green-400" />, go: <FileCode size={14} className="text-cyan-400" />,
    rs: <FileCode size={14} className="text-orange-400" />, java: <FileCode size={14} className="text-red-400" />,
    json: <FileJson size={14} className="text-yellow-300" />, md: <FileText size={14} className="text-blue-200" />,
    html: <FileCode size={14} className="text-orange-300" />, css: <FileCode size={14} className="text-blue-300" />,
    scss: <FileCode size={14} className="text-pink-400" />, png: <FileImage size={14} className="text-green-300" />,
    jpg: <FileImage size={14} className="text-green-300" />, svg: <FileImage size={14} className="text-purple-300" />,
    yaml: <SettingsIcon size={14} className="text-pink-300" />, yml: <SettingsIcon size={14} className="text-pink-300" />,
  };
  return map[ext] || <File size={14} className="text-nex-text-muted" />;
}

const IGNORED = new Set(['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', '.vscode', '.idea', '.cache']);

function FileTreeItem({ node, depth, onFileClick, onContextAction }: {
  node: FileNode; depth: number; onFileClick: (p: string) => void;
  onContextAction: (action: string, path: string, isDir: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileNode[]>(node.children || []);
  const [showMenu, setShowMenu] = useState(false);
  const activeFile = useStore((s) => s.activeFile);

  const toggle = useCallback(async () => {
    if (!node.isDirectory) { onFileClick(node.path); return; }
    if (!expanded && children.length === 0) {
      const result = await window.nexAPI.readDir(node.path);
      if (result.success && result.files) {
        setChildren(result.files.filter((f) => !IGNORED.has(f.name))
          .sort((a, b) => { if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1; return a.name.localeCompare(b.name); })
          .map((f) => ({ name: f.name, path: f.path, isDirectory: f.isDirectory, children: [] })));
      }
    }
    setExpanded(!expanded);
  }, [node, expanded, children, onFileClick]);

  const refreshChildren = useCallback(async () => {
    if (node.isDirectory) {
      const result = await window.nexAPI.readDir(node.path);
      if (result.success && result.files) {
        setChildren(result.files.filter((f) => !IGNORED.has(f.name))
          .sort((a, b) => { if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1; return a.name.localeCompare(b.name); })
          .map((f) => ({ name: f.name, path: f.path, isDirectory: f.isDirectory, children: [] })));
      }
    }
  }, [node]);

  return (
    <div>
      <div className={`flex items-center gap-1 py-[3px] px-2 cursor-pointer text-[13px] transition-colors group relative ${
        activeFile === node.path ? 'bg-nex-accent/15 text-nex-accent-light' : 'text-nex-text-dim hover:bg-nex-card hover:text-nex-text'
      }`} style={{ paddingLeft: `${depth * 12 + 8}px` }} onClick={toggle} title={node.path}
        onContextMenu={(e) => { e.preventDefault(); setShowMenu(!showMenu); }}>
        {node.isDirectory ? <span className="w-4 h-4 flex items-center justify-center shrink-0">{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span> : <span className="w-4" />}
        <span className="shrink-0">{node.isDirectory ? (expanded ? <FolderOpen size={14} className="text-nex-accent-light" /> : <Folder size={14} className="text-nex-accent-light" />) : getFileIcon(node.name)}</span>
        <span className="truncate">{node.name}</span>
        {node.isDirectory && (
          <button onClick={(e) => { e.stopPropagation(); onContextAction('newFile', node.path, true); }}
            className="ml-auto opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center text-nex-text-dim hover:text-nex-text transition-all shrink-0" title="New file">
            <Plus size={10} />
          </button>
        )}
        {/* Context Menu */}
        {showMenu && (
          <div className="absolute right-0 top-full z-50 bg-nex-surface border border-nex-border rounded-lg shadow-xl py-1 animate-in min-w-[160px]"
            onClick={(e) => e.stopPropagation()}>
            {node.isDirectory && <button onClick={() => { onContextAction('newFile', node.path, true); setShowMenu(false); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-nex-text-dim hover:bg-nex-card hover:text-nex-text"><Plus size={12} /> New File</button>}
            {node.isDirectory && <button onClick={() => { onContextAction('newFolder', node.path, true); setShowMenu(false); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-nex-text-dim hover:bg-nex-card hover:text-nex-text"><Plus size={12} /> New Folder</button>}
            <button onClick={() => { onContextAction('rename', node.path, node.isDirectory); setShowMenu(false); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-nex-text-dim hover:bg-nex-card hover:text-nex-text"><Pencil size={12} /> Rename</button>
            <button onClick={() => { onContextAction('delete', node.path, node.isDirectory); setShowMenu(false); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-red-400 hover:bg-red-500/10"><Trash2 size={12} /> Delete</button>
          </div>
        )}
      </div>
      {expanded && children.length > 0 && (
        <div className="animate-in">
          {children.map((child) => (
            <FileTreeItem key={child.path} node={child} depth={depth + 1} onFileClick={onFileClick} onContextAction={onContextAction} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileExplorer() {
  const { projectPath } = useStore();
  const [rootChildren, setRootChildren] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<{ type: 'file' | 'folder' | 'rename'; title: string; parentPath?: string; targetPath?: string; defaultValue?: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadRoot = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    const result = await window.nexAPI.readDir(projectPath);
    if (result.success && result.files) {
      setRootChildren(result.files.filter((f) => !IGNORED.has(f.name))
        .sort((a, b) => { if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1; return a.name.localeCompare(b.name); })
        .map((f) => ({ name: f.name, path: f.path, isDirectory: f.isDirectory, children: [] })));
    }
    setLoading(false);
  }, [projectPath, refreshKey]);

  useEffect(() => { loadRoot(); }, [loadRoot]);

  const handleFileClick = useCallback((p: string) => { useStore.getState().openFile(p); }, []);

  const handleContextAction = useCallback((action: string, targetPath: string, isDir: boolean) => {
    const target = isDir ? targetPath : targetPath.substring(0, targetPath.lastIndexOf('/') + 1) || targetPath.substring(0, targetPath.lastIndexOf('\\') + 1);
    if (action === 'newFile') setDialog({ type: 'file', title: 'New File', parentPath: targetPath });
    else if (action === 'newFolder') setDialog({ type: 'folder', title: 'New Folder', parentPath: targetPath });
    else if (action === 'rename') setDialog({ type: 'rename', title: 'Rename', targetPath, defaultValue: targetPath.split(/[\\/]/).pop() });
    else if (action === 'delete') {
      if (confirm(`Delete ${targetPath.split(/[\\/]/).pop()}?`)) {
        window.nexAPI.deletePath(targetPath).then(() => setRefreshKey((k) => k + 1));
      }
    }
  }, []);

  const handleDialogSubmit = async (value: string) => {
    if (!dialog) return;
    if (dialog.type === 'file' && dialog.parentPath) {
      await window.nexAPI.writeFile(`${dialog.parentPath}/${value}`, '');
      useStore.getState().openFile(`${dialog.parentPath}/${value}`);
    } else if (dialog.type === 'folder' && dialog.parentPath) {
      await window.nexAPI.mkdir(`${dialog.parentPath}/${value}`);
    } else if (dialog.type === 'rename' && dialog.targetPath) {
      const dir = dialog.targetPath.substring(0, dialog.targetPath.lastIndexOf('/')) || dialog.targetPath.substring(0, dialog.targetPath.lastIndexOf('\\'));
      await window.nexAPI.rename(dialog.targetPath, `${dir}/${value}`);
    }
    setDialog(null);
    setRefreshKey((k) => k + 1);
  };

  const projectName = projectPath?.split(/[\\/]/).pop() || 'Project';

  return (
    <div className="w-[240px] bg-nex-surface border-r border-nex-border flex flex-col overflow-hidden shrink-0">
      <div className="h-10 flex items-center justify-between px-3 border-b border-nex-border/50">
        <span className="text-xs font-semibold text-nex-text-dim uppercase tracking-wider truncate">{projectName}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setRefreshKey((k) => k + 1)} className="w-6 h-6 rounded flex items-center justify-center text-nex-text-dim hover:text-nex-text hover:bg-nex-card transition-all" title="Refresh"><RefreshCw size={12} /></button>
          <button onClick={() => projectPath && handleContextAction('newFile', projectPath, true)} className="w-6 h-6 rounded flex items-center justify-center text-nex-text-dim hover:text-nex-text hover:bg-nex-card transition-all" title="New File"><Plus size={12} /></button>
        </div>
      </div>
      <div className="flex-1 overflow-auto py-1">
        {loading ? <div className="flex items-center justify-center h-20"><div className="spinner" /></div> :
          rootChildren.length === 0 ? <div className="text-xs text-nex-text-muted text-center mt-8 px-4">No files found</div> :
          rootChildren.map((node) => <FileTreeItem key={node.path} node={node} depth={0} onFileClick={handleFileClick} onContextAction={handleContextAction} />)}
      </div>
      {dialog && <InputDialog type={dialog.type} title={dialog.title} defaultValue={dialog.defaultValue} onSubmit={handleDialogSubmit} onClose={() => setDialog(null)} />}
    </div>
  );
}
