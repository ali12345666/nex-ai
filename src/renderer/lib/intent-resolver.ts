/**
 * NEX AI — Intent Resolver (Phase 116)
 *
 * Resolves natural language user requests into concrete actions by combining:
 *   - Conversation history (last agent artifacts)
 *   - Editor state (active file)
 *   - File Explorer state (selected folder)
 *   - Pronoun/reference resolution ("بازش کن" → which file?)
 *
 * Architecture:
 *   User message
 *     → classifyIntent (Persian + English patterns)
 *     → resolveReference (artifact history, active file, etc.)
 *     → executeAction (open file, reveal folder, read content, etc.)
 *     → report result to user
 *
 * This module runs in the RENDERER (has access to useStore + nexAPI).
 * It is called AFTER the agent produces an artifact summary, to detect
 * if the user's FOLLOW-UP message is a UI action request (open/reveal/edit)
 * that can be handled WITHOUT invoking the LLM again.
 */

import { useStore } from '../store/useStore';

// ─── Intent Types ──────────────────────────────────────────────────────────

export type AgentIntent =
  | 'OPEN_FILE'        // بازش کن / بالا بیار / open file
  | 'REVEAL_FILE'      // نشون بده کجاست / show in folder
  | 'OPEN_FOLDER'      // پوشه رو باز کن / open folder
  | 'READ_FILE'        // محتویاتش رو نشون بده / show content
  | 'EDIT_FILE'        // تغییر بده / edit this
  | 'CREATE_FILE'      // بساز / create file
  | 'CREATE_FOLDER'    // پوشه بساز / create folder
  | 'RUN_COMMAND'      // اجرا کن / run
  | 'SEARCH_FILE'      // پیدا کن / search
  | 'SHOW_LOCATION'    // کجاست / where is it
  | 'SAVE_FILE'        // ذخیره کن / save
  | 'RENAME_FILE'      //改名 / rename
  | 'DELETE_FILE'      // حذف کن / delete
  | 'NONE';            // No actionable intent — let LLM handle

export interface IntentResult {
  intent: AgentIntent;
  /** Resolved file path (absolute) if applicable */
  filePath?: string;
  /** Resolved folder path (absolute) if applicable */
  folderPath?: string;
  /** Content to write/edit if applicable */
  content?: string;
  /** Old text for edit_file if applicable */
  oldText?: string;
  /** New text for edit_file if applicable */
  newText?: string;
  /** Command to run if applicable */
  command?: string;
  /** Whether the intent was resolved successfully */
  resolved: boolean;
  /** Reason if not resolved */
  reason?: string;
}

// ─── Intent Patterns (Persian + English) ───────────────────────────────────

interface IntentPattern {
  intent: AgentIntent;
  patterns: RegExp[];
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: 'OPEN_FILE',
    patterns: [
      /بازش\s*کن|بالا\s*بیار|لودش\s*کن|فایل\s*رو\s*باز|open\s+(?:the\s+)?file|load\s+(?:the\s+)?file/i,
      /فایل\s*رو\s*باز\s*کن|باز\s*کنش|بالا\s*بیارش/i,
    ],
  },
  {
    intent: 'REVEAL_FILE',
    patterns: [
      /نشون\s*بده\s*کجاست|کجاست|where\s+is\s+it|show\s+in\s+folder|reveal/i,
      /محل\s*فایل|مسیرش\s*رو\s*نشون|محل\s*فایل\s*رو\s*نشون/i,
    ],
  },
  {
    intent: 'OPEN_FOLDER',
    patterns: [
      /پوشه\s*رو\s*باز\s*کن|folder\s*رو\s*باز|open\s+(?:the\s+)?folder|پوشه\s*ش\s*رو\s*باز/i,
      /پوشه\s*ای\s*که\s*ساختی|مسیر\s*پوشه/i,
    ],
  },
  {
    intent: 'READ_FILE',
    patterns: [
      /محتویاتش\s*رو\s*نشون|محتوای\s*فایل|داخلش\s*چی\s*هست|ببین\s*داخلش|show\s+content|read\s+(?:the\s+)?file/i,
      /محتویات\s*رو\s*نشون|چی\s*نوشته|متن\s*داخلش/i,
    ],
  },
  {
    intent: 'EDIT_FILE',
    patterns: [
      /تغییر\s*بده|تغییر\s*کن|اصلاح\s*کن|ویرایش|edit\s+(?:the\s+)?file|change|modify|fix/i,
      /عوض\s*کن|درست\s*کن|اصلاحش\s*کن/i,
    ],
  },
  {
    intent: 'CREATE_FILE',
    patterns: [
      /فایل\s*بساز|ساختن\s*فایل|create\s+(?:a\s+)?file|make\s+(?:a\s+)?file|بنویس\s*فایل/i,
    ],
  },
  {
    intent: 'CREATE_FOLDER',
    patterns: [
      /پوشه\s*بساز|ساختن\s*پوشه|create\s+(?:a\s+)?folder|make\s+(?:a\s+)?folder|mkdir/i,
    ],
  },
  {
    intent: 'RUN_COMMAND',
    patterns: [
      /اجرا\s*کن|run\s+command|execute|بیلد\s*کن|build|تست\s*کن|test/i,
    ],
  },
  {
    intent: 'SEARCH_FILE',
    patterns: [
      /پیدا\s*کن|جستجو|search\s+for|find\s+file/i,
    ],
  },
  {
    intent: 'SAVE_FILE',
    patterns: [
      /ذخیره\s*کن|save\s+(?:the\s+)?file|save\s+it/i,
    ],
  },
  {
    intent: 'RENAME_FILE',
    patterns: [
      /تغییر\s*اسم|rename|name\s+change/i,
    ],
  },
  {
    intent: 'DELETE_FILE',
    patterns: [
      /حذف\s*کن|پاک\s*کن|delete\s+(?:the\s+)?file|remove/i,
    ],
  },
];

