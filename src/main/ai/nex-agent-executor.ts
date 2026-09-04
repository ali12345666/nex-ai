/**
 * NEX AI — Agent Executor (Phase 54 + Phase 12)
 *
 * Phase 12: Multi-Agent Orchestration Integration
 *
 * Connects the ExecutivePlanner's sub-tasks to the REAL agent pipeline
 * (agent/core.ts: createTask + runTask + ReAct loop + Permission Gate +
 * Verification + Recovery + Task Completion Gate).
 *
 * Architecture:
 *
 *   ExecutivePlanner.createPlan(userRequest)
 *     → subTasks[] (each with expert routing, personality, knowledge)
 *     → NexAgentExecutor.executePlan(plan)
 *       → for each step:
 *         → agent/core.ts createTask({ userRequest: step.action })
 *         → agent/core.ts runTask(taskId) — runs the FULL Phase 6-11 pipeline:
 *           → Planner (LLM generates concrete steps)
 *           → executeStep (permission gate, tool execution, observation)
 *           → Verification (Phase 9: structural/content/execution verification)
 *           → Recovery (Phase 7: RETRY/MODIFY/REPLAN/SKIP/ABORT)
 *           → Task Completion Gate (Phase 9: all steps verified)
 *         → result → step.result
 *       → return ExecutionResult with real outcomes
 *
 * CRITICAL SECURITY:
 *   The agent/core.ts path handles ALL permission gating internally
 *   (executeToolWithPermission + requestPermissionAndWait). This executor
 *   does NOT bypass the Permission Gate — it delegates to the real agent
 *   which enforces it for every tool call.
 *
 *   NEX MUST ASK BEFORE:
 *     - running terminal commands
 *     - modifying files
 *     - installing software
 *     - deleting files
 *     - downloading anything
 */

import { PermissionGate, type ActionDescriptor, type PermissionGateResult } from '../update/permission-gate';
import { getSkill, getSkillsByDomain, getSkillRegistry, type AgentSkill, type SkillPermission } from './agent-skill-registry';
import type { ExpertDomain } from './nex-expert-system';
import { getExpertRouter } from './expert-router';
import { getLongTermMemorySystem } from './long-term-memory-system';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ExecutionPlan {
  id: string;
  steps: ExecutionStep[];
  totalSteps: number;
  requiresPermission: boolean;
  summary: string;
  summaryFa: string;
}

export interface ExecutionStep {
  index: number;
  skillId: string;
  skillName: string;
  skillNameFa: string;
  action: string;
  actionFa: string;
  permission: SkillPermission;
  tools: string[];
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'denied';
  result?: string;
}

export interface ExecutionResult {
  success: boolean;
  plan: ExecutionPlan;
  completedSteps: number;
  failedSteps: number;
  deniedSteps: number;
  message: string;
  messageFa: string;
  log: string[];
}

// ─── Agent Executor ────────────────────────────────────────────────────────

export class NexAgentExecutor {
  private permissionGate: PermissionGate;
  private permissionResolve: ((result: PermissionGateResult) => void) | null = null;
  private pendingPermission: { action: ActionDescriptor; step: ExecutionStep } | null = null;

  constructor(permissionGate?: PermissionGate) {
    this.permissionGate = permissionGate || new PermissionGate();
  }

  getPermissionGate(): PermissionGate {
    return this.permissionGate;
  }

  /**
   * Create an execution plan for a user request.
   * Plans the skills needed + which require permission.
   */
  createPlan(request: string): ExecutionPlan {
    const router = getExpertRouter();
    const routeResult = router.route(request);
    const domain = routeResult.domain;
    const skills = getSkillsByDomain(domain);

    // Also include general skills
    const generalSkills = getSkillsByDomain('general' as ExpertDomain);
    const allSkills = [...skills, ...generalSkills];

    const steps: ExecutionStep[] = allSkills.slice(0, 5).map((skill, idx) => ({
      index: idx + 1,
      skillId: skill.id,
      skillName: skill.name,
      skillNameFa: skill.nameFa,
      action: skill.actionDescription,
      actionFa: skill.actionDescriptionFa,
      permission: skill.requiredPermission,
      tools: skill.tools,
      status: 'pending' as const,
    }));

    const requiresPermission = steps.some((s) => s.permission !== 'safe');
    const summary = `Plan: ${steps.length} steps for ${routeResult.expert.name}`;
    const summaryFa = `برنامه انجام کار:\n${steps.map((s) => `${s.index}. ${s.skillNameFa}`).join('\n')}`;

    return {
      id: `plan-${Date.now()}`,
      steps,
      totalSteps: steps.length,
      requiresPermission,
      summary,
      summaryFa,
    };
  }

