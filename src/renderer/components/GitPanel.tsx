import React, { useEffect, useState, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { GitBranch, RefreshCw, GitCommit, Circle, AlertCircle } from 'lucide-react';

interface GitFile {
  status: string;
  path: string;
}

interface GitCommitEntry {
  hash: string;
  message: string;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  'M': { label: 'Modified', color: 'text-yellow-400' },
  'A': { label: 'Added', color: 'text-green-400' },
  'D': { label: 'Deleted', color: 'text-red-400' },
  'R': { label: 'Renamed', color: 'text-blue-400' },
  '??': { label: 'Untracked', color: 'text-nex-text-dim' },
  'AM': { label: 'Added', color: 'text-green-400' },
};

export default function GitPanel() {
  const { projectPath } = useStore();
  const [branch, setBranch] = useState<string>('');
  const [files, setFiles] = useState<GitFile[]>([]);
  const [commits, setCommits] = useState<GitCommitEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGit = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    setError(null);

    const statusResult = await window.nexAPI.gitStatus(projectPath);
    if (statusResult.success) {
      setBranch(statusResult.branch || '');
      setFiles(statusResult.files || []);
    } else {
      setError(statusResult.error || 'Not a git repository');
    }

    const logResult = await window.nexAPI.gitLog(projectPath, 15);
    if (logResult.success) {
      setCommits(logResult.commits || []);
    }

    setLoading(false);
  }, [projectPath]);

  useEffect(() => { loadGit(); }, [loadGit]);

  if (!projectPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-nex-text-muted p-4">
        <GitBranch size={32} className="mb-3 opacity-30" />
        <p className="text-xs text-center">Open a folder to view source control</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-nex-border/50">
        <div className="flex items-center gap-2">
          <GitBranch size={13} className="text-nex-accent" />
          <span className="text-xs font-medium text-nex-text-dim">{branch || 'No branch'}</span>
        </div>
        <button onClick={loadGit} className="w-6 h-6 rounded flex items-center justify-center text-nex-text-dim hover:text-nex-text hover:bg-nex-card transition-all" title="Refresh">
          <RefreshCw size={11} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-20"><div className="spinner" /></div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-32 text-nex-text-muted p-4">
            <AlertCircle size={24} className="mb-2 text-nex-error opacity-50" />
            <p className="text-xs text-center">{error}</p>
          </div>
        ) : (
          <div className="py-1">
            {/* Changed Files */}
            {files.length > 0 && (
              <div className="px-3 py-1">
                <span className="text-[10px] uppercase tracking-wider text-nex-text-muted font-semibold">
                  Changes ({files.length})
                </span>
              </div>
            )}
            {files.map((file) => {
              const info = STATUS_MAP[file.status] || { label: file.status, color: 'text-nex-text-dim' };
              return (
                <div key={file.path} className="flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-nex-card cursor-pointer transition-colors">
                  <span className={`font-mono text-[10px] w-4 ${info.color}`}>{file.status}</span>
                  <span className="text-nex-text-dim truncate flex-1">{file.path}</span>
                </div>
              );
            })}

            {/* Recent Commits */}
            {commits.length > 0 && (
              <div className="mt-3 px-3 py-1">
                <span className="text-[10px] uppercase tracking-wider text-nex-text-muted font-semibold">
                  Recent Commits
                </span>
              </div>
            )}
            {commits.map((commit) => (
              <div key={commit.hash} className="flex items-start gap-2 px-3 py-1.5 text-[12px] hover:bg-nex-card cursor-pointer transition-colors">
                <GitCommit size={12} className="text-nex-accent shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-nex-text truncate">{commit.message}</div>
                  <div className="text-[10px] text-nex-text-muted font-mono">{commit.hash}</div>
                </div>
              </div>
            ))}

            {files.length === 0 && commits.length === 0 && (
              <div className="flex flex-col items-center justify-center h-32 text-nex-text-muted">
                <GitBranch size={24} className="mb-2 opacity-30" />
                <p className="text-xs">No changes detected</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
