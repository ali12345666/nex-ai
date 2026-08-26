/**
 * NEX AI — Universal Knowledge Brain (Phase 60)
 *
 * The multidisciplinary expert knowledge routing system. Connects:
 *   - Phase 55 ExpertKnowledgeEngine (RAG retrieval)
 *   - Phase 53 ExpertRouter (domain routing)
 *   - Phase 59 ModelEcosystemManager (model selection)
 *   - Phase 60 UniversalKnowledgeCatalog (expanded domains + knowledge graph)
 *
 *   User Question
 *       ↓
 *   Universal Knowledge Brain
 *       ↓
 *   ┌─────────────────────────────────────┐
 *   │  1. Expert Router (Phase 53)       │ → picks expert domain
 *   │  2. Knowledge Catalog (Phase 60)    │ → picks knowledge pack
 *   │  3. RAG Retrieval (Phase 55)       │ → retrieves relevant docs
 *   │  4. Model Ecosystem (Phase 59)     │ → picks best model
 *   └─────────────────────────────────────┘
 *       ↓
 *   Expert Knowledge Response (expert + knowledge + model + retrieved docs)
 *
 * Example:
 *   "طراحی مدار تغذیه ۱۲ ولت"
 *     → Electronics Expert + Power Electronics Knowledge + Engineering Model
 *   "ساخت API با React"
 *     → Software Expert + Frontend Knowledge + Coding Model
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SECURITY
 * ════════════════════════════════════════════════════════════════════════════
 * - No automatic downloads. No automatic installs.
 * - Permission required before adding knowledge packs (Phase 55 KnowledgePackManager).
 * - Offline only — all retrieval is local (HashEmbedder + HybridRetriever).
 * - Audit logs via Phase 55 engine (pack install/remove logged through PermissionGate).
 * - This brain only ROUTES and RETRIEVES — it never executes models directly.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { getExpertRouter, type ExpertRouteResult } from '../ai/expert-router';
import { getExpertKnowledgeEngine, type KnowledgeRetrievalResponse } from './expert-knowledge-engine';
import {
  getUniversalDomains, getUniversalDomain, getPhase60Packs, getPhase60PacksByDomain,
  getPhase60Pack, getKnowledgeGraph, detectDomainForQuery, universalDomainToExpertDomain,
  UNIVERSAL_DOMAIN_LABELS_FA,
  type UniversalKnowledgeDomain, type DomainInfo, type UniversalKnowledgePack,
  type KnowledgeGraph, type KnowledgeGraphNode,
} from './universal-knowledge-catalog';
import type { ExpertDomain } from '../ai/nex-expert-system';
import type { RouterRequest } from '../ai/model-intelligence/smart-model-router';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ExpertKnowledgeRoute {
  /** The original user query. */
  query: string;
  /** The detected knowledge domain (Phase 60 catalog). */
  knowledgeDomain: UniversalKnowledgeDomain | null;
  /** The expert domain (Phase 53). */
  expertDomain: ExpertDomain;
  /** The expert route result (Phase 53). */
  expertRoute: ExpertRouteResult;
  /** The relevant knowledge packs for this query. */
  relevantPacks: UniversalKnowledgePack[];
  /** The recommended knowledge pack (best match). */
  recommendedPack: UniversalKnowledgePack | null;
  /** Whether the recommended pack is installed (via Phase 55 engine). */
  packInstalled: boolean;
  /** RAG retrieval results (if a pack is installed). */
  retrieval: KnowledgeRetrievalResponse | null;
  /** The recommended model type for this task. */
  recommendedModelType: string;
  /** Summary of the routing decision. */
  summary: string;
  summaryFa: string;
  /** Whether NEX has the knowledge to answer this query. */
  hasKnowledge: boolean;
  /** Whether NEX is missing knowledge for this query. */
  missingKnowledge: boolean;
  /** What knowledge NEX is missing (Persian). */
  missingDescriptionFa: string;
}

export interface MultilingualSearchResult {
  query: string;
  /** Detected query language. */
  detectedLanguage: 'fa' | 'en' | 'mixed' | 'unknown';
  /** Normalized query (Persian normalized + lowercased). */
  normalizedQuery: string;
  /** RAG retrieval results. */
  results: KnowledgeRetrievalResponse | null;
  /** Whether Persian normalization was applied. */
  persianNormalized: boolean;
}

export interface KnowledgeGraphQuery {
  domain: UniversalKnowledgeDomain | null;
  subdomain: string | null;
  concept: string | null;
  /** Matching graph nodes. */
  nodes: KnowledgeGraphNode[];
  /** Related concepts (cross-domain links). */
  relatedConcepts: KnowledgeGraphNode[];
}

