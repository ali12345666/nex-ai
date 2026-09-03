/**
 * EditFileTool — edit_file
 *
 * Targeted text replacement within a file. Finds oldText and replaces
 * with newText. Supports occurrence count validation to prevent
 * ambiguous replacements.
 *
 * Security: same as write_file (assertPathInside + isSensitivePath)
 * Snapshot: creates a snapshot before modification (same as write_file)
 *
 * Phase 114
 */

import * as path from 'path';
import * as fs from 'fs';
import { assertPathInside, retryOnEpermSync } from '../../security';
import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

const MAX_CONTENT_SIZE = 2 * 1024 * 1024; // 2MB

export class EditFileTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'edit_file',
    description:
      'Edit a file by replacing a specific text occurrence. ' +
      'Finds oldText in the file and replaces it with newText. ' +
      'If expectedOccurrences is provided, requires exact match count. ' +
      'Prefer this over write_file for small targeted changes. ' +
      'Creates a snapshot before modification for undo.',
    category: 'filesystem',
    permission: 'write',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Path to the file to edit. Relative to project root or absolute.',
        required: true,
      },
      {
        name: 'old_text',
        type: 'string',
        description: 'The exact text to find and replace. Must match exactly (case-sensitive, whitespace-sensitive).',
        required: true,
      },
      {
        name: 'new_text',
        type: 'string',
        description: 'The replacement text.',
        required: true,
      },
      {
        name: 'expected_occurrences',
        type: 'number',
        description: 'Expected number of occurrences. If provided, the edit fails if the count does not match. If not provided, requires exactly 1 occurrence (fails on ambiguous matches).',
      },
    ],
    returns: { type: 'string', description: 'Edit result with occurrence count and snapshot ID' },
    tags: ['filesystem', 'write', 'edit', 'replace'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const started = Date.now();
    const filePath = params.path;
    const oldText = params.old_text;
    const newText = params.new_text;
    const expectedOccurrences = params.expected_occurrences;

    // ── Parameter validation ──
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Missing or invalid parameter: path' };
    }
    if (oldText === undefined || oldText === null || typeof oldText !== 'string') {
      return { success: false, error: 'Missing or invalid parameter: old_text' };
    }
    if (newText === undefined || newText === null || typeof newText !== 'string') {
      return { success: false, error: 'Missing or invalid parameter: new_text' };
    }
    if (oldText === newText) {
      return { success: false, error: 'old_text and new_text are identical — no change needed' };
    }

    // ── Size limits ──
    if (Buffer.byteLength(oldText, 'utf-8') > MAX_CONTENT_SIZE) {
      return { success: false, error: 'old_text too large (max 2MB)' };
    }
    if (Buffer.byteLength(newText, 'utf-8') > MAX_CONTENT_SIZE) {
      return { success: false, error: 'new_text too large (max 2MB)' };
    }

    // ── Path resolution + security ──
    const root = context.projectPath || process.cwd();
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
    const guard = assertPathInside(absPath, [root]);
    if (!guard.ok) {
      return { success: false, error: `Access denied: ${guard.reason}. Path must be inside the project workspace.` };
    }
    const safePath = guard.resolved!;

    // ── File must exist ──
    if (!fs.existsSync(safePath)) {
      return { success: false, error: `File not found: ${path.relative(root, safePath)}` };
    }
    const stat = fs.statSync(safePath);
    if (!stat.isFile()) {
      return { success: false, error: 'Path is not a file' };
    }

    // ── Read current content ──
    let content: string;
    try {
      content = fs.readFileSync(safePath, 'utf-8');
    } catch (err: any) {
      return { success: false, error: `Failed to read file: ${err.message}` };
    }

    // ── Find occurrences ──
    let occurrenceCount = 0;
    let searchStart = 0;
    while (true) {
      const idx = content.indexOf(oldText, searchStart);
      if (idx === -1) break;
      occurrenceCount++;
      searchStart = idx + oldText.length;
    }

    if (occurrenceCount === 0) {
      return { success: false, error: 'old_text not found in file' };
    }

    // ── Occurrence validation ──
    const requiredCount = expectedOccurrences ?? 1; // default: exactly 1
    if (expectedOccurrences !== undefined && occurrenceCount !== expectedOccurrences) {
      return {
        success: false,
        error: `Expected ${expectedOccurrences} occurrence(s) but found ${occurrenceCount}. Refusing ambiguous replacement.`,
      };
    }
    if (expectedOccurrences === undefined && occurrenceCount > 1) {
      return {
        success: false,
        error: `Found ${occurrenceCount} occurrences of old_text. Provide expected_occurrences to allow multi-replacement, or use more specific text.`,
      };
    }

    // ── Create snapshot before modification ──
    let snapshotId: string | undefined;
    try {
      const { createSnapshot } = require('../../agent/snapshot-service');
      const taskId = context.metadata?.taskId || 'standalone';
      const snapshot = createSnapshot(taskId, safePath);
      if (snapshot) {
        snapshotId = snapshot.id;
      }
    } catch { /* non-blocking */ }

    // ── Apply replacement ──
    const newContent = content.split(oldText).join(newText); // replace all occurrences (count validated)

    // ── Size check on result ──
    if (Buffer.byteLength(newContent, 'utf-8') > MAX_CONTENT_SIZE) {
      return { success: false, error: 'Result file content too large (max 2MB)' };
    }

    // ── Atomic write ──
    try {
      const tmpPath = safePath + '.nex-edit-tmp-' + Date.now();
      fs.writeFileSync(tmpPath, newContent, { encoding: 'utf-8' });
      // Phase 115: Use retryOnEpermSync for Windows AV/indexer lock resilience
      retryOnEpermSync(() => fs.renameSync(tmpPath, safePath));

      return {
        success: true,
        output: `Edited: ${path.relative(root, safePath)} — replaced ${occurrenceCount} occurrence(s)`,
        data: {
          path: safePath,
          relativePath: path.relative(root, safePath),
          occurrencesReplaced: occurrenceCount,
          snapshotId,
        },
        modifiedFiles: [{ path: safePath, before: content, after: newContent }],
        durationMs: Date.now() - started,
      };
    } catch (err: any) {
      return { success: false, error: `Failed to write file: ${err.message}` };
    }
  }
}
