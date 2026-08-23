/**
 * NEX AI — Knowledge project-id helper (Phase 9 / P9-S5)
 *
 * Derives a stable, filesystem-safe knowledge projectId from a project
 * path — used by the main.ts composition root when wiring KnowledgeService
 * instances and the agent's KnowledgePort.
 *
 * Pure module (crypto only).
 */

import * as crypto from 'crypto';

/** Stable projectId for a project path (same path → same id, forever). */
export function projectIdFromPath(projectPath: string): string {
  const norm = projectPath.split(/[\\/]+/).filter(Boolean).join('/');
  const h = crypto.createHash('sha1').update(norm).digest('hex');
  return `prj_${h.slice(0, 16)}`;
}
