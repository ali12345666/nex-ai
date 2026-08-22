/**
 * NEX AI — Agent Logger
 *
 * Structured logging for the agent. Every step, tool call, observation,
 * error, and verification is logged so the user can audit what happened.
 *
 * SECURITY: API keys, passwords, tokens, and secrets are NEVER logged.
 * The redactor scans every log line for known secret patterns and replaces
 * them with ***REDACTED***.
 *
 * Logs are stored in <userData>/logs/agent-<taskId>.jsonl (one JSON per line).
 * A rolling size limit (10MB per task) prevents runaway disk usage.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getUserDataDir } from '../persistence';
import type { AgentEvent, AgentEventType } from './types';

export interface LogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  category: 'task' | 'plan' | 'tool' | 'permission' | 'observation' | 'verification' | 'error' | 'system';
  message: string;
  taskId?: string;
  stepId?: string;
  toolCallId?: string;
  data?: any;
}

const LOG_DIR_NAME = 'logs';

function getLogDir(): string {
  const dir = path.join(getUserDataDir(), LOG_DIR_NAME);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getTaskLogPath(taskId: string): string {
  return path.join(getLogDir(), `agent-${taskId}.jsonl`);
}

// ─── Redactor ───────────────────────────────────────────────────────────────

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp; replacement: string }> = [
  // OpenAI API keys (sk-...)
  { name: 'openai_key', regex: /\bsk-[A-Za-z0-9]{20,}\b/g, replacement: '***REDACTED_OPENAI_KEY***' },
  // Anthropic API keys (sk-ant-...)
  { name: 'anthropic_key', regex: /\bsk-ant-[A-Za-z0-9-_]{20,}\b/g, replacement: '***REDACTED_ANTHROPIC_KEY***' },
  // GitHub PAT (ghp_, github_pat_)
  { name: 'github_pat', regex: /\bghp_[A-Za-z0-9]{36,}\b/g, replacement: '***REDACTED_GITHUB_PAT***' },
  { name: 'github_pat_v2', regex: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, replacement: '***REDACTED_GITHUB_PAT***' },
  // Generic API keys in env vars / params (with key name prefix)
  { name: 'env_api_key', regex: /\b(api[_-]?key|apikey|api[_-]?token|secret|password|token)\s*[=:]\s*["']?([A-Za-z0-9_\-\.]{20,})["']?/gi, replacement: '$1=***REDACTED***' },
  // Bearer tokens
  { name: 'bearer', regex: /\bBearer\s+[A-Za-z0-9_\-\.]{20,}/g, replacement: 'Bearer ***REDACTED***' },
  // JWT tokens (3 parts separated by dots, starting with eyJ)
  { name: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replacement: '***REDACTED_JWT***' },
  // AWS access keys
  { name: 'aws_access', regex: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '***REDACTED_AWS_ACCESS***' },
  // Connection strings with passwords
  { name: 'conn_str', regex: new RegExp('\\b(mongodb|postgres|postgresql|mysql|redis)://[^:\\s]+:[^@\\s]+@', 'gi'), replacement: '$1://***:***@' },
  // Generic base64 secrets (very long — 64+ chars, no spaces)
  // NOTE: Removed 40+ because it false-positives on long IDs / hashes
  { name: 'long_b64', regex: /\b[A-Za-z0-9+/]{64,}={0,2}\b/g, replacement: '***REDACTED_B64***' },
];

/**
 * Redact secrets from a string.
 * Logs every redaction so we know what was hidden (without revealing the value).
 */
export function redactSecrets(input: string): { redacted: string; redactions: string[] } {
  let result = input;
  const redactions: string[] = [];
  for (const pattern of SECRET_PATTERNS) {
    const before = result;
    result = result.replace(pattern.regex, pattern.replacement);
    if (before !== result) {
      redactions.push(pattern.name);
    }
  }
  return { redacted: result, redactions };
}

/**
 * Deep-redact an object: recurse into nested objects/arrays and redact every
 * string value encountered.
 */
export function redactObjectDeep(obj: any): any {
  if (typeof obj === 'string') {
    return redactSecrets(obj).redacted;
  }
  if (Array.isArray(obj)) {
    return obj.map(redactObjectDeep);
  }
  if (obj && typeof obj === 'object') {
    const out: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      // Skip keys that look like secrets entirely
      if (/^(api[_-]?key|apikey|password|secret|token|bearer)$/i.test(key)) {
        out[key] = '***REDACTED***';
      } else {
        out[key] = redactObjectDeep(obj[key]);
      }
    }
    return out;
  }
  return obj;
}

// ─── Logger ──────────────────────────────────────────────────────────────────

const _listeners = new Set<(entry: LogEntry) => void>();
const _eventListeners = new Set<(event: AgentEvent) => void>();

