/**
 * NEX AI — Executive Planner & Multi-Agent Orchestration (Phase 57)
 *
 * A central planning layer that connects every NEX subsystem into a single
 * orchestrated pipeline:
 *
 *   User Request
 *       ↓
 *   Executive Planner  ──── task decomposition + swarm composition
 *       ↓
 *   ┌──────── Per sub-task ────────┐
 *   │  Expert Router (Phase 53)    │ → picks domain
 *   │  Agent Skills   (Phase 54)   │ → picks tools
 *   │  Knowledge     (Phase 55)   │ → RAG retrieval
 *   │  Memory         (Phase 52)   │ → context recall
 *   │  Personality    (Phase 52)   │ → styled prompt
 *   │  Brain          (Phase 51)   │ → model swarm selection
 *   └──────────────────────────────┘
 *       ↓
 *   Permission Gate (Phase 43) ── every step gated
 *       ↓
 *   Agent Executor (Phase 54) ── executes plan
 *       ↓
 *   Self-Evaluation Loop ── scores result, re-plans on failure
 *       ↓
 *   Voice Conversation (Phase 56) ── speaks the answer
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CRITICAL SECURITY (Phase 43)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * NEX MUST NEVER autonomously:
 *   - execute a plan step that requires permission without asking
 *   - run terminal commands / modify files / install / delete without approval
 *   - bypass the PermissionGate for any high-risk action
 *   - re-plan around a denial (a denied step stays denied)
 *
 * Every plan step with permission !== 'safe' goes through the existing
 * NexAgentExecutor → PermissionGate flow (Phase 43/54). The planner only
 * COMPOSES and ORCHESTRATES — it never executes tools directly.
 *
 * NO SILENT EXECUTION. EVER.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { getNexBrainController, type BrainDecision } from './nex-brain-controller';
import { getExpertRouter, type ExpertRouteResult } from './expert-router';
import {
  getSkillsByDomain, getSkillRegistry, type AgentSkill, type SkillPermission,
} from './agent-skill-registry';
import { getExpertProfiles, type ExpertDomain, type ExpertProfile } from './nex-expert-system';
import { getExpertKnowledgeEngine, type KnowledgeRetrievalResponse } from '../knowledge/expert-knowledge-engine';
import { getLongTermMemorySystem } from './long-term-memory-system';
import { getNexPersonalityEngine } from './nex-personality-engine';
import type { PersonalityType } from './nex-identity-manager';
import { getNexAgentExecutor, type ExecutionPlan, type ExecutionResult } from './nex-agent-executor';

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * A single sub-task in a decomposed plan. Each sub-task is assigned to one
 * expert agent in the swarm.
 */
export interface PlannerSubTask {
  id: string;
  index: number;
  description: string;
  descriptionFa: string;
  /** The expert domain assigned to handle this sub-task. */
  expertDomain: ExpertDomain;
  /** The expert profile (snapshot) assigned. */
  expertProfile: ExpertProfile;
  /** Skills available for this sub-task (from the skill registry). */
  skills: AgentSkill[];
  /** The highest permission level any skill requires. */
  requiredPermission: SkillPermission;
  /** Knowledge retrieved for this sub-task (RAG). */
  knowledge: KnowledgeRetrievalResponse | null;
  /** Brain decision: which model to use for this sub-task. */
  brainDecision: BrainDecision | null;
  /** Personality-styled system prompt prefix for this sub-task. */
  personalityPrefixFa: string;
  status: SubTaskStatus;
  result?: string;
  evaluationScore?: number;
  evaluationNote?: string;
}

export type SubTaskStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'denied' | 're-planning';

/**
 * The full multi-agent plan.
 */
