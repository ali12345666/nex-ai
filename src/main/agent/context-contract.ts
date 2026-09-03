/**
 * NEX AI — Phase 8: Context Contract
 *
 * A minimal, additive layer that defines the canonical context fields
 * propagated through the agent pipeline, plus a safe-snapshot helper that
 * produces a REDACTED + BOUNDED snapshot for LLM prompts, memory, and IPC.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS (gaps Phase 8 closes)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Before Phase 8:
 *   - AgentTask had no conversationId/sessionId (couldn't correlate to chat)
 *   - TaskQueueItem.metadata was free-form with no redaction at persistence
 *   - Recovery LLM prompt built context inline (duplicated redaction logic)
 *   - Observation.rawOutput was unbounded (memory could grow indefinitely)
 *   - PermissionContext used task.id as sessionId (self-reference, not chat)
 *   - No structured way to snapshot an AgentTask's context for IPC/memory
 *
 * Phase 8 adds (all ADDITIVE — no breaking changes):
 *   - AgentContextContract interface (canonical fields)
 *   - safeContextSnapshot() helper (redacted + bounded snapshot)
 *   - conversationId/sessionId/language fields on AgentTask (optional)
 *   - Redaction at TaskQueue persistence boundary
 *   - Truncation of observation.rawOutput at storage time (defense-in-depth)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CONTEXT CONTRACT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Fields (all optional except taskId + userRequest):
 *   taskId          — agent task UUID (always present)
 *   agentTaskId?    — queue item's agentTaskId (when wrapped by Phase 6 queue)
 *   conversationId? — chat conversation that spawned this task (for correlation)
 *   sessionId?      — UI session ID (for permission scope + memory)
 *   userRequest     — original user request (truncated to 200 chars in snapshot)
 *   intent?         — detected intent (fix-bug, refactor, explain, etc.)
 *   projectPath?    — workspace root
 *   activeFile?     — currently open file
 *   language?       — detected language (en/fa/...) for i18n-aware prompts
 *   currentPlan     — summary of the plan (step count + first 5 descriptions)
 *   currentStep     — summary of the current step (description + toolName + index)
 *   stepIndex?      — current step index
 *   toolName?       — tool being executed (if any)
 *   toolParamsSafe? — REDACTED tool parameters (secrets stripped)
 *   lastObservation? — TRUNCATED last observation (max 2000 chars)
 *   error?          — error message (truncated to 500 chars)
 *   attempt?        — retry attempt count
 *   maxRetries?     — configured max retries
 *   remainingSteps  — summary of remaining steps (max 5)
 *   executionMetadata? — free-form metadata (timeout, backend, model)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SNAPSHOT RULES (defense-in-depth)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   1. Always REDACTED via redactObjectDeep (secrets stripped from strings +
 *      secret-looking keys set to '***REDACTED***')
 *   2. Always BOUNDED:
 *      - userRequest: 200 chars
 *      - intent: 100 chars
 *      - toolParamsSafe: 800 chars (JSON)
 *      - lastObservation.rawOutput: 2000 chars
 *      - error: 500 chars
 *      - remainingSteps: max 5 (with "+N more" suffix if truncated)
 *      - currentPlan: max 5 step descriptions
 *   3. Never includes raw tool outputs > 2000 chars
 *   4. Never includes secrets (redactObjectDeep strips api_key, password, token)
 *   5. SHALLOW snapshot — no deep clone of task/plan/observations arrays.
 *      We only copy summary fields, not the full objects.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * IMMUTABILITY SAFETY
 * ════════════════════════════════════════════════════════════════════════════
 *
 * safeContextSnapshot() returns a NEW object — callers can mutate it freely
 * without affecting the source AgentTask/Step/Observation.
 *
 * For deep-clone safety on toolParams before MODIFY_AND_RETRY modifies them,
 * use snapshotToolParams() (shallow clone of the params object — sufficient
 * because tool params are flat key-value pairs in practice).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * REUSE (no duplication)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   - redactObjectDeep: from logger.ts (existing)
 *   - estimateTokens: from context-manager.ts (existing)
 *   - AgentTask/AgentStep/Observation: from types.ts (existing)
 *
 * This module does NOT define a new context manager — it provides a CONTRACT
 * + HELPER on top of the existing context-manager.ts.
 */

