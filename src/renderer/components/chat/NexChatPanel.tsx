/**
 * NEX AI — Chat Panel (Phase 29/33)
 *
 * Real conversational interface using existing AI infrastructure:
 *   - aiChatStream (P17) for streaming responses
 *   - aiChat (P8) as non-stream fallback
 *   - getProviderConfig for provider routing
 *   - FilesystemService (P28) for file attachments
 *
 * Phase 33 additions:
 *   - Auto-save to conversation persistence (on message complete)
 *   - Startup restore (last active conversation)
 *   - Edit user message (truncates dependent responses, resends)
 *   - Regenerate last assistant response
 *   - Keyboard shortcuts (Ctrl+N, Ctrl+K — not in input/textarea)
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Send, Paperclip, X, File as FileIcon, Square, Loader2,
  Circle, Wifi, WifiOff,
} from 'lucide-react';
import { useStore, getProviderConfig } from '../../store/useStore';
import {
  createMessage, toApiMessages, buildAttachmentContext,
  type NexMessage, type FileAttachment, MAX_ATTACHMENT_INLINE,
} from '../../lib/chat-model';
import MessageBubble from './MessageBubble';
// Phase 30: Voice → Chat integration (transcripts + thinking state)
import { voiceController } from '../../services/voice-controller';

const SUPPORTED_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'csv', 'yaml', 'yml', 'js', 'ts', 'tsx', 'jsx',
  'css', 'html', 'py', 'sh', 'xml', 'docx', 'log', 'sql', 'env',
]);

export default function NexChatPanel() {
  const { settings, aiMode, activeLocalModel, projectPath } = useStore();
  const [messages, setMessages] = useState<NexMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatStreaming, setChatStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phase 33: conversation lifecycle state
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const conversationTitleRef = useRef<string>('');
  const messagesRef = useRef<NexMessage[]>([]);

  // Keep refs in sync for auto-save
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);
  useEffect(() => { conversationTitleRef.current = conversationTitle; }, [conversationTitle]);

  // ── Phase 33: Auto-save conversation to persistence ──
  const saveConversation = useCallback(async (msgs?: NexMessage[]) => {
    const toSave = msgs || messagesRef.current;
    if (toSave.length === 0) return; // don't save empty conversations

    const id = conversationIdRef.current || `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const title = conversationTitleRef.current ||
      (toSave.find((m) => m.role === 'user' && m.content.trim())?.content.slice(0, 60) || 'Untitled');

    // Don't re-save if nothing meaningful changed since last save
    const now = Date.now();
    if (lastSavedAt && now - lastSavedAt < 500) return; // dedup within 500ms

    setConversationId(id);
    setConversationTitle(title);
    conversationIdRef.current = id;
    conversationTitleRef.current = title;

    // Strip attachment content (persist metadata only, not file contents)
    const persistableMsgs = toSave.map((m) => ({
      ...m,
      attachments: m.attachments?.map((a) => ({
        id: a.id, name: a.name, path: a.path, size: a.size, extension: a.extension,
        // content intentionally NOT persisted for large files
        ...(a.content && a.content.length < 2048 ? { content: a.content } : {}),
        ...(a.error ? { error: a.error } : {}),
      })),
    }));

    try {
      await window.nexAPI.conversationSave({
        id,
        title,
        createdAt: conversationCreatedAtRef.current || now,
        updatedAt: now,
        messageCount: persistableMsgs.length,
        messages: persistableMsgs,
        workspace: projectPath || undefined,
        provider: aiMode,
        model: activeLocalModel?.name,
        mode: aiMode,
      });
      conversationCreatedAtRef.current = conversationCreatedAtRef.current || now;
      setLastSavedAt(now);
    } catch { /* non-fatal: chat still works */ }
  }, [projectPath, aiMode, activeLocalModel, lastSavedAt]);

  const conversationCreatedAtRef = useRef<number | null>(null);

  // ── Phase 33: Load / New conversation from external events ──
  useEffect(() => {
    const loadHandler = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.id) {
        try {
          const r = await window.nexAPI.conversationLoad(detail.id);
          if (r.success && r.data) {
            setMessages(r.data.messages || []);
            setConversationId(r.data.id);
            setConversationTitle(r.data.title || '');
            conversationIdRef.current = r.data.id;
            conversationTitleRef.current = r.data.title || '';
            conversationCreatedAtRef.current = r.data.createdAt || null;
            setLastSavedAt(Date.now());
          }
        } catch { /* graceful */ }
      }
    };
    const newHandler = () => {
      setMessages([]);
      setConversationId(null);
      setConversationTitle('');
      conversationIdRef.current = null;
      conversationTitleRef.current = '';
      conversationCreatedAtRef.current = null;
      setLastSavedAt(null);
      setError(null);
    };
    window.addEventListener('nex:load-conversation', loadHandler);
    window.addEventListener('nex:new-conversation', newHandler);
    return () => {
      window.removeEventListener('nex:load-conversation', loadHandler);
      window.removeEventListener('nex:new-conversation', newHandler);
    };
  }, []);

  // ── Phase 33: Startup restore (last conversation) ──
  useEffect(() => {
    (async () => {
      try {
        const r = await window.nexAPI.conversationList();
        if (r.success && r.conversations && r.conversations.length > 0) {
          const last = r.conversations[0]; // sorted by updatedAt desc
          const load = await window.nexAPI.conversationLoad(last.id);
          if (load.success && load.data) {
            setMessages(load.data.messages || []);
            setConversationId(load.data.id);
            setConversationTitle(load.data.title || '');
            conversationIdRef.current = load.data.id;
            conversationTitleRef.current = load.data.title || '';
            conversationCreatedAtRef.current = load.data.createdAt || null;
            setLastSavedAt(Date.now());
          }
        }
      } catch { /* no conversations or IPC unavailable — fine */ }
    })();
  }, []); // run once on mount

  // ── Phase 33: Keyboard shortcuts (not in input/textarea) ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !isInput) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('nex:new-conversation'));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k' && !isInput) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('nex:open-history-search'));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Phase 33: Save on unmount (crash/close safety) ──
  useEffect(() => {
    return () => {
      // Save synchronously (best-effort) on unmount
      if (messagesRef.current.length > 0 && conversationIdRef.current) {
        window.nexAPI.conversationSave({
          id: conversationIdRef.current,
          title: conversationTitleRef.current || 'Untitled',
          createdAt: conversationCreatedAtRef.current || Date.now(),
          updatedAt: Date.now(),
          messageCount: messagesRef.current.length,
          messages: messagesRef.current,
          workspace: projectPath || undefined,
          provider: aiMode,
          mode: aiMode,
        }).catch(() => { /* best-effort */ });
      }
    };
  }, [projectPath, aiMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Phase 33: Edit user message ──
  const handleEditMessage = useCallback(async (messageId: string, newContent: string) => {
    if (isGenerating) return;
    setEditingMessageId(null);

    const msgIndex = messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1 || messages[msgIndex].role !== 'user') return;

    // Truncate everything after the edited message
    const updated = messages.slice(0, msgIndex);
    const editedMsg = { ...messages[msgIndex], content: newContent, timestamp: Date.now() };
    const newMessages = [...updated, editedMsg];
    setMessages(newMessages);

    // Re-send the edited message (will generate new assistant response)
    setInput(newContent);
    // Trigger send after state flush
    setTimeout(() => {
      const el = document.querySelector<HTMLTextAreaElement>('textarea[data-chat-input]');
      if (el) {
        el.value = newContent;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }, 50);
      }
    }, 10);

    // Persist the truncated conversation
    saveConversation(newMessages);
  }, [messages, isGenerating, saveConversation]);

  // ── Phase 33: Regenerate last assistant response ──
  const handleRegenerate = useCallback(async () => {
    if (isGenerating) return;

    // Find last assistant message
    const lastAssistantIdx = messages.findIndex((m) => m.role === 'assistant' && m === [...messages].reverse().find((r) => r.role === 'assistant'));
    if (lastAssistantIdx === -1) return;

    // Find the user message before it
    let lastUserIdx = -1;
    for (let i = lastAssistantIdx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;

    // Remove the assistant response (keep everything before it)
    const truncated = messages.slice(0, lastAssistantIdx);
    setMessages(truncated);

    // Re-send the same user message
    const userContent = messages[lastUserIdx].content;
    setInput(userContent);
    setTimeout(() => {
      const el = document.querySelector<HTMLTextAreaElement>('textarea[data-chat-input]');
      if (el) {
        el.value = userContent;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }, 50);
      }
    }, 10);
  }, [messages, isGenerating]);

  const startEdit = useCallback((messageId: string) => {
    const msg = messages.find((m) => m.id === messageId);
    if (msg?.role === 'user') {
      setEditingMessageId(messageId);
      setEditText(msg.content);
    }
  }, [messages]);

  const cancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditText('');
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamBufRef = useRef<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Phase 30: Voice transcript listener (final transcripts → sendMessage) ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.text?.trim()) {
        // Feed into the SAME pipeline as typed input
        setInput(detail.text.trim());
        // Trigger send on next tick (input state needs to flush)
        setTimeout(() => {
          const el = document.querySelector<HTMLTextAreaElement>('textarea[data-chat-input]');
          if (el) {
            el.value = detail.text.trim();
            el.dispatchEvent(new Event('input', { bubbles: true }));
            // Small delay for state flush, then simulate Enter
            setTimeout(() => {
              el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            }, 50);
          }
        }, 10);
      }
    };
    window.addEventListener('nex:voice-transcript', handler);
    return () => window.removeEventListener('nex:voice-transcript', handler);
  }, []);

  // ── Phase 30: Voice thinking state (tell Orb when AI is processing) ──
  useEffect(() => {
    voiceController.setThinking(isGenerating);
    return () => voiceController.setThinking(false);
  }, [isGenerating]);

  // ── Streaming listener ──
  useEffect(() => {
    const off = window.nexAPI.onChatToken((ev) => {
      if (ev.text) {
        streamBufRef.current += ev.text;
        // Update the streaming message in place
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.status === 'streaming' || last?.status === 'pending') {
            next[next.length - 1] = { ...last, content: streamBufRef.current, status: 'streaming' };
          }
          return next;
        });
      }
    });
    return off;
  }, []);

  // Scroll follow
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── File attachment ──
  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const newAttachments: FileAttachment[] = [];
    for (const file of Array.from(files).slice(0, 5)) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const att: FileAttachment = {
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        path: file.name,
        size: file.size,
        extension: ext,
      };
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        att.error = 'Unsupported type';
      } else if (file.size > MAX_ATTACHMENT_INLINE) {
        att.error = 'File too large (>100KB)';
      } else if (file.size > 5 * 1024 * 1024) {
        att.error = 'File too large';
      } else {
        try {
          att.content = await file.text();
        } catch {
          att.error = 'Cannot read file';
        }
      }
      newAttachments.push(att);
    }
    setAttachments((prev) => [...prev, ...newAttachments].slice(0, 5));
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Drag & drop
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // ── Send message ──
  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if ((!trimmed && attachments.length === 0) || isGenerating) return;

    setError(null);
    setInput('');

    // Build context from attachments
    const attachmentCtx = buildAttachmentContext(attachments);
    const fullContent = attachmentCtx ? `${trimmed}\n\n${attachmentCtx}` : trimmed;

    // Add user message
    const userMsg = createMessage('user', trimmed, {
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    // Add pending assistant message
    const assistantMsg = createMessage('assistant', '', { status: 'pending' });

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setAttachments([]);
    setIsGenerating(true);
    setChatStreaming(true);
    streamBufRef.current = '';

    // Build API messages
    const apiMessages = [
      ...toApiMessages(messages),
      { role: 'user' as const, content: fullContent },
    ];

    const providerConfig = getProviderConfig(settings, aiMode, activeLocalModel);

    try {
      // Try streaming first (P17)
      const stream = await window.nexAPI.aiChatStream(providerConfig, apiMessages);
      if (stream.success) {
        const finalContent = stream.content || streamBufRef.current;
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last) {
            next[next.length - 1] = {
              ...last,
              content: finalContent,
              status: 'complete',
              metadata: {
                tokens: stream.tokens,
                provider: providerConfig.provider,
                durationMs: stream.durationMs,
              },
            };
          }
          return next;
        });
        // Phase 33: auto-save on completed assistant response
        setTimeout(() => saveConversation(), 50);
      } else if (stream.error && /No local model|Model file not found/i.test(stream.error)) {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last) next[next.length - 1] = { ...last, status: 'error', metadata: { error: stream.error || "Request failed" } };
          return next;
        });
        setError(stream.error);
      } else {
        // Fallback to non-streaming
        const result = await window.nexAPI.aiChat(providerConfig, apiMessages);
        if (result.success && result.content) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last) {
              next[next.length - 1] = {
                ...last, content: result.content || '', status: 'complete',
                metadata: { tokens: result.tokens, provider: providerConfig.provider },
              };
            }
            return next;
          });
        } else {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last) next[next.length - 1] = { ...last, status: 'error', metadata: { error: result.error || "Request failed" } };
            return next;
          });
          setError(result.error || 'Request failed');
        }
      }
    } catch (err: any) {
      // Preserve user message; mark assistant as error
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last) next[next.length - 1] = { ...last, status: 'error', metadata: { error: err.message } };
        return next;
      });
      setError(err.message);
    } finally {
      setIsGenerating(false);
      setChatStreaming(false);
      streamBufRef.current = '';
      // Phase 33: final save (captures error/partial states too)
      setTimeout(() => saveConversation(), 100);
    }
  }, [input, messages, attachments, isGenerating, settings, aiMode, activeLocalModel, saveConversation]);

  const handleStop = useCallback(() => {
    window.nexAPI.aiChatStreamCancel().catch(() => {});
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const isLocal = aiMode === 'local';

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Messages */}
      <div className="flex-1 overflow-y-auto nex-scroll px-3 py-3" role="list" aria-label="Chat messages">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-8">
            <div
              className="flex items-center justify-center rounded-full"
              style={{
                width: 44, height: 44,
                background: 'radial-gradient(circle at 40% 40%, var(--nex-accent-dim) 0%, transparent 70%)',
              }}
            >
              <span className="text-[11px] font-bold" style={{ color: 'var(--nex-accent)' }}>NX</span>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--nex-text-muted)' }}>
              How can I help you today?
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id}>
            {/* Phase 33: Edit mode for user messages */}
            {editingMessageId === msg.id ? (
              <div className="flex gap-2 mb-3 ml-8">
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditMessage(msg.id, editText); }
                    if (e.key === 'Escape') cancelEdit();
                  }}
                  className="flex-1 bg-white/[0.05] border border-[var(--nex-accent)]/30 rounded-lg px-3 py-2 text-[12px] resize-none outline-none"
                  style={{ color: 'var(--nex-text)', minHeight: 40 }}
                  autoFocus
                  aria-label="Edit message"
                />
                <div className="flex flex-col gap-1">
                  <button onClick={() => handleEditMessage(msg.id, editText)} className="px-2 py-1 rounded text-[9px] font-medium" style={{ background: 'var(--nex-accent)', color: 'var(--nex-bg)' }}>Save</button>
                  <button onClick={cancelEdit} className="px-2 py-1 rounded text-[9px]" style={{ border: '1px solid var(--nex-glass-border)', color: 'var(--nex-text-muted)' }}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <MessageBubble message={msg} />
                {/* Phase 33: Edit/Regenerate actions */}
                {!isGenerating && msg.status === 'complete' && (
                  <div className={`flex gap-2 mt-0.5 mb-2 ${msg.role === 'user' ? 'justify-end pr-10' : 'pl-10'}`}>
                    {msg.role === 'user' && (
                      <button
                        onClick={() => startEdit(msg.id)}
                        className="text-[9px] px-1.5 py-0.5 rounded transition-colors hover:bg-white/[0.06]"
                        style={{ color: 'var(--nex-text-muted)' }}
                        aria-label="Edit message"
                      >
                        Edit
                      </button>
                    )}
                    {msg.role === 'assistant' && msg === messages[messages.length - 1] && (
                      <button
                        onClick={handleRegenerate}
                        className="text-[9px] px-1.5 py-0.5 rounded transition-colors hover:bg-white/[0.06]"
                        style={{ color: 'var(--nex-text-muted)' }}
                        aria-label="Regenerate response"
                      >
                        Regenerate
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="px-3 pb-1 flex flex-wrap gap-1.5">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[9px]"
              style={{
                background: att.error ? 'rgba(255,59,92,0.1)' : 'var(--nex-glass-bg)',
                border: `1px solid ${att.error ? 'rgba(255,59,92,0.3)' : 'var(--nex-glass-border)'}`,
              }}
            >
              <FileIcon size={9} style={{ color: att.error ? 'var(--nex-error)' : 'var(--nex-accent)' }} />
              <span className="truncate max-w-[100px]" style={{ color: 'var(--nex-text-dim)' }}>
                {att.name}
              </span>
              <span style={{ color: 'var(--nex-text-muted)' }}>
                {att.error ? att.error : `${(att.size / 1024).toFixed(0)}KB`}
              </span>
              <button
                onClick={() => removeAttachment(att.id)}
                className="ml-0.5 transition-colors hover:text-red-400"
                style={{ color: 'var(--nex-text-muted)' }}
                aria-label={`Remove ${att.name}`}
              >
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-3 pb-1">
          <div
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[10px]"
            style={{ background: 'rgba(255,59,92,0.1)', border: '1px solid rgba(255,59,92,0.2)' }}
          >
            <span className="flex-1 text-red-400">{error}</span>
            <button
              onClick={handleSend}
              className="px-2 py-0.5 rounded text-[9px] font-medium transition-colors"
              style={{ color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}
            >
              Retry
            </button>
            <button onClick={() => setError(null)} style={{ color: 'var(--nex-text-muted)' }}>
              <X size={10} />
            </button>
          </div>
        </div>
      )}

      {/* Input area */}
      <div
        className="px-3 py-2 shrink-0"
        style={{ borderTop: '1px solid var(--nex-glass-border)' }}
      >
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-1 rounded transition-colors hover:bg-white/[0.06]"
              style={{ color: 'var(--nex-text-muted)' }}
              title="Attach files"
              aria-label="Attach files"
            >
              <Paperclip size={12} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.json,.csv,.yaml,.yml,.js,.ts,.tsx,.jsx,.css,.html,.py,.sh,.xml,.docx,.log,.sql"
              onChange={(e) => { handleFileSelect(e.target.files); e.target.value = ''; }}
              className="hidden"
              aria-hidden
            />
          </div>
          <div className="flex items-center gap-2">
            {/* Mode indicator */}
            <span className="flex items-center gap-1 text-[9px] font-medium">
              {isLocal ? (
                <>
                  <WifiOff size={9} style={{ color: 'var(--nex-accent)' }} />
                  <span style={{ color: 'var(--nex-accent-text)' }}>LOCAL</span>
                </>
              ) : (
                <>
                  <Wifi size={9} style={{ color: 'var(--nex-success)' }} />
                  <span style={{ color: 'var(--nex-success)' }}>ONLINE</span>
                </>
              )}
            </span>
            {/* Send / Stop */}
            {chatStreaming && isGenerating ? (
              <button
                onClick={handleStop}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors"
                style={{ color: 'var(--nex-error)', border: '1px solid rgba(255,59,92,0.3)' }}
                aria-label="Stop generating"
              >
                <Square size={9} /> Stop
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={(!input.trim() && attachments.length === 0) || isGenerating}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all disabled:opacity-30"
                style={{
                  color: 'var(--nex-bg)',
                  background: `linear-gradient(135deg, var(--nex-accent) 0%, var(--nex-accent-secondary) 100%)`,
                }}
                aria-label="Send message"
              >
                <Send size={10} /> Send
              </button>
            )}
          </div>
        </div>

        {/* Text input */}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message…"
          data-chat-input
          className="w-full bg-white/[0.03] border border-[var(--nex-glass-border)] rounded-lg px-3 py-2 text-[12px] resize-none outline-none transition-colors focus:border-[var(--nex-accent)]/30"
          style={{
            color: 'var(--nex-text)',
            maxHeight: 120,
            minHeight: 36,
            fontFamily: "'Inter', sans-serif",
          }}
          rows={1}
          aria-label="Chat input"
        />
      </div>
    </div>
  );
}
