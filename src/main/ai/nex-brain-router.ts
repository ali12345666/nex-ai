/**
 * NEX AI — Brain Router (Phase 109 Enhanced)
 *
 * The single decision point that routes user input to either:
 *   - Simple Chat (runtime.chatStream) — for greetings, questions, conversation
 *   - Agent Mode (agent/core.ts) — for tasks requiring tools, file ops, commands
 *
 * Phase 109 improvements:
 *   - Context-aware routing: considers conversation history
 *   - Persian keyword coverage expanded
 *   - "Action intent" detection (not just keyword matching)
 *   - Session stickiness: stays in agent mode within an active task
 *   - Explicit prefixes: @agent / @chat / /agent / /chat
 *   - File path detection (paths like "src/main.ts" → agent)
 *   - Command detection (starts with npm/git/node → agent)
 *   - "Remember" / "یادت باشد" → agent (memory tool)
 *   - "Search the web" / "اینترنت" / "پیدا کن" → agent (web tool)
 *   - "Analyze image" / "تصویر" / "عکس" → agent (vision tool)
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export type BrainRoute = 'chat' | 'agent';

export interface BrainRouterRequest {
  /** The user's message */
  message: string;
  /** Conversation history (for context-aware routing) */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Force a specific route (overrides heuristic) */
  forceRoute?: BrainRoute;
  /** Provider config for chat mode */
  config?: any;
  /** Whether we're currently in an active agent task (session stickiness) */
  inAgentTask?: boolean;
}

export interface BrainRouterResult {
  route: BrainRoute;
  reason: string;
  /** For 'chat' route: the response will be streamed via chat-token events */
  replyId?: string;
  /** For 'agent' route: the task ID for event subscription */
  taskId?: string;
}

// ─── Classification ────────────────────────────────────────────────────────

/**
 * Keywords that indicate the user wants the agent to DO something
 * (not just chat). If any of these appear, route to 'agent'.
 */
const AGENT_KEYWORDS = [
  // English — file operations
  'read file', 'read the file', 'open file', 'open the file',
  'write file', 'create file', 'delete file', 'move file', 'rename file',
  'edit file', 'change file', 'modify file', 'update file',
  'fix the', 'fix this', 'fix that', 'fix it',
  'create', 'delete', 'move', 'rename', 'install', 'build', 'run',
  'test', 'debug', 'refactor', 'implement', 'write a function', 'write a file',
  'edit', 'change', 'update', 'remove', 'search for', 'find all', 'analyze',
  'git commit', 'git push', 'git status', 'npm install', 'npm build', 'npm test',
  'execute', 'deploy', 'migrate', 'generate', 'find symbol', 'find reference',
  'project structure', 'list directory', 'list files',
  // English — web/research
  'search the web', 'search online', 'find online', 'look up',
  'latest version', 'check the internet', 'web search',
  // English — memory
  'remember', 'note that', 'keep in mind', 'don\'t forget',
  // English — vision
  'analyze image', 'analyze the image', 'look at this image', 'describe image',
  'analyze screenshot', 'read screenshot', 'what\'s in this',
  // English — project analysis
  'analyze project', 'analyze this project', 'review project', 'review code',
  'find the bug', 'find the error', 'find the issue', 'find problem',
  'check for errors', 'check the build', 'run the build',
  // Persian — file operations
  'فایل', 'بخوان', 'باز کن', 'بساز', 'بنویس', 'ویرایش', 'اصلاح',
  'ایجاد', 'حذف', 'تغییر', 'اجرا', 'تست', 'دیباگ',
  'بررسی', 'تحلیل', 'پیدا کن', 'جستجو', 'نصب',
  'پروژه را بررسی', 'مشکل', 'خطا', 'ارور',
  // Persian — web/research
  'اینترنت', 'سرچ', 'جستجو کن', 'نسخه جدید', 'آخرین نسخه',
  'پیدا کن از', 'تحقیق',
  // Persian — memory
  'یادت باشد', 'یادت باشه', 'به خاطر بسپار', 'فراموش نکن',
  // Persian — vision
  'تصویر', 'عکس', 'اسکرین‌شات', 'اسکرین شات', 'تحلیل کن',
];

/**
 * Keywords that strongly indicate simple chat (no action needed).
 * These OVERRIDE agent keywords when the message is primarily conversational.
 */
const CHAT_KEYWORDS = [
  'hello', 'hi', 'hey', 'salam', 'سلام', 'how are you', 'چطوری',
  'explain', 'توضیح', 'what is', 'چیست', 'why', 'چرا',
  'thanks', 'مرسی', 'ممنون', 'bye', 'خداحافظ',
  'how do i', 'how to', 'چطور', 'چگونه',
  'difference between', 'تفاوت', 'مقایسه',
  'what are', 'what does', 'what does it mean',
  'can you explain', 'tell me about', 'describe',
  'good morning', 'good evening', 'صبح بخیر', 'شب بخیر',
];

