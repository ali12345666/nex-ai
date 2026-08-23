/**
 * NEX AI — Message Renderer (Phase 29)
 *
 * Renders a single chat message with markdown + code blocks.
 * Uses the existing markdown lib (Phase 1 security: sanitized).
 * Uses NEX token system for all colors.
 */

import React, { useMemo } from 'react';
import { Bot, User as UserIcon, AlertCircle, Loader2 } from 'lucide-react';
import type { NexMessage } from '../../lib/chat-model';
import { splitMarkdown } from '../../lib/markdown';
import CodeBlock from './CodeBlock';

/** Render markdown blocks (code + text) using the existing safe parser. */
function renderContent(content: string): React.ReactNode[] {
  const blocks = splitMarkdown(content);
  return blocks.map((block, i) => {
    if (block.type === 'code') {
      return <CodeBlock key={i} code={block.content} language={block.lang || ''} />;
    }
    // Text block — render as plain text (the existing markdown lib
    // handles sanitization when HTML rendering is needed)
    return (
      <div
        key={i}
        className="text-[12px] leading-relaxed whitespace-pre-wrap"
        style={{ color: 'var(--nex-text-dim)' }}
      >
        {block.content}
      </div>
    );
  });
}

export interface MessageBubbleProps {
  message: NexMessage;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const content = useMemo(() => renderContent(message.content), [message.content]);

  return (
    <div
      className={`flex gap-2 mb-3 nex-animate-in ${isUser ? 'flex-row-reverse' : ''}`}
      role="listitem"
      aria-label={isUser ? 'Your message' : 'NEX AI response'}
    >
      {/* Avatar */}
      <div
        className="flex items-center justify-center shrink-0 rounded-full mt-0.5"
        style={{
          width: 28, height: 28,
          background: isUser
            ? 'rgba(37, 99, 255, 0.15)'
            : 'radial-gradient(circle at 40% 40%, var(--nex-accent-dim) 0%, transparent 70%)',
          border: `1px solid ${isUser ? 'rgba(37, 99, 255, 0.3)' : 'var(--nex-glass-border)'}`,
        }}
      >
        {isUser ? (
          <UserIcon size={12} style={{ color: '#7fa5ff' }} />
        ) : (
          <Bot size={12} style={{ color: 'var(--nex-accent)' }} />
        )}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-[82%] rounded-xl px-3 py-2 ${isUser ? 'rounded-tr-sm' : 'rounded-tl-sm'}`}
        style={{
          background: isUser ? 'rgba(37, 99, 255, 0.08)' : 'var(--nex-glass-bg)',
          border: `1px solid ${isUser ? 'rgba(37, 99, 255, 0.2)' : 'var(--nex-glass-border)'}`,
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* Status indicators */}
        {message.status === 'pending' && (
          <div className="flex items-center gap-1.5 mb-1 text-[10px]" style={{ color: 'var(--nex-accent-text)' }}>
            <Loader2 size={10} className="animate-spin" />
            <span>Thinking…</span>
          </div>
        )}
        {message.status === 'streaming' && (
          <div className="flex items-center gap-1.5 mb-1 text-[10px]" style={{ color: 'var(--nex-accent)' }}>
            <span className="inline-block w-1.5 h-3 animate-pulse" style={{ background: 'var(--nex-accent)' }} />
            <span>streaming…</span>
          </div>
        )}
        {message.status === 'error' && (
          <div className="flex items-center gap-1.5 mb-1 text-[10px] text-red-400">
            <AlertCircle size={10} />
            <span>Unable to complete the request.</span>
          </div>
        )}

        {/* Content */}
        <div className="min-w-0">{content}</div>

        {/* Metadata footer */}
        {message.status === 'complete' && message.metadata?.tokens !== undefined && (
          <div
            className="flex items-center gap-2 mt-1.5 pt-1 text-[9px]"
            style={{ borderTop: '1px solid var(--nex-glass-border)', color: 'var(--nex-text-muted)' }}
          >
            {message.metadata.tokens > 0 && <span>~{message.metadata.tokens} tokens</span>}
            {message.metadata.provider && <span>via {message.metadata.provider}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
