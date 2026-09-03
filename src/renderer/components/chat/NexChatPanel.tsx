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
  Circle, Wifi, WifiOff, Plus, MessageSquare, Trash2, ChevronDown,
} from 'lucide-react';
import { useStore, getProviderConfig } from '../../store/useStore';
import {
  createMessage, toApiMessages, buildAttachmentContext,
  type NexMessage, type FileAttachment, MAX_ATTACHMENT_INLINE,
} from '../../lib/chat-model';
import MessageBubble from './MessageBubble';
// Phase 35: Malformed conversation protection
import { validateConversationData } from '../../lib/conversation-validator';
// Phase 30: Voice → Chat integration (transcripts + thinking state)
import { voiceController } from '../../services/voice-controller';

const SUPPORTED_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'csv', 'yaml', 'yml', 'js', 'ts', 'tsx', 'jsx',
  'css', 'html', 'py', 'sh', 'xml', 'docx', 'log', 'sql', 'env',
]);

export default function NexChatPanel() {
  const { settings, aiMode, activeLocalModel, projectPath, activeFile } = useStore();
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
            const validated = validateConversationData(r.data);
            if (validated === null) {
              console.warn('[NEX AI] Malformed conversation on load — ignoring');
              return;
            }
            setMessages(validated);
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
            const validated = validateConversationData(load.data);
            if (validated === null) {
              console.warn('[NEX AI] Malformed conversation data on startup — starting fresh');
              return;
            }
            setMessages(validated);
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

  // Phase 34: guard against double-send from edit/regenerate DOM event hack
  const isResendingRef = useRef(false);

  // ── Phase 33: Edit user message ──
  const handleEditMessage = useCallback(async (messageId: string, newContent: string) => {
    if (isGenerating || isResendingRef.current) return;
    isResendingRef.current = true;
    setTimeout(() => { isResendingRef.current = false; }, 1000);
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
    if (isGenerating || isResendingRef.current) return;
    isResendingRef.current = true;
    setTimeout(() => { isResendingRef.current = false; }, 1000);

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

  // Phase 110: Track active agent task for session stickiness
  const activeAgentTaskRef = useRef<string | null>(null);

  // ── Phase 30: Voice thinking state (tell Orb when AI is processing) ──
  useEffect(() => {
    voiceController.setThinking(isGenerating);
    return () => voiceController.setThinking(false);
  }, [isGenerating]);

  // Phase 116 JARVIS: Drive Orb state from agent events
  // WORKING: when agent starts executing tools (step_started, tool_call_started)
  // SUCCESS: when task completes successfully (task_completed)
  // CANCELLED: when user cancels (task_cancelled)
  // THINKING: when planning starts (planning_started)
  // This runs INSIDE the agent event listener (below) via voiceController.setCondition

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

  // ── Phase 109/110: Agent event listener — updates chat UI with agent progress ──
  useEffect(() => {
    const off = window.nexAPI?.onAgentEvent?.((event: any) => {
      const eventType = event?.type || event?.event;
      const taskId = event?.taskId;

      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (!last || last.metadata?.agentTaskId !== taskId) return prev;

        switch (eventType) {
          case 'planning_started':
            // Phase 116 JARVIS: Orb THINKING while planning (LLM decision-making)
            voiceController.setCondition('agent', 'thinking');
            next[next.length - 1] = { ...last, content: '🧠 Agent is thinking...\n\n📋 Planning approach...' };
            break;
          case 'planning_completed':
          case 'plan_created':
            // Phase 116 JARVIS: Orb WORKING when tools start executing
            voiceController.setCondition('agent', 'working');
            next[next.length - 1] = { ...last, content: '🧠 Agent is working...\n\n📋 Plan created. Executing steps...' };
            break;
          case 'step_started':
          case 'tool_call':
          case 'tool_call_started':
            // Phase 116 JARVIS: Orb WORKING (actual tool execution — NOT thinking)
            // THINKING = LLM decision-making / planning
            // WORKING = tool execution (file ops, commands, etc.)
            voiceController.setCondition('agent', 'working');
            next[next.length - 1] = {
              ...last,
              content: `🧠 Agent is working...\n\n🔧 Running ${event.toolName || event.step?.toolName || 'tool'}...`,
            };
            break;
          case 'step_completed':
          case 'tool_result':
            // Phase 115: Capture snapshotId from tool_call_completed for Undo UI.
            // The snapshotId is only present for file-modifying tools (write_file,
            // edit_file). We store it in the message metadata so MessageBubble
            // can show an Undo button.
            {
              const snapId = event?.data?.snapshotId;
              const fileLabel = event?.data?.fileLabel;
              if (snapId) {
                next[next.length - 1] = {
                  ...last,
                  content: `🧠 Agent is working...\n\n✅ ${event.toolName || event.data?.toolName || 'Step'} completed.`,
                  metadata: {
                    ...last.metadata,
                    snapshotId: snapId,
                    fileLabel: fileLabel,
                  },
                };
              } else {
                next[next.length - 1] = {
                  ...last,
                  content: `🧠 Agent is working...\n\n✅ ${event.toolName || 'Step'} completed.`,
                };
              }
            }
            break;
          case 'verification':
            next[next.length - 1] = { ...last, content: '🧠 Agent is working...\n\n🔍 Verifying results...' };
            break;
          case 'replanning':
            next[next.length - 1] = { ...last, content: '🧠 Agent is working...\n\n🔄 Re-planning based on results...' };
            break;
          case 'agent_token':
            // Phase 110: Agent final answer — emitted by core.ts when ReAct
            // decides 'complete' with a finalAnswer. This is the actual
            // response text that should replace the placeholder.
            {
              const tokenText = event?.data?.content || event?.data?.text || '';
              if (tokenText) {
                // Accumulate agent tokens (like chat streaming)
                const currentContent = last.content || '';
                // If this is the first token, replace the placeholder
                const isFirstToken = !last.metadata?.agentTokensStarted;
                next[next.length - 1] = {
                  ...last,
                  content: isFirstToken ? tokenText : currentContent + tokenText,
                  status: 'streaming',
                  metadata: { ...last.metadata, agentTokensStarted: true },
                };
              }
            }
            break;
          case 'task_completed':
          case 'completed':
            // Agent finished — use the final answer from agent_token if accumulated,
            // otherwise use event.result/response/message.
            {
              const finalText = last.metadata?.agentTokensStarted
                ? last.content // Already has the streamed final answer
                : (event.result || event.response || event.message || event.data?.content || '✅ Task completed.');
              next[next.length - 1] = {
                ...last,
                content: typeof finalText === 'string' ? finalText : '✅ Task completed.',
                status: 'complete',
                metadata: { ...last.metadata, completed: true },
              };
            }
            // Phase 116 JARVIS: Orb → SUCCESS then clear → idle/ready
            voiceController.setCondition('agent', 'success');
            setTimeout(() => voiceController.clearCondition('agent'), 1500);
            // Phase 110: Clear active agent task + reset UI state
            activeAgentTaskRef.current = null;
            setIsGenerating(false);
            setChatStreaming(false);
            streamBufRef.current = '';
            setTimeout(() => saveConversation(), 100);
            break;
          case 'task_failed':
          case 'failed':
            next[next.length - 1] = {
              ...last,
              content: `❌ Agent task failed: ${event.error || event.message || event.data?.error || 'Unknown error'}`,
              status: 'error',
              metadata: { ...last.metadata, failed: true, error: event.error || event.message },
            };
            // Phase 116 JARVIS: Orb → error state
            voiceController.setCondition('agent', 'error');
            activeAgentTaskRef.current = null;
            setIsGenerating(false);
            setChatStreaming(false);
            streamBufRef.current = '';
            setTimeout(() => saveConversation(), 100);
            break;
          case 'task_cancelled':
          case 'cancelled':
            next[next.length - 1] = {
              ...last,
              content: last.metadata?.agentTokensStarted
                ? last.content + '\n\n⚠️ Task was cancelled.'
                : '⚠️ Task was cancelled by user.',
              status: 'complete',
              metadata: { ...last.metadata, cancelled: true },
            };
            // Phase 116 JARVIS: Orb → CANCELLED then clear → idle/ready
            voiceController.setCondition('agent', 'cancelled');
            setTimeout(() => voiceController.clearCondition('agent'), 1500);
            activeAgentTaskRef.current = null;
            setIsGenerating(false);
            setChatStreaming(false);
            streamBufRef.current = '';
            setTimeout(() => saveConversation(), 100);
            break;
          case 'permission_request':
            next[next.length - 1] = {
              ...last,
              content: `🧠 Agent is working...\n\n⚠️ Permission required: ${event.action || event.description || 'Action requires approval'}`,
            };
            break;
          default:
            break;
        }
        return next;
      });
    });
    return () => { if (off) off(); };
  }, [saveConversation]);

  // Scroll follow
  useEffect(() => {
    // Phase 116 PERF: Use 'auto' during streaming to avoid smooth-scroll
    // animation pile-up. Each token triggers this — 'smooth' causes layout
    // thrashing with 20-100 calls/sec.
    messagesEndRef.current?.scrollIntoView({ behavior: isGenerating ? 'auto' : 'smooth' });
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
    if (editingMessageId) return; // Phase 34: block send while editing
    const trimmed = input.trim();
    if ((!trimmed && attachments.length === 0) || isGenerating) return;

    // Phase 45: Intercept advisor chat commands
    const lower = trimmed.toLowerCase();
    if (lower.includes('مدل بهتر') || lower.includes('پیدا کن مدل') || lower.includes('model recommend') || lower.includes('find better model')) {
      // Show user message + advisor response
      const userMsg = createMessage('user', trimmed);
      const assistantMsg = createMessage('assistant', '', { status: 'pending' });
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput('');
      setIsGenerating(true);
      try {
        const res = await window.nexAPI.modelRecommendations();
        if (res.success && res.recommendations && res.recommendations.length > 0) {
          let text = 'یک مدل بهتر برای کار شما پیدا کردم:\n\n';
          for (const rec of res.recommendations.slice(0, 3)) {
            const e = rec.catalogEntry;
            if (!e) continue;
            text += `**${e.name}**\n`;
            text += `اندازه: ${e.sizeGB} GB\n`;
            text += `دسته: ${e.category}\n`;
            text += `بهبود: +${rec.estimatedImprovement}%\n`;
            text += `دلیل: ${rec.reason}\n\n`;
          }
          text += 'برای نصب، در چت تایید کنید یا روی Advisor در منو کلیک کنید.';
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = createMessage('assistant', text, { status: 'complete' });
            return next;
          });
        } else {
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = createMessage('assistant', 'در حال حاضر مدل بهتری برای سخت‌افزار شما پیدا نکردم. مدل‌های فعلی شما مناسب هستند.', { status: 'complete' });
            return next;
          });
        }
      } catch (err: any) {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = createMessage('assistant', `خطا: ${err.message}`, { status: 'complete' });
          return next;
        });
      }
      setIsGenerating(false);
      return;
    }
    if (lower.includes('این مدل بهتره') || lower.includes('مقایسه مدل') || lower.includes('compare model')) {
      // Show comparison
      const userMsg = createMessage('user', trimmed);
      const assistantMsg = createMessage('assistant', '', { status: 'pending' });
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput('');
      setIsGenerating(true);
      try {
        const advisorRes = await window.nexAPI.modelRecommendations();
        if (advisorRes.success && advisorRes.recommendations && advisorRes.recommendations.length > 0) {
          const rec = advisorRes.recommendations[0];
          const entry = rec.catalogEntry;
          if (entry) {
            const compareRes = await window.nexAPI.modelCompare('qwen2.5-7b-q4', entry.id);
            if (compareRes.success && compareRes.comparison) {
              const c = compareRes.comparison;
              let text = `مقایسه مدل‌ها:\n\n`;
              text += `**${c.modelA.name}** vs **${c.modelB.name}**\n\n`;
              text += `کیفیت: ${c.differences.quality?.a || 0} vs ${c.differences.quality?.b || 0}\n`;
              text += `سرعت: ${c.differences.speed?.a || 0} vs ${c.differences.speed?.b || 0}\n`;
              text += `کدنویسی: ${c.differences.coding?.a || 0} vs ${c.differences.coding?.b || 0}\n`;
              text += `استدلال: ${c.differences.reasoning?.a || 0} vs ${c.differences.reasoning?.b || 0}\n\n`;
              text += `نتیجه: ${c.recommendation}`;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = createMessage('assistant', text, { status: 'complete' });
                return next;
              });
            } else {
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = createMessage('assistant', 'مقایسه ممکن نشد. مدل‌ها در کاتالوگ نیستند.', { status: 'complete' });
                return next;
              });
            }
          }
        } else {
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = createMessage('assistant', 'مدلی برای مقایسه پیدا نشد.', { status: 'complete' });
            return next;
          });
        }
      } catch (err: any) {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = createMessage('assistant', `خطا: ${err.message}`, { status: 'complete' });
          return next;
        });
      }
      setIsGenerating(false);
      return;
    }

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

    // Phase 116: Intent Resolution — check if this is a follow-up action
    // (open/reveal/read/edit) that can be handled WITHOUT invoking the LLM.
    // This makes the Agent feel like a real IDE assistant: "بازش کن" after
    // creating a file immediately opens it in the editor, without waiting
    // for the model to respond.
    try {
      const { isActionableFollowUp, resolveReference, executeIntent, extractArtifactsFromResponse } =
        await import('../../lib/intent-resolver');

      if (isActionableFollowUp(trimmed)) {
        // Extract artifacts from the last assistant message
        const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant' && m.status === 'complete');
        const artifacts = lastAssistantMsg
          ? extractArtifactsFromResponse(lastAssistantMsg.content)
          : { files: [], folders: [] };

        const lastArtifactPath = artifacts.files[artifacts.files.length - 1];
        const lastArtifactFolder = artifacts.folders[artifacts.folders.length - 1];

        const intentResult = resolveReference(trimmed, {
          lastArtifactPath,
          lastArtifactFolder,
          activeFile,
          projectPath,
        });

        if (intentResult.resolved) {
          // Execute the action directly (no LLM needed)
          const resultMessage = await executeIntent(intentResult);

          // Add the user message + action result to chat
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = {
              ...next[next.length - 1],
              content: resultMessage,
              status: 'complete',
              metadata: { ...next[next.length - 1].metadata, completed: true },
            };
            return next;
          });

          setIsGenerating(false);
          setChatStreaming(false);
          setTimeout(() => saveConversation(), 100);
          return; // Don't proceed to brainRoute/LLM
        }
      }
    } catch (intentErr) {
      console.warn('[INTENT] Resolution failed (non-blocking):', intentErr);
      // Fall through to normal brainRoute/LLM path
    }

    // Build API messages
    const apiMessages = [
      ...toApiMessages(messages),
      { role: 'user' as const, content: fullContent },
    ];

    const providerConfig = getProviderConfig(settings, aiMode, activeLocalModel);

    try {
      // Phase 109: Route through Brain Router first.
      // The router decides: chat (streaming) or agent (tools + ReAct).
      // For chat: fall through to aiChatStream (preserves token streaming).
      // For agent: agent events come via onAgentEvent/onChatToken.
      const routeResult = await window.nexAPI.brainRoute({
        message: fullContent,
        history: messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-5).map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        projectPath: projectPath || undefined,
        modelId: settings.activeLocalModelId || activeLocalModel?.id,  // Phase 116: send active model ID
        forceRoute: undefined, // let the router decide
        inAgentTask: !!activeAgentTaskRef.current, // Phase 110: session stickiness
      });

      if (routeResult.success && routeResult.route === 'agent' && routeResult.taskId) {
        // Phase 110: Track active agent task for session stickiness
        activeAgentTaskRef.current = routeResult.taskId;

        // Agent mode — the agent is running asynchronously.
        // Agent events (planning, tool_call, verification, completion)
        // arrive via the agent-event IPC listener (added below).
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last) {
            next[next.length - 1] = {
              ...last,
              content: '🧠 Agent is working on this task...\n\n📋 Planning...',
              status: 'streaming',
              metadata: { agentTaskId: routeResult.taskId, route: 'agent' },
            };
          }
          return next;
        });
        // Phase 110: Don't let the finally block reset isGenerating —
        // the agent event listener handles that on task_completed/failed/cancelled.
        // Return early WITHOUT hitting the finally block.
        // We handle cleanup (saveConversation, setChatStreaming) in the
        // agent event listener when the task completes.
        setChatStreaming(false); // agent doesn't use chat-token streaming
        return;
      }

      // If brainRoute failed or returned chat, fall through to streaming.
      // Also handle the case where brainRoute itself errors — fall back to chat.
      if (!routeResult.success) {
        console.warn('[BRAIN_ROUTER] Error, falling back to direct chat:', routeResult.error);
      }

      // Chat mode — proceed with streaming (preserves existing behavior)
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
      } else if (stream.error && /abort|cancelled|canceled/i.test(stream.error)) {
        // ABORT FIX: do NOT fall back to non-streaming aiChat when the stream
        // was aborted. Falling back starts a NEW inference (chatComplete)
        // while the aborted stream's session/context is still being disposed,
        // which can cause resource contention or a second immediate abort.
        // Instead, show the abort as the final state and let the user retry.
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last) next[next.length - 1] = { ...last, status: 'error', metadata: { error: stream.error || "Request aborted" } };
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
    // Cancel chat streaming
    window.nexAPI.aiChatStreamCancel().catch(() => {});
    // Phase 110: Also cancel active agent task if any
    if (activeAgentTaskRef.current) {
      window.nexAPI.agentCancelTask?.(activeAgentTaskRef.current, 'User cancelled').catch(() => {});
    }
  }, []);

  // Phase 115: Undo — restore a file from its snapshot.
  // Called when the user clicks the Undo button on an agent message that
  // contains a snapshotId (from write_file or edit_file).
  //
  // Security: the renderer only sends the snapshotId — never a filesystem
  // path. The main process validates snapshot ownership before restoring.
  //
  // Double-restore prevention: undoingIdsRef tracks in-flight undo requests.
  const undoingIdsRef = useRef<Set<string>>(new Set());
  const handleUndo = useCallback(async (messageId: string, snapshotId: string) => {
    // Prevent double-click / double-restore
    if (undoingIdsRef.current.has(messageId)) return;
    undoingIdsRef.current.add(messageId);

    try {
      const result = await window.nexAPI.snapshotRestore(snapshotId);
      if (result.success) {
        // Mark the message as undone — disables the Undo button
        setMessages((prev) => prev.map((m) =>
          m.id === messageId
            ? { ...m, metadata: { ...m.metadata, undone: true, undoError: undefined } }
            : m
        ));
      } else {
        // On failure: keep the Undo button available (if appropriate)
        // and show the error.
        setMessages((prev) => prev.map((m) =>
          m.id === messageId
            ? { ...m, metadata: { ...m.metadata, undoError: result.error || 'Restore failed' } }
            : m
        ));
      }
    } catch (err: any) {
      setMessages((prev) => prev.map((m) =>
        m.id === messageId
          ? { ...m, metadata: { ...m.metadata, undoError: err.message || 'Restore failed' } }
          : m
      ));
    } finally {
      undoingIdsRef.current.delete(messageId);
    }
  }, []);

  // Phase 88: New Chat — clear messages, reset conversation state
  const handleNewChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setConversationTitle('');
    conversationIdRef.current = null;
    conversationTitleRef.current = '';
    conversationCreatedAtRef.current = null;
    setLastSavedAt(null);
    setError(null);
    setInput('');
    setAttachments([]);
    // Dispatch event for AppShell to update activeConversationId
    window.dispatchEvent(new CustomEvent('nex:new-conversation'));
  }, []);

  // Phase 88: Delete current conversation
  const handleDeleteChat = useCallback(async () => {
    const id = conversationIdRef.current;
    if (!id) return;
    try {
      await window.nexAPI.conversationDelete(id);
      handleNewChat();
    } catch (err: any) {
      setError('Failed to delete conversation: ' + err.message);
    }
  }, [handleNewChat]);

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
      {/* Phase 88: Conversation Header — New Chat + Title + Delete */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--nex-glass-border)' }}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={handleNewChat}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium nex-click shrink-0"
            style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}
            title="New conversation (Ctrl+N)"
            aria-label="New conversation"
          >
            <Plus size={11} /> New
          </button>
          <span className="text-[10px] truncate" style={{ color: 'var(--nex-text-muted)' }} title={conversationTitle || 'New conversation'}>
            {conversationTitle || 'New conversation'}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {conversationId && messages.length > 0 && (
            <button
              onClick={handleDeleteChat}
              className="p-1 rounded transition-colors hover:bg-red-500/10"
              style={{ color: 'var(--nex-text-muted)' }}
              title="Delete conversation"
              aria-label="Delete conversation"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto nex-scrollbar px-4 py-4" role="list" aria-label="Chat messages">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 py-8">
            <div
              className="flex items-center justify-center rounded-full"
              style={{
                width: 48, height: 48,
                background: 'radial-gradient(circle at 40% 40%, var(--nex-accent-dim) 0%, transparent 70%)',
              }}
            >
              <span className="text-sm font-bold" style={{ color: 'var(--nex-accent)' }}>NX</span>
            </div>
            <p className="text-sm" style={{ color: 'var(--nex-text-dim)' }}>
              How can I help you today?
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageRow
            key={msg.id}
            msg={msg}
            isLast={msg === messages[messages.length - 1]}
            isGenerating={isGenerating}
            editingMessageId={editingMessageId}
            editText={editText}
            onUndo={handleUndo}
            onEditMessage={handleEditMessage}
              onStartEdit={startEdit}
              onCancelEdit={cancelEdit}
              onEditText={setEditText}
              onRegenerate={handleRegenerate}
          />
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
        className="px-4 py-2.5 shrink-0"
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
          className="w-full bg-white/[0.03] border border-[var(--nex-glass-border)] rounded-lg px-3 py-2.5 text-sm resize-none outline-none transition-colors focus:border-[var(--nex-accent)]/30"
          style={{
            color: 'var(--nex-text)',
            maxHeight: 120,
            minHeight: 40,
            fontFamily: "system-ui, 'Segoe UI', Tahoma, 'Vazirmatn', sans-serif",
            lineHeight: 1.5,
          }}
          rows={1}
          aria-label="Chat input"
        />
      </div>
    </div>
  );
}

