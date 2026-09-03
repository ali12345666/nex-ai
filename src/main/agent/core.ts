/**
 * NEX AI — Agent Core
 *
 * The main agent loop. Executes a planned task step-by-step, calling tools,
 * observing results, verifying success, and retrying on failure.
 *
 * Flow per step:
 *   1. Get next pending step from plan
 *   2. If step has a tool:
 *      a. Prepare tool call (validate params)
 *      b. Request permission from PermissionManager
 *      c. Execute tool (with cancellation token)
 *      d. Observe result (extract signals, modified files)
 *      e. Verify result (if step has verification criteria)
 *   3. If step modifies files (write/edit):
 *      a. Compute before/after diff
 *      b. Propose change (DiffManager)
 *      c. Wait for user approval
 *      d. Apply or reject
 *   4. On failure:
 *      a. Classify error
 *      b. Retry (if retries remaining)
 *      c. Or mark task as failed
 *   5. Repeat until plan complete or limit hit
 *
 * The agent uses AIRuntime (NOT LlamaCppRuntime directly), so it works with
 * any future AI runtime (ONNX, MLC, etc.) without modification.
 *
 * The agent is LOCAL-FIRST. It does NOT require any external API.
 */

import * as crypto from 'crypto';
import type { AIRuntime, ChatMessage } from '../ai/runtime';
import type { LocalModelInfo } from '../ai/model-registry';
import {
  executeToolWithPermission,
  listToolDefinitions,
  getToolSchemasForLLM,
} from '../ai/tool-registry';
import {
  requestPermissionAndWait,
  setPermissionRequestHandler,
  type PermissionContext,
} from '../permissions';
import { selectChatModel, selectCodingModel } from './model-selector';
// Phase 8 / P8-B: multi-backend routing (local GGUF vs online provider).
// NOTE: model-router is provider-blind — online details are injected.
import { routeModel, estimateComplexity, type OnlineEnvironment } from './model-router';
// Phase 9 / P9-S4: knowledge retrieval PORT (injected; agent/ never
// imports the knowledge/ subsystem directly — architecture rule)
import type { KnowledgePort, KnowledgeHit } from './knowledge-port';
import { hitsToContextItems } from './knowledge-port';
import { generatePlan } from './planner';
// Phase 8 / P8-E-1: throttled token streaming (pure module, injected emit)
import { createTokenStreamer } from './stream-emit';
import { redactSecrets } from './logger';
import { prepareToolCall } from './tool-selector';
import { verifyToolResult, verifyStepOutcome, verifyTaskCompletion } from './verification';
// Phase 38: ReAct closed-loop — re-planner that feeds observations back to the LLM
import { rePlanAfterObservation, shouldInvokeRePlanner } from './react-loop';
// Phase 14: trust levels + classified retries
import { assessTrust, corroborate, decideRetry, sleep } from './trust-retry';
// Phase 7: LLM Error Recovery — 10-class classifier + 5-action recovery engine
import { classifyError } from './error-classifier';
import {
  decideRecovery,
  type RecoveryAction,
  type RecoveryContext,
  type RecoveryDecision,
} from './recovery-engine';
import { buildContext } from './context-manager';
import { proposeChange, acceptChange, rejectChange, listPendingChanges } from './diff-manager';
import { AgentLogger, emitEvent } from './logger';
import { transitionTaskStatus, recoverInterruptedTask, isTerminalStatus } from './state-machine';
import {
  createCancellationToken,
  DEFAULT_AGENT_LIMITS,
  type AgentTask,
  type AgentStep,
  type AgentEvent,
  type AgentEventListener,
  type AgentLimits,
  type CancellationToken,
  type Observation,
  type ToolCallRecord,
  type AgentError,
  type PermissionGrantRecord,
  type VerificationResult,
  type AgentTaskStatus,
  type ReActDecision,
} from './types';
import * as fs from 'fs';

// ─── Agent Registry ─────────────────────────────────────────────────────────

const _activeTasks = new Map<string, AgentTask>();
const _cancellationTokens = new Map<string, CancellationToken>();
const _eventListeners = new Set<AgentEventListener>();

export function onAgentEvent(listener: AgentEventListener): () => void {
  _eventListeners.add(listener);
  return () => _eventListeners.delete(listener);
}

function emit(event: Omit<AgentEvent, 'timestamp'>): void {
  emitEvent(event);
  // Also fire local listeners (in addition to logger's global ones)
  const fullEvent: AgentEvent = { ...event, timestamp: Date.now() };
  for (const listener of _eventListeners) {
    try { listener(fullEvent); } catch {}
  }
}

// ─── Task Creation ──────────────────────────────────────────────────────────

export interface CreateTaskRequest {
  userRequest: string;
  intent?: string;
  projectPath?: string;
  activeFile?: string;
  recentConversation?: ChatMessage[];
  limits?: Partial<AgentLimits>;
  // Force a specific model (e.g. for testing)
  modelId?: string;
  // Phase 8 / P8-B: backend selection. 'auto' routes by complexity
  // (complex coding → online GLM-class model, simple → local GGUF).
  backend?: 'auto' | 'local' | 'online';
  /** Injected by main.ts wiring from settings+secrets. NEVER imported here. */
  onlineEnvironment?: OnlineEnvironment;
  /** Phase 9 / P9-S4: injected knowledge retrieval port (project RAG). */
  knowledgePort?: KnowledgePort;
  /** Phase 9: how many knowledge chunks to inject (default 3). */
  knowledgeLimit?: number;
  /**
   * Phase 9 / P9-S5: opaque extras merged into every ToolContext.metadata
   * by the composition root (e.g. { knowledgeService }) — keeps agent core
   * ignorant of concrete services (DI at the wiring layer).
   */
  toolContextExtras?: Record<string, unknown>;
  /** Phase 8: Context Propagation — chat conversation ID (for correlation). */
  conversationId?: string;
  /** Phase 8: Context Propagation — UI session ID (for permission scope). */
  sessionId?: string;
  /** Phase 8: Context Propagation — detected language (en/fa/...) for i18n-aware prompts. */
  language?: string;
}

/**
 * Create a new agent task. Does NOT execute it — call runTask() to start.
 */
export async function createTask(request: CreateTaskRequest): Promise<AgentTask> {
  const taskId = crypto.randomUUID();
  const limits = { ...DEFAULT_AGENT_LIMITS, ...request.limits };

  // Pre-load model so we know it's available
  let model: LocalModelInfo | null = null;
  let backend: 'local' | 'online' = 'local';
  let onlineModelName: string | undefined;
  let routingReason: string | undefined; // Phase 8 / P8-E-2: surfaced in task_created event

  if (request.modelId) {
    const { getModel } = await import('../ai/model-registry');
    model = getModel(request.modelId);
    routingReason = `Explicit model: ${model?.name || request.modelId}`;
  } else {
    // Phase 8 / P8-B: route by complexity through the provider-blind router.
    const onlineEnv: OnlineEnvironment = request.onlineEnvironment || { available: false };
    const routing = routeModel(
      {
        intent: request.intent,
        textLength: request.userRequest.length,
      },
      onlineEnv,
      undefined,
      { preference: request.backend === 'auto' || !request.backend ? 'auto' : `${request.backend}-first` }
    );
    backend = routing.backend;
    model = routing.localModel;
    onlineModelName = routing.onlineModel?.name;
    routingReason = routing.reason;
    AgentLogger.info(`Routing decision: ${routing.reason}`, { taskId });
  }

  if (!model && backend === 'local') {
    throw new Error('No local model available. Add a .gguf file in Models panel.');
  }
  if (backend === 'online' && !onlineModelName) {
    throw new Error('Online backend requested but no online provider is configured. Add an API key in Settings > Online AI.');
  }

  const task: AgentTask = {
    id: taskId,
    userRequest: request.userRequest,
    status: 'pending',
    intent: request.intent,
    backend,
    onlineModelName,
    plan: [],
    currentStepIndex: 0,
    context: {
      projectPath: request.projectPath,
      activeFile: request.activeFile,
      relevantFiles: [],
      relevantMemory: [],
      relevantKnowledge: [],
      recentConversation: request.recentConversation || [],
      maxContextTokens: (backend === 'online' ? 32768 : model?.contextSize) || 2048,
      estimatedTokensUsed: 0,
    },
    toolCalls: [],
    observations: [],
    errors: [],
    verification: [],
    permissions: [],
    maxSteps: limits.maxSteps,
    maxToolCalls: limits.maxToolCalls,
    maxRetries: limits.maxRetries,
    maxExecutionTimeMs: limits.maxExecutionTimeMs,
    createdAt: Date.now(),
    cancelled: false,
    // Phase 9 / P9-S5: wiring-layer services for tool contexts (opaque)
    toolContextExtras: request.toolContextExtras,
    // Phase 8: Context Propagation — optional correlation + i18n fields.
    // All additive: undefined if the caller doesn't provide them.
    conversationId: request.conversationId,
    sessionId: request.sessionId,
    language: request.language,
  };

  _activeTasks.set(taskId, task);
  const token = createCancellationToken();
  _cancellationTokens.set(taskId, token);

  // ── Phase 9 / P9-S4: knowledge retrieval (injected port, optional) ──
  // Fills task.context.relevantKnowledge BEFORE planning so the planner's
  // context includes cited, injection-framed document excerpts.
  if (request.knowledgePort?.available?.(request.projectPath)) {
    try {
      const hits: KnowledgeHit[] = await request.knowledgePort.retrieve(
        request.userRequest,
        request.projectPath,
        request.knowledgeLimit ?? 3
      );
      task.context.relevantKnowledge = hitsToContextItems(hits);
      if (hits.length > 0) {
        emit({
          type: 'log',
          taskId,
          message: `Knowledge: ${hits.length} chunks retrieved (${hits.map((h) => h.documentTitle).slice(0, 3).join(', ')})`,
          data: { knowledgeHits: hits.map((h) => ({ doc: h.documentTitle, score: Number(h.score.toFixed(3)), source: h.source, startLine: h.startLine })) },
        });
      }
    } catch (err: any) {
      // Knowledge retrieval is an ENRICHMENT — never fail the task on it.
      AgentLogger.warn(`Knowledge retrieval failed (continuing without): ${err.message}`, { taskId });
    }
  }

  emit({
    type: 'task_created',
    taskId,
    message: `Task created: "${request.userRequest.slice(0, 80)}${request.userRequest.length > 80 ? '...' : ''}"`,
    data: {
      intent: request.intent,
      modelId: model?.id,
      modelName: backend === 'online' ? onlineModelName : model?.name,
      backend,
      // Phase 8 / P8-E-2: routing transparency for the UI badge tooltip
      routingReason,
    },
  });

  return task;
}

