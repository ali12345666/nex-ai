/**
 * NEX AI — Model Versioning & Integrity (Phase 39)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS MODULE PROVIDES
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  1. SCHEMA VERSIONING — the model registry config has a version number.
 *     Future schema changes can migrate forward. Currently version 2
 *     (Phase 39 adds hash + version fields to v1 entries).
 *
 *  2. HASH VERIFICATION — SHA-256 of the .gguf file at add-time. Stored on
 *     the model record. At load-time, the hash can be verified to detect
 *     file corruption or silent replacement.
 *
 *  3. BACKUP + ROLLBACK — before any mutation to the model registry, a
 *     backup of the current state is saved to `<userData>/config.backup.json`.
 *     If a mutation corrupts the config (e.g. crash mid-write), rollback()
 *     restores the last good state.
 *
 *  4. PORTABLE PATH RESOLUTION — when running in portable mode, model paths
 *     may be relative to the app directory. This module resolves them.
 *
 *  5. INTEGRITY CHECK — verifyModelIntegrity() re-hashes the file and
 *     compares to the stored hash. Used at startup to detect corruption.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * DESIGN PRINCIPLES
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  - NON-BLOCKING: hash computation is async (file may be multi-GB). The
 *    add flow returns immediately with a "pending" hash, and a background
 *    task fills it in.
 *
 *  - GRACEFUL DEGRADATION: if the hash is missing (v1 models), the system
 *    still works — it just can't verify integrity. A "verify" button in the
 *    UI backfills the hash.
 *
 *  - NO DATA LOSS: every mutation creates a backup first. The user can
 *    always rollback to the previous state.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { loadState, updateState, getUserDataDir } from '../persistence';

// ─── Schema Versioning ─────────────────────────────────────────────────────

/**
 * The current model registry schema version.
 *
 * Version History:
 *   1 (Phase 3-37): original schema — no version field, no hash.
 *   2 (Phase 39):   adds `schemaVersion`, `hash`, `hashAlgorithm`,
 *                   `verifiedAt` fields.
 *
 * When the schema changes, bump this number and add a migration in
 * migrateModelRegistry().
 */
export const CURRENT_MODEL_SCHEMA_VERSION = 2;

export interface ModelIntegrityInfo {
  /** Schema version when this model was added/migrated. */
  schemaVersion: number;
  /** SHA-256 hash of the .gguf file (hex). Undefined for v1 models. */
  hash?: string;
  /** Hash algorithm used (currently 'sha256'). */
  hashAlgorithm?: 'sha256';
  /** When the hash was last verified. */
  verifiedAt?: number;
  /** Whether the last integrity check passed. */
  integrityStatus?: 'verified' | 'mismatch' | 'pending' | 'unknown';
}

// ─── Hash Computation ──────────────────────────────────────────────────────

/**
 * Compute the SHA-256 hash of a file asynchronously.
 *
 * Uses streaming to handle multi-GB model files without loading them
 * entirely into memory. Returns the hex-encoded hash.
 *
 * @param filePath  Absolute path to the file.
 * @param onProgress Optional callback for progress reporting (0-100).
 */
export function computeFileHash(
  filePath: string,
  onProgress?: (percent: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    let bytesRead = 0;
    let totalBytes = 0;

    try {
      totalBytes = fs.statSync(filePath).size;
    } catch {
      // stat failed — proceed without progress reporting
    }

    input.on('data', (chunk: Buffer | string) => {
      hash.update(chunk as Buffer);
      bytesRead += (chunk as Buffer).length;
      if (onProgress && totalBytes > 0) {
        onProgress(Math.min(100, (bytesRead / totalBytes) * 100));
      }
    });
    input.on('end', () => {
      resolve(hash.digest('hex'));
    });
    input.on('error', (err) => {
      reject(new Error(`Failed to hash ${filePath}: ${err.message}`));
    });
  });
}

/**
 * Verify a model file's integrity by re-computing its hash and comparing
 * to the stored hash.
 *
 * @returns 'verified' if the hash matches, 'mismatch' if it doesn't,
 *          'unknown' if no stored hash exists, 'missing' if the file is gone.
 */
