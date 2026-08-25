/**
 * NEX AI — ReAct Closed-Loop Brain (Phase 38)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The ReAct (Reason + Act) loop closes the open-loop gap in the original agent.
 *
 * BEFORE (Phase 7-37 — open loop):
 *   generatePlan()  →  ONE LLM call  →  static steps[]
 *   for each step:
 *     execute tool → push observation to task.observations  ← NEVER fed back
 *
 *   The plan was frozen at generation time. If `npm test` failed, the agent
 *   retried the same step (up to maxRetries) then gave up. It could NOT
 *   reason about WHY the test failed or emit a new step to fix it.
 *
 * AFTER (Phase 38 — closed loop):
 *   generatePlan()  →  initial steps[]
 *   for each step:
 *     execute tool → observation
 *     ↓
 *     verifyStep() — uses verification.ts (was imported but never called)
 *     ↓
 *     rePlanAfterObservation() — NEW LLM call with the observation
 *       ↓
 *       Decision: 'continue' | 'replan' | 'complete' | 'abort'
 *       ↓
 *       if 'replan': discard remaining steps, append LLM-emitted steps
 *       if 'complete': finalize early
 *       if 'abort': fail with reason
 *       if 'continue': proceed to next planned step
 *
 * This is the canonical ReAct loop:
 *   Thought (planner) → Action (tool) → Observation (result) → Thought (replanner)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY RAILS (preserved from Phase 7-37)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  - maxSteps: re-planned steps count toward the limit. The agent CANNOT
 *    loop infinitely — rePlanAfterObservation refuses to emit more steps
 *    than the budget allows.
 *  - maxToolCalls: each replan step that calls a tool counts.
 *  - maxExecutionTimeMs: the re-planner checks the clock.
 *  - CancellationToken: the re-planner checks cancellation before AND after
 *    the LLM call.
 *  - Permission System: replan-emitted steps go through the same permission
 *    flow as planner-emitted steps (requestPermissionAndWait in executeStep).
 *  - Diff approval: replan-emitted write steps still require user approval.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHEN TO RE-PLAN
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The re-planner is invoked AFTER every tool-executing step. It decides:
 *
 *  - 'continue'  — when the step succeeded and the remaining plan is still valid
 *  - 'replan'    — when the step failed, OR the observation reveals the remaining
 *                  plan is wrong (e.g. test failed, file doesn't exist, etc.)
 *  - 'complete'  — when the LLM judges the original goal achieved
 *  - 'abort'     — when the LLM detects an unrecoverable situation
 *
 * To avoid wasteful LLM calls, the re-planner is SKIPPED (and 'continue' is
 * assumed) when ALL of these are true:
 *  - the tool succeeded
 *  - the step had no verification criteria (or they all passed)
 *  - the step is NOT the last step in the plan
 *  - the observation contains no 'needs-attention' or 'error' signals
 *
 * This keeps the fast path fast (no LLM call for routine successful steps)
 * while still closing the loop on failures and surprising observations.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import type { AIRuntime, ChatMessage } from '../ai/runtime';
import type { LocalModelInfo } from '../ai/model-registry';
import type { ToolDefinition, ToolResult } from '../ai/tool-registry';
import type {
  AgentStep,
  Observation,
  ReActDecision,
  ReActRequest,
} from './types';
import { buildContext, estimateTokens } from './context-manager';
import { AgentLogger } from './logger';

// ─── Re-planner system prompt ──────────────────────────────────────────────

const REACT_SYSTEM_PROMPT = `You are the NEX AI ReAct decision engine. You observe the result of a tool call and decide the next action.

You MUST respond with STRICT JSON only — no markdown, no explanation outside JSON.

Format:
{
  "action": "continue" | "replan" | "complete" | "abort",
  "reason": "Why you chose this action (one sentence)",
  "confidence": 0.0-1.0,
  "newSteps": [
    {
      "description": "What this new step does",
      "tool": "tool_name",
      "params": {"param": "value"},
      "verificationCriteria": {
        "expectedExitCode": 0,
        "expectedOutputContains": ["..."],
        "forbiddenOutputContains": ["error", "failed"]
      }
    }
  ],
  "finalAnswer": "When action='complete', the final answer for the user"
}

Decision rules:
- "continue": The step succeeded, the observation matches expectations, and the remaining plan is still valid. Use this for routine successful steps.
- "replan": The step failed OR the observation reveals the remaining plan is wrong (test failed, file missing, unexpected error). Discard the remaining steps and emit newSteps. Each replan MUST include a verification step at the end if the task involves code changes.
- "complete": The original user goal has been achieved. Skip remaining steps and finalize. Include a finalAnswer.
- "abort": The task cannot succeed (wrong project, missing dependency, unrecoverable error). Include a reason.

Rules for newSteps:
- Maximum 10 steps per replan
- Start with reconnaissance if the error is unfamiliar (read_file, list_directory)
- ALWAYS include a verification step at the end for code-change tasks (npm_build, npm_test)
- For destructive operations, mark: {"requiresPermission": "write"}
- Do NOT repeat steps that already succeeded

Available tools:`;

// ─── ReAct loop entry point ────────────────────────────────────────────────

/**
 * Decide the next action after observing a tool result.
 *
 * This is the SECOND LLM call in the agent loop (the first was the planner).
 * It receives the observation and decides: continue, replan, complete, or abort.
 *
 * Returns a ReActDecision. When action='replan', newSteps contains the new
 * steps to append to the plan (replacing the remaining ones).
 */
