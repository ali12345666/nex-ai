import React, { useState, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { AlertTriangle, AlertCircle, Info, RefreshCw, Loader2 } from 'lucide-react';

interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
}

export default function DiagnosticsPanel() {
  const { projectPath, activeFile } = useStore();
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [loading, setLoading] = useState(false);

  const runDiagnostics = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    setDiagnostics([]);

    const results: Diagnostic[] = [];

    // Check TypeScript errors
    try {
      // Phase 26: safe IPC (replaces removed execCommand — Phase 1 security)
      const tsResult = await window.nexAPI.runTscCheck(projectPath);
      if (tsResult.success && tsResult.output) {
        const lines = tsResult.output.split('\n').filter((l: string) => l.includes('error TS'));
        lines.slice(0, 30).forEach((line: string) => {
          const match = line.match(/^(.+?)\((\d+),\d+\): error (TS\d+): (.+)/);
          if (match) {
            results.push({
              severity: 'error',
              file: match[1],
              line: parseInt(match[2]),
              message: `${match[3]}: ${match[4]}`,
            });
          }
        });
      }
    } catch {}

    // Check for common issues
    try {
      const pkgResult = await window.nexAPI.readFile(`${projectPath}/package.json`);
      if (pkgResult.success && pkgResult.content) {
        const pkg = JSON.parse(pkgResult.content);
        if (!pkg.scripts?.test) {
          results.push({ severity: 'info', message: 'No test script defined in package.json' });
        }
        if (!pkg.devDependencies?.eslint && !pkg.devDependencies?.['@eslint/eslintrc']) {
          results.push({ severity: 'warning', message: 'ESLint not found in devDependencies' });
        }
      }
    } catch {}

    setDiagnostics(results);
    setLoading(false);
  }, [projectPath]);

  const iconFor = (severity: string) => {
    switch (severity) {
      case 'error': return <AlertCircle size={12} className="text-red-400 shrink-0" />;
      case 'warning': return <AlertTriangle size={12} className="text-yellow-400 shrink-0" />;
      default: return <Info size={12} className="text-blue-400 shrink-0" />;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-nex-border/50">
        <div className="flex items-center gap-2">
          <AlertTriangle size={13} className="text-nex-warning" />
          <span className="text-xs font-medium text-nex-text-dim">Problems</span>
          {diagnostics.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-nex-card text-nex-text-dim">{diagnostics.length}</span>
          )}
        </div>
        <button onClick={runDiagnostics} disabled={loading || !projectPath}
          className="w-6 h-6 rounded flex items-center justify-center text-nex-text-dim hover:text-nex-text hover:bg-nex-card transition-all disabled:opacity-50" title="Run diagnostics">
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {diagnostics.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-nex-text-muted p-4">
            <AlertTriangle size={24} className="mb-2 opacity-30" />
            <p className="text-xs text-center">{projectPath ? 'Click refresh to run diagnostics' : 'Open a project first'}</p>
          </div>
        ) : (
          <div className="py-1">
            {diagnostics.map((d, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 hover:bg-nex-card cursor-pointer transition-colors text-[12px]">
                {iconFor(d.severity)}
                <div className="min-w-0 flex-1">
                  <div className="text-nex-text truncate">{d.message}</div>
                  {d.file && <div className="text-[10px] text-nex-text-muted mt-0.5">{d.file}{d.line ? `:${d.line}` : ''}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
