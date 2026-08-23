/**
 * NEX AI — Agent State Types
 *
 * All Agent state is defined here. State lives OUTSIDE the ChatPanel —
 * it's persisted in Task Memory and accessible via IPC from any UI component.
 *
 * Architecture:
 *
 *   AgentTask (top-level)
 *     ├── userRequest
 *     ├── plan: AgentStep[]
 *     ├── currentStepIndex
 *     ├── context: AgentContext
 *     ├── toolCalls: ToolCall[]
 *     ├── observations: Observation[]
 *     ├── errors: AgentError[]
 *     ├── verification: VerificationResult[]
 *     ├── permissions: PermissionGrant[]
 *     └── cancellation: CancellationToken
 */

import type { ChatMessage } from '../ai/runtime';
import type { ToolDefinition, ToolResult, ToolPermission } from '../ai/tool-registry';

// ─── Task ────────────────────────────────────────────────────────────────────

export type AgentTaskStatus =
  | 'pending'           // not started
  | 'planning'          // planner is generating steps
  | 'awaiting_permission' // waiting for user to approve a tool call
  | 'awaiting_diff_approval' // waiting for user to accept/reject a diff
  | 'executing'         // a tool is running
  | 'observing'         // analyzing tool output
  | 'verifying'         // verifying the task succeeded
  | 'retrying'          // retrying after a failed step
  | 'completed'         // task finished successfully
  | 'failed'            // task finished with error
  | 'cancelled'         // user pressed STOP
  | 'paused';           // user paused (not implemented yet)

export interface AgentTask {
  id: string;                       // UUID
  userRequest: string;
  status: AgentTaskStatus;
  intent?: string;                   // e.g. 'fix-bug', 'refactor', 'explain'
  // Phase 8 / P8-B: which runtime executes this task
  backend?: 'local' | 'online';
  onlineModelName?: string;          // e.g. 'GLM 5.3' (display only)
  plan: AgentStep[];
  currentStepIndex: number;
  context: AgentContext;
  toolCalls: ToolCallRecord[];
  observations: Observation[];
  errors: AgentError[];
  verification: VerificationResult[];
  permissions: PermissionGrantRecord[];
  // Limits
  maxSteps: number;
  maxToolCalls: number;
  maxRetries: number;
  maxExecutionTimeMs: number;
  // Metadata
  createdAt: number;
  completedAt?: number;
  // Cancellation
  cancelled: boolean;
  cancelReason?: string;
}

export interface AgentStep {
  id: string;
  index: number;
  description: string;              // human-readable, what this step does
  toolName?: string;                // tool to call (if any)
  toolParams?: Record<string, any>;
  requiresPermission?: ToolPermission;
  requiresDiffApproval?: boolean;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  startedAt?: number;
  completedAt?: number;
  error?: string;
  // Optional retry count
  retryCount?: number;
}

export interface AgentContext {
  projectPath?: string;
  activeFile?: string;
  // Relevant context items (kept token-aware)
  relevantFiles: ContextFile[];
  relevantMemory: ContextMemoryItem[];
  relevantKnowledge: ContextKnowledgeItem[];
  recentConversation: ChatMessage[];
  // Token budget
  maxContextTokens: number;
  estimatedTokensUsed: number;
}

export interface ContextFile {
  path: string;
  name: string;
  // Selected lines (for token-aware context)
  startLine?: number;
  endLine?: number;
  content: string;
  relevanceScore: number;        // 0-1
  reason: string;                 // why this file was included
}

export interface ContextMemoryItem {
  store: 'user' | 'project' | 'task' | 'knowledge' | 'session';
  key: string;
  value: any;
  relevanceScore: number;
}

export interface ContextKnowledgeItem {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  content: string;
  score: number;
  // Future: citation
}

// ─── Tool Calls ─────────────────────────────────────────────────────────────

export interface ToolCallRecord {
  id: string;
  stepId: string;
  toolName: string;
  toolDefinition: ToolDefinition;
  params: Record<string, any>;
  permission: ToolPermission;
  permissionStatus: 'pending' | 'granted' | 'denied' | 'skipped';
  result?: ToolResult;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  retryCount: number;
  // Snapshot of the project state before/after (for diff)
  beforeState?: { files: Array<{ path: string; content: string }> };
  afterState?: { files: Array<{ path: string; content: string }> };
}

// ─── Observations ──────────────────────────────────────────────────────────

export interface Observation {
  id: string;
  toolCallId: string;
  stepId: string;
  // Raw output
  rawOutput?: string;
  // Structured data from the tool
  data?: any;
  // Agent's interpretation (set during observing phase)
  interpretation?: string;
  // Detected issues / errors / signals
  signals: AgentSignal[];
  // Files that were modified by this tool call
  modifiedFiles: Array<{ path: string; before?: string; after: string }>;
  timestamp: number;
}

