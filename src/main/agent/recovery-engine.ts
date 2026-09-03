/**
 * NEX AI — Phase 7: Recovery Engine
 *
 * Decides how to recover from a failed Agent step or tool call.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * RECOVERY DECISIONS (5)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   RETRY              — re-execute the same step (with backoff for transient)
 *   MODIFY_AND_RETRY   — modify tool params via heuristic/LLM, then re-execute
 *   REPLAN             — discard remaining steps; ask re-planner for new ones
 *   SKIP               — skip this step (mark 'skipped'); continue to next
 *   ABORT              — mark task 'failed'; exit the loop
 *
 * ════════════════════════════════════════════════════════════════════════════
 * DECISION MATRIX (heuristic-first — offline-capable)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   transient_network (retries < max)         → RETRY (exponential backoff)
 *   transient_network (retries == max)        → REPLAN or ABORT
 *   timeout (retries < max)                    → RETRY (longer backoff)
 *   timeout (retries == max)                   → REPLAN or ABORT
 *   permission_denied                          → SKIP or ABORT (NEVER auto-retry)
 *   invalid_arguments                          → MODIFY_AND_RETRY (if heuristic can fix)
 *                                              → ABORT otherwise
 *   file_path                                  → REPLAN (different path/tool)
 *   model_inference (retries < 1)              → RETRY (once)
 *   model_inference (retries == 1)             → SKIP or ABORT
 *   tool_failure (retries < max)               → RETRY (one retry)
 *   tool_failure (retries == max)              → REPLAN or ABORT
 *   user_cancellation                          → ABORT (NEVER retry)
 *   security_policy                            → SKIP or ABORT (NEVER auto-retry)
 *   unknown (retries < 1)                      → RETRY (once)
 *   unknown (retries == 1)                     → ABORT
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LLM FALLBACK (optional — offline-capable)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * When the heuristic decision is ambiguous (e.g. 'unknown' class on first
 * attempt, or a complex tool_failure with rich error text), the engine can
 * optionally invoke the local LLM to analyze the error and pick a decision.
 *
 * The LLM is NEVER the only path:
 *   - Heuristic path runs FIRST and decides for clear-cut errors.
 *   - LLM fallback runs ONLY when:
 *     a) the heuristic path returns 'ambiguous', AND
 *     b) a local AIRuntime is available (Qwen3-8B loaded), AND
 *     c) we're not in offline-only mode.
 *   - LLM analysis failure → fall back to heuristic decision.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY (Phase 7 §8)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   - permission_denied → NEVER auto-retry (would repeat the same denial)
 *   - security_policy   → NEVER auto-retry (security gate decision is final)
 *   - user_cancellation → NEVER retry (user explicitly stopped)
 *   - RETRY/MODIFY/REPLAN re-execute the same operation, which still goes
 *     through executeToolWithPermission — the permission gate is NEVER bypassed.
 *
 * Pure module — no side effects. The caller (core.ts) emits events and
 * executes the recovery action.
 */

import type { AIRuntime } from '../ai/runtime';
import type { LocalModelInfo } from '../ai/model-registry';
import type { AgentStep, AgentTask, Observation } from './types';
import {
  classifyError,
  type ErrorClass,
  type ErrorClassification,
} from './error-classifier';
import { AgentLogger } from './logger';
import { redactObjectDeep } from './logger';
// Phase 8: Context Propagation — reuse the canonical snapshot helper
import { safeContextSnapshot, type AgentContextContract } from './context-contract';

// ─── Recovery decisions ──────────────────────────────────────────────────────

export type RecoveryAction = 'RETRY' | 'MODIFY_AND_RETRY' | 'REPLAN' | 'SKIP' | 'ABORT';

export interface RecoveryDecision {
  action: RecoveryAction;
  /** Why this action was chosen (shown to user + logged). */
  reason: string;
  /** The error classification that drove this decision. */
  errorClass: ErrorClass;
  /** Backoff in ms before RETRY/MODIFY_AND_RETRY (0 for REPLAN/SKIP/ABORT). */
  backoffMs: number;
  /** Whether the decision came from the LLM (true) or heuristic (false). */
  llmAnalyzed: boolean;
  /** Confidence 0..1 that this is the right action. */
  confidence: number;
  /** For MODIFY_AND_RETRY: optional modified tool params. */
  modifiedParams?: Record<string, unknown>;
  /** Whether the decision is "ambiguous" — heuristic couldn't decide confidently. */
  ambiguous: boolean;
}

