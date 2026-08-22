/**
 * NEX AI — Planner
 *
 * Breaks a user request into a sequence of AgentSteps.
 *
 * Approach (Phase 7 — without function-calling models):
 *  - Use the LLM to generate a structured plan as JSON
 *  - Parse the JSON into AgentStep[]
 *  - If parsing fails, fall back to a heuristic single-step plan
 *
 * Phase 8+ will use function-calling models when available (gpt-4o,
 * claude-3.5-sonnet support native function calling).
 *
 * The planner NEVER executes tools itself — it only creates the plan.
 * Agent Core executes the steps.
 */

import type { AIRuntime, ChatMessage } from '../ai/runtime';
import type { LocalModelInfo } from '../ai/model-registry';
import type { AgentStep } from './types';
import type { ToolDefinition } from '../ai/tool-registry';
import { buildContext, estimateTokens } from './context-manager';
import { AgentLogger } from './logger';

export interface PlanRequest {
  userRequest: string;
  intent?: string;
  // Available tools (for the planner to choose from)
  tools: ToolDefinition[];
  // Recent conversation (so planner knows what was already done)
  recentConversation?: ChatMessage[];
  // Project context
  projectPath?: string;
  activeFile?: string;
}

export interface PlanResult {
  steps: AgentStep[];
  reasoning: string;
  // Whether the planner thinks it can complete the task
  confidence: number;
  // Any warnings (e.g. ambiguous request)
  warnings: string[];
}

const PLANNER_SYSTEM_PROMPT = `You are the NEX AI Planner. Your job is to break down a user request into concrete, executable steps.

Each step must be one of:
- A tool call: {"tool": "<tool_name>", "params": {...}}
- A reasoning/observation step: {"action": "observe", "description": "..."}
- A verification step: {"action": "verify", "description": "..."}

Output STRICT JSON only — no markdown, no explanation outside JSON.

Format:
{
  "reasoning": "Why you chose this plan",
  "confidence": 0.0-1.0,
  "warnings": ["..."],
  "steps": [
    {
      "description": "What this step does",
      "tool": "tool_name",
      "params": {"param": "value"}
    },
    {
      "description": "Analyze the result",
      "action": "observe"
    },
    {
      "description": "Verify build passes",
      "action": "verify",
      "tool": "npm_build"
    }
  ]
}

Rules:
- Start with reconnaissance (list_directory, read_file) before making changes
- For multi-file changes, group related changes together
- ALWAYS include a verification step at the end (run tests, build, etc.)
- For destructive operations, mark them as needing permission: {"requiresPermission": "write"}
- Maximum 15 steps per plan
- If the task is simple (e.g. "what is 2+2"), the plan can have 1 step

Available tools:`;

/**
 * Generate a plan for the user's request.
 */
export async function generatePlan(
  runtime: AIRuntime,
  model: LocalModelInfo,
  request: PlanRequest
): Promise<PlanResult> {
  // Build tool descriptions for the system prompt
  const toolList = request.tools.map((t) =>
    `- ${t.name} (${t.category}, permission: ${t.permission}): ${t.description}`
  ).join('\n');

  const systemPrompt = `${PLANNER_SYSTEM_PROMPT}\n\n${toolList}`;

  const context = buildContext(model, {
    userRequest: request.userRequest,
    intent: request.intent || 'general-task',
    recentConversation: request.recentConversation,
    projectPath: request.projectPath,
    activeFile: request.activeFile,
    systemPrompt,
    toolSchemas: request.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  });

  AgentLogger.plan(`Generating plan for: "${request.userRequest.slice(0, 80)}..."`, '', {
    data: { toolCount: request.tools.length, conversationLength: request.recentConversation?.length || 0 },
  } as any);

  try {
    const result = await runtime.chat(context.messages, {
      contextSize: model.contextSize,
      temperature: 0.3,  // Low temperature for structured output
      maxTokens: 1500,
      systemPrompt,
    });

    return parsePlanResponse(result.content, request);
  } catch (err: any) {
    AgentLogger.error(`Planner failed: ${err.message}`);
    return fallbackPlan(request.userRequest, err.message);
  }
}

/**
 * Parse the LLM's response into a structured plan.
 * Tolerates JSON-with-prefix-text (e.g. "Here's my plan:\n```json\n{...}\n```").
 */
function parsePlanResponse(response: string, request: PlanRequest): PlanResult {
  // Try to extract JSON from the response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    AgentLogger.warn('Planner response was not JSON, using fallback', {
      data: { responsePreview: response.slice(0, 200) },
    });
    return fallbackPlan(request.userRequest, 'Planner did not return JSON');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err: any) {
    AgentLogger.warn(`Planner JSON parse failed: ${err.message}`, {
      data: { jsonPreview: jsonMatch[0].slice(0, 200) },
    });
    return fallbackPlan(request.userRequest, `JSON parse error: ${err.message}`);
  }

  if (!Array.isArray(parsed.steps)) {
    return fallbackPlan(request.userRequest, 'Plan missing steps[]');
  }

  const steps: AgentStep[] = parsed.steps.map((s: any, idx: number) => ({
    id: `step-${idx + 1}-${Date.now().toString(36)}`,
    index: idx,
    description: s.description || s.action || '(no description)',
    toolName: s.tool,
    toolParams: s.params || {},
    requiresPermission: s.requiresPermission,
    requiresDiffApproval: s.requiresDiffApproval || (s.tool === 'write_file' || s.tool === 'edit_file'),
    status: 'pending',
    retryCount: 0,
  }));

  return {
    steps,
    reasoning: parsed.reasoning || '(no reasoning provided)',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
  };
}

/**
 * Fallback plan when the planner fails: a single step that just attempts
 * to answer the user's request directly (no tools).
 */
function fallbackPlan(userRequest: string, reason: string): PlanResult {
  return {
    steps: [{
      id: `fallback-${Date.now().toString(36)}`,
      index: 0,
      description: `Direct response to user (planner fallback: ${reason})`,
      status: 'pending',
      retryCount: 0,
    }],
    reasoning: `Planner failed (${reason}). Falling back to direct response.`,
    confidence: 0.3,
    warnings: ['Planner failed; using fallback single-step plan'],
  };
}
