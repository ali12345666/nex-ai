import React, { useState, useEffect } from 'react';
import {
  Brain, Search, FileSearch, Wrench, ShieldAlert, FileEdit,
  FlaskConical, CheckCircle2, XCircle, Loader2, Ban, RefreshCw,
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
}

interface StateInfo {
  icon: React.ReactNode;
  label: string;
  color: string;
}

function getEventState(event: AgentEvent): StateInfo {
  switch (event.type) {
    case 'task_created':
      return { icon: <Brain size={12} />, label: 'Task Created', color: 'text-nex-text-dim' };
    case 'planning_started':
      return { icon: <Brain size={12} className="animate-pulse" />, label: 'Planning', color: 'text-nex-accent' };
    case 'planning_completed':
      return { icon: <Brain size={12} />, label: 'Plan Ready', color: 'text-nex-accent-light' };
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

export default function AgentStateDisplay({ events, isRunning }: AgentStateDisplayProps) {
  if (events.length === 0) return null;

  // Show last 8 events (reverse chronological — newest at bottom for chat feel)
  const recent = events.slice(-12);
  const latestEvent = events[events.length - 1];

  return (
    <div className="border-t border-nex-border bg-nex-surface/50 px-4 py-2 max-h-[200px] overflow-y-auto">
      {recent.map((event, idx) => {
        const state = getEventState(event);
        const isLatest = idx === recent.length - 1;
        return (
          <div
            key={`${event.timestamp}-${idx}`}
            className={`flex items-center gap-2 py-1 text-[11px] ${state.color} ${isLatest ? 'font-medium' : 'opacity-60'}`}
          >
            <span className="shrink-0">{state.icon}</span>
            <span className="truncate">{state.label}</span>
            <span className="text-[9px] text-nex-text-muted ml-auto shrink-0">
              {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        );
      })}
      {isRunning && (
        <div className="flex items-center gap-2 py-1 text-[11px] text-nex-text-muted">
          <Loader2 size={11} className="animate-spin" />
          <span>Agent running...</span>
        </div>
      )}
    </div>
  );
}