export interface AgentSignal {
  type: 'success' | 'error' | 'warning' | 'info' | 'needs-attention';
  message: string;
  // Optional details (e.g. error code, line number)
  details?: Record<string, any>;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export interface AgentError {
  id: string;
  stepId?: string;
  toolCallId?: string;
  type: 'tool_error' | 'permission_denied' | 'timeout' | 'max_retries'
      | 'max_steps' | 'max_tool_calls' | 'invalid_state' | 'cancelled'
      | 'llm_error' | 'context_too_large' | 'unknown';
  message: string;
  details?: any;
  timestamp: number;
  // Recovery info
  recovered?: boolean;
  recoveryAction?: string;
}

// ─── Verification ───────────────────────────────────────────────────────────

export interface VerificationResult {
  id: string;
  stepId: string;
  // What we're verifying (e.g. "build passes", "tests pass")
  description: string;
  // How we verified (tool call that produced the result)
  verifiedBy: 'tool_call' | 'manual' | 'inferred';
  verifyingToolCallId?: string;
  // Result
  status: 'verified' | 'failed' | 'inconclusive';
  details?: string;
  timestamp: number;
}

// ─── Permission Grants ──────────────────────────────────────────────────────

export interface PermissionGrantRecord {
  id: string;
  toolName: string;
  permission: ToolPermission;
  scope: 'once' | 'task' | 'session' | 'project' | 'global';
  grantedAt: number;
  reason?: string;
  // The original request that led to this grant
  requestId?: string;
  // Was the user shown a UI prompt?
  promptedViaUI: boolean;
}

// ─── Cancellation Token ────────────────────────────────────────────────────

export interface CancellationToken {
  cancelled: boolean;
  reason?: string;
  // Listeners that fire when cancellation is requested
  listeners: Array<() => void>;
  /** Request cancellation. Returns true if this is the first request. */
  cancel: (reason?: string) => boolean;
  /** Register a listener that fires when cancellation is requested. */
  onCancel: (listener: () => void) => void;
  /** Throw if cancelled. Called at safe points in the agent loop. */
  throwIfCancelled: () => void;
}

export function createCancellationToken(): CancellationToken {
  const token: CancellationToken = {
    cancelled: false,
    listeners: [],
    cancel: (reason?: string) => {
      if (token.cancelled) return false;
      token.cancelled = true;
      token.reason = reason || 'cancelled by user';
      // Fire listeners
      for (const listener of token.listeners) {
        try { listener(); } catch {}
      }
      token.listeners = [];
      return true;
    },
    onCancel: (listener: () => void) => {
      if (token.cancelled) {
        // Already cancelled — fire immediately
        try { listener(); } catch {}
      } else {
        token.listeners.push(listener);
      }
    },
    throwIfCancelled: () => {
      if (token.cancelled) {
        const err = new Error(`Agent cancelled: ${token.reason || 'no reason'}`);
        (err as any).code = 'AGENT_CANCELLED';
        throw err;
      }
    },
  };
  return token;
}

// ─── Agent Limits (configurable per-task) ─────────────────────────────────

export interface AgentLimits {
  maxSteps: number;                  // default 20
  maxToolCalls: number;              // default 50
  maxRetries: number;                // default 3
  maxExecutionTimeMs: number;        // default 5 minutes
}

export const DEFAULT_AGENT_LIMITS: AgentLimits = {
  maxSteps: 20,
  maxToolCalls: 50,
  maxRetries: 3,
  maxExecutionTimeMs: 5 * 60 * 1000,
};

// ─── Agent Status Events (for UI streaming) ─────────────────────────────────

export type AgentEventType =
  | 'task_created'
  | 'planning_started'
  | 'planning_completed'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'permission_requested'
  | 'permission_granted'
  | 'permission_denied'
  | 'diff_proposed'
  | 'diff_accepted'
  | 'diff_rejected'
  | 'observation'
  | 'verification_started'
  | 'verification_completed'
  | 'retry'
  | 'task_completed'
  | 'task_failed'
  | 'task_cancelled'
  // Phase 8 / P8-E-1: streamed model tokens (planning/final response)
  | 'agent_token'
  | 'log';

export interface AgentEvent {
  type: AgentEventType;
  taskId: string;
  stepId?: string;
  toolCallId?: string;
  timestamp: number;
  message: string;
  data?: any;
}

export type AgentEventListener = (event: AgentEvent) => void;