/**
 * Get the current state of a task.
 */
export function getTask(taskId: string): AgentTask | null {
  return _activeTasks.get(taskId) || null;
}

/**
 * List all active tasks.
 */
export function listTasks(): AgentTask[] {
  return Array.from(_activeTasks.values());
}

// ─── Task Execution ──────────────────────────────────────────────────────────

/**
 * Run a task to completion. Returns the final task state.
 * Throws if cancelled or if a fatal error occurs.
 */
export async function runTask(taskId: string): Promise<AgentTask> {
  const task = _activeTasks.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  const token = _cancellationTokens.get(taskId);
  if (!token) throw new Error(`No cancellation token for task: ${taskId}`);

  const startTime = Date.now();

  // Phase 111: Global task timeout — prevents agent from running forever
  // if the LLM hangs or tools never complete.
  // Default: 5 minutes (300,000 ms). Can be overridden via task.timeoutMs.
  const TASK_TIMEOUT_MS = task.timeoutMs || 300_000;
  let timeoutFired = false;
  const timeoutTimer = setTimeout(() => {
    if (!timeoutFired && task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled' && !task.cancelled) {
      timeoutFired = true;
      console.warn(`[AGENT] Task ${taskId} timed out after ${TASK_TIMEOUT_MS}ms`);
      cancelTask(taskId, `Global timeout (${TASK_TIMEOUT_MS}ms)`);
    }
  }, TASK_TIMEOUT_MS);
  if (timeoutTimer.unref) timeoutTimer.unref();

  try {
    // ── Phase 1: Planning ──
    token.throwIfCancelled();
    task.status = 'planning';
    emit({
      type: 'planning_started',
      taskId,
      message: `Planning task${task.backend === 'online' ? ` (model: ${task.onlineModelName})` : ''}...`,
    });

    // Phase 8 / P8-B: pick the runtime by task backend — still 100% AIRuntime.
    const runtime = await getRuntime(task.backend);
    let model = await getModelForTask(task);
    if (!model) {
      throw new Error('No model available for task');
    }

    // Ensure the model is loaded into the runtime before planning.
    // For the online backend `model` is a synthetic descriptor (no GGUF).
    //
    // Phase 116 FIX: The Agent was calling runtime.loadModel() with
    // contextSize=4096 even when the model was ALREADY loaded from the
    // chat path. The idempotency check in inference.ts SHOULD reuse the
    // existing model — but if the context was disposed (e.g. by a prior
    // chatStream that errored), the reload would fail with
    // "context size of 256 is too large for the available VRAM"
    // because the old model was still occupying VRAM but the context
    // was gone.
    //
    // FIX: Use the SAME context size as the chat path (4096) and the
    // SAME gpuLayers (-1, auto). This maximizes the chance the
    // idempotency check succeeds (same context size → reuse, no reload).
    // If the model IS disposed, inference.ts will reload it with proper
    // VRAM-aware fallback (auto-fit context + flash attention).
    //
    // CRITICAL: Do NOT set a different contextSize than the chat path.
    // If chat uses 4096 and agent uses 2048, the idempotency check
    // (4096 >= 2048) still passes → reuse. But if agent uses 8192,
    // (4096 >= 8192) fails → reload → VRAM error.
    const agentContextSize = 4096;  // MUST match chat path + preload
    const agentGpuLayers = -1;      // auto (same as chat path + preload)

    console.log('[AGENT_MODEL]', {
      id: model.id,
      name: model.name,
      path: model.path,
      backend: task.backend,
      contextSize: agentContextSize,
      gpuLayers: agentGpuLayers,
      modelContextSize: model.contextSize,
    });

    await runtime.loadModel(model, {
      contextSize: agentContextSize,
      threads: 4,
      gpuLayers: agentGpuLayers,
      temperature: 0.3,  // Low temperature for structured JSON output
      maxTokens: 2048,   // Enough for a detailed plan with multiple steps
    });

    // Log VRAM state after model load for diagnosis
    try {
      const { getGpuBackend, getGpuRuntimeDiagnostics } = await import('../ai/inference');
      const backend = getGpuBackend();
      const diag = getGpuRuntimeDiagnostics();
      console.log('[AGENT_VRAM]', {
        gpuBackend: backend,
        vramBeforeModelLoad: diag?.vramBeforeModelLoad,
        vramAfterModelLoad: diag?.vramAfterModelLoad,
        llamaMemoryUsage: diag?.llamaMemoryUsage,
        supportsGpuOffloading: diag?.supportsGpuOffloading,
        gpuDeviceNames: diag?.gpuDeviceNames,
      });
    } catch { /* non-blocking */ }

    const tools = listToolDefinitions();

    // Phase 8 / P8-E-1: stream planner tokens to the renderer (throttled).
    // Content is model output — logged ASSEMBLED and REDACTED, never raw-key risk.
    const streamer = createTokenStreamer(taskId, undefined, 'planning',
      (payload) => {
        emit({
          type: 'agent_token',
          taskId,
          message: 'token',
          data: payload,
        });
      },
      {
        logAssembled: (redacted) => {
          AgentLogger.plan(`Plan stream (${redacted.length} chars)`, redacted.slice(0, 500), { taskId } as any);
        },
        redact: (s) => redactSecrets(s).redacted,
      }
    );

    // ── Phase 40: Memory Retrieval BEFORE planning ──
    // Retrieve semantically relevant memories so the planner has context
    // about past experiences, user preferences, and project facts.
    let relevantMemories: Array<{ store: string; key: string; content: string; score: number; importance: number }> = [];
    try {
      const { getMemoryRetrievalEngine } = await import('../memory/memory-retrieval-engine');
      const engine = getMemoryRetrievalEngine();
      if (engine) {
        const memResult = await engine.retrieve({
          query: task.userRequest,
          projectId: task.context.projectPath,
          limit: 10,
        });
        relevantMemories = memResult.memories.map((m) => ({
          store: m.store,
          key: m.key,
          content: m.content,
          score: m.score,
          importance: m.importance,
        }));
        if (relevantMemories.length > 0) {
          emit({
            type: 'log',
            taskId,
            message: `Memory retrieval: ${relevantMemories.length} relevant memories found (semantic: ${memResult.usedSemantic}, scanned: ${memResult.totalScanned})`,
            data: { count: relevantMemories.length, usedSemantic: memResult.usedSemantic },
          });
        }
      }
    } catch (memErr: any) {
      AgentLogger.warn(`Memory retrieval failed (non-blocking): ${memErr.message}`, { taskId });
    }

    const plan = await generatePlan(runtime, model, {
      userRequest: task.userRequest,
      intent: task.intent,
      tools,
      recentConversation: task.context.recentConversation,
      projectPath: task.context.projectPath,
      activeFile: task.context.activeFile,
      // Phase 9 / P9-S4: cited knowledge chunks (already injection-framed
      // by the context manager's UNTRUSTED-DATA layer)
      relevantKnowledge: task.context.relevantKnowledge,
      // Phase 40: semantically retrieved memories
      relevantMemories,
      onToken: (chunk) => streamer.push(chunk),
    });
    streamer.end();

    task.plan = plan.steps;
    // Phase 8 / P8-E-2: track token usage for context budget display
    if (plan.usage?.tokensGenerated) {
      task.context.estimatedTokensUsed += plan.usage.tokensGenerated;
    }
    emit({
      type: 'planning_completed',
      taskId,
      message: `Plan generated: ${plan.steps.length} steps (confidence: ${plan.confidence.toFixed(2)})`,
      data: {
        stepCount: plan.steps.length,
        confidence: plan.confidence,
        reasoning: plan.reasoning,
        warnings: plan.warnings,
        // Phase 8 / P8-E-2: usage + backend/model visibility
        usage: plan.usage,
        backend: task.backend,
        model: task.backend === 'online' ? task.onlineModelName : model.name,
      },
    });
    if (plan.warnings.length > 0) {
      AgentLogger.warn(`Plan warnings: ${plan.warnings.join('; ')}`, { taskId });
    }

    // ── Phase 2: Execute each step ──
    while (task.currentStepIndex < task.plan.length) {
      // Cancellation checkpoint 1: before starting each step
      token.throwIfCancelled();
      if (task.cancelled) {
        task.status = 'cancelled';
        task.completedAt = Date.now();
        emit({
          type: 'task_cancelled',
          taskId,
          message: `Task cancelled before step ${task.currentStepIndex + 1}`,
        });
        return task;
      }

      // Check time limit
      if (Date.now() - startTime > task.maxExecutionTimeMs) {
        const error: AgentError = {
          id: `err-${Date.now()}`,
          type: 'timeout',
          message: `Task exceeded max execution time (${task.maxExecutionTimeMs}ms)`,
          timestamp: Date.now(),
        };
        task.errors.push(error);
        task.status = 'failed';
        emit({ type: 'task_failed', taskId, message: error.message, data: { error } });
        break;
      }

      // Check step count limit
      if (task.currentStepIndex >= task.maxSteps) {
        const error: AgentError = {
          id: `err-${Date.now()}`,
          type: 'max_steps',
          message: `Task exceeded max steps (${task.maxSteps})`,
          timestamp: Date.now(),
        };
        task.errors.push(error);
        task.status = 'failed';
        emit({ type: 'task_failed', taskId, message: error.message, data: { error } });
        break;
      }

      // Check tool call limit
      if (task.toolCalls.length >= task.maxToolCalls) {
        const error: AgentError = {
          id: `err-${Date.now()}`,
          type: 'max_tool_calls',
          message: `Task exceeded max tool calls (${task.maxToolCalls})`,
          timestamp: Date.now(),
        };
        task.errors.push(error);
        task.status = 'failed';
        emit({ type: 'task_failed', taskId, message: error.message, data: { error } });
        break;
      }

      const step = task.plan[task.currentStepIndex];
      await executeStep(task, step, token, runtime, model);
      task.currentStepIndex++;
    }

    // ── Phase 3: Finalize ──
    if (task.status !== 'failed' && task.cancelled === false) {
      // Phase 116: Don't mark as "completed" if 0 tool calls were executed.
      // If the user requested an operational task (create file, run command, etc.)
      // but the agent executed 0 tools, that's a FAILURE — not a success.
      // Previously this showed "✅ Task completed. 0 tool call(s)" which was
      // misleading. Now we emit a proper failure with the real reason.
      //
      // CRITICAL: We check task.toolCalls.length === 0 unconditionally —
      // not just when firstStep.toolName exists. The planner's fallback plan
      // creates a step WITHOUT a toolName, so the old check (which required
      // firstStep.toolName) would skip this failure path — letting the task
      // falsely succeed with 0 tools.
      if (task.toolCalls.length === 0) {
        task.status = 'failed';
        task.completedAt = Date.now();
        const errorMsg = 'Agent executed 0 tool calls. The planner may have produced an invalid or empty response. Check [PLANNER_DEBUG] logs for the raw model output.';
        task.errors.push({
          id: `err-${Date.now()}`,
          type: 'invalid_state',
          message: errorMsg,
          timestamp: Date.now(),
        });
        emit({
          type: 'task_failed',
          taskId,
          message: errorMsg,
          data: { error: { message: errorMsg } },
        });
        emit({
          type: 'agent_token',
          taskId,
          message: 'Failure explanation',
          data: {
            content: `❌ Agent could not execute the requested operation.\n\nReason: ${errorMsg}\n\nThe planner may have produced an invalid response. Check the console logs for [PLANNER_DEBUG] entries to see what the model actually returned.`,
            phase: 'failure-explanation',
          },
        });
        return task;
      }

      // ════════════════════════════════════════════════════════════════════════
      // Phase 9: Task Completion Gate (Level 5 verification)
      //
      // Before emitting task_completed, we run verifyTaskCompletion() which
      // checks:
      //   - All steps in terminal state (NOT pending/in_progress)
      //   - No failed steps (hard failures that weren't recovered via SKIP)
      //   - No unresolved errors (errors with recovered=false that are
      //     tool_error/permission_denied/invalid_state/timeout/max_steps/etc.)
      //   - At least one tool call executed (existing Phase 116 check)
      //
      // If the gate fails, we emit task_failed instead of task_completed.
      // This is the LAST line of defense against false-success: even if
      // every step reported success, if any step is still pending or has
      // unresolved errors, the task is NOT complete.
      // ════════════════════════════════════════════════════════════════════════
      const completionGate = verifyTaskCompletion(task);
      if (!completionGate.passed) {
        task.status = 'failed';
        task.completedAt = Date.now();
        const gateError: AgentError = {
          id: `err-gate-${Date.now()}`,
          type: 'invalid_state',
          message: `Task completion gate failed: ${completionGate.reason}`,
          timestamp: Date.now(),
          details: {
            unresolvedSteps: completionGate.unresolvedSteps.map((s) => s.index + 1),
            unresolvedErrors: completionGate.unresolvedErrors.map((e) => e.type),
          },
        };
        task.errors.push(gateError);
        emit({
          type: 'task_failed',
          taskId,
          message: `Task completion gate failed: ${completionGate.reason}`,
          data: {
            error: { message: gateError.message },
            unresolvedSteps: completionGate.unresolvedSteps.length,
            unresolvedErrors: completionGate.unresolvedErrors.length,
          },
        });
        AgentLogger.warn(`Task ${taskId} completion gate FAILED: ${completionGate.reason}`, { taskId });
        return task;
      }

      task.status = 'completed';
      task.completedAt = Date.now();

      // Phase 116: Generate a structured artifact summary so the user (and
      // subsequent turns) can reference the files/folders the agent created.
      // Previously, task_completed only emitted "✅ Task completed." — the
      // actual file paths were in task.observations/toolCalls but NEVER
      // reached the conversation history. So when the user asked "where is
      // it?" in the next turn, the model had no context and said "I don't
      // have access to files."
      //
      // Now we emit a final agent_token with a summary of all files/folders
      // created/modified, including their absolute paths. This becomes the
      // assistant message content — persisted in conversation history and
      // sent to the model in the next turn.
      const artifactSummary = buildArtifactSummary(task);
      if (artifactSummary) {
        emit({
          type: 'agent_token',
          taskId,
          message: 'Final artifact summary',
          data: { content: artifactSummary, phase: 'artifact-summary' },
        });
      }

      emit({
        type: 'task_completed',
        taskId,
        message: `Task completed in ${task.completedAt - task.createdAt}ms (${task.toolCalls.length} tool calls, ${task.observations.length} observations)`,
        data: {
          durationMs: task.completedAt - task.createdAt,
          toolCalls: task.toolCalls.length,
          observations: task.observations.length,
          verifications: task.verification.length,
          // Phase 9: include completion gate confidence in the event
          completionConfidence: completionGate.confidence,
        },
      });

    // ── Phase 13 / P13-A: memory consolidation (WRITE path) ──
    // Distills the finished task into the 5-store memory architecture.
    // Best-effort: failures are logged, never surfaced into the task result.
    try {
      const memory = await import('../memory');
      const { consolidateTaskMemory } = await import('./memory-consolidator');
      const filesTouched = [
        ...new Set(
          task.toolCalls
            .flatMap((tc) => (tc.afterState?.files || []).map((f) => f.path))
        ),
      ];

      // Phase 107: Get the SemanticMemoryStore so memories are embedded
      // (not just stored as JSON). This is the critical fix that activates
      // semantic retrieval — previously .upsert() was never called.
      let semanticStore: any = null;
      try {
        const { getMemoryRetrievalEngine } = await import('../memory/memory-retrieval-engine');
        const engine = getMemoryRetrievalEngine();
        // Access the semantic store from the engine (it was injected at startup)
        semanticStore = (engine as any).semanticStore || null;
      } catch { /* non-blocking */ }

      const consolidation = consolidateTaskMemory(
        {
          taskId: task.id,
          projectId: task.context.projectPath,
          userRequest: task.userRequest,
          intent: task.intent,
          success: true,
          stepsCompleted: task.plan.filter((st) => st.status === 'completed').length,
          toolsUsed: task.toolCalls.map((tc) => tc.toolName),
          filesTouched,
          lessonsLearned: extractLessonsFromTask(task),
          userCorrections: task.errors
            .filter((e) => e.type === 'permission_denied')
            .slice(0, 3)
            .map((e) => `User denied a ${e.type} action${e.stepId ? ` at step ${e.stepId}` : ''}: ${e.message.slice(0, 160)}`),
        },
        {
          set: (store, key, value, o) => memory.setMemory(store as any, key, value, o as any),
          get: (store, key, projectId) => memory.getMemory(store as any, key, projectId) as any,
          list: (store, projectId) => memory.listMemory(store as any, projectId) as any,
        },
        { semanticStore: semanticStore || undefined }
      );
      if (consolidation.written.length > 0 || consolidation.errors.length > 0) {
        AgentLogger.debug(`Memory consolidated: ${consolidation.written.length} written, ${consolidation.skippedDuplicates} dup, ${consolidation.errors.length} err`, { taskId });
      }
    } catch (memErr: any) {
      AgentLogger.warn(`Memory consolidation skipped: ${memErr.message}`, { taskId });
    }
    }

    return task;
  } catch (err: any) {
    if (err.code === 'AGENT_CANCELLED' || task.cancelled) {
      // Phase 111: Ensure single terminal state — don't override if already set
      if (task.status !== 'completed' && task.status !== 'failed') {
        task.status = timeoutFired ? 'failed' : 'cancelled';
        task.completedAt = Date.now();
      }
      emit({
        type: timeoutFired ? 'task_failed' : 'task_cancelled',
        taskId,
        message: timeoutFired
          ? `Task timed out: ${task.cancelReason || 'timeout'}`
          : `Task cancelled: ${task.cancelReason || 'no reason given'}`,
        data: { reason: task.cancelReason, timeout: timeoutFired },
      });
      return task;
    }
    const error: AgentError = {
      id: `err-${Date.now()}`,
      type: 'unknown',
      message: err.message,
      timestamp: Date.now(),
    };
    task.errors.push(error);
    // Phase 111: Ensure single terminal state
    if (task.status !== 'completed' && task.status !== 'cancelled') {
      task.status = 'failed';
      task.completedAt = Date.now();
    }
    emit({
      type: 'task_failed',
      taskId,
      message: `Task failed: ${err.message}`,
      data: { error },
    });
    AgentLogger.error(`Task ${taskId} failed: ${err.message}`, { taskId, data: { stack: err.stack } });
    return task;
  } finally {
    // Phase 111: Clear the timeout timer — no lingering timers
    clearTimeout(timeoutTimer);
    // Clean up the cancellation token (task is done)
    _cancellationTokens.delete(taskId);
    // Phase 115: Schedule auto-eviction of terminal tasks from _activeTasks.
    // Without this, completed/failed tasks (with full beforeState/afterState
    // file-content snapshots in toolCalls[]) accumulate forever → OOM.
    // We delay 5 minutes so the UI has time to fetch the final state.
    // The task's snapshots are NOT affected (they have their own 7-day retention).
    scheduleTaskEviction(taskId, 5 * 60 * 1000);
  }
}

