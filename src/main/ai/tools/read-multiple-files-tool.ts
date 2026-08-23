/**
 * ReadMultipleFilesTool — read_files (Phase 8 / P8-C)
 *
 * Batch-reads up to N files in ONE tool call. Advanced coding agents waste
 * many steps on sequential read_file calls; batching cuts round-trips —
 * especially valuable on the online backend where each call has latency.
 *
 * Security:
 *  - every path validated with assertPathInside(projectPath) (Phase 1 layer)
 *  - per-file size cap (1MB) + total budget cap (5MB) to protect context
 *  - permission 'read'
 */

import * as path from 'path';
import * as fs from 'fs';
import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { assertPathInside } from '../../security';

const MAX_FILES = 20;
const PER_FILE_LIMIT = 1024 * 1024;      // 1 MB
const TOTAL_LIMIT = 5 * 1024 * 1024;     // 5 MB

interface FileEntry {
  path: string;
  content?: string;
  error?: string;
  bytes: number;
}

export class ReadMultipleFilesTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'read_files',
    description:
      'Read multiple files in one call (batch). Provide relative or absolute paths. ' +
      `Each file is capped at 1MB; the batch total at 5MB; max ${MAX_FILES} files per call. ` +
      'Use this instead of repeated read_file calls to save steps.',
    category: 'filesystem',
    permission: 'read',
    parameters: [
      {
        name: 'paths',
        type: 'array',
        description: 'Array of file paths (relative to project root or absolute)',
        required: true,
      },
    ],
    returns: { type: 'string', description: 'Concatenated file contents with headers' },
    tags: ['filesystem', 'read', 'batch', 'agent'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const started = Date.now();
    const raw: unknown = params.paths;
    if (!Array.isArray(raw) || raw.length === 0) {
      return { success: false, error: 'Parameter "paths" must be a non-empty array of file paths.' };
    }
    if (raw.length > MAX_FILES) {
      return { success: false, error: `Too many files: ${raw.length}. Max ${MAX_FILES} per call.` };
    }

    const root = context.projectPath || process.cwd();
    const entries: FileEntry[] = [];
    let total = 0;
    let failures = 0;

    for (const p of raw) {
      if (typeof p !== 'string' || p.length === 0) {
        entries.push({ path: String(p), error: 'invalid path', bytes: 0 });
        failures++;
        continue;
      }
      const abs = path.isAbsolute(p) ? p : path.join(root, p);

      // Phase 1 security layer: escape protection
      const guard = assertPathInside(abs, [root]);
      if (!guard.ok) {
        entries.push({ path: p, error: guard.reason || 'path outside allowed roots', bytes: 0 });
        failures++;
        continue;
      }
      const safe = guard.resolved!;

      if (!fs.existsSync(safe)) {
        entries.push({ path: p, error: 'file not found', bytes: 0 });
        failures++;
        continue;
      }
      const stat = fs.statSync(safe);
      if (!stat.isFile()) {
        entries.push({ path: p, error: 'not a file', bytes: 0 });
        failures++;
        continue;
      }
      if (stat.size > PER_FILE_LIMIT) {
        entries.push({ path: p, error: `too large (${(stat.size / 1024).toFixed(0)}KB > 1MB)`, bytes: stat.size });
        failures++;
        continue;
      }
      if (total + stat.size > TOTAL_LIMIT) {
        entries.push({ path: p, error: 'batch size budget exceeded (5MB)', bytes: stat.size });
        failures++;
        continue;
      }

      try {
        const content = fs.readFileSync(safe, 'utf-8');
        total += stat.size;
        entries.push({ path: p, content, bytes: stat.size });
      } catch (err: any) {
        entries.push({ path: p, error: err.message, bytes: 0 });
        failures++;
      }
    }

    // Render one readable block for the model
    const parts: string[] = [];
    for (const e of entries) {
      if (e.content !== undefined) {
        parts.push(`──── ${e.path} (${e.bytes} bytes) ────\n${e.content}`);
      } else {
        parts.push(`──── ${e.path} ────\n[ERROR] ${e.error}`);
      }
    }

    return {
      success: entries.length > 0, // partial success counts; per-file errors visible
      output: parts.join('\n\n'),
      data: {
        files: entries.map((e) => ({ path: e.path, bytes: e.bytes, ok: e.content !== undefined, error: e.error })),
        okCount: entries.length - failures,
        errorCount: failures,
        totalBytes: total,
      },
      error: failures === entries.length ? 'All reads failed' : undefined,
      durationMs: Date.now() - started,
    };
  }
}