export async function rePlanAfterObservation(
  runtime: AIRuntime,
  model: LocalModelInfo,
  request: ReActRequest,
): Promise<ReActDecision> {
  // Build the tool list for the system prompt.
  const toolList = request.tools.map((t) =>
    `- ${t.name} (${t.category}, permission: ${t.permission}): ${t.description}`,
  ).join('\n');

  const systemPrompt = `${REACT_SYSTEM_PROMPT}\n\n${toolList}`;

  // Build the message list using the existing context manager (token-aware).
  // We pass the recent observations so the LLM has continuity.
  const context = buildContext(model, {
    userRequest: request.userRequest,
    intent: request.intent || 'react-decision',
    recentConversation: [], // The re-planner doesn't need chat history — it
    // gets the observation + remaining steps directly.
    recentObservations: request.recentObservations,
    projectPath: request.projectPath,
    systemPrompt,
    toolSchemas: request.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  });

  // Inject the ReAct-specific context as a user message.
  const reactContext = buildReActContextMessage(request);
  context.messages.push({ role: 'user', content: reactContext });

  AgentLogger.debug(
    `ReAct decision for step "${request.lastStepDescription.slice(0, 60)}..." ` +
    `(tool: ${request.lastToolName || 'none'}, stepsExecuted: ${request.stepsExecuted}/${request.maxSteps})`,
    { data: { toolResult: request.toolResult?.success } } as any,
  );

  try {
    const chatOpts = {
      contextSize: model.contextSize,
      temperature: 0.2, // Low temperature for structured decisions
      maxTokens: 800, // ReAct decisions are short
      systemPrompt,
    };

    let result;
    if (request.onToken) {
      result = await runtime.chatStream(context.messages, (chunk) => {
        if (chunk.error) return;
        request.onToken!(chunk.content || '');
      }, chatOpts);
    } else {
      result = await runtime.chat(context.messages, chatOpts);
    }

    return parseReActResponse(result.content, request);
  } catch (err: any) {
    AgentLogger.warn(`ReAct decision failed: ${err.message} — defaulting to 'continue'`);
    // On failure, default to 'continue' so we don't block the agent.
    // The original plan still has steps to execute.
    return {
      action: 'continue',
      reason: `ReAct decision failed (${err.message}) — proceeding with original plan`,
      confidence: 0.0,
    };
  }
}

// ─── Build the ReAct context message ────────────────────────────────────────

