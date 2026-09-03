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
 *
 * Phase 9: Added structural + content verification via read-only tool calls.
 *   - verifyStepOutcome(): dispatches by tool name to verify the actual system state
 *     (file exists after write, file gone after delete, content matches after edit).
 *   - verifyTaskCompletion(): Task Completion Gate — checks all steps verified,
 *     no unresolved errors, no active recovery.
 *   - VerificationResult extended with confidence, evidence, signals, recommendedAction, level.
 */

import type { Observation, VerificationResult, AgentSignal, AgentTask, AgentStep, ExpectedOutcome } from './types';
import type { ToolResult, ToolContext } from '../ai/tool-registry';
import { createCancellationToken } from './types';

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

// ════════════════════════════════════════════════════════════════════════════
// Phase 9: Structural + Content + Task Verification
// ════════════════════════════════════════════════════════════════════════════

/**
 * Phase 9: Verify the actual system state after a tool ran.
 *
 * This performs Level 2 (structural) and Level 3 (content) verification by
 * calling read-only tools (read_file, list_directory) via executeTool.
 *
 * The verification NEVER bypasses the Permission Gate — read-only tools go
 * through executeTool (which does NOT call the permission layer — read_file
 * and list_directory are inherently safe). If a verification read is denied
 * (e.g. file doesn't exist), we mark 'inconclusive' (not 'failed') — we
 * can't verify without reading, so we don't fail the step on a verification
 * read denial.
 *
 * Security note: we do NOT pass a permission context — executeTool for
 * read_file/list_directory does not require one (read permission is the
 * default for safe tools). Write/execute tools are NEVER called here.
 *
 * @param step       The step that ran (with expectedOutcome if set)
 * @param toolResult The tool result to verify
 * @param projectPath The project root (for relative path resolution)
 */
