/**
 * NEX AI — Model Router Layer (Optimized)
 *
 * The single entry point for model selection on the chat path. Sits between
 * the IPC handler (ai-chat-stream) and inference.ts loadModel().
 *
 * ════════════════════════════════════════════════════════════════════════════
 * OPTIMIZATION PRINCIPLES (fast user experience)
 * ════════════════════════════════════════════════════════════════════════════
 * 1. SESSION STICKINESS — Once a model is loaded for a session category
 *    (coding/chat/reasoning), keep it for subsequent messages in the same
 *    category. The router does NOT re-decide for every message — it only
 *    switches when the task tier changes significantly (e.g. simple→complex).
 *
 * 2. TIER-BASED DEFAULTS — The default model is MEDIUM (8B), not small (0.5B).
 *    Small models are only for very short greetings (≤3 words). This gives
 *    quality better than 0.5B for normal chat.
 *
 * 3. 30B RESTRICTION — Qwen3-30B is only for architecture, deep analysis,
 *    and heavy reasoning. NOT for regular coding or daily questions.
 *
 * 4. NO RELOAD CHURN — If the selected model is already loaded, skip reload
 *    entirely (inference.ts loadModel is idempotent). The router tracks the
 *    current session to avoid re-evaluating the full model list every time.
 *
 * 5. WARM CACHE NOTE — True multi-model warm cache (keeping 2+ models in VRAM
 *    simultaneously) is NOT feasible on 8GB RTX 4060 (a 30B Q5 model uses
 *    ~20GB). Instead, session stickiness achieves the same UX goal: the
 *    active model stays loaded until a different tier is truly needed,
 *    so most messages hit the cache (no reload).
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  ModelRouter (this file)                                    │
 *   │    routeForChat(messages, opts) → RouterVerdict             │
 *   │    Session stickiness: keep model if category matches       │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  inference.ts                                               │
 *   │    loadModel (idempotent — reuses if same id + not disposed)│
 *   └──────────────────────────────────────────────────────────────┘
 */

import { listModels, getModel, type LocalModelInfo } from './model-registry';
import { getGpuBackend, getLoadedModel } from './inference';
import { loadState } from '../persistence';

// ─── Types ─────────────────────────────────────────────────────────────────

export type TaskTier = 'simple' | 'medium' | 'complex';

export type SessionCategory = 'coding' | 'chat' | 'reasoning' | 'vision' | 'voice';

export interface ModelRouterRequest {
  /** The user's latest message text (used for task classification). */
  userMessage: string;
  /** Full conversation messages (for context-length-aware routing). */
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  /** Per-request model override (from config.localModelId). */
  modelIdOverride?: string;
  /** Whether the user has pinned a model (activeLocalModelId in settings). */
  hasPinnedModel?: boolean;
}

export interface ModelRouterVerdict {
  /** The model to use for this request. */
  model: LocalModelInfo | null;
  /** Whether the model is already loaded (cache hit — no reload needed). */
  alreadyLoaded: boolean;
  /** Whether a model switch is needed (false = reuse, true = must load). */
  needsSwitch: boolean;
  /** The task tier (simple/medium/complex). */
  taskTier: TaskTier;
  /** The detected task category (chat/coding/reasoning/vision). */
  category: string;
  /** The session category (sticky — stays until tier changes). */
  sessionCategory: SessionCategory;
  /** Suggested contextSize (VRAM-aware). */
  suggestedContextSize: number;
  /** Suggested gpuLayers (always -1 for local GGUF with Vulkan). */
  suggestedGpuLayers: number;
  /** Reason for the selection (for diagnostics). */
  reason: string;
  /** Source of the decision: user-pinned / override / session-sticky / auto-router / default. */
  source: 'user-pinned' | 'override' | 'session-sticky' | 'auto-router' | 'default' | 'none';
  /** Whether the router reused the current session's model (no re-evaluation). */
  cacheHit: boolean;
  /** Estimated load time in ms (0 if cache hit, >0 if switch needed). */
  loadTime: number;
}

// ─── Session State ─────────────────────────────────────────────────────────

interface SessionState {
  /** The current session category (sticky). */
  category: SessionCategory;
  /** The model ID assigned to this session. */
  modelId: string | null;
  /** When the session started. */
  startedAt: number;
  /** When the session was last active. */
  lastActivityAt: number;
  /** Number of messages in this session. */
  messageCount: number;
}

// ─── Model size helpers ────────────────────────────────────────────────────

