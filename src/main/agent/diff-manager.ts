/**
 * NEX AI — Diff Manager
 *
 * Manages proposed file changes:
 *  - Compute diff between original and proposed content
 *  - Track pending diffs (awaiting user approval)
 *  - Apply approved diffs (write the new content)
 *  - Reject denied diffs (no change)
 *
 * Diff format: unified diff (compatible with `git diff` output).
 *
 * This module is the boundary between "AI proposes a change" and "file on disk changes".
 * Without explicit user approval, NOTHING is written.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentLogger } from './logger';

export interface ProposedChange {
  id: string;
  taskId: string;
  stepId: string;
  filePath: string;
  beforeContent: string;
  afterContent: string;
  diff: string;
  createdAt: number;
  status: 'pending' | 'accepted' | 'rejected' | 'applied' | 'failed';
  reason?: string;
  appliedAt?: number;
  error?: string;
}

const _pendingChanges = new Map<string, ProposedChange>();

/**
 * Propose a file change. The change is stored in memory until the user approves.
 */
export function proposeChange(
  taskId: string,
  stepId: string,
  filePath: string,
  beforeContent: string,
  afterContent: string
): ProposedChange {
  const diff = computeUnifiedDiff(beforeContent, afterContent, filePath);
  const change: ProposedChange = {
    id: `change-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    taskId,
    stepId,
    filePath,
    beforeContent,
    afterContent,
    diff,
    createdAt: Date.now(),
    status: 'pending',
  };
  _pendingChanges.set(change.id, change);
  AgentLogger.log({
    level: 'info',
    category: 'tool',
    message: `Proposed change to ${filePath} (${diff.split('\n').filter((l) => l.startsWith('+') || l.startsWith('-')).length} lines changed)`,
    taskId,
    stepId,
    data: { changeId: change.id, filePath, lineCount: diff.split('\n').length },
  });
  return change;
}

/**
 * Compute a unified diff between two strings.
 * Pure TypeScript implementation (no external diff library).
 *
 * Uses Myers-like algorithm — line-based, with context lines.
 */
export function computeUnifiedDiff(before: string, after: string, filePath: string): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const diff: string[] = [];
  diff.push(`--- a/${filePath}`);
  diff.push(`+++ b/${filePath}`);

  // Simple LCS-based diff (line-by-line)
  // For Phase 7 we use a simple approach: walk through both line arrays
  // and emit changes. This is not as smart as Myers, but adequate for short diffs.
  //
  // Phase 8 / P8-C BUGFIX: LCS entries must be (i,j) PAIRS. The previous
  // single-index form treated "lcs[k]===i && lcs[k]===j" as a match, which is
  // wrong whenever the paired j ≠ i (e.g. new files: before='' vs content —
  // the diff dropped the real content lines). Pair form fixes new-file diffs
  // and any case where common lines appear at shifted positions.
  const pairs = computeLCSPairs(beforeLines, afterLines);
  let i = 0, j = 0, k = 0;
  let contextLines: string[] = [];
  const CONTEXT = 3; // lines of context

  while (i < beforeLines.length || j < afterLines.length) {
    if (k < pairs.length && pairs[k][0] === i && pairs[k][1] === j) {
      // Matching line
      contextLines.push(` ${beforeLines[i]}`);
      i++; j++; k++;
    } else {
      // Differs — emit context then changes
      if (contextLines.length > CONTEXT) {
        // Trim to last CONTEXT lines
        contextLines = contextLines.slice(-CONTEXT);
      }
      // Flush context
      diff.push(...contextLines);
      contextLines = [];

      // Emit deletions
      while (i < beforeLines.length && (k >= pairs.length || pairs[k][0] !== i)) {
        diff.push(`-${beforeLines[i]}`);
        i++;
      }
      // Emit additions
      while (j < afterLines.length && (k >= pairs.length || pairs[k][1] !== j)) {
        diff.push(`+${afterLines[j]}`);
        j++;
      }
    }
  }
  // Flush remaining context
  if (contextLines.length > 0) {
    diff.push(...contextLines.slice(-CONTEXT));
  }

  return diff.join('\n');
}

/**
 * Compute Longest Common Subsequence of two string arrays.
 * Returns (i,j) index PAIRS — positions in BOTH arrays that are common.
 */
function computeLCSPairs(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length, n = b.length;
  // For Phase 7: simple DP. For large files this is O(m*n) — should be fine
  // for typical source files (< 10k lines).
  // If we hit perf issues, switch to Myers algorithm.
  const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  // Backtrack
  const result: Array<[number, number]> = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift([i - 1, j - 1]);
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return result;
}

/**
 * Get a pending change by ID.
 */
export function getPendingChange(changeId: string): ProposedChange | null {
  return _pendingChanges.get(changeId) || null;
}

/**
 * List pending changes for a task.
 */
export function listPendingChanges(taskId: string): ProposedChange[] {
  return Array.from(_pendingChanges.values()).filter((c) => c.taskId === taskId);
}

/**
 * Accept a proposed change and apply it to disk.
 */
export async function acceptChange(changeId: string): Promise<ProposedChange> {
  const change = _pendingChanges.get(changeId);
  if (!change) {
    throw new Error(`Change not found: ${changeId}`);
  }
  if (change.status !== 'pending') {
    throw new Error(`Change is not pending (status: ${change.status})`);
  }
  try {
    // Ensure parent directory exists
    const dir = path.dirname(change.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(change.filePath, change.afterContent, 'utf-8');
    change.status = 'applied';
    change.appliedAt = Date.now();
    AgentLogger.log({
      level: 'info',
      category: 'tool',
      message: `Applied change to ${change.filePath}`,
      taskId: change.taskId,
      stepId: change.stepId,
      data: { changeId },
    });
  } catch (err: any) {
    change.status = 'failed';
    change.error = err.message;
    AgentLogger.error(`Failed to apply change: ${err.message}`, {
      taskId: change.taskId,
      stepId: change.stepId,
      data: { changeId, error: err.message },
    });
    throw err;
  }
  return change;
}

/**
 * Reject a proposed change. The file on disk is NOT modified.
 */
export function rejectChange(changeId: string, reason?: string): ProposedChange {
  const change = _pendingChanges.get(changeId);
  if (!change) {
    throw new Error(`Change not found: ${changeId}`);
  }
  change.status = 'rejected';
  change.reason = reason;
  AgentLogger.log({
    level: 'info',
    category: 'tool',
    message: `Rejected change to ${change.filePath}: ${reason || '(no reason given)'}`,
    taskId: change.taskId,
    stepId: change.stepId,
    data: { changeId, reason },
  });
  return change;
}

/**
 * Accept ALL pending changes for a task.
 */
export async function acceptAllChanges(taskId: string): Promise<ProposedChange[]> {
  const changes = listPendingChanges(taskId).filter((c) => c.status === 'pending');
  const applied: ProposedChange[] = [];
  for (const change of changes) {
    try {
      applied.push(await acceptChange(change.id));
    } catch (err: any) {
      // Continue with other changes
    }
  }
  return applied;
}

/**
 * Reject ALL pending changes for a task.
 */
export function rejectAllChanges(taskId: string, reason?: string): ProposedChange[] {
  const changes = listPendingChanges(taskId).filter((c) => c.status === 'pending');
  const rejected: ProposedChange[] = [];
  for (const change of changes) {
    rejected.push(rejectChange(change.id, reason));
  }
  return rejected;
}

/**
 * Clear all changes for a task (after task completes).
 */
export function clearTaskChanges(taskId: string): void {
  for (const [id, change] of _pendingChanges.entries()) {
    if (change.taskId === taskId) {
      _pendingChanges.delete(id);
    }
  }
}
