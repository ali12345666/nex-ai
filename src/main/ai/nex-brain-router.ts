/**
 * NEX AI — Brain Router
 *
 * The single decision point that routes user input to either:
 *   - Simple Chat (runtime.chatStream) — for greetings, questions, conversation
 *   - Agent Mode (agent/core.ts) — for tasks requiring tools, file ops, commands
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │  NexBrainRouter                                       │
 *   │    route(userMessage) → 'chat' | 'agent'             │
 *   ├──────────────────────────────────────────────────────┤
 *   │  'chat'  → ai-chat-stream → runtime.chatStream()     │
 *   │  'agent' → agent-run-task → createTask + runTask()   │
 *   └──────────────────────────────────────────────────────┘
 *
 * Classification heuristic:
 *   - Greetings, simple questions, explanations → 'chat'
 *   - File operations, code changes, commands, debugging → 'agent'
 *   - Explicit "@agent" prefix → forces 'agent'
 *   - Explicit "@chat" prefix → forces 'chat'
 *
 * This is the unified entry point. The renderer calls one IPC
 * ('brain-route') and gets back the routing decision + the response
 * (for chat) or the taskId (for agent).
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export type BrainRoute = 'chat' | 'agent';

export interface BrainRouterRequest {
  /** The user's message */
  message: string;
  /** Conversation history (for context) */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Force a specific route (overrides heuristic) */
  forceRoute?: BrainRoute;
  /** Provider config for chat mode */
  config?: any;
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
  // English
  'fix', 'create', 'delete', 'move', 'rename', 'install', 'build', 'run',
  'test', 'debug', 'refactor', 'implement', 'write a function', 'write a file',
  'edit', 'change', 'update', 'remove', 'search for', 'find all', 'analyze',
  'git commit', 'git push', 'git status', 'npm install', 'npm build',
  'execute', 'deploy', 'migrate', 'generate',
  // Persian
  'ایجاد', 'حذف', 'تغییر', 'اجرا', 'بساز', 'بنویس', 'ویرایش', 'اصلاح',
  'تست', 'دیباگ', 'بررسی', 'تحلیل', 'پیدا کن', 'جستجو', 'نصب',
];

/**
 * Keywords that indicate simple chat (no action needed).
 */
const CHAT_KEYWORDS = [
  'hello', 'hi', 'hey', 'salam', 'سلام', 'how are you', 'چطوری',
  'explain', 'توضیح', 'what is', 'چیست', 'why', 'چرا',
  'thanks', 'مرسی', 'ممنون', 'bye', 'خداحافظ',
];

/**
 * Classify the user's message as 'chat' or 'agent'.
 *
 * Heuristic:
 *   1. Explicit prefix: @agent → agent, @chat → chat
 *   2. Agent keywords (fix, create, delete, etc.) → agent
 *   3. Very short messages (≤3 words) without agent keywords → chat
 *   4. Default: chat (safe fallback — don't invoke agent unnecessarily)
 */
export function classifyRoute(message: string): BrainRoute {
  const lower = message.toLowerCase().trim();

  // 1. Explicit prefixes
  if (lower.startsWith('@agent') || lower.startsWith('/agent')) return 'agent';
  if (lower.startsWith('@chat') || lower.startsWith('/chat')) return 'chat';

  // 2. Agent keywords
  if (AGENT_KEYWORDS.some((kw) => lower.includes(kw))) return 'agent';

  // 3. Chat keywords → chat
  if (CHAT_KEYWORDS.some((kw) => lower.includes(kw))) return 'chat';

  // 4. Very short messages → chat (greetings, quick questions)
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length <= 3) return 'chat';

  // 5. Default: chat (safe — agent is expensive, don't invoke unless needed)
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

    // Classify using heuristic
    const route = classifyRoute(request.message);
    const reason = route === 'agent'
      ? 'Agent keywords detected or action requested'
      : 'Simple conversation — no action keywords detected';

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
