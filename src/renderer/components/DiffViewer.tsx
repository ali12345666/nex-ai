import React, { useMemo } from 'react';
import { X, ArrowLeftRight } from 'lucide-react';

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

interface DiffViewerProps {
  oldContent: string;
  newContent: string;
  fileName: string;
  onClose: () => void;
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: DiffLine[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  let oldIdx = 0;
  let newIdx = 0;

  // Simple LCS-based diff
  const lcs = buildLCS(oldLines, newLines);
  let lcsIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (lcsIdx < lcs.length && oldIdx < oldLines.length && newIdx < newLines.length &&
        oldLines[oldIdx] === lcs[lcsIdx] && newLines[newIdx] === lcs[lcsIdx]) {
      result.push({ type: 'unchanged', content: oldLines[oldIdx], oldLineNum: oldIdx + 1, newLineNum: newIdx + 1 });
      oldIdx++; newIdx++; lcsIdx++;
    } else if (oldIdx < oldLines.length && (lcsIdx >= lcs.length || oldLines[oldIdx] !== lcs[lcsIdx])) {
      result.push({ type: 'removed', content: oldLines[oldIdx], oldLineNum: oldIdx + 1 });
      oldIdx++;
    } else if (newIdx < newLines.length) {
      result.push({ type: 'added', content: newLines[newIdx], newLineNum: newIdx + 1 });
      newIdx++;
    }
  }
  return result;
}

function buildLCS(a: string[], b: string[]): string[] {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
    }
  }
  const result: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i-1] === b[j-1]) { result.unshift(a[i-1]); i--; j--; }
    else if (dp[i-1][j] > dp[i][j-1]) i--;
    else j--;
  }
  return result;
}

export default function DiffViewer({ oldContent, newContent, fileName, onClose }: DiffViewerProps) {
  const lines = useMemo(() => computeDiff(oldContent, newContent), [oldContent, newContent]);
  const added = lines.filter((l) => l.type === 'added').length;
  const removed = lines.filter((l) => l.type === 'removed').length;

  return (
    <div className="h-full flex flex-col bg-nex-bg animate-in">
      <div className="h-10 flex items-center justify-between px-4 border-b border-nex-border bg-nex-surface shrink-0">
        <div className="flex items-center gap-3">
          <ArrowLeftRight size={14} className="text-nex-accent" />
          <span className="text-sm font-medium text-nex-text">Diff: {fileName}</span>
          <span className="text-[11px] text-green-400">+{added}</span>
          <span className="text-[11px] text-red-400">-{removed}</span>
        </div>
        <button onClick={onClose} className="w-7 h-7 rounded flex items-center justify-center text-nex-text-dim hover:text-nex-text hover:bg-nex-card transition-all">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-auto font-mono text-[13px]">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className={
                line.type === 'added' ? 'bg-green-500/10' :
                line.type === 'removed' ? 'bg-red-500/10' : ''
              }>
                <td className="w-12 text-right pr-2 py-0.5 text-nex-text-muted select-none text-[11px] border-r border-nex-border/30">
                  {line.oldLineNum || ''}
                </td>
                <td className="w-12 text-right pr-2 py-0.5 text-nex-text-muted select-none text-[11px] border-r border-nex-border/30">
                  {line.newLineNum || ''}
                </td>
                <td className="w-8 text-center py-0.5 select-none text-[11px]">
                  {line.type === 'added' && <span className="text-green-400">+</span>}
                  {line.type === 'removed' && <span className="text-red-400">-</span>}
                  {line.type === 'unchanged' && <span className="text-nex-text-muted"> </span>}
                </td>
                <td className="px-3 py-0.5 whitespace-pre text-nex-text">{line.content}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
