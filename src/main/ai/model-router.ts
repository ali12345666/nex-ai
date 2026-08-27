/**
 * NEX AI — Model Router Layer
 *
 * The single entry point for model selection on the chat path. Sits between
 * the IPC handler (ai-chat-stream) and inference.ts loadModel().
 *
 * Responsibilities:
 *   1. Task classification: simple chat → small model, coding → medium,
 *      complex reasoning → large model.
 *   2. Priority: user-selected (pinned) model > automatic routing > default.
 *   3. Model cache awareness: if the selected model is ALREADY loaded,
 *      skip the reload entirely (no unload/reload churn).
 *   4. VRAM awareness: if VRAM is under pressure, reduce contextSize.
 *   5. Ensure gpuLayers=-1 (auto) for ALL local GGUF models when a Vulkan
 *      GPU exists (never gpuLayers=0 for local models).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  ModelRouter (this file)                                    │
 *   │    routeForChat(messages, opts) → RouterVerdict             │
 *   │    decideNeedsSwitch(loadedId, verdict) → boolean           │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  SmartModelRouter (existing, model-intelligence/)           │
 *   │    classifyRequest + estimateComplexity + selectModel       │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  Model Registry (model-registry.ts)                         │
 *   │    listModels + getModel + activeLocalModelId               │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  inference.ts                                               │
 *   │    loadModel (idempotent — reuses if same id + not disposed)│
 *   └──────────────────────────────────────────────────────────────┘
 *
 * ════════════════════════════════════════════════════════════════════════════
 * DESIGN PRINCIPLES
 * ════════════════════════════════════════════════════════════════════════════
 * - NEVER unload the current model immediately. If the router picks the same
 *   model that's already loaded, inference.ts loadModel() will short-circuit
 *   (idempotent check). If it picks a DIFFERENT model, the caller decides
 *   whether to switch (pay the load cost) or keep the current one.
 * - User-pinned model (settings.activeLocalModelId) has HIGHEST priority.
 *   If the user explicitly selected a model, the router will NOT override it
 *   unless the task requires a capability the pinned model lacks (e.g. vision).
 * - In 'auto' mode, the router picks the SMALLEST capable model to minimize
 *   latency. Simple chat → 0.5B, coding → 7B, complex reasoning → 30B.
 * - VRAM pressure: if the selected model is large and VRAM is low, the router
 *   suggests a smaller contextSize. inference.ts will also auto-fallback.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { listModels, getModel, type LocalModelInfo } from './model-registry';
import { getSmartModelRouter, type RouterRequest, type RouterDecision } from './model-intelligence/smart-model-router';
import { getGpuBackend, getLoadedModel } from './inference';
import { loadState } from '../persistence';

// ─── Types ─────────────────────────────────────────────────────────────────

export type TaskTier = 'simple' | 'medium' | 'complex';

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
  /** Suggested contextSize (VRAM-aware). */
  suggestedContextSize: number;
  /** Suggested gpuLayers (always -1 for local GGUF with Vulkan). */
  suggestedGpuLayers: number;
  /** Reason for the selection (for diagnostics). */
  reason: string;
  /** Source of the decision: user-pinned / override / auto-router / default. */
  source: 'user-pinned' | 'override' | 'auto-router' | 'default' | 'none';
  /** The underlying SmartModelRouter decision (if auto mode). */
  routerDecision?: RouterDecision;
}

// ─── Model Router ──────────────────────────────────────────────────────────

/**
 * The Model Router. Singleton.
 *
 * Call `routeForChat()` before invoking inference.ts loadModel/chatStream.
 * The verdict tells you which model to use and whether a switch is needed.
 */