// ─── Intent Classification ─────────────────────────────────────────────────

/**
 * Classify the user's message into an actionable intent.
 * Returns NONE if the message doesn't match any action pattern.
 */
export function classifyIntent(message: string): AgentIntent {
  const trimmed = message.trim();
  for (const { intent, patterns } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        return intent;
      }
    }
  }
  return 'NONE';
}

// ─── Reference Resolution ──────────────────────────────────────────────────

/**
 * Extract file/folder paths from a message (e.g., "hello.txt" from "hello.txt رو باز کن").
 */
function extractPathFromMessage(message: string): string | null {
  // Match filenames with extensions
  const fileMatch = message.match(/([A-Za-z0-9_\-\/\\]+\.[a-zA-Z]{1,5})/);
  if (fileMatch) return fileMatch[1];

  // Match folder names (no extension, alphanumeric + dash + underscore)
  const folderMatch = message.match(/(?:پوشه|folder)\s*(?:ای|به)?\s*(?:اسم|نام)?\s*[:：]?\s*([A-Za-z0-9_\-]+)/i);
  if (folderMatch) return folderMatch[1];

  return null;
}

/**
 * Extract old_text/new_text for edit operations from the message.
 * e.g., "کلمه نکس رو به NEX AI تغییر بده" → oldText="نکس", newText="NEX AI"
 */
function extractEditText(message: string): { oldText?: string; newText?: string } {
  // Pattern: "X رو به Y تغییر بده" / "X to Y"
  const faMatch = message.match(/(.+?)\s*رو?\s*به\s*(.+?)\s*(?:تغییر|عوض|تبدیل)/i);
  if (faMatch) {
    const oldText = faMatch[1].replace(/^(کلمه|متن|واژه)\s*/i, '').trim();
    const newText = faMatch[2].trim();
    return { oldText, newText };
  }

  const enMatch = message.match(/change\s+(.+?)\s+to\s+(.+?)(?:\s+in|$)/i);
  if (enMatch) {
    return { oldText: enMatch[1].trim(), newText: enMatch[2].trim() };
  }

  return {};
}

/**
 * Resolve a reference in the user's message to a concrete file/folder path.
 * Uses: conversation history (last artifact), active file, explicit path.
 */
