/**
 * NEX AI — Context Manager
 *
 * Builds the prompt context for the Agent's LLM calls. Token-aware — never
 * exceeds the model's context window.
 *
 * Layers (in priority order):
 *   1. System prompt (agent identity + tool schemas)
 *   2. Task description (user request + intent)
 *   3. Recent conversation (last N messages, token-budgeted)
 *   4. Project memory (architecture, conventions, current task plan)
 *   5. User memory (preferences, style)
 *   6. Task memory (current plan, intermediate observations)
 *   7. Relevant files (selected by relevance score)
 *   8. Knowledge items (RAG — Phase 19+)
 *   9. Recent observations (tool outputs from current task)
 *
 * Total tokens must stay under model.contextSize - maxTokens (response budget).
 */

import type { AIRuntime, ChatMessage } from '../ai/runtime';
import type { LocalModelInfo } from '../ai/model-registry';
import type { Observation } from './types';
import { UserMemory, ProjectMemory, TaskMemory, SessionMemory } from '../memory';

export interface ContextFile {
  path: string;
  name: string;
  startLine?: number;
  endLine?: number;
  content: string;
  relevanceScore: number;
  reason: string;
}

export interface ContextMemoryItem {
  store: 'user' | 'project' | 'task' | 'knowledge' | 'session';
  key: string;
  value: any;
  relevanceScore: number;
}

export interface BuiltContext {
  messages: ChatMessage[];
  estimatedTokens: number;
  tokenBudget: number;
  filesIncluded: string[];
  memoriesIncluded: string[];
  truncated: boolean;
  truncationReason?: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are NEX AI, an autonomous local-first coding agent.

Your role is to assist with coding tasks by:
1. Understanding the user's intent
2. Planning steps (when the task is complex)
3. Selecting appropriate tools to gather information
4. Executing tools safely (with permission when needed)
5. Observing tool outputs and reasoning about results
6. Verifying that the task succeeded
7. Reporting back to the user with a clear, actionable summary

Rules:
- ALWAYS prefer using tools over guessing. Verify your assumptions by reading files / running commands.
- For DESTRUCTIVE operations (delete, write, execute, git push, system changes), you MUST request permission first. The user will approve via UI.
- For file modifications, ALWAYS propose a diff first. The user must review and accept before changes are applied.
- If a tool fails, observe the error, reason about the cause, and try a different approach. Do NOT repeat the same call.
- Respect limits: maxSteps, maxToolCalls, maxRetries. If you hit a limit, report and stop.
- Be honest about uncertainty. If you can't solve a task, say so and explain what's needed.
- Keep responses concise. Use tool calls to verify, not stream-of-consciousness text.

Available tools are listed in the system message. Use them wisely.`;

export interface BuildContextOptions {
  userRequest: string;
  intent?: string;
  recentConversation?: ChatMessage[];
  recentObservations?: Observation[];
  relevantFiles?: ContextFile[];
  projectPath?: string;
  activeFile?: string;
  // Override system prompt (e.g. for sub-agents)
  systemPrompt?: string;
  // Include tool schemas in the system prompt
  toolSchemas?: any[];
}

/**
 * Build the message list for an LLM call.
 * Token-aware: trims from lowest-priority layers if needed.
 */
export function buildContext(
  model: LocalModelInfo,
  opts: BuildContextOptions
): BuiltContext {
  const contextSize = model.contextSize || 2048;
  // Reserve half of context for the response (configurable)
  const responseBudget = Math.floor(contextSize * 0.4);
  const contextBudget = contextSize - responseBudget;
  let tokensUsed = 0;
  const filesIncluded: string[] = [];
  const memoriesIncluded: string[] = [];
  let truncated = false;
  let truncationReason: string | undefined;

  const messages: ChatMessage[] = [];

  // ── Layer 1: System prompt ──
  let systemPrompt = opts.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  if (opts.toolSchemas && opts.toolSchemas.length > 0) {
    systemPrompt += '\n\n## Available Tools\n\n';
    systemPrompt += 'You can call the following tools. Format: `{"tool":"<name>","params":{...}}`\n\n';
    systemPrompt += opts.toolSchemas.map((s) =>
      `- ${s.name}: ${s.description}\n  params: ${JSON.stringify(s.parameters)}`
    ).join('\n');
  }
  tokensUsed += estimateTokens(systemPrompt);
  messages.push({ role: 'system', content: systemPrompt });

  // ── Layer 2: Task description ──
  let taskDesc = `## Current Task\n\nUser request: ${opts.userRequest}`;
  if (opts.intent) {
    taskDesc += `\nDetected intent: ${opts.intent}`;
  }
  if (opts.projectPath) {
    taskDesc += `\nProject: ${opts.projectPath}`;
  }
  if (opts.activeFile) {
    taskDesc += `\nActive file: ${opts.activeFile}`;
  }
  tokensUsed += estimateTokens(taskDesc);
  messages.push({ role: 'system', content: taskDesc });

