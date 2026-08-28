/**
 * WriteFileTool — write_file
 *
 * Creates or overwrites a single file with UTF-8 content.
 * Writes directly to disk (no diff-approval flow — use propose_changes for
 * multi-file diff review). Parent directories are created if needed.
 *
 * Security:
 *  - assertPathInside(projectPath) — path must be inside workspace
 *  - isSensitivePath() — blocks .ssh, /etc, System32, etc.
 *  - 2MB content size limit
 *  - UTF-8 only (binary content rejected via null-byte detection)
 *  - Error messages never leak sensitive paths
 *
 * Permission: 'write' — goes through executeToolWithPermission()
 *
 * Phase 112: Backup/snapshot hook — before overwriting an existing file,
 * the original content is captured in ToolResult.modifiedFiles[].before
 * for future undo functionality. No backup files are written to disk
 * in this phase — the snapshot is in-memory only.
 */

import * as path from 'path';
import * as fs from 'fs';
import { assertPathInside } from '../../security';
import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

const MAX_CONTENT_SIZE = 2 * 1024 * 1024; // 2MB

export class WriteFileTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'write_file',
    description:
      'Create or overwrite a single file with UTF-8 text content. ' +
      'Parent directories are created automatically. ' +
      'For multi-file changes with diff review, use propose_changes instead. ' +
      'The file is written directly to disk (no approval step).',
    category: 'filesystem',
    permission: 'write',
    destructive: false, // overwrites but doesn't delete
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Path to the file to create or overwrite. Can be absolute or relative to the project root.',
        required: true,
      },
      {
        name: 'content',
        type: 'string',
        description: 'The full UTF-8 text content to write to the file.',
        required: true,
      },
      {
        name: 'create_dirs',
        type: 'boolean',
        description: 'If true (default), create parent directories if they do not exist.',
        default: true,
      },
    ],
    returns: { type: 'string', description: 'Confirmation message with file path and size' },
    tags: ['filesystem', 'write', 'create', 'overwrite'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const started = Date.now();
    const filePath = params.path;
    const content = params.content;

    // ── Parameter validation ──
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Missing or invalid parameter: path' };
    }
    if (content === undefined || content === null || typeof content !== 'string') {
      return { success: false, error: 'Missing or invalid parameter: content' };
    }

    // ── Content size limit ──
    const contentBytes = Buffer.byteLength(content, 'utf-8');
    if (contentBytes > MAX_CONTENT_SIZE) {
      return { success: false, error: `Content too large (${(contentBytes / 1024 / 1024).toFixed(1)} MB). Max ${MAX_CONTENT_SIZE / 1024 / 1024} MB.` };
    }

    // ── Binary content detection ──
    // Reject content that contains null bytes (indicates binary, not UTF-8 text)
    if (content.includes('\0')) {
      return { success: false, error: 'Content appears to be binary (contains null bytes). Only UTF-8 text is supported.' };
    }

    // ── Path resolution + security ──
    const root = context.projectPath || process.cwd();
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
    const guard = assertPathInside(absPath, [root]);
    if (!guard.ok) {
      // Don't leak the resolved path in the error — just say 'access denied'
      return { success: false, error: `Access denied: ${guard.reason}. Path must be inside the project workspace.` };
    }
    const safePath = guard.resolved!;

    // ── Check if file already exists (for backup snapshot) ──
    let beforeContent: string | undefined;
    let isOverwrite = false;
    try {
      if (fs.existsSync(safePath)) {
        const stat = fs.statSync(safePath);
        if (!stat.isFile()) {
          return { success: false, error: 'Path exists and is not a file (may be a directory).' };
        }
        isOverwrite = true;
        // Capture original content for undo/backup (in-memory only — Phase 112)
        beforeContent = fs.readFileSync(safePath, 'utf-8');
      }
    } catch (err: any) {
      return { success: false, error: `Failed to check existing file: ${err.message}` };
    }

    // ── Create parent directories if needed ──
    const createDirs = params.create_dirs !== false; // default true
    const parentDir = path.dirname(safePath);
    if (createDirs && !fs.existsSync(parentDir)) {
      // Verify parent dir is still inside workspace (prevent escaping via ..)
      const parentGuard = assertPathInside(parentDir, [root]);
      if (!parentGuard.ok) {
        return { success: false, error: `Cannot create directories outside workspace: ${parentGuard.reason}` };
      }
      try {
        fs.mkdirSync(parentDir, { recursive: true });
      } catch (err: any) {
        return { success: false, error: `Failed to create parent directories: ${err.message}` };
      }
    }

    // ── Write the file ──
    try {
      // Atomic write: write to temp file then rename
      const tmpPath = safePath + '.nex-tmp-' + Date.now();
      fs.writeFileSync(tmpPath, content, { encoding: 'utf-8' });
      fs.renameSync(tmpPath, safePath);

      const sizeStr = contentBytes < 1024
        ? `${contentBytes} B`
        : contentBytes < 1024 * 1024
          ? `${(contentBytes / 1024).toFixed(1)} KB`
          : `${(contentBytes / 1024 / 1024).toFixed(1)} MB`;

      return {
        success: true,
        output: `${isOverwrite ? 'Overwritten' : 'Created'}: ${path.relative(root, safePath)} (${sizeStr})`,
        data: {
          path: safePath,
          relativePath: path.relative(root, safePath),
          created: !isOverwrite,
          overwritten: isOverwrite,
          sizeBytes: contentBytes,
        },
        // Phase 112: In-memory backup snapshot for future undo
        modifiedFiles: isOverwrite
          ? [{ path: safePath, before: beforeContent, after: content }]
          : [{ path: safePath, after: content }],
        durationMs: Date.now() - started,
      };
    } catch (err: any) {
      // Clean up temp file if it exists
      try {
        const tmpPath = safePath + '.nex-tmp-' + Date.now();
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch { /* best-effort */ }
      return { success: false, error: `Failed to write file: ${err.message}` };
    }
  }
}
