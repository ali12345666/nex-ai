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
import type { ContextKnowledgeItem } from './types';

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
  // Phase 9 / P9-S4: retrieved knowledge (cited, untrusted-framed)
  relevantKnowledge?: ContextKnowledgeItem[];
  // Phase 40: semantically retrieved memories (ranked by relevance)
  relevantMemories?: Array<{
    store: string;
    key: string;
    content: string;
    score: number;
    importance: number;
  }>;
  // Phase 8 / P8-E-1: streaming callback. When provided, the planner uses
  // runtime.chatStream instead of runtime.chat and forwards each chunk.
  onToken?: (chunk: string) => void;
}

/** Phase 8 / P8-E-2: token/time usage surfaced to events & UI. */
export interface PlanUsage {
  promptTokens?: number;
  completionTokens?: number;
  tokensGenerated?: number;
  durationMs?: number;
}

export interface PlanResult {
  steps: AgentStep[];
  reasoning: string;
  // Whether the planner thinks it can complete the task
  confidence: number;
  // Any warnings (e.g. ambiguous request)
  warnings: string[];
  // Phase 8 / P8-E-2: usage telemetry from the planning call
  usage?: PlanUsage;
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
    relevantKnowledge: request.relevantKnowledge,
    // Phase 40: pass semantically retrieved memories to the context builder
    relevantMemories: request.relevantMemories,
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
    const started = Date.now();
    const chatOpts = {
      contextSize: model.contextSize,
      temperature: 0.3,  // Low temperature for structured output
      // Phase 116 FIX: maxTokens was 1500, but Qwen3-8B produces thinking
      // tokens BEFORE the actual JSON output. The thinking section can
      // easily consume 1000+ tokens, leaving only ~500 for the JSON —
      // which gets truncated, causing JSON parse failure and fallback to
      // a no-tool plan. Now 3072 gives ample room for thinking + JSON.
      maxTokens: 3072,
      systemPrompt,
    };

    console.log('[PLANNER_DEBUG] generating plan...', {
      toolCount: request.tools.length,
      contextSize: chatOpts.contextSize,
      maxTokens: chatOpts.maxTokens,
      temperature: chatOpts.temperature,
      userRequest: request.userRequest.slice(0, 100),
    });

    // Phase 8 / P8-E-1: stream when a token callback is provided.
    let result;
    if (request.onToken) {
      result = await runtime.chatStream(context.messages, (chunk) => {
        if (chunk.error) return;
        request.onToken!(chunk.content || '');
      }, chatOpts);
    } else {
      result = await runtime.chat(context.messages, chatOpts);
    }

    // Phase 116: Log the raw planner response for diagnosis
    console.log('[PLANNER_DEBUG] raw response length:', result.content?.length || 0);
    console.log('[PLANNER_DEBUG] raw response (first 1000 chars):', (result.content || '').slice(0, 1000));
    console.log('[PLANNER_DEBUG] raw response (last 200 chars):', (result.content || '').slice(-200));

    if (!result.content || result.content.trim().length === 0) {
      console.error('[PLANNER_ERROR] Empty response from model!');
      return fallbackPlan(request.userRequest, 'Planner produced empty response');
    }

    const plan = parsePlanResponse(result.content, request);
    plan.usage = {
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      tokensGenerated: result.tokensGenerated,
      durationMs: Date.now() - started,
    };
    console.log('[PLANNER_DEBUG] plan created:', {
      stepCount: plan.steps.length,
      confidence: plan.confidence,
      tools: plan.steps.map(s => s.toolName || '(none)').join(', '),
    });
    return plan;
  } catch (err: any) {
    console.error('[PLANNER_ERROR] Planner threw:', err.message);
    console.error('[PLANNER_ERROR] stack:', err.stack?.split('\n').slice(0, 5).join('\n'));
    AgentLogger.error(`Planner failed: ${err.message}`);
    return fallbackPlan(request.userRequest, err.message);
  }
}

/**
 * Strip Qwen3 thinking/reasoning tokens from the response.
 * Qwen3 models produce blocks.
 * The actual JSON output comes AFTER the closing </think> tag.
 *
 * Also strips markdown code fences (```json ... ``` or ``` ... ```).
 *
 * Phase 116 FIX: The old parser used a simple regex that failed when the
 * model wrapped JSON in think blocks or code fences, causing the planner
 * to fall back to a no-tool "direct response" plan — which is why the
 * agent showed "0 tool calls executed".
 */
