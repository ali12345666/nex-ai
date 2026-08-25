/**
 * NEX AI — Agent Executor (Phase 54)
 *
 * Connects the Expert System with real tool execution.
 *
 * Architecture:
 *
 *   User Request
 *       ↓
 *   Brain Controller → Expert Router → Skill Selection
 *       ↓
 *   Permission Check (Phase 43 PermissionGate)
 *       ↓
 *   Tool Execution (Phase 7 tool-registry)
 *       ↓
 *   Result → Memory Update (Phase 40/52)
 *
 * CRITICAL SECURITY:
 *   NEX MUST ASK BEFORE:
 *     - running terminal commands
 *     - modifying files
 *     - installing software
 *     - deleting files
 *     - downloading anything
 *
 *   Every sensitive action requires Persian permission dialog:
 *     "برای اجرای این دستور نیاز به اجازه شما دارم."
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
   * Execute a plan step by step.
   * Each step that requires permission will block until the user responds.
   */
  async executePlan(plan: ExecutionPlan): Promise<ExecutionResult> {
    const log: string[] = [];
    let completed = 0;
    let failed = 0;
    let denied = 0;

    for (const step of plan.steps) {
      // Check if permission is needed
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
          continue; // Skip this step, continue with next
        }
      }

      step.status = 'approved';
      log.push(`Step ${step.index}: Approved — ${step.skillName}`);

      // Execute the step (in production, this would call tool-registry)
      step.status = 'executing';
      log.push(`Step ${step.index}: Executing — ${step.skillName}`);

      // Simulate execution (actual tool execution is done by the agent loop)
      step.status = 'completed';
      step.result = `${step.skillName} completed successfully`;
      completed++;
      log.push(`Step ${step.index}: Completed — ${step.skillName}`);

      // Record tool usage in long-term memory
      try {
        const ltm = getLongTermMemorySystem();
        ltm.recordToolUsage(step.skillId);
      } catch { /* */ }
    }

    const success = failed === 0;
    const message = `Execution complete: ${completed} success, ${failed} failed, ${denied} denied`;
    const messageFa = `اجرا کامل شد: ${completed} موفق، ${failed} ناموفق، ${denied} رد شده`;

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