// ─── Context propagation (Phase 7 §5) ────────────────────────────────────────

export interface RecoveryContext {
  /** Agent task ID (for events). */
  taskId: string;
  /** The step that failed. */
  step: AgentStep;
  /** The agent task (for plan/step context). */
  task: AgentTask;
  /** The tool name that failed (if any). */
  toolName?: string;
  /** The error message. */
  errorMessage: string;
  /** The error code (e.g. 'AGENT_CANCELLED', 'TOOL_FAILURE'). */
  errorCode?: string;
  /** Number of retries already attempted for this step. */
  attempt: number;
  /** Max retries configured for this task. */
  maxRetries: number;
  /** The most recent observation (for context to LLM). */
  lastObservation?: Observation;
  /** Whether the task was cancelled (shortcut for cancellation check). */
  cancelled: boolean;
  /** Cancellation reason (if cancelled). */
  cancelReason?: string;
}

// ─── Backoff policy (exponential) ─────────────────────────────────────────────

const BASE_BACKOFF_MS = 400;
const MAX_BACKOFF_MS = 5000;
const JITTER_MAX_MS = 120;

function exponentialBackoff(attempt: number, errorClass: ErrorClass): number {
  // timeouts get a longer base; transient network gets standard; others get standard
  const base = errorClass === 'timeout' ? BASE_BACKOFF_MS * 2 : BASE_BACKOFF_MS;
  const exponential = Math.min(base * Math.pow(2, attempt), MAX_BACKOFF_MS);
  const jitter = Math.floor(Math.random() * JITTER_MAX_MS);
  return exponential + jitter;
}

// ─── Heuristic decision (offline-first) ──────────────────────────────────────

/**
 * Make a recovery decision using ONLY heuristics (no LLM call).
 * This is the primary path; LLM fallback only runs for ambiguous cases.
 */