export class ModelRouter {
  /**
   * Route a chat request to the best model.
   *
   * Priority chain:
   *   1. Per-request override (config.localModelId) — if set, use it.
   *   2. User-pinned model (settings.activeLocalModelId) — if set, use it
   *      UNLESS the task needs a capability the pinned model lacks.
   *   3. Auto-router (SmartModelRouter) — classify task + pick smallest capable.
   *   4. Default (most-recently-used) — fallback.
   */
  routeForChat(request: ModelRouterRequest): ModelRouterVerdict {
    const allModels = listModels().filter((m) => m.fileExists);
    const currentlyLoaded = getLoadedModel();
    const gpuBackend = getGpuBackend();
    const hasGpu = gpuBackend === 'vulkan' || gpuBackend === 'cuda' || gpuBackend === 'metal';

    // Classify the task
    const taskTier = this.classifyTaskTier(request.userMessage);
    const category = this.classifyCategory(request.userMessage);
    const suggestedContextSize = this.suggestContextSize(taskTier, hasGpu);
    // gpuLayers: ALWAYS -1 (auto) for local GGUF models when a GPU exists.
    // Never gpuLayers=0 (CPU only) for local models — that disables GPU offload.
    const suggestedGpuLayers = hasGpu ? -1 : 0;

    // ── 1. Per-request override ────────────────────────────────────────────
    if (request.modelIdOverride) {
      const model = getModel(request.modelIdOverride);
      if (model && model.fileExists) {
        return this.buildVerdict({
          model,
          currentlyLoaded,
          taskTier,
          category,
          suggestedContextSize,
          suggestedGpuLayers,
          source: 'override',
          reason: `Per-request override: ${model.name}`,
        });
      }
    }

    // ── 2. User-pinned model ───────────────────────────────────────────────
    const pinnedId = this.getPinnedModelId();
    if (pinnedId && request.hasPinnedModel !== false) {
      const model = getModel(pinnedId);
      if (model && model.fileExists) {
        // Check if the pinned model can handle the task category.
        // If the task is vision and the model lacks vision capability, fall
        // through to auto-router. Otherwise, honor the pin.
        const canHandle = this.modelCanHandleTask(model, category);
        if (canHandle) {
          return this.buildVerdict({
            model,
            currentlyLoaded,
            taskTier,
            category,
            suggestedContextSize,
            suggestedGpuLayers,
            source: 'user-pinned',
            reason: `User-pinned model: ${model.name} (task: ${category}/${taskTier})`,
          });
        }
        console.log(`[MODEL_ROUTER] Pinned model ${model.name} can't handle ${category} — falling through to auto-router`);
      }
    }

    // ── 3. Auto-router (SmartModelRouter) ──────────────────────────────────
    if (allModels.length > 0) {
      const routerRequest: RouterRequest = {
        request: request.userMessage,
        hasImage: false,
        hasAudio: false,
      };
      const routerDecision = getSmartModelRouter().selectModel(routerRequest);
      if (routerDecision.selectedModel) {
        return this.buildVerdict({
          model: routerDecision.selectedModel,
          currentlyLoaded,
          taskTier,
          category: routerDecision.category,
          suggestedContextSize,
          suggestedGpuLayers,
          source: 'auto-router',
          reason: routerDecision.reason,
          routerDecision,
        });
      }
    }

    // ── 4. Default fallback (most-recently-used) ───────────────────────────
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
        suggestedContextSize,
        suggestedGpuLayers,
        source: 'default',
        reason: `Default (most-recently-used): ${defaultModel.name}`,
      });
    }

    // No models available
    return {
      model: null,
      alreadyLoaded: false,
      needsSwitch: false,
      taskTier,
      category,
      suggestedContextSize,
      suggestedGpuLayers,
      reason: 'No models installed',
      source: 'none',
    };
  }

  /**
   * Classify the task tier: simple / medium / complex.
   *
   *   simple  → short greeting, quick question, ≤8 words, no code/reasoning keywords
   *   medium  → coding task, moderate-length question, general chat
   *   complex → reasoning, analysis, architecture, long prompt (>50 words), multi-step
   */
  classifyTaskTier(text: string): TaskTier {
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
   * VRAM-aware: smaller context for simple tasks, larger for complex.
   */
  suggestContextSize(tier: TaskTier, hasGpu: boolean): number {
    if (!hasGpu) {
      // CPU-only: keep context small to avoid RAM pressure
      return tier === 'simple' ? 512 : 1024;
    }
    // GPU available — but be conservative for large models on 8GB VRAM
    switch (tier) {
      case 'simple': return 1024;
      case 'medium': return 1024;
      case 'complex': return 1024; // inference.ts will auto-fallback if VRAM is insufficient
    }
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
    // chat — any model with 'chat' or 'completion' capability
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
   * Check whether a model switch is needed (different model than loaded).
   */
  private buildVerdict(args: {
    model: LocalModelInfo;
    currentlyLoaded: LocalModelInfo | null;
    taskTier: TaskTier;
    category: string;
    suggestedContextSize: number;
    suggestedGpuLayers: number;
    source: ModelRouterVerdict['source'];
    reason: string;
    routerDecision?: RouterDecision;
  }): ModelRouterVerdict {
    const alreadyLoaded = !!args.currentlyLoaded && args.currentlyLoaded.id === args.model.id;
    return {
      model: args.model,
      alreadyLoaded,
      needsSwitch: !alreadyLoaded,
      taskTier: args.taskTier,
      category: args.category,
      suggestedContextSize: args.suggestedContextSize,
      suggestedGpuLayers: args.suggestedGpuLayers,
      source: args.source,
      reason: args.reason,
      routerDecision: args.routerDecision,
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
