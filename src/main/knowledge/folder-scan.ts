/**
 * NEX AI — Folder Scanner (Phase 10 / P10-B)
 *
 * Pure helper that collects INGESTABLE files from a folder tree for the
 * Knowledge UI's "Add Folder" action. Delegates every per-file security
 * decision to validateIngestFile (Phase 9 guards: traversal, symlink
 * escape, size, binary, allowlist) — this module NEVER overrides them.
 *
 * Hard caps (configurable, not hardcoded defaults):
 *   - maxFiles per folder scan (default 500)
 *   - maxTotalBytes per scan (default 100 MB)
 *   - ignored directory names (node_modules, .git, dist, …)
 *
 * Pure fs — no electron, no network, no knowledge-service imports.
 */

import * as fs from 'fs';
import * as path from 'path';
import { validateIngestFile } from './security';

export interface FolderScanOptions {
  /** allowed roots for the security validator (usually [projectPath]) */
  roots: string[];
  maxFiles?: number;
  maxTotalBytes?: number;
  ignoreDirs?: string[];
}

export interface FolderScanResult {
  /** files that passed ALL security guards and are ingestable */
  files: string[];
  /** files rejected by guards, with reasons (shown aggregated in UI) */
  rejected: Array<{ file: string; reason: string }>;
  /** supported extensions seen but skipped due to caps */
  skippedByCaps: number;
  truncated: boolean;
  totalBytes: number;
}

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'release', 'out', 'build', '.next',
  '.cache', 'coverage', '__pycache__', '.venv', 'target', '.turbo', '.parcel-cache',
]);

export const DEFAULT_SCAN_MAX_FILES = 500;
export const DEFAULT_SCAN_MAX_BYTES = 100 * 1024 * 1024;

/**
 * Scan a folder (recursively) for knowledge-ingestable files.
 * Never throws — scan errors on subdirectories are skipped silently.
 */
export function scanFolderForIngest(rootDir: string, opts: FolderScanOptions): FolderScanResult {
  const maxFiles = opts.maxFiles ?? DEFAULT_SCAN_MAX_FILES;
  const maxTotalBytes = opts.maxTotalBytes ?? DEFAULT_SCAN_MAX_BYTES;
  const ignore = new Set([...DEFAULT_IGNORE_DIRS, ...(opts.ignoreDirs || [])]);

  const files: string[] = [];
  const rejected: Array<{ file: string; reason: string }> = [];
  let skippedByCaps = 0;
  let truncated = false;
  let totalBytes = 0;

  const queue: string[] = [path.resolve(rootDir)];

  while (queue.length > 0 && !truncated) {
    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir — skip
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignore.has(entry.name) && !entry.name.startsWith('.')) {
          queue.push(full);
        }
        continue;
      }
      if (entry.isSymbolicLink()) {
        // Explicitly validated (never silently followed): the Phase-9 guard
        // resolves the real path and rejects escapes; safe in-root links that
        // pass become candidates, escapes are REPORTED to the user.
        const guard = validateIngestFile(full, { roots: opts.roots });
        if (!guard.ok) {
          rejected.push({ file: full, reason: guard.reason || 'symlink rejected' });
          continue;
        }
        if (files.length >= maxFiles || totalBytes + (guard.sizeBytes || 0) > maxTotalBytes) {
          skippedByCaps++;
          truncated = true;
          continue;
        }
        totalBytes += guard.sizeBytes || 0;
        files.push(guard.resolvedPath!);
        continue;
      }
      if (!entry.isFile()) continue;

      // Enforce per-file guards via the SAME Phase-9 validator the single
      // file path uses — UI never invents its own rules.
      const guard = validateIngestFile(full, { roots: opts.roots });
      if (!guard.ok) {
        // Unsupported extensions are EXPECTED in folders — don't spam the
        // rejected list with them; only report real rejections.
        if (!/Unsupported/.test(guard.reason || '')) {
          rejected.push({ file: full, reason: guard.reason || 'rejected' });
        }
        continue;
      }

      // Caps — count every subsequent valid file (accurate within already-
      // listed dirs; deeper unexpanded dirs are cut off by the truncated flag)
      if (files.length >= maxFiles || totalBytes + (guard.sizeBytes || 0) > maxTotalBytes) {
        skippedByCaps++;
        truncated = true;
        continue;
      }

      totalBytes += guard.sizeBytes || 0;
      files.push(guard.resolvedPath!);
    }
  }

  return { files, rejected, skippedByCaps, truncated, totalBytes };
}