function cleanPlanResponse(response: string): string {
  let cleaned = response;

  // Strip Qwen3 thinking tokens: everything before and including </think>
  // The model outputs reasoning inside <think> blocks, then the JSON
  const thinkEnd = cleaned.indexOf('</think>');
  if (thinkEnd !== -1) {
    cleaned = cleaned.substring(thinkEnd + '</think>'.length).trim();
    console.log('[PLANNER_DIAG] stripped think block, remaining length:', cleaned.length);
  }

  // Strip markdown code fences if present (```json ... ``` or ``` ... ```)
  const codeFenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeFenceMatch) {
    cleaned = codeFenceMatch[1].trim();
    console.log('[PLANNER_DIAG] stripped code fence, remaining length:', cleaned.length);
  }

  return cleaned;
}

/**
 * Parse the LLM's response into a structured plan.
 * Tolerates JSON-with-prefix-text, markdown code fences, and Qwen3 thinking tokens.
 */
function parsePlanResponse(response: string, request: PlanRequest): PlanResult {
  // Phase 116: Log the raw response for diagnosis
  console.log('[PLANNER_DIAG] raw response length:', response.length);
  console.log('[PLANNER_DIAG] raw response preview:', response.slice(0, 500));

  // Clean the response (strip think blocks + code fences)
  const cleaned = cleanPlanResponse(response);

  // Try to extract JSON object — find the first { and the LAST }
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    AgentLogger.warn('Planner response was not JSON, using fallback', {
      data: { responsePreview: response.slice(0, 200) },
    });
    console.warn('[PLANNER_DIAG] no JSON found in response — falling back');
    return fallbackPlan(request.userRequest, 'Planner did not return JSON');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonMatch[0]);
    console.log('[PLANNER_DIAG] JSON parsed OK, steps:', Array.isArray(parsed.steps) ? parsed.steps.length : 'NOT ARRAY');
  } catch (err: any) {
    AgentLogger.warn(`Planner JSON parse failed: ${err.message}`, {
      data: { jsonPreview: jsonMatch[0].slice(0, 200) },
    });
    console.warn('[PLANNER_DIAG] JSON parse failed:', err.message);
    console.warn('[PLANNER_DIAG] attempted JSON:', jsonMatch[0].slice(0, 300));
    return fallbackPlan(request.userRequest, `JSON parse error: ${err.message}`);
  }

  if (!Array.isArray(parsed.steps)) {
    console.warn('[PLANNER_DIAG] parsed.steps is not an array:', typeof parsed.steps);
    return fallbackPlan(request.userRequest, 'Plan missing steps[]');
  }

  if (parsed.steps.length === 0) {
    console.warn('[PLANNER_DIAG] parsed.steps is empty array');
    return fallbackPlan(request.userRequest, 'Plan has 0 steps');
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

  console.log('[PLANNER_DIAG] plan created with', steps.length, 'steps');
  console.log('[PLANNER_DIAG] tools in plan:', steps.map(s => s.toolName || '(none)').join(', '));

  return {
    steps,
    reasoning: parsed.reasoning || '(no reasoning provided)',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
  };
}

/**
 * Heuristic fallback plan when the planner fails to produce valid JSON.
 *
 * Phase 116 FIX: Previously, the fallback created a single step WITHOUT
 * a toolName — which executeStep() treated as a "non-tool step" and just
 * marked as "completed". This resulted in "0 tool calls executed" even
 * when the user clearly requested file operations.
 *
 * Now, the fallback analyzes the user request for common patterns:
 *   - "create folder" / "ساز" / "بساز" → write_file with create_dirs
 *   - "write file" / "بنویس" → write_file
 *   - "read file" / "بخوان" → read_file
 *   - "list directory" / "لیست" → list_directory
 *
 * If a pattern is matched, we create real tool calls. If no pattern
 * matches, we fail the task (rather than falsely succeeding with 0 tools).
 */