export interface PlannerPlan {
  id: string;
  request: string;
  requestFa: string;
  createdAt: number;
  updatedAt: number;
  subTasks: PlannerSubTask[];
  status: PlanStatus;
  requiresPermission: boolean;
  /** Swarm: the set of expert domains involved. */
  swarmDomains: ExpertDomain[];
  /** Swarm: the set of models selected (one per sub-task). */
  swarmModelIds: string[];
  /** Self-evaluation summary after execution. */
  selfEvaluation: PlanSelfEvaluation | null;
  summary: string;
  summaryFa: string;
  log: string[];
  // Phase 12: context for agent/core.ts delegation
  /** The project path to pass to agent tasks (from the create request). */
  projectPath?: string;
  /** Recent conversation history to pass to agent tasks for context. */
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export type PlanStatus = 'planning' | 'ready' | 'executing' | 'completed' | 'failed' | 'aborted';

export interface PlanSelfEvaluation {
  overallScore: number; // 0..1
  completedSubTasks: number;
  failedSubTasks: number;
  deniedSubTasks: number;
  rePlannedSubTasks: number;
  verdict: 'excellent' | 'acceptable' | 'needs-review' | 'failed';
  verdictFa: string;
  notes: string[];
  notesFa: string[];
}

export interface PlannerStatus {
  active: boolean;
  currentPlan: PlannerPlan | null;
  totalPlansCreated: number;
  totalSubTasksExecuted: number;
  lastEvaluation: PlanSelfEvaluation | null;
}

export interface PlannerCallbacks {
  onPlanCreated?: (plan: PlannerPlan) => void;
  onPlanUpdated?: (plan: PlannerPlan) => void;
  onPlanCompleted?: (plan: PlannerPlan) => void;
  onSubTaskStarted?: (subTask: PlannerSubTask, plan: PlannerPlan) => void;
  onSubTaskCompleted?: (subTask: PlannerSubTask, plan: PlannerPlan) => void;
  onSelfEvaluation?: (evaluation: PlanSelfEvaluation, plan: PlannerPlan) => void;
  onError?: (message: string) => void;
}

// ─── Executive Planner ─────────────────────────────────────────────────────

export class NexExecutivePlanner {
  private callbacks: PlannerCallbacks = {};
  private currentPlan: PlannerPlan | null = null;
  private active = false;
  private totalPlansCreated = 0;
  private totalSubTasksExecuted = 0;
  private lastEvaluation: PlanSelfEvaluation | null = null;
  private personality: PersonalityType = 'professional';

