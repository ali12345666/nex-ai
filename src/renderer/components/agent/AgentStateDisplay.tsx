import React, { useState, useEffect } from 'react';
import {
  Brain, Search, FileSearch, Wrench, ShieldAlert, FileEdit,
  FlaskConical, CheckCircle2, XCircle, Loader2, Ban, RefreshCw,
  Cpu, Cloud, Square, Timer, Coins,
} from 'lucide-react';

export interface AgentEvent {
  type: string;
  taskId: string;
  stepId?: string;
  toolCallId?: string;
  timestamp: number;
  message: string;
  data?: any;
}

interface AgentStateDisplayProps {
  events: AgentEvent[];
  isRunning: boolean;
  /** Phase 8 / P8-E-1: live streamed model output */
  streamText?: string;
  streamPhase?: string | null;
  /** Phase 8 / P8-E-3: stop agent button */
  onStop?: () => void;
}

interface StateInfo {
  icon: React.ReactNode;
  label: string;
  color: string;
}

function getEventState(event: AgentEvent): StateInfo {
  switch (event.type) {
    case 'task_created':
      return { icon: <Brain size={12} />, label: event.message, color: 'text-nex-text-dim' };
    case 'planning_started':
      return { icon: <Brain size={12} className="animate-pulse" />, label: event.message, color: 'text-nex-accent' };
    case 'planning_completed':
      return { icon: <Brain size={12} />, label: event.message, color: 'text-nex-accent-light' };
    case 'step_started':
      return { icon: <Loader2 size={12} className="animate-spin" />, label: event.message.slice(0, 50), color: 'text-nex-accent' };
    case 'tool_call_started':
      return { icon: <Wrench size={12} className="animate-pulse" />, label: event.message, color: 'text-orange-400' };
    case 'tool_call_completed':
      return { icon: <Wrench size={12} />, label: event.message, color: 'text-nex-text-dim' };
    case 'permission_requested':
      return { icon: <ShieldAlert size={12} className="animate-pulse" />, label: 'Permission Required', color: 'text-yellow-400' };
    case 'permission_granted':
      return { icon: <ShieldAlert size={12} />, label: 'Permission Granted', color: 'text-green-400' };
    case 'permission_denied':
      return { icon: <ShieldAlert size={12} />, label: 'Permission Denied', color: 'text-red-400' };
    case 'diff_proposed':
      return { icon: <FileEdit size={12} />, label: event.message, color: 'text-blue-400' };
    case 'diff_accepted':
      return { icon: <FileEdit size={12} />, label: 'Changes Applied', color: 'text-green-400' };
    case 'diff_rejected':
      return { icon: <FileEdit size={12} />, label: 'Changes Rejected', color: 'text-red-400' };
    case 'observation':
      return { icon: <Search size={12} />, label: event.message.slice(0, 80), color: 'text-nex-text-dim' };
    case 'verification_started':
      return { icon: <FlaskConical size={12} className="animate-pulse" />, label: 'Verifying', color: 'text-purple-400' };
    case 'verification_completed':
      return { icon: <FlaskConical size={12} />, label: 'Verified', color: 'text-green-400' };
    case 'retry':
      return { icon: <RefreshCw size={12} className="animate-spin" />, label: event.message, color: 'text-yellow-400' };
    case 'step_completed':
      return { icon: <CheckCircle2 size={12} />, label: event.message, color: 'text-green-400' };
    case 'step_failed':
      return { icon: <XCircle size={12} />, label: event.message, color: 'text-red-400' };
    case 'task_completed':
      return { icon: <CheckCircle2 size={14} />, label: event.message, color: 'text-green-400' };
    case 'task_failed':
      return { icon: <XCircle size={14} />, label: event.message, color: 'text-red-400' };
    case 'task_cancelled':
      return { icon: <Ban size={14} />, label: event.message, color: 'text-red-400' };
    default:
      return { icon: <Loader2 size={12} />, label: event.message.slice(0, 60), color: 'text-nex-text-dim' };
  }
}

/** Phase 8 / P8-E-2: derive backend + model + usage from the event stream */
interface TaskMeta {
  backend?: 'local' | 'online';
  model?: string;
  routingReason?: string;
  usage?: { tokensGenerated?: number; durationMs?: number };
  stepProgress?: { current: number; total: number };
  lastToolMs?: number;
}

function deriveTaskMeta(events: AgentEvent[]): TaskMeta {
  const meta: TaskMeta = {};
  for (const e of events) {
    if (e.type === 'task_created' && e.data) {
      meta.backend = e.data.backend;
      meta.model = e.data.modelName || e.data.model;
      if (e.data.routingReason) meta.routingReason = e.data.routingReason;
    }
    if (e.type === 'planning_completed' && e.data) {
      if (e.data.usage) meta.usage = e.data.usage;
      if (e.data.model) meta.model = e.data.model;
      if (e.data.backend) meta.backend = e.data.backend;
    }
    if (e.type === 'step_started' && e.data && e.data.stepIndex !== undefined && e.data.totalSteps !== undefined) {
      meta.stepProgress = { current: e.data.stepIndex + 1, total: e.data.totalSteps };
    }
    if (e.type === 'tool_call_completed' && e.data && typeof e.data.durationMs === 'number') {
      meta.lastToolMs = e.data.durationMs;
    }
  }
  return meta;
}