export function decideRecoveryHeuristic(ctx: RecoveryContext): RecoveryDecision {
  const classification = classifyError(ctx.errorMessage, ctx.errorCode);
  const { class: cls, retryable, neverRetry } = classification;

  // Cancellation — always ABORT, never retry
  if (cls === 'user_cancellation' || ctx.cancelled) {
    return {
      action: 'ABORT',
      reason: `Task cancelled by user${ctx.cancelReason ? `: ${ctx.cancelReason}` : ''} — aborting recovery`,
      errorClass: cls,
      backoffMs: 0,
      llmAnalyzed: false,
      confidence: 1.0,
      ambiguous: false,
    };
  }

  // Permission/security — NEVER auto-retry. SKIP if more steps remain,
  // ABORT if this was the last/only step or task has no other path.
  if (cls === 'permission_denied' || cls === 'security_policy') {
    const hasMoreSteps = ctx.task.currentStepIndex < ctx.task.plan.length - 1;
    const action: RecoveryAction = hasMoreSteps ? 'SKIP' : 'ABORT';
    return {
      action,
      reason: `${cls} — never auto-retry. ${action === 'SKIP' ? 'Skipping step, continuing with remaining plan.' : 'No remaining steps — aborting task.'} User confirmation required to re-attempt.`,
      errorClass: cls,
      backoffMs: 0,
      llmAnalyzed: false,
      confidence: 1.0,
      ambiguous: false,
    };
  }

  // Invalid arguments — MODIFY_AND_RETRY if we can fix the args heuristically
  if (cls === 'invalid_arguments') {
    const fixed = tryFixArguments(ctx);
    if (fixed) {
      return {
        action: 'MODIFY_AND_RETRY',
        reason: `Invalid arguments — heuristic fixed: ${fixed.reason}`,
        errorClass: cls,
        backoffMs: 0,
        llmAnalyzed: false,
        confidence: 0.7,
        modifiedParams: fixed.params,
        ambiguous: false,
      };
    }
    // Can't auto-fix — LLM may be able to. Mark ambiguous so LLM fallback runs.
    return {
      action: 'ABORT', // tentative — LLM may override
      reason: `Invalid arguments — heuristic cannot auto-fix. LLM analysis recommended.`,
      errorClass: cls,
      backoffMs: 0,
      llmAnalyzed: false,
      confidence: 0.3,
      ambiguous: true, // triggers LLM fallback
    };
  }

  // File/path — REPLAN (try a different path/tool)
  if (cls === 'file_path') {
    const hasMoreSteps = ctx.task.currentStepIndex < ctx.task.plan.length - 1;
    return {
      action: 'REPLAN',
      reason: `File/path error — replan to find alternative path/tool`,
      errorClass: cls,
      backoffMs: 0,
      llmAnalyzed: false,
      confidence: 0.8,
      ambiguous: false,
    };
  }

  // Transient/timeout — RETRY with exponential backoff
  if ((cls === 'transient_network' || cls === 'timeout') && retryable) {
    if (ctx.attempt < ctx.maxRetries) {
      return {
        action: 'RETRY',
        reason: `${cls} — retry ${ctx.attempt + 1}/${ctx.maxRetries} after backoff`,
        errorClass: cls,
        backoffMs: exponentialBackoff(ctx.attempt, cls),
        llmAnalyzed: false,
        confidence: 0.8,
        ambiguous: false,
      };
    }
    // Retries exhausted — REPLAN if more steps, ABORT otherwise
    const hasMoreSteps = ctx.task.currentStepIndex < ctx.task.plan.length - 1;
    return {
      action: hasMoreSteps ? 'REPLAN' : 'ABORT',
      reason: `${cls} — retry budget exhausted (${ctx.attempt}/${ctx.maxRetries})`,
      errorClass: cls,
      backoffMs: 0,
      llmAnalyzed: false,
      confidence: 0.7,
      ambiguous: false,
    };
  }

  // Model inference — RETRY once, then SKIP/ABORT
  if (cls === 'model_inference') {
    if (ctx.attempt < 1) {
      return {
        action: 'RETRY',
        reason: `Model inference error — retry once (attempt ${ctx.attempt + 1}/1)`,
        errorClass: cls,
        backoffMs: exponentialBackoff(ctx.attempt, cls),
        llmAnalyzed: false,
        confidence: 0.6,
        ambiguous: false,
      };
    }
    const hasMoreSteps = ctx.task.currentStepIndex < ctx.task.plan.length - 1;
    return {
      action: hasMoreSteps ? 'SKIP' : 'ABORT',
      reason: `Model inference error persisted — ${hasMoreSteps ? 'skipping step' : 'aborting task'}`,
      errorClass: cls,
      backoffMs: 0,
      llmAnalyzed: false,
      confidence: 0.6,
      ambiguous: false,
    };
  }

  // Tool failure — RETRY once, then REPLAN/ABORT
  if (cls === 'tool_failure') {
    if (ctx.attempt < ctx.maxRetries) {
      return {
        action: 'RETRY',
        reason: `Tool failure — retry ${ctx.attempt + 1}/${ctx.maxRetries}`,
        errorClass: cls,
        backoffMs: exponentialBackoff(ctx.attempt, cls),
        llmAnalyzed: false,
        confidence: 0.6,
        ambiguous: false,
      };
    }
    const hasMoreSteps = ctx.task.currentStepIndex < ctx.task.plan.length - 1;
    return {
      action: hasMoreSteps ? 'REPLAN' : 'ABORT',
      reason: `Tool failure — retry budget exhausted (${ctx.attempt}/${ctx.maxRetries})`,
      errorClass: cls,
      backoffMs: 0,
      llmAnalyzed: false,
      confidence: 0.6,
      ambiguous: false,
    };
  }

  // Unknown — RETRY once, then ABORT (preserves Phase 14 behavior)
  if (cls === 'unknown') {
    if (ctx.attempt < 1) {
      return {
        action: 'RETRY',
        reason: `Unknown error — retry once (attempt ${ctx.attempt + 1}/1)`,
        errorClass: cls,
        backoffMs: exponentialBackoff(ctx.attempt, cls),
        llmAnalyzed: false,
        confidence: 0.4,
        ambiguous: true, // unknown errors benefit from LLM analysis
      };
    }
    return {
      action: 'ABORT',
      reason: `Unknown error persisted after one retry — aborting`,
      errorClass: cls,
      backoffMs: 0,
      llmAnalyzed: false,
      confidence: 0.5,
      ambiguous: false,
    };
  }

  // Fallback (shouldn't reach here — all classes handled above)
  return {
    action: 'ABORT',
    reason: `Unhandled error class '${cls}' — aborting`,
    errorClass: cls,
    backoffMs: 0,
    llmAnalyzed: false,
    confidence: 0.1,
    ambiguous: false,
  };
}

// ─── Argument fixing heuristics ──────────────────────────────────────────────

