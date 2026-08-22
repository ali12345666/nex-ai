/**
 * NEX AI — Verification Engine
 *
 * Verifies that a step (or task) actually achieved its goal.
 *
 * Approaches (in order of preference):
 *  1. Tool-based verification: run a tool (e.g. npm_build, npm_test) and check exit code
 *  2. Pattern matching: check if the output contains expected / forbidden strings
 *  3. LLM-based verification: ask the LLM "did this step succeed?"
 *
 * Phase 7 (current): Tool-based + simple pattern matching.
 * Phase 8+: LLM-based verification when available.
 */

import type { Observation, VerificationResult } from './types';
import type { ToolResult } from '../ai/tool-registry';

export interface VerificationRequest {
  stepId: string;
  description: string;
  // What constitutes "verified"
  expectedExitCode?: number;
  expectedOutputContains?: string[];
  expectedOutputRegex?: string;
  forbiddenOutputContains?: string[];
  // The tool call result we're verifying
  toolResult?: ToolResult;
}

/**
 * Verify a tool result against expected conditions.
 */
export function verifyToolResult(req: VerificationRequest): VerificationResult {
  const result = req.toolResult;
  if (!result) {
    return {
      id: `ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      stepId: req.stepId,
      description: req.description,
      verifiedBy: 'manual',
      status: 'inconclusive',
      details: 'No tool result to verify',
      timestamp: Date.now(),
    };
  }

  const issues: string[] = [];

  // Exit code check
  if (req.expectedExitCode !== undefined && result.data?.exitCode !== undefined) {
    if (result.data.exitCode !== req.expectedExitCode) {
      issues.push(`Exit code ${result.data.exitCode}, expected ${req.expectedExitCode}`);
    }
  }

  // Output contains check
  if (req.expectedOutputContains && req.expectedOutputContains.length > 0) {
    const output = (result.output || '').toLowerCase();
    for (const expected of req.expectedOutputContains) {
      if (!output.includes(expected.toLowerCase())) {
        issues.push(`Output does not contain "${expected}"`);
      }
    }
  }

  // Output regex check
  if (req.expectedOutputRegex) {
    const regex = new RegExp(req.expectedOutputRegex);
    if (!regex.test(result.output || '')) {
      issues.push(`Output does not match regex /${req.expectedOutputRegex}/`);
    }
  }

  // Forbidden output check
  if (req.forbiddenOutputContains && req.forbiddenOutputContains.length > 0) {
    const output = (result.output || '').toLowerCase();
    for (const forbidden of req.forbiddenOutputContains) {
      if (output.includes(forbidden.toLowerCase())) {
        issues.push(`Output contains forbidden string "${forbidden}"`);
      }
    }
  }

  // Success result must be true
  if (!result.success) {
    issues.push(`Tool reported failure: ${result.error || '(no error message)'}`);
  }

  return {
    id: `ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    stepId: req.stepId,
    description: req.description,
    verifiedBy: 'tool_call',
    status: issues.length === 0 ? 'verified' : 'failed',
    details: issues.length === 0
      ? 'All verification conditions met'
      : `Verification failed: ${issues.join('; ')}`,
    timestamp: Date.now(),
  };
}

/**
 * Verify an observation. Useful for reasoning steps where we observe
 * the output of a previous tool call.
 */
export function verifyObservation(obs: Observation, expectation: {
  shouldContain?: string[];
  shouldNotContain?: string[];
}): VerificationResult {
  const issues: string[] = [];
  const text = (obs.rawOutput || '').toLowerCase();
  if (expectation.shouldContain) {
    for (const s of expectation.shouldContain) {
      if (!text.includes(s.toLowerCase())) {
        issues.push(`Observation should contain "${s}"`);
      }
    }
  }
  if (expectation.shouldNotContain) {
    for (const s of expectation.shouldNotContain) {
      if (text.includes(s.toLowerCase())) {
        issues.push(`Observation should NOT contain "${s}"`);
      }
    }
  }
  return {
    id: `ver-obs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    stepId: obs.stepId,
    description: `Observation verification for ${obs.toolCallId}`,
    verifiedBy: 'inferred',
    status: issues.length === 0 ? 'verified' : 'failed',
    details: issues.length === 0 ? 'Observation matches expectations' : issues.join('; '),
    timestamp: Date.now(),
  };
}