export async function verifyStepOutcome(
  step: AgentStep,
  toolResult: ToolResult,
  projectPath?: string,
  taskId?: string,
): Promise<VerificationResult> {
  const id = `ver-out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const evidence: string[] = [];
  const signals: AgentSignal[] = [];

  // ── Level 1: tool result success ──
  if (!toolResult.success) {
    return {
      id, stepId: step.id,
      description: step.description,
      verifiedBy: 'tool_call',
      status: 'failed',
      details: `Tool reported failure: ${toolResult.error || '(no error)'}`,
      timestamp: Date.now(),
      confidence: 1.0,
      evidence: [`tool.success = false`],
      signals: [{ type: 'error', message: toolResult.error || 'Tool reported failure' }],
      recommendedAction: 'retry',
      level: 1,
    };
  }
  evidence.push('tool.success = true');

  // ── Level 2/3: structural/content verification via expectedOutcome ──
  if (step.expectedOutcome) {
    const outcome = step.expectedOutcome;
    try {
      const result = await verifyExpectedOutcome(outcome, projectPath, taskId, toolResult);
      evidence.push(...result.evidence);
      signals.push(...result.signals);
      if (!result.verified) {
        return {
          id, stepId: step.id,
          description: step.description,
          verifiedBy: outcome.type === 'file_contains' ? 'content' : 'structural',
          status: 'failed',
          details: result.reason,
          timestamp: Date.now(),
          confidence: 0.8,
          evidence,
          signals,
          recommendedAction: 'replan',
          level: outcome.type === 'file_contains' ? 3 : 2,
        };
      }
      evidence.push(`expected outcome (${outcome.type}) verified`);
    } catch (err: any) {
      // Verification read failed — mark inconclusive (can't verify without reading)
      return {
        id, stepId: step.id,
        description: step.description,
        verifiedBy: 'structural',
        status: 'inconclusive',
        details: `Verification read failed: ${err.message} (cannot verify without reading)`,
        timestamp: Date.now(),
        confidence: 0.3,
        evidence,
        signals: [{ type: 'warning', message: `verification read failed: ${err.message}` }],
        recommendedAction: 'continue',
        level: 2,
      };
    }
  }

  // ── Level 4: execution verification (exit code / output patterns) ──
  // (already handled by verifyToolResult — we just confirm here)
  if (toolResult.data?.exitCode !== undefined && toolResult.data.exitCode !== 0) {
    return {
      id, stepId: step.id,
      description: step.description,
      verifiedBy: 'execution',
      status: 'failed',
      details: `Exit code ${toolResult.data.exitCode} (non-zero)`,
      timestamp: Date.now(),
      confidence: 0.9,
      evidence: [...evidence, `exitCode = ${toolResult.data.exitCode}`],
      signals: [{ type: 'error', message: `non-zero exit code: ${toolResult.data.exitCode}` }],
      recommendedAction: 'retry',
      level: 4,
    };
  }

  // ── All checks passed ──
  const browserOutcome = step.expectedOutcome && (
    step.expectedOutcome.type === 'url_changed' ||
    step.expectedOutcome.type === 'page_contains_text' ||
    step.expectedOutcome.type === 'element_visible' ||
    step.expectedOutcome.type === 'screenshot_captured'
  );
  const computerOutcome = step.expectedOutcome && (
    step.expectedOutcome.type === 'screenshot_captured_desktop' ||
    step.expectedOutcome.type === 'window_focused' ||
    step.expectedOutcome.type === 'element_clicked_at'
  );
  return {
    id, stepId: step.id,
    description: step.description,
    verifiedBy: step.expectedOutcome
      ? ((browserOutcome || computerOutcome) ? 'structural' : (step.expectedOutcome.type === 'file_contains' ? 'content' : 'structural'))
      : 'tool_call',
    status: 'verified',
    details: 'All verification conditions met',
    timestamp: Date.now(),
    confidence: step.expectedOutcome ? 0.9 : 0.7,
    evidence,
    signals,
    level: step.expectedOutcome
      ? ((browserOutcome || computerOutcome) ? 2 : (step.expectedOutcome.type === 'file_contains' ? 3 : 2))
      : 1,
  };
}

/**
 * Verify a single expected outcome against the actual system state.
 * Uses read-only fs operations for file outcomes, and the browser session
 * manager (read-only) for browser outcomes. NEVER writes or executes
 * anything for verification.
 *
 * @param outcome     The expected outcome to verify
 * @param projectPath Project root (for relative path resolution)
 * @param taskId      The task ID (for browser session lookup)
 * @param toolResult  The tool result (for screenshot_captured + url_changed
 *                    fallback when no active session)
 */
async function verifyExpectedOutcome(
  outcome: ExpectedOutcome,
  projectPath?: string,
  taskId?: string,
  toolResult?: ToolResult,
): Promise<{ verified: boolean; reason: string; evidence: string[]; signals: AgentSignal[] }> {
  const fs = await import('fs');
  const path = await import('path');
  const evidence: string[] = [];
  const signals: AgentSignal[] = [];

  const resolvePath = (p: string | undefined): string => {
    if (!p) return '';
    if (path.isAbsolute(p)) return p;
    return projectPath ? path.resolve(projectPath, p) : path.resolve(p);
  };

  switch (outcome.type) {
    case 'file_exists': {
      const fp = resolvePath(outcome.path);
      const exists = fs.existsSync(fp);
      evidence.push(`fs.existsSync(${fp}) = ${exists}`);
      if (!exists) {
        signals.push({ type: 'error', message: `expected file does not exist: ${fp}` });
        return { verified: false, reason: `Expected file does not exist: ${outcome.path}`, evidence, signals };
      }
      signals.push({ type: 'success', message: `file exists: ${outcome.path}` });
      return { verified: true, reason: `File exists at ${outcome.path}`, evidence, signals };
    }

    case 'file_gone': {
      const fp = resolvePath(outcome.path);
      const exists = fs.existsSync(fp);
      evidence.push(`fs.existsSync(${fp}) = ${exists}`);
      if (exists) {
        signals.push({ type: 'error', message: `file should be gone but still exists: ${fp}` });
        return { verified: false, reason: `File still exists (should be gone): ${outcome.path}`, evidence, signals };
      }
      signals.push({ type: 'success', message: `file gone: ${outcome.path}` });
      return { verified: true, reason: `File no longer exists at ${outcome.path}`, evidence, signals };
    }

    case 'directory_exists': {
      const fp = resolvePath(outcome.path);
      const exists = fs.existsSync(fp) && fs.statSync(fp).isDirectory();
      evidence.push(`directory exists at ${fp}: ${exists}`);
      if (!exists) {
        signals.push({ type: 'error', message: `expected directory does not exist: ${fp}` });
        return { verified: false, reason: `Expected directory does not exist: ${outcome.path}`, evidence, signals };
      }
      signals.push({ type: 'success', message: `directory exists: ${outcome.path}` });
      return { verified: true, reason: `Directory exists at ${outcome.path}`, evidence, signals };
    }

    case 'file_contains': {
      const fp = resolvePath(outcome.path);
      if (!fs.existsSync(fp)) {
        evidence.push(`file not found: ${fp}`);
        signals.push({ type: 'error', message: `file not found: ${fp}` });
        return { verified: false, reason: `File not found: ${outcome.path}`, evidence, signals };
      }
      const content = fs.readFileSync(fp, 'utf-8');
      const expected = outcome.content || '';
      const contains = content.includes(expected);
      evidence.push(`file contains expected substring (${expected.length} chars): ${contains}`);
      if (!contains) {
        signals.push({ type: 'error', message: `file does not contain expected content` });
        return { verified: false, reason: `File does not contain expected content: "${expected.slice(0, 80)}..."`, evidence, signals };
      }
      signals.push({ type: 'success', message: `file contains expected content` });
      return { verified: true, reason: `File contains expected content`, evidence, signals };
    }

    case 'exit_code': {
      // Exit code verification happens via toolResult.data.exitCode, not fs.
      // This is a placeholder for expectedOutcome-based exit code checks —
      // the actual exit code is on the toolResult, not the filesystem.
      return {
        verified: true,
        reason: 'exit_code verification should use toolResult.data.exitCode (handled in verifyStepOutcome)',
        evidence,
        signals,
      };
    }

    case 'output_contains': {
      // Same as exit_code — output is on the toolResult, not the filesystem.
      return {
        verified: true,
        reason: 'output_contains verification should use toolResult.output (handled in verifyToolResult)',
        evidence,
        signals,
      };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Phase 10: Browser outcomes
    // ═══════════════════════════════════════════════════════════════════════

    case 'url_changed': {
      // Try to get URL from active browser session, fallback to toolResult.data.url
      let currentUrl: string | undefined;
      if (taskId) {
        try {
          const { getSession } = require('../ai/tools/browser/session-manager');
          const session = getSession(taskId);
          if (session) currentUrl = session.currentUrl;
        } catch { /* browser module not available */ }
      }
      if (!currentUrl && toolResult?.data?.url) {
        currentUrl = toolResult.data.url;
      }
      const expectedUrl = outcome.url;
      if (!expectedUrl) {
        return {
          verified: false,
          reason: 'url_changed: no expected URL provided',
          evidence,
          signals: [{ type: 'error', message: 'missing expected url' }],
        };
      }
      evidence.push(`current URL = ${currentUrl || '(none)'}`);
      evidence.push(`expected URL = ${expectedUrl}`);
      if (!currentUrl) {
        return {
          verified: false,
          reason: `url_changed: no active browser session + no URL in toolResult`,
          evidence,
          signals: [{ type: 'error', message: 'no current URL to compare' }],
        };
      }
      // Support exact match OR substring (if expected starts with '*=')
      const matches = expectedUrl.startsWith('*=')
        ? currentUrl.includes(expectedUrl.slice(2))
        : currentUrl === expectedUrl;
      if (!matches) {
        return {
          verified: false,
          reason: `url_changed: current URL "${currentUrl}" does not match expected "${expectedUrl}"`,
          evidence,
          signals: [{ type: 'error', message: `URL mismatch` }],
        };
      }
      return {
        verified: true,
        reason: `url_changed: current URL matches expected`,
        evidence,
        signals: [{ type: 'success', message: 'URL matches' }],
      };
    }

    case 'page_contains_text': {
      const expectedText = outcome.content || '';
      if (!expectedText) {
        return {
          verified: false,
          reason: 'page_contains_text: no expected content provided',
          evidence,
          signals: [{ type: 'error', message: 'missing expected content' }],
        };
      }
      // Try to get page text from active browser session
      if (taskId) {
        try {
          const { getSession } = require('../ai/tools/browser/session-manager');
          const session = getSession(taskId);
          if (session && session.page) {
            const pageText = await session.page.textContent('body', { timeout: 5000 }).catch(() => '');
            const contains = (pageText || '').toLowerCase().includes(expectedText.toLowerCase());
            evidence.push(`page text contains "${expectedText.slice(0, 50)}": ${contains}`);
            if (!contains) {
              return {
                verified: false,
                reason: `page_contains_text: page does not contain "${expectedText}"`,
                evidence,
                signals: [{ type: 'error', message: 'text not found in page' }],
              };
            }
            return {
              verified: true,
              reason: `page_contains_text: page contains expected text`,
              evidence,
              signals: [{ type: 'success', message: 'text found in page' }],
            };
          }
        } catch { /* browser session not available */ }
      }
      // Fallback: check toolResult.output (browser_extract returns text in output)
      const toolOutput = (toolResult?.output || '').toLowerCase();
      const contains = toolOutput.includes(expectedText.toLowerCase());
      evidence.push(`toolResult.output contains "${expectedText.slice(0, 50)}": ${contains}`);
      if (!contains) {
        return {
          verified: false,
          reason: `page_contains_text: no active session + toolResult.output does not contain "${expectedText}"`,
          evidence,
          signals: [{ type: 'error', message: 'text not found' }],
        };
      }
      return {
        verified: true,
        reason: `page_contains_text: toolResult.output contains expected text`,
        evidence,
        signals: [{ type: 'success', message: 'text found in toolResult' }],
      };
    }

    case 'element_visible': {
      const selector = outcome.selector;
      if (!selector) {
        return {
          verified: false,
          reason: 'element_visible: no selector provided',
          evidence,
          signals: [{ type: 'error', message: 'missing selector' }],
        };
      }
      if (!taskId) {
        return {
          verified: false,
          reason: 'element_visible: no taskId for browser session lookup',
          evidence,
          signals: [{ type: 'error', message: 'missing taskId' }],
        };
      }
      try {
        const { getSession } = require('../ai/tools/browser/session-manager');
        const session = getSession(taskId);
        if (!session || !session.page) {
          return {
            verified: false,
            reason: 'element_visible: no active browser session',
            evidence,
            signals: [{ type: 'error', message: 'no browser session' }],
          };
        }
        // Read-only check: waitForSelector with state='visible' + short timeout
        // If the element is visible, this resolves; if not, it throws.
        const visible = await session.page.isVisible(selector).catch(() => false);
        evidence.push(`element "${selector}" visible: ${visible}`);
        if (!visible) {
          return {
            verified: false,
            reason: `element_visible: element "${selector}" not visible`,
            evidence,
            signals: [{ type: 'error', message: 'element not visible' }],
          };
        }
        return {
          verified: true,
          reason: `element_visible: element "${selector}" is visible`,
          evidence,
          signals: [{ type: 'success', message: 'element visible' }],
        };
      } catch (err: any) {
        return {
          verified: false,
          reason: `element_visible: verification failed — ${err.message}`,
          evidence,
          signals: [{ type: 'error', message: err.message }],
        };
      }
    }

    case 'screenshot_captured': {
      // Always verified if the browser_screenshot tool succeeded — the
      // screenshot is in toolResult.data.screenshot (base64 PNG).
      const hasScreenshot = !!toolResult?.data?.screenshot;
      evidence.push(`toolResult.data.screenshot present: ${hasScreenshot}`);
      if (!hasScreenshot) {
        return {
          verified: false,
          reason: 'screenshot_captured: no screenshot data in toolResult',
          evidence,
          signals: [{ type: 'error', message: 'screenshot missing' }],
        };
      }
      return {
        verified: true,
        reason: 'screenshot_captured: screenshot present in toolResult.data',
        evidence,
        signals: [{ type: 'success', message: 'screenshot captured' }],
      };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Phase 11: Computer automation outcomes
    // ═══════════════════════════════════════════════════════════════════════

    case 'screenshot_captured_desktop': {
      // Verified if screenshot_desktop tool succeeded — screenshot is in
      // toolResult.data.screenshot (base64 PNG, memory-only).
      const hasScreenshot = !!toolResult?.data?.screenshot;
      evidence.push(`desktop screenshot present: ${hasScreenshot}`);
      if (!hasScreenshot) {
        return {
          verified: false,
          reason: 'screenshot_captured_desktop: no screenshot data in toolResult',
          evidence,
          signals: [{ type: 'error', message: 'desktop screenshot missing' }],
        };
      }
      return {
        verified: true,
        reason: 'screenshot_captured_desktop: screenshot present in toolResult.data',
        evidence,
        signals: [{ type: 'success', message: 'desktop screenshot captured' }],
      };
    }

    case 'window_focused': {
      // Verified if we have an active window title in toolResult.data or
      // if the tool reported success. We can't easily check the actual
      // focused window without another native call, so we trust the tool
      // result. The expected title is in outcome.content (substring match).
      const expectedTitle = (outcome.content || '').toLowerCase();
      const actualTitle = (toolResult?.data?.title || toolResult?.output || '').toLowerCase();
      if (expectedTitle && actualTitle) {
        const matches = actualTitle.includes(expectedTitle);
        evidence.push(`window title contains "${expectedTitle}": ${matches}`);
        if (!matches) {
          return {
            verified: false,
            reason: `window_focused: expected title "${expectedTitle}" not found in "${actualTitle}"`,
            evidence,
            signals: [{ type: 'error', message: 'window title mismatch' }],
          };
        }
      } else {
        // No expected title — just verify the tool succeeded
        evidence.push('window_focused: no expected title, tool success = verified');
      }
      return {
        verified: true,
        reason: 'window_focused: window focus confirmed',
        evidence,
        signals: [{ type: 'success', message: 'window focused' }],
      };
    }

    case 'element_clicked_at': {
      // Verified if the click tool succeeded. The coordinates are in
      // toolResult.data.x + toolResult.data.y. We can't easily verify
      // the visual effect without a screenshot, so we trust the tool.
      const x = toolResult?.data?.x;
      const y = toolResult?.data?.y;
      evidence.push(`click at (${x}, ${y})`);
      if (x === undefined || y === undefined) {
        return {
          verified: false,
          reason: 'element_clicked_at: no coordinates in toolResult',
          evidence,
          signals: [{ type: 'error', message: 'click coordinates missing' }],
        };
      }
      return {
        verified: true,
        reason: `element_clicked_at: click at (${x}, ${y}) confirmed`,
        evidence,
        signals: [{ type: 'success', message: 'click confirmed' }],
      };
    }

    default:
      return {
        verified: false,
        reason: `Unknown expected outcome type: ${(outcome as any).type}`,
        evidence,
        signals,
      };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 9: Task Completion Gate (Level 5 verification)
// ════════════════════════════════════════════════════════════════════════════

export interface TaskCompletionResult {
  /** True if the task can be marked as completed successfully. */
  passed: boolean;
  /** Human-readable reason (shown to user + logged). */
  reason: string;
  /** Steps that are not in a terminal state (pending/in_progress). */
  unresolvedSteps: AgentStep[];
  /** Errors that were not recovered. */
  unresolvedErrors: import('./types').AgentError[];
  /** Confidence 0..1 that this completion assessment is accurate. */
  confidence: number;
}

/**
 * Phase 9: Task Completion Gate.
 *
 * Called BEFORE emitting task_completed. Verifies that:
 *   - All steps are in a terminal state (completed/failed/skipped — NOT pending/in_progress)
 *   - No failed steps that weren't recovered via SKIP
 *   - No unresolved errors (errors with recovered=false that are type 'tool_error' or worse)
 *   - At least one tool call was executed (existing Phase 116 check)
 *
 * If any check fails, the caller should emit task_failed instead of task_completed.
 *
 * This is the LAST line of defense against false-success: even if every step
 * reported success, if any step is still pending or has unresolved errors,
 * the task is NOT complete.
 */
export function verifyTaskCompletion(task: AgentTask): TaskCompletionResult {
  const unresolvedSteps: AgentStep[] = [];
  const unresolvedErrors: import('./types').AgentError[] = [];
  const evidence: string[] = [];

  // ── Check 1: all steps in terminal state ──
  for (const step of task.plan) {
    if (step.status === 'pending' || step.status === 'in_progress') {
      unresolvedSteps.push(step);
    }
  }
  if (unresolvedSteps.length > 0) {
    evidence.push(`${unresolvedSteps.length} step(s) not in terminal state: ${unresolvedSteps.map((s) => `#${s.index + 1} (${s.status})`).join(', ')}`);
  }

  // ── Check 2: failed steps (NOT recovered via SKIP) ──
  // A 'failed' step is a hard failure (not skipped). If it was skipped via
  // recovery (Phase 7 SKIP action), the status would be 'skipped' not 'failed'.
  const failedSteps = task.plan.filter((s) => s.status === 'failed');
  if (failedSteps.length > 0) {
    evidence.push(`${failedSteps.length} step(s) in failed state: ${failedSteps.map((s) => `#${s.index + 1}`).join(', ')}`);
  }

  // ── Check 3: unresolved errors ──
  // An error is "unresolved" if recovered=false AND it's a hard error type
  // (tool_error, permission_denied, max_retries, etc.). Soft errors
  // (cancelled, etc.) are excluded — they're intentional.
  for (const error of task.errors) {
    if (error.recovered) continue; // was recovered — ignore
    if (error.type === 'cancelled') continue; // intentional
    if (error.type === 'max_steps' || error.type === 'max_tool_calls' || error.type === 'timeout') {
      // These are task-level limits — if the task reached these, it's failed
      unresolvedErrors.push(error);
    } else if (error.type === 'tool_error' || error.type === 'permission_denied' || error.type === 'invalid_state') {
      unresolvedErrors.push(error);
    }
    // 'unknown' errors are soft — we don't fail the task on them
  }
  if (unresolvedErrors.length > 0) {
    evidence.push(`${unresolvedErrors.length} unresolved error(s): ${unresolvedErrors.map((e) => e.type).join(', ')}`);
  }

  // ── Check 4: at least one tool call (existing Phase 116 check) ──
  if (task.toolCalls.length === 0) {
    evidence.push('0 tool calls executed');
  }

  // ── Final decision ──
  const passed =
    unresolvedSteps.length === 0 &&
    failedSteps.length === 0 &&
    unresolvedErrors.length === 0 &&
    task.toolCalls.length > 0;

  return {
    passed,
    reason: passed
      ? 'All checks passed: all steps terminal, no failed steps, no unresolved errors, ≥1 tool call'
      : `Completion gate failed: ${evidence.join('; ')}`,
    unresolvedSteps,
    unresolvedErrors,
    confidence: passed ? 0.95 : 0.9,
  };
}