/**
 * Parse parameterCount string ("0.5B", "7B", "8B", "30B") to a number.
 * Returns 0 if unparseable.
 */
function parseParamCount(paramCount: string | undefined): number {
  if (!paramCount) return 0;
  const match = paramCount.match(/([\d.]+)\s*[bB]/);
  if (!match) return 0;
  return parseFloat(match[1]);
}

/**
 * Classify a model by size tier:
 *   - small  : ≤ 2B (0.5B, 1.5B) — greetings, very simple tasks
 *   - medium : 2B–10B (7B, 8B) — default, good quality for chat + coding
 *   - large  : > 10B (14B, 30B) — complex reasoning only
 */
function modelSizeTier(model: LocalModelInfo): 'small' | 'medium' | 'large' {
  const params = parseParamCount(model.parameterCount);
  if (params === 0) {
    // Fallback: use file size as proxy (Q4: ~0.5GB per 1B params)
    const sizeGB = model.sizeBytes / (1024 * 1024 * 1024);
    if (sizeGB < 1.5) return 'small';
    if (sizeGB < 8) return 'medium';
    return 'large';
  }
  if (params <= 2) return 'small';
  if (params <= 10) return 'medium';
  return 'large';
}

/**
 * Estimate load time based on model size (rough heuristic for UX planning).
 * Small: ~1s, Medium: ~3s, Large: ~15s (on SSD with GPU offload).
 */
function estimateLoadTime(model: LocalModelInfo): number {
  const tier = modelSizeTier(model);
  switch (tier) {
    case 'small': return 1000;
    case 'medium': return 3000;
    case 'large': return 15000;
  }
}

// ─── Model Router ──────────────────────────────────────────────────────────

/**
 * The Model Router. Singleton.
 *
 * Call `routeForChat()` before invoking inference.ts loadModel/chatStream.
 * The verdict tells you which model to use and whether a switch is needed.
 */
export class ModelRouter {
  /** The current session state (sticky model assignment). */
  private _session: SessionState | null = null;

  /** Session timeout: if no activity for 5 minutes, reset session. */
  private readonly SESSION_TIMEOUT_MS = 5 * 60 * 1000;

