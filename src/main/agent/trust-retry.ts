/**
 * NEX AI — Trust & Retry Policy (Phase 14 / P14-A+B)
 *
 * Upgrades the Phase-7 verification + retry machinery ADDITIVELY:
 *
 * A) Tool-result trust levels — not every tool result deserves equal
 *    trust for verification:
 *      - deterministic (build/test/exec exit codes)      → trusted
 *      - search/read (data fetched, but interpreted)    → normal
 *      - model-generated (proposals/plans/summaries)    → low
 *    Verification escalates: low-trust results require corroborating
 *    evidence (a second signal) before 'verified'.
 *
 * B) Retry policy with classification + backoff:
 *      - transient (timeout, tool busy) → retry with exponential backoff
 *      - permanent  (validation, permission, unsupported) → NO retry
 *      - unknown    → retry once, then fail
 *    Prevents the Phase-7 behavior of re-running doomed steps
 *    (e.g. permission_denied retried maxRetries times).
 *
 * Pure module — injected clock for tests.
 */

import type { ToolResult } from '../ai/tool-registry';

// ─── A) Trust levels ────────────────────────────────────────────────────────

export type ToolTrustLevel = 'deterministic' | 'normal' | 'model-generated';

/** Tools whose results carry hard evidence (exit codes, structured output). */
const DETERMINISTIC_TOOLS = new Set(['npm_build', 'npm_test', 'run_command', 'calculation', 'system_info']);
/** Tools whose outputs are AI-authored (proposals, plans) — low trust. */
const MODEL_TOOLS = new Set(['propose_changes', 'knowledge_search']);

export function trustLevelForTool(toolName: string | undefined): ToolTrustLevel {
  if (!toolName) return 'normal';
  if (DETERMINISTIC_TOOLS.has(toolName)) return 'deterministic';
  if (MODEL_TOOLS.has(toolName)) return 'model-generated';
  return 'normal';
}

export interface TrustAssessment {
  level: ToolTrustLevel;
  /** model-generated success requires corroboration to count as verified */
  requiresCorroboration: boolean;
  reason: string;
}

export function assessTrust(toolName: string | undefined, result: Pick<ToolResult, 'success' | 'data'>): TrustAssessment {
  const level = trustLevelForTool(toolName);
  if (level === 'deterministic') {
    return { level, requiresCorroboration: false, reason: 'deterministic tool evidence (exit code / structured output)' };
  }
  if (level === 'model-generated') {
    return {
      level,
      requiresCorroboration: result.success, // only successful claims need proof
      reason: 'model-generated content — claims need corroboration before verification',
    };
  }
  return { level, requiresCorroboration: false, reason: 'standard tool output' };
}

/**
 * Corroboration check for low-trust results: does the modifiedFiles /
 * structured data actually support the tool's claim?
 */
export function corroborate(
  result: Pick<ToolResult, 'success' | 'modifiedFiles' | 'data'>,
  assessment: TrustAssessment
): { corroborated: boolean; evidence: string[] } {
  if (!assessment.requiresCorroboration) return { corroborated: true, evidence: [] };
  const evidence: string[] = [];
  if (result.modifiedFiles && result.modifiedFiles.length > 0) {
    evidence.push(`${result.modifiedFiles.length} file change(s) attached`);
  }
  if (result.data && typeof result.data === 'object') {
    const keys = Object.keys(result.data as object);
    if (keys.includes('okCount') && (result.data as any).okCount > 0) {
      evidence.push(`structured outcome: ${(result.data as any).okCount} operation(s) recorded`);
    }
    if (keys.includes('resultCount') && (result.data as any).resultCount > 0) {
      evidence.push(`retrieval returned ${(result.data as any).resultCount} result(s)`);
    }
    if (keys.includes('exitCode')) evidence.push(`exit code present`);
  }
  return { corroborated: evidence.length > 0, evidence };
}

// ─── B) Retry policy ────────────────────────────────────────────────────────

export type FailureClass = 'transient' | 'permanent' | 'unknown';

export interface RetryDecision {
  shouldRetry: boolean;
  classification: FailureClass;
  backoffMs: number;
  reason: string;
}

/** Substrings that mark a failure as permanently un-retryable. */
const PERMANENT_PATTERNS: RegExp[] = [
  /permission denied|denied by user/i,
  /not found|does not exist/i,
  /unsupported format/i,
  /invalid (parameter|path|input|argument)/i,
  /validation (failed|error)/i,
  /blocked: /i,            // security guards
  /parse failed/i,
  /too large/i,
  /binary file/i,
  /null byte/i,
];

/** Substrings marking transient failures worth retrying. */
const TRANSIENT_PATTERNS: RegExp[] = [
  /timeout|timed out/i,
  /EAGAIN|EBUSY|ECONNRESET|ETMPBUSY/i,
  /resource temporarily unavailable/i,
  /busy/i,
  /spawn ENOMEM/i,
];

export function classifyFailure(errorMessage: string): FailureClass {
  if (PERMANENT_PATTERNS.some((re) => re.test(errorMessage))) return 'permanent';
  if (TRANSIENT_PATTERNS.some((re) => re.test(errorMessage))) return 'transient';
  return 'unknown';
}

/**
 * Retry decision for a failed step.
 * Backoff: exponential by attempt (base 400ms, ×2, cap 5s) + jitter.
 * unknown: only ONE retry allowed; permanent: none.
 */
export function decideRetry(opts: {
  errorMessage: string;
  attempt: number;          // 0-based retries already used
  maxRetries: number;
  now?: () => number;
}): RetryDecision {
  const { errorMessage, attempt, maxRetries } = opts;
  const classification = classifyFailure(errorMessage);

  if (classification === 'permanent') {
    return { shouldRetry: false, classification, backoffMs: 0, reason: `permanent failure — retrying would repeat the same result: ${errorMessage.slice(0, 120)}` };
  }
  const effectiveMax = classification === 'unknown' ? Math.min(1, maxRetries) : maxRetries;
  if (attempt >= effectiveMax) {
    return { shouldRetry: false, classification, backoffMs: 0, reason: `${classification} retry budget exhausted (attempt ${attempt}/${effectiveMax})` };
  }
  const base = Math.min(400 * Math.pow(2, attempt), 5000);
  const jitter = Math.floor(Math.random() * 120);
  return {
    shouldRetry: true,
    classification,
    backoffMs: base + jitter,
    reason: `${classification} failure — retry ${attempt + 1}/${effectiveMax} after ${base + jitter}ms backoff`,
  };
}

/** Sleep helper (used by the core hook; injectable clock in tests uses 0ms). */
export function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
}
