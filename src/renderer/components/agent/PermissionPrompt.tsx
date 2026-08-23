import React, { useState, useEffect } from 'react';
import { Shield, AlertTriangle, X, Check, Ban } from 'lucide-react';

interface PermissionRequest {
  id: string;
  tool: string;
  permission: string;
  description: string;
  detail?: string;
  context?: {
    targetPath?: string;
    metadata?: Record<string, any>;
  };
  requestedAt: number;
}

interface PermissionPromptProps {
  request: PermissionRequest | null;
  onRespond: (response: {
    requestId: string;
    decision: 'allow' | 'deny';
    scope: 'once' | 'session' | 'project' | 'global';
    reason?: string;
  }) => void;
}

const PERMISSION_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  read: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'READ' },
  write: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'WRITE' },
  execute: { bg: 'bg-orange-500/15', text: 'text-orange-400', label: 'EXECUTE' },
  delete: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'DELETE' },
  network: { bg: 'bg-purple-500/15', text: 'text-purple-400', label: 'NETWORK' },
  system: { bg: 'bg-pink-500/15', text: 'text-pink-400', label: 'SYSTEM' },
  git: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', label: 'GIT' },
  cloud: { bg: 'bg-indigo-500/15', text: 'text-indigo-400', label: 'CLOUD' },
  admin: { bg: 'bg-red-700/15', text: 'text-red-300', label: 'ADMIN' },
};

const DESTRUCTIVE_PERMISSIONS = ['delete', 'execute', 'admin', 'system'];

export default function PermissionPrompt({ request, onRespond }: PermissionPromptProps) {
  const [denyReason, setDenyReason] = useState('');
  const [showDenyReason, setShowDenyReason] = useState(false);
  const [autoTimer, setAutoTimer] = useState<NodeJS.Timeout | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(60);

  // Auto-deny after 60s (matches the backend timeout)
  useEffect(() => {
    if (!request) {
      setAutoTimer(null);
      setSecondsLeft(60);
      setShowDenyReason(false);
      setDenyReason('');
      return;
    }
    setSecondsLeft(60);
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          onRespond({ requestId: request.id, decision: 'deny', scope: 'once', reason: 'Auto-denied (60s timeout)' });
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    setAutoTimer(interval as any);
    return () => clearInterval(interval);
  }, [request, onRespond]);

  if (!request) return null;

  const permInfo = PERMISSION_COLORS[request.permission] || PERMISSION_COLORS.read;
  const isDestructive = DESTRUCTIVE_PERMISSIONS.includes(request.permission);

  const handleAllow = (scope: 'once' | 'session' | 'project' | 'global') => {
    if (autoTimer) clearInterval(autoTimer);
    onRespond({ requestId: request.id, decision: 'allow', scope });
  };

  const handleDeny = () => {
    if (autoTimer) clearInterval(autoTimer);
    onRespond({ requestId: request.id, decision: 'deny', scope: 'once', reason: denyReason || 'User denied' });
  };

  // Phase 25: keyboard dialog semantics — Escape denies (safe default)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleDeny();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in"
      onKeyDown={handleKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Permission request: ${request.tool} (${request.permission})`}
        className="bg-nex-surface border border-nex-border rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className={`px-5 py-3 border-b border-nex-border flex items-center justify-between ${permInfo.bg}`}>
          <div className="flex items-center gap-2">
            <Shield size={18} className={permInfo.text} />
            <span className="text-sm font-semibold text-nex-text">Permission Required</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${permInfo.bg} ${permInfo.text} border border-current`}>
              {permInfo.label}
            </span>
            {isDestructive && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-bold flex items-center gap-1">
                <AlertTriangle size={10} /> DESTRUCTIVE
              </span>
            )}
          </div>
          <span className="text-[10px] text-nex-text-muted">
            auto-deny in {secondsLeft}s
          </span>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div className="text-sm text-nex-text-dim leading-relaxed">
            NEX AI Agent wants to execute:
          </div>

          <div className="bg-nex-card border border-nex-border rounded-lg p-3">
            <div className="text-sm font-mono text-nex-text font-semibold">{request.tool}</div>
            <div className="text-xs text-nex-text-muted mt-1">{request.description}</div>
          </div>

          {request.detail && (
            <div className={`text-xs p-3 rounded-lg border ${isDestructive ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-nex-card border-nex-border text-nex-text-dim'}`}>
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">{request.detail}</pre>
            </div>
          )}

          {request.context?.targetPath && (
            <div className="text-xs">
              <span className="text-nex-text-muted">Target: </span>
              <code className="text-nex-accent font-mono">{request.context.targetPath}</code>
            </div>
          )}

          {showDenyReason && (
            <div>
              <label className="block text-xs text-nex-text-muted mb-1">Reason (optional):</label>
              <input
                type="text"
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                placeholder="Why are you denying this?"
                className="w-full bg-nex-card border border-nex-border rounded px-3 py-2 text-xs text-nex-text outline-none focus:border-nex-accent/50"
                autoFocus
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-nex-border bg-nex-bg flex flex-wrap gap-2 justify-end">
          <button
            onClick={() => setShowDenyReason(!showDenyReason)}
            className="px-3 py-2 text-xs text-nex-text-dim hover:text-nex-text rounded-lg hover:bg-nex-card transition-all"
          >
            {showDenyReason ? 'Cancel' : 'Deny with reason'}
          </button>

          <button
            onClick={handleDeny}
            className="px-4 py-2 text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-all flex items-center gap-1.5 border border-red-500/30"
          >
            <Ban size={12} /> Deny
          </button>

          <button
            onClick={() => handleAllow('once')}
                aria-label="Allow once"
            className="px-4 py-2 text-xs font-medium bg-nex-card border border-nex-border text-nex-text hover:border-nex-accent/50 rounded-lg transition-all flex items-center gap-1.5"
          >
            <Check size={12} /> Allow Once
          </button>

          <button
            onClick={() => handleAllow('session')}
                aria-label="Allow for this session"
            className="px-4 py-2 text-xs font-medium bg-nex-card border border-nex-border text-nex-text hover:border-nex-accent/50 rounded-lg transition-all flex items-center gap-1.5"
          >
            <Check size={12} /> Allow for Session
          </button>

          <button
            onClick={() => handleAllow('project')}
                aria-label="Always allow for this project"
            className="px-4 py-2 text-xs font-medium bg-nex-accent text-white hover:bg-nex-accent-light rounded-lg transition-all flex items-center gap-1.5"
          >
            <Check size={12} /> Allow for Project
          </button>
        </div>
      </div>
    </div>
  );
}
