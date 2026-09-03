/**
 * NEX AI — Conversation History (Phase 32)
 *
 * Glass popover showing saved conversations grouped by time.
 * Search, rename, delete, open. Uses NEX token system.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, X, Pencil, Trash2, Check, MessageSquare, Clock } from 'lucide-react';

export interface ConversationMeta {
  id: string; title: string; createdAt: number; updatedAt: number;
  messageCount: number; workspace?: string; provider?: string; model?: string; mode?: string;
}

function timeGroup(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 86400000) return 'Today';
  if (diff < 172800000) return 'Yesterday';
  if (diff < 604800000) return 'This Week';
  if (diff < 2592000000) return 'This Month';
  return 'Older';
}

export interface ConversationHistoryProps {
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onClose: () => void;
}

export default function ConversationHistory({ activeId, onSelect, onNew, onDelete, onRename, onClose }: ConversationHistoryProps) {
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ConversationMeta[] | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const r = await window.nexAPI.conversationList();
      if (r.success) {
        setConversations(r.conversations || []);
      } else {
        setLoadError(r.error || 'Failed to load conversations');
      }
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Focus search on mount
  useEffect(() => { searchInputRef.current?.focus(); }, []);

  // Phase 34: Ctrl+K → focus search (even when already open)
  useEffect(() => {
    const handler = () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener('nex:focus-history-search', handler);
    return () => window.removeEventListener('nex:focus-history-search', handler);
  }, []);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    // Delay to avoid immediately closing from the click that opened it
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 100);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [onClose]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setSearchResults(null); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await window.nexAPI.conversationSearch(query);
        setSearchResults(r.results || []);
      } catch { setSearchResults([]); }
    }, 300);
  }, []);

  const groups = useMemo(() => {
    const list = searchResults ?? conversations;
    const grouped = new Map<string, ConversationMeta[]>();
    for (const conv of list) {
      const g = timeGroup(conv.updatedAt);
      if (!grouped.has(g)) grouped.set(g, []);
      grouped.get(g)!.push(conv);
    }
    return [...grouped.entries()];
  }, [conversations, searchResults]);

  const handleSelect = useCallback((id: string) => {
    if (id !== activeId) onSelect(id);
    onClose();
  }, [activeId, onSelect, onClose]);

  const handleRename = useCallback((id: string) => {
    setRenaming(id);
    const conv = conversations.find((c) => c.id === id);
    setRenameText(conv?.title || '');
  }, [conversations]);

  const confirmRename = useCallback(() => {
    if (renaming && renameText.trim()) onRename(renaming, renameText.trim());
    setRenaming(null);
    load();
  }, [renaming, renameText, onRename, load]);

  const handleDelete = useCallback((id: string) => {
    onDelete(id);
    setConfirmDelete(null);
    load();
  }, [onDelete, load]);

  return (
    <div
      ref={panelRef}
      className="absolute top-full right-0 mt-2 w-80 nex-glass-strong rounded-xl z-50 nex-animate-in"
      style={{ border: '1px solid var(--nex-panel-border)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
      role="dialog"
      aria-label="Conversation history"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        <span className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>CONVERSATIONS</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/[0.06]" style={{ color: 'var(--nex-text-muted)' }} aria-label="Close history">
          <X size={12} />
        </button>
      </div>

      {/* New + Search */}
      <div className="px-3 py-2 space-y-2">
        <button
          onClick={() => { onNew(); onClose(); }}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-medium nex-click"
          style={{ color: 'var(--nex-bg)', background: 'linear-gradient(135deg, var(--nex-accent), var(--nex-accent-secondary))' }}
        >
          <MessageSquare size={10} /> New Conversation
        </button>
        <div className="relative">
          <Search size={10} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--nex-text-muted)' }} />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search conversations…"
            aria-label="Search conversations"
            className="w-full bg-white/[0.03] border border-[var(--nex-glass-border)] rounded-md pl-7 pr-2 py-1 text-[10px] outline-none focus:border-[var(--nex-accent)]/30"
            style={{ color: 'var(--nex-text)' }}
          />
        </div>
      </div>

      {/* List */}
      <div className="max-h-64 overflow-y-auto nex-scroll px-1 pb-2" role="listbox" aria-label="Saved conversations">
        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-6 gap-2 text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>
            <span className="inline-block w-3 h-3 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: 'var(--nex-accent)', borderRightColor: 'var(--nex-accent-dim)' }} />
            Loading conversations…
          </div>
        )}
        {/* Error state */}
        {!isLoading && loadError && (
          <div className="flex flex-col items-center justify-center py-6 gap-2">
            <span className="text-[10px] text-red-400">{loadError}</span>
            <button onClick={load} className="px-2 py-1 rounded text-[9px] font-medium" style={{ color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }} aria-label="Retry loading conversations">
              Retry
            </button>
          </div>
        )}
        {/* Empty state (no conversations at all) */}
        {!isLoading && !loadError && conversations.length === 0 && !searchQuery && (
          <div className="flex flex-col items-center justify-center py-6 gap-2">
            <Clock size={14} style={{ color: 'var(--nex-text-muted)' }} />
            <span className="text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>No conversations yet</span>
            <span className="text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>Start chatting to create one</span>
          </div>
        )}
        {/* No search results */}
        {!isLoading && !loadError && searchQuery && searchResults !== null && searchResults.length === 0 && (
          <div className="flex flex-col items-center justify-center py-6 gap-2">
            <Search size={14} style={{ color: 'var(--nex-text-muted)' }} />
            <span className="text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>No results for "{searchQuery}"</span>
          </div>
        )}
        {/* Normal list */}
        {!isLoading && !loadError && groups.length > 0 && (
          <>
        {groups.map(([label, items]) => (
          <div key={label}>
            <div className="px-3 py-1 text-[8px] font-semibold tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>{label.toUpperCase()}</div>
            {items.map((conv) => {
              const isActive = conv.id === activeId;
              return (
                <div
                  key={conv.id}
                  role="option"
                  aria-selected={isActive}
                  className="group flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-white/[0.04]"
                  style={{ background: isActive ? 'var(--nex-accent-dim)' : 'transparent' }}
                  onClick={() => handleSelect(conv.id)}
                >
                  {renaming === conv.id ? (
                    <div className="flex-1 flex items-center gap-1">
                      <input
                        value={renameText}
                        onChange={(e) => setRenameText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setRenaming(null); }}
                        className="flex-1 bg-white/[0.05] border border-[var(--nex-accent)]/30 rounded px-1.5 py-0.5 text-[10px] outline-none"
                        style={{ color: 'var(--nex-text)' }}
                        autoFocus
                      />
                      <button onClick={confirmRename} className="p-0.5 rounded" style={{ color: 'var(--nex-success)' }}><Check size={10} /></button>
                    </div>
                  ) : confirmDelete === conv.id ? (
                    <div className="flex-1 flex items-center gap-2 text-[9px]">
                      <span className="text-red-400">Delete?</span>
                      <button onClick={() => handleDelete(conv.id)} className="px-1.5 py-0.5 rounded text-[8px] bg-red-500/20 text-red-300">Delete</button>
                      <button onClick={() => setConfirmDelete(null)} className="text-[8px]" style={{ color: 'var(--nex-text-muted)' }}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] truncate" style={{ color: isActive ? 'var(--nex-accent-text)' : 'var(--nex-text-dim)' }}>{conv.title}</div>
                        <div className="text-[8px]" style={{ color: 'var(--nex-text-muted)' }}>{conv.messageCount} msg</div>
                      </div>
                      {isActive && <span className="w-1 h-1 rounded-full shrink-0" style={{ background: 'var(--nex-accent)' }} aria-label="Active" />}
                      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); handleRename(conv.id); }} className="p-0.5 rounded hover:bg-white/[0.08]" style={{ color: 'var(--nex-text-muted)' }} aria-label="Rename"><Pencil size={9} /></button>
                        <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(conv.id); }} className="p-0.5 rounded hover:bg-red-500/10" style={{ color: 'var(--nex-text-muted)' }} aria-label="Delete"><Trash2 size={9} /></button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
          </>
        )}
      </div>
    </div>
  );
}

