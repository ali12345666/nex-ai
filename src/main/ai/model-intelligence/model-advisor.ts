/**
 * NEX AI — Model Advisor (Phase 45)
 *
 * The intelligence layer that combines hardware detection (Phase 39),
 * model catalog, and usage patterns to recommend better models.
 *
 * CRITICAL: This module NEVER downloads, installs, or switches models.
 * It only ANALYZES and RECOMMENDS. All actions go through PermissionGate.
 */

import { detectHardwareProfile, canModelRunOnHardware, type HardwareProfile } from '../hardware-model-recommender';
import { listModels, type LocalModelInfo } from '../model-registry';
import { getCatalog, type CatalogModelEntry, type ModelCategory } from './models-catalog';
import { getUsageAnalyzer, type UsageStats, type TaskCategory } from './usage-analyzer';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ModelRecommendation {
  /** Catalog entry for the recommended model. */
  catalogEntry: CatalogModelEntry;
  /** Whether it's already installed. */
  alreadyInstalled: boolean;
  /** Whether it can run on the current hardware. */
  canRun: boolean;
  /** Estimated improvement over the current model (percent). */
  estimatedImprovement: number;
  /** What category this improves. */
  improvementArea: string;
  /** Human-readable reason for the recommendation. */
  reason: string;
}

export interface ModelComparison {
  modelA: { name: string; scores: Record<string, number>; sizeGB: number; requiredRAM: number; };
  modelB: { name: string; scores: Record<string, number>; sizeGB: number; requiredRAM: number; };
  winner: 'A' | 'B' | 'tie';
  differences: Record<string, { a: number; b: number; delta: number }>;
  recommendation: string;
}

export interface HardwareAnalysis {
  profile: HardwareProfile;
  installedModels: LocalModelInfo[];
  totalInstalledModels: number;
  totalDiskUsage: number;
  recommendations: ModelRecommendation[];
}

// ─── Model Advisor ──────────────────────────────────────────────────────────

export class ModelAdvisor {
  /**
   * Analyze the current hardware + installed models + usage patterns.
   * Returns recommendations for better models.
   */
  analyzeHardware(): HardwareAnalysis {
    const hw = detectHardwareProfile();
    const installed = listModels().filter((m) => m.fileExists);
    const totalDiskUsage = installed.reduce((sum, m) => sum + m.sizeBytes, 0);
    const recommendations = this.generateRecommendations(hw, installed);

    return {
      profile: hw,
      installedModels: installed,
      totalInstalledModels: installed.length,
      totalDiskUsage,
      recommendations,
    };
  }

  /**
   * Generate model recommendations based on hardware + usage + catalog.
   */
  generateRecommendations(hw: HardwareProfile, installed: LocalModelInfo[]): ModelRecommendation[] {
    const usage = getUsageAnalyzer().getStats();
    const catalog = getCatalog();
    const recs: ModelRecommendation[] = [];

    // Determine what the user needs based on usage
    const primaryWorkload = usage.primaryWorkload || 'chat';
    const installedIds = new Set(installed.map((m) => m.id));

    // Find catalog models that match the primary workload
    for (const entry of catalog) {
      // Skip if already installed (by name match)
      const isInstalled = installed.some(
        (m) => m.name.toLowerCase().includes(entry.name.toLowerCase().split(' q')[0]) ||
               m.id === entry.id
      );

      // Skip if can't run on hardware
      const modelInfo: LocalModelInfo = {
        id: entry.id,
        name: entry.name,
        path: '',
        sizeBytes: entry.sizeGB * 1e9,
        contextSize: entry.contextSize,
        gpuLayers: -1,
        category: entry.category as any,
        addedAt: 0,
        fileExists: true,
        minRamBytes: entry.requiredRAM * 1e9,
        minVramBytes: entry.requiredVRAM * 1e9,
      };
      const verdict = canModelRunOnHardware(modelInfo, hw);
      if (!verdict.canRun) continue;

      // Score based on primary workload
      let score = 0;
      let improvementArea = '';
      switch (primaryWorkload) {
        case 'coding':
          score = entry.codingScore;
          improvementArea = 'coding';
          break;
        case 'reasoning':
          score = entry.reasoningScore;
          improvementArea = 'reasoning';
          break;
        case 'vision':
          score = entry.visionScore;
          improvementArea = 'vision';
          break;
        case 'voice':
          score = entry.voiceScore;
          improvementArea = 'voice';
          break;
        default:
          score = entry.qualityScore;
          improvementArea = 'general quality';
      }

      // Estimate improvement: compare to the best installed model in this category
      const bestInstalled = this.findBestInstalledForCategory(installed, primaryWorkload);
      let estimatedImprovement = 0;
      if (bestInstalled) {
        const bestScore = this.getInstalledModelScore(bestInstalled, primaryWorkload);
        estimatedImprovement = bestScore > 0 ? ((score - bestScore) / bestScore) * 100 : 0;
      } else {
        estimatedImprovement = score; // no existing model → full improvement
      }

      // Only recommend if improvement > 10%
      if (estimatedImprovement > 10 || !bestInstalled) {
        recs.push({
          catalogEntry: entry,
          alreadyInstalled: isInstalled,
          canRun: true,
          estimatedImprovement: Math.round(estimatedImprovement),
          improvementArea,
          reason: this.generateReason(entry, bestInstalled, estimatedImprovement, primaryWorkload),
        });
      }
    }

    // Sort by improvement (highest first)
    recs.sort((a, b) => b.estimatedImprovement - a.estimatedImprovement);

    // Return top 5
    return recs.slice(0, 5);
  }

