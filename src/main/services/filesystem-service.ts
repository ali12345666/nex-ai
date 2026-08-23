/**
 * NEX AI — Filesystem Service (Phase 28)
 *
 * Abstraction layer for all filesystem operations from the renderer.
 * All paths are validated against the current workspace root (jailed).
 * Uses the Phase 1 security layer (assertPathInside).
 */

import * as fs from 'fs';
import * as path from 'path';
import { assertPathInside } from '../security';

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  extension: string;
  modifiedAt: number;
}

export interface DirectoryInfo {
  path: string;
  entries: FileEntry[];
  error?: string;
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  'coverage', '__pycache__', '.venv', 'target', '.turbo', 'release',
]);

export class FilesystemService {
  private workspaceRoot: string | null = null;

  /** Set the current workspace root. */
  setWorkspace(root: string): void {
    this.workspaceRoot = root;
  }

  /** Get current workspace root. */
  getWorkspace(): string | null {
    return this.workspaceRoot;
  }

  /** Guard: ensure target is inside workspace (or allow absolute paths within it). */
  private guard(targetPath: string): { ok: boolean; resolved: string; error?: string } {
    const resolved = path.resolve(targetPath);
    if (resolved.includes('\0')) return { ok: false, resolved, error: 'Null byte in path' };
    // Allow paths inside workspace; also allow workspace root itself
    if (this.workspaceRoot) {
      const check = assertPathInside(resolved, [this.workspaceRoot]);
      if (!check.ok) return { ok: false, resolved, error: check.reason };
    }
    return { ok: true, resolved };
  }

  /** Read a directory (non-recursive, sorted, with file info). */
  readDirectory(dirPath: string, showHidden = false): DirectoryInfo {
    const g = this.guard(dirPath);
    if (!g.ok) return { path: dirPath, entries: [], error: g.error };

    try {
      const dirents = fs.readdirSync(g.resolved, { withFileTypes: true });
      const entries: FileEntry[] = dirents
        .filter((d) => {
          if (!showHidden && d.name.startsWith('.')) return false;
          return true;
        })
        .map((d) => {
          const full = path.join(g.resolved, d.name);
          let size = 0;
          let mtime = 0;
          try {
            const stat = fs.statSync(full);
            size = stat.size;
            mtime = stat.mtimeMs;
          } catch { /* permissions etc */ }
          return {
            name: d.name,
            path: full,
            isDirectory: d.isDirectory(),
            isFile: d.isFile(),
            size,
            extension: path.extname(d.name).toLowerCase().slice(1),
            modifiedAt: mtime,
          };
        })
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      return { path: g.resolved, entries };
    } catch (err: any) {
      return { path: dirPath, entries: [], error: err.message };
    }
  }

  /** Read a file (text only — binary detection via null-byte sniff). */
  readFile(filePath: string, encoding = 'utf-8'): { ok: boolean; content?: string; error?: string; size?: number } {
    const g = this.guard(filePath);
    if (!g.ok) return { ok: false, error: g.error };
    try {
      const stat = fs.statSync(g.resolved);
      if (!stat.isFile()) return { ok: false, error: 'Not a file' };
      if (stat.size > 5 * 1024 * 1024) return { ok: false, error: 'File too large (>5MB)' };

      // Binary sniff (first 4KB)
      const fd = fs.openSync(g.resolved, 'r');
      const head = Buffer.alloc(Math.min(4096, stat.size));
      fs.readSync(fd, head, 0, head.length, 0);
      fs.closeSync(fd);
      if (head.includes(0)) return { ok: false, error: 'Binary file' };

      const content = fs.readFileSync(g.resolved, encoding as BufferEncoding);
      return { ok: true, content, size: stat.size };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /** Write file content. */
  writeFile(filePath: string, content: string): { ok: boolean; error?: string } {
    const g = this.guard(filePath);
    if (!g.ok) return { ok: false, error: g.error };
    try {
      fs.writeFileSync(g.resolved, content, 'utf-8');
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /** Create a new file. */
  createFile(dirPath: string, name: string, content = ''): { ok: boolean; path?: string; error?: string } {
    const target = path.join(dirPath, name);
    const g = this.guard(target);
    if (!g.ok) return { ok: false, error: g.error };
    try {
      if (fs.existsSync(g.resolved)) return { ok: false, error: 'File already exists' };
      fs.writeFileSync(g.resolved, content, 'utf-8');
      return { ok: true, path: g.resolved };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /** Create a directory. */
  createDirectory(parentPath: string, name: string): { ok: boolean; path?: string; error?: string } {
    const target = path.join(parentPath, name);
    const g = this.guard(target);
    if (!g.ok) return { ok: false, error: g.error };
    try {
      fs.mkdirSync(g.resolved, { recursive: true });
      return { ok: true, path: g.resolved };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /** Rename/move a file or directory. */
  rename(oldPath: string, newPath: string): { ok: boolean; error?: string } {
    const g1 = this.guard(oldPath);
    const g2 = this.guard(newPath);
    if (!g1.ok) return { ok: false, error: g1.error };
    if (!g2.ok) return { ok: false, error: g2.error };
    try {
      fs.renameSync(g1.resolved, g2.resolved);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /** Delete a file or directory. */
  delete(targetPath: string): { ok: boolean; error?: string } {
    const g = this.guard(targetPath);
    if (!g.ok) return { ok: false, error: g.error };
    try {
      const stat = fs.statSync(g.resolved);
      if (stat.isDirectory()) {
        fs.rmSync(g.resolved, { recursive: true });
      } else {
        fs.unlinkSync(g.resolved);
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /** Get stat info. */
  stat(targetPath: string): { ok: boolean; data?: FileEntry; error?: string } {
    const g = this.guard(targetPath);
    if (!g.ok) return { ok: false, error: g.error };
    try {
      const stat = fs.statSync(g.resolved);
      return {
        ok: true,
        data: {
          name: path.basename(g.resolved),
          path: g.resolved,
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile(),
          size: stat.size,
          extension: path.extname(g.resolved).toLowerCase().slice(1),
          modifiedAt: stat.mtimeMs,
        },
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Search workspace for files matching a query (filename substring).
   * Skips IGNORED_DIRS. Non-recursive by default; max depth 3 when recursive.
   */
  search(query: string, opts: { maxResults?: number; maxDepth?: number } = {}): FileEntry[] {
    if (!this.workspaceRoot || !query.trim()) return [];
    const maxResults = opts.maxResults ?? 50;
    const maxDepth = opts.maxDepth ?? 3;
    const lowerQuery = query.toLowerCase();
    const results: FileEntry[] = [];

    const walk = (dir: string, depth: number) => {
      if (results.length >= maxResults || depth > maxDepth) return;
      let dirents: fs.Dirent[];
      try { dirents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const d of dirents) {
        if (results.length >= maxResults) break;
        if (d.name.startsWith('.') || IGNORED_DIRS.has(d.name)) continue;
        if (d.name.toLowerCase().includes(lowerQuery)) {
          const full = path.join(dir, d.name);
          let size = 0; let mtime = 0;
          try { const s = fs.statSync(full); size = s.size; mtime = s.mtimeMs; } catch {}
          results.push({
            name: d.name, path: full, isDirectory: d.isDirectory(), isFile: d.isFile(),
            size, extension: path.extname(d.name).toLowerCase().slice(1), modifiedAt: mtime,
          });
        }
        if (d.isDirectory()) walk(path.join(dir, d.name), depth + 1);
      }
    };

    walk(this.workspaceRoot, 0);
    return results.slice(0, maxResults);
  }
}

// Singleton
export const filesystemService = new FilesystemService();
