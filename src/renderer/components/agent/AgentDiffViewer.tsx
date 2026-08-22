import React, { useState, useEffect } from 'react';
import { GitCompare, Check, X, FileText, AlertCircle } from 'lucide-react';

interface PendingDiff {
  id: string;
  taskId: string;
  stepId: string;
  filePath: string;
  beforeContent: string;
  afterContent: string;
  diff: string;
  createdAt: number;
  status: 'pending' | 'accepted' | 'rejected' | 'applied' | 'failed';
}

interface AgentDiffViewerProps {
  diffs: PendingDiff[];
  onAccept: (changeId: string) => void;
  onReject: (changeId: string, reason?: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose: () => void;
}

/**
 * Renders pending diffs from the agent and asks the user to accept/reject each.
 * - "Accept" applies the change to disk (via DiffManager → fs.writeFile)
 * - "Reject" leaves the file unchanged
 *
 * This is the user-facing boundary between "AI proposes" and "file on disk changes".
 */
export default function AgentDiffViewer({
  diffs, onAccept, onReject, onAcceptAll, onRejectAll, onClose,
}: AgentDiffViewerProps) {
  const [activeDiffId, setActiveDiffId] = useState<string | null>(diffs[0]?.id || null);
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    if (!activeDiffId && diffs.length > 0) {
      setActiveDiffId(diffs[0].id);
    }
    if (activeDiffId && !diffs.find((d) => d.id === activeDiffId)) {
      setActiveDiffId(diffs[0]?.id || null);
    }
  }, [diffs, activeDiffId]);

  if (diffs.length === 0) return null;

  const activeDiff = diffs.find((d) => d.id === activeDiffId) || diffs[0];

  const handleAccept = () => {
    onAccept(activeDiff.id);
    // Move to next pending diff
    const nextPending = diffs.find((d) => d.id !== activeDiff.id && d.status === 'pending');
    setActiveDiffId(nextPending?.id || null);
  };

  const handleReject = () => {
    onReject(activeDiff.id, rejectReason || 'User rejected');
    setShowRejectReason(false);
    setRejectReason('');
    const nextPending = diffs.find((d) => d.id !== activeDiff.id && d.status === 'pending');
    setActiveDiffId(nextPending?.id || null);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in">
      <div className="bg-nex-surface border border-nex-border rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-nex-border flex items-center justify-between bg-nex-bg">
          <div className="flex items-center gap-2">
            <GitCompare size={18} className="text-nex-accent" />
            <span className="text-sm font-semibold text-nex-text">Proposed Changes</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-nex-card text-nex-text-muted">
              {diffs.length} pending
            </span>
          </div>
          <button onClick={onClose} className="text-nex-text-dim hover:text-nex-text transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex">
          {/* File list sidebar */}
          {diffs.length > 1 && (
            <div className="w-[200px] border-r border-nex-border bg-nex-bg overflow-auto shrink-0">
              {diffs.map((diff) => {
                const fileName = diff.filePath.split(/[\\/]/).pop() || diff.filePath;
                const isActive = diff.id === activeDiffId;
                return (
                  <button
                    key={diff.id}
                    onClick={() => setActiveDiffId(diff.id)}
                    className={`w-full text-left px-3 py-2 text-xs transition-all flex items-center gap-2 ${
                      isActive ? 'bg-nex-accent/10 text-nex-accent-light' : 'text-nex-text-dim hover:text-nex-text hover:bg-nex-card'
                    }`}
                  >
                    <FileText size={12} className="shrink-0" />
                    <span className="truncate">{fileName}</span>
                    {diff.status !== 'pending' && (
                      <span className={`text-[9px] px-1 py-0.5 rounded-full ml-auto ${
                        diff.status === 'applied' ? 'bg-green-500/20 text-green-400' :
                        diff.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                        'bg-nex-card text-nex-text-muted'
                      }`}>
                        {diff.status}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Diff content */}
          <div className="flex-1 overflow-auto">
            <div className="px-4 py-2 border-b border-nex-border bg-nex-bg flex items-center gap-2">
              <FileText size={14} className="text-nex-text-dim" />
              <code className="text-xs font-mono text-nex-text-dim">{activeDiff.filePath}</code>
            </div>
            <pre className="p-4 text-xs font-mono leading-relaxed bg-nex-bg overflow-auto">
              {activeDiff.diff.split('\n').map((line, i) => (
                <div
                  key={i}
                  className={`px-2 ${
                    line.startsWith('+') && !line.startsWith('+++')
                      ? 'bg-green-500/10 text-green-400'
                      : line.startsWith('-') && !line.startsWith('---')
                      ? 'bg-red-500/10 text-red-400'
                      : line.startsWith('@@')
                      ? 'bg-nex-accent/10 text-nex-accent-light'
                      : line.startsWith('---') || line.startsWith('+++')
                      ? 'text-nex-text-muted'
                      : 'text-nex-text-dim'
                  }`}
                >
                  {line || ' '}
                </div>
              ))}
            </pre>
          </div>
        </div>

        {/* Footer / Actions */}
        <div className="px-4 py-3 border-t border-nex-border bg-nex-bg flex items-center justify-between">
          <div className="text-[11px] text-nex-text-muted">
            <AlertCircle size={11} className="inline mr-1" />
            Files are <strong>not modified on disk</strong> until you accept.
          </div>
          <div className="flex items-center gap-2">
            {showRejectReason && (
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason (optional)"
                className="bg-nex-card border border-nex-border rounded px-2 py-1 text-xs text-nex-text outline-none focus:border-nex-accent/50"
                autoFocus
              />
            )}
            {diffs.length > 1 && (
              <>
                <button onClick={onRejectAll} className="px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg transition-all flex items-center gap-1">
                  <X size={11} /> Reject All
                </button>
                <button onClick={onAcceptAll} className="px-3 py-1.5 text-xs text-nex-text-dim hover:text-nex-text hover:bg-nex-card rounded-lg transition-all flex items-center gap-1">
                  <Check size={11} /> Accept All
                </button>
              </>
            )}
            <button
              onClick={() => {
                if (showRejectReason) {
                  handleReject();
                } else {
                  setShowRejectReason(true);
                }
              }}
              className="px-4 py-1.5 text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-all flex items-center gap-1.5 border border-red-500/30"
            >
              <X size={12} /> {showRejectReason ? 'Confirm Reject' : 'Reject'}
            </button>
            <button
              onClick={handleAccept}
              disabled={activeDiff.status !== 'pending'}
              className="px-4 py-1.5 text-xs font-medium bg-nex-accent text-white hover:bg-nex-accent-light rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              <Check size={12} /> Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
