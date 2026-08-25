/**
 * NEX AI — Smart Model Router (Phase 45)
 *
 * Before each AI task, analyzes the task type + complexity + available models
 * + hardware, and selects the best model for the job.
 *
 * This does NOT switch models autonomously — it returns a recommendation
 * that the caller (agent core) uses. If no better model is found, it returns
 * the default (current) model.
 */

import { listModels, type LocalModelInfo } from '../model-registry';
import { detectHardwareProfile, canModelRunOnHardware, type HardwareProfile } from '../hardware-model-recommender';
import { getUsageAnalyzer } from './usage-analyzer';
import type { TaskCategory } from './usage-analyzer';

// ─── Types ─────────────────────────────────────────────────────────────────

export type TaskComplexity = 'simple' | 'moderate' | 'complex';

export interface RouterRequest {
  /** The user's request text. */
  request: string;
  /** Optional intent hint. */
  intent?: string;
  /** Whether the task involves vision. */
  hasImage?: boolean;
  /** Whether the task involves voice. */
  hasAudio?: boolean;
}

export interface RouterDecision {
  /** The selected model (or null if no models available). */
  selectedModel: LocalModelInfo | null;
  /** Why this model was selected. */
  reason: string;
  /** Confidence 0-1. */
  confidence: number;
  /** Detected task category. */
  category: TaskCategory;
  /** Detected complexity. */
  complexity: TaskComplexity;
  /** Alternative models (if the selected one is busy or fails). */
  alternatives: LocalModelInfo[];
}

// ─── Smart Model Router ────────────────────────────────────────────────────

export class SmartModelRouter {
  /**
   * Select the best model for a given task.
   *
   * Analyzes:
   *   - Task type (coding, chat, reasoning, vision, voice)
   *   - Complexity (simple, moderate, complex)
   *   - Available models in the registry
   *   - Hardware compatibility
   *
   * Returns the selected model + reason + confidence.
   */
  selectModel(request: RouterRequest): RouterDecision {
    const analyzer = getUsageAnalyzer();
    const category = request.intent
      ? this.mapIntentToCategory(request.intent)
      : analyzer.classifyRequest(request.request);

    const complexity = this.estimateComplexity(request.request, category);
    const allModels = listModels().filter((m) => m.fileExists);

    if (allModels.length === 0) {
      return {
        selectedModel: null,
        reason: 'No models installed. Add a .gguf model via Model Manager.',
        confidence: 0,
        category,
        complexity,
        alternatives: [],
      };
    }

    const hw = detectHardwareProfile();

    // Filter by hardware compatibility
    const runnable = allModels.filter((m) => {
      const verdict = canModelRunOnHardware(m, hw);
      return verdict.canRun;
    });

    if (runnable.length === 0) {
      // No model can run on this hardware — return the first anyway
      return {
        selectedModel: allModels[0],
        reason: 'Warning: no model meets hardware requirements, using first available',
        confidence: 0.3,
        category,
        complexity,
        alternatives: [],
      };
    }

    // Filter by category
    let candidates = this.filterByCategory(runnable, category);

    // If no category match, use all runnable models
    if (candidates.length === 0) {
      candidates = runnable;
    }

    // Sort by suitability for the task
    candidates = this.sortBySuitability(candidates, category, complexity);

    const selected = candidates[0];
    const alternatives = candidates.slice(1, 4);

    const reason = this.generateReason(selected, category, complexity);
    const confidence = this.computeConfidence(candidates, category, selected);

    return {
      selectedModel: selected,
      reason,
      confidence,
      category,
      complexity,
      alternatives,
    };
  }

  /**
   * Get the current router status (for UI display).
   */
  getStatus(): {
    totalModels: number;
    runnableModels: number;
    byCategory: Record<string, number>;
    primaryWorkload: TaskCategory;
  } {
    const all = listModels().filter((m) => m.fileExists);
    const hw = detectHardwareProfile();
    const runnable = all.filter((m) => canModelRunOnHardware(m, hw).canRun);
    const usage = getUsageAnalyzer().getStats();

    const byCategory: Record<string, number> = {};
    for (const m of runnable) {
      const cat = m.category || 'general';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }

    return {
      totalModels: all.length,
      runnableModels: runnable.length,
      byCategory,
      primaryWorkload: usage.primaryWorkload,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private mapIntent(intent: string): TaskCategory {
    const lower = intent.toLowerCase();
    if (lower.includes('cod') || lower.includes('fix') || lower.includes('implement')) return 'coding';
    if (lower.includes('reason') || lower.includes('analyz') || lower.includes('design')) return 'reasoning';
    if (lower.includes('imag') || lower.includes('visual') || lower.includes('screen')) return 'vision';
    if (lower.includes('voic') || lower.includes('audio') || lower.includes('speech')) return 'voice';
    return 'chat';
  }

  private mapIntentToCategory(intent: string): TaskCategory {
    return this.mapIntent(intent);
  }

  private estimateComplexity(request: string, category: TaskCategory): TaskComplexity {
    const words = request.split(/\s+/).length;
    if (words < 10) return 'simple';
    if (words > 50 || category === 'reasoning') return 'complex';
    return 'moderate';
  }

  private filterByCategory(models: LocalModelInfo[], category: TaskCategory): LocalModelInfo[] {
    const catMap: Record<TaskCategory, string[]> = {
      coding: ['coding', 'general'],
      reasoning: ['reasoning', 'general'],
      vision: ['vision'],
      voice: ['speech'],
      embedding: ['embedding'],
      chat: ['general', 'coding', 'reasoning'],
      unknown: ['general', 'coding', 'reasoning'],
    };
    const acceptableCats = catMap[category] || ['general'];
    return models.filter((m) => acceptableCats.includes(m.category));
  }

  private sortBySuitability(models: LocalModelInfo[], category: TaskCategory, complexity: TaskComplexity): LocalModelInfo[] {
    return [...models].sort((a, b) => {
      // For complex tasks: prefer larger models
      if (complexity === 'complex') {
        const paramA = parseFloat(a.parameterCount || '0');
        const paramB = parseFloat(b.parameterCount || '0');
        return paramB - paramA;
      }
      // For simple tasks: prefer smaller/faster models
      if (complexity === 'simple') {
        const paramA = parseFloat(a.parameterCount || '0');
        const paramB = parseFloat(b.parameterCount || '0');
        return paramA - paramB;
      }
      // Moderate: prefer most recently used
      const aTime = a.lastUsedAt || 0;
      const bTime = b.lastUsedAt || 0;
      return bTime - aTime;
    });
  }

  private generateReason(model: LocalModelInfo, category: TaskCategory, complexity: TaskComplexity): string {
    const parts: string[] = [];
    parts.push(`Selected ${model.name}`);
    parts.push(`Category: ${category}`);
    parts.push(`Complexity: ${complexity}`);
    if (model.parameterCount) parts.push(`Parameters: ${model.parameterCount}`);
    if (model.quantization) parts.push(`Quantization: ${model.quantization}`);
    return parts.join(', ');
  }

  private computeConfidence(candidates: LocalModelInfo[], category: TaskCategory, selected: LocalModelInfo): number {
    if (candidates.length === 1) return 0.9; // only one option → high confidence
    // Check if selected's category matches the task category
    const catMatch = selected.category === category ||
      (category === 'chat' && (selected.category === 'general' || selected.category === 'coding'));
    return catMatch ? 0.85 : 0.5;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _router: SmartModelRouter | null = null;

export function getSmartModelRouter(): SmartModelRouter {
  if (!_router) {
    _router = new SmartModelRouter();
  }
  return _router;
}