interface ArgFix {
  params: Record<string, unknown>;
  reason: string;
}

/**
 * Try to fix common argument issues heuristically.
 * Returns null if no fix is available (LLM may still try).
 */
function tryFixArguments(ctx: RecoveryContext): ArgFix | null {
  const params = ctx.step.toolParams || {};
  const err = ctx.errorMessage.toLowerCase();

  // "Missing required parameter: path"
  const missingMatch = ctx.errorMessage.match(/missing (?:required )?(?:parameter|argument|field)[:\s]+([a-z_]+)/i);
  if (missingMatch) {
    const paramName = missingMatch[1];
    // Heuristic: if 'path' missing and we have an activeFile, use it
    if (paramName === 'path' && ctx.task.context?.activeFile) {
      return {
        params: { ...params, path: ctx.task.context.activeFile },
        reason: `added missing 'path' from activeFile (${ctx.task.context.activeFile})`,
      };
    }
    // Heuristic: if 'content' missing, use empty string (write_file)
    if (paramName === 'content') {
      return {
        params: { ...params, content: '' },
        reason: `added missing 'content' as empty string`,
      };
    }
  }

  // "Expected string but got number" — coerce type
  const typeMatch = ctx.errorMessage.match(/expected (string|number|boolean) but got (string|number|boolean|object|array)/i);
  if (typeMatch) {
    const expected = typeMatch[1].toLowerCase();
    const got = typeMatch[2].toLowerCase();
    // Find the offending param — heuristic: try 'path' first (most common)
    for (const key of ['path', 'content', 'command', 'query']) {
      if (key in params) {
        const val = params[key];
        const valType = Array.isArray(val) ? 'array' : typeof val;
        if (valType === got) {
          let coerced: unknown = val;
          if (expected === 'string' && valType !== 'string') coerced = String(val);
          else if (expected === 'number' && valType !== 'number') {
            const n = Number(val);
            if (!isNaN(n)) coerced = n;
          }
          else if (expected === 'boolean' && valType !== 'boolean') {
            if (val === 'true' || val === 1 || val === '1') coerced = true;
            else if (val === 'false' || val === 0 || val === '0') coerced = false;
          }
          if (coerced !== val) {
            return {
              params: { ...params, [key]: coerced },
              reason: `coerced '${key}' from ${got} to ${expected}`,
            };
          }
        }
      }
    }
  }

  // Note: "path outside workspace" / "path not allowed" is classified as
  // security_policy (not invalid_arguments) by error-classifier.ts, so the
  // security_policy branch handles it (SKIP/ABORT — never auto-modify to
  // bypass security). We do NOT auto-strip "../" from paths here.

  return null;
}

// ─── LLM fallback (optional) ─────────────────────────────────────────────────

export interface LLMRecoveryInput {
  context: RecoveryContext;
  classification: ErrorClassification;
  heuristicDecision: RecoveryDecision;
}

/**
 * Ask the local LLM to analyze the error and pick a recovery action.
 * Used as a FALLBACK when the heuristic decision is 'ambiguous'.
 *
 * Returns null if:
 *   - no runtime available (offline mode)
 *   - LLM call fails
 *   - LLM response can't be parsed
 *
 * In all these cases, the caller falls back to the heuristic decision.
 */
export async function analyzeWithLLM(
  runtime: AIRuntime | null,
  model: LocalModelInfo | null,
  input: LLMRecoveryInput
): Promise<RecoveryDecision | null> {
  if (!runtime || !model) return null; // offline — heuristic only

  const { context: ctx, classification, heuristicDecision } = input;

  try {
    const systemPrompt = `You are an error-recovery assistant for an AI agent named NEX.
Analyze the tool/step failure below and decide the best recovery action.

Possible actions:
- RETRY: re-run the same step with the same arguments (good for transient errors)
- MODIFY_AND_RETRY: re-run with modified arguments (good for invalid arguments)
- REPLAN: discard remaining steps and ask the planner for new ones (good for wrong approach)
- SKIP: skip this step and continue with the next one (good for non-essential steps)
- ABORT: stop the task entirely (good for unrecoverable errors)

Respond with STRICT JSON only: {"action":"...","reason":"...","modifiedParams":{...},"confidence":0.0}

Rules:
- NEVER retry permission/security/cancellation errors.
- Prefer RETRY for transient (network/timeout) errors.
- Prefer MODIFY_AND_RETRY for invalid arguments (suggest the fix in modifiedParams).
- Prefer REPLAN for file/path errors.
- Prefer SKIP for non-essential steps.
- Prefer ABORT only when no recovery is possible.`;

    const userPrompt = buildLLMRecoveryPrompt(ctx, classification, heuristicDecision);

    const result = await runtime.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        contextSize: model.contextSize,
        temperature: 0.2,
        maxTokens: 400,
        systemPrompt,
      }
    );

    return parseLLMRecoveryResponse(result.content, classification, heuristicDecision);
  } catch (err: any) {
    AgentLogger.warn(`Recovery LLM analysis failed: ${err.message} — using heuristic decision`);
    return null;
  }
}