export default function AgentStateDisplay({
  events, isRunning, streamText, streamPhase, onStop,
}: AgentStateDisplayProps) {
  const [elapsed, setElapsed] = useState(0);

  // Live tool timer: tick while a tool_call_started has no completion yet
  const activeTool = [...events].reverse().find((e) => e.type === 'tool_call_started');
  const toolCompleted = [...events].reverse().find((e) => e.type === 'tool_call_completed');
  const toolActive =
    isRunning && !!activeTool && (!toolCompleted || toolCompleted.timestamp < activeTool.timestamp);

  useEffect(() => {
    if (!toolActive) return;
    const t = setInterval(() => {
      if (activeTool) setElapsed(Date.now() - activeTool.timestamp);
    }, 200);
    return () => clearInterval(t);
  }, [toolActive, activeTool]);

  if (events.length === 0 && !streamText) return null;

  const meta = deriveTaskMeta(events);

  // Show last events (reverse chronological — newest at bottom for chat feel)
  const recent = events.slice(-12);

  return (
    <div className="border-t border-nex-border bg-nex-surface/50">
      {/* ── P8-E-2: header bar — backend badge + model + usage + progress ── */}
      {(meta.backend || meta.model || meta.stepProgress) && (
        <div className="flex items-center gap-2 px-4 pt-2 text-[11px] flex-wrap">
          {meta.backend && (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium border ${
                meta.backend === 'online'
                  ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                  : 'text-sky-300 border-sky-500/30 bg-sky-500/10'
              }`}
              title={meta.routingReason || undefined}
            >
              {meta.backend === 'online' ? <Cloud size={10} /> : <Cpu size={10} />}
              {meta.backend === 'online' ? 'Online' : 'Local'}
            </span>
          )}
          {meta.model && (
            <span className="text-nex-text-dim font-mono truncate max-w-[220px]" title={meta.model}>
              {meta.model}
            </span>
          )}
          {meta.usage?.tokensGenerated !== undefined && (
            <span className="inline-flex items-center gap-1 text-nex-text-muted" title="planning tokens">
              <Coins size={10} />
              {meta.usage.tokensGenerated} tok
            </span>
          )}
          {meta.usage?.durationMs !== undefined && (
            <span className="inline-flex items-center gap-1 text-nex-text-muted" title="planning duration">
              <Timer size={10} />
              {(meta.usage.durationMs / 1000).toFixed(1)}s
            </span>
          )}
          {meta.stepProgress && (
            <span className="text-nex-text-dim">
              step {meta.stepProgress.current}/{meta.stepProgress.total}
            </span>
          )}
          {/* progress bar */}
          {meta.stepProgress && (
            <div className="flex-1 min-w-[80px] h-1 rounded-full bg-nex-border overflow-hidden">
              <div
                className="h-full bg-nex-accent transition-all"
                style={{ width: `${Math.round((meta.stepProgress.current / Math.max(1, meta.stepProgress.total)) * 100)}%` }}
              />
            </div>
          )}
          {/* P8-E-3: Stop agent */}
          {isRunning && onStop && (
            <button
              onClick={onStop}
              className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
              title="Stop Agent"
            >
              <Square size={9} />
              Stop
            </button>
          )}
        </div>
      )}

      {/* ── P8-E-1: live streaming preview ── */}
      {streamText && (
        <div className="px-4 py-2">
          <div className="flex items-center gap-2 text-[11px] text-nex-accent mb-1">
            <Loader2 size={11} className="animate-spin" />
            <span className="capitalize">{streamPhase || 'thinking'}…</span>
            <span className="text-nex-text-muted ml-auto">{streamText.length} chars</span>
          </div>
          <pre className="text-[11px] text-nex-text-dim font-mono whitespace-pre-wrap break-words max-h-24 overflow-y-auto bg-nex-bg/50 rounded border border-nex-border/50 p-2">
            {streamText.slice(-800)}
          </pre>
        </div>
      )}

      {/* ── event log ── */}
      <div className="px-4 py-2 max-h-[200px] overflow-y-auto">
        {recent.map((event, idx) => {
          const state = getEventState(event);
          const isLatest = idx === recent.length - 1;
          const toolMs =
            event.type === 'tool_call_completed' && event.data?.durationMs !== undefined
              ? `${(event.data.durationMs / 1000).toFixed(1)}s`
              : null;
          return (
            <div
              key={`${event.timestamp}-${idx}`}
              className={`flex items-center gap-2 py-1 text-[11px] ${state.color} ${isLatest ? 'font-medium' : 'opacity-60'}`}
            >
              <span className="shrink-0">{state.icon}</span>
              <span className="truncate">{state.label}</span>
              {toolMs && (
                <span className="text-[9px] text-nex-text-muted shrink-0 inline-flex items-center gap-0.5">
                  <Timer size={8} />
                  {toolMs}
                </span>
              )}
              <span className="text-[9px] text-nex-text-muted ml-auto shrink-0">
                {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          );
        })}
        {toolActive && activeTool && (
          <div className="flex items-center gap-2 py-1 text-[11px] text-orange-400">
            <Wrench size={11} className="animate-pulse" />
            <span className="truncate">{activeTool.message}</span>
            <span className="text-[9px] text-nex-text-muted ml-auto shrink-0 inline-flex items-center gap-0.5">
              <Timer size={8} />
              {(elapsed / 1000).toFixed(1)}s
            </span>
          </div>
        )}
        {isRunning && !toolActive && !streamText && (
          <div className="flex items-center gap-2 py-1 text-[11px] text-nex-text-muted">
            <Loader2 size={11} className="animate-spin" />
            <span>Agent running…</span>
          </div>
        )}
      </div>
    </div>
  );
}
