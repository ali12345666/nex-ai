import React, { useState, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { Search, FileCode, Loader2, X } from 'lucide-react';

interface SearchResult {
  raw: string;
}

export default function SearchPanel() {
  const { projectPath } = useStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!projectPath || !query.trim()) return;
    setLoading(true);
    const result = await window.nexAPI.fsSearchContent(projectPath, query.trim());
    setResults(result.results || []);
    setLoading(false);
  }, [projectPath, query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search Input */}
      <div className="p-2 border-b border-[var(--nex-glass-border)]/50">
        <div className="flex items-center gap-2 bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)] rounded-lg px-3 py-2 focus-within:border-[var(--nex-accent)]/50 transition-colors">
          <Search size={14} className="text-[var(--nex-text-dim)] shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search in files..."
            className="bg-transparent text-sm text-[var(--nex-text)] placeholder-[var(--nex-text-muted)] outline-none w-full"
          />
          {query && (
            <button onClick={() => { setQuery(''); setResults([]); }} className="text-[var(--nex-text-dim)] hover:text-[var(--nex-text)]">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-20">
            <Loader2 size={16} className="animate-spin text-[var(--nex-accent)]" />
          </div>
        ) : results.length > 0 ? (
          <div className="py-1">
            <div className="px-3 py-1">
              <span className="text-[10px] text-[var(--nex-text-muted)] uppercase tracking-wider font-semibold">
                {results.length} results
              </span>
            </div>
            {results.map((r, i) => (
              <div key={i} className="px-3 py-1.5 text-[12px] hover:bg-white/[0.04] cursor-pointer transition-colors border-l-2 border-transparent hover:border-[var(--nex-accent)]">
                <span className="font-mono text-[var(--nex-text-dim)]">{r.raw}</span>
              </div>
            ))}
          </div>
        ) : query ? (
          <div className="flex flex-col items-center justify-center h-32 text-[var(--nex-text-muted)]">
            <Search size={24} className="mb-2 opacity-30" />
            <p className="text-xs">No results found</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-32 text-[var(--nex-text-muted)]">
            <Search size={24} className="mb-2 opacity-30" />
            <p className="text-xs text-center px-4">Type a query and press Enter to search in project files</p>
          </div>
        )}
      </div>
    </div>
  );
}
