/**
 * NEX AI — Chat Message Model (Phase 29)
 *
 * Clean conversation state model with statuses, streaming, and attachments.
 * Extends the existing ChatMessage with the fields needed for real chat.
 */

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';
export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

export interface FileAttachment {
  id: string;
  name: string;
  path: string;
  size: number;
  extension: string;
  /** base64 for small text files; undefined for binary/oversized */
  content?: string;
  error?: string;
}

export interface NexMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  status: MessageStatus;
  attachments?: FileAttachment[];
  metadata?: {
    tokens?: number;
    provider?: string;
    model?: string;
    durationMs?: number;
    error?: string;
    // Phase 109: Agent routing metadata
    agentTaskId?: string;
    route?: string;
    completed?: boolean;
    failed?: boolean;
    cancelled?: boolean;
    agentTokensStarted?: boolean;
  };
}

export function createMessage(
  role: ChatRole,
  content: string,
  opts: Partial<Pick<NexMessage, 'attachments' | 'metadata' | 'status'>> = {}
): NexMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: Date.now(),
    status: role === 'assistant' ? 'pending' : 'complete',
    ...opts,
  };
}

/** Build the messages array for the AI backend (strip UI-only fields). */
export function toApiMessages(messages: NexMessage[]): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
  return messages
    .filter((m) => m.status === 'complete' && m.role !== 'tool')
    .map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }));
}

/** Build context string from attachments. */
export function buildAttachmentContext(attachments: FileAttachment[]): string {
  if (!attachments || attachments.length === 0) return '';
  const parts: string[] = [];
  for (const att of attachments) {
    if (att.error) continue;
    if (att.content !== undefined) {
      parts.push(`File: ${att.name}\n\`\`\`${att.extension || 'text'}\n${att.content.slice(0, 4000)}\n\`\`\``);
    } else {
      parts.push(`File attached: ${att.name} (${att.extension}, ${att.size} bytes)`);
    }
  }
  return parts.join('\n\n');
}

/** Max file size for inline attachment content (100KB). */
export const MAX_ATTACHMENT_INLINE = 100 * 1024;