function fallbackPlan(userRequest: string, reason: string): PlanResult {
  console.warn('[PLANNER_DIAG] FALLBACK triggered — reason:', reason);
  console.warn('[PLANNER_DIAG] user request was:', userRequest.slice(0, 100));

  const steps: AgentStep[] = [];
  const lower = userRequest.toLowerCase();

  // Extract folder name from request (e.g., "NEX-Test" from "یه پوشه به اسم NEX-Test بساز")
  const folderMatch = userRequest.match(/(?:پوشه|folder|directory)\s*(?:ای|به)?\s*(?:اسم|نام|name)?\s*[:：]?\s*([A-Za-z0-9_\-]+)/i);
  const folderName = folderMatch?.[1] || 'NEX-Folder';

  // Extract file name (e.g., "hello.txt" from "فایل hello.txt بساز")
  const fileMatch = userRequest.match(/(?:فایل|file)\s*(?:ای|به)?\s*(?:اسم|نام|name)?\s*[:：]?\s*([A-Za-z0-9_\-\.]+)/i);
  const fileName = fileMatch?.[1] || 'hello.txt';

  // Extract content to write (e.g., "بنویس سلام من نکس هستم" → "سلام من نکس هستم")
  const contentMatch = userRequest.match(/(?:بنویس|write|محتوای|content)\s*[:：]?\s*(.+?)(?:بعد|then|و|and|،|,|$)/i);
  const content = contentMatch?.[1]?.trim() || '';

  // Pattern: create folder + file
  if (/(ساز|بساز|create|make|mkdir)/i.test(lower) && (content || fileName)) {
    console.log('[PLANNER_DIAG] heuristic: create folder + file pattern detected');
    const filePath = `${folderName}/${fileName}`;
    steps.push({
      id: `heuristic-1-${Date.now().toString(36)}`,
      index: 0,
      description: `Create file: ${filePath} (with parent directory)`,
      toolName: 'write_file',
      toolParams: {
        path: filePath,
        content: content || 'hello',
        create_dirs: true,
      },
      requiresPermission: 'write',
      requiresDiffApproval: false,
      status: 'pending',
      retryCount: 0,
    });
    steps.push({
      id: `heuristic-2-${Date.now().toString(36)}`,
      index: 1,
      description: `Read back file to verify: ${filePath}`,
      toolName: 'read_file',
      toolParams: {
        path: filePath,
      },
      requiresPermission: 'read',
      requiresDiffApproval: false,
      status: 'pending',
      retryCount: 0,
    });
  }

  // Pattern: write/create file (no folder)
  else if (/(بساز|ساز|create|write|بنویس)/i.test(lower) && fileName) {
    console.log('[PLANNER_DIAG] heuristic: create file pattern detected');
    steps.push({
      id: `heuristic-1-${Date.now().toString(36)}`,
      index: 0,
      description: `Create file: ${fileName}`,
      toolName: 'write_file',
      toolParams: {
        path: fileName,
        content: content || 'hello',
        create_dirs: true,
      },
      requiresPermission: 'write',
      requiresDiffApproval: false,
      status: 'pending',
      retryCount: 0,
    });
  }

  // Pattern: read file
  else if (/(بخوان|read|محتوا|content)/i.test(lower) && fileName) {
    console.log('[PLANNER_DIAG] heuristic: read file pattern detected');
    steps.push({
      id: `heuristic-1-${Date.now().toString(36)}`,
      index: 0,
      description: `Read file: ${fileName}`,
      toolName: 'read_file',
      toolParams: { path: fileName },
      requiresPermission: 'read',
      requiresDiffApproval: false,
      status: 'pending',
      retryCount: 0,
    });
  }

  // Pattern: list directory
  else if (/(لیست|list|show|نمایش|نشون)/i.test(lower)) {
    console.log('[PLANNER_DIAG] heuristic: list directory pattern detected');
    steps.push({
      id: `heuristic-1-${Date.now().toString(36)}`,
      index: 0,
      description: 'List current directory',
      toolName: 'list_directory',
      toolParams: { path: '.', recursive: false },
      requiresPermission: 'read',
      requiresDiffApproval: false,
      status: 'pending',
      retryCount: 0,
    });
  }

  if (steps.length === 0) {
    // No pattern matched — return empty plan (task will fail with 0 tools)
    console.warn('[PLANNER_DIAG] no heuristic pattern matched — returning empty plan');
    return {
      steps: [],
      reasoning: `Planner failed (${reason}) and no heuristic pattern matched the request.`,
      confidence: 0.1,
      warnings: ['Planner failed; no heuristic fallback available for this request type'],
    };
  }

  console.log('[PLANNER_DIAG] heuristic plan created with', steps.length, 'steps');
  return {
    steps,
    reasoning: `Heuristic fallback (planner failed: ${reason}). Pattern-matched the request to ${steps.length} tool call(s).`,
    confidence: 0.5,
    warnings: ['Planner failed; using heuristic pattern-matched plan'],
  };
}
