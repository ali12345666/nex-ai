/**
 * ProjectStructureTool — project_structure (Phase 8 / P8-C)
 *
 * Builds a compact, LLM-optimized map of the project: directory tree with
 * file sizes + language stats + key manifest files (package.json deps, etc).
 * This is what an advanced coding agent reads FIRST to orient itself —
 * far cheaper than listing directories one by one.
 *
 * Security: read-only, root-jailed via assertPathInside, ignore-list for
 * junk (node_modules/.git/dist...), hard caps on entries + depth.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { assertPathInside } from '../../security';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'release', 'out', 'build',
  '.next', '.cache', 'coverage', '__pycache__', '.venv', 'target',
]);
const IGNORED_FILE_EXT = new Set(['.exe', '.dll', '.so', '.dylib', '.bin', '.gguf', '.zip', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf']);
const MAX_ENTRIES = 800;
const MAX_DEPTH = 6;

interface TreeStats {
  files: number;
  dirs: number;
  truncated: boolean;
  byExt: Record<string, number>;
}

function buildTree(dir: string, prefix: string, depth: number, stats: TreeStats, lines: string[]): void {
  if (depth > MAX_DEPTH || stats.truncated) return;
  let items: fs.Dirent[];
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    lines.push(`${prefix}[unreadable]`);
    return;
  }
  const visible = items
    .filter((i) => !i.name.startsWith('.git'))
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));

  for (const item of visible) {
    if (stats.files + stats.dirs >= MAX_ENTRIES) { stats.truncated = true; return; }
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (IGNORED_DIRS.has(item.name)) continue;
      stats.dirs++;
      lines.push(`${prefix}${item.name}/`);
      buildTree(full, `${prefix}  `, depth + 1, stats, lines);
    } else if (item.isFile()) {
      const ext = path.extname(item.name).toLowerCase();
      if (IGNORED_FILE_EXT.has(ext)) continue;
      let size = 0;
      try { size = fs.statSync(full).size; } catch { /* ignore */ }
      stats.files++;
      stats.byExt[ext || '(none)'] = (stats.byExt[ext || '(none)'] || 0) + 1;
      const sizeHint = size > 1024 ? ` (${(size / 1024).toFixed(0)}KB)` : '';
      lines.push(`${prefix}${item.name}${sizeHint}`);
    }
  }
}

export class ProjectStructureTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'project_structure',
    description:
      'Get an overview of the project: directory tree (with sizes), file-type stats, ' +
      'and dependencies from the manifest (package.json). Call this FIRST when exploring ' +
      `an unfamiliar project. Ignores node_modules/dist/etc. Max ${MAX_ENTRIES} entries, depth ${MAX_DEPTH}.`,
    category: 'filesystem',
    permission: 'read',
    parameters: [
      {
        name: 'subdir',
        type: 'string',
        description: 'Optional subdirectory to scope the tree to (relative to project root)',
        required: false,
      },
      {
        name: 'include_manifest',
        type: 'boolean',
        description: 'Include package.json name/deps summary (default true)',
        default: true,
      },
    ],
    returns: { type: 'string', description: 'Project tree + stats + manifest summary' },
    tags: ['filesystem', 'read', 'context', 'agent'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const started = Date.now();
    const root = context.projectPath || process.cwd();

    let scope = root;
    if (params.subdir && typeof params.subdir === 'string' && params.subdir.trim() !== '') {
      scope = path.isAbsolute(params.subdir) ? params.subdir : path.join(root, params.subdir);
    }

    const guard = assertPathInside(scope, [root]);
    if (!guard.ok) {
      return { success: false, error: `Blocked: ${guard.reason}` };
    }
    const safeScope = guard.resolved!;
    if (!fs.existsSync(safeScope) || !fs.statSync(safeScope).isDirectory()) {
      return { success: false, error: `Not a directory: ${params.subdir || root}` };
    }

    const stats: TreeStats = { files: 0, dirs: 0, truncated: false, byExt: {} };
    const lines: string[] = [];
    buildTree(safeScope, '', 0, stats, lines);

    const topExts = Object.entries(stats.byExt)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ext, n]) => `${ext}:${n}`)
      .join(' ');

    let manifestBlock = '';
    if (params.include_manifest !== false) {
      const pkgPath = path.join(safeScope, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          const deps = Object.keys(pkg.dependencies || {}).length;
          const devDeps = Object.keys(pkg.devDependencies || {}).length;
          manifestBlock =
            `\n\npackage.json: ${pkg.name || '(unnamed)'}@${pkg.version || '0.0.0'}` +
            `\n  scripts: ${Object.keys(pkg.scripts || {}).join(', ') || '(none)'}` +
            `\n  dependencies: ${deps}, devDependencies: ${devDeps}` +
            (deps > 0 ? `\n  deps: ${Object.keys(pkg.dependencies).join(', ')}` : '');
        } catch { /* malformed manifest — skip silently */ }
      }
    }

    const output =
      `Project: ${safeScope}\n` +
      `${stats.dirs} directories, ${stats.files} files${stats.truncated ? ' (TRUNCATED at limit)' : ''}\n` +
      `File types: ${topExts || '(none)'}\n\n` +
      lines.join('\n') +
      manifestBlock;

    return {
      success: true,
      output,
      data: { root: safeScope, files: stats.files, dirs: stats.dirs, truncated: stats.truncated, byExt: stats.byExt },
      durationMs: Date.now() - started,
    };
  }
}
