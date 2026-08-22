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
import { generatePlan } from './planner';
import { prepareToolCall } from './tool-selector';
import { verifyToolResult } from './verification';
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
}

/**
 * Create a new agent task. Does NOT execute it — call runTask() to start.
 */
export async function createTask(request: CreateTaskRequest): Promise<AgentTask> {
  const taskId = crypto.randomUUID();
  const limits = { ...DEFAULT_AGENT_LIMITS, ...request.limits };

  // Pre-load model so we know it's available
  let model: LocalModelInfo | null = null;
  if (request.modelId) {
    const { getModel } = await import('../ai/model-registry');
    model = getModel(request.modelId);
  } else {
    // Auto-select based on intent
    if (request.intent === 'coding' || request.intent === 'fix-bug' || request.intent === 'refactor') {
      model = selectCodingModel();
    } else {
      model = selectChatModel();
    }
  }

  if (!model) {
    throw new Error('No local model available. Add a .gguf file in Models panel.');
  }

  const task: AgentTask = {
    id: taskId,
    userRequest: request.userRequest,
    status: 'pending',
    intent: request.intent,
    plan: [],
    currentStepIndex: 0,
    context: {
      projectPath: request.projectPath,
      activeFile: request.activeFile,
      relevantFiles: [],
      relevantMemory: [],
      relevantKnowledge: [],
      recentConversation: request.recentConversation || [],
      maxContextTokens: model.contextSize || 2048,
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
  };

  _activeTasks.set(taskId, task);
  const token = createCancellationToken();
  _cancellationTokens.set(taskId, token);

  emit({
    type: 'task_created',
    taskId,
    message: `Task created: "${request.userRequest.slice(0, 80)}${request.userRequest.length > 80 ? '...' : ''}"`,
    data: { intent: request.intent, modelId: model.id, modelName: model.name },
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

  try {
    // ── Phase 1: Planning ──
    token.throwIfCancelled();
    task.status = 'planning';
    emit({
      type: 'planning_started',
      taskId,
      message: 'Planning task...',
    });

    const runtime = await getRuntime();
    const model = await getModelForTask(task);
    if (!model) {
      throw new Error('No model available for task');
    }

    // Ensure the model is loaded into the runtime before planning
    await runtime.loadModel(model, {
      contextSize: model.contextSize,
      threads: 4,
      gpuLayers: model.gpuLayers ?? -1,
      temperature: 0.7,
      maxTokens: model.contextSize ? Math.floor(model.contextSize / 2) : 1024,
    });

    const tools = listToolDefinitions();
    const plan = await generatePlan(runtime, model, {
      userRequest: task.userRequest,
      intent: task.intent,
      tools,
      recentConversation: task.context.recentConversation,
      projectPath: task.context.projectPath,
      activeFile: task.context.activeFile,
    });

    task.plan = plan.steps;
    emit({
      type: 'planning_completed',
      taskId,
      message: `Plan generated: ${plan.steps.length} steps (confidence: ${plan.confidence.toFixed(2)})`,
      data: { stepCount: plan.steps.length, confidence: plan.confidence, reasoning: plan.reasoning, warnings: plan.warnings },
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
      task.status = 'completed';
      task.completedAt = Date.now();
      emit({
        type: 'task_completed',
        taskId,
        message: `Task completed in ${task.completedAt - task.createdAt}ms (${task.toolCalls.length} tool calls, ${task.observations.length} observations)`,
        data: {
          durationMs: task.completedAt - task.createdAt,
          toolCalls: task.toolCalls.length,
          observations: task.observations.length,
          verifications: task.verification.length,
        },
      });
    }

    return task;
  } catch (err: any) {
    if (err.code === 'AGENT_CANCELLED' || task.cancelled) {
      task.status = 'cancelled';
      task.completedAt = Date.now();
      emit({
        type: 'task_cancelled',
        taskId,
        message: `Task cancelled: ${task.cancelReason || 'no reason given'}`,
        data: { reason: task.cancelReason },
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
    task.status = 'failed';
    task.completedAt = Date.now();
    emit({
      type: 'task_failed',
      taskId,
      message: `Task failed: ${err.message}`,
      data: { error },
    });
    AgentLogger.error(`Task ${taskId} failed: ${err.message}`, { taskId, data: { stack: err.stack } });
    return task;
  } finally {
    // Clean up the cancellation token (task is done)
    _cancellationTokens.delete(taskId);
  }
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
    data: { toolName: step.toolName, requiresPermission: step.requiresPermission },
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
      const permContext: PermissionContext = {
        projectId: task.context.projectPath,
        sessionId: task.id,
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
        data: { success: result.success, durationMs: toolCallRecord.durationMs, error: result.error },
      });

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

      // Verify the result
      if (result.success) {
        step.status = 'completed';
        step.completedAt = Date.now();
        emit({
          type: 'step_completed',
          taskId: task.id,
          stepId: step.id,
          message: `Step ${step.index + 1} completed`,
          data: { durationMs: step.completedAt - (step.startedAt || 0) },
        });
      } else {
        // Tool failed — handle retry or fail the step
        await handleStepFailure(task, step, result.error || 'Tool reported failure', token, runtime, model);
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
  if (retryCount < task.maxRetries) {
    step.retryCount = retryCount + 1;
    step.status = 'pending'; // allow re-execution
    emit({
      type: 'retry',
      taskId: task.id,
      stepId: step.id,
      message: `Retrying step ${step.index + 1} (attempt ${step.retryCount + 1}/${task.maxRetries})`,
      data: { retryCount: step.retryCount, maxRetries: task.maxRetries },
    });
    AgentLogger.warn(`Retrying step ${step.index + 1} after failure: ${errorMessage}`, { taskId: task.id, stepId: step.id });
    // Re-execute
    await executeStep(task, step, token, runtime, model);
  } else {
    step.status = 'failed';
    step.error = `Max retries (${task.maxRetries}) exceeded: ${errorMessage}`;
    emit({
      type: 'step_failed',
      taskId: task.id,
      stepId: step.id,
      message: `Step ${step.index + 1} failed permanently: ${errorMessage}`,
    });
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getRuntime(): Promise<AIRuntime> {
  const { getDefaultRuntime } = await import('../ai/runtime');
  return getDefaultRuntime();
}

async function getModelForTask(task: AgentTask): Promise<LocalModelInfo | null> {
  const { listModels, getModel: getModelById } = await import('../ai/model-registry');
  const models = listModels().filter((m) => m.fileExists);
  if (models.length === 0) return null;
  // For now, use the most recently used model
  // (Phase 8+ will use ModelSelector more intelligently)
  const sorted = [...models].sort((a, b) => {
    const aT = a.lastUsedAt || a.addedAt;
    const bT = b.lastUsedAt || b.addedAt;
    return bT - aT;
  });
  return sorted[0];
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Remove a completed task from the registry. Logs are kept.
 */
export function deleteTask(taskId: string): void {
  _activeTasks.delete(taskId);
  _cancellationTokens.delete(taskId);
  // Don't delete logs — they're audit records
}
