/**
 * NEX AI — Phase 7: Error Classification
 *
 * 10-class error taxonomy for Agent/Tool/Model failures.
 *
 * Extends the 3-class trust-retry taxonomy (transient/permanent/unknown) with
 * finer-grained classes that drive recovery decisions:
 *
 *   transient_network   — network errors worth retrying (ECONNRESET, EAGAIN, EBUSY)
 *   timeout             — operation exceeded its time budget (retryable)
 *   permission_denied   — user/system denied permission (NEVER auto-retry; needs user)
 *   invalid_arguments   — wrong/missing tool params (fix args, not retry as-is)
 *   file_path           — file/path not found, missing dependency (replan needed)
 *   model_inference     — LLM produced garbage, parse failed, context too large (retry once)
 *   tool_failure        — tool ran but reported failure (tool-specific; heuristic decides)
 *   user_cancellation   — AGENT_CANCELLED (NEVER retry; abort immediately)
 *   security_policy     — security guard blocked the operation (NEVER auto-retry)
 *   unknown             — anything not matched (one retry, then fail)
 *
 * Pure module — no side effects, no IPC. Injected by recovery-engine.
 *
 * Heuristic-first: classification is regex/pattern-based (no LLM call needed).
 * The LLM fallback in recovery-engine.ts is ONLY for ambiguous cases.
 */

import { classifyFailure as classify3, type FailureClass } from './trust-retry';

// ─── 10-class taxonomy ──────────────────────────────────────────────────────

export type ErrorClass =
  | 'transient_network'
  | 'timeout'
  | 'permission_denied'
  | 'invalid_arguments'
  | 'file_path'
  | 'model_inference'
  | 'tool_failure'
  | 'user_cancellation'
  | 'security_policy'
  | 'unknown';

export const ALL_ERROR_CLASSES: ErrorClass[] = [
  'transient_network',
  'timeout',
  'permission_denied',
  'invalid_arguments',
  'file_path',
  'model_inference',
  'tool_failure',
  'user_cancellation',
  'security_policy',
  'unknown',
];

// ─── Patterns ─────────────────────────────────────────────────────────────────

/** Network/transient errors (retryable with backoff). */
const TRANSIENT_NETWORK_PATTERNS: RegExp[] = [
  /ECONNRESET|ECONNREFUSED|EPIPE|EAI_AGAIN/i,
  /ETIMEDOUT|ENETUNREACH|EHOSTUNREACH/i,
  /network (error|unreachable|timeout)/i,
  /socket hang up/i,
  /fetch failed/i,
  /connection (refused|reset|aborted)/i,
  /EAGAIN|EBUSY|ETMPBUSY/i,
  /resource temporarily unavailable/i,
  /spawn ENOMEM/i,
];

/** Timeout errors (retryable). */
const TIMEOUT_PATTERNS: RegExp[] = [
  /\btimeout\b|\btimed out\b/i,
  /exceeded .* time/i,
  /deadline exceeded/i,
  /operation took too long/i,
];

/** Permission errors (NEVER auto-retry — needs user action). */
const PERMISSION_PATTERNS: RegExp[] = [
  /permission denied/i,
  /denied by user/i,
  /access denied/i,
  /EPERM|EACCES/i,
  /not authorized/i,
  /forbidden/i,
];

/** Invalid arguments (fix args, then retry — not retry as-is). */
const INVALID_ARGUMENTS_PATTERNS: RegExp[] = [
  /invalid (parameter|argument|input|option)/i,
  /missing (required )?(parameter|argument|field)/i,
  /expected (string|number|boolean|array|object) but got/i,
  /cannot read propert(y|ies) of (undefined|null)/i,
  /argument .* out of range/i,
  /validation (failed|error)/i,
  /schema .* mismatch/i,
];

/** File/path errors (replan needed — different path/tool). */
const FILE_PATH_PATTERNS: RegExp[] = [
  /not found|does not exist|no such file or directory/i,
  /ENOENT/i,
  /file not found/i,
  /directory not found/i,
  /path .* (invalid|too long|unsupported)/i,
  /unsupported format/i,
  /binary file/i,
  /null byte/i,
  /file too large/i, // "file too large" (not "context too large" — that's model_inference)
  /module not found/i,
  /cannot find module/i,
  /dependency .* missing/i,
];

/** Model/inference errors (retry once; if persists, fail). */
const MODEL_INFERENCE_PATTERNS: RegExp[] = [
  /parse failed|json parse error|invalid json/i,
  /model .* (error|failed|crashed)/i,
  /inference (failed|error)/i,
  /context (too large|window exceeded|length exceeded)/i,
  /context_too_large/i,
  /token limit (exceeded|reached)/i,
  /max tokens/i,
  /llm_error/i,
  /invalid response format/i,
  /empty (response|completion)/i,
];

/** Security/policy errors (NEVER auto-retry — security gate decision). */
const SECURITY_POLICY_PATTERNS: RegExp[] = [
  /blocked: /i,
  /security (violation|policy|guard) .* (blocked|denied|rejected)/i,
  /sandbox .* (blocked|denied|rejected)/i,
  /command not allowed/i,
  /path not allowed|path outside/i,
  /unsafe (operation|path|command)/i,
  /policy .* (denied|blocked|rejected)/i,
];

// ─── Cancellation code ───────────────────────────────────────────────────────

const CANCEL_CODE = 'AGENT_CANCELLED';

// ─── Classifier ──────────────────────────────────────────────────────────────

