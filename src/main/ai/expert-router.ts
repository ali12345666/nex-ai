/**
 * NEX AI — Expert Router (Phase 53)
 *
 * Routes user requests to the appropriate domain expert.
 * Analyzes keywords (English + Persian) to determine the best expert.
 *
 * CRITICAL: Only SELECTS — never executes/downloads/installs.
 */

import { EXPERT_PROFILES, getExpertProfile, type ExpertProfile, type ExpertDomain } from './nex-expert-system';

export interface ExpertRouteResult {
  expert: ExpertProfile;
  domain: ExpertDomain;
  confidence: number;
  reason: string;
  reasonFa: string;
  matchedKeywords: string[];
  matchedKeywordsFa: string[];
}

export class ExpertRouter {
  /**
   * Route a user request to the best expert domain.
   * Analyzes both English and Persian keywords.
   */
  route(request: string): ExpertRouteResult {
    const lower = request.toLowerCase();
    const scores: Array<{ expert: ExpertProfile; score: number; matchedEn: string[]; matchedFa: string[] }> = [];

    for (const expert of EXPERT_PROFILES) {
      let score = 0;
      const matchedEn: string[] = [];
      const matchedFa: string[] = [];

      // English keywords
      for (const kw of expert.keywords) {
        if (lower.includes(kw.toLowerCase())) {
          score += 2;
          matchedEn.push(kw);
        }
      }

      // Persian keywords (case-insensitive)
      for (const kw of expert.keywordsFa) {
        if (request.includes(kw)) {
          score += 2;
          matchedFa.push(kw);
        }
      }

      // Sub-domain keywords
      for (const sub of expert.subDomains) {
        if (lower.includes(sub.toLowerCase())) {
          score += 1;
          matchedEn.push(sub);
        }
      }

      scores.push({ expert, score, matchedEn, matchedFa });
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    const best = scores[0];
    const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
    const confidence = totalScore > 0 ? best.score / totalScore : 0;

    const reason = `Matched ${best.matchedEn.length + best.matchedFa.length} keywords for ${best.expert.name}`;
    const reasonFa = `${best.matchedEn.length + best.matchedFa.length} کلیدواژه مطابقت داشت — ${best.expert.nameFa}`;

    return {
      expert: best.expert,
      domain: best.expert.domain,
      confidence: Math.min(1, confidence),
      reason,
      reasonFa,
      matchedKeywords: best.matchedEn,
      matchedKeywordsFa: best.matchedFa,
    };
  }

  /**
   * Get all expert domains.
   */
  getAllDomains(): ExpertDomain[] {
    return EXPERT_PROFILES.map((e) => e.domain);
  }

  /**
   * Get expert by domain.
   */
  getExpert(domain: ExpertDomain): ExpertProfile | null {
    return getExpertProfile(domain);
  }

  /**
   * Generate a Persian self-description of NEX's expertise.
   */
  getExpertiseDescriptionFa(): string {
    const lines: string[] = [];
    lines.push('من NEX AI هستم.');
    lines.push('توانایی من شامل:');
    for (const expert of EXPERT_PROFILES) {
      lines.push(`- ${expert.nameFa}: ${expert.descriptionFa}`);
    }
    return lines.join('\n');
  }

  /**
   * Generate an English self-description of NEX's expertise.
   */
  getExpertiseDescription(): string {
    const lines: string[] = [];
    lines.push('I am NEX AI.');
    lines.push('My expertise includes:');
    for (const expert of EXPERT_PROFILES) {
      lines.push(`- ${expert.name}: ${expert.description}`);
    }
    return lines.join('\n');
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _router: ExpertRouter | null = null;

export function getExpertRouter(): ExpertRouter {
  if (!_router) {
    _router = new ExpertRouter();
  }
  return _router;
}