function buildLLMRecoveryPrompt(
  ctx: RecoveryContext,
  classification: ErrorClassification,
  heuristic: RecoveryDecision
): string {
  // ════════════════════════════════════════════════════════════════════════
  // Phase 8: Context Propagation
  //
  // We now use safeContextSnapshot() to build a single redacted + bounded
  // snapshot of the agent context. This replaces the inline redaction logic
  // that was here before (no duplication — single source of truth).
  //
  // The snapshot includes:
  //   - taskId, conversationId, sessionId (correlation)
  //   - userRequest (truncated to 200), intent, projectPath, activeFile, language
  //   - currentPlan + currentStep summaries
  //   - toolParamsSafe (redacted, bounded JSON)
  //   - lastObservation (truncated rawOutput, signals, modifiedFiles)
  //   - error + errorClass + attempt + maxRetries
  //   - remainingSteps (max 5)
  //   - executionMetadata (backend, model, timeout)
  // ════════════════════════════════════════════════════════════════════════
  const snapshot: AgentContextContract = safeContextSnapshot(
    ctx.task,
    ctx.step,
    {
      error: ctx.errorMessage,
      errorClass: classification.class,
      attempt: ctx.attempt,
      agentTaskId: ctx.taskId,
    },
  );

  const lines: string[] = [];

  // ── Task ──
  lines.push('## Task');
  lines.push(`- Task ID: ${snapshot.taskId}`);
  if (snapshot.conversationId) lines.push(`- Conversation ID: ${snapshot.conversationId}`);
  if (snapshot.sessionId) lines.push(`- Session ID: ${snapshot.sessionId}`);
  lines.push(`- User request: ${snapshot.userRequest}`);
  if (snapshot.intent) lines.push(`- Intent: ${snapshot.intent}`);
  if (snapshot.projectPath) lines.push(`- Project: ${snapshot.projectPath}`);
  if (snapshot.activeFile) lines.push(`- Active file: ${snapshot.activeFile}`);
  if (snapshot.language) lines.push(`- Language: ${snapshot.language}`);
  lines.push(`- Step ${snapshot.currentStep.index + 1}/${snapshot.currentPlan.totalSteps}: ${snapshot.currentStep.description}`);
  lines.push(`- Attempt: ${snapshot.attempt ?? 0}/${snapshot.maxRetries ?? 0}`);

  // ── Failure ──
  lines.push('');
  lines.push('## Failure');
  lines.push(`- Tool: ${snapshot.toolName || '(none)'}`);
  lines.push(`- Error class: ${snapshot.errorClass || 'unknown'}`);
  lines.push(`- Error message: ${snapshot.error || '(no message)'}`);
  if (ctx.errorCode) lines.push(`- Error code: ${ctx.errorCode}`);

  // ── Tool arguments (REDACTED via snapshot) ──
  lines.push('');
  lines.push('## Tool arguments (redacted)');
  lines.push('```json');
  lines.push(snapshot.toolParamsSafe?._redactedJson as string || '{}');
  lines.push('```');

  // ── Last observation (TRUNCATED via snapshot) ──
  lines.push('');
  lines.push('## Last observation');
  if (snapshot.lastObservation) {
    lines.push(`- Tool call ID: ${snapshot.lastObservation.toolCallId}`);
    lines.push(`- Signals: ${snapshot.lastObservation.signals.map((s) => `[${s.type}] ${s.message}`).join('; ') || '(none)'}`);
    if (snapshot.lastObservation.modifiedFiles.length > 0) {
      lines.push(`- Modified files: ${snapshot.lastObservation.modifiedFiles.join(', ')}`);
    }
    lines.push(`- Output (truncated): ${snapshot.lastObservation.rawOutputTruncated.slice(0, 300)}${snapshot.lastObservation.rawOutputTruncated.length > 300 ? '...' : ''}`);
  } else {
    lines.push('(no observation)');
  }

  // ── Remaining plan (max 5 via snapshot) ──
  lines.push('');
  lines.push('## Remaining plan');
  if (snapshot.remainingSteps.length > 0) {
    snapshot.remainingSteps.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.description}${s.toolName ? ` (tool: ${s.toolName})` : ''}`);
    });
  } else {
    lines.push('(this is the last step)');
  }

  // ── Execution metadata ──
  lines.push('');
  lines.push('## Execution metadata');
  if (snapshot.executionMetadata) {
    const m = snapshot.executionMetadata;
    lines.push(`- Backend: ${m.backend || 'local'}`);
    if (m.model) lines.push(`- Model: ${m.model}`);
    if (m.timeoutMs) lines.push(`- Timeout: ${m.timeoutMs}ms`);
  }

  // ── Heuristic decision (for LLM reference) ──
  lines.push('');
  lines.push('## Heuristic decision (for your reference)');
  lines.push(`- Action: ${heuristic.action}`);
  lines.push(`- Reason: ${heuristic.reason}`);
  lines.push(`- Confidence: ${heuristic.confidence}`);
  lines.push('');
  lines.push('## Your decision');
  lines.push('Override the heuristic ONLY if you have higher confidence. Respond with STRICT JSON.');

  return lines.join('\n');
}

function parseLLMRecoveryResponse(
  response: string,
  classification: ErrorClassification,
  heuristic: RecoveryDecision
): RecoveryDecision | null {
  // Extract JSON from the response (tolerate prefix/suffix text)
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }

  const action = String(parsed.action || '').toUpperCase() as RecoveryAction;
  if (!['RETRY', 'MODIFY_AND_RETRY', 'REPLAN', 'SKIP', 'ABORT'].includes(action)) {
    return null;
  }

  // Safety: LLM is NEVER allowed to retry permission/security/cancellation errors.
  // (Phase 7 §8 — security/policy rejection must terminate or require user confirmation.)
  if (
    (classification.class === 'permission_denied' ||
      classification.class === 'security_policy' ||
      classification.class === 'user_cancellation') &&
    (action === 'RETRY' || action === 'MODIFY_AND_RETRY')
  ) {
    // Override back to the heuristic decision (which already prevented retry)
    return {
      ...heuristic,
      reason: `${heuristic.reason} (LLM suggested ${action} but safety guard overrode: never auto-retry ${classification.class})`,
    };
  }

  return {
    action,
    reason: String(parsed.reason || `LLM decided: ${action}`),
    errorClass: classification.class,
    backoffMs: action === 'RETRY' || action === 'MODIFY_AND_RETRY'
      ? exponentialBackoff(0, classification.class)
      : 0,
    llmAnalyzed: true,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
    modifiedParams: parsed.modifiedParams || undefined,
    ambiguous: false,
  };
}

// ─── Top-level: decideRecovery ──────────────────────────────────────────────

export interface DecideRecoveryOptions {
  context: RecoveryContext;
  runtime?: AIRuntime | null;
  model?: LocalModelInfo | null;
  /**
   * If false (default), the heuristic decision is preferred and LLM only
   * runs for 'ambiguous' cases. If true, the LLM is always asked (testing).
   */
  forceLLM?: boolean;
}

/**
 * Top-level recovery decision: heuristic first, LLM fallback for ambiguous cases.
 *
 * Phase 7 §4: LLM is NOT the only path. Heuristic path runs first.
 */
export async function decideRecovery(opts: DecideRecoveryOptions): Promise<RecoveryDecision> {
  const heuristic = decideRecoveryHeuristic(opts.context);

  // Always run LLM for ambiguous cases (or when forced for testing)
  if (heuristic.ambiguous || opts.forceLLM) {
    const classification = classifyError(opts.context.errorMessage, opts.context.errorCode);
    const llmDecision = await analyzeWithLLM(
      opts.runtime || null,
      opts.model || null,
      { context: opts.context, classification, heuristicDecision: heuristic }
    );
    if (llmDecision) return llmDecision;
  }

  return heuristic;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}

// ─── Test helpers (exported for tests) ────────────────────────────────────────

export const _internal = {
  exponentialBackoff,
  tryFixArguments,
  buildLLMRecoveryPrompt,
};