  /**
   * Route a chat request to the best model.
   *
   * Priority chain:
   *   1. Per-request override (config.localModelId) — if set, use it.
   *   2. User-pinned model (settings.activeLocalModelId) — if set, use it
   *      UNLESS the task needs a capability the pinned model lacks.
   *   3. Session stickiness — if the current session's model can handle
   *      this task, keep it (no re-evaluation, no reload).
   *   4. Auto-router — pick the best model for the task tier.
   *   5. Default (most-recently-used) — fallback.
   */
  routeForChat(request: ModelRouterRequest): ModelRouterVerdict {
    const allModels = listModels().filter((m) => m.fileExists);
    const currentlyLoaded = getLoadedModel();
    const gpuBackend = getGpuBackend();
    const hasGpu = gpuBackend === 'vulkan' || gpuBackend === 'cuda' || gpuBackend === 'metal';

    // Classify the task
    const taskTier = this.classifyTaskTier(request.userMessage);
    const category = this.classifyCategory(request.userMessage);
    const sessionCategory = category as SessionCategory;
    const suggestedContextSize = this.suggestContextSize(taskTier, hasGpu);
    const suggestedGpuLayers = hasGpu ? -1 : 0;

    // Check if session is still valid (not timed out)
    const now = Date.now();
    const sessionValid = this._session &&
      (now - this._session.lastActivityAt < this.SESSION_TIMEOUT_MS);

    // Update session activity
    if (this._session && sessionValid) {
      this._session.lastActivityAt = now;
      this._session.messageCount++;
    }

    // ── 1. Per-request override ────────────────────────────────────────────
    if (request.modelIdOverride) {
      const model = getModel(request.modelIdOverride);
      if (model && model.fileExists) {
        return this.buildVerdict({
          model,
          currentlyLoaded,
          taskTier,
          category,
          sessionCategory,
          suggestedContextSize,
          suggestedGpuLayers,
          source: 'override',
          reason: `Per-request override: ${model.name}`,
          cacheHit: currentlyLoaded?.id === model.id,
        });
      }
    }

    // ── 2. User-pinned model ───────────────────────────────────────────────
    const pinnedId = this.getPinnedModelId();
    if (pinnedId && request.hasPinnedModel !== false) {
      const model = getModel(pinnedId);
      if (model && model.fileExists) {
        const canHandle = this.modelCanHandleTask(model, category);
        if (canHandle) {
          return this.buildVerdict({
            model,
            currentlyLoaded,
            taskTier,
            category,
            sessionCategory,
            suggestedContextSize,
            suggestedGpuLayers,
            source: 'user-pinned',
            reason: `User-pinned model: ${model.name} (task: ${category}/${taskTier})`,
            cacheHit: currentlyLoaded?.id === model.id,
          });
        }
      }
    }

    // ── 3. Session stickiness — keep current session's model ───────────────
    // If the session is valid AND the session's model can handle this task,
    // reuse it. This is the KEY optimization: no re-evaluation, no reload.
    // The model stays loaded across messages in the same session.
    if (this._session && sessionValid && this._session.modelId) {
      const sessionModel = getModel(this._session.modelId);
      if (sessionModel && sessionModel.fileExists) {
        const canHandle = this.modelCanHandleTask(sessionModel, category);
        // Only switch if the current session model CANNOT handle the task,
        // OR if the task tier escalated to 'complex' and the session model
        // is small (need a bigger model for complex reasoning).
        const needsBiggerModel = taskTier === 'complex' &&
          modelSizeTier(sessionModel) === 'small' &&
          category === 'reasoning';

        if (canHandle && !needsBiggerModel) {
          return this.buildVerdict({
            model: sessionModel,
            currentlyLoaded,
            taskTier,
            category,
            sessionCategory,
            suggestedContextSize,
            suggestedGpuLayers,
            source: 'session-sticky',
            reason: `Session sticky: ${sessionModel.name} (session: ${this._session.category}, msg #${this._session.messageCount})`,
            cacheHit: currentlyLoaded?.id === sessionModel.id,
          });
        }
      }
    }

    // ── 4. Auto-router — pick best model for the task tier ─────────────────
    const selected = this.selectModelForTier(allModels, taskTier, category);
    if (selected) {
      // Update session
      this._session = {
        category: sessionCategory,
        modelId: selected.id,
        startedAt: now,
        lastActivityAt: now,
        messageCount: 1,
      };

      return this.buildVerdict({
        model: selected,
        currentlyLoaded,
        taskTier,
        category,
        sessionCategory,
        suggestedContextSize,
        suggestedGpuLayers,
        source: 'auto-router',
        reason: `Auto-router: ${selected.name} (tier: ${taskTier}, category: ${category})`,
        cacheHit: currentlyLoaded?.id === selected.id,
      });
    }

    // ── 5. Default fallback (most-recently-used) ───────────────────────────
    const defaultModel = allModels.sort((a, b) => {
      const aT = a.lastUsedAt || a.addedAt;
      const bT = b.lastUsedAt || b.addedAt;
      return bT - aT;
    })[0];

    if (defaultModel) {
      return this.buildVerdict({
        model: defaultModel,
        currentlyLoaded,
        taskTier,
        category,
        sessionCategory,
        suggestedContextSize,
        suggestedGpuLayers,
        source: 'default',
        reason: `Default (most-recently-used): ${defaultModel.name}`,
        cacheHit: currentlyLoaded?.id === defaultModel.id,
      });
    }

    // No models available
    return {
      model: null,
      alreadyLoaded: false,
      needsSwitch: false,
      taskTier,
      category,
      sessionCategory,
      suggestedContextSize,
      suggestedGpuLayers,
      reason: 'No models installed',
      source: 'none',
      cacheHit: false,
      loadTime: 0,
    };
  }

