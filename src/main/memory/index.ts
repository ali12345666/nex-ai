/**
 * NEX AI — Memory Architecture
 *
 * 5 separate memory stores, all local, no external services.
 *
 *   userData/
 *   ├── conversations/        (existing — chat history)
 *   ├── memory/
 *   │   ├── user/             (User Memory — preferences, identity, style)
 *   │   ├── project/          (Project Memory — architecture decisions, conventions)
 *   │   ├── task/             (Task Memory — current task context, plan, state)
 *   │   ├── knowledge/        (Knowledge Memory — user-imported documents for RAG)
 *   │   └── sessions/         (Session Memory — ephemeral, cleared on app close)
 *
 * Memory types:
 *  - Conversation: chat history (already in conversations/)
 *  - User: persistent across all projects (preferences, identity)
 *  - Project: persistent per-project (architecture, conventions, file map)
 *  - Task: ephemeral per-task (plan, intermediate state, observations)
 *  - Knowledge: RAG-able documents (PDFs, datasheets, code references)
 *
 * Each store has the same API: get/set/delete/query.
 * Future versions will add vector search + embedding for knowledge memory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getUserDataDir } from '../persistence';

// ─── Memory Types ───────────────────────────────────────────────────────────

export type MemoryStoreType = 'user' | 'project' | 'task' | 'knowledge' | 'session';

/** Runtime list of the five stores (validation for IPC + tests). Phase 13. */
export const MEMORY_STORES: readonly MemoryStoreType[] = ['user', 'project', 'task', 'knowledge', 'session'];