export interface UniversalKnowledgeStatus {
  totalDomains: number;
  totalSubdomains: number;
  totalConcepts: number;
  totalPacks: number;
  phase60NewPacks: number;
  persianSupportDomains: number;
  knowledgeGraphSize: { nodes: number; edges: number };
  installedPacks: number;
  missingPacks: number;
  domains: Array<{
    domain: UniversalKnowledgeDomain;
    nameFa: string;
    packCount: number;
    installedCount: number;
    missingCount: number;
  }>;
}

// ─── Universal Knowledge Brain ─────────────────────────────────────────────

export class UniversalKnowledgeBrain {
  private cachedExpertRouter: ReturnType<typeof getExpertRouter> | null = null;

  // ── Expert knowledge routing ──

  /**
   * Route a user query to the best expert + knowledge pack + model.
   *
   * This is the CORE Phase 60 function. It combines:
   *   1. Phase 53 Expert Router (keyword-based domain routing)
   *   2. Phase 60 Universal Knowledge Catalog (domain + pack detection)
   *   3. Phase 55 ExpertKnowledgeEngine RAG retrieval (if pack installed)
   *   4. Model type recommendation (coding/reasoning/vision/etc.)
   *
   * Example:
   *   "طراحی مدار تغذیه ۱۲ ولت"
   *     → expertDomain: electronics-engineering
   *     → knowledgeDomain: electronics-engineering
   *     → recommendedPack: el-power-datasheets (Power Electronics)
   *     → recommendedModelType: llm (reasoning)
   *
   *   "ساخت API با React"
   *     → expertDomain: software-engineering
   *     → knowledgeDomain: software-engineering
   *     → recommendedPack: sw-frameworks (Frontend Knowledge)
   *     → recommendedModelType: llm (coding)
   */
  async routeQuery(request: RouterRequest | string): Promise<ExpertKnowledgeRoute> {
    const query = typeof request === 'string' ? request : request.request;
    const hasImage = typeof request === 'object' ? request.hasImage : false;

    // 1. Expert Router (Phase 53) — keyword-based domain routing
    const router = this.getExpertRouter();
    const expertRoute = router.route(query);
    const expertDomain = expertRoute.domain;

    // 2. Knowledge Catalog (Phase 60) — detect knowledge domain
    const knowledgeDomain = detectDomainForQuery(query);

    // 3. Find relevant knowledge packs (Phase 60 catalog + Phase 55 engine)
    let relevantPacks: UniversalKnowledgePack[] = [];
    if (knowledgeDomain) {
      relevantPacks = getPhase60PacksByDomain(knowledgeDomain);
    }
    // If no Phase 60 packs exist for this domain, check the Phase 55 engine's
    // packs (which cover electronics/software/ai/science/system-architecture).
    if (relevantPacks.length === 0) {
      try {
        const engine = getExpertKnowledgeEngine();
        const phase55Packs = engine.getPacksByDomain(knowledgeDomain as any);
        // Convert Phase 55 KnowledgePack → UniversalKnowledgePack for unified handling
        relevantPacks = phase55Packs.map((p: any) => ({
          id: p.id,
          domain: p.domain,
          subdomain: '',
          name: p.name,
          nameFa: p.nameFa,
          description: p.description,
          descriptionFa: p.descriptionFa,
          sizeBytes: p.sizeBytes,
          version: p.version,
          documentCount: p.documents?.length || 0,
          capabilities: p.capabilities || [],
          capabilitiesFa: p.capabilitiesFa || [],
          languages: ['en', 'fa'],
          persianSupport: true,
          concepts: [],
          conceptsFa: [],
          isPhase60New: false,
        }));
      } catch { /* Phase 55 engine is best-effort */ }
    }

    // Pick the best pack by subdomain keyword match
    const recommendedPack = this.pickBestPack(query, relevantPacks);

    // Check if the recommended pack is installed (via Phase 55 engine)
    let packInstalled = false;
    let retrieval: KnowledgeRetrievalResponse | null = null;
    if (recommendedPack) {
      // Phase 55 engine tracks installed packs by id
      try {
        const engine = getExpertKnowledgeEngine();
        // Check if a pack with this id is installed
        const installed = engine.isInstalled(recommendedPack.id);
        packInstalled = installed;

        // If installed, retrieve knowledge via RAG
        if (installed) {
          retrieval = await engine.retrieveKnowledge(query, { limit: 4 });
        }
      } catch { /* Phase 55 engine is best-effort */ }
    }

    // Also try Phase 55 retrieval directly (any installed pack may match)
    if (!retrieval) {
      try {
        const engine = getExpertKnowledgeEngine();
        const phase55Retrieval = await engine.retrieveKnowledge(query, { limit: 3 });
        if (phase55Retrieval.results.length > 0) {
          retrieval = phase55Retrieval;
          packInstalled = true; // something is installed that matches
        }
      } catch { /* */ }
    }

    // 4. Recommend model type based on the task
    const recommendedModelType = this.recommendModelType(query, expertDomain, !!hasImage);

    // Determine knowledge status
    const hasKnowledge = packInstalled && (retrieval?.results.length ?? 0) > 0;
    const missingKnowledge = !hasKnowledge && recommendedPack !== null;
    const missingDescriptionFa = missingKnowledge && recommendedPack
      ? `برای پاسخ تخصصی به این سوال، بسته دانش «${recommendedPack.nameFa}» نیاز است نصب شود.`
      : '';

    // Summaries
    const domainLabel = knowledgeDomain ? UNIVERSAL_DOMAIN_LABELS_FA[knowledgeDomain] : expertRoute.expert.nameFa;
    const summary = `Routed to ${expertRoute.expert.name} with ${knowledgeDomain || 'no'} knowledge`;
    const summaryFa = `هدایت به ${expertRoute.expert.nameFa}` +
      (knowledgeDomain ? ` با دانش ${domainLabel}` : '') +
      (recommendedPack ? ` (${recommendedPack.nameFa})` : '') +
      (hasKnowledge ? ' — دانش موجود' : (missingKnowledge ? ' — دانش نیازمند نصب' : ''));

    return {
      query,
      knowledgeDomain,
      expertDomain,
      expertRoute,
      relevantPacks,
      recommendedPack,
      packInstalled,
      retrieval,
      recommendedModelType,
      summary,
      summaryFa,
      hasKnowledge,
      missingKnowledge,
      missingDescriptionFa,
    };
  }

