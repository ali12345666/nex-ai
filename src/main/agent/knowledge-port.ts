/**
 * NEX AI — Knowledge Port (Phase 9 / P9-S4)
 *
 * The ONLY thing Agent Core sees of the RAG subsystem: a narrow, injected
 * port (same dependency-injection pattern as OnlineEnvironment in P8-B).
 *
 *   Agent Core ──(KnowledgePort interface)── injected by main.ts
 *                                          └─▶ KnowledgeService (knowledge/)
 *
 * agent/ NEVER imports knowledge/ — enforced by architecture tests.
 * This keeps the layering required by the project rules:
 *
 *   User → Agent Core → Context Manager → Knowledge (port) → Local Model
 */

import type { ContextKnowledgeItem } from './types';

export interface KnowledgeHit {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  content: string;
  score: number;
  /** e.g. "docs/auth.md" + line range for citations */
  source?: string;
  startLine?: number;
  endLine?: number;
  sectionTitle?: string;
}

/**
 * Injected knowledge retrieval capability. The main-process wiring
 * implements this over KnowledgeService.retrieveForPrompt (project-scoped,
 * citation-carrying, injection-framed). Tests pass fakes.
 */
export interface KnowledgePort {
  /** Is knowledge available for this context (project has indexed docs)? */
  available(projectPath?: string): boolean;

  /** Retrieve top-k relevant chunks for a natural-language query. */
  retrieve(query: string, projectPath?: string, limit?: number): Promise<KnowledgeHit[]>;
}

/** Convert port hits → the agent's existing ContextKnowledgeItem shape. */
export function hitsToContextItems(hits: KnowledgeHit[]): ContextKnowledgeItem[] {
  return hits.map((h) => ({
    documentId: h.documentId,
    documentTitle: h.documentTitle,
    chunkId: h.chunkId,
    content: h.content,
    score: h.score,
    ...(h.startLine !== undefined ? { startLine: h.startLine } : {}),
    ...(h.endLine !== undefined ? { endLine: h.endLine } : {}),
    ...(h.source !== undefined ? { source: h.source } : {}),
    ...(h.sectionTitle !== undefined ? { sectionTitle: h.sectionTitle } : {}),
  } as ContextKnowledgeItem));
}
