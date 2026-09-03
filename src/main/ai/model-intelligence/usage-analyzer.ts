/**
 * NEX AI — Usage Analyzer (Phase 45)
 *
 * Tracks task categories, model usage, latency, and workload patterns.
 * Used by the ModelAdvisor to understand what the user actually does.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getUserDataDir } from '../../persistence';

// ─── Types ─────────────────────────────────────────────────────────────────

export type TaskCategory = 'coding' | 'chat' | 'reasoning' | 'vision' | 'voice' | 'embedding' | 'unknown';

export interface UsageRecord {
  /** When the task was run (ISO timestamp). */
  timestamp: string;
  /** Task category. */
  category: TaskCategory;
  /** Model used (name). */
  modelName: string;
  /** Model ID (from registry). */
  modelId?: string;
  /** Whether the task succeeded. */
  success: boolean;
  /** Response latency in milliseconds. */
  latencyMs: number;
  /** Tokens generated (if known). */
  tokensGenerated?: number;
  /** User request (truncated for pattern analysis). */
  requestPreview: string;
}

export interface UsageStats {
  totalTasks: number;
  byCategory: Record<string, { count: number; percent: number }>;
  byModel: Record<string, { count: number; percent: number; avgLatencyMs: number; successRate: number }>;
  failureRate: number;
  avgLatencyMs: number;
  /** The most used category. */
  primaryWorkload: TaskCategory;
  /** Percentage of the primary workload. */
  primaryWorkloadPercent: number;
}

// ─── Usage Analyzer ────────────────────────────────────────────────────────

const USAGE_FILE = 'usage-stats.json';
const MAX_RECORDS = 500;

export class UsageAnalyzer {
  private records: UsageRecord[] = [];
  private filePath: string;

  constructor() {
    this.filePath = path.join(getUserDataDir(), USAGE_FILE);
    this.load();
  }

  /**
   * Record a task usage.
   */
  record(record: Omit<UsageRecord, 'timestamp'>): void {
    const full: UsageRecord = {
      ...record,
      timestamp: new Date().toISOString(),
    };
    this.records.push(full);
    // Cap at MAX_RECORDS (keep newest)
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
    }
    this.save();
  }

  /**
   * Get aggregate usage statistics.
   */
  getStats(): UsageStats {
    const total = this.records.length;
    if (total === 0) {
      return {
        totalTasks: 0,
        byCategory: {},
        byModel: {},
        failureRate: 0,
        avgLatencyMs: 0,
        primaryWorkload: 'unknown',
        primaryWorkloadPercent: 0,
      };
    }

    const byCategory: Record<string, number> = {};
    const byModel: Record<string, { count: number; latencySum: number; successCount: number }> = {};
    let failures = 0;
    let latencySum = 0;

    for (const r of this.records) {
      byCategory[r.category] = (byCategory[r.category] || 0) + 1;
      if (!byModel[r.modelName]) {
        byModel[r.modelName] = { count: 0, latencySum: 0, successCount: 0 };
      }
      byModel[r.modelName].count++;
      byModel[r.modelName].latencySum += r.latencyMs;
      if (r.success) byModel[r.modelName].successCount++;
      else failures++;
      latencySum += r.latencyMs;
    }

    // Find primary workload
    let primaryWorkload: TaskCategory = 'unknown';
    let primaryCount = 0;
    for (const [cat, count] of Object.entries(byCategory)) {
      if (count > primaryCount) {
        primaryCount = count;
        primaryWorkload = cat as TaskCategory;
      }
    }

    return {
      totalTasks: total,
      byCategory: Object.fromEntries(
        Object.entries(byCategory).map(([k, v]) => [k, { count: v, percent: (v / total) * 100 }])
      ),
      byModel: Object.fromEntries(
        Object.entries(byModel).map(([k, v]) => [k, {
          count: v.count,
          percent: (v.count / total) * 100,
          avgLatencyMs: v.latencySum / v.count,
          successRate: v.successCount / v.count,
        }])
      ),
      failureRate: (failures / total) * 100,
      avgLatencyMs: latencySum / total,
      primaryWorkload,
      primaryWorkloadPercent: (primaryCount / total) * 100,
    };
  }

  /**
   * Get recent records (for pattern analysis).
   */
  getRecentRecords(limit: number = 50): UsageRecord[] {
    return this.records.slice(-limit).reverse();
  }

  /**
   * Classify a user request into a task category.
   */
  classifyRequest(request: string): TaskCategory {
    const lower = request.toLowerCase();
    if (/code|function|bug|error|compile|build|test|refactor|implement|class|method|api|sql|regex|debug/.test(lower)) {
      return 'coding';
    }
    if (/analyz|explain|reason|why|how|compare|architecture|design|decision|strategy/.test(lower)) {
      return 'reasoning';
    }
    if (/image|screenshot|picture|photo|see|visual|ocr|diagram|ui|layout/.test(lower)) {
      return 'vision';
    }
    if (/transcrib|speech|voice|listen|audio|say|speak/.test(lower)) {
      return 'voice';
    }
    if (/embed|vector|search|rag|document|knowledge/.test(lower)) {
      return 'embedding';
    }
    return 'chat';
  }

  /**
   * Clear all usage records.
   */
  clear(): void {
    this.records = [];
    this.save();
  }

  // ─── Persistence ──────────────────────────────────────────────────────

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (Array.isArray(data.records)) {
          this.records = data.records;
        }
      }
    } catch { /* */ }
  }

  private save(): void {
    try {
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ records: this.records }, null, 2), 'utf-8');
      fs.renameSync(tmp, this.filePath);
    } catch { /* */ }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _analyzer: UsageAnalyzer | null = null;

export function getUsageAnalyzer(): UsageAnalyzer {
  if (!_analyzer) {
    _analyzer = new UsageAnalyzer();
  }
  return _analyzer;
}