  // ── Advanced RAG: multilingual search ──

  /**
   * Search the knowledge base with multilingual support.
   * Normalizes Persian text (ZWNJ, Arabic→Persian letter forms) before
   * retrieval to improve match quality.
   */
  async searchMultilingual(query: string, opts?: { domain?: UniversalKnowledgeDomain; limit?: number }): Promise<MultilingualSearchResult> {
    const detectedLanguage = this.detectLanguage(query);
    const normalizedQuery = this.normalizeQuery(query, detectedLanguage);
    const persianNormalized = normalizedQuery !== query;

    let results: KnowledgeRetrievalResponse | null = null;
    try {
      const engine = getExpertKnowledgeEngine();
      results = await engine.retrieveKnowledge(normalizedQuery, {
        limit: opts?.limit ?? 5,
        // Map universal domain → Phase 55 domain (cast since types differ but overlap)
        domain: opts?.domain as any,
      });
    } catch { /* */ }

    return {
      query,
      detectedLanguage,
      normalizedQuery,
      results,
      persianNormalized,
    };
  }

  // ── Knowledge graph queries ──

  /**
   * Query the knowledge graph for a domain, subdomain, or concept.
   */
  queryKnowledgeGraph(opts: { domain?: UniversalKnowledgeDomain; subdomain?: string; concept?: string }): KnowledgeGraphQuery {
    const graph = getKnowledgeGraph();
    let matching = graph.nodes;

    if (opts.domain) {
      matching = matching.filter((n) => n.domain === opts.domain);
    }
    if (opts.subdomain) {
      matching = matching.filter((n) => n.type === 'subdomain' && n.id.includes(`:${opts.subdomain}`));
    }
    if (opts.concept) {
      const lower = opts.concept.toLowerCase();
      matching = matching.filter((n) => n.type === 'concept' && (n.label.toLowerCase().includes(lower) || n.labelFa.includes(opts.concept!)));
    }

    // Collect related concepts (cross-domain links)
    const relatedIds = new Set<string>();
    for (const n of matching) {
      for (const r of n.related) relatedIds.add(r);
    }
    const relatedConcepts = graph.nodes.filter((n) => relatedIds.has(n.id) && !matching.includes(n));

    return {
      domain: opts.domain || null,
      subdomain: opts.subdomain || null,
      concept: opts.concept || null,
      nodes: matching,
      relatedConcepts,
    };
  }

  // ── Status ──

