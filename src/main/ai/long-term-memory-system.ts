/**
 * NEX AI — Long Term Memory System (Phase 52)
 *
 * Upgrades the existing Phase 40 memory with:
 *   - User preferences (with permission before saving)
 *   - Project history
 *   - Important decisions
 *   - Working style patterns
 *   - Frequently used tools
 *
 * CRITICAL: Never stores personal/sensitive data without asking permission.
 * Before saving personal info, asks: "آیا اجازه می‌دهید این مورد را برای دفعات بعد ذخیره کنم؟"
 */

import { UserMemory, ProjectMemory, setMemory, getMemory, listMemory, type MemoryStoreType } from '../memory';
import { getUserProfileManager } from './user-profile-manager';

export type MemoryCategory = 'preference' | 'decision' | 'pattern' | 'fact' | 'project-history' | 'tool-usage';
export type MemorySensitivity = 'public' | 'personal' | 'sensitive';

export interface LongTermMemoryEntry {
  id: string;
  category: MemoryCategory;
  key: string;
  value: any;
  sensitivity: MemorySensitivity;
  store: MemoryStoreType;
  projectId?: string;
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  lastAccess: number;
  tags: string[];
  /** Whether the user explicitly approved storing this. */
  approved: boolean;
}

export interface MemoryPermissionRequest {
  id: string;
  key: string;
  value: any;
  sensitivity: MemorySensitivity;
  category: MemoryCategory;
  question: string;
  questionFa: string;
}

export interface MemoryPermissionResult {
  approved: boolean;
  key: string;
  reason?: string;
}

export class LongTermMemorySystem {
  private pendingPermission: MemoryPermissionRequest | null = null;
  private permissionResolve: ((result: MemoryPermissionResult) => void) | null = null;

  /**
   * Store a memory entry. If it's personal/sensitive, ask permission first.
   */
  async store(
    category: MemoryCategory,
    key: string,
    value: any,
    opts: {
      sensitivity?: MemorySensitivity;
      store?: MemoryStoreType;
      projectId?: string;
      tags?: string[];
    } = {},
  ): Promise<{ stored: boolean; reason?: string }> {
    const sensitivity = opts.sensitivity || 'public';
    const store = opts.store || this.inferStore(category, opts.projectId);

    // If personal or sensitive → ask permission first
    if (sensitivity === 'personal' || sensitivity === 'sensitive') {
      const permResult = await this.requestMemoryPermission(key, value, sensitivity, category);
      if (!permResult.approved) {
        return { stored: false, reason: permResult.reason || 'User declined to store' };
      }
    }

    // Store in existing Phase 40 memory system
    setMemory(store, key, value, {
      tags: opts.tags || [category],
      projectId: opts.projectId,
      metadata: { category, sensitivity, approved: sensitivity !== 'public' },
    });

    // Also update user profile if it's a preference
    if (category === 'preference' && store === 'user') {
      const profile = getUserProfileManager();
      // Profile handles its own persistence
    }

    return { stored: true };
  }

  /**
   * Retrieve a memory entry.
   */
  retrieve(key: string, store: MemoryStoreType = 'user', projectId?: string): any {
    const entry = getMemory(store, key, projectId);
    return entry?.value || null;
  }

  /**
   * List all long-term memories (from existing stores).
   */
  listAll(store?: MemoryStoreType, projectId?: string): Array<{ key: string; value: any; store: string; tags?: string[] }> {
    const stores: MemoryStoreType[] = store ? [store] : ['user', 'project', 'task'];
    const results: Array<{ key: string; value: any; store: string; tags?: string[] }> = [];
    for (const s of stores) {
      const entries = listMemory(s, projectId);
      for (const e of entries) {
        results.push({ key: e.key, value: e.value, store: s, tags: e.tags });
      }
    }
    return results;
  }

  /**
   * Store a user preference (with permission if personal).
   */
  async storePreference(key: string, value: any, personal = true): Promise<{ stored: boolean }> {
    return this.store('preference', key, value, {
      sensitivity: personal ? 'personal' : 'public',
      store: 'user',
      tags: ['preference'],
    });
  }

  /**
   * Store a project decision.
   */
  async storeDecision(key: string, value: any, projectId: string): Promise<{ stored: boolean }> {
    return this.store('decision', key, value, {
      sensitivity: 'public',
      store: 'project',
      projectId,
      tags: ['decision'],
    });
  }

  /**
   * Store a working pattern.
   */
  async storePattern(key: string, value: any, projectId?: string): Promise<{ stored: boolean }> {
    return this.store('pattern', key, value, {
      sensitivity: 'public',
      store: projectId ? 'project' : 'user',
      projectId,
      tags: ['pattern'],
    });
  }

  /**
   * Record tool usage (for frequently-used tracking).
   */
  recordToolUsage(tool: string): void {
    const profile = getUserProfileManager();
    profile.addFrequentlyUsedTool(tool);
  }

  // ─── Memory Permission Gate ───────────────────────────────────────────

  /**
   * Request permission before storing personal/sensitive data.
   * Shows: "آیا اجازه می‌دهید این مورد را برای دفعات بعد ذخیره کنم؟"
   */
  private async requestMemoryPermission(
    key: string,
    value: any,
    sensitivity: MemorySensitivity,
    category: MemoryCategory,
  ): Promise<MemoryPermissionResult> {
    const valuePreview = typeof value === 'string' ? value.slice(0, 100) : JSON.stringify(value).slice(0, 100);

    const request: MemoryPermissionRequest = {
      id: `mem-perm-${Date.now()}`,
      key,
      value,
      sensitivity,
      category,
      question: `May I save this ${sensitivity} information for future use?`,
      questionFa: `آیا اجازه می‌دهید این مورد را برای دفعات بعد ذخیره کنم؟`,
    };

    this.pendingPermission = request;

    return new Promise<MemoryPermissionResult>((resolve) => {
      this.permissionResolve = resolve;
    });
  }

  /**
   * Respond to a pending memory permission request (from UI/chat).
   */
  respondToMemoryPermission(approved: boolean, reason?: string): void {
    if (this.permissionResolve && this.pendingPermission) {
      this.permissionResolve({
        approved,
        key: this.pendingPermission.key,
        reason,
      });
      this.permissionResolve = null;
      this.pendingPermission = null;
    }
  }

  /**
   * Get the current pending permission request (for UI display).
   */
  getPendingPermission(): MemoryPermissionRequest | null {
    return this.pendingPermission;
  }

  /**
   * Check if there's a pending permission request.
   */
  hasPendingPermission(): boolean {
    return this.pendingPermission !== null;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private inferStore(category: MemoryCategory, projectId?: string): MemoryStoreType {
    if (projectId) return 'project';
    if (category === 'preference') return 'user';
    if (category === 'pattern') return 'user';
    if (category === 'decision') return 'project';
    if (category === 'tool-usage') return 'session';
    return 'user';
  }

  /**
   * Get memory statistics.
   */
  getStats(): {
    userMemories: number;
    projectMemories: number;
    taskMemories: number;
    total: number;
  } {
    const user = listMemory('user').length;
    const project = listMemory('project').length;
    const task = listMemory('task').length;
    return { userMemories: user, projectMemories: project, taskMemories: task, total: user + project + task };
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _system: LongTermMemorySystem | null = null;

export function getLongTermMemorySystem(): LongTermMemorySystem {
  if (!_system) {
    _system = new LongTermMemorySystem();
  }
  return _system;
}
