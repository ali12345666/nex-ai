/**
 * NEX AI — Chat Panel (Phase 29)
 *
 * Real conversational interface using existing AI infrastructure:
 *   - aiChatStream (P17) for streaming responses
 *   - aiChat (P8) as non-stream fallback
 *   - getProviderConfig for provider routing
 *   - FilesystemService (P28) for file attachments
 *
 * Uses NEX token system throughout. Migrated from old ChatPanel.
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamBufRef = useRef<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
    }
  }, [input, messages, attachments, isGenerating, settings, aiMode, activeLocalModel]);

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
          <MessageBubble key={msg.id} message={msg} />
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