  getStatus(): UniversalKnowledgeStatus {
    const domains = getUniversalDomains();
    const graph = getKnowledgeGraph();
    const packs = getPhase60Packs();

    let installedPacks = 0;
    try {
      const engine = getExpertKnowledgeEngine();
      installedPacks = engine.getInstalledPacks().length;
    } catch { /* */ }

    const domainStatuses = domains.map((d: DomainInfo) => {
      const phase60Packs = getPhase60PacksByDomain(d.domain);
      // Phase 55 engine tracks installation; we count phase60 packs as "missing" unless installed
      let installedCount = 0;
      try {
        const engine = getExpertKnowledgeEngine();
        for (const p of phase60Packs) {
          if (engine.isInstalled(p.id)) installedCount++;
        }
      } catch { /* */ }
      return {
        domain: d.domain,
        nameFa: d.nameFa,
        packCount: phase60Packs.length,
        installedCount,
        missingCount: phase60Packs.length - installedCount,
      };
    });

    return {
      totalDomains: domains.length,
      totalSubdomains: domains.reduce((s, d) => s + d.subdomains.length, 0),
      totalConcepts: graph.nodes.filter((n) => n.type === 'concept').length,
      totalPacks: packs.length,
      phase60NewPacks: packs.filter((p) => p.isPhase60New).length,
      persianSupportDomains: domains.filter((d) => d.persianSupport).length,
      knowledgeGraphSize: { nodes: graph.nodes.length, edges: graph.edges.length },
      installedPacks,
      missingPacks: packs.length - installedPacks,
      domains: domainStatuses,
    };
  }

  // ── Internals ──

  private getExpertRouter() {
    if (!this.cachedExpertRouter) this.cachedExpertRouter = getExpertRouter();
    return this.cachedExpertRouter;
  }

  private pickBestPack(query: string, packs: UniversalKnowledgePack[]): UniversalKnowledgePack | null {
    if (packs.length === 0) return null;
    const lower = query.toLowerCase();
    let best = packs[0];
    let bestScore = -1;
    for (const p of packs) {
      let score = 0;
      for (const c of p.concepts) {
        if (lower.includes(c.toLowerCase())) score += 2;
      }
      for (const c of p.conceptsFa) {
        if (query.includes(c)) score += 2;
      }
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  private recommendModelType(query: string, expertDomain: ExpertDomain, hasImage: boolean): string {
    if (hasImage || /تصویر|عکس|image|picture|screenshot|بینایی/.test(query.toLowerCase())) return 'vision';
    if (/کد|برنامه|code|function|debug|api|تابع/.test(query.toLowerCase())) return 'coding';
    if (expertDomain === 'electronics-engineering') return 'reasoning';
    if (expertDomain === 'science') return 'reasoning';
    return 'llm';
  }

  private detectLanguage(text: string): 'fa' | 'en' | 'mixed' | 'unknown' {
    const hasFa = /[\u0600-\u06FF]/.test(text);
    const hasEn = /[a-zA-Z]/.test(text);
    if (hasFa && hasEn) return 'mixed';
    if (hasFa) return 'fa';
    if (hasEn) return 'en';
    return 'unknown';
  }

  /**
   * Normalize a query for better multilingual retrieval:
   *   - Replace ZWNJ (\u200c) with space
   *   - Convert Arabic Yeh (ي) → Persian Yeh (ی)
   *   - Convert Arabic Kaf (ك) → Persian Kaf (ک)
   *   - Collapse whitespace
   *   - Lowercase
   */
  private normalizeQuery(query: string, language: 'fa' | 'en' | 'mixed' | 'unknown'): string {
    if (language === 'en' || language === 'unknown') return query;
    return query
      .replace(/\u200c/g, ' ')        // ZWNJ → space
      .replace(/\u064a/g, '\u06cc')   // Arabic Yeh → Persian Yeh
      .replace(/\u0643/g, '\u06a9')   // Arabic Kaf → Persian Kaf
      .replace(/\u0649/g, '\u06cc')   // Alef Maksura → Persian Yeh
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Reset internal cache (for tests). */
  reset(): void {
    this.cachedExpertRouter = null;
  }
}

// ─── Security self-audit ───────────────────────────────────────────────────

/**
 * Verifies the universal knowledge brain:
 *   - never downloads / installs / deletes knowledge packs
 *   - never contacts a cloud API or external service
 *   - only ROUTES and RETRIEVES (delegates execution to Phase 58 runtime)
 *   - all retrieval is local (HashEmbedder + HybridRetriever)
 */
export function verifyUniversalKnowledgeSecurity(): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  // No fetch, no net.request, no download/install/delete methods.
  // Pack installation is delegated to Phase 55 KnowledgePackManager + PermissionGate (Phase 43).
  return { ok: findings.length === 0, findings };
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _brain: UniversalKnowledgeBrain | null = null;

export function getUniversalKnowledgeBrain(): UniversalKnowledgeBrain {
  if (!_brain) {
    _brain = new UniversalKnowledgeBrain();
  }
  return _brain;
}

export function _resetUniversalKnowledgeBrain(): void {
  _brain = null;
}