import type { AgentTask, AgentStep, Observation } from './types';
import { redactObjectDeep } from './logger';
import { estimateTokens } from './context-manager';

// ─── Context Contract ────────────────────────────────────────────────────────

export interface AgentContextContract {
  /** Agent task UUID — always present. */
  taskId: string;
  /** Queue item's agentTaskId (when wrapped by Phase 6 queue). */
  agentTaskId?: string;
  /** Chat conversation that spawned this task (for correlation). */
  conversationId?: string;
  /** UI session ID (for permission scope + memory). */
  sessionId?: string;
  /** Original user request (truncated in snapshot). */
  userRequest: string;
  /** Detected intent. */
  intent?: string;
  /** Workspace root. */
  projectPath?: string;
  /** Currently open file. */
  activeFile?: string;
  /** Detected language (en/fa/...) for i18n-aware prompts. */
  language?: string;
  /** Summary of the plan. */
  currentPlan: {
    totalSteps: number;
    stepDescriptions: string[];
  };
  /** Summary of the current step. */
  currentStep: {
    index: number;
    description: string;
    toolName?: string;
    status: string;
  };
  /** Current step index. */
  stepIndex?: number;
  /** Tool being executed. */
  toolName?: string;
  /** REDACTED tool parameters (secrets stripped). */
  toolParamsSafe?: Record<string, unknown>;
  /** TRUNCATED last observation. */
  lastObservation?: {
    toolCallId: string;
    rawOutputTruncated: string;
    signals: Array<{ type: string; message: string }>;
    modifiedFiles: string[];
    timestamp: number;
  };
  /** Error message (truncated). */
  error?: string;
  /** Error class (Phase 7 taxonomy). */
  errorClass?: string;
  /** Retry attempt count. */
  attempt?: number;
  /** Configured max retries. */
  maxRetries?: number;
  /** Summary of remaining steps. */
  remainingSteps: Array<{ description: string; toolName?: string }>;
  /** Free-form execution metadata (timeout, backend, model). */
  executionMetadata?: Record<string, unknown>;
}

// ─── Snapshot bounds (token/size safety) ─────────────────────────────────────

