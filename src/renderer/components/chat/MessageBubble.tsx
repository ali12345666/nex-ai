/**
 * NEX AI — Message Renderer (Phase 29 + UI Chat Professionalization)
 *
 * Renders a single chat message with markdown + code blocks.
 * Uses the existing markdown lib (Phase 1 security: sanitized).
 * Uses NEX token system for all colors.
 *
 * UI Chat Pro changes:
 *   - Intelligent RTL/LTR direction detection per message
 *   - Larger font sizes (text-sm for body, was text-[12px])
 *   - Better contrast (var(--nex-text) instead of var(--nex-text-dim))
 *   - Improved spacing (leading-relaxed, paragraph gap)
 *   - System font stack with Persian/Unicode support
 *   - Cleaner status indicators
 */

import React, { useMemo } from 'react';
import { Bot, User as UserIcon, AlertCircle, Loader2 } from 'lucide-react';
import type { NexMessage } from '../../lib/chat-model';
import { splitMarkdown } from '../../lib/markdown';
import CodeBlock from './CodeBlock';

/**
 * Detect if text contains RTL characters (Persian, Arabic, Hebrew).
 * Returns 'rtl' or 'ltr' for direction setting.
 */
function detectDirection(text: string): 'rtl' | 'ltr' {
  // Check for Persian/Arabic/Hebrew Unicode ranges
  const rtlRegex = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
  return rtlRegex.test(text) ? 'rtl' : 'ltr';
}

/** Render markdown blocks (code + text) using the existing safe parser. */
function renderContent(content: string, isRtl: boolean): React.ReactNode[] {
  const blocks = splitMarkdown(content);
  return blocks.map((block, i) => {
    if (block.type === 'code') {
      return <CodeBlock key={i} code={block.content} language={block.lang || ''} />;
    }
    // Text block — render with proper typography + direction
    return (
      <div
        key={i}
        className="text-sm leading-relaxed whitespace-pre-wrap"
        dir={isRtl ? 'rtl' : 'ltr'}
        style={{
          color: 'var(--nex-text)',
          fontFamily: "system-ui, 'Segoe UI', Tahoma, 'Vazirmatn', sans-serif",
          lineHeight: 1.65,
        }}
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
  const isRtl = useMemo(() => detectDirection(message.content) === 'rtl', [message.content]);
  const content = useMemo(() => renderContent(message.content, isRtl), [message.content, isRtl]);

  return (
    <div
      className={`flex gap-2.5 mb-4 nex-animate-in ${isUser ? 'flex-row-reverse' : ''}`}
      role="listitem"
      aria-label={isUser ? 'Your message' : 'NEX AI response'}
    >
      {/* Avatar */}
      <div
        className="flex items-center justify-center shrink-0 rounded-full mt-0.5"
        style={{
          width: 30, height: 30,
          background: isUser
            ? 'rgba(37, 99, 255, 0.15)'
            : 'radial-gradient(circle at 40% 40%, var(--nex-accent-dim) 0%, transparent 70%)',
          border: `1px solid ${isUser ? 'rgba(37, 99, 255, 0.3)' : 'var(--nex-glass-border)'}`,
        }}
      >
        {isUser ? (
          <UserIcon size={13} style={{ color: '#7fa5ff' }} />
        ) : (
          <Bot size={13} style={{ color: 'var(--nex-accent)' }} />
        )}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${isUser ? 'rounded-tr-sm' : 'rounded-tl-sm'}`}
        dir={isRtl ? 'rtl' : 'ltr'}
        style={{
          background: isUser ? 'rgba(37, 99, 255, 0.08)' : 'var(--nex-glass-bg)',
          border: `1px solid ${isUser ? 'rgba(37, 99, 255, 0.2)' : 'var(--nex-glass-border)'}`,
          backdropFilter: 'blur(12px)',
          fontFamily: "system-ui, 'Segoe UI', Tahoma, 'Vazirmatn', sans-serif",
        }}
      >
        {/* Status indicators */}
        {message.status === 'pending' && (
          <div className="flex items-center gap-1.5 mb-1.5 text-xs" style={{ color: 'var(--nex-accent-text)' }}>
            <Loader2 size={11} className="animate-spin" />
            <span>Thinking…</span>
          </div>
        )}
        {message.status === 'streaming' && (
          <div className="flex items-center gap-1.5 mb-1.5 text-xs" style={{ color: 'var(--nex-accent)' }}>
            <span className="inline-block w-1 h-3.5 animate-pulse rounded-sm" style={{ background: 'var(--nex-accent)' }} />
            <span>Generating…</span>
          </div>
        )}
        {message.status === 'error' && (
          <div className="flex items-center gap-1.5 mb-1.5 text-xs" style={{ color: 'rgb(248,113,113)' }}>
            <AlertCircle size={11} />
            <span>Unable to complete the request.</span>
          </div>
        )}

        {/* Content */}
        <div className="min-w-0">{content}</div>

        {/* Metadata footer */}
        {message.status === 'complete' && message.metadata?.tokens !== undefined && (
          <div
            className="flex items-center gap-2 mt-2 pt-1.5 text-[10px]"
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