export function resolveReference(
  message: string,
  context: {
    lastArtifactPath?: string;
    lastArtifactFolder?: string;
    activeFile?: string | null;
    projectPath?: string | null;
  }
): IntentResult {
  const intent = classifyIntent(message);

  if (intent === 'NONE') {
    return { intent: 'NONE', resolved: false, reason: 'No actionable intent detected' };
  }

  // Try to extract an explicit path from the message
  const explicitPath = extractPathFromMessage(message);

  // Resolve the target path based on context
  let filePath: string | undefined;
  let folderPath: string | undefined;

  if (explicitPath) {
    // User mentioned a specific file/folder name
    if (explicitPath.includes('.') || intent === 'OPEN_FILE' || intent === 'READ_FILE' || intent === 'EDIT_FILE') {
      filePath = context.projectPath
        ? `${context.projectPath}/${explicitPath}`.replace(/\/+/g, '/')
        : explicitPath;
    } else {
      folderPath = context.projectPath
        ? `${context.projectPath}/${explicitPath}`.replace(/\/+/g, '/')
        : explicitPath;
    }
  } else {
    // Use pronoun/reference resolution
    // "بازش کن" → last artifact file
    // "پوشه‌ش رو باز کن" → last artifact folder
    if (intent === 'OPEN_FILE' || intent === 'READ_FILE' || intent === 'EDIT_FILE') {
      filePath = context.lastArtifactPath || context.activeFile || undefined;
    } else if (intent === 'OPEN_FOLDER' || intent === 'REVEAL_FILE') {
      if (context.lastArtifactFolder) {
        folderPath = context.lastArtifactFolder;
      } else if (context.lastArtifactPath) {
        // Derive folder from file path
        const parts = context.lastArtifactPath.split(/[\/\\]/);
        parts.pop();
        folderPath = parts.join('/');
      }
    } else if (intent === 'SHOW_LOCATION') {
      if (context.lastArtifactPath) {
        filePath = context.lastArtifactPath;
      }
      if (context.lastArtifactFolder) {
        folderPath = context.lastArtifactFolder;
      }
    }
  }

  // Extract edit text if applicable
  const editText = intent === 'EDIT_FILE' ? extractEditText(message) : {};

  const resolved = !!(filePath || folderPath || intent === 'CREATE_FILE' || intent === 'CREATE_FOLDER');

  return {
    intent,
    filePath,
    folderPath,
    content: undefined,
    oldText: editText.oldText,
    newText: editText.newText,
    resolved,
    reason: resolved ? undefined : 'Could not resolve reference — no artifact or active file in context',
  };
}

// ─── Action Execution ──────────────────────────────────────────────────────

/**
 * Execute the resolved intent as a UI action.
 * Returns a human-readable result message.
 */
export async function executeIntent(result: IntentResult): Promise<string> {
  if (!result.resolved) {
    return `❌ نمی‌توانم منظور شما را متوجه شوم. ${result.reason || ''}`;
  }

  const store = useStore.getState();

  switch (result.intent) {
    case 'OPEN_FILE': {
      if (!result.filePath) {
        return '❌ فایلی برای باز کردن مشخص نیست. لطفاً نام فایل را ذکر کنید.';
      }
      try {
        await store.openFile(result.filePath);
        const name = result.filePath.split(/[\/\\]/).pop();
        return `📄 فایل "${name}" در ویرایشگر باز شد.\n📍 ${result.filePath}`;
      } catch (err: any) {
        return translateError(err, 'باز کردن فایل');
      }
    }

    case 'READ_FILE': {
      if (!result.filePath) {
        return '❌ فایلی برای خواندن مشخص نیست.';
      }
      try {
        const readResult = await window.nexAPI.readFile(result.filePath);
        if (!readResult.success) {
          return `❌ خواندن فایل ناموفق بود: ${readResult.error || 'خطای ناشناخته'}`;
        }
        const name = result.filePath.split(/[\/\\]/).pop();
        const content = readResult.content || '';
        const preview = content.length > 500 ? content.slice(0, 500) + '...' : content;
        return `📄 محتویات "${name}":\n\n${preview}`;
      } catch (err: any) {
        return translateError(err, 'خواندن فایل');
      }
    }

    case 'REVEAL_FILE':
    case 'OPEN_FOLDER':
    case 'SHOW_LOCATION': {
      const targetPath = result.filePath || result.folderPath;
      if (!targetPath) {
        return '❌ مسیری برای نمایش مشخص نیست.';
      }
      try {
        // Verify the path exists
        const statResult = await window.nexAPI.stat(targetPath);
        if (!statResult.success || !statResult.stat) {
          return `❌ مسیر یافت نشد: ${targetPath}`;
        }

        // Navigate the file explorer to the parent folder
        const parts = targetPath.split(/[\/\\]/);
        const isFile = !statResult.stat.isDirectory;
        const folderPath = isFile ? parts.slice(0, -1).join('/') : targetPath;

        // Set workspace to the folder
        if (folderPath) {
          await window.nexAPI.fsSetWorkspace(folderPath);
        }

        // If it's a file, also open it in the editor
        if (isFile && result.filePath) {
          await store.openFile(result.filePath);
        }

        const name = targetPath.split(/[\/\\]/).pop();
        return `📁 مسیر نمایش داده شد:\n📍 ${targetPath}`;
      } catch (err: any) {
        return translateError(err, 'نمایش مسیر');
      }
    }

    case 'EDIT_FILE': {
      if (!result.filePath) {
        return '❌ فایلی برای ویرایش مشخص نیست.';
      }
      if (!result.oldText || !result.newText) {
        return '❌ برای ویرایش، متن قدیم و جدید را مشخص کنید. مثال: «کلمه X رو به Y تغییر بده»';
      }
      try {
        // Read the file first
        const readResult = await window.nexAPI.readFile(result.filePath);
        if (!readResult.success) {
          return `❌ خواندن فایل ناموفق بود: ${readResult.error}`;
        }

        // Perform the replacement
        const content = readResult.content || '';
        if (!content.includes(result.oldText)) {
          return `❌ متن "${result.oldText}" در فایل یافت نشد.`;
        }

        const newContent = content.split(result.oldText).join(result.newText);

        // Write back
        const writeResult = await window.nexAPI.writeFile(result.filePath, newContent);
        if (!writeResult.success) {
          return `❌ نوشتن فایل ناموفق بود: ${writeResult.error}`;
        }

        // Refresh editor if the file is open
        const openFile = store.openFiles.find(f => f.path === result.filePath);
        if (openFile) {
          store.updateFileContent(result.filePath, newContent);
        }

        const name = result.filePath.split(/[\/\\]/).pop();
        return `✏️ فایل "${name}" ویرایش شد.\n📊 تغییر: "${result.oldText}" → "${result.newText}"\n📍 ${result.filePath}`;
      } catch (err: any) {
        return translateError(err, 'ویرایش فایل');
      }
    }

    default:
      return `این عملیات (${result.intent}) نیاز به Agent دارد. لطفاً با جزئیات بیشتری درخواست کنید.`;
  }
}

