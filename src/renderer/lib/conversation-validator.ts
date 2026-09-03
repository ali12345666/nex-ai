/**
 * Phase 35 — Malformed conversation protection
 * Validates loaded data before passing to React state.
 */

import type { NexMessage } from './chat-model';

/**
 * Validate conversation data loaded from persistence.
 * Returns array of valid messages, or null if data is malformed
 * (triggers graceful fallback to empty conversation).
 *
 * Handles: null, {}, [], {"messages": null}, {"messages": "invalid"},
 * {"messages": [{}]}, invalid JSON (caught by IPC), missing fields.
 */
export function validateConversationData(data: unknown): NexMessage[] | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.messages)) return null;

  const validMsgs: NexMessage[] = [];
  for (const m of obj.messages) {
    if (!m || typeof m !== 'object') continue;
    const msg = m as Record<string, unknown>;
    if (typeof msg.id !== 'string' || msg.id.length === 0) continue;
    if (msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'system' && msg.role !== 'tool') continue;
    if (typeof msg.content !== 'string') continue;
    if (typeof msg.timestamp !== 'number') continue;
    validMsgs.push(msg as unknown as NexMessage);
  }
  return validMsgs;
}