  /**
   * Select the best model for a task tier + category.
   *
   * Tier-based selection:
   *   - simple  → small model (0.5B) ONLY for greetings; otherwise medium (8B)
   *   - medium  → medium model (7B-8B) — DEFAULT
   *   - complex → large model (30B) ONLY for architecture/deep reasoning;
   *               otherwise medium (8B)
   *
   * This ensures:
   *   - Default quality is 8B (not 0.5B)
   *   - 30B is only used for truly complex tasks
   *   - 0.5B is only for very simple greetings
   */
  private selectModelForTier(
    models: LocalModelInfo[],
    tier: TaskTier,
    category: string,
  ): LocalModelInfo | null {
    if (models.length === 0) return null;

    // Classify models by size tier
    const small = models.filter((m) => modelSizeTier(m) === 'small');
    const medium = models.filter((m) => modelSizeTier(m) === 'medium');
    const large = models.filter((m) => modelSizeTier(m) === 'large');

    // Helper: pick best model from a list (prefer matching category, then most recent)
    const pickBest = (list: LocalModelInfo[]): LocalModelInfo | null => {
      if (list.length === 0) return null;
      // Prefer models whose category matches the task
      const categoryMatch = list.filter((m) =>
        (category === 'coding' && (m.category === 'coding' || m.category === 'general')) ||
        (category === 'reasoning' && (m.category === 'reasoning' || m.category === 'general')) ||
        (category === 'chat' && (m.category === 'general' || m.category === 'fast'))
      );
      const pool = categoryMatch.length > 0 ? categoryMatch : list;
      // Sort by lastUsedAt desc (most recent first)
      return [...pool].sort((a, b) => {
        const aT = a.lastUsedAt || a.addedAt;
        const bT = b.lastUsedAt || b.addedAt;
        return bT - aT;
      })[0];
    };

    switch (tier) {
      case 'simple': {
        // For greetings (≤3 words), use small model if available.
        // For other simple tasks, use medium (quality > speed for short answers).
        const isGreeting = this.isGreeting(this._lastUserMessage || '');
        if (isGreeting && small.length > 0) {
          return pickBest(small);
        }
        // Default to medium for simple non-greeting tasks
        return pickBest(medium) || pickBest(small) || pickBest(large);
      }
      case 'medium': {
        // Default: medium model (8B) — good quality for chat + coding
        return pickBest(medium) || pickBest(small) || pickBest(large);
      }
      case 'complex': {
        // 30B ONLY for architecture/deep reasoning.
        // For regular complex coding, use medium (8B) — it's capable enough.
        const isDeepReasoning = this.isDeepReasoning(this._lastUserMessage || '');
        if (isDeepReasoning && large.length > 0) {
          return pickBest(large);
        }
        // Default to medium for complex coding tasks
        return pickBest(medium) || pickBest(large) || pickBest(small);
      }
    }
  }

  /** Track the last user message for greeting/reasoning detection. */
  private _lastUserMessage: string = '';

  /**
   * Check if a message is a greeting (≤3 words, greeting keywords).
   */
  isGreeting(text: string): boolean {
    const lower = text.toLowerCase().trim();
    const words = lower.split(/\s+/).filter(Boolean);
    if (words.length > 4) return false;
    const greetings = [
      'hello', 'hi', 'hey', 'salam', 'سلام', 'hey nex', 'hello nex',
      'good morning', 'good evening', 'how are you', 'چطوری', 'خوبی',
    ];
    return greetings.some((g) => lower.includes(g));
  }

  /**
   * Check if a message requires deep reasoning (30B model).
   * Only architecture, system design, deep analysis, multi-step planning.
   */
  isDeepReasoning(text: string): boolean {
    const lower = text.toLowerCase();
    const deepKeywords = [
      'architect', 'system design', 'design a', 'design the',
      'deep analysis', 'analyze the architecture', 'multi-step plan',
      'strategic', 'refactor the entire', 'optimize the architecture',
      'compare architectures', 'trade-offs', 'feasibility study',
      'معماری', 'طراحی سیستم', 'تحلیل عمیق', 'بررسی معماری',
    ];
    return deepKeywords.some((kw) => lower.includes(kw));
  }

  /**
   * Classify the task tier: simple / medium / complex.
   */
  classifyTaskTier(text: string): TaskTier {
    this._lastUserMessage = text;
    const lower = text.toLowerCase();
    const words = text.trim().split(/\s+/).filter(Boolean).length;

    // Complex keywords (reasoning/architecture/multi-step)
    const complexKeywords = [
      'architect', 'design', 'analyz', 'reason', 'explain why', 'plan',
      'strategy', 'refactor', 'optimi', 'debug', 'investigate', 'compare',
      'استدلال', 'تحلیل', 'طراحی', 'معماری', 'بررسی', 'مقایسه',
    ];
    if (complexKeywords.some((kw) => lower.includes(kw))) return 'complex';
    if (words > 50) return 'complex';

    // Medium keywords (coding/general)
    const mediumKeywords = [
      'code', 'function', 'bug', 'fix', 'implement', 'write', 'create',
      'build', 'script', 'component', 'api', 'test', 'error',
      'کد', 'تابع', 'برنامه', 'خطا', 'بنویس', 'ساز',
    ];
    if (mediumKeywords.some((kw) => lower.includes(kw))) return 'medium';
    if (words >= 8 && words <= 50) return 'medium';

    // Simple: short greeting, quick question
    return 'simple';
  }

