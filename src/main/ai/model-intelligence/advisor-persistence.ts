/**
 * NEX AI — Advisor Persistence (Phase 45)
 *
 * Stores user preferences, rejected recommendations, and installed model history.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getUserDataDir } from '../../persistence';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface AdvisorPreferences {
  /** Preferred model IDs per category. */
  preferredModels: Record<string, string>;
  /** Recommendation IDs the user rejected (don't show again). */
  rejectedRecommendations: string[];
  /** Whether the user has seen the advisor. */
  hasSeenAdvisor: boolean;
  /** Whether auto-recommendation is enabled. */
  autoRecommendEnabled: boolean;
  /** Last time recommendations were checked. */
  lastRecommendationCheck: number;
}

export interface InstalledModelHistoryEntry {
  modelId: string;
  modelName: string;
  installedAt: string;
  installedVia: 'manual' | 'advisor' | 'auto';
  version: string;
}

export interface AdvisorPersistenceData {
  preferences: AdvisorPreferences;
  installedHistory: InstalledModelHistoryEntry[];
}

// ─── Advisor Persistence ───────────────────────────────────────────────────

const PREFERENCES_FILE = 'advisor-preferences.json';

const DEFAULT_PREFERENCES: AdvisorPreferences = {
  preferredModels: {},
  rejectedRecommendations: [],
  hasSeenAdvisor: false,
  autoRecommendEnabled: true,
  lastRecommendationCheck: 0,
};

export class AdvisorPersistence {
  private data: AdvisorPersistenceData;
  private filePath: string;

  constructor() {
    this.filePath = path.join(getUserDataDir(), PREFERENCES_FILE);
    this.data = this.load();
  }

  // ─── Preferences ──────────────────────────────────────────────────────

  getPreferences(): AdvisorPreferences {
    return { ...this.data.preferences };
  }

  setPreferredModel(category: string, modelId: string): void {
    this.data.preferences.preferredModels[category] = modelId;
    this.save();
  }

  getPreferredModel(category: string): string | null {
    return this.data.preferences.preferredModels[category] || null;
  }

  rejectRecommendation(recommendationId: string): void {
    if (!this.data.preferences.rejectedRecommendations.includes(recommendationId)) {
      this.data.preferences.rejectedRecommendations.push(recommendationId);
      this.save();
    }
  }

  isRecommendationRejected(recommendationId: string): boolean {
    return this.data.preferences.rejectedRecommendations.includes(recommendationId);
  }

  setAutoRecommendEnabled(enabled: boolean): void {
    this.data.preferences.autoRecommendEnabled = enabled;
    this.save();
  }

  setLastRecommendationCheck(timestamp: number): void {
    this.data.preferences.lastRecommendationCheck = timestamp;
    this.save();
  }

  // ─── Installed Model History ──────────────────────────────────────────

  addInstalledModel(entry: Omit<InstalledModelHistoryEntry, 'installedAt'>): void {
    const full: InstalledModelHistoryEntry = {
      ...entry,
      installedAt: new Date().toISOString(),
    };
    this.data.installedHistory.push(full);
    this.save();
  }

  getInstalledHistory(): InstalledModelHistoryEntry[] {
    return [...this.data.installedHistory].reverse();
  }

  // ─── Persistence ──────────────────────────────────────────────────────

  private load(): AdvisorPersistenceData {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        return {
          preferences: { ...DEFAULT_PREFERENCES, ...data.preferences },
          installedHistory: Array.isArray(data.installedHistory) ? data.installedHistory : [],
        };
      }
    } catch { /* */ }
    return { preferences: { ...DEFAULT_PREFERENCES }, installedHistory: [] };
  }

  private save(): void {
    try {
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmp, this.filePath);
    } catch { /* */ }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _persistence: AdvisorPersistence | null = null;

export function getAdvisorPersistence(): AdvisorPersistence {
  if (!_persistence) {
    _persistence = new AdvisorPersistence();
  }
  return _persistence;
}