  /**
   * Execute a plan step by step using the REAL agent pipeline.
   *
   * Phase 12: Instead of simulating execution, each step is delegated to
   * agent/core.ts (createTask + runTask), which runs the full Phase 6-11
   * pipeline:
   *   → Planner generates concrete tool steps
   *   → executeStep with Permission Gate (executeToolWithPermission)
   *   → Observation + Verification (Phase 9 structural/content verification)
   *   → Recovery (Phase 7: RETRY/MODIFY/REPLAN/SKIP/ABORT)
   *   → Task Completion Gate (all steps verified, no unresolved errors)
   *
   * The PermissionGate in this executor is used ONLY for the pre-execution
   * confirmation dialog (Phase 43 PermissionGate). The real per-tool-call
   * permission gating happens inside agent/core.ts via
   * executeToolWithPermission.
   *
   * @param plan The execution plan from createPlan()
   * @param opts Optional: projectPath for the agent tasks, recentConversation
   * @returns ExecutionResult with real outcomes from agent/core.ts
   */
  async executePlan(plan: ExecutionPlan, opts?: {
    projectPath?: string;
    recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<ExecutionResult> {
    const log: string[] = [];
    let completed = 0;
    let failed = 0;
    let denied = 0;

    // Phase 12: Import agent/core dynamically (avoids circular dependency at
    // module load time — agent/core imports from tool-registry which imports
    // many tools; the executor is used from main.ts which is loaded early).
    let agentCore: any = null;
    try {
      agentCore = await import('../agent/core');
    } catch (err: any) {
      // If agent/core can't be loaded (e.g. no model available), fall back
      // to the old stub behavior with a clear warning.
      log.push(`WARNING: agent/core.ts not available — ${err.message}. Using fallback stub.`);
      for (const step of plan.steps) {
        step.status = 'failed';
        step.result = 'agent/core.ts not available';
        failed++;
        log.push(`Step ${step.index}: FAILED — agent core not loaded`);
      }
      return this.buildResult(plan, completed, failed, denied, log, false);
    }

    for (const step of plan.steps) {
      // Phase 43: Pre-execution permission confirmation (optional — the
      // real per-tool permission is handled by agent/core.ts). This gate
      // gives the user a high-level "are you sure?" before the whole step.
      if (step.permission !== 'safe') {
        const action: ActionDescriptor = {
          type: step.permission === 'high-risk' ? 'delete-file' : 'modify-config',
          description: `${step.skillName}: ${step.action}`,
          reason: step.actionFa,
          affectedItems: step.tools,
        };

        const permResult = await this.requestPermission(action, step);

        if (!permResult.approved) {
          step.status = 'denied';
          denied++;
          log.push(`Step ${step.index}: DENIED — ${permResult.denialReason || 'User declined'}`);
          continue;
        }
      }

      step.status = 'approved';
      log.push(`Step ${step.index}: Approved — ${step.skillName}`);
      step.status = 'executing';
      log.push(`Step ${step.index}: Executing via agent/core.ts — ${step.skillName}`);

      // Phase 12: Delegate to the REAL agent pipeline
      try {
        const task = await agentCore.createTask({
          userRequest: step.action,
          projectPath: opts?.projectPath,
          recentConversation: opts?.recentConversation as any,
          limits: { maxSteps: 10, maxToolCalls: 20, maxRetries: 2, maxExecutionTimeMs: 120000 },
        });

        const finalTask = await agentCore.runTask(task.id);

        // Check the real outcome from agent/core.ts
        if (finalTask.status === 'completed') {
          step.status = 'completed';
          // Build a real result from the agent's tool calls + observations
          const toolCount = finalTask.toolCalls.length;
          const obsCount = finalTask.observations.length;
          const verCount = finalTask.verification.length;
          step.result = `${step.skillName} completed: ${toolCount} tool calls, ${obsCount} observations, ${verCount} verifications`;
          completed++;
          log.push(`Step ${step.index}: Completed — ${toolCount} tools, ${obsCount} obs, ${verCount} verifications`);
        } else if (finalTask.status === 'cancelled') {
          step.status = 'failed';
          step.result = `Task cancelled: ${finalTask.cancelReason || 'unknown'}`;
          failed++;
          log.push(`Step ${step.index}: CANCELLED — ${finalTask.cancelReason || 'unknown'}`);
        } else {
          step.status = 'failed';
          const errMsg = finalTask.errors.length > 0
            ? finalTask.errors[finalTask.errors.length - 1].message
            : `Task ended with status: ${finalTask.status}`;
          step.result = errMsg;
          failed++;
          log.push(`Step ${step.index}: FAILED — ${errMsg}`);
        }

        // Record tool usage in long-term memory
        try {
          const ltm = getLongTermMemorySystem();
          ltm.recordToolUsage(step.skillId);
        } catch { /* */ }
      } catch (err: any) {
        step.status = 'failed';
        step.result = err?.message || String(err);
        failed++;
        log.push(`Step ${step.index}: FAILED — ${step.result}`);
      }
    }

    const success = failed === 0;
    return this.buildResult(plan, completed, failed, denied, log, success);
  }

  /**
   * Build the ExecutionResult from the step outcomes.
   */
  private buildResult(
    plan: ExecutionPlan,
    completed: number,
    failed: number,
    denied: number,
    log: string[],
    success: boolean,
  ): ExecutionResult {
    const message = `Execution ${success ? 'complete' : 'finished with errors'}: ${completed} success, ${failed} failed, ${denied} denied`;
    const messageFa = success
      ? `اجرا کامل شد: ${completed} موفق`
      : `اجرا با خطا تمام شد: ${completed} موفق، ${failed} ناموفق، ${denied} رد شده`;

    return {
      success,
      plan,
      completedSteps: completed,
      failedSteps: failed,
      deniedSteps: denied,
      message,
      messageFa,
      log,
    };
  }

  /**
   * Request permission for a step.
   * Returns the PermissionGateResult (approved/denied).
   */
  private async requestPermission(action: ActionDescriptor, step: ExecutionStep): Promise<PermissionGateResult> {
    this.pendingPermission = { action, step };
    return this.permissionGate.requestPermission(action);
  }

  /**
   * Respond to a pending permission request (from chat/UI).
   */
  respondToPermission(userResponse: string): void {
    this.permissionGate.respondToPermissionRequest(userResponse);
  }

  /**
   * Respond via voice (Phase 41).
   */
  async respondViaVoice(): Promise<void> {
    await this.permissionGate.respondViaVoice();
  }

  /**
   * Get the current pending permission request (for UI display).
   */
  getPendingPermission(): { action: ActionDescriptor; step: ExecutionStep } | null {
    return this.pendingPermission;
  }

  /**
   * Check if there's a pending permission request.
   */
  hasPendingPermission(): boolean {
    return this.pendingPermission !== null;
  }

  /**
   * Generate a Persian permission message for a specific action.
   */
  generatePermissionMessageFa(action: string, details?: string): string {
    const messages: Record<string, string> = {
      'write_file': 'این فایل تغییر خواهد یابد. اجازه می‌دهید؟',
      'edit_file': 'این فایل ویرایش خواهد شد. اجازه می‌دهید؟',
      'run_command': 'برای اجرای این دستور نیاز به اجازه شما دارم.',
      'delete_file': 'این فایل حذف خواهد شد. این عمل قابل بازگشت نیست. اجازه می‌دهید؟',
      'download': 'دانلود فایل نیاز به اجازه شما دارد. اجازه می‌دهید؟',
      'install': 'نصب نرم‌افزار نیاز به اجازه شما دارد. اجازه می‌دهید؟',
    };
    let msg = messages[action] || 'برای این عملیات نیاز به اجازه شما دارم.';
    if (details) {
      msg += `\nجزئیات:\n${details}`;
    }
    return msg;
  }

  /**
   * Get all available skills.
   */
  getAllSkills(): AgentSkill[] {
    return getSkillRegistry();
  }

  /**
   * Get skills for a specific expert domain.
   */
  getSkillsForDomain(domain: ExpertDomain): AgentSkill[] {
    return getSkillsByDomain(domain);
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _executor: NexAgentExecutor | null = null;

export function getNexAgentExecutor(): NexAgentExecutor {
  if (!_executor) {
    _executor = new NexAgentExecutor();
  }
  return _executor;
}