  /**
   * Classify the task category: chat / coding / reasoning / vision / voice.
   */
  classifyCategory(text: string): string {
    const lower = text.toLowerCase();
    if (/code|function|bug|fix|implement|build|script|component|api|test|کد|تابع|برنامه/.test(lower)) return 'coding';
    if (/architect|design|analyz|reason|plan|strategy|refactor|optimi|استدلال|تحلیل|طراحی|معماری/.test(lower)) return 'reasoning';
    if (/image|picture|photo|screenshot|تصویر|عکس/.test(lower)) return 'vision';
    return 'chat';
  }

  /**
   * Suggest a context size based on task tier + GPU availability.
   *
   * Phase 116 FIX: Previously returned 1024, which was too small. With
   * maxTokens=1024 (reserved for generation), only ~0 tokens remained for
   * system prompt + history — causing "Failed to compress chat history"
   * errors on the very first message.
   *
   * Qwen3-8B supports up to 32768 context. With Vulkan GPU offload on 8GB
   * VRAM, 4096 is safe and gives ample room for system prompt (~180 tokens)
   * + history + generation. The context auto-fit in inference.ts will shrink
   * this if VRAM is insufficient.
   */
  suggestContextSize(tier: TaskTier, hasGpu: boolean): number {
    if (!hasGpu) {
      // CPU-only: smaller context to keep RAM usage reasonable
      return tier === 'simple' ? 2048 : 4096;
    }
    // GPU: 4096 is safe for 8GB+ VRAM with 8B Q4 models
    return 4096;
  }

  /**
   * Check if a model can handle a given task category.
   */
  modelCanHandleTask(model: LocalModelInfo, category: string): boolean {
    if (category === 'vision') {
      return model.capabilities?.includes('vision') || model.category === 'vision';
    }
    if (category === 'coding') {
      return model.capabilities?.includes('coding') ||
        model.category === 'coding' ||
        model.category === 'general' ||
        model.category === 'reasoning';
    }
    if (category === 'reasoning') {
      return model.capabilities?.includes('reasoning') ||
        model.category === 'reasoning' ||
        model.category === 'general';
    }
    return true;
  }

  /**
   * Read the pinned model ID from persisted settings.
   */
  getPinnedModelId(): string | null {
    try {
      const state = loadState();
      const settings = (state as any).settings || {};
      return (settings as any).activeLocalModelId || null;
    } catch {
      return null;
    }
  }

  /**
   * Reset the current session (forces re-evaluation on next message).
   */
  resetSession(): void {
    this._session = null;
    console.log('[MODEL_ROUTER] Session reset');
  }

  /**
   * Get the current session state (for diagnostics).
   */
  getSession(): SessionState | null {
    return this._session ? { ...this._session } : null;
  }

  /**
   * Build a verdict with cache-hit + load-time diagnostics.
   */
  private buildVerdict(args: {
    model: LocalModelInfo;
    currentlyLoaded: LocalModelInfo | null;
    taskTier: TaskTier;
    category: string;
    sessionCategory: SessionCategory;
    suggestedContextSize: number;
    suggestedGpuLayers: number;
    source: ModelRouterVerdict['source'];
    reason: string;
    cacheHit: boolean;
  }): ModelRouterVerdict {
    const alreadyLoaded = !!args.currentlyLoaded && args.currentlyLoaded.id === args.model.id;
    const needsSwitch = !alreadyLoaded;
    const loadTime = needsSwitch ? estimateLoadTime(args.model) : 0;

    // Log the [MODEL_ROUTER] diagnostic block
    console.log(`[MODEL_ROUTER]`);
    console.log(`  task=${args.category}/${args.taskTier}`);
    console.log(`  selectedModel=${args.model.name} (${args.model.parameterCount || '?'})`);
    console.log(`  switchRequired=${needsSwitch}`);
    console.log(`  reason=${args.reason}`);
    console.log(`  cacheHit=${args.cacheHit}`);
    console.log(`  loadTime=${loadTime}ms (estimated)`);
    console.log(`  source=${args.source}`);

    return {
      model: args.model,
      alreadyLoaded,
      needsSwitch,
      taskTier: args.taskTier,
      category: args.category,
      sessionCategory: args.sessionCategory,
      suggestedContextSize: args.suggestedContextSize,
      suggestedGpuLayers: args.suggestedGpuLayers,
      source: args.source,
      reason: args.reason,
      cacheHit: args.cacheHit,
      loadTime,
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _modelRouter: ModelRouter | null = null;

export function getModelRouter(): ModelRouter {
  if (!_modelRouter) {
    _modelRouter = new ModelRouter();
  }
  return _modelRouter;
}

export function _resetModelRouter(): void {
  _modelRouter = null;
}