export async function verifyModelIntegrity(
  modelPath: string,
  storedHash?: string,
): Promise<'verified' | 'mismatch' | 'unknown' | 'missing'> {
  if (!fs.existsSync(modelPath)) return 'missing';
  if (!storedHash) return 'unknown';

  const actualHash = await computeFileHash(modelPath);
  return actualHash === storedHash ? 'verified' : 'mismatch';
}

// ─── Backup + Rollback ─────────────────────────────────────────────────────

const BACKUP_FILE = 'config.backup.json';

/**
 * Create a backup of the current model registry before a mutation.
 *
 * The backup is stored at `<userData>/config.backup.json` and contains
 * just the `localModels` array (not the full config — settings, secrets,
 * etc. are not backed up here).
 *
 * If a previous backup exists, it is overwritten. Only ONE level of
 * backup is kept (the last good state before the most recent mutation).
 */
export function backupModelRegistry(): boolean {
  try {
    const state = loadState();
    const models = state.localModels || [];
    const backupPath = path.join(getUserDataDir(), BACKUP_FILE);
    const backup = {
      backedUpAt: Date.now(),
      schemaVersion: CURRENT_MODEL_SCHEMA_VERSION,
      localModels: models,
    };
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Rollback the model registry to the last backup.
 *
 * Restores the `localModels` array from `<userData>/config.backup.json`.
 * If no backup exists, returns false.
 *
 * Use case: a mutation corrupted the config (e.g. crash mid-write, or
 * the user accidentally deleted all models). Rollback restores the last
 * good state.
 */
export function rollbackModelRegistry(): boolean {
  try {
    const backupPath = path.join(getUserDataDir(), BACKUP_FILE);
    if (!fs.existsSync(backupPath)) return false;
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
    if (!Array.isArray(backup.localModels)) return false;
    // Before rolling back, back up the CURRENT (potentially corrupt) state
    // so the user can inspect it if needed.
    backupModelRegistry();
    updateState({ localModels: backup.localModels });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a backup exists.
 */
export function hasModelRegistryBackup(): boolean {
  try {
    return fs.existsSync(path.join(getUserDataDir(), BACKUP_FILE));
  } catch {
    return false;
  }
}

/**
 * Get backup info (without restoring).
 */
export function getModelRegistryBackupInfo(): { backedUpAt: number; modelCount: number } | null {
  try {
    const backupPath = path.join(getUserDataDir(), BACKUP_FILE);
    if (!fs.existsSync(backupPath)) return null;
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
    return {
      backedUpAt: backup.backedUpAt || 0,
      modelCount: Array.isArray(backup.localModels) ? backup.localModels.length : 0,
    };
  } catch {
    return null;
  }
}

// ─── Migration ──────────────────────────────────────────────────────────────

/**
 * Migrate the model registry to the current schema version.
 *
 * Currently: v1 → v2 (add schemaVersion + integrityStatus='unknown' to
 * existing models that don't have a hash yet).
 *
 * This is idempotent — running it on an already-migrated registry is a no-op.
 */
export function migrateModelRegistry(): { migrated: number; fromVersion: number; toVersion: number } {
  const state = loadState();
  const models = state.localModels || [];
  let migrated = 0;
  let minVersion = CURRENT_MODEL_SCHEMA_VERSION;

  for (const m of models) {
    const v = (m as any).schemaVersion || 1;
    if (v < minVersion) minVersion = v;
    if (v < CURRENT_MODEL_SCHEMA_VERSION) {
      // v1 → v2: add schemaVersion + integrityStatus
      if (!(m as any).schemaVersion) {
        (m as any).schemaVersion = CURRENT_MODEL_SCHEMA_VERSION;
      }
      if (!(m as any).integrityStatus) {
        (m as any).integrityStatus = 'unknown';
      }
      if (!(m as any).hashAlgorithm) {
        (m as any).hashAlgorithm = 'sha256';
      }
      migrated++;
    }
  }

  if (migrated > 0) {
    updateState({ localModels: models });
  }

  return { migrated, fromVersion: minVersion, toVersion: CURRENT_MODEL_SCHEMA_VERSION };
}

// ─── Portable Path Resolution ──────────────────────────────────────────────

/**
 * Resolve a model path, handling portable mode.
 *
 * In portable mode, models may be stored as paths relative to the app
 * directory (e.g. `models/qwen.gguf`). This function resolves them to
 * absolute paths.
 *
 * If the path is already absolute and exists, it's returned as-is.
 * If the path is relative or the absolute path doesn't exist, we try
 * resolving it relative to:
 *   1. The app directory (portable mode)
 *   2. The userData directory
 *
 * @param modelPath  The path stored in the registry.
 * @returns The resolved absolute path, or the original if resolution fails.
 */
export function resolveModelPath(modelPath: string): string {
  // If absolute and exists, return as-is.
  if (path.isAbsolute(modelPath) && fs.existsSync(modelPath)) {
    return modelPath;
  }

  // Try relative to userData (portable mode data dir)
  const userData = getUserDataDir();
  const relToUserData = path.resolve(userData, modelPath);
  if (fs.existsSync(relToUserData)) {
    return relToUserData;
  }

  // Try relative to app directory (portable mode app dir)
  // On Windows portable: app dir is the exe's directory.
  // process.execPath is the electron exe.
  try {
    const appDir = path.dirname(process.execPath);
    const relToAppDir = path.resolve(appDir, modelPath);
    if (fs.existsSync(relToAppDir)) {
      return relToAppDir;
    }
  } catch {
    // ignore
  }

  // If path is absolute but doesn't exist, try the userData/models subdir
  if (path.isAbsolute(modelPath)) {
    const basename = path.basename(modelPath);
    const inModelsDir = path.join(userData, 'models', basename);
    if (fs.existsSync(inModelsDir)) {
      return inModelsDir;
    }
  }

  // Fallback: return original (caller will see fileExists=false)
  return modelPath;
}

/**
 * Normalize a model path for storage.
 *
 * In portable mode, converts absolute paths under the app directory to
 * relative paths (so they survive a USB move). In installed mode, keeps
 * absolute paths.
 */
export function normalizeModelPathForStorage(absPath: string): string {
  try {
    const appDir = path.dirname(process.execPath);
    const userData = getUserDataDir();

    // If the path is under the app directory or userData/models, store it
    // relative (portable-friendly).
    if (absPath.startsWith(appDir + path.sep)) {
      return path.relative(appDir, absPath);
    }
    const modelsDir = path.join(userData, 'models');
    if (absPath.startsWith(modelsDir + path.sep)) {
      return path.relative(appDir, absPath);
    }
  } catch {
    // ignore — keep absolute
  }
  return absPath;
}

// ─── Batch Integrity Check ─────────────────────────────────────────────────

export interface IntegrityCheckResult {
  modelId: string;
  modelName: string;
  status: 'verified' | 'mismatch' | 'unknown' | 'missing';
  message: string;
}

/**
 * Verify the integrity of ALL registered models.
 *
 * Returns a list of results. Models without a stored hash get 'unknown'.
 * Models whose file is missing get 'missing'. Models whose hash changed
 * get 'mismatch'.
 *
 * This is an ASYNC operation (hashes multi-GB files). Call from main
 * process, not in a hot path.
 */
export async function verifyAllModelsIntegrity(
  models: Array<{ id: string; name: string; path: string; hash?: string }>,
): Promise<IntegrityCheckResult[]> {
  const results: IntegrityCheckResult[] = [];
  for (const m of models) {
    const resolved = resolveModelPath(m.path);
    const status = await verifyModelIntegrity(resolved, m.hash);
    let message: string;
    switch (status) {
      case 'verified': message = 'File hash matches stored hash'; break;
      case 'mismatch': message = '⚠️ File hash MISMATCH — file may be corrupted or replaced'; break;
      case 'unknown': message = 'No stored hash — run "Verify" to compute one'; break;
      case 'missing': message = '❌ File not found at resolved path'; break;
    }
    results.push({ modelId: m.id, modelName: m.name, status, message });
  }
  return results;
}
