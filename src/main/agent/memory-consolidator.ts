/**
 * NEX AI — Memory Consolidator (Phase 13 / P13-A)
 *
 * The WRITE path that was missing: after an agent task completes, distill
 * durable memories so future tasks on the same project/user get smarter.
 *
 *   task summary      → ProjectMemory (per-project decisions/outcomes)
 *   user corrections  → UserMemory    (preferences learned from usage)
 *   task facts        → TaskMemory    (cross-referenced short history)
 *   volatile details  → SessionMemory (expires, never durable)
 *
 * Rules:
 *  - Consolidation NEVER throws into the task path (best-effort, errors logged).
 *  - Dedup: same key + same normalized value → updatedAt bump only.
 *  - Cap: bounded writes per consolidation (no memory explosion).
 *  - Redaction: values pass through AgentLogger's redactSecrets — secrets
 *    never land in memory stores.
 *  - Pure-ish module: injected clock + memory API for tests; the real
 *    wiring in agent/core calls consolidate() at task completion.
 */

import { redactSecrets } from '../agent/logger';

/** Duck-typed memory API (matches memory/index exports; injected for tests). */
export interface MemoryApi {
  set(store: 'user' | 'project' | 'task' | 'knowledge' | 'session', key: string, value: any, opts?: { tags?: string[]; expiresAt?: number; projectId?: string }): unknown;
  get(store: 'user' | 'project' | 'task' | 'knowledge' | 'session', key: string, projectId?: string): { value: any; updatedAt: number } | null;
  list(store: 'user' | 'project' | 'task' | 'knowledge' | 'session', projectId?: string): Array<{ key: string; value: any; updatedAt: number; tags?: string[] }>;
}

/** Facts distilled from a finished agent task (derived by the caller). */
export interface TaskOutcome {
  taskId: string;
  projectId?: string;
  userRequest: string;
  intent?: string;
  success: boolean;
  stepsCompleted: number;
  toolsUsed: string[];
  filesTouched: string[];
  lessonsLearned?: string[];   // extracted by the planner/verification, optional
  userCorrections?: string[]; // e.g. rejections/edits the user made
}

export interface ConsolidationResult {
  written: Array<{ store: string; key: string }>;
  skippedDuplicates: number;
  redactedCount: number;
  errors: string[];
}

const MAX_WRITES = 12;

function sanitize(text: string): { clean: string; redacted: boolean } {
  const { redacted, redactions } = redactSecrets(text);
  return { clean: redacted.slice(0, 800), redacted: redactions.length > 0 };
}

function keyFor(prefix: string, taskId: string, n = 0): string {
  return n === 0 ? `${prefix}:${taskId}` : `${prefix}:${taskId}:${n}`;
}

/**
 * Consolidate a finished task into memory stores.
 * Best-effort: every write is individually guarded; result reports errors.
 */
export function consolidateTaskMemory(
  outcome: TaskOutcome,
  memory: MemoryApi,
  opts: { now?: () => number } = {}
): ConsolidationResult {
  const now = opts.now ?? Date.now;
  const result: ConsolidationResult = { written: [], skippedDuplicates: 0, redactedCount: 0, errors: [] };

  const safeSet = (store: Parameters<MemoryApi['set']>[0], key: string, value: unknown, setOpts?: { tags?: string[]; expiresAt?: number; projectId?: string }) => {
    if (result.written.length + result.skippedDuplicates >= MAX_WRITES) return;
    try {
      // dedup by key+value across stores (per-store get)
      const existing = memory.get(store, key, setOpts?.projectId);
      if (existing && JSON.stringify(existing.value) === JSON.stringify(value)) {
        memory.set(store, key, value, { ...setOpts }); // bump updatedAt
        result.skippedDuplicates++;
        return;
      }
      memory.set(store, key, value, setOpts);
      result.written.push({ store, key });
    } catch (err: any) {
      result.errors.push(`${store}/${key}: ${err.message}`);
    }
  };

  // 1) Task record (TaskMemory) — short durable history
  const taskSummary = sanitize(
    `[${outcome.success ? 'OK' : 'FAIL'}] ${outcome.userRequest.slice(0, 120)} → ${outcome.stepsCompleted} steps, tools: ${outcome.toolsUsed.slice(0, 5).join(',') || 'none'}`
  );
  if (taskSummary.redacted) result.redactedCount++;
  safeSet('task', keyFor('task', outcome.taskId), {
    summary: taskSummary.clean,
    intent: outcome.intent,
    success: outcome.success,
    files: outcome.filesTouched.slice(0, 10),
    at: now(),
  }, { tags: ['agent', outcome.success ? 'ok' : 'fail'], projectId: outcome.projectId });

  // 2) Project memory — durable conventions/decisions (only on success + lessons)
  if (outcome.projectId && outcome.success && outcome.lessonsLearned && outcome.lessonsLearned.length > 0) {
    outcome.lessonsLearned.slice(0, 4).forEach((lesson, i) => {
      const l = sanitize(lesson);
      if (l.redacted) result.redactedCount++;
      if (l.clean.trim().length < 8) return; // skip noise
      safeSet('project', keyFor('lesson', outcome.taskId, i + 1), l.clean, {
        tags: ['agent-lesson', outcome.intent || 'general'],
        projectId: outcome.projectId,
      });
    });
  }

  // 3) User memory — corrections become preferences (durable)
  if (outcome.userCorrections && outcome.userCorrections.length > 0) {
    outcome.userCorrections.slice(0, 3).forEach((corr, i) => {
      const c = sanitize(corr);
      if (c.redacted) result.redactedCount++;
      if (c.clean.trim().length < 6) return;
      safeSet('user', keyFor('pref', outcome.taskId, i + 1), c.clean, {
        tags: ['agent-correction'],
      });
    });
  }

  // 4) Session memory — volatile telemetry (expires in 24h)
  safeSet('session', keyFor('session', outcome.taskId), {
    toolsUsed: outcome.toolsUsed,
    filesTouched: outcome.filesTouched.slice(0, 10),
  }, { tags: ['volatile'], expiresAt: now() + 24 * 60 * 60 * 1000 });

  return result;
}

/**
 * Retrieval helper for the context manager: top-N relevant memories across
 * stores for a query (cheap tag/substring scoring — memory is small; no
 * embeddings needed at this layer).
 */
export function recallRelevantMemories(
  memory: MemoryApi,
  query: string,
  projectId?: string,
  limit = 6
): Array<{ store: string; key: string; value: any; score: number }> {
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
  const hits: Array<{ store: string; key: string; value: any; score: number }> = [];
  const stores: Parameters<MemoryApi['list']>[0][] = ['user', 'project', 'task', 'session'];
  for (const store of stores) {
    let entries: ReturnType<MemoryApi['list']> = [];
    try { entries = memory.list(store, store === 'project' ? projectId : undefined); } catch { continue; }
    for (const e of entries) {
      const hay = `${e.key} ${JSON.stringify(e.value)}`.toLowerCase();
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score += 2;
      if ((e.tags || []).some((tg) => terms.some((t) => tg.toLowerCase().includes(t)))) score += 1;
      if (score > 0) hits.push({ store, key: e.key, value: e.value, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