// ─── Error Translation ─────────────────────────────────────────────────────

/**
 * Translate technical errors into human-readable Persian messages.
 */
export function translateError(err: any, operation: string): string {
  const message = err?.message || String(err);
  const code = err?.code || '';

  // ENOENT — file not found
  if (code === 'ENOENT' || /no such file|not found|یافت نشد/i.test(message)) {
    return `❌ ${operation} ناموفق بود: فایل یافت نشد.\n💡 مطمئن شوید مسیر فایل صحیح است.`;
  }

  // EACCES — permission denied
  if (code === 'EACCES' || /permission|access denied|دسترسی/i.test(message)) {
    return `❌ ${operation} ناموفق بود: دسترسی لازم وجود ندارد.\n💡 بررسی کنید آیا فایل فقط‌خواندنی نیست یا دسترسی ادمین لازم است.`;
  }

  // VRAM error
  if (/vram|context size.*too large|insufficient.*memory|out of memory|oom/i.test(message)) {
    return `❌ ${operation} ناموفق بود: مدل محلی در حال حاضر حافظه کافی برای پردازش این درخواست ندارد.\n💡 برنامه را restart کنید یا از یک مدل کوچک‌تر استفاده کنید.`;
  }

  // Context shift error
  if (/compress|context shift/i.test(message)) {
    return `❌ ${operation} ناموفق بود: context خیلی بزرگ است.\n💡 مکالمه را کوتاه کنید یا برنامه را restart کنید.`;
  }

  // Generic fallback
  return `❌ ${operation} ناموفق بود: ${message}`;
}

// ─── Artifact Tracking ─────────────────────────────────────────────────────

/**
 * Extract artifact paths from the agent's last response.
 * Looks for file paths in the artifact summary format.
 */
export interface ArtifactInfo {
  files: string[];
  folders: string[];
}

export function extractArtifactsFromResponse(response: string): ArtifactInfo {
  const files: string[] = [];
  const folders: string[] = [];

  // Match paths after bullets (e.g., "  • D:\...\hello.txt" or "  • /path/to/file")
  const lines = response.split('\n');
  for (const line of lines) {
    const match = line.match(/[•▪]\s*(.+)/);
    if (match) {
      const path = match[1].trim();
      // Check if it looks like a file (has extension) or folder
      if (/\.[a-zA-Z]{1,5}$/.test(path)) {
        files.push(path);
      } else {
        folders.push(path);
      }
    }
  }

  return { files, folders };
}

/**
 * Check if a message is a follow-up action request that can be handled
 * without invoking the LLM (e.g., "بازش کن" after creating a file).
 */
export function isActionableFollowUp(message: string): boolean {
  const intent = classifyIntent(message);
  // These intents can be handled directly without LLM
  return ['OPEN_FILE', 'REVEAL_FILE', 'OPEN_FOLDER', 'READ_FILE', 'SHOW_LOCATION', 'EDIT_FILE'].includes(intent);
}
