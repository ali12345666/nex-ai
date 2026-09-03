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
  // Phase 9 / P9-S5: wiring-layer tool services (opaque to agent core)
  toolContextExtras?: Record<string, unknown>;
  // Phase 111: Global task timeout (ms) — overrides default 300000 (5 min)
  timeoutMs?: number;
  // Phase 8: Context Propagation — optional fields for correlation + i18n.
  // All additive: existing tasks without these fields continue to work.
  /** Chat conversation that spawned this task (for correlation + memory scope). */
  conversationId?: string;
  /** UI session ID (for permission scope + session-level memory grants). */
  sessionId?: string;
  /** Detected language (en/fa/...) for i18n-aware recovery/replan prompts. */
  language?: string;
  /**
   * Phase 8: Snapshot of the ORIGINAL tool params before MODIFY_AND_RETRY
   * modified them. Set when step.toolParams is changed by recovery. Useful
   * for auditing what the recovery engine changed.
   */
  originalToolParams?: Record<string, unknown>;
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
  // Phase 38: optional verification criteria (emitted by the planner or
  // populated by rePlanAfterObservation). When present, verifyToolResult is
  // called after the tool executes.
  verificationCriteria?: {
    expectedExitCode?: number;
    expectedOutputContains?: string[];
    expectedOutputRegex?: string;
    forbiddenOutputContains?: string[];
  };
  // Phase 38: marks a step as injected by the ReAct re-planner (mid-loop),
  // distinguishing it from planner-emitted steps. Used for telemetry.
  injectedByReAct?: boolean;
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
  // Phase 9 (additive — the "Future: citation" planned fields):
  /** source file path as shown to the user, e.g. "docs/auth.md" */
  source?: string;
  startLine?: number;
  endLine?: number;
  sectionTitle?: string;
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
  // Phase 7: extended recovery metadata
  /** 10-class error classification (transient_network/timeout/permission_denied/...). */
  errorClass?: 'transient_network' | 'timeout' | 'permission_denied' | 'invalid_arguments'
    | 'file_path' | 'model_inference' | 'tool_failure' | 'user_cancellation'
    | 'security_policy' | 'unknown';
  /** Recovery action taken (RETRY/MODIFY_AND_RETRY/REPLAN/SKIP/ABORT). */
  recoveryDecision?: 'RETRY' | 'MODIFY_AND_RETRY' | 'REPLAN' | 'SKIP' | 'ABORT';
  /** How many recovery attempts were made. */
  recoveryAttempts?: number;
  /** Whether the LLM analyzed this error (vs heuristic-only). */
  llmAnalyzed?: boolean;
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
  | 'log'
  // Phase 38: ReAct closed-loop events
  | 'react_decision'
  | 'replan_started'
  | 'replan_completed'
  // Phase 7: LLM Error Recovery events
  //   recovery_started    — engine began analyzing the failure (Orb → THINKING)
  //   recovery_decision   — engine decided the recovery action
  //   modify_retry_started — MODIFY_AND_RETRY: tool params modified, re-executing
  //   skip_executed        — SKIP: step skipped, continuing to next
  //   recovery_succeeded   — recovery action led to a successful outcome
  //   recovery_failed      — recovery exhausted all attempts (task will fail)
  | 'recovery_started'
  | 'recovery_decision'
  | 'modify_retry_started'
  | 'skip_executed'
  | 'recovery_succeeded'
  | 'recovery_failed';

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

// ─── Phase 38: ReAct Closed-Loop Decision Types ─────────────────────────────

/**
 * The decision returned by the ReAct re-planner after observing a tool result.
 *
 * - 'continue'      : proceed to the next planned step (the observation matched
 *                     expectations or was harmless — no re-plan needed).
 * - 'replan'        : discard the remaining plan and append new steps emitted
 *                     by the LLM. The new steps are inserted AFTER the current
 *                     step; the current step is marked completed.
 * - 'complete'      : the task is done — finalize immediately, skip remaining
 *                     steps. Use when the LLM judges the goal achieved early.
 * - 'abort'         : the task cannot succeed — fail immediately with the
 *                     given reason. Use when the LLM detects an unrecoverable
 *                     situation (e.g. wrong project, missing dependency).
 */
export type ReActAction = 'continue' | 'replan' | 'complete' | 'abort';

export interface ReActDecision {
  action: ReActAction;
  /** Human-readable reason for the decision (shown in UI + logged). */
  reason: string;
  /** Confidence 0..1 that this decision is correct. */
  confidence: number;
  /** When action='replan', the new steps to append to the plan. */
  newSteps?: Array<{
    description: string;
    tool?: string;
    params?: Record<string, any>;
    requiresPermission?: ToolPermission;
    verificationCriteria?: AgentStep['verificationCriteria'];
  }>;
  /** When action='complete', an optional final answer for the user. */
  finalAnswer?: string;
}

/**
 * Request payload for the re-planner LLM call.
 * Contains everything the LLM needs to decide the next action.
 */
export interface ReActRequest {
  /** The original user request (for context). */
  userRequest: string;
  /** The original intent detected by the planner. */
  intent?: string;
  /** Description of the step that just executed. */
  lastStepDescription: string;
  /** Name of the tool that just executed (if any). */
  lastToolName?: string;
  /** The tool result (success/error, output, data). */
  toolResult?: ToolResult;
  /** The observation built from the tool result (signals, modified files). */
  observation: Observation;
  /** The remaining planned steps (so the LLM knows what's left). */
  remainingSteps: Array<{ description: string; toolName?: string }>;
  /** How many steps have executed so far (for budget awareness). */
  stepsExecuted: number;
  /** Max steps allowed (for budget awareness). */
  maxSteps: number;
  /** Recent observations (the last few, for continuity). */
  recentObservations: Observation[];
  /** Project path (for tool selection context). */
  projectPath?: string;
  /** Available tools (so the LLM knows what it can call in a replan). */
  tools: ToolDefinition[];
  /** Streamed token callback (optional — for UI streaming). */
  onToken?: (chunk: string) => void;
}