// ── Phase 116 PERF: Memoized MessageRow ───────────────────────────────────
// Previously, every chat token caused the ENTIRE messages.map() to re-render
// because the inline JSX (Edit/Regenerate buttons, conditional rendering)
// created new closures on every render. Now, MessageRow is React.memo'd
// with stable callback references — only the message that actually changed
// (the streaming one) re-renders. All other messages skip re-rendering.

interface MessageRowProps {
  msg: NexMessage;
  isLast: boolean;
  isGenerating: boolean;
  editingMessageId: string | null;
  editText: string;
  onUndo: (messageId: string, snapshotId: string) => void;
  onEditMessage: (messageId: string, newContent: string) => void;
  onStartEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  onEditText: (text: string) => void;
  onRegenerate: () => void;
}

const MessageRow = React.memo(function MessageRow({
  msg, isLast, isGenerating, editingMessageId, editText,
  onUndo, onEditMessage, onStartEdit, onCancelEdit, onEditText, onRegenerate,
}: MessageRowProps) {
  // Edit mode for user messages
  if (editingMessageId === msg.id) {
    return (
      <div className="flex gap-2 mb-3 ml-8">
        <textarea
          value={editText}
          onChange={(e) => onEditText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEditMessage(msg.id, editText); }
            if (e.key === 'Escape') onCancelEdit();
          }}
          className="flex-1 bg-white/[0.05] border border-[var(--nex-accent)]/30 rounded-lg px-3 py-2 text-[12px] resize-none outline-none"
          style={{ color: 'var(--nex-text)', minHeight: 40 }}
          autoFocus
          aria-label="Edit message"
        />
        <div className="flex flex-col gap-1">
          <button onClick={() => onEditMessage(msg.id, editText)} className="px-2 py-1 rounded text-[9px] font-medium" style={{ background: 'var(--nex-accent)', color: 'var(--nex-bg)' }}>Save</button>
          <button onClick={onCancelEdit} className="px-2 py-1 rounded text-[9px]" style={{ border: '1px solid var(--nex-glass-border)', color: 'var(--nex-text-muted)' }}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <MessageBubble message={msg} onUndo={onUndo} />
      {!isGenerating && msg.status === 'complete' && (
        <div className={`flex gap-2 mt-0.5 mb-2 ${msg.role === 'user' ? 'justify-end pr-10' : 'pl-10'}`}>
          {msg.role === 'user' && (
            <button
              onClick={() => onStartEdit(msg.id)}
              className="text-[9px] px-1.5 py-0.5 rounded transition-colors hover:bg-white/[0.06]"
              style={{ color: 'var(--nex-text-muted)' }}
              aria-label="Edit message"
            >
              Edit
            </button>
          )}
          {msg.role === 'assistant' && isLast && (
            <button
              onClick={onRegenerate}
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
  );
}, (prev, next) => {
  // Custom comparison: only re-render if this specific message changed
  // or if global state that affects this row changed
  return (
    prev.msg.id === next.msg.id &&
    prev.msg.content === next.msg.content &&
    prev.msg.status === next.msg.status &&
    prev.msg.metadata === next.msg.metadata &&
    prev.isLast === next.isLast &&
    prev.isGenerating === next.isGenerating &&
    prev.editingMessageId === next.editingMessageId &&
    prev.editText === next.editText
  );
});