export interface ErrorClassification {
  /** The 10-class taxonomy label. */
  class: ErrorClass;
  /** The 3-class taxonomy (transient/permanent/unknown) — backward-compat with trust-retry. */
  legacyClass: FailureClass;
  /** True if retrying the same operation could plausibly succeed. */
  retryable: boolean;
  /** True if the operation should NEVER be auto-retried (permission/security/cancellation). */
  neverRetry: boolean;
  /** Short human-readable reason. */
  reason: string;
  /** Optional: which pattern matched (for diagnostics). */
  matchedPattern?: string;
}

/**
 * Classify an error message + error code into the 10-class taxonomy.
 *
 * The classifier is heuristic-only (no LLM call). It checks patterns in this
 * priority order (most specific → least specific):
 *   1. user_cancellation (code AGENT_CANCELLED — always wins)
 *   2. security_policy (security guards before permission)
 *   3. permission_denied
 *   4. invalid_arguments
 *   5. file_path
 *   6. model_inference
 *   7. timeout
 *   8. transient_network
 *   9. tool_failure (fallback when tool returned success=false but no message)
 *  10. unknown
 */
export function classifyError(
  errorMessage: string,
  errorCode?: string
): ErrorClassification {
  // 1. Cancellation — always wins
  if (errorCode === CANCEL_CODE || /AGENT_CANCELLED|agent cancelled/i.test(errorMessage)) {
    return {
      class: 'user_cancellation',
      legacyClass: 'permanent',
      retryable: false,
      neverRetry: true,
      reason: 'User cancelled the task — never auto-retry',
    };
  }

  // 2. Security/policy
  for (const re of SECURITY_POLICY_PATTERNS) {
    if (re.test(errorMessage)) {
      return {
        class: 'security_policy',
        legacyClass: 'permanent',
        retryable: false,
        neverRetry: true,
        reason: `Security policy blocked: ${truncate(errorMessage)}`,
        matchedPattern: re.source,
      };
    }
  }

  // 3. Permission denied
  for (const re of PERMISSION_PATTERNS) {
    if (re.test(errorMessage)) {
      return {
        class: 'permission_denied',
        legacyClass: 'permanent',
        retryable: false,
        neverRetry: true,
        reason: `Permission denied: ${truncate(errorMessage)}`,
        matchedPattern: re.source,
      };
    }
  }

  // 4. Invalid arguments
  for (const re of INVALID_ARGUMENTS_PATTERNS) {
    if (re.test(errorMessage)) {
      return {
        class: 'invalid_arguments',
        legacyClass: 'permanent',
        retryable: true, // retryable AFTER modification, not as-is
        neverRetry: false,
        reason: `Invalid arguments: ${truncate(errorMessage)}`,
        matchedPattern: re.source,
      };
    }
  }

  // 5. File/path
  for (const re of FILE_PATH_PATTERNS) {
    if (re.test(errorMessage)) {
      return {
        class: 'file_path',
        legacyClass: 'permanent',
        retryable: false,
        neverRetry: false, // replan can pick a different path/tool
        reason: `File/path issue: ${truncate(errorMessage)}`,
        matchedPattern: re.source,
      };
    }
  }

  // 6. Model/inference
  for (const re of MODEL_INFERENCE_PATTERNS) {
    if (re.test(errorMessage)) {
      return {
        class: 'model_inference',
        legacyClass: 'transient', // retry once — if persists, fail
        retryable: true,
        neverRetry: false,
        reason: `Model inference error: ${truncate(errorMessage)}`,
        matchedPattern: re.source,
      };
    }
  }

  // 7. Timeout
  for (const re of TIMEOUT_PATTERNS) {
    if (re.test(errorMessage)) {
      return {
        class: 'timeout',
        legacyClass: 'transient',
        retryable: true,
        neverRetry: false,
        reason: `Timeout: ${truncate(errorMessage)}`,
        matchedPattern: re.source,
      };
    }
  }

  // 8. Transient network
  for (const re of TRANSIENT_NETWORK_PATTERNS) {
    if (re.test(errorMessage)) {
      return {
        class: 'transient_network',
        legacyClass: 'transient',
        retryable: true,
        neverRetry: false,
        reason: `Transient network error: ${truncate(errorMessage)}`,
        matchedPattern: re.source,
      };
    }
  }

  // 9. tool_failure — fallback when tool reported failure but no specific pattern
  // (caller passes errorCode='TOOL_FAILURE' to signal this)
  if (errorCode === 'TOOL_FAILURE') {
    return {
      class: 'tool_failure',
      legacyClass: 'unknown',
      retryable: true, // one retry, then fail
      neverRetry: false,
      reason: `Tool reported failure: ${truncate(errorMessage)}`,
    };
  }

  // 10. Unknown
  return {
    class: 'unknown',
    legacyClass: classify3(errorMessage), // fall back to legacy classifier
    retryable: true, // one retry, then fail (preserves Phase 14 behavior)
    neverRetry: false,
    reason: `Unknown error: ${truncate(errorMessage)}`,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(s: string, max = 120): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}

// ─── Test helpers (exported for the test file) ────────────────────────────────

export const _PATTERNS = {
  transient_network: TRANSIENT_NETWORK_PATTERNS,
  timeout: TIMEOUT_PATTERNS,
  permission_denied: PERMISSION_PATTERNS,
  invalid_arguments: INVALID_ARGUMENTS_PATTERNS,
  file_path: FILE_PATH_PATTERNS,
  model_inference: MODEL_INFERENCE_PATTERNS,
  security_policy: SECURITY_POLICY_PATTERNS,
};
