/**
 * NEX AI — Model Selector
 *
 * Picks the best local model for a given task based on:
 *  - Required capability (chat, coding, reasoning, vision, embedding)
 *  - Available models in the registry
 *  - Model freshness (lastUsedAt)
 *
 * If no model matches the requested capability, falls back to the default
 * (most recently used chat-capable model).
 *
 * Phase 7 (current): All models are 'chat'-capable GGUF text models.
 * Phase 20+ will add vision, embedding, speech models.
 */

import { listModels, getDefaultModel, type LocalModelInfo, type ModelCapability } from '../ai/model-registry';

export interface ModelSelectionCriteria {
  capability?: ModelCapability;
  category?: 'general' | 'coding' | 'reasoning' | 'fast' | 'vision' | 'embedding' | 'reranker' | 'speech' | 'image';
  // Preferred parameter count (e.g. prefer smaller for fast iteration)
  preferSmaller?: boolean;
  // Project context (for future project-specific model selection)
  projectId?: string;
}

export interface ModelSelectionResult {
  model: LocalModelInfo | null;
  selectionReason: string;
  alternatives: LocalModelInfo[];
}

/**
 * Select the best model for a task.
 */
export function selectModel(criteria: ModelSelectionCriteria = {}): ModelSelectionResult {
  const all = listModels().filter((m) => m.fileExists);
  if (all.length === 0) {
    return {
      model: null,
      selectionReason: 'No local models registered. Add a .gguf file in Models panel.',
      alternatives: [],
    };
  }

  // Filter by capability if specified
  let candidates = all;
  if (criteria.capability) {
    const filtered = all.filter((m) =>
      (m.capabilities || []).includes(criteria.capability!)
    );
    if (filtered.length > 0) {
      candidates = filtered;
    }
    // If no model has the requested capability, fall back to all models
    // (a chat model can often handle other text tasks reasonably well)
  }

  // Filter by category if specified
  if (criteria.category) {
    const filtered = candidates.filter((m) => m.category === criteria.category);
    if (filtered.length > 0) {
      candidates = filtered;
    }
  }

  // Sort by preference
  if (criteria.preferSmaller) {
    candidates.sort((a, b) => a.sizeBytes - b.sizeBytes);
  } else {
    // Sort by lastUsedAt desc (most recently used first)
    candidates.sort((a, b) => {
      const aT = a.lastUsedAt || a.addedAt;
      const bT = b.lastUsedAt || b.addedAt;
      return bT - aT;
    });
  }

  const selected = candidates[0] || getDefaultModel();
  const reason = criteria.capability
    ? `Selected ${selected?.name} for ${criteria.capability} task`
    : criteria.category
    ? `Selected ${selected?.name} (${criteria.category} category)`
    : `Selected default model: ${selected?.name}`;

  return {
    model: selected,
    selectionReason: reason,
    alternatives: candidates.slice(1, 4),
  };
}

/**
 * Quick helper: pick the best model for a coding task.
 */
export function selectCodingModel(): LocalModelInfo | null {
  return selectModel({ capability: 'coding', category: 'coding' }).model
      || selectModel({ capability: 'chat' }).model;
}

/**
 * Quick helper: pick the best model for general chat.
 */
export function selectChatModel(): LocalModelInfo | null {
  return selectModel({ capability: 'chat' }).model;
}

/**
 * Quick helper: pick the best model for reasoning tasks.
 */
export function selectReasoningModel(): LocalModelInfo | null {
  return selectModel({ capability: 'reasoning', category: 'reasoning' }).model
      || selectModel({ capability: 'chat' }).model;
}