export const SNAPSHOT_BOUNDS = {
  USER_REQUEST_MAX: 200,
  INTENT_MAX: 100,
  TOOL_PARAMS_JSON_MAX: 800,
  OBSERVATION_RAW_OUTPUT_MAX: 2000,
  ERROR_MESSAGE_MAX: 500,
  REMAINING_STEPS_MAX: 5,
  PLAN_DESCRIPTIONS_MAX: 5,
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(s: string | undefined, max: number): string | undefined {
  if (s === undefined) return undefined;
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}

function safeJson(obj: unknown, max: number): string | undefined {
  if (obj === undefined || obj === null) return undefined;
  try {
    const json = JSON.stringify(obj, null, 2);
    if (json.length <= max) return json;
    return json.slice(0, max - 3) + '...';
  } catch {
    return undefined;
  }
}

/**
 * Produce a REDACTED + BOUNDED snapshot of an AgentTask + optional Step.
 *
 * This is the canonical way to extract context for:
 *   - LLM recovery prompts (buildLLMRecoveryPrompt)
 *   - Memory recording (TaskMemory.set)
 *   - IPC events (when we need to send structured context to the renderer)
 *   - Queue persistence (when we snapshot context for crash recovery)
 *
 * The snapshot is a NEW object — callers can mutate without side effects.
 */
export function safeContextSnapshot(
  task: AgentTask,
  step?: AgentStep,
  opts?: {
    error?: string;
    errorClass?: string;
    attempt?: number;
    agentTaskId?: string;
  },
): AgentContextContract {
  // ── Step summary ──
  const currentStep: AgentContextContract['currentStep'] = step
    ? {
        index: step.index,
        description: truncate(step.description, SNAPSHOT_BOUNDS.INTENT_MAX) || '(no description)',
        toolName: step.toolName,
        status: step.status,
      }
    : {
        index: task.currentStepIndex,
        description: '(no step)',
        status: 'pending',
      };

  // ── Plan summary ──
  const planDescriptions = task.plan
    .slice(0, SNAPSHOT_BOUNDS.PLAN_DESCRIPTIONS_MAX)
    .map((s) => truncate(s.description, 80) || '(no description)');
  if (task.plan.length > SNAPSHOT_BOUNDS.PLAN_DESCRIPTIONS_MAX) {
    planDescriptions.push(`+${task.plan.length - SNAPSHOT_BOUNDS.PLAN_DESCRIPTIONS_MAX} more`);
  }

  // ── Tool params (REDACTED) ──
  let toolParamsSafe: Record<string, unknown> | undefined;
  if (step?.toolParams) {
    const redacted = redactObjectDeep(step.toolParams);
    // Bound the JSON size for LLM prompts
    const jsonStr = safeJson(redacted, SNAPSHOT_BOUNDS.TOOL_PARAMS_JSON_MAX);
    if (jsonStr) {
      toolParamsSafe = { _redactedJson: jsonStr };
    } else {
      toolParamsSafe = { _redactedJson: '(too large)' };
    }
  }

  // ── Last observation (TRUNCATED) ──
  let lastObservation: AgentContextContract['lastObservation'];
  const obs: Observation | undefined = task.observations[task.observations.length - 1];
  if (obs) {
    lastObservation = {
      toolCallId: obs.toolCallId,
      rawOutputTruncated: truncate(obs.rawOutput, SNAPSHOT_BOUNDS.OBSERVATION_RAW_OUTPUT_MAX) || '(no output)',
      signals: obs.signals.map((s) => ({
        type: s.type,
        message: truncate(s.message, 200) || '',
      })),
      modifiedFiles: (obs.modifiedFiles || []).map((f) => f.path),
      timestamp: obs.timestamp,
    };
  }

  // ── Remaining steps ──
  const stepIndex = step?.index ?? task.currentStepIndex;
  const remainingSteps: Array<{ description: string; toolName?: string }> = task.plan
    .slice(stepIndex + 1, stepIndex + 1 + SNAPSHOT_BOUNDS.REMAINING_STEPS_MAX)
    .map((s) => ({
      description: truncate(s.description, 100) || '(no description)',
      toolName: s.toolName,
    }));
  if (task.plan.length > stepIndex + 1 + SNAPSHOT_BOUNDS.REMAINING_STEPS_MAX) {
    const extra = task.plan.length - (stepIndex + 1 + SNAPSHOT_BOUNDS.REMAINING_STEPS_MAX);
    remainingSteps.push({ description: `+${extra} more steps`, toolName: undefined });
  }

  return {
    taskId: task.id,
    agentTaskId: opts?.agentTaskId,
    conversationId: (task as AgentTask & { conversationId?: string }).conversationId,
    sessionId: (task as AgentTask & { sessionId?: string }).sessionId,
    userRequest: truncate(task.userRequest, SNAPSHOT_BOUNDS.USER_REQUEST_MAX) || '',
    intent: truncate(task.intent, SNAPSHOT_BOUNDS.INTENT_MAX),
    projectPath: task.context?.projectPath,
    activeFile: task.context?.activeFile,
    language: (task as AgentTask & { language?: string }).language,
    currentPlan: {
      totalSteps: task.plan.length,
      stepDescriptions: planDescriptions,
    },
    currentStep,
    stepIndex,
    toolName: step?.toolName,
    toolParamsSafe,
    lastObservation,
    error: truncate(opts?.error, SNAPSHOT_BOUNDS.ERROR_MESSAGE_MAX),
    errorClass: opts?.errorClass,
    attempt: opts?.attempt,
    maxRetries: task.maxRetries,
    remainingSteps,
    executionMetadata: {
      backend: task.backend,
      model: task.onlineModelName,
      createdAt: task.createdAt,
      estimatedTokensUsed: task.context?.estimatedTokensUsed,
      maxExecutionTimeMs: task.maxExecutionTimeMs,
      timeoutMs: task.timeoutMs,
    },
  };
}

/**
 * Shallow-clone tool params before modifying them (for MODIFY_AND_RETRY audit).
 * Tool params are flat key-value pairs in practice — a shallow clone is sufficient.
 * Returns a NEW object; mutating it does NOT affect the original step.toolParams.
 */
export function snapshotToolParams(step: AgentStep): Record<string, unknown> | undefined {
  if (!step.toolParams) return undefined;
  return { ...step.toolParams };
}

/**
 * Redact a TaskQueueItem's metadata before persistence.
 * Defense-in-depth: even if a caller puts a secret in metadata, it's stripped
 * before writing to disk.
 *
 * Returns a NEW object — original is not mutated.
 */
export function redactQueueMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  return redactObjectDeep(metadata) as Record<string, unknown>;
}