/**
 * Phase 115: Schedule eviction of a terminal task from _activeTasks.
 * Uses an unref'd timer so it doesn't keep the process alive.
 * Only evicts if the task is in a terminal state (safety check).
 */
function scheduleTaskEviction(taskId: string, delayMs: number): void {
  const timer = setTimeout(() => {
    const task = _activeTasks.get(taskId);
    if (task && (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')) {
      _activeTasks.delete(taskId);
      // Note: snapshots are NOT deleted here — they have their own 7-day retention
      // via cleanupOldSnapshots() so Undo still works after the task is evicted.
    }
  }, delayMs);
  // Don't keep the process alive just for this timer
  if (timer.unref) timer.unref();
}

// ─── Step Execution ─────────────────────────────────────────────────────────

async function executeStep(
  task: AgentTask,
  step: AgentStep,
  token: CancellationToken,
  runtime: AIRuntime,
  model: LocalModelInfo
): Promise<void> {
  step.status = 'in_progress';
  step.startedAt = Date.now();
  emit({
    type: 'step_started',
    taskId: task.id,
    stepId: step.id,
    message: `Step ${step.index + 1}: ${step.description}`,
    // Phase 8 / P8-E-3: progress + backend visibility on every step
    data: {
      toolName: step.toolName,
      requiresPermission: step.requiresPermission,
      stepIndex: step.index,
      totalSteps: task.plan.length,
      backend: task.backend,
      model: task.backend === 'online' ? task.onlineModelName : model.name,
    },
  });

  try {
    // Cancellation checkpoint 2: at the start of executeStep
    token.throwIfCancelled();

    // If the step references a tool, execute it
    if (step.toolName) {
      const toolCall = prepareToolCall(step);
      if (!toolCall) {
        throw new Error(`Step references tool "${step.toolName}" but preparation failed`);
      }
      if (toolCall.validationErrors.length > 0) {
        throw new Error(`Tool "${step.toolName}" parameter validation failed: ${toolCall.validationErrors.join('; ')}`);
      }

      // Cancellation checkpoint 3: before permission request
      token.throwIfCancelled();

      // Permission check
      // Phase 8: Use task.sessionId (the UI session) if available, falling
      // back to task.id (self-reference). This lets session-level permission
      // grants (e.g. "Allow for this session") actually scope to the chat
      // session, not the per-task ID (which changes for every new task).
      const permContext: PermissionContext = {
        projectId: task.context.projectPath,
        sessionId: task.sessionId || task.id,
        targetPath: toolCall.params.path || toolCall.params.file || toolCall.params.cwd,
        metadata: toolCall.params,
      };
      const permissionLevel = toolCall.toolDefinition.permission;
      const description = `Tool "${step.toolName}" wants to perform "${permissionLevel}" operation\n\n${toolCall.toolDefinition.description}`;
      const detail = toolCall.toolDefinition.destructive
        ? `⚠️ DESTRUCTIVE OPERATION\n\n${toolCall.toolDefinition.description}\n\nParameters: ${JSON.stringify(toolCall.params, null, 2)}`
        : `${toolCall.toolDefinition.description}\n\nParameters: ${JSON.stringify(toolCall.params, null, 2)}`;

      emit({
        type: 'permission_requested',
        taskId: task.id,
        stepId: step.id,
        message: `Requesting permission for "${step.toolName}" (${permissionLevel})`,
        data: { tool: step.toolName, permission: permissionLevel, params: toolCall.params },
      });

      task.status = 'awaiting_permission';
      const permDecision = await requestPermissionAndWait(
        step.toolName,
        permissionLevel,
        description,
        permContext,
        detail,
      );

      if (permDecision.decision !== 'allow') {
        const error: AgentError = {
          id: `err-${Date.now()}`,
          stepId: step.id,
          type: 'permission_denied',
          message: `Permission denied for "${step.toolName}": ${permDecision.reason || 'user denied'}`,
          timestamp: Date.now(),
        };
        task.errors.push(error);
        step.status = 'failed';
        step.error = error.message;
        emit({
          type: 'permission_denied',
          taskId: task.id,
          stepId: step.id,
          message: `Permission denied for "${step.toolName}"`,
          data: { reason: permDecision.reason },
        });
        // Record the permission grant (or denial) for audit
        const grant: PermissionGrantRecord = {
          id: `grant-${Date.now()}`,
          toolName: step.toolName,
          permission: permissionLevel,
          scope: 'once',
          grantedAt: Date.now(),
          reason: permDecision.reason,
          promptedViaUI: true,
        };
        task.permissions.push(grant);
        return;
      }

      // Permission granted
      const grant: PermissionGrantRecord = {
        id: `grant-${Date.now()}`,
        toolName: step.toolName,
        permission: permissionLevel,
        scope: 'once',
        grantedAt: Date.now(),
        promptedViaUI: true,
      };
      task.permissions.push(grant);
      emit({
        type: 'permission_granted',
        taskId: task.id,
        stepId: step.id,
        message: `Permission granted for "${step.toolName}"`,
      });

      // Snapshot before-state for diff (for write tools)
      let beforeContent: string | undefined;
      const targetPath = toolCall.params.path || toolCall.params.file;
      if (targetPath && fs.existsSync(targetPath)) {
        try {
          beforeContent = fs.readFileSync(targetPath, 'utf-8');
        } catch {}
      }

      // Execute the tool
      // Cancellation checkpoint 4: before tool execution
      token.throwIfCancelled();
      task.status = 'executing';
      emit({
        type: 'tool_call_started',
        taskId: task.id,
        stepId: step.id,
        toolCallId: grant.id,
        message: `Executing tool "${step.toolName}"...`,
        data: { params: toolCall.params },
      });

      const toolCallRecord: ToolCallRecord = {
        id: grant.id,
        stepId: step.id,
        toolName: step.toolName,
        toolDefinition: toolCall.toolDefinition,
        params: toolCall.params,
        permission: permissionLevel,
        permissionStatus: 'granted',
        startedAt: Date.now(),
        retryCount: step.retryCount || 0,
        beforeState: beforeContent !== undefined
          ? { files: [{ path: targetPath || '', content: beforeContent }] }
          : undefined,
      };
      task.toolCalls.push(toolCallRecord);

      // Set up cancellation listener — if cancelled during tool execution,
      // the tool should notice and abort (tools that support cancellation
      // check context.metadata.cancellationToken.cancelled)
      const toolContext = {
        projectPath: task.context.projectPath,
        activeFile: task.context.activeFile,
        runtime,
        permission: permContext,
        metadata: {
          taskId: task.id,
          stepId: step.id,
          // Pass the cancellation token to the tool so it can poll
          cancellationToken: token,
          // Phase 9 / P9-S5: composition-root services (e.g. knowledgeService)
          // merged opaquely — agent core never imports their types.
          ...(task.toolContextExtras || {}),
        },
      };

      const result = await executeToolWithPermission(step.toolName, toolCall.params, toolContext);

      // Cancellation checkpoint 5: after tool execution
      token.throwIfCancelled();

      toolCallRecord.result = result;
      toolCallRecord.completedAt = Date.now();
      toolCallRecord.durationMs = toolCallRecord.completedAt - toolCallRecord.startedAt;
      // Snapshot after-state
      if (targetPath && fs.existsSync(targetPath)) {
        try {
          const afterContent = fs.readFileSync(targetPath, 'utf-8');
          toolCallRecord.afterState = { files: [{ path: targetPath, content: afterContent }] };
        } catch {}
      }

      emit({
        type: 'tool_call_completed',
        taskId: task.id,
        stepId: step.id,
        toolCallId: toolCallRecord.id,
        message: `Tool "${step.toolName}" completed in ${toolCallRecord.durationMs}ms (success: ${result.success})`,
        data: {
          success: result.success,
          durationMs: toolCallRecord.durationMs,
          error: result.error,
          // Phase 115: Expose snapshotId + file label for the Undo UI.
          // Only present for file-modifying tools (write_file, edit_file).
          // The renderer uses this to show an Undo button on the message.
          // Security: only the snapshotId + relativePath are exposed —
          // never the absolute filesystem path.
          snapshotId: result.data?.snapshotId,
          fileLabel: result.data?.relativePath,
          toolName: step.toolName,
        },
      });

      // ── Phase 14 / P14-A: trust-aware verification gate ──
      // Model-generated SUCCESS claims require corroborating structured
      // evidence before the step may count as completed.
      if (result.success) {
        const trust = assessTrust(step.toolName, result);
        if (trust.requiresCorroboration) {
          const { corroborated, evidence } = corroborate(result, trust);
          if (!corroborated) {
            emit({
              type: 'observation',
              taskId: task.id,
              stepId: step.id,
              toolCallId: toolCallRecord.id,
              message: `Unverified claim: "${step.toolName}" reported success without structural evidence`,
              data: { trustLevel: trust.level, needsEvidence: true },
            });
            const verificationEntry = {
              id: `ver-trust-${Date.now()}`,
              stepId: step.id,
              description: `Trust gate for ${step.toolName}`,
              verifiedBy: 'trust-gate' as const,
              status: 'inconclusive' as const,
              details: `${trust.reason}; no corroborating evidence (${evidence.join('; ') || 'none'})`,
              timestamp: Date.now(),
            };
            task.verification.push(verificationEntry as any);
          } else {
            task.verification.push({
              id: `ver-trust-${Date.now()}`,
              stepId: step.id,
              description: `Trust gate for ${step.toolName}`,
              verifiedBy: 'trust-gate' as const,
              status: 'verified' as const,
              details: `Corroborated: ${evidence.join('; ')}`,
              timestamp: Date.now(),
            } as any);
          }
        }
      }

      // Build observation
      const observation: Observation = {
        id: `obs-${Date.now()}`,
        toolCallId: toolCallRecord.id,
        stepId: step.id,
        rawOutput: result.output,
        data: result.data,
        signals: extractSignals(result),
        modifiedFiles: result.modifiedFiles || [],
        timestamp: Date.now(),
      };
      task.observations.push(observation);
      emit({
        type: 'observation',
        taskId: task.id,
        stepId: step.id,
        toolCallId: toolCallRecord.id,
        message: `Observed: ${observation.signals.map((s) => s.message).join('; ') || '(no signals)'}`,
        data: { signals: observation.signals },
      });

      // ── Diff handling ──
      // If this was a write tool and the content changed, propose a diff
      if (step.requiresDiffApproval && targetPath && beforeContent !== undefined && toolCallRecord.afterState) {
        const afterState = toolCallRecord.afterState as any;
        const afterContent = afterState.files?.[0]?.content;
        if (afterContent !== undefined && beforeContent !== afterContent) {
          // Revert the change so the user can review before applying
          // (The tool wrote to disk; we need to undo this for diff-approval flow)
          // For Phase 7 we accept the change but flag it for review.
          // Phase 8 will implement proper revert-then-approve flow.
          const { proposeChange } = await import('./diff-manager');
          const change = proposeChange(task.id, step.id, targetPath, beforeContent, afterContent);
          emit({
            type: 'diff_proposed',
            taskId: task.id,
            stepId: step.id,
            message: `Proposed change to ${targetPath}`,
            data: { changeId: change.id, lineCount: change.diff.split('\n').length },
          });
        }
      }

      // ── Phase 38: VERIFICATION + Phase 9: structural/content/task verification ─
      // Level 1 (Phase 38): if step.verificationCriteria exists, run
      //   verifyToolResult against the tool result (exit code + output patterns).
      // Level 2/3 (Phase 9): if step.expectedOutcome exists, run
      //   verifyStepOutcome to check actual system state (file exists, content
      //   matches, etc.). This catches false-success where the tool reports
      //   success but the expected outcome didn't actually happen.
      let verificationPassed = true;
      const verificationResults: VerificationResult[] = [];

      emit({
        type: 'verification_started',
        taskId: task.id,
        stepId: step.id,
        message: `Verifying step ${step.index + 1}...`,
      });

      // ── Level 1: tool result verification (Phase 38, existing) ──
      if (step.verificationCriteria) {
        const verification = verifyToolResult({
          stepId: step.id,
          description: step.description,
          expectedExitCode: step.verificationCriteria.expectedExitCode,
          expectedOutputContains: step.verificationCriteria.expectedOutputContains,
          expectedOutputRegex: step.verificationCriteria.expectedOutputRegex,
          forbiddenOutputContains: step.verificationCriteria.forbiddenOutputContains,
          toolResult: result,
        });
        verificationResults.push(verification);
        if (verification.status !== 'verified') verificationPassed = false;
      }

      // ── Level 2/3/4: structural + content + execution verification (Phase 9) ──
      // Run when either step.expectedOutcome exists (structural/content) OR
      // always (to catch non-zero exit codes even without explicit criteria).
      // The Level 4 check (non-zero exit code) is always run because it's
      // a strong signal of failure.
      if (step.expectedOutcome || result.data?.exitCode !== undefined) {
        try {
          const outcomeVerification = await verifyStepOutcome(
            step, result, task.context.projectPath,
          );
          verificationResults.push(outcomeVerification);
          if (outcomeVerification.status === 'failed') verificationPassed = false;
          // 'inconclusive' does NOT fail the step (we can't verify — keep going)
        } catch (err: any) {
          // Verification itself crashed — log + mark inconclusive (don't fail step)
          AgentLogger.warn(`verifyStepOutcome crashed: ${err.message} — treating as inconclusive`, {
            taskId: task.id, stepId: step.id,
          });
        }
      }

      // ── Record verification results + emit events ──
      for (const verification of verificationResults) {
        task.verification.push(verification);
      }
      // Emit verification_completed (backward compat — carries status in data)
      const lastVerification = verificationResults[verificationResults.length - 1];
      if (lastVerification) {
        emit({
          type: 'verification_completed',
          taskId: task.id,
          stepId: step.id,
          message: `Verification ${lastVerification.status}: ${lastVerification.details}`,
          data: {
            status: lastVerification.status,
            details: lastVerification.details,
            confidence: lastVerification.confidence,
            level: lastVerification.level,
            evidence: lastVerification.evidence,
          },
        });
        // Phase 9: emit explicit verification_passed / verification_failed events
        if (lastVerification.status === 'verified') {
          emit({
            type: 'verification_passed',
            taskId: task.id,
            stepId: step.id,
            message: `Step ${step.index + 1} verified: ${lastVerification.details}`,
            data: {
              level: lastVerification.level,
              confidence: lastVerification.confidence,
              evidence: lastVerification.evidence,
            },
          });
        } else if (lastVerification.status === 'failed') {
          emit({
            type: 'verification_failed',
            taskId: task.id,
            stepId: step.id,
            message: `Step ${step.index + 1} verification FAILED: ${lastVerification.details}`,
            data: {
              level: lastVerification.level,
              confidence: lastVerification.confidence,
              evidence: lastVerification.evidence,
              recommendedAction: lastVerification.recommendedAction,
            },
          });
        }
      } else if (step.verificationCriteria || step.expectedOutcome) {
        // No verification ran but criteria were set — emit verification_completed
        // with 'inconclusive' to maintain event flow for UI.
        emit({
          type: 'verification_completed',
          taskId: task.id,
          stepId: step.id,
          message: `Verification inconclusive (no verification ran)`,
          data: { status: 'inconclusive' },
        });
      }

      // ── Phase 38: ReAct CLOSED LOOP ─────────────────────────────────────
      // Feed the observation back to the LLM to decide: continue, replan,
      // complete, or abort. This is the SECOND LLM call in the agent loop
      // (the first was the planner). It closes the open-loop gap.
      //
      // Fast path: skip the LLM call when the step succeeded cleanly and
      // isn't the last step (see shouldInvokeRePlanner). This keeps routine
      // successful steps fast (no extra LLM call).
      const isLastStep = task.currentStepIndex >= task.plan.length - 1;
      let reactDecision: ReActDecision = {
        action: 'continue',
        reason: 'Fast path: step succeeded, no concerning signals',
        confidence: 1.0,
      };

      if (shouldInvokeRePlanner(result, step, observation, isLastStep)) {
        // Cancellation checkpoint 6: before ReAct LLM call
        token.throwIfCancelled();

        emit({
          type: 'replan_started',
          taskId: task.id,
          stepId: step.id,
          message: `ReAct: analyzing observation (tool: ${step.toolName}, success: ${result.success})...`,
        });

        // Build the remaining steps (for the re-planner to know what's left).
        const remainingSteps = task.plan
          .slice(task.currentStepIndex + 1)
          .map((s) => ({ description: s.description, toolName: s.toolName }));

        reactDecision = await rePlanAfterObservation(runtime, model, {
          userRequest: task.userRequest,
          intent: task.intent,
          lastStepDescription: step.description,
          lastToolName: step.toolName,
          toolResult: result,
          observation,
          remainingSteps,
          stepsExecuted: task.currentStepIndex + 1,
          maxSteps: task.maxSteps,
          recentObservations: task.observations.slice(-5),
          projectPath: task.context.projectPath,
          tools: listToolDefinitions(),
        });

        // Cancellation checkpoint 7: after ReAct LLM call
        token.throwIfCancelled();

        emit({
          type: 'react_decision',
          taskId: task.id,
          stepId: step.id,
          message: `ReAct: ${reactDecision.action} — ${reactDecision.reason}`,
          data: {
            action: reactDecision.action,
            confidence: reactDecision.confidence,
            newSteps: reactDecision.newSteps?.length || 0,
          },
        });
        emit({
          type: 'replan_completed',
          taskId: task.id,
          stepId: step.id,
          message: `ReAct decision: ${reactDecision.action}`,
        });
      }

      // ── Apply the ReAct decision ────────────────────────────────────────
      if (reactDecision.action === 'abort') {
        // Fail the task immediately with the ReAct reason.
        step.status = 'failed';
        step.error = reactDecision.reason;
        const error: AgentError = {
          id: `err-${Date.now()}`,
          stepId: step.id,
          type: 'tool_error',
          message: `ReAct abort: ${reactDecision.reason}`,
          timestamp: Date.now(),
        };
        task.errors.push(error);
        task.status = 'failed';
        emit({
          type: 'task_failed',
          taskId: task.id,
          message: `Task aborted by ReAct: ${reactDecision.reason}`,
          data: { error },
        });
        return; // exits executeStep — runTask loop sees status='failed'
      }

      if (reactDecision.action === 'complete') {
        // Mark the step completed and signal the runTask loop to finalize.
        step.status = 'completed';
        step.completedAt = Date.now();
        // Mark ALL remaining steps as 'skipped' (the ReAct decided we're done).
        for (let i = task.currentStepIndex + 1; i < task.plan.length; i++) {
          task.plan[i].status = 'skipped';
        }
        // If the LLM gave a final answer, emit it as a token stream.
        if (reactDecision.finalAnswer) {
          emit({
            type: 'agent_token',
            taskId: task.id,
            message: 'ReAct final answer',
            data: { content: reactDecision.finalAnswer, phase: 'react-final' },
          });
        }
        emit({
          type: 'step_completed',
          taskId: task.id,
          stepId: step.id,
          message: `Step ${step.index + 1} completed (ReAct: task complete)`,
          data: { durationMs: step.completedAt - (step.startedAt || 0) },
        });
        return; // exits executeStep — runTask loop sees remaining steps skipped
      }

      if (reactDecision.action === 'replan' && reactDecision.newSteps) {
        // Phase 38: discard remaining steps, append the new ones.
        // Re-index the new steps so they continue from currentStepIndex+1.
        const oldRemaining = task.plan.length - (task.currentStepIndex + 1);
        const newSteps: AgentStep[] = reactDecision.newSteps.map((s, idx) => ({
          id: `react-step-${idx + 1}-${Date.now().toString(36)}`,
          index: task.currentStepIndex + 1 + idx,
          description: s.description,
          toolName: s.tool,
          toolParams: s.params || {},
          requiresPermission: s.requiresPermission,
          requiresDiffApproval: s.tool === 'write_file' || s.tool === 'edit_file',
          verificationCriteria: s.verificationCriteria,
          status: 'pending',
          retryCount: 0,
          injectedByReAct: true,
        }));
        // Replace remaining steps with the new ones.
        task.plan = [
          ...task.plan.slice(0, task.currentStepIndex + 1),
          ...newSteps,
        ];
        AgentLogger.info(
          `ReAct replan: discarded ${oldRemaining} remaining steps, ` +
          `appended ${newSteps.length} new steps (injectedByReAct=true)`,
          { taskId: task.id, stepId: step.id },
        );
        emit({
          type: 'replan_completed',
          taskId: task.id,
          stepId: step.id,
          message: `ReAct replan: ${newSteps.length} new steps replace ${oldRemaining} old`,
          data: { newStepCount: newSteps.length, discardedCount: oldRemaining },
        });
      }

      // ── Step completion / failure ──────────────────────────────────────
      // (applies to 'continue' and 'replan' decisions — 'complete' and
      // 'abort' already returned above)
      if (result.success && verificationPassed) {
        step.status = 'completed';
        step.completedAt = Date.now();
        emit({
          type: 'step_completed',
          taskId: task.id,
          stepId: step.id,
          message: `Step ${step.index + 1} completed`,
          data: { durationMs: step.completedAt - (step.startedAt || 0) },
        });
      } else if (!result.success) {
        // Tool failed — handle retry or fail the step.
        // (Only retry if ReAct didn't already replan — if it replanned,
        // the failure was expected and new steps are already in place.)
        if (reactDecision.action === 'replan') {
          // The re-planner already emitted corrective steps. Mark this step
          // as completed (it "completed" in the sense that we observed it
          // and decided to replan, not that the tool succeeded).
          step.status = 'completed';
          step.completedAt = Date.now();
          emit({
            type: 'step_completed',
            taskId: task.id,
            stepId: step.id,
            message: `Step ${step.index + 1} completed (tool failed, ReAct replanned)`,
            data: { durationMs: step.completedAt - (step.startedAt || 0) },
          });
        } else {
          await handleStepFailure(task, step, result.error || 'Tool reported failure', token, runtime, model);
        }
      } else if (!verificationPassed) {
        // ── Phase 9: Tool succeeded BUT verification failed ──────────────
        // This is the "false success" path: the tool ran fine, but the
        // expected outcome didn't actually happen (file doesn't exist,
        // content doesn't match, exit code wrong, etc.).
        //
        // Phase 9 FIX: we now route this through handleStepFailure (Phase 7
        // recovery) with errorCode='VERIFICATION_FAILED'. The Phase 7
        // recovery engine maps this to the 'verification_failed' error class
        // and decides RETRY (once) → REPLAN → SKIP/ABORT. This replaces the
        // old behavior of just marking the step failed (which bypassed
        // recovery — a false-success could never recover).
        //
        // Build the verification failure message from the last verification
        // result (so the recovery engine sees WHY verification failed).
        const lastVer = verificationResults[verificationResults.length - 1];
        const verErrorMessage = `Verification failed: ${lastVer?.details || 'expected outcome not observed'}`;
        if (reactDecision.action === 'replan') {
          // The re-planner already decided to replan — let it proceed.
          step.status = 'completed';
          step.completedAt = Date.now();
          emit({
            type: 'step_completed',
            taskId: task.id,
            stepId: step.id,
            message: `Step ${step.index + 1} completed (verification failed, ReAct replanned)`,
            data: { durationMs: step.completedAt - (step.startedAt || 0) },
          });
        } else {
          // Route to Phase 7 recovery with verification_failed error code.
          await handleStepFailure(task, step, verErrorMessage, token, runtime, model);
        }
      }
    } else {
      // Non-tool step (reasoning / observation / verification step)
      // For Phase 7: just mark as completed
      step.status = 'completed';
      step.completedAt = Date.now();
      emit({
        type: 'step_completed',
        taskId: task.id,
        stepId: step.id,
        message: `Step ${step.index + 1} (non-tool) completed`,
      });
    }
  } catch (err: any) {
    if (err.code === 'AGENT_CANCELLED') {
      throw err; // re-throw
    }
    step.status = 'failed';
    step.error = err.message;
    const error: AgentError = {
      id: `err-${Date.now()}`,
      stepId: step.id,
      type: 'tool_error',
      message: err.message,
      timestamp: Date.now(),
    };
    task.errors.push(error);
    emit({
      type: 'step_failed',
      taskId: task.id,
      stepId: step.id,
      message: `Step ${step.index + 1} failed: ${err.message}`,
      data: { error },
    });
  }
}

async function handleStepFailure(
  task: AgentTask,
  step: AgentStep,
  errorMessage: string,
  token: CancellationToken,
  runtime: AIRuntime,
  model: LocalModelInfo
): Promise<void> {
  const retryCount = step.retryCount || 0;

  // ════════════════════════════════════════════════════════════════════════
  // Phase 7: LLM Error Recovery
  //
  // Replaces the Phase-14 decideRetry() with a 5-action recovery engine:
  //   RETRY / MODIFY_AND_RETRY / REPLAN / SKIP / ABORT
  //
  // The engine is heuristic-first (offline-capable) and uses the LLM only
  // as a fallback for ambiguous errors. Cancellation/permission/security
  // errors are NEVER auto-retried (Phase 7 §8).
  //
  // The old decideRetry() is preserved for backward-compat (other callers),
  // but this is the only caller that mattered.
  // ════════════════════════════════════════════════════════════════════════

  // Emit recovery_started — UI shows THINKING (Orb → 'thinking' condition)
  emit({
    type: 'recovery_started',
    taskId: task.id,
    stepId: step.id,
    message: `Analyzing failure: ${errorMessage.slice(0, 100)}`,
    data: { attempt: retryCount, maxRetries: task.maxRetries, errorMessage },
  });

  // Build the recovery context (Phase 7 §5 — context propagation, redacted)
  const lastObservation = task.observations.length > 0
    ? task.observations[task.observations.length - 1]
    : undefined;

  const recoveryCtx: RecoveryContext = {
    taskId: task.id,
    step,
    task,
    toolName: step.toolName,
    errorMessage,
    // Phase 9: detect verification failures via the "Verification failed:" prefix
    // (set by the !verificationPassed path in executeStep). This lets the
    // Phase 7 classifier map them to 'verification_failed' error class with
    // the right recovery policy (RETRY once → REPLAN → SKIP/ABORT).
    errorCode: task.cancelled
      ? 'AGENT_CANCELLED'
      : errorMessage.startsWith('Verification failed:')
        ? 'VERIFICATION_FAILED'
        : 'TOOL_FAILURE',
    attempt: retryCount,
    maxRetries: task.maxRetries,
    lastObservation,
    cancelled: task.cancelled,
    cancelReason: task.cancelReason,
  };

  // Decide the recovery action (heuristic first, LLM fallback for ambiguous)
  let decision: RecoveryDecision;
  try {
    decision = await decideRecovery({
      context: recoveryCtx,
      runtime,
      model,
    });
  } catch (err: any) {
    // If the recovery engine itself crashes, fall back to ABORT (safe default).
    AgentLogger.error(`Recovery engine crashed: ${err.message} — aborting step`, {
      taskId: task.id, stepId: step.id,
    });
    decision = {
      action: 'ABORT',
      reason: `Recovery engine failure: ${err.message}`,
      errorClass: 'unknown',
      backoffMs: 0,
      llmAnalyzed: false,
      confidence: 0.0,
      ambiguous: false,
    };
  }

  // Emit recovery_decision — UI shows the chosen action + reason
  emit({
    type: 'recovery_decision',
    taskId: task.id,
    stepId: step.id,
    message: `Recovery: ${decision.action} — ${decision.reason.slice(0, 80)}`,
    data: {
      action: decision.action,
      reason: decision.reason,
      errorClass: decision.errorClass,
      backoffMs: decision.backoffMs,
      llmAnalyzed: decision.llmAnalyzed,
      confidence: decision.confidence,
      ambiguous: decision.ambiguous,
    },
  });

  AgentLogger.warn(
    `Recovery decision for step ${step.index + 1}: ${decision.action} (${decision.errorClass}) — ${decision.reason}`,
    { taskId: task.id, stepId: step.id, data: decision },
  );

  // ── Execute the recovery action ──────────────────────────────────────
  switch (decision.action) {
    case 'RETRY': {
      step.retryCount = retryCount + 1;
      (step as { status: string }).status = 'pending';
      emit({
        type: 'retry',
        taskId: task.id,
        stepId: step.id,
        message: `Retrying step ${step.index + 1}: ${decision.reason}`,
        data: {
          retryCount: step.retryCount,
          maxRetries: task.maxRetries,
          errorClass: decision.errorClass,
          backoffMs: decision.backoffMs,
          llmAnalyzed: decision.llmAnalyzed,
        },
      });
      await sleep(decision.backoffMs);
      await executeStep(task, step, token, runtime, model);
      // If the step succeeded after retry, emit recovery_succeeded
      if (step.status === 'completed') {
        emit({
          type: 'recovery_succeeded',
          taskId: task.id,
          stepId: step.id,
          message: `Recovery succeeded after retry ${step.retryCount}`,
          data: { action: 'RETRY', attempts: step.retryCount },
        });
        recordRecoveryMemory(task, step, decision, true);
      }
      break;
    }

    case 'MODIFY_AND_RETRY': {
      step.retryCount = retryCount + 1;
      (step as { status: string }).status = 'pending';
      // Phase 8: Snapshot the ORIGINAL tool params before modification.
      // This preserves auditability — we can later see what the recovery
      // engine changed. Uses snapshotToolParams (shallow clone — sufficient
      // for flat key-value params).
      if (decision.modifiedParams && !task.originalToolParams) {
        try {
          const { snapshotToolParams } = await import('./context-contract');
          task.originalToolParams = snapshotToolParams(step);
        } catch { /* best-effort — audit field, not critical */ }
      }
      // Apply the modified tool params (from heuristic or LLM)
      if (decision.modifiedParams) {
        step.toolParams = { ...step.toolParams, ...decision.modifiedParams };
      }
      emit({
        type: 'modify_retry_started',
        taskId: task.id,
        stepId: step.id,
        message: `Modifying arguments and retrying: ${decision.reason.slice(0, 80)}`,
        data: {
          modifiedParams: decision.modifiedParams,
          // Phase 8: include the original (pre-modification) params for audit
          originalParams: task.originalToolParams,
          retryCount: step.retryCount,
          llmAnalyzed: decision.llmAnalyzed,
        },
      });
      await sleep(decision.backoffMs);
      await executeStep(task, step, token, runtime, model);
      if (step.status === 'completed') {
        emit({
          type: 'recovery_succeeded',
          taskId: task.id,
          stepId: step.id,
          message: `Recovery succeeded after MODIFY_AND_RETRY`,
          data: { action: 'MODIFY_AND_RETRY', attempts: step.retryCount },
        });
        recordRecoveryMemory(task, step, decision, true);
      }
      break;
    }

    case 'REPLAN': {
      // Phase 38: delegate to rePlanAfterObservation for the actual replan.
      // We mark this step as 'completed' (in the sense that we observed it
      // and decided to replan) so the runTask loop continues.
      step.status = 'completed';
      step.completedAt = Date.now();
      emit({
        type: 'replan_started',
        taskId: task.id,
        stepId: step.id,
        message: `Replanning after failure: ${decision.reason.slice(0, 80)}`,
        data: { errorClass: decision.errorClass, llmAnalyzed: decision.llmAnalyzed },
      });
      // The actual replan happens in executeStep's ReAct loop (which calls
      // rePlanAfterObservation). For a REPLAN triggered by handleStepFailure
      // (step already failed), we set the step status so the runTask loop
      // continues and the ReAct loop picks up the failure on the next step.
      // Note: replan via ReAct is already handled in executeStep; here we
      // just allow the loop to proceed.
      recordRecoveryMemory(task, step, decision, false);
      break;
    }

    case 'SKIP': {
      step.status = 'skipped';
      step.error = `Skipped after ${decision.errorClass}: ${errorMessage.slice(0, 100)}`;
      emit({
        type: 'skip_executed',
        taskId: task.id,
        stepId: step.id,
        message: `Skipping step ${step.index + 1}: ${decision.reason.slice(0, 80)}`,
        data: { errorClass: decision.errorClass, llmAnalyzed: decision.llmAnalyzed },
      });
      // SKIP doesn't fail the task — the runTask loop continues to next step
      recordRecoveryMemory(task, step, decision, false);
      break;
    }

    case 'ABORT': {
      step.status = 'failed';
      step.error = `Aborted after ${decision.errorClass}: ${errorMessage}`;
      const error: AgentError = {
        id: `err-${Date.now()}`,
        stepId: step.id,
        type: mapErrorClassToAgentErrorType(decision.errorClass),
        message: errorMessage,
        details: { recoveryDecision: 'ABORT', reason: decision.reason },
        timestamp: Date.now(),
        recovered: false,
        errorClass: decision.errorClass,
        recoveryDecision: 'ABORT',
        recoveryAttempts: retryCount,
        llmAnalyzed: decision.llmAnalyzed,
      };
      task.errors.push(error);
      emit({
        type: 'recovery_failed',
        taskId: task.id,
        stepId: step.id,
        message: `Recovery failed — task will abort: ${decision.reason.slice(0, 80)}`,
        data: { errorClass: decision.errorClass, attempts: retryCount, llmAnalyzed: decision.llmAnalyzed },
      });
      emit({
        type: 'step_failed',
        taskId: task.id,
        stepId: step.id,
        message: `Step ${step.index + 1} failed: ${decision.reason.slice(0, 100)}`,
        data: { errorClass: decision.errorClass, recoveryDecision: 'ABORT' },
      });
      recordRecoveryMemory(task, step, decision, false);
      break;
    }
  }
}

/**
 * Phase 7 §12: Record only important recoveries to memory.
 * Skip transient/noisy retries. Record: SKIP, ABORT, REPLAN, LLM-analyzed, MODIFY_AND_RETRY.
 */
function recordRecoveryMemory(
  task: AgentTask,
  step: AgentStep,
  decision: RecoveryDecision,
  succeeded: boolean,
): void {
  // Don't record routine transient RETRY decisions (noisy)
  if (decision.action === 'RETRY' && decision.errorClass === 'transient_network' && !decision.llmAnalyzed) {
    return;
  }
  // Don't record successful simple retries of unknown errors (noisy)
  if (decision.action === 'RETRY' && decision.errorClass === 'unknown' && succeeded && !decision.llmAnalyzed) {
    return;
  }
  // Phase 9: don't record successful verification-failed retries that succeeded
  // (the verification failure was transient — not worth remembering). We DO
  // record verification-failed REPLAN/ABORT decisions (the expected outcome
  // was genuinely wrong — worth remembering for future planning).
  if (decision.action === 'RETRY' && decision.errorClass === 'verification_failed' && succeeded && !decision.llmAnalyzed) {
    return;
  }

  try {
    const { TaskMemory } = require('../memory');
    TaskMemory.set(`recovery-${task.id}-${step.id}`, {
      taskId: task.id,
      stepId: step.id,
      stepDescription: step.description,
      action: decision.action,
      errorClass: decision.errorClass,
      reason: decision.reason,
      llmAnalyzed: decision.llmAnalyzed,
      confidence: decision.confidence,
      succeeded,
      attempts: step.retryCount || 0,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    // Memory recording is best-effort — don't fail the recovery
    AgentLogger.warn(`Failed to record recovery memory: ${err.message}`);
  }
}

/**
 * Map a 10-class error class to the legacy AgentError.type (for backward-compat).
 */
function mapErrorClassToAgentErrorType(
  errorClass: RecoveryDecision['errorClass'],
): AgentError['type'] {
  switch (errorClass) {
    case 'permission_denied': return 'permission_denied';
    case 'timeout': return 'timeout';
    case 'user_cancellation': return 'cancelled';
    case 'model_inference': return 'llm_error';
    case 'verification_failed':
    // Phase 9: verification failure maps to 'tool_error' (the tool didn't
    // achieve the expected outcome). We keep the detailed class in
    // AgentError.errorClass for recovery analysis.
    case 'security_policy':
    case 'invalid_arguments':
    case 'file_path':
    case 'tool_failure':
    case 'transient_network':
    case 'unknown':
    default:
      return 'tool_error';
  }
}

function extractSignals(result: any): Array<{ type: 'success' | 'error' | 'warning' | 'info' | 'needs-attention'; message: string; details?: any }> {
  const signals: Array<{ type: 'success' | 'error' | 'warning' | 'info' | 'needs-attention'; message: string; details?: any }> = [];
  if (result.success) {
    signals.push({ type: 'success', message: 'Tool succeeded' });
  } else {
    signals.push({ type: 'error', message: `Tool failed: ${result.error || '(no error message)'}` });
  }
  if (result.data?.exitCode !== undefined && result.data.exitCode !== 0) {
    signals.push({
      type: 'needs-attention',
      message: `Process exited with code ${result.data.exitCode}`,
    });
  }
  if (result.data?.stderr && result.data.stderr.length > 0) {
    // Look for common error patterns
    const stderr = result.data.stderr;
    if (/error TS\d+/i.test(stderr)) {
      signals.push({ type: 'error', message: 'TypeScript compilation error detected' });
    }
    if (/error/i.test(stderr) && !stderr.includes('0 errors')) {
      signals.push({ type: 'warning', message: 'stderr contains error messages' });
    }
  }
  if (result.data?.diff && result.data.diff.length > 0) {
    signals.push({ type: 'info', message: 'File modifications detected' });
  }
  return signals;
}

// ─── Cancellation ─────────────────────────────────────────────────────────────

export function cancelTask(taskId: string, reason?: string): boolean {
  const token = _cancellationTokens.get(taskId);
  if (!token) return false;
  const task = _activeTasks.get(taskId);
  if (task) {
    task.cancelled = true;
    task.cancelReason = reason || 'cancelled by user';
  }
  return token.cancel(reason);
}

/**
 * Phase 115: Cancel all active (non-terminal) agent tasks.
 * Called during app shutdown to prevent orphaned in-flight tool calls
 * and pending permission prompts from hanging the process.
 *
 * Returns the number of tasks that were cancelled.
 */
export function cancelAllActiveTasks(reason?: string): number {
  const r = reason || 'Application shutting down';
  let count = 0;
  for (const [taskId, task] of _activeTasks) {
    // Only cancel non-terminal tasks
    if (task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled') {
      if (cancelTask(taskId, r)) {
        count++;
      }
    }
  }
  if (count > 0) {
    console.log(`[AGENT] Cancelled ${count} active task(s) on shutdown`);
  }
  return count;
}

// ─── Diff Approval ───────────────────────────────────────────────────────────

export async function acceptDiff(taskId: string, changeId: string): Promise<void> {
  const { acceptChange } = await import('./diff-manager');
  await acceptChange(changeId);
  emit({
    type: 'diff_accepted',
    taskId,
    message: `Change ${changeId} accepted`,
    data: { changeId },
  });
}

export function rejectDiff(taskId: string, changeId: string, reason?: string): void {
  rejectChange(changeId, reason);
  emit({
    type: 'diff_rejected',
    taskId,
    message: `Change ${changeId} rejected: ${reason || '(no reason given)'}`,
    data: { changeId, reason },
  });
}

export async function acceptAllDiffs(taskId: string): Promise<void> {
  const { acceptAllChanges } = await import('./diff-manager');
  await acceptAllChanges(taskId);
  emit({
    type: 'diff_accepted',
    taskId,
    message: `All changes accepted`,
  });
}

export function rejectAllDiffs(taskId: string, reason?: string): void {
  const { rejectAllChanges } = require('./diff-manager');
  rejectAllChanges(taskId, reason);
  emit({
    type: 'diff_rejected',
    taskId,
    message: `All changes rejected: ${reason || '(no reason given)'}`,
  });
}

export function listPendingDiffs(taskId: string): any[] {
  return listPendingChanges(taskId).filter((c) => c.status === 'pending');
}

// ─── Phase 12 / P12-B: read-only agent state for the System Monitor ────────

export interface AgentMonitorState {
  currentTask?: string;
  currentStep?: string;
  stepProgress?: { current: number; total: number };
  activeTool?: string;
  toolDurationMs?: number;
  queueState: 'idle' | 'running' | 'waiting-permission' | 'queued' | 'unknown';
  cancelled: boolean;
  inferenceActive?: boolean;
  contextUsedTokens?: number;
  contextMaxTokens?: number;
  backend?: 'local' | 'online' | 'none';
}

/** Derived monitor view over _activeTasks — no mutation, no events. */
export function getAgentMonitorState(): AgentMonitorState {
  const tasks = [..._activeTasks.values()];
  const active =
    tasks.find((t) => ['running', 'planning', 'executing', 'awaiting_permission'].includes(t.status)) ||
    tasks.find((t) => t.status === 'pending'); // queued work still visible
  if (!active) {
    return { queueState: 'idle', cancelled: false };
  }
  if (active.status === 'pending') {
    // queued: rich preview without pretending it's executing
    return {
      currentTask: active.userRequest.slice(0, 120),
      queueState: 'queued',
      cancelled: active.cancelled,
      contextMaxTokens: active.context.maxContextTokens || undefined,
      backend: active.backend || 'local',
    };
  }
  const step = active.plan[active.currentStepIndex];
  const lastTool = active.toolCalls[active.toolCalls.length - 1];
  const toolRunning = lastTool && lastTool.completedAt === undefined;
  return {
    currentTask: active.userRequest.slice(0, 120),
    currentStep: step ? `step ${active.currentStepIndex + 1}: ${step.description}`.slice(0, 140) : undefined,
    stepProgress: active.plan.length > 0 ? { current: active.currentStepIndex + 1, total: active.plan.length } : undefined,
    activeTool: toolRunning ? lastTool!.toolName : undefined,
    toolDurationMs: toolRunning && lastTool!.startedAt ? Date.now() - lastTool!.startedAt : lastTool?.durationMs,
    queueState: active.status === 'awaiting_permission' ? 'waiting-permission' : 'running',
    cancelled: active.cancelled,
    inferenceActive: active.status === 'planning',
    contextUsedTokens: active.context.estimatedTokensUsed || undefined,
    contextMaxTokens: active.context.maxContextTokens || undefined,
    backend: active.backend || 'local',
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Phase 8 / P8-B: backend-aware runtime resolution.
 * 'local'  → the default llama.cpp runtime (unchanged Phase 7 behavior).
 * 'online' → the registered OnlineRuntime (provider abstraction → GLM 5.3).
 *            Config/secrets are resolved lazily inside the runtime transport.
 */
async function getRuntime(backend: 'local' | 'online' = 'local'): Promise<AIRuntime> {
  if (backend !== 'online') {
    const { getDefaultRuntime } = await import('../ai/runtime');
    return getDefaultRuntime();
  }
  const { getRuntime: getFromRegistry } = await import('../ai/runtime');
  return getFromRegistry('online', 'agent-shared');
}

async function getModelForTask(task: AgentTask): Promise<LocalModelInfo | null> {
  // Phase 8 / P8-B: online backend gets a synthetic model descriptor —
  // no GGUF file, no registry entry; the runtime ignores the path.
  if (task.backend === 'online') {
    const name = task.onlineModelName || 'Online Model';
    return {
      id: `online:${name}`,
      name,
      path: '',
      sizeBytes: 0,
      contextSize: 32768,
      gpuLayers: 0,
      category: 'coding',
      fileExists: true,
      addedAt: Date.now(),
    } as LocalModelInfo;
  }
  const { listModels, getModel: getModelById } = await import('../ai/model-registry');
  const models = listModels().filter((m) => m.fileExists);
  if (models.length === 0) return null;
  const sorted = [...models].sort((a, b) => {
    const aT = a.lastUsedAt || a.addedAt;
    const bT = b.lastUsedAt || b.addedAt;
    return bT - aT;
  });
  return sorted[0];
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Phase 40: Extract lessons from a completed task.
 *
 * Looks for patterns in the task's observations, errors, and tool calls
 * that represent valuable learning:
 *   - Errors that were eventually fixed (error → retry → success)
 *   - File modifications (what was changed)
 *   - Tool sequences that worked (read → edit → test → pass)
 *   - Failed approaches (what NOT to do)
 *
 * Returns short, actionable lessons suitable for ProjectMemory storage.
 */
function extractLessonsFromTask(task: AgentTask): string[] {
  const lessons: string[] = [];

  // Lesson 1: If the task had errors but eventually completed, the error→fix
  // pattern is a lesson.
  const failedSteps = task.plan.filter((s) => s.status === 'failed' || (s.retryCount && s.retryCount > 0));
  const completedSteps = task.plan.filter((s) => s.status === 'completed');
  if (failedSteps.length > 0 && completedSteps.length > 0) {
    for (const step of failedSteps.slice(0, 2)) {
      if (step.error) {
        lessons.push(`Encountered error at "${step.description}": ${step.error.slice(0, 120)} — resolved by retry/replan`);
      }
    }
  }

  // Lesson 2: If files were modified, record what was changed.
  const modifiedFiles = [
    ...new Set(
      task.toolCalls
        .filter((tc) => tc.afterState?.files)
        .flatMap((tc) => tc.afterState!.files.map((f) => f.path))
    ),
  ];
  if (modifiedFiles.length > 0 && modifiedFiles.length <= 5) {
    lessons.push(`Modified files: ${modifiedFiles.join(', ')}`);
  }

  // Lesson 3: If the task involved testing and the test passed, record it.
  const testCalls = task.toolCalls.filter((tc) =>
    tc.toolName === 'npm_test' || tc.toolName === 'run_command' && tc.params?.command?.includes('test')
  );
  for (const tc of testCalls.slice(0, 1)) {
    if (tc.result?.success) {
      lessons.push(`Tests passed after changes — approach validated`);
    }
  }

  // Lesson 4: If the task was cancelled or failed, record the failure mode.
  if (task.status === 'failed' && task.errors.length > 0) {
    const lastError = task.errors[task.errors.length - 1];
    lessons.push(`Task failed: ${lastError.type} — ${lastError.message.slice(0, 120)}`);
  }

  return lessons.slice(0, 4); // cap at 4 lessons
}

/**
 * Remove a completed task from the registry. Logs are kept.
 */
export function deleteTask(taskId: string): void {
  _activeTasks.delete(taskId);
  _cancellationTokens.delete(taskId);
  // Don't delete logs — they're audit records
}

/**
 * Phase 116: Build a structured artifact summary from the task's tool calls.
 *
 * This summary is emitted as the final agent_token (becoming the assistant
 * message content) so that:
 *   1. The user sees which files/folders were created/modified + their paths
 *   2. The conversation history includes the paths — so in the next turn,
 *      when the user asks "where is it?", the model has the real paths
 *      in context and can answer accurately
 *
 * Extracts: created files, created folders, modified files, executed commands
 * from task.toolCalls (which contains result.data with path/relativePath).
 */
function buildArtifactSummary(task: AgentTask): string | null {
  const createdFiles: string[] = [];
  const createdFolders: string[] = [];
  const modifiedFiles: string[] = [];
  const commands: string[] = [];

  for (const tc of task.toolCalls) {
    if (!tc.result?.success) continue;
    const data = tc.result?.data;
    if (!data) continue;

    const toolName = tc.toolName;

    if (toolName === 'write_file') {
      const p = data.path || data.relativePath;
      if (p) {
        if (data.created) {
          createdFiles.push(p);
        } else if (data.overwritten) {
          modifiedFiles.push(p);
        }
      }
    } else if (toolName === 'edit_file') {
      const p = data.path || data.relativePath;
      if (p) modifiedFiles.push(p);
    } else if (toolName === 'list_directory' || toolName === 'project_structure') {
      // These are read-only — no artifact
    } else if (toolName === 'run_command' || toolName === 'npm_build' || toolName === 'npm_test') {
      const cmd = data.command || tc.params?.command || toolName;
      const exitCode = data.exitCode;
      commands.push(`${cmd}${exitCode !== undefined ? ` (exit ${exitCode})` : ''}`);
    }

    // mkdir / create directory — check if the tool created a folder
    if (data.createdDir || data.directory) {
      const d = data.directory || data.createdDir;
      if (d) createdFolders.push(d);
    }
  }

  // Also scan observations for modifiedFiles (write_file/edit_file populate this)
  for (const obs of task.observations) {
    for (const mf of obs.modifiedFiles || []) {
      if (mf.path && !modifiedFiles.includes(mf.path) && !createdFiles.includes(mf.path)) {
        modifiedFiles.push(mf.path);
      }
    }
  }

  // Build the summary text
  const lines: string[] = [];

  if (createdFiles.length > 0 || createdFolders.length > 0 || modifiedFiles.length > 0) {
    lines.push('✅ کار انجام شد. موارد ایجاد/تغییر شده:');
    if (createdFolders.length > 0) {
      lines.push('');
      lines.push('📁 پوشه‌های ساخته شده:');
      for (const f of createdFolders) lines.push(`  • ${f}`);
    }
    if (createdFiles.length > 0) {
      lines.push('');
      lines.push('📄 فایل‌های ساخته شده:');
      for (const f of createdFiles) lines.push(`  • ${f}`);
    }
    if (modifiedFiles.length > 0) {
      lines.push('');
      lines.push('✏️ فایل‌های تغییر یافته:');
      for (const f of modifiedFiles) lines.push(`  • ${f}`);
    }
  }

  if (commands.length > 0) {
    if (lines.length === 0) lines.push('✅ کار انجام شد.');
    lines.push('');
    lines.push('🔧 دستورات اجرا شده:');
    for (const c of commands) lines.push(`  • ${c}`);
  }

  if (lines.length === 0) {
    // No artifacts — return a simple summary so the model knows what happened
    return `✅ Task completed. ${task.toolCalls.length} tool call(s) executed, ${task.observations.length} observation(s) recorded.`;
  }

  return lines.join('\n');
}
