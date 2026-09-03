/**
 * NEX AI — Model Router (Phase 8 / P8-B)
 *
 * Decides WHERE a task runs: on the local runtime (llama.cpp GGUF) or on the
 * online runtime (provider abstraction → GLM 5.3 by default).
 *
 * ARCHITECTURE RULES (enforced by tests/glm/test-p8b.ts):
 *   1. This module NEVER imports ai/glm, ai-service, or any provider
 *      implementation. Online details arrive via the injected
 *      `OnlineEnvironment` (filled by main-process wiring from settings).
 *   2. Local selection reuses the existing Phase 7 model-selector — we extend
 *      routing, we do not rewrite selection.
 *
 * Routing policy (auto mode):
 *   - complex coding / planning / refactor / long-context → ONLINE
 *     (GLM 5.3-class models are materially better at planning & multi-file edits)
 *   - simple lookups, short chat, offline requirement → LOCAL
 *   - online unavailable (no key / offline) → LOCAL fallback
 *   - local unavailable but online available → ONLINE
 *   - neither → caller must handle null backend (helpful error)
 */

import {
  selectModel, selectCodingModel, selectChatModel,
  type ModelSelectionResult,
} from './model-selector';
import type { LocalModelInfo } from '../ai/model-registry';

export type BackendKind = 'local' | 'online';
export type TaskComplexity = 'simple' | 'moderate' | 'complex';

export interface OnlineEnvironment {
  /** Is an online provider configured AND has an API key? */
  available: boolean;
  /** Display name, e.g. 'GLM 5.3' (injected — this file stays provider-blind) */
  modelName?: string;
  /** Model id, e.g. 'glm-5.3' */
  modelId?: string;
}

export interface RouteCriteria {
  intent?: string;            // 'coding' | 'fix-bug' | 'refactor' | 'chat' | ...
  complexity?: TaskComplexity;
  /** Approximate input size (chars) — long contexts favor online. */
  textLength?: number;
}

export interface RouteDecision {
  backend: BackendKind;
  localModel: LocalModelInfo | null;
  onlineModel: { id: string; name: string } | null;
  reason: string;
  /** Local candidates in case UI wants to offer a switch. */
  alternatives: LocalModelInfo[];
}

/** Explicit user preference, overrides auto heuristics when set. */
export type BackendPreference = 'auto' | 'local-first' | 'online-first';

export interface RouteOptions {
  preference?: BackendPreference;
}

/** Intents that benefit strongly from an online GLM-class model. */
const ONLINE_FAVORED_INTENTS = new Set(['coding', 'fix-bug', 'refactor', 'planning']);

/** Estimate complexity from intent + text size when caller didn't classify. */
export function estimateComplexity(criteria: RouteCriteria): TaskComplexity {
  if (criteria.complexity) return criteria.complexity;
  const len = criteria.textLength || 0;
  if (ONLINE_FAVORED_INTENTS.has(criteria.intent || '')) {
    return len > 400 ? 'complex' : 'moderate';
  }
  return len > 2000 ? 'moderate' : 'simple';
}

/**
 * Route a task to a backend + concrete model.
 */
export function routeModel(
  criteria: RouteCriteria,
  online: OnlineEnvironment,
  localSelection?: ModelSelectionResult,
  opts: RouteOptions = {}
): RouteDecision {
  const complexity = estimateComplexity(criteria);
  const preference = opts.preference || 'auto';

  // Local availability comes from the existing Phase 7 selector.
  const local: ModelSelectionResult =
    localSelection ||
    (ONLINE_FAVORED_INTENTS.has(criteria.intent || '')
      ? selectModel({ capability: 'coding', category: 'coding' })
      : selectModel({ capability: 'chat' }));
  const hasLocal = !!local.model;

  const onlineModel = online.available && online.modelId
    ? { id: online.modelId, name: online.modelName || online.modelId }
    : null;

  // ── Explicit preferences ──
  if (preference === 'online-first' && onlineModel) {
    return decision('online', local, onlineModel, `Preference: online-first → ${onlineModel.name}`);
  }
  if (preference === 'local-first' && hasLocal) {
    return decision('local', local, null, `Preference: local-first → ${local.model!.name}`);
  }

  // ── Auto heuristics ──
  // 1. Nothing available locally → online if possible
  if (!hasLocal) {
    if (onlineModel) {
      return decision('online', local, onlineModel, `No local model registered → online (${onlineModel.name})`);
    }
    return decision('local', local, null, 'No local model and no online provider configured');
  }

  // 2. Complex tasks → online (when available)
  if (complexity === 'complex' && onlineModel) {
    return decision(
      'online', local, onlineModel,
      `Complex ${criteria.intent || 'task'} → ${onlineModel.name} (planning/multi-step quality)`
    );
  }

  // 3. Coding intents of moderate size → online when available
  if (complexity === 'moderate' && ONLINE_FAVORED_INTENTS.has(criteria.intent || '') && onlineModel) {
    return decision('online', local, onlineModel, `Coding task → ${onlineModel.name}`);
  }

  // 4. Everything else → local (fast, private, free)
  return decision('local', local, null, `Simple task → local (${local.model!.name})`);
}

function decision(
  backend: BackendKind,
  local: ModelSelectionResult,
  onlineModel: { id: string; name: string } | null,
  reason: string
): RouteDecision {
  return {
    backend,
    localModel: backend === 'local' ? local.model : local.model, // keep local candidate for fallback/UI
    onlineModel: backend === 'online' ? onlineModel : onlineModel,
    reason,
    alternatives: local.alternatives,
  };
}

/**
 * Convenience for callers that already know the intent is coding.
 */
export function routeCodingTask(
  textLength: number,
  online: OnlineEnvironment,
  opts: RouteOptions = {}
): RouteDecision {
  return routeModel({ intent: 'coding', textLength }, online, undefined, opts);
}

// Re-export for one-stop import by the agent core.
export { selectCodingModel, selectChatModel };