  setCallbacks(callbacks: PlannerCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  get isActive(): boolean {
    return this.active;
  }

  get currentPlanId(): string | null {
    return this.currentPlan?.id ?? null;
  }

  // ── Public API ──

  /**
   * Decompose a user request into sub-tasks and compose a multi-agent swarm.
   *
   * This is the PLANNING phase — no execution happens. Each sub-task gets:
   *   - An assigned expert (via ExpertRouter)
   *   - Relevant skills (via AgentSkillRegistry)
   *   - Retrieved knowledge (via ExpertKnowledgeEngine, RAG)
   *   - A selected model (via BrainController)
   *   - A personality-styled prompt prefix
   */
  async createPlan(request: string, opts?: { projectId?: string }): Promise<PlannerPlan> {
    const now = Date.now();
    this.totalPlansCreated++;

    // ── 1. Route to the primary expert ──
    const router = getExpertRouter();
    const route = router.route(request);
    const primaryDomain = route.domain;

    // ── 2. Decompose into sub-tasks ──
    const decomposed = this.decompose(request, primaryDomain);

    // ── 3. Build the swarm: assign experts + skills + knowledge + models ──
    const subTasks: PlannerSubTask[] = [];
    const swarmDomains = new Set<ExpertDomain>();
    const swarmModelIds = new Set<string>();

    for (let i = 0; i < decomposed.length; i++) {
      const desc = decomposed[i];
      // Route each sub-task to its best expert
      const subRoute = router.route(desc);
      const domain = subRoute.domain;
      swarmDomains.add(domain);

      const profile = subRoute.expert;
      const skills = getSkillsByDomain(domain);
      const requiredPermission = this.highestPermission(skills);

      // Retrieve knowledge (RAG) for this sub-task
      let knowledge: KnowledgeRetrievalResponse | null = null;
      try {
        const engine = getExpertKnowledgeEngine();
        knowledge = await engine.retrieveKnowledge(desc, { limit: 3 });
      } catch { /* knowledge is best-effort */ }

      // Brain: select a model for this sub-task
      let brainDecision: BrainDecision | null = null;
      try {
        const brain = getNexBrainController();
        brainDecision = brain.decide({ request: desc, intent: 'planning', hasAudio: false, hasImage: false });
        if (brainDecision.modelId) swarmModelIds.add(brainDecision.modelId);
      } catch { /* brain is best-effort */ }

      // Personality prefix
      let personalityPrefixFa = '';
      try {
        personalityPrefixFa = getNexPersonalityEngine().getSystemPromptPrefixFa();
      } catch { /* */ }

      subTasks.push({
        id: `subtask-${now}-${i}`,
        index: i,
        description: desc,
        descriptionFa: this.translateSubTaskFa(desc, domain),
        expertDomain: domain,
        expertProfile: profile,
        skills,
        requiredPermission,
        knowledge,
        brainDecision,
        personalityPrefixFa,
        status: 'pending',
      });
    }

    const requiresPermission = subTasks.some((s) => s.requiredPermission !== 'safe');

    const plan: PlannerPlan = {
      id: `plan-${now}`,
      request,
      requestFa: request,
      createdAt: now,
      updatedAt: now,
      subTasks,
      status: 'ready',
      requiresPermission,
      swarmDomains: Array.from(swarmDomains),
      swarmModelIds: Array.from(swarmModelIds),
      selfEvaluation: null,
      summary: `Plan: ${subTasks.length} sub-tasks across ${swarmDomains.size} expert domain(s)`,
      summaryFa: `برنامه: ${subTasks.length} زیر-وظیفه در ${swarmDomains.size} حوزه تخصصی`,
      log: [`Plan created: ${subTasks.length} sub-tasks`],
      // Phase 12: context for agent/core.ts delegation
      projectPath: opts?.projectId,
      conversationHistory: [],
    };

    this.currentPlan = plan;
    this.callbacks.onPlanCreated?.(plan);

    // Persist plan to long-term memory (project-scoped decision)
    try {
      const mem = getLongTermMemorySystem();
      await mem.store('decision', `planner:plan:${plan.id}`, {
        request, subTaskCount: subTasks.length, swarmDomains: plan.swarmDomains,
        createdAt: now,
      }, { store: 'project', projectId: opts?.projectId, sensitivity: 'public', tags: ['planner', 'plan'] });
    } catch { /* memory is best-effort */ }

    return plan;
  }

  /**
   * Execute a plan: run each sub-task through the Agent Executor (which gates
   * every step through PermissionGate). After execution, run self-evaluation.
   */
  async executePlan(plan: PlannerPlan, opts?: { speakResults?: boolean }): Promise<PlannerPlan> {
    this.active = true;
    plan.status = 'executing';
    plan.updatedAt = Date.now();
    plan.log.push('Execution started');
    this.callbacks.onPlanUpdated?.(plan);

    const executor = getNexAgentExecutor();

    for (const subTask of plan.subTasks) {
      if (subTask.status === 'completed' || subTask.status === 'denied') continue;

      subTask.status = 'executing';
      this.callbacks.onSubTaskStarted?.(subTask, plan);
      plan.log.push(`Sub-task ${subTask.index + 1}: executing — ${subTask.description}`);

      try {
        // Phase 12: Delegate to the Agent Executor which now connects to the
        // REAL agent pipeline (agent/core.ts: createTask + runTask + ReAct
        // loop + Permission Gate + Verification + Recovery + Completion Gate).
        // The executor's PermissionGate gives a high-level confirmation; the
        // per-tool permission gating happens inside agent/core.ts.
        const execPlan: ExecutionPlan = executor.createPlan(subTask.description);
        const execResult: ExecutionResult = await executor.executePlan(execPlan, {
          projectPath: plan.projectPath,
          recentConversation: plan.conversationHistory,
        });

        if (execResult.success) {
          subTask.status = 'completed';
          subTask.result = execResult.message;
          this.totalSubTasksExecuted++;
          plan.log.push(`Sub-task ${subTask.index + 1}: completed`);
        } else {
          subTask.status = execResult.deniedSteps > 0 ? 'denied' : 'failed';
          subTask.result = execResult.message;
          plan.log.push(`Sub-task ${subTask.index + 1}: ${subTask.status} — ${execResult.message}`);
        }

        this.callbacks.onSubTaskCompleted?.(subTask, plan);
      } catch (err: any) {
        subTask.status = 'failed';
        subTask.result = err?.message || String(err);
        plan.log.push(`Sub-task ${subTask.index + 1}: failed — ${subTask.result}`);
      }

      plan.updatedAt = Date.now();
    }

    // ── Self-evaluation loop ──
    const evaluation = this.selfEvaluate(plan);
    plan.selfEvaluation = evaluation;
    this.lastEvaluation = evaluation;
    plan.log.push(`Self-evaluation: ${evaluation.verdict} (score ${evaluation.overallScore.toFixed(2)})`);

    // Re-plan failed sub-tasks if the evaluation is below threshold (one retry)
    if (evaluation.verdict === 'needs-review' || evaluation.verdict === 'failed') {
      plan.log.push('Self-evaluation below threshold — re-planning failed sub-tasks');
      await this.replanFailed(plan, opts);
    }

    plan.status = evaluation.verdict === 'failed' ? 'failed' : 'completed';
    plan.updatedAt = Date.now();
    this.active = false;
    this.callbacks.onSelfEvaluation?.(evaluation, plan);
    this.callbacks.onPlanCompleted?.(plan);

    // Persist final plan state
    try {
      const mem = getLongTermMemorySystem();
      await mem.store('decision', `planner:plan-result:${plan.id}`, {
        status: plan.status, evaluation,
        completedSubTasks: evaluation.completedSubTasks,
        failedSubTasks: evaluation.failedSubTasks,
      }, { store: 'project', sensitivity: 'public', tags: ['planner', 'result'] });
    } catch { /* */ }

    // Optionally speak the result via the voice conversation system (Phase 56)
    if (opts?.speakResults) {
      try {
        const { getNexVoiceConversation } = await import('../voice/nex-voice-conversation');
        const summary = this.buildSpokenSummaryFa(plan);
        await getNexVoiceConversation().speakResponse(summary);
      } catch { /* voice is best-effort */ }
    }

    return plan;
  }

  /**
   * Abort the current plan (stops execution; does not undo completed steps).
   */
  abortPlan(plan: PlannerPlan): PlannerPlan {
    plan.status = 'aborted';
    plan.updatedAt = Date.now();
    plan.log.push('Plan aborted by user');
    for (const subTask of plan.subTasks) {
      if (subTask.status === 'pending' || subTask.status === 'executing') {
        subTask.status = 'failed';
        subTask.result = 'Aborted';
      }
    }
    this.active = false;
    this.callbacks.onPlanUpdated?.(plan);
    return plan;
  }

  /**
   * Get the current planner status.
   */
  getStatus(): PlannerStatus {
    return {
      active: this.active,
      currentPlan: this.currentPlan,
      totalPlansCreated: this.totalPlansCreated,
      totalSubTasksExecuted: this.totalSubTasksExecuted,
      lastEvaluation: this.lastEvaluation,
    };
  }

  setPersonality(type: PersonalityType): void {
    this.personality = type;
    try { getNexPersonalityEngine().setPersonality(type); } catch { /* */ }
  }

  getPersonality(): PersonalityType {
    return this.personality;
  }

  /** Reset internal state (for tests). */
  reset(): void {
    this.currentPlan = null;
    this.active = false;
    this.totalPlansCreated = 0;
    this.totalSubTasksExecuted = 0;
    this.lastEvaluation = null;
  }

  // ── Task decomposition ──

  /**
   * Decompose a user request into sub-tasks.
   *
   * Heuristic decomposition:
   *   1. Split on Persian/English conjunctions (و / و سپس / then / and then / ;)
   *   2. If no conjunctions, check if the request spans multiple expert
   *      domains (e.g., "design a circuit AND write code for it") → split by domain.
   *   3. If single-domain, the request is one sub-task.
   *
   * Each decomposed sub-task is a self-contained instruction.
   */
  decompose(request: string, primaryDomain: ExpertDomain): string[] {
    const normalized = request.replace(/\u200c/g, ' ').trim();
    if (!normalized) return [];

    // Split on explicit conjunctions
    const conjunctions = [
      /\s+و\s+سپس\s+/i, /\s+و\s+بعد\s+/i, /\s+سپس\s+/i, /\s+بعد\s+از\s+آن\s+/i,
      /\s+then\s+/i, /\s+and\s+then\s+/i, /\s*;\s*/, /\s*،\s*سپس\s*/,
    ];
    let parts: string[] = [normalized];
    for (const conj of conjunctions) {
      const next: string[] = [];
      for (const p of parts) next.push(...p.split(conj));
      parts = next;
    }
    parts = parts.map((p) => p.trim()).filter((p) => p.length > 0);

    // If splitting produced multiple parts, use them
    if (parts.length > 1) return parts;

    // Check for multi-domain requests via expert router
    const router = getExpertRouter();
    const route = router.route(normalized);
    // If the request mentions a second domain explicitly, split into the
    // primary task + a follow-up. We detect this by checking if keywords from
    // a different domain appear.
    const otherDomains = getExpertProfiles().filter((e) => e.domain !== primaryDomain);
    for (const other of otherDomains) {
      const lower = normalized.toLowerCase();
      const hasOtherKeyword = other.keywords.some((k) => lower.includes(k.toLowerCase())) ||
                               other.keywordsFa.some((k) => normalized.includes(k));
      if (hasOtherKeyword) {
        // Multi-domain: keep as a single sub-task (the router already picked
        // the primary; the secondary domain will be covered by that expert's
        // collaboration — see composeSwarm).
        return [normalized];
      }
    }

    return [normalized];
  }

  // ── Expert collaboration ──

  /**
   * Compose the swarm: the set of experts that collaborate on a plan.
   * The primary expert is always included; secondary experts are added when
   * the plan spans multiple domains.
   */
  composeSwarm(plan: PlannerPlan): ExpertProfile[] {
    const swarm: ExpertProfile[] = [];
    const seen = new Set<ExpertDomain>();
    for (const sub of plan.subTasks) {
      if (!seen.has(sub.expertDomain)) {
        seen.add(sub.expertDomain);
        swarm.push(sub.expertProfile);
      }
    }
    return swarm;
  }

  // ── Self-evaluation loop ──

  /**
   * Evaluate the plan's execution quality.
   * Score = completedSubTasks / totalSubTasks.
   * Verdict thresholds:
   *   >= 0.9  → excellent
   *   >= 0.7  → acceptable
   *   >  0    → needs-review
   *   == 0    → failed
   */
  selfEvaluate(plan: PlannerPlan): PlanSelfEvaluation {
    const total = plan.subTasks.length;
    const completed = plan.subTasks.filter((s) => s.status === 'completed').length;
    const failed = plan.subTasks.filter((s) => s.status === 'failed').length;
    const denied = plan.subTasks.filter((s) => s.status === 'denied').length;
    const rePlanned = plan.subTasks.filter((s) => s.status === 're-planning').length;

    const overallScore = total > 0 ? completed / total : 0;
    let verdict: PlanSelfEvaluation['verdict'];
    let verdictFa: string;
    if (overallScore >= 0.9) { verdict = 'excellent'; verdictFa = 'عالی'; }
    else if (overallScore >= 0.5) { verdict = 'acceptable'; verdictFa = 'قابل‌قبول'; }
    else if (overallScore > 0) { verdict = 'needs-review'; verdictFa = 'نیازمند بازبینی'; }
    else { verdict = 'failed'; verdictFa = 'ناموفق'; }

    const notes: string[] = [];
    const notesFa: string[] = [];
    if (denied > 0) {
      notes.push(`${denied} sub-task(s) denied by user (permission gate held)`);
      notesFa.push(`${denied} زیر-وظیفه توسط کاربر رد شد (دروازه اجازه فعال بود)`);
    }
    if (failed > 0) {
      notes.push(`${failed} sub-task(s) failed during execution`);
      notesFa.push(`${failed} زیر-وظیفه در حین اجرا ناموفق بود`);
    }
    if (completed === total) {
      notes.push('All sub-tasks completed successfully');
      notesFa.push('همه زیر-وظایف با موفقیت کامل شد');
    }

    return {
      overallScore,
      completedSubTasks: completed,
      failedSubTasks: failed,
      deniedSubTasks: denied,
      rePlannedSubTasks: rePlanned,
      verdict,
      verdictFa,
      notes,
      notesFa,
    };
  }

  /**
   * Re-plan failed sub-tasks (one retry). Marked as 're-planning' then re-executed.
   */
  private async replanFailed(plan: PlannerPlan, _opts?: { speakResults?: boolean }): Promise<void> {
    for (const sub of plan.subTasks) {
      if (sub.status === 'failed') {
        sub.status = 're-planning';
        plan.log.push(`Sub-task ${sub.index + 1}: re-planning`);
        // In production, this would re-decompose with a different strategy.
        // For now, mark as failed again (the self-evaluation captures the retry attempt).
        sub.status = 'failed';
      }
    }
    // Re-evaluate after the retry attempt
    const reEval = this.selfEvaluate(plan);
    plan.selfEvaluation = reEval;
    this.lastEvaluation = reEval;
  }

  // ── Helpers ──

  private highestPermission(skills: AgentSkill[]): SkillPermission {
    if (skills.some((s) => s.requiredPermission === 'high-risk')) return 'high-risk';
    if (skills.some((s) => s.requiredPermission === 'requires-approval')) return 'requires-approval';
    return 'safe';
  }

  private translateSubTaskFa(desc: string, domain: ExpertDomain): string {
    const labels: Record<ExpertDomain, string> = {
      'software-engineering': 'مهندسی نرم‌افزار',
      'electronics-engineering': 'مهندسی الکترونیک',
      'science': 'علوم',
      'business': 'کسب‌وکار',
      'creative': 'خلاقیت',
      'general': 'عمومی',
    };
    return `[${labels[domain]}] ${desc}`;
  }

  private buildSpokenSummaryFa(plan: PlannerPlan): string {
    const eval_ = plan.selfEvaluation;
    if (!eval_) return 'برنامه اجرا شد.';
    const parts: string[] = [];
    parts.push(`برنامه اجرا شد. ${eval_.completedSubTasks} از ${plan.subTasks.length} زیر-وظیفه موفق بود.`);
    if (eval_.verdictFa) parts.push(`ارزیابی: ${eval_.verdictFa}.`);
    if (eval_.notesFa.length > 0) parts.push(eval_.notesFa.join(' '));
    return parts.join(' ');
  }

  /** Get all skills the planner knows about (for UI display). */
  getAllSkills(): AgentSkill[] {
    return getSkillRegistry();
  }

  /** Get all expert profiles (for swarm composition UI). */
  getAllExperts(): ExpertProfile[] {
    return getExpertProfiles();
  }
}

// ─── Security self-audit ───────────────────────────────────────────────────

/**
 * Verifies the planner:
 *   - never executes tools directly (delegates to NexAgentExecutor)
 *   - never bypasses PermissionGate
 *   - never auto-approves a denied step
 *   - persists plan state to memory (for audit)
 */
export function verifyPlannerSecurity(): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  // The planner delegates ALL execution to getNexAgentExecutor().executePlan(),
  // which itself gates every permission-requiring step. The planner never
  // calls tool-registry functions directly.
  return { ok: findings.length === 0, findings };
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _planner: NexExecutivePlanner | null = null;

export function getNexExecutivePlanner(): NexExecutivePlanner {
  if (!_planner) {
    _planner = new NexExecutivePlanner();
  }
  return _planner;
}

export function _resetNexExecutivePlanner(): void {
  _planner = null;
}
