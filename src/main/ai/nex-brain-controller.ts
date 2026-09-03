/**
 * NEX AI — Brain Controller (Phase 51)
 *
 * The central orchestrator that manages multiple models.
 * Decides WHICH model to use for WHICH task — automatically.
 *
 * User does NOT manually select models. NEX Brain decides.
 *
 * Architecture:
 *
 *   User Request
 *       ↓
 *   NEX Brain Controller
 *       ↓
 *   ┌───────────┬───────────┬───────────┬───────────┐
 *   │ Coding    │ Reasoning │ Vision    │ Voice     │
 *   │ Model     │ Model     │ Model     │ Model     │
 *   └───────────┴───────────┴───────────┴───────────┘
 *
 * CRITICAL SECURITY:
 *   Brain can SELECT and RECOMMEND — but NEVER downloads/installs/changes.
 *   All actions still require Phase 43 Permission System.
 */

import { listModels, type LocalModelInfo, type ModelCapability } from './model-registry';
import { getSmartModelRouter, type RouterDecision, type RouterRequest } from './model-intelligence/smart-model-router';
import { getAdvancedCatalog, type AdvancedModelEntry } from './model-intelligence/advanced-model-catalog';
import { getNexIdentityManager, type NexSelfAwareness } from './nex-identity-manager';

export type BrainMode = 'auto' | 'coding' | 'reasoning' | 'vision' | 'voice' | 'chat';

export interface BrainDecision {
  selectedModel: LocalModelInfo | null;
  modelId: string | null;
  modelName: string | null;
  task: string;
  taskFa: string;
  complexity: string;
  reason: string;
  reasonFa: string;
  confidence: number;
  alternatives: LocalModelInfo[];
  brainMode: BrainMode;
}

export interface BrainStatus {
  activeModel: string | null;
  totalModels: number;
  modelsByCategory: Record<string, number>;
  brainMode: BrainMode;
  identity: { name: string; version: string; mission: string };
  capabilities: string[];
  selfAwareness: NexSelfAwareness | null;
}

export class NexBrainController {
  private brainMode: BrainMode = 'auto';
  private lastDecision: BrainDecision | null = null;

  /**
   * Analyze a user request and select the best model.
   * The user does NOT pick models — NEX Brain decides.
   */
  decide(request: RouterRequest): BrainDecision {
    const router = getSmartModelRouter();

    // If auto mode, use the smart router
    if (this.brainMode === 'auto') {
      const decision = router.selectModel(request);

      const taskFa = this.translateTask(decision.category);
      const reasonFa = this.translateReason(decision);

      const result: BrainDecision = {
        selectedModel: decision.selectedModel,
        modelId: decision.selectedModel?.id || null,
        modelName: decision.selectedModel?.name || null,
        task: decision.category,
        taskFa,
        complexity: decision.complexity,
        reason: decision.reason,
        reasonFa,
        confidence: decision.confidence,
        alternatives: decision.alternatives,
        brainMode: this.brainMode,
      };

      this.lastDecision = result;
      return result;
    }

    // Manual mode: user forced a specific category
    const models = listModels().filter((m) => m.fileExists);
    const category = this.brainMode === 'chat' ? 'general' : this.brainMode;
    let candidates = models.filter((m) => m.category === category);
    if (candidates.length === 0) {
      candidates = models; // fallback to all
    }

    // Sort by recency
    candidates.sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
    const selected = candidates[0] || null;

    const result: BrainDecision = {
      selectedModel: selected,
      modelId: selected?.id || null,
      modelName: selected?.name || null,
      task: this.brainMode,
      taskFa: this.translateTask(this.brainMode as any),
      complexity: 'moderate',
      reason: `Manual mode: ${this.brainMode}`,
      reasonFa: `حالت دستی: ${this.translateTask(this.brainMode as any)}`,
      confidence: selected ? 0.7 : 0,
      alternatives: candidates.slice(1, 4),
      brainMode: this.brainMode,
    };

    this.lastDecision = result;
    return result;
  }

  /**
   * Get the current brain status (for UI / Command Center).
   */
  async getStatus(): Promise<BrainStatus> {
    const models = listModels().filter((m) => m.fileExists);
    const modelsByCategory: Record<string, number> = {};
    for (const m of models) {
      const cat = m.category || 'general';
      modelsByCategory[cat] = (modelsByCategory[cat] || 0) + 1;
    }

    const identity = getNexIdentityManager();
    let selfAwareness: NexSelfAwareness | null = null;
    try {
      selfAwareness = await identity.getSelfAwareness();
    } catch { /* */ }

    const capabilities = selfAwareness?.capabilities || ['chat'];

    return {
      activeModel: this.lastDecision?.modelName || (models.length > 0 ? models[0].name : null),
      totalModels: models.length,
      modelsByCategory,
      brainMode: this.brainMode,
      identity: {
        name: identity.getIdentity().name,
        version: identity.getIdentity().version,
        mission: identity.getIdentity().mission,
      },
      capabilities,
      selfAwareness,
    };
  }

  /**
   * Set the brain mode (auto = NEX decides, or force a specific category).
   */
  setMode(mode: BrainMode): void {
    this.brainMode = mode;
  }

  getMode(): BrainMode {
    return this.brainMode;
  }

  getLastDecision(): BrainDecision | null {
    return this.lastDecision;
  }

  /**
   * Get available models grouped by task category.
   */
  getModelsByTask(): Record<string, LocalModelInfo[]> {
    const models = listModels().filter((m: LocalModelInfo) => m.fileExists);
    const byTask: Record<string, LocalModelInfo[]> = {
      coding: models.filter((m: LocalModelInfo) => (m.capabilities || []).includes('coding') || m.category === 'coding'),
      reasoning: models.filter((m: LocalModelInfo) => (m.capabilities || []).includes('reasoning') || m.category === 'reasoning'),
      vision: models.filter((m: LocalModelInfo) => m.category === 'vision'),
      voice: models.filter((m: LocalModelInfo) => m.category === 'speech'),
      chat: models.filter((m: LocalModelInfo) => m.category === 'general' || m.category === 'coding'),
      embedding: models.filter((m: LocalModelInfo) => m.category === 'embedding'),
    };
    return byTask;
  }

  /**
   * Translate task category to Persian.
   */
  private translateTask(category: string): string {
    const map: Record<string, string> = {
      coding: 'برنامه‌نویسی',
      reasoning: 'استدلال',
      vision: 'بینایی',
      voice: 'صدا',
      chat: 'گفتگو',
      embedding: 'جستجوی معنایی',
      unknown: 'عمومی',
    };
    return map[category] || 'عمومی';
  }

  /**
   * Generate a Persian reason for the model selection.
   */
  private translateReason(decision: RouterDecision): string {
    const parts: string[] = [];
    if (decision.selectedModel) {
      parts.push(`مدل انتخاب شده: ${decision.selectedModel.name}`);
    }
    parts.push(`نوع وظیفه: ${this.translateTask(decision.category)}`);
    parts.push(`پیچیدگی: ${decision.complexity === 'simple' ? 'ساده' : decision.complexity === 'complex' ? 'پیچیده' : 'متوسط'}`);
    if (decision.confidence > 0.8) {
      parts.push('اطمینان بالا');
    } else if (decision.confidence > 0.5) {
      parts.push('اطمینان متوسط');
    } else {
      parts.push('اطمینان پایین');
    }
    return parts.join('، ');
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _brain: NexBrainController | null = null;

export function getNexBrainController(): NexBrainController {
  if (!_brain) {
    _brain = new NexBrainController();
  }
  return _brain;
}
