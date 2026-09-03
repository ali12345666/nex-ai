/**
 * MultiFileEditTool — propose_changes (Phase 8 / P8-C)
 *
 * The advanced agent proposes edits to MULTIPLE files in ONE tool call.
 * NOTHING is written to disk here — every edit goes through the Phase 7
 * diff-manager as a pending ProposedChange, which the user must approve
 * (AgentDiffViewer UI) before anything touches the filesystem. Atomic-ish:
 * all files in one batch share the same taskId/stepId so accept/reject is
 * reviewable per file.
 *
 * Security:
 *  - assertPathInside(projectPath) on every target (Phase 1 layer)
 *  - permission 'write' (user approval prompt via PermissionManager)
 *  - per-file size cap 2MB; max 10 files per call
 *  - create/read-before-write semantics: existing content captured for diff
 */

import * as path from 'path';
import * as fs from 'fs';
import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';
import { assertPathInside } from '../../security';
import { proposeChange } from '../../agent/diff-manager';

const MAX_FILES = 10;
const PER_FILE_LIMIT = 2 * 1024 * 1024; // 2MB

interface EditSpec {
  path: string;
  content: string;
}

interface EditOutcome {
  path: string;
  changeId: string;
  created: boolean;
  linesChanged: number;
  error?: string;
}

export class MultiFileEditTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'propose_changes',
    description:
      'Propose edits to multiple files at once. Does NOT write to disk — creates pending ' +
      'changes with unified diffs that the USER must approve. Supports creating new files. ' +
      `Max ${MAX_FILES} files, 2MB each. Prefer this over many single-file edits.`,
    category: 'filesystem',
    permission: 'write',
    parameters: [
      {
        name: 'edits',
        type: 'array',
        description:
          'Array of { path: string, content: string } — content is the FULL new file content',
        required: true,
      },
      {
        name: 'description',
        type: 'string',
        description: 'Short human-readable summary of WHY these edits are made (shown in review UI)',
        required: false,
      },
    ],
    returns: { type: 'string', description: 'Per-file outcome with change ids for review' },
    tags: ['filesystem', 'write', 'diff', 'batch', 'agent'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const started = Date.now();
    const editsRaw: unknown = params.edits;
    if (!Array.isArray(editsRaw) || editsRaw.length === 0) {
      return { success: false, error: 'Parameter "edits" must be a non-empty array of {path, content}.' };
    }
    if (editsRaw.length > MAX_FILES) {
      return { success: false, error: `Too many files: ${editsRaw.length}. Max ${MAX_FILES} per call.` };
    }

    const taskId: string | undefined = context.metadata?.taskId;
    const stepId: string | undefined = context.metadata?.stepId;
    if (!taskId || !stepId) {
      return { success: false, error: 'propose_changes requires agent task context (taskId/stepId in metadata).' };
    }

    const root = context.projectPath || process.cwd();
    const outcomes: EditOutcome[] = [];
    let failures = 0;

    for (const e of editsRaw) {
      const spec = e as Partial<EditSpec>;
      if (typeof spec.path !== 'string' || typeof spec.content !== 'string') {
        outcomes.push({ path: String(spec.path), changeId: '', created: false, linesChanged: 0, error: 'invalid edit spec (path+content required)' });
        failures++;
        continue;
      }
      if (Buffer.byteLength(spec.content, 'utf-8') > PER_FILE_LIMIT) {
        outcomes.push({ path: spec.path, changeId: '', created: false, linesChanged: 0, error: 'content exceeds 2MB limit' });
        failures++;
        continue;
      }

      const abs = path.isAbsolute(spec.path) ? spec.path : path.join(root, spec.path);
      const guard = assertPathInside(abs, [root]);
      if (!guard.ok) {
        outcomes.push({ path: spec.path, changeId: '', created: false, linesChanged: 0, error: `blocked: ${guard.reason}` });
        failures++;
        continue;
      }
      const safe = guard.resolved!;

      // Capture current content (empty for new files) for the diff
      let before = '';
      let created = false;
      if (fs.existsSync(safe)) {
        if (!fs.statSync(safe).isFile()) {
          outcomes.push({ path: spec.path, changeId: '', created: false, linesChanged: 0, error: 'path exists and is not a file' });
          failures++;
          continue;
        }
        before = fs.readFileSync(safe, 'utf-8');
      } else {
        created = true;
      }

      // No-op guard: identical content produces no pending change
      if (before === spec.content) {
        outcomes.push({ path: spec.path, changeId: '', created: false, linesChanged: 0, error: 'no changes (content identical)' });
        continue;
      }

      const change = proposeChange(taskId, stepId, safe, before, spec.content);
      const linesChanged = change.diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++') || l.startsWith('-') && !l.startsWith('---')).length;
      outcomes.push({ path: spec.path, changeId: change.id, created, linesChanged });
    }

    const okCount = outcomes.filter((o) => o.changeId !== '').length;
    const summary =
      `${okCount}/${outcomes.length} edits proposed${params.description ? ` — ${params.description}` : ''}\n` +
      outcomes
        .map((o) =>
          o.changeId
            ? `  ✓ ${o.path}${o.created ? ' (new)' : ''} — ${o.linesChanged} lines changed → ${o.changeId} (awaiting approval)`
            : `  ✗ ${o.path} — ${o.error}`
        )
        .join('\n') +
      `\nNothing is written until the user approves in the Diff review UI.`;

    return {
      success: failures < outcomes.length,
      output: summary,
      data: { outcomes, okCount, failures, description: params.description },
      modifiedFiles: outcomes
        .filter((o) => o.changeId)
        .map((o) => ({
          path: o.path,
          after: (editsRaw.find((e) => (e as Partial<EditSpec>).path === o.path) as EditSpec).content,
        })),
      error: failures === outcomes.length ? 'All edits failed' : undefined,
      durationMs: Date.now() - started,
    };
  }
}