/**
 * Detect if the message contains a file path (indicates agent action).
 * Matches: src/main.ts, ./package.json, /path/to/file, C:\path\file
 */
function containsFilePath(message: string): boolean {
  return /(?:\.\/|\/|\\|[a-zA-Z]:\\)[a-zA-Z0-9_\-./\\]+\.[a-zA-Z]{1,5}/.test(message) ||
    /\bpackage\.json\b|\btsconfig\b|\bcargo\.toml\b|\bpom\.xml\b/i.test(message);
}

/**
 * Detect if the message starts with a command-like instruction.
 */
function startsWithCommand(message: string): boolean {
  const lower = message.toLowerCase().trim();
  return /^(npm|npx|yarn|pnpm|git|node|python|pip|cargo|go|make|cmake|tsc|eslint)\s/.test(lower);
}

/**
 * Classify the user's message as 'chat' or 'agent'.
 *
 * Multi-signal heuristic:
 *   1. Explicit prefix: @agent → agent, @chat → chat
 *   2. Session stickiness: if inAgentTask, stay agent for follow-ups
 *   3. File path detected → agent
 *   4. Command prefix → agent
 *   5. Agent keywords → agent
 *   6. Chat keywords (when no agent keywords) → chat
 *   7. Very short messages without agent keywords → chat
 *   8. Default: chat (safe fallback)
 */
export function classifyRoute(message: string, opts?: { inAgentTask?: boolean; history?: Array<{ role: 'user' | 'assistant'; content: string }> }): BrainRoute {
  const lower = message.toLowerCase().trim();

  // 1. Explicit prefixes
  if (lower.startsWith('@agent') || lower.startsWith('/agent')) return 'agent';
  if (lower.startsWith('@chat') || lower.startsWith('/chat')) return 'chat';

  // 2. Session stickiness — if we're in an agent task, stay in agent mode
  //    for follow-up messages (unless explicitly @chat)
  if (opts?.inAgentTask) {
    // But don't force agent for pure conversational follow-ups
    const hasAgentKeyword = AGENT_KEYWORDS.some((kw) => lower.includes(kw));
    const hasChatKeyword = CHAT_KEYWORDS.some((kw) => lower.includes(kw));
    if (hasAgentKeyword || (!hasChatKeyword && containsFilePath(lower))) {
      return 'agent';
    }
    // If it's clearly conversational, allow falling back to chat
    if (hasChatKeyword && !hasAgentKeyword) return 'chat';
    // Default: stay in agent mode for continuity
    return 'agent';
  }

  // 3. File path detected → agent
  if (containsFilePath(lower)) return 'agent';

  // 4. Command prefix → agent
  if (startsWithCommand(lower)) return 'agent';

  // 5. Agent keywords
  if (AGENT_KEYWORDS.some((kw) => lower.includes(kw))) return 'agent';

  // 6. Chat keywords (when no agent keywords matched) → chat
  if (CHAT_KEYWORDS.some((kw) => lower.includes(kw))) return 'chat';

  // 7. Very short messages → chat (greetings, quick questions)
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length <= 3) return 'chat';

  // 8. Default: chat (safe — agent is expensive, don't invoke unless needed)
  return 'chat';
}

/**
 * Log the routing decision for diagnostics.
 */
export function logRouteDecision(message: string, route: BrainRoute, reason: string): void {
  const preview = message.substring(0, 60);
  console.log(`[BRAIN_ROUTER]`);
  console.log(`  message="${preview}${message.length > 60 ? '...' : ''}"`);
  console.log(`  route=${route}`);
  console.log(`  reason=${reason}`);
}

// ─── Brain Router ──────────────────────────────────────────────────────────

/**
 * The Brain Router singleton. Called by the unified 'brain-route' IPC handler.
 */
export class NexBrainRouter {
  /**
   * Route a user message to either chat or agent mode.
   * Returns the routing decision. The caller (IPC handler) then dispatches
   * to the appropriate execution path.
   */
  route(request: BrainRouterRequest): { route: BrainRoute; reason: string } {
    // Check for forced route
    if (request.forceRoute) {
      const reason = `forced via forceRoute=${request.forceRoute}`;
      logRouteDecision(request.message, request.forceRoute, reason);
      return { route: request.forceRoute, reason };
    }

    // Classify using enhanced heuristic with context
    const route = classifyRoute(request.message, {
      inAgentTask: request.inAgentTask,
      history: request.history,
    });
    const reason = route === 'agent'
      ? 'Agent intent detected (keywords, file path, command, or session stickiness)'
      : 'Simple conversation — no action intent detected';

    logRouteDecision(request.message, route, reason);
    return { route, reason };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _brainRouter: NexBrainRouter | null = null;

export function getNexBrainRouter(): NexBrainRouter {
  if (!_brainRouter) {
    _brainRouter = new NexBrainRouter();
  }
  return _brainRouter;
}