export interface MemoryEntry {
  id: string;
  key: string;
  value: any;
  type: 'string' | 'object' | 'array' | 'number' | 'boolean' | 'bigint' | 'function' | 'symbol' | 'undefined';
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface MemoryQuery {
  key?: string;
  tags?: string[];
  type?: MemoryEntry['type'];
  limit?: number;
}

// ─── Store path management ──────────────────────────────────────────────────

function getStorePath(store: MemoryStoreType): string {
  const base = path.join(getUserDataDir(), 'memory');
  const subDir = store === 'session' ? 'sessions' : store;
  const dir = path.join(base, subDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get the file path for a memory entry.
 * Each entry is stored as its own JSON file for easy retrieval and atomic updates.
 */
function getEntryFilePath(store: MemoryStoreType, id: string): string {
  return path.join(getStorePath(store), `${id}.json`);
}

/**
 * For project-scoped memory, we use a sub-directory per project.
 */
function getProjectStorePath(projectId: string): string {
  const dir = path.join(getStorePath('project'), sanitizeProjectId(projectId));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function sanitizeProjectId(id: string): string {
  // Hash the project id to avoid filesystem-unsafe chars
  return id.replace(/[^\w\-]/g, '_').slice(0, 64);
}

// ─── Generic Memory Store API ───────────────────────────────────────────────

/**
 * Set a memory entry.
 * Phase 111: Secret redaction is enforced AT THE STORAGE LAYER — even if
 * a caller bypasses the consolidator and calls setMemory() directly,
 * secrets are still redacted before persistence.
 */
export function setMemory(
  store: MemoryStoreType,
  key: string,
  value: any,
  opts: { tags?: string[]; expiresAt?: number; projectId?: string; metadata?: Record<string, any> } = {}
): MemoryEntry {
  // Phase 111: Enforce secret redaction at the storage layer.
  // This is the defense-in-depth fix: even if a caller (remember tool,
  // IPC handler, consolidator bypass) calls setMemory() directly with
  // raw secrets, they are redacted before being written to disk.
  const { redactObjectDeep } = require('../agent/logger');
  const safeValue = redactObjectDeep(value);
  const safeKey = redactObjectDeep(key);

  const id = generateId(safeKey);
  const entry: MemoryEntry = {
    id,
    key: safeKey,
    value: safeValue,
    type: Array.isArray(safeValue) ? 'array' : typeof safeValue,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: opts.expiresAt,
    tags: opts.tags,
    metadata: opts.metadata,
  };
  const filePath = store === 'project' && opts.projectId
    ? path.join(getProjectStorePath(opts.projectId), `${id}.json`)
    : getEntryFilePath(store, id);
  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
  return entry;
}

/**
 * Get a memory entry by key.
 */
export function getMemory(store: MemoryStoreType, key: string, projectId?: string): MemoryEntry | null {
  const id = generateId(key);
  const filePath = store === 'project' && projectId
    ? path.join(getProjectStorePath(projectId), `${id}.json`)
    : getEntryFilePath(store, id);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MemoryEntry;
    // Check expiry
    if (data.expiresAt && data.expiresAt < Date.now()) {
      fs.unlinkSync(filePath); // cleanup
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Update an existing memory entry (preserves createdAt).
 */
export function updateMemory(
  store: MemoryStoreType,
  key: string,
  value: any,
  opts: { projectId?: string; tags?: string[] } = {}
): MemoryEntry | null {
  const existing = getMemory(store, key, opts.projectId);
  if (!existing) {
    return setMemory(store, key, value, opts);
  }
  const updated: MemoryEntry = {
    ...existing,
    value,
    type: Array.isArray(value) ? 'array' : typeof value,
    updatedAt: Date.now(),
    tags: opts.tags || existing.tags,
  };
  const id = generateId(key);
  const filePath = store === 'project' && opts.projectId
    ? path.join(getProjectStorePath(opts.projectId), `${id}.json`)
    : getEntryFilePath(store, id);
  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
  return updated;
}

/**
 * Delete a memory entry.
 */
export function deleteMemory(store: MemoryStoreType, key: string, projectId?: string): boolean {
  const id = generateId(key);
  const filePath = store === 'project' && projectId
    ? path.join(getProjectStorePath(projectId), `${id}.json`)
    : getEntryFilePath(store, id);
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Query memory entries by key pattern, tags, or type.
 * Returns up to `limit` entries (default 100).
 */
export function queryMemory(store: MemoryStoreType, query: MemoryQuery, projectId?: string): MemoryEntry[] {
  const dir = store === 'project' && projectId
    ? getProjectStorePath(projectId)
    : getStorePath(store);
  const results: MemoryEntry[] = [];
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as MemoryEntry;
        // Expiry check
        if (entry.expiresAt && entry.expiresAt < Date.now()) {
          continue;
        }
        // Key filter (prefix match)
        if (query.key && !entry.key.startsWith(query.key)) continue;
        // Type filter
        if (query.type && entry.type !== query.type) continue;
        // Tags filter (any match)
        if (query.tags && query.tags.length > 0) {
          const hasTag = entry.tags?.some((t) => query.tags!.includes(t));
          if (!hasTag) continue;
        }
        results.push(entry);
        if (results.length >= (query.limit || 100)) break;
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }
  return results;
}

/**
 * List all entries in a store (for debugging / Settings UI).
 */
export function listMemory(store: MemoryStoreType, projectId?: string): MemoryEntry[] {
  return queryMemory(store, {}, projectId);
}

/**
 * Clear all entries in a store (used for "Clear session memory" etc.).
 */
export function clearMemoryStore(store: MemoryStoreType, projectId?: string): number {
  const dir = store === 'project' && projectId
    ? getProjectStorePath(projectId)
    : getStorePath(store);
  let count = 0;
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      try {
        fs.unlinkSync(path.join(dir, f));
        count++;
      } catch {}
    }
  } catch {}
  return count;
}

// ─── Convenience: typed shortcuts ────────────────────────────────────────────

export const UserMemory = {
  get: (key: string) => getMemory('user', key),
  set: (key: string, value: any, opts?: { tags?: string[]; expiresAt?: number }) =>
    setMemory('user', key, value, opts),
  update: (key: string, value: any, opts?: { tags?: string[] }) =>
    updateMemory('user', key, value, opts),
  delete: (key: string) => deleteMemory('user', key),
  query: (q: MemoryQuery) => queryMemory('user', q),
  list: () => listMemory('user'),
};

export const ProjectMemory = {
  get: (key: string, projectId: string) => getMemory('project', key, projectId),
  set: (key: string, value: any, projectId: string, opts?: { tags?: string[]; expiresAt?: number }) =>
    setMemory('project', key, value, { ...opts, projectId }),
  update: (key: string, value: any, projectId: string, opts?: { tags?: string[] }) =>
    updateMemory('project', key, value, { ...opts, projectId }),
  delete: (key: string, projectId: string) => deleteMemory('project', key, projectId),
  query: (q: MemoryQuery, projectId: string) => queryMemory('project', q, projectId),
  list: (projectId: string) => listMemory('project', projectId),
};

export const TaskMemory = {
  get: (key: string) => getMemory('task', key),
  set: (key: string, value: any, opts?: { tags?: string[]; expiresAt?: number }) =>
    setMemory('task', key, value, opts),
  update: (key: string, value: any, opts?: { tags?: string[] }) =>
    updateMemory('task', key, value, opts),
  delete: (key: string) => deleteMemory('task', key),
  query: (q: MemoryQuery) => queryMemory('task', q),
  list: () => listMemory('task'),
  clear: () => clearMemoryStore('task'),
};

export const KnowledgeMemory = {
  get: (key: string) => getMemory('knowledge', key),
  set: (key: string, value: any, opts?: { tags?: string[] }) =>
    setMemory('knowledge', key, value, opts),
  update: (key: string, value: any, opts?: { tags?: string[] }) =>
    updateMemory('knowledge', key, value, opts),
  delete: (key: string) => deleteMemory('knowledge', key),
  query: (q: MemoryQuery) => queryMemory('knowledge', q),
  list: () => listMemory('knowledge'),
};

export const SessionMemory = {
  get: (key: string) => getMemory('session', key),
  set: (key: string, value: any, opts?: { tags?: string[]; expiresAt?: number }) =>
    setMemory('session', key, value, opts),
  update: (key: string, value: any, opts?: { tags?: string[] }) =>
    updateMemory('session', key, value, opts),
  delete: (key: string) => deleteMemory('session', key),
  query: (q: MemoryQuery) => queryMemory('session', q),
  list: () => listMemory('session'),
  clear: () => clearMemoryStore('session'),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(key: string): string {
  // Simple deterministic id from key (for stable file naming)
  // Not a real hash — for production we'd use crypto.createHash
  return key
    .toLowerCase()
    .replace(/[^\w\-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 64) || 'unnamed';
}