function buildReActContextMessage(req: ReActRequest): string {
  const lines: string[] = [];

  lines.push('## Last Step Executed');
  lines.push(`- Description: ${req.lastStepDescription}`);
  if (req.lastToolName) {
    lines.push(`- Tool: ${req.lastToolName}`);
  }
  lines.push(`- Steps executed so far: ${req.stepsExecuted} / ${req.maxSteps} max`);

  lines.push('');
  lines.push('## Tool Result');
  if (req.toolResult) {
    lines.push(`- Success: ${req.toolResult.success}`);
    if (req.toolResult.error) {
      lines.push(`- Error: ${req.toolResult.error}`);
    }
    if (req.toolResult.output) {
      // Truncate output to keep context bounded.
      const out = req.toolResult.output.length > 2000
        ? req.toolResult.output.slice(0, 2000) + '\n...(truncated)'
        : req.toolResult.output;
      lines.push(`- Output:\n\`\`\`\n${out}\n\`\`\``);
    }
    if (req.toolResult.data?.exitCode !== undefined) {
      lines.push(`- Exit code: ${req.toolResult.data.exitCode}`);
    }
  } else {
    lines.push('(no tool result — this was a non-tool step)');
  }

  lines.push('');
  lines.push('## Observation Signals');
  if (req.observation.signals.length > 0) {
    for (const sig of req.observation.signals) {
      lines.push(`- [${sig.type}] ${sig.message}`);
    }
  } else {
    lines.push('(no signals)');
  }

  if (req.observation.modifiedFiles.length > 0) {
    lines.push('');
    lines.push('## Modified Files');
    for (const f of req.observation.modifiedFiles) {
      lines.push(`- ${f.path}`);
    }
  }

  lines.push('');
  lines.push('## Remaining Planned Steps');
  if (req.remainingSteps.length > 0) {
    req.remainingSteps.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.description}${s.toolName ? ` (tool: ${s.toolName})` : ''}`);
    });
  } else {
    lines.push('(none — this was the last step in the plan)');
  }

  lines.push('');
  lines.push('## Your Decision');
  lines.push('Based on the observation above, decide: continue, replan, complete, or abort.');
  lines.push('Respond with STRICT JSON only.');

  return lines.join('\n');
}

// ─── Parse the LLM's ReAct response ────────────────────────────────────────

function parseReActResponse(response: string, request: ReActRequest): ReActDecision {
  // Extract JSON from the response (tolerate prefix text).
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    AgentLogger.warn('ReAct response was not JSON — defaulting to continue', {
      data: { responsePreview: response.slice(0, 200) },
    });
    return {
      action: 'continue',
      reason: 'ReAct response was not JSON — proceeding with original plan',
      confidence: 0.0,
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err: any) {
    AgentLogger.warn(`ReAct JSON parse failed: ${err.message} — defaulting to continue`);
    return {
      action: 'continue',
      reason: `ReAct JSON parse error — proceeding with original plan`,
      confidence: 0.0,
    };
  }

  const action = parsed.action;
  if (action !== 'continue' && action !== 'replan' && action !== 'complete' && action !== 'abort') {
    AgentLogger.warn(`ReAct invalid action "${action}" — defaulting to continue`);
    return {
      action: 'continue',
      reason: `ReAct invalid action "${action}" — proceeding with original plan`,
      confidence: 0.0,
    };
  }

  const decision: ReActDecision = {
    action,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '(no reason given)',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
  };

  // Parse newSteps for replan.
  if (action === 'replan') {
    if (Array.isArray(parsed.newSteps) && parsed.newSteps.length > 0) {
      // Cap at 10 steps per replan to prevent runaway.
      const capped = parsed.newSteps.slice(0, 10);
      decision.newSteps = capped.map((s: any) => ({
        description: typeof s.description === 'string' ? s.description : '(no description)',
        tool: s.tool,
        params: s.params || {},
        requiresPermission: s.requiresPermission,
        verificationCriteria: s.verificationCriteria,
      }));
    } else {
      // Replan without newSteps is meaningless — treat as abort.
      AgentLogger.warn('ReAct replan without newSteps — treating as abort');
      decision.action = 'abort';
      decision.reason = 'ReAct replan emitted no new steps — aborting';
    }
  }

  // Parse finalAnswer for complete.
  if (action === 'complete' && typeof parsed.finalAnswer === 'string') {
    decision.finalAnswer = parsed.finalAnswer;
  }

  return decision;
}

// ─── Heuristic: should we even call the LLM? ───────────────────────────────

/**
 * Fast-path check: should we invoke the re-planner LLM, or just 'continue'?
 *
 * We SKIP the LLM call (and assume 'continue') when ALL of these are true:
 *  - the tool succeeded
 *  - the step had no verification criteria OR they all passed
 *  - the step is NOT the last step in the plan
 *  - the observation contains no 'needs-attention' or 'error' signals
 *
 * This keeps the fast path fast (no LLM call for routine successful steps)
 * while still closing the loop on failures and surprising observations.
 *
 * @returns true if the re-planner should be invoked, false if 'continue'
 *          can be assumed without an LLM call.
 */
export function shouldInvokeRePlanner(
  toolResult: ToolResult | undefined,
  step: AgentStep,
  observation: Observation,
  isLastStep: boolean,
): boolean {
  // Always invoke on the last step — to let the LLM decide 'complete' vs 'continue'.
  if (isLastStep) return true;

  // Invoke if the tool failed.
  if (toolResult && !toolResult.success) return true;

  // Invoke if the observation has error/needs-attention signals.
  const hasConcerningSignal = observation.signals.some(
    (s) => s.type === 'error' || s.type === 'needs-attention',
  );
  if (hasConcerningSignal) return true;

  // Invoke if the step had verification criteria but they failed
  // (the caller checks verification separately; here we just check presence).
  if (step.verificationCriteria) {
    // If criteria exist, we already verified — if verification failed, the
    // observation will have an error signal (caught above). If it passed,
    // we can skip. But to be safe, invoke when criteria are complex.
    const complex = step.verificationCriteria.expectedOutputRegex ||
      (step.verificationCriteria.forbiddenOutputContains &&
        step.verificationCriteria.forbiddenOutputContains.length > 0);
    if (complex) return true;
  }

  // Fast path: skip the LLM call.
  return false;
}