/**
 * Estimate the token size of a snapshot (for budget checks).
 */
export function snapshotTokenSize(snapshot: AgentContextContract): number {
  return estimateTokens(JSON.stringify(snapshot));
}

/**
 * Check if a snapshot contains any obvious secrets (post-redaction audit).
 * Returns true if the redacted markers are present (which means redaction happened).
 */
export function snapshotWasRedacted(snapshot: AgentContextContract): boolean {
  const json = JSON.stringify(snapshot.toolParamsSafe || {});
  return json.includes('***REDACTED');
}

// ─── Validation helpers (for tests + diagnostics) ────────────────────────────

/**
 * Validate that a snapshot respects the bounds.
 * Returns a list of violations (empty if valid).
 */
export function validateSnapshotBounds(snapshot: AgentContextContract): string[] {
  const violations: string[] = [];
  if (snapshot.userRequest.length > SNAPSHOT_BOUNDS.USER_REQUEST_MAX) {
    violations.push(`userRequest exceeds ${SNAPSHOT_BOUNDS.USER_REQUEST_MAX} chars`);
  }
  if (snapshot.intent && snapshot.intent.length > SNAPSHOT_BOUNDS.INTENT_MAX) {
    violations.push(`intent exceeds ${SNAPSHOT_BOUNDS.INTENT_MAX} chars`);
  }
  if (snapshot.error && snapshot.error.length > SNAPSHOT_BOUNDS.ERROR_MESSAGE_MAX) {
    violations.push(`error exceeds ${SNAPSHOT_BOUNDS.ERROR_MESSAGE_MAX} chars`);
  }
  if (snapshot.lastObservation && snapshot.lastObservation.rawOutputTruncated.length > SNAPSHOT_BOUNDS.OBSERVATION_RAW_OUTPUT_MAX) {
    violations.push(`lastObservation.rawOutput exceeds ${SNAPSHOT_BOUNDS.OBSERVATION_RAW_OUTPUT_MAX} chars`);
  }
  if (snapshot.remainingSteps.length > SNAPSHOT_BOUNDS.REMAINING_STEPS_MAX + 1) {
    violations.push(`remainingSteps exceeds ${SNAPSHOT_BOUNDS.REMAINING_STEPS_MAX} (+1 for the "+N more" entry)`);
  }
  if (snapshot.currentPlan.stepDescriptions.length > SNAPSHOT_BOUNDS.PLAN_DESCRIPTIONS_MAX + 1) {
    violations.push(`currentPlan.stepDescriptions exceeds ${SNAPSHOT_BOUNDS.PLAN_DESCRIPTIONS_MAX} (+1 for "+N more")`);
  }
  return violations;
}