  /**
   * Compare two models head-to-head.
   */
  compareModels(modelAId: string, modelBId: string): ModelComparison | null {
    const catalog = getCatalog();
    const a = catalog.find((m) => m.id === modelAId || m.name === modelAId);
    const b = catalog.find((m) => m.id === modelBId || m.name === modelBId);
    if (!a || !b) return null;

    const scoresA = {
      quality: a.qualityScore,
      speed: a.speedScore,
      coding: a.codingScore,
      reasoning: a.reasoningScore,
      vision: a.visionScore,
      voice: a.voiceScore,
    };
    const scoresB = {
      quality: b.qualityScore,
      speed: b.speedScore,
      coding: b.codingScore,
      reasoning: b.reasoningScore,
      vision: b.visionScore,
      voice: b.voiceScore,
    };

    const differences: Record<string, { a: number; b: number; delta: number }> = {};
    let aWins = 0;
    let bWins = 0;

    for (const key of Object.keys(scoresA)) {
      const va = scoresA[key as keyof typeof scoresA];
      const vb = scoresB[key as keyof typeof scoresB];
      const delta = va - vb;
      differences[key] = { a: va, b: vb, delta };
      if (delta > 0) aWins++;
      else if (delta < 0) bWins++;
    }

    const winner = aWins > bWins ? 'A' : (bWins > aWins ? 'B' : 'tie');

    let recommendation: string;
    if (winner === 'A') {
      recommendation = `${a.name} is better overall (wins ${aWins} of ${Object.keys(scoresA).length} categories)`;
    } else if (winner === 'B') {
      recommendation = `${b.name} is better overall (wins ${bWins} of ${Object.keys(scoresA).length} categories)`;
    } else {
      recommendation = `${a.name} and ${b.name} are roughly equal`;
    }

    return {
      modelA: { name: a.name, scores: scoresA, sizeGB: a.sizeGB, requiredRAM: a.requiredRAM },
      modelB: { name: b.name, scores: scoresB, sizeGB: b.sizeGB, requiredRAM: b.requiredRAM },
      winner,
      differences,
      recommendation,
    };
  }

  /**
   * Estimate performance gain of switching from current model to recommended.
   */
  estimatePerformanceGain(currentModelId: string, recommendedModelId: string): {
    qualityDelta: number;
    speedDelta: number;
    codingDelta: number;
    reasoningDelta: number;
    overallPercent: number;
  } {
    const catalog = getCatalog();
    const current = catalog.find((m) => m.id === currentModelId || m.name === currentModelId);
    const recommended = catalog.find((m) => m.id === recommendedModelId || m.name === recommendedModelId);
    if (!current || !recommended) {
      return { qualityDelta: 0, speedDelta: 0, codingDelta: 0, reasoningDelta: 0, overallPercent: 0 };
    }

    const qualityDelta = recommended.qualityScore - current.qualityScore;
    const speedDelta = recommended.speedScore - current.speedScore;
    const codingDelta = recommended.codingScore - current.codingScore;
    const reasoningDelta = recommended.reasoningScore - current.reasoningScore;
    const overallPercent = current.qualityScore > 0
      ? Math.round(((recommended.qualityScore - current.qualityScore) / current.qualityScore) * 100)
      : 0;

    return { qualityDelta, speedDelta, codingDelta, reasoningDelta, overallPercent };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private findBestInstalledForCategory(installed: LocalModelInfo[], category: TaskCategory): LocalModelInfo | null {
    if (installed.length === 0) return null;
    // Simple heuristic: prefer larger models for the category
    const matching = installed.filter((m) => {
      const cat = m.category;
      if (category === 'coding') return cat === 'coding' || cat === 'general';
      if (category === 'reasoning') return cat === 'reasoning' || cat === 'general';
      if (category === 'vision') return cat === 'vision';
      if (category === 'voice') return cat === 'speech';
      return true; // any model for general chat
    });
    if (matching.length === 0) return installed[0]; // fallback to first
    matching.sort((a, b) => b.sizeBytes - a.sizeBytes); // largest first
    return matching[0];
  }

  private getInstalledModelScore(model: LocalModelInfo, category: TaskCategory): number {
    // Estimate score based on parameter count (bigger = better score)
    const paramStr = model.parameterCount || '0B';
    const paramNum = parseFloat(paramStr);
    if (isNaN(paramNum)) return 50;
    // Rough: 0.5B → 30, 7B → 60, 14B → 75, 32B → 85
    if (paramNum <= 1) return 30 + paramNum * 5;
    if (paramNum <= 7) return 40 + (paramNum - 1) * 3;
    if (paramNum <= 14) return 58 + (paramNum - 7) * 2.5;
    return 75 + (paramNum - 14) * 0.5;
  }

  private generateReason(
    entry: CatalogModelEntry,
    currentBest: LocalModelInfo | null,
    improvement: number,
    workload: TaskCategory,
  ): string {
    const lines: string[] = [];
    lines.push(`Recommended: ${entry.name}`);
    if (currentBest) {
      lines.push(`Current: ${currentBest.name}`);
      lines.push(`Estimated improvement: +${Math.round(improvement)}% ${workload} quality`);
    } else {
      lines.push(`No ${workload} model currently installed`);
      lines.push(`This would add ${workload} capability`);
    }
    lines.push(`Size: ${entry.sizeGB} GB`);
    lines.push(`Requires: ${entry.requiredRAM} GB RAM${entry.requiredVRAM > 0 ? ` + ${entry.requiredVRAM} GB VRAM` : ' (CPU)'}`);
    return lines.join('\n');
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _advisor: ModelAdvisor | null = null;

export function getModelAdvisor(): ModelAdvisor {
  if (!_advisor) {
    _advisor = new ModelAdvisor();
  }
  return _advisor;
}