export function onLogEntry(listener: (entry: LogEntry) => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

export function onAgentEvent(listener: (event: AgentEvent) => void): () => void {
  _eventListeners.add(listener);
  return () => _eventListeners.delete(listener);
}

/**
 * Emit a structured log entry. Writes to disk and notifies in-memory listeners.
 * NEVER log API keys, tokens, or secrets — the redactor handles that.
 */
export function log(entry: Omit<LogEntry, 'timestamp'>): void {
  const fullEntry: LogEntry = {
    ...entry,
    timestamp: Date.now(),
    data: entry.data ? redactObjectDeep(entry.data) : undefined,
  };
  // Redact the message too
  fullEntry.message = redactSecrets(fullEntry.message).redacted;

  // Write to disk if we have a task id
  if (fullEntry.taskId) {
    try {
      const logPath = getTaskLogPath(fullEntry.taskId);
      fs.appendFileSync(logPath, JSON.stringify(fullEntry) + '\n');
      // Rolling size check: 10MB max per task
      const stat = fs.statSync(logPath);
      if (stat.size > 10 * 1024 * 1024) {
        // Rotate: rename to .1 and start fresh
        const rotatedPath = logPath + '.1';
        try { fs.unlinkSync(rotatedPath); } catch {}
        fs.renameSync(logPath, rotatedPath);
      }
    } catch (err) {
      console.error('[NEX AI AgentLogger] Failed to write log:', err);
    }
  }

  // Always log to console for debugging
  const consoleMsg = `[${fullEntry.level}] ${fullEntry.category}: ${fullEntry.message}`;
  if (fullEntry.level === 'error') console.error(consoleMsg);
  else if (fullEntry.level === 'warn') console.warn(consoleMsg);
  else console.log(consoleMsg);

  // Notify listeners
  for (const listener of _listeners) {
    try { listener(fullEntry); } catch {}
  }
}

/**
 * Emit an agent event (high-level state changes that the UI subscribes to).
 */
export function emitEvent(event: Omit<AgentEvent, 'timestamp'>): void {
  const fullEvent: AgentEvent = {
    ...event,
    timestamp: Date.now(),
    data: event.data ? redactObjectDeep(event.data) : undefined,
  };
  // Also log it
  log({
    level: 'info',
    category: 'task',
    message: fullEvent.message,
    taskId: fullEvent.taskId,
    stepId: fullEvent.stepId,
    toolCallId: fullEvent.toolCallId,
    data: fullEvent.data,
  });
  // Notify event listeners (UI)
  for (const listener of _eventListeners) {
    try { listener(fullEvent); } catch {}
  }
}

// ─── Convenience helpers ────────────────────────────────────────────────────

export const AgentLogger = {
  debug: (msg: string, opts: Partial<LogEntry> = {}) => log({ level: 'debug', category: 'system', message: msg, ...opts }),
  info: (msg: string, opts: Partial<LogEntry> = {}) => log({ level: 'info', category: 'system', message: msg, ...opts }),
  warn: (msg: string, opts: Partial<LogEntry> = {}) => log({ level: 'warn', category: 'system', message: msg, ...opts }),
  error: (msg: string, opts: Partial<LogEntry> = {}) => log({ level: 'error', category: 'error', message: msg, ...opts }),
  task: (msg: string, taskId: string, opts: Partial<LogEntry> = {}) =>
    log({ level: 'info', category: 'task', message: msg, taskId, ...opts }),
  plan: (msg: string, taskId: string, opts: Partial<LogEntry> = {}) =>
    log({ level: 'info', category: 'plan', message: msg, taskId, ...opts }),
  tool: (msg: string, taskId: string, opts: Partial<LogEntry> = {}) =>
    log({ level: 'info', category: 'tool', message: msg, taskId, ...opts }),
  permission: (msg: string, taskId: string, opts: Partial<LogEntry> = {}) =>
    log({ level: 'info', category: 'permission', message: msg, taskId, ...opts }),
  observation: (msg: string, taskId: string, opts: Partial<LogEntry> = {}) =>
    log({ level: 'info', category: 'observation', message: msg, taskId, ...opts }),
  verification: (msg: string, taskId: string, opts: Partial<LogEntry> = {}) =>
    log({ level: 'info', category: 'verification', message: msg, taskId, ...opts }),
  log: (entry: Omit<LogEntry, 'timestamp'>) => log(entry),
};

// ─── Read logs ───────────────────────────────────────────────────────────────

export function readTaskLog(taskId: string, maxEntries?: number): LogEntry[] {
  const logPath = getTaskLogPath(taskId);
  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const entries = lines.map((l) => JSON.parse(l) as LogEntry);
    return maxEntries ? entries.slice(-maxEntries) : entries;
  } catch {
    return [];
  }
}

export function listTaskLogs(): Array<{ taskId: string; sizeBytes: number; modifiedAt: number }> {
  try {
    const files = fs.readdirSync(getLogDir()).filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'));
    return files.map((f) => {
      const stat = fs.statSync(path.join(getLogDir(), f));
      const taskId = f.replace('agent-', '').replace('.jsonl', '');
      return { taskId, sizeBytes: stat.size, modifiedAt: stat.mtimeMs };
    }).sort((a, b) => b.modifiedAt - a.modifiedAt);
  } catch {
    return [];
  }
}