  // ── Layer 3: Project memory ──
  if (opts.projectPath) {
    const projectMemories = ProjectMemory.list(opts.projectPath).slice(0, 20);
    if (projectMemories.length > 0) {
      const memoryText = '## Project Context\n' + projectMemories.map((m) =>
        `- ${m.key}: ${JSON.stringify(m.value).slice(0, 200)}`
      ).join('\n');
      if (tokensUsed + estimateTokens(memoryText) < contextBudget) {
        tokensUsed += estimateTokens(memoryText);
        messages.push({ role: 'system', content: memoryText });
        projectMemories.forEach((m) => memoriesIncluded.push(`project:${m.key}`));
      }
    }
  }

  // ── Layer 4: User memory ──
  const userMemories = UserMemory.list().slice(0, 10);
  if (userMemories.length > 0) {
    const memoryText = '## User Preferences\n' + userMemories.map((m) =>
      `- ${m.key}: ${JSON.stringify(m.value).slice(0, 100)}`
    ).join('\n');
    if (tokensUsed + estimateTokens(memoryText) < contextBudget) {
      tokensUsed += estimateTokens(memoryText);
      messages.push({ role: 'system', content: memoryText });
      userMemories.forEach((m) => memoriesIncluded.push(`user:${m.key}`));
    }
  }

  // ── Layer 5: Task memory ──
  const taskMemories = TaskMemory.list().slice(0, 30);
  if (taskMemories.length > 0) {
    const memoryText = '## Current Task Memory\n' + taskMemories.map((m) =>
      `- ${m.key}: ${JSON.stringify(m.value).slice(0, 300)}`
    ).join('\n');
    if (tokensUsed + estimateTokens(memoryText) < contextBudget) {
      tokensUsed += estimateTokens(memoryText);
      messages.push({ role: 'system', content: memoryText });
      taskMemories.forEach((m) => memoriesIncluded.push(`task:${m.key}`));
    }
  }

  // ── Layer 6: Recent conversation (token-budgeted) ──
  if (opts.recentConversation && opts.recentConversation.length > 0) {
    const recent = opts.recentConversation.slice(-10);
    for (const msg of recent) {
      const msgTokens = estimateTokens(msg.content);
      if (tokensUsed + msgTokens >= contextBudget) {
        truncated = true;
        truncationReason = 'conversation truncated to fit context';
        break;
      }
      tokensUsed += msgTokens;
      messages.push(msg);
    }
  }

  // ── Layer 7: Recent observations ──
  if (opts.recentObservations && opts.recentObservations.length > 0) {
    const recentObs = opts.recentObservations.slice(-5);
    for (const obs of recentObs) {
      const obsText = `## Tool Observation\nTool: ${obs.toolCallId}\n${obs.rawOutput || '(no output)'}`.slice(0, 2000);
      const obsTokens = estimateTokens(obsText);
      if (tokensUsed + obsTokens >= contextBudget) {
        truncated = true;
        truncationReason = truncationReason || 'observations truncated';
        break;
      }
      tokensUsed += obsTokens;
      messages.push({ role: 'user', content: obsText });
    }
  }

  // ── Layer 8: Relevant files (by relevance score, descending) ──
  if (opts.relevantFiles && opts.relevantFiles.length > 0) {
    const sorted = [...opts.relevantFiles].sort((a, b) => b.relevanceScore - a.relevanceScore);
    for (const file of sorted) {
      const fileText = `## File: ${file.name}\nPath: ${file.path}\n\`\`\`\n${file.content.slice(0, 4000)}\n\`\`\``;
      const fileTokens = estimateTokens(fileText);
      if (tokensUsed + fileTokens >= contextBudget) {
        truncated = true;
        truncationReason = truncationReason || `files truncated (${filesIncluded.length}/${opts.relevantFiles.length} included)`;
        break;
      }
      tokensUsed += fileTokens;
      messages.push({ role: 'system', content: fileText });
      filesIncluded.push(file.path);
    }
  }

  // ── Final layer: prompt the LLM to think step-by-step ──
  const finalPrompt = `Based on the above context and your available tools, what's your next step?\n\nRespond in this format:\n- If you want to call a tool: respond with the tool call as a JSON object {"tool":"<name>","params":{...}}\n- If you have enough information to answer: respond with your final answer as natural language\n- If you need clarification: ask the user`;
  tokensUsed += estimateTokens(finalPrompt);
  messages.push({ role: 'user', content: finalPrompt });

  return {
    messages,
    estimatedTokens: tokensUsed,
    tokenBudget: contextBudget,
    filesIncluded,
    memoriesIncluded,
    truncated,
    truncationReason,
  };
}

/**
 * Estimate token count for a string.
 * Rough approximation: 1 token ≈ 4 chars in English, 1.5 chars in CJK.
 * For accurate counts, we'd use the model's tokenizer.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Mixed heuristic: count chars, account for whitespace and punctuation
  const charCount = text.length;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  // Tokens are typically between char/4 and word/0.75
  // Use a middle estimate
  return Math.ceil(Math.max(charCount / 4, wordCount * 0.75));
}
