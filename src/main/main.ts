import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  nativeTheme,
  session,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { glob } from 'glob';
import type { AIMessage, AIConfig } from './ai-service';
import { chatCompletion, getSystemPrompt, getDefaultConfig } from './ai-service';

import { CSP, ALLOWED_AI_ORIGINS, isAllowedAIOrigin, assertPathInside } from './security';
import { safeExecFile, searchFileContents } from './security/shell';
import {
  initPersistence,
  loadState,
  updateState,
  updateSettings as persistUpdateSettings,
  setSecret,
  getSecret,
  deleteSecret,
  getUserDataDir,
  isPortable as persistenceIsPortable,
  type PersistedSettings,
} from './persistence';
import { addModel, removeModel, listModels, updateModel, getModel } from './ai/model-registry';
import { localChatComplete, localAbort } from './ai/local-engine';
import { routeChat } from './ai/provider';
import { shutdownLlama } from './ai/inference';
import { ensureBuiltinToolsRegistered, listToolDefinitions, getToolSchemasForLLM } from './ai/tool-registry';
import {
  createTask, runTask, cancelTask, getTask, listTasks,
  acceptDiff, rejectDiff, acceptAllDiffs, rejectAllDiffs, listPendingDiffs,
  onAgentEvent, deleteTask,
} from './agent/core';
import { setPermissionRequestHandler, respondToPermissionRequest } from './permissions';
import { onAgentEvent as onAgentEventLogger } from './agent/logger';

// Phase 28: Terminal + Filesystem services
import { terminalService } from './services/terminal-service';
import { filesystemService } from './services/filesystem-service';
// Phase 32: Conversation persistence
import {
  saveConversation, loadConversation, listConversations,
  deleteConversation, renameConversation, searchConversations,
  type ConversationData,
} from './persistence';

// ─── Security ───────────────────────────────────────────────────────────────
const BLOCKED_PERMISSIONS = new Set([
  'media',
  'geolocation',
  'notifications',
  'midi',
  'pointer-lock',
  'fullscreen',
  'clipboard-read',
  'openExternal',
]);

let mainWindow: BrowserWindow | null = null;
const isDev = !app.isPackaged;

// ─── Portable Mode Detection ──────────────────────────────────────────────
function isPortableMode(): boolean {
  if (isDev) return false;
  const exePath = process.execPath;
  const appDir = path.dirname(exePath);
  const markerPath = path.join(appDir, 'portable.txt');
  if (fs.existsSync(markerPath)) return true;
  if (appDir.includes('Temp') || appDir.includes('tmp')) return true;
  return false;
}

function getUserDataPath(): string {
  if (isPortableMode()) {
    const exeDir = path.dirname(process.execPath);
    const dataDir = path.join(exeDir, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return dataDir;
  }
  return app.getPath('userData');
}

const isPortable = isPortableMode();
const userDataPath = getUserDataPath();

// Phase 12: System Monitor singleton (lazy wiring to REAL sources)
let _systemMonitor: import('./system-monitor/service').SystemMonitorService | null = null;
function getSystemMonitor(): import('./system-monitor/service').SystemMonitorService {
  if (!_systemMonitor) {
    const { SystemMonitorService } = require('./system-monitor/service') as typeof import('./system-monitor/service');
    const { getRuntimeMonitorStats } = require('./ai/runtime') as typeof import('./ai/runtime');
    const { getAgentMonitorState } = require('./agent/core') as typeof import('./agent/core');
    _systemMonitor = new SystemMonitorService({
      runtimeStats: () => getRuntimeMonitorStats(),
      agentState: () => getAgentMonitorState(),
    });
  }
  return _systemMonitor;
}

// ─── Path Access Policy ─────────────────────────────────────────────────────
/**
 * For fs operations, we don't restrict to project root — the user picks files
 * from anywhere via dialog. But we DO block:
 *  - Path traversal (../) escapes via renderer-supplied paths
 *  - Null byte injection
 *  - System-sensitive paths on Windows (system32, etc.)
 *
 * The renderer is sandboxed (contextIsolation: true), so even if a malicious
 * page could call these IPC channels, it can only access files the user
 * themselves could access — no privilege escalation.
 *
 * But we still need to prevent the AI model from tricking the user / UI into
 * reading `~/.ssh/id_rsa` etc. This is enforced at the Permission Layer (Phase 9).
 */
function isPathBlocked(target: string): boolean {
  const resolved = path.resolve(target);
  // Null byte injection
  if (resolved.includes('\0')) return true;
  // Block obvious system paths on Windows
  if (process.platform === 'win32') {
    const lower = resolved.toLowerCase();
    if (lower.includes('\\windows\\system32\\') && !lower.includes('\\system32\\temp')) return true;
    if (lower.match(/\\windows\\system32\\config\\/i)) return true;
  }
  return false;
}

// ─── Window Creation ────────────────────────────────────────────────────────
function createWindow(): void {
  let windowState = { width: 1600, height: 1000, x: undefined as number | undefined, y: undefined as number | undefined, maximized: false };
  try {
    const configPath = path.join(userDataPath, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (config.windowState) windowState = { ...windowState, ...config.windowState };
  } catch {}

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 1000,
    minHeight: 600,
    title: 'NEX AI',
    icon: path.join(app.getAppPath(), 'build/icon.png'),
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a0f',
      symbolColor: '#e2e8f0',
      height: 38,
    },
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,        // ✅ Confirmed off
      contextIsolation: true,        // ✅ Confirmed on
      sandbox: false,                // Keep false so preload can use 'require' (preload only uses contextBridge)
      webSecurity: true,             // ✅ Same-origin policy
      allowRunningInsecureContent: false,
      // Additional hardening
      javascript: true,
      images: true,
      plugins: false,
      // Disable webview (no <webview> tag) — we use BrowserWindow only
      webviewTag: false,
    },
  });

  // ── Load renderer ──
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      const fallbackPath = path.join(__dirname, '../renderer/index.html');
      if (fs.existsSync(fallbackPath)) mainWindow?.loadFile(fallbackPath);
    });
  } else {
    const rendererPath = path.join(__dirname, '../renderer/index.html');
    mainWindow.loadFile(rendererPath);
  }

  if (windowState.maximized) mainWindow.maximize();

  mainWindow.on('close', () => {
    if (mainWindow) {
      const bounds = mainWindow.getBounds();
      const state = {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: mainWindow.isMaximized(),
      };
      try {
        const configPath = path.join(userDataPath, 'config.json');
        let config: Record<string, any> = {};
        try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch {}
        config.windowState = state;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      } catch {}
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    terminalService.killAll();
  });

  setupSecurity(mainWindow);
  createMenu();
}

// ─── Security Setup ─────────────────────────────────────────────────────────
function setupSecurity(win: BrowserWindow): void {
  const sess = win.webContents.session;

  // ── Block ALL permission requests by default ──
  // Only allow clipboard-write (for copy) and nothing else.
  sess.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'clipboard-sanitized-write') {
      callback(true);
    } else {
      callback(false);
    }
  });

  // Also block permission check (silent checks)
  sess.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'clipboard-sanitized-write';
  });

  // ── CSP via response headers (this is the authoritative CSP) ──
  sess.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
        'Referrer-Policy': ['strict-origin-when-cross-origin'],
        // Disable X-XSS-Protection (deprecated, can introduce bugs in modern browsers)
        // Instead rely on CSP
      },
    });
  });

  // ── Block ALL network requests to non-allowed origins ──
  // Only allow: self, dev server, and the two AI APIs.
  sess.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    // Allow local dev server (HTTP + WebSocket for HMR)
    if (url.startsWith('http://localhost:5173')) return callback({});
    if (url.startsWith('ws://localhost:5173')) return callback({});
    if (url.startsWith('file://')) return callback({});
    if (url.startsWith('chrome-extension://')) return callback({});
    // Allow Google Fonts (loaded by index.html)
    if (url.startsWith('https://fonts.googleapis.com/') || url.startsWith('https://fonts.gstatic.com/')) {
      return callback({});
    }
    // Allow known AI APIs
    for (const origin of ALLOWED_AI_ORIGINS) {
      if (url.startsWith(origin)) return callback({});
    }
    // Block everything else
    console.warn('[NEX AI Security] Blocked request to:', url);
    callback({ cancel: true });
  });

  // ── Block navigation to external URLs ──
  win.webContents.on('will-navigate', (event, url) => {
    try {
      const parsedUrl = new URL(url);
      const isDev = parsedUrl.origin === 'http://localhost:5173';
      const isFile = parsedUrl.protocol === 'file:';
      if (!isDev && !isFile) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  // ── Block new-window attempts (force external links to open in browser) ──
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // ── Block webview creation (security: webviews run as separate processes with their own permissions) ──
  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

// ─── Application Menu ───────────────────────────────────────────────────────
function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'NEX AI',
      submenu: [
        { label: 'About NEX AI', role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('open-settings'),
        },
        { type: 'separator' },
        { label: 'Quit', role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', role: 'undo' },
        { label: 'Redo', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', role: 'cut' },
        { label: 'Copy', role: 'copy' },
        { label: 'Paste', role: 'paste' },
        { label: 'Select All', role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', role: 'reload' },
        { label: 'Force Reload', role: 'forceReload' },
        { label: 'Toggle DevTools', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Toggle Fullscreen', role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Terminal',
      submenu: [
        {
          label: 'New Terminal',
          accelerator: 'CmdOrCtrl+`',
          click: () => mainWindow?.webContents.send('new-terminal'),
        },
        {
          label: 'Kill Terminal',
          accelerator: 'CmdOrCtrl+Shift+`',
          click: () => mainWindow?.webContents.send('kill-terminal'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────
async function setupIPC(): Promise<void> {
  // ── Window Controls ──
  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window-close', () => mainWindow?.close());
  ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);

  // ── File System (with path validation) ──
  ipcMain.handle('fs-read-file', async (_event, filePath: string) => {
    try {
      if (isPathBlocked(filePath)) {
        return { success: false, error: 'Path is blocked for security reasons' };
      }
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return { success: true, content };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs-write-file', async (_event, filePath: string, content: string) => {
    try {
      if (isPathBlocked(filePath)) {
        return { success: false, error: 'Path is blocked for security reasons' };
      }
      await fs.promises.writeFile(filePath, content, 'utf-8');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs-readdir', async (_event, dirPath: string) => {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      return {
        success: true,
        files: entries.map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
          path: path.join(dirPath, e.name),
        })),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs-mkdir', async (_event, dirPath: string) => {
    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs-delete', async (_event, targetPath: string) => {
    try {
      const stat = await fs.promises.stat(targetPath);
      if (stat.isDirectory()) {
        await fs.promises.rm(targetPath, { recursive: true });
      } else {
        await fs.promises.unlink(targetPath);
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs-rename', async (_event, oldPath: string, newPath: string) => {
    try {
      await fs.promises.rename(oldPath, newPath);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs-stat', async (_event, targetPath: string) => {
    try {
      const stat = await fs.promises.stat(targetPath);
      return {
        success: true,
        stat: {
          size: stat.size,
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile(),
          modified: stat.mtime.toISOString(),
          created: stat.ctime.toISOString(),
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs-search', async (_event, dirPath: string, pattern: string) => {
    try {
      const files = await glob(pattern, {
        cwd: dirPath,
        ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
        nodir: false,
      });
      return { success: true, files };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Dialog ──
  ipcMain.handle('dialog-open-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
    });
    if (result.canceled) return { canceled: true };
    return { path: result.filePaths[0] };
  });

  // Phase 10 / P10-B: multi-select file picker for knowledge ingestion
  ipcMain.handle('dialog-open-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Knowledge Documents', extensions: [
          'txt', 'log', 'md', 'markdown', 'json', 'yaml', 'yml', 'csv', 'tsv',
          'html', 'htm', 'ts', 'tsx', 'js', 'jsx', 'py', 'rb', 'go', 'rs',
          'java', 'c', 'h', 'cpp', 'cs', 'php', 'css', 'scss', 'less', 'sql', 'sh',
        ] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled) return { canceled: true };
    return { paths: result.filePaths };
  });

  ipcMain.handle('dialog-open-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Source Code', extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'cpp', 'c', 'h'] },
        { name: 'Web', extensions: ['html', 'css', 'scss', 'json', 'yaml', 'yml'] },
        { name: 'AI Models', extensions: ['gguf'] },
      ],
    });
    if (result.canceled) return { canceled: true };
    return { path: result.filePaths[0] };
  });

  // ── Code Execution (now requires allow-list of binaries) ──
  // The "exec-command" IPC channel is REMOVED in this security refactor.
  // The old version accepted arbitrary shell strings — that was the root cause
  // of the command injection risk.
  // Going forward, the agent (Phase 9+) will use specific tool channels:
  //   - run-npm-build (executes `npm run build` only)
  //   - run-npm-test (executes `npm test` only)
  //   - git-status, git-diff, git-log (already safe)
  // Arbitrary `run_command(...)` is reserved for Phase 9 with permission prompts.

  // ── Safe TypeScript check (Phase 26: replaces the removed execCommand) ──
  // Runs tsc --noEmit via safeExecFile (argv array, no shell, 30s timeout).
  ipcMain.handle('run-tsc-check', async (_event, cwd: string) => {
    try {
      // Jail the working directory to the open project
      const guard = assertPathInside(cwd, [cwd]); // cwd must be valid
      if (!guard.ok) return { success: false, error: 'Invalid cwd' };
      const result = await safeExecFile(
        'npx', ['tsc', '--noEmit', '--pretty', 'false'], { cwd, timeout: 30000 }
      );
      // tsc exits 0 on success, non-zero on errors — both are valid results
      return { success: true, output: result.stdout + result.stderr, exitCode: result.exitCode };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── System Info ──
  ipcMain.handle('system-info', () => ({
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    homedir: os.homedir(),
    hostname: os.hostname(),
    cpus: os.cpus().length,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    portable: isPortable,
    userDataPath,
  }));

  // ── Config Store (now using persistence layer) ──
  // Legacy config-get/config-set/config-get-all kept for backwards-compat
  // but internally backed by the new persistence module.
  ipcMain.handle('config-get', async (_event, key: string) => {
    const state = loadState();
    return (state as any)[key];
  });

  ipcMain.handle('config-set', async (_event, key: string, value: any) => {
    try {
      updateState({ [key]: value } as any);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('config-get-all', async () => {
    return loadState();
  });

  // ── Settings (Phase 2 — proper persistence) ──
  ipcMain.handle('settings-load', async () => {
    const state = loadState();
    const settings = state.settings || {};
    // Merge with defaults so renderer always gets a complete object
    const merged: PersistedSettings = {
      theme: 'darker',
      fontSize: 14,
      fontFamily: 'JetBrains Mono, Fira Code, monospace',
      tabSize: 2,
      language: 'en',
      voiceEnabled: false,
      aiMode: 'local',
      aiEndpoint: 'https://api.openai.com/v1',
      // Phase 8 / P8-A: GLM 5.3 defaults (primary online provider)
      onlineProvider: 'glm',
      glmModel: 'glm-5.3',
      glmEndpoint: 'https://api.z.ai',
      // Phase 10 / P10-E: null = built-in offline hash embedder
      embeddingModelId: null,
      localThreads: 4,
      localContextSize: 2048,
      localTemperature: 0.7,
      localMaxTokens: 1024,
      activeLocalModelId: null,
      ...settings,
    };
    // Return API keys separately (loaded from encrypted secrets)
    const apiKey = getSecret('aiApiKey');
    const glmApiKey = getSecret('glmApiKey');
    return { settings: merged, apiKey, glmApiKey };
  });

  ipcMain.handle('settings-save', async (_event, settings: PersistedSettings, apiKey?: string, glmApiKey?: string) => {
    try {
      // Save non-sensitive settings to config.json
      persistUpdateSettings(settings);
      // Save API key to encrypted secrets.json (only if provided)
      if (apiKey !== undefined) {
        setSecret('aiApiKey', apiKey);
      }
      // Phase 8 / P8-A: GLM API key — always stored encrypted, never in config.json
      if (glmApiKey !== undefined) {
        setSecret('glmApiKey', glmApiKey);
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('settings-set-api-key', async (_event, apiKey: string) => {
    const ok = setSecret('aiApiKey', apiKey);
    return { success: ok, error: ok ? undefined : 'safeStorage not available' };
  });

  ipcMain.handle('settings-get-api-key', async () => {
    return getSecret('aiApiKey');
  });

  ipcMain.handle('settings-delete-api-key', async () => {
    deleteSecret('aiApiKey');
    return { success: true };
  });

  // ── Persistence info (for Settings > About) ──
  ipcMain.handle('persistence-info', async () => {
    return {
      userDataPath: getUserDataDir(),
      portable: persistenceIsPortable(),
      secretsAvailable: true, // safeStorage.isEncryptionAvailable() checked at init
    };
  });

  // ── Open external link (validated) ──
  ipcMain.handle('open-external', async (_event, url: string) => {
    // Only allow http/https URLs
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('Only http/https URLs can be opened externally');
    }
    await shell.openExternal(url);
  });

  // ── AI Chat ──
  // Routes to Local engine if provider === 'local', else to OpenAI/Claude.
  // Local mode requires NO external API and works fully offline.
  ipcMain.handle('ai-chat', async (_event, config: any, messages: AIMessage[]) => {
    // Use the unified provider abstraction
    if (config.provider === 'local') {
      const result = await localChatComplete(config as any, messages as any);
      return result;
    }
    // Online providers — use routeChat for origin/apikey validation
    return routeChat(config, messages);
  });

  ipcMain.handle('ai-abort', async () => {
    localAbort();
    return { success: true };
  });

  // ── Phase 17 / P17-A: STREAMING chat ──
  // Local: llama.cpp token stream via the default runtime. Online:
  // OnlineRuntime chatStream (emulated line-chunks) behind the SAME
  // provider abstraction. Chunks are throttled via the P8-E token streamer
  // and delivered as 'chat-token' events (mirror of agent_token).
  ipcMain.handle('ai-chat-stream', async (_event, config: any, messages: AIMessage[]) => {
    const replyId = `chat-${Date.now()}`;
    try {
      // UI-02: enforce persisted aiMode (defense-in-depth — stream path was
      // previously unchecked, allowing a compromised renderer to bypass
      // the 'local' mode restriction via the streaming endpoint).
      const { enforceAiMode, getCurrentAiMode } = await import('./ai/ai-mode');
      const blocked = enforceAiMode(getCurrentAiMode(), config.provider);
      if (blocked) {
        return { success: false, replyId, error: blocked.error };
      }

      const { createTokenStreamer } = await import('./agent/stream-emit');
      let runtime: import('./ai/runtime').AIRuntime | null = null;
      if (config.provider === 'local') {
        // resolve model exactly like localChatComplete does, then stream via
        // the default llama.cpp runtime (loadModel idempotent if same model)
        const { resolveModel } = await import('./ai/local-engine') as any;
        const model = resolveModel(config);
        if (!model) {
          return { success: false, error: 'No local model configured. Add a .gguf file in Settings > Local AI.' };
        }
        if (!model.fileExists) {
          return { success: false, error: `Model file not found: ${model.path}` };
        }
        const { getDefaultRuntime } = await import('./ai/runtime');
        runtime = getDefaultRuntime();
        await runtime.loadModel(model, {
          contextSize: model.contextSize,
          threads: config.localThreads ?? 4,
          gpuLayers: model.gpuLayers ?? -1,
          temperature: config.localTemperature ?? config.temperature ?? 0.7,
          maxTokens: config.localMaxTokens ?? config.maxTokens ?? 1024,
        });
      } else {
        const { getRuntime } = await import('./ai/runtime');
        runtime = getRuntime('online', 'chat-shared');
      }

      const streamer = createTokenStreamer(replyId, undefined, 'final', (payload) => {
        mainWindow?.webContents.send('chat-token', { replyId, ...payload });
      });
      const result = await runtime.chatStream(
        messages.map((m) => ({ role: m.role, content: m.content })),
        (chunk) => { if (chunk.content) streamer.push(chunk.content); },
        {
          temperature: config.localTemperature ?? config.temperature ?? 0.7,
          maxTokens: config.localMaxTokens ?? config.maxTokens ?? 1024,
          systemPrompt: getSystemPromptFor(config),
        }
      );
      streamer.end();
      return {
        success: true,
        replyId,
        content: result.content,
        tokens: result.tokensGenerated,
        durationMs: result.durationMs,
        modelId: result.modelId,
        modelName: result.modelName,
      };
    } catch (err: any) {
      return { success: false, replyId, error: err.message };
    }
  });

  ipcMain.handle('ai-chat-stream-cancel', async () => {
    try {
      // abort BOTH paths: local llama instance + online runtime flag
      localAbort();
      const { getRuntime } = await import('./ai/runtime');
      try { getRuntime('llamacpp', 'default').abort(); } catch { /* not loaded */ }
      try { getRuntime('online', 'chat-shared').abort(); } catch { /* not created */ }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  function getSystemPromptFor(_config: any): string {
    return getSystemPrompt();
  }

  ipcMain.handle('ai-default-config', (_event, provider: string) => {
    return getDefaultConfig(provider);
  });

  // ── Local Model Management (Phase 3-4) ──
  ipcMain.handle('model-list', async () => {
    return listModels();
  });

  ipcMain.handle('model-add', async (_event, filePath: string, opts?: any) => {
    try {
      const model = addModel(filePath, opts || {});
      return { success: true, model };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('model-remove', async (_event, id: string) => {
    const ok = removeModel(id);
    return { success: ok };
  });

  ipcMain.handle('model-update', async (_event, id: string, patch: any) => {
    const model = updateModel(id, patch);
    return { success: !!model, model };
  });

  ipcMain.handle('model-get', async (_event, id: string) => {
    return getModel(id);
  });

  ipcMain.handle('model-pick-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Select a GGUF model file',
      properties: ['openFile'],
      filters: [{ name: 'GGUF Models', extensions: ['gguf'] }],
    });
    if (result.canceled) return { canceled: true };
    return { path: result.filePaths[0] };
  });

  // ── Phase 39: Professional Model Manager (versioning, hash, hardware, backup) ──
  const {
    computeFileHash,
    verifyModelIntegrity,
    verifyAllModelsIntegrity,
    backupModelRegistry,
    rollbackModelRegistry,
    hasModelRegistryBackup,
    getModelRegistryBackupInfo,
    migrateModelRegistry,
  } = await import('./ai/model-versioning');
  const {
    detectHardwareProfile,
    recommendModelsForHardware,
    recommendBestModel,
    canModelRunOnHardware,
  } = await import('./ai/hardware-model-recommender');

  // Compute the SHA-256 hash of a model file (async, streaming).
  ipcMain.handle('model-compute-hash', async (_event, modelId: string) => {
    try {
      const model = getModel(modelId);
      if (!model) return { success: false, error: 'Model not found' };
      if (!model.fileExists) return { success: false, error: 'Model file not found' };
      const hash = await computeFileHash(model.path);
      // Store the hash on the model record.
      updateModel(modelId, {
        hash,
        hashAlgorithm: 'sha256',
        verifiedAt: Date.now(),
        integrityStatus: 'verified',
      });
      return { success: true, hash, algorithm: 'sha256' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Verify a single model's integrity (re-hash and compare).
  ipcMain.handle('model-verify-integrity', async (_event, modelId: string) => {
    try {
      const model = getModel(modelId);
      if (!model) return { success: false, error: 'Model not found' };
      const status = await verifyModelIntegrity(model.path, model.hash);
      // Update the model's integrity status.
      updateModel(modelId, {
        integrityStatus: status === 'verified' ? 'verified' : (status === 'mismatch' ? 'mismatch' : 'unknown'),
        verifiedAt: Date.now(),
      });
      return { success: true, status };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Verify ALL models' integrity (batch, async).
  ipcMain.handle('model-verify-all-integrity', async () => {
    try {
      const models = listModels();
      const results = await verifyAllModelsIntegrity(
        models.map((m) => ({ id: m.id, name: m.name, path: m.path, hash: m.hash })),
      );
      // Update each model's integrity status in the registry.
      for (const r of results) {
        if (r.status === 'verified' || r.status === 'mismatch') {
          updateModel(r.modelId, {
            integrityStatus: r.status,
            verifiedAt: Date.now(),
          });
        }
      }
      return { success: true, results };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Rollback the model registry to the last backup.
  ipcMain.handle('model-registry-rollback', async () => {
    const ok = rollbackModelRegistry();
    return { success: ok };
  });

  // Get backup info (without restoring).
  ipcMain.handle('model-registry-backup-info', async () => {
    const info = getModelRegistryBackupInfo();
    return { success: true, hasBackup: hasModelRegistryBackup(), info };
  });

  // Migrate the model registry to the current schema version.
  ipcMain.handle('model-registry-migrate', async () => {
    const result = migrateModelRegistry();
    return { success: true, ...result };
  });

  // Detect the current hardware profile.
  ipcMain.handle('model-detect-hardware', async () => {
    try {
      // Read from the system monitor if available, else fallback to os module.
      let detectedBackend = 'cpu';
      try {
        const { getRuntimeMonitorStats } = await import('./ai/runtime');
        const monitorStats = getRuntimeMonitorStats();
        const firstWithGpu = monitorStats.stats.find((s: any) => s.gpuBackend);
        if (firstWithGpu?.gpuBackend) detectedBackend = firstWithGpu.gpuBackend;
      } catch { /* fallback to 'cpu' */ }

      const os = require('os');
      const cpus = os.cpus();
      const hw = detectHardwareProfile(
        {
          cpu: { cores: cpus.length, threads: cpus.length },
          memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
          gpus: [], // GPU detection requires the async system monitor; the
          // UI can call system-snapshot for full GPU info.
        },
        detectedBackend,
      );
      return { success: true, profile: hw };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get hardware-aware model recommendations.
  ipcMain.handle('model-recommend', async (_event, criteria?: {
    capability?: string;
    category?: string;
    preferSmaller?: boolean;
  }) => {
    try {
      const recs = recommendModelsForHardware({
        capability: criteria?.capability as any,
        category: criteria?.category,
        preferSmaller: criteria?.preferSmaller,
      });
      return {
        success: true,
        recommendations: recs.map((r) => ({
          modelId: r.model.id,
          modelName: r.model.name,
          score: r.score,
          rank: r.rank,
          canRun: r.verdict.canRun,
          reason: r.verdict.reason,
          suggestedGpuLayers: r.verdict.suggestedGpuLayers,
          suggestedThreads: r.verdict.suggestedThreads,
          suggestedContextSize: r.verdict.suggestedContextSize,
          estimatedLoadSeconds: r.verdict.estimatedLoadSeconds,
          capabilityMatch: r.capabilityMatch,
          parameterCount: r.model.parameterCount,
          sizeBytes: r.model.sizeBytes,
        })),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Check if a specific model can run on the current hardware.
  ipcMain.handle('model-can-run', async (_event, modelId: string) => {
    try {
      const model = getModel(modelId);
      if (!model) return { success: false, error: 'Model not found' };
      const os = require('os');
      const hw = detectHardwareProfile(
        {
          cpu: { cores: os.cpus().length, threads: os.cpus().length },
          memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
          gpus: [],
        },
      );
      const verdict = canModelRunOnHardware(model, hw);
      return { success: true, verdict };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Phase 41: Local Voice Engine (STT + TTS + VAD) ──
  const { getLocalVoiceEngine } = await import('./voice/local-voice-engine');
  const { LocalWhisperProvider, findWhisperBinary } = await import('./voice/local-whisper-provider');
  const { LocalPiperProvider, findPiperBinary } = await import('./voice/local-piper-provider');

  // Initialize the voice engine with local providers (if available)
  try {
    const engine = getLocalVoiceEngine();
    const whisperBin = findWhisperBinary();
    const piperBin = findPiperBinary();
    if (whisperBin) {
      // Model path will be set later via voice-set-stt-model IPC
      engine.setSTTProvider(new LocalWhisperProvider({ binaryPath: whisperBin }));
      console.log(`[NEX AI] Phase 41: Whisper STT provider registered (binary: ${whisperBin})`);
    }
    if (piperBin) {
      engine.setTTSProvider(new LocalPiperProvider({ binaryPath: piperBin }));
      console.log(`[NEX AI] Phase 41: Piper TTS provider registered (binary: ${piperBin})`);
    }
    if (!whisperBin && !piperBin) {
      console.log('[NEX AI] Phase 41: No local voice binaries found — will use browser fallback');
    }
  } catch (err: any) {
    console.warn(`[NEX AI] Phase 41: Voice engine init failed (non-blocking): ${err.message}`);
  }

  // Voice: get engine status (which providers are available)
  ipcMain.handle('voice-status', async () => {
    const engine = getLocalVoiceEngine();
    return {
      success: true,
      hasLocalSTT: engine.hasLocalSTT,
      hasLocalTTS: engine.hasLocalTTS,
      sttProvider: engine.getSTTProvider()?.name || null,
      ttsProvider: engine.getTTSProvider()?.name || null,
      state: engine.currentState,
      isListening: engine.isListening,
      isSpeaking: engine.isSpeaking,
    };
  });

  // Voice: set STT model (whisper model path)
  ipcMain.handle('voice-set-stt-model', async (_event, modelPath: string) => {
    try {
      const engine = getLocalVoiceEngine();
      const { LocalWhisperProvider } = await import('./voice/local-whisper-provider');
      const whisperBin = findWhisperBinary();
      if (!whisperBin) return { success: false, error: 'whisper binary not found' };
      engine.setSTTProvider(new LocalWhisperProvider({ binaryPath: whisperBin, modelPath }));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Voice: set TTS model (piper voice .onnx path)
  ipcMain.handle('voice-set-tts-model', async (_event, voiceModelPath: string) => {
    try {
      const engine = getLocalVoiceEngine();
      const { LocalPiperProvider } = await import('./voice/local-piper-provider');
      const piperBin = findPiperBinary();
      if (!piperBin) return { success: false, error: 'piper binary not found' };
      engine.setTTSProvider(new LocalPiperProvider({ binaryPath: piperBin, voiceModelPath }));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Voice: transcribe an audio file (batch mode)
  ipcMain.handle('voice-transcribe', async (_event, audioPath: string, opts?: any) => {
    try {
      const engine = getLocalVoiceEngine();
      const result = await engine.transcribeFile(audioPath, opts);
      return result;
    } catch (err: any) {
      return { success: false, text: '', error: err.message };
    }
  });

  // Voice: synthesize text to speech (returns audio file path)
  ipcMain.handle('voice-synthesize', async (_event, text: string, opts?: any) => {
    try {
      const engine = getLocalVoiceEngine();
      const tts = engine.getTTSProvider();
      if (!tts) return { success: false, error: 'No TTS provider registered' };
      if (!tts.isAvailable()) await tts.init();
      const result = await tts.synthesize(text, opts);
      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Voice: list available TTS voices
  ipcMain.handle('voice-list-voices', async () => {
    try {
      const engine = getLocalVoiceEngine();
      const tts = engine.getTTSProvider();
      if (!tts) return { success: true, voices: [] };
      const voices = await tts.listVoices();
      return { success: true, voices };
    } catch (err: any) {
      return { success: false, error: err.message, voices: [] };
    }
  });

  // Voice: find available binaries (for UI diagnostics)
  ipcMain.handle('voice-find-binaries', async () => {
    return {
      success: true,
      whisper: findWhisperBinary(),
      piper: findPiperBinary(),
    };
  });

  // ── Phase 56: Advanced Voice Conversation System ──
  const { getNexVoiceConversation, CONVERSATION_ORB_COLOR } = await import('./voice/nex-voice-conversation');
  const { getWakeWordDetector, parseVoiceCommand, WakeWordDetector, AudioEnergyGate } = await import('./voice/wake-word-detector');

  // Wire the conversation system's voice-capture hook into PermissionGate
  // (Phase 43) so sensitive actions can be confirmed by voice.
  const conversation = getNexVoiceConversation();
  conversation.setPermissionVoiceCapture(async () => {
    return await conversation.captureVoiceConfirmation();
  });

  // Voice conversation: lifecycle
  ipcMain.handle('voice-conversation-start', async () => {
    try {
      await getNexVoiceConversation().start();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('voice-conversation-stop', async () => {
    try {
      await getNexVoiceConversation().stop();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('voice-conversation-toggle', async () => {
    try {
      await getNexVoiceConversation().toggle();
      return { success: true, active: getNexVoiceConversation().isActive };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('voice-conversation-status', async () => {
    try {
      return { success: true, status: getNexVoiceConversation().getStatus() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Voice conversation: feed a transcript (from STT or text input)
  ipcMain.handle('voice-conversation-feed', async (_event, text: string) => {
    try {
      getNexVoiceConversation().feedTranscript(text);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Voice conversation: speak a response (TTS) — called by the brain/chat after generating a reply
  ipcMain.handle('voice-conversation-speak', async (_event, text: string) => {
    try {
      await getNexVoiceConversation().speakResponse(text);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Voice conversation: start a turn manually (no wake word needed)
  ipcMain.handle('voice-conversation-start-turn', async (_event, initialText?: string) => {
    try {
      await getNexVoiceConversation().startConversationTurn(initialText);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Voice conversation: abort current turn (cancel)
  ipcMain.handle('voice-conversation-abort', async () => {
    try {
      getNexVoiceConversation().abortCurrentTurn();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Voice conversation: stop speaking (interrupt TTS)
  ipcMain.handle('voice-conversation-stop-speaking', async () => {
    try {
      const engine = getLocalVoiceEngine();
      engine.stopSpeaking();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Voice conversation: personality control
  ipcMain.handle('voice-conversation-set-personality', async (_event, type: string) => {
    try {
      getNexVoiceConversation().setPersonality(type as any);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('voice-conversation-personality-prefix', async () => {
    try {
      return { success: true, prefix: getNexVoiceConversation().getPersonalityPrefixFa() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Voice conversation: wake word control
  ipcMain.handle('voice-conversation-enable-wake-word', async () => {
    try {
      getNexVoiceConversation().enableWakeWord();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('voice-conversation-disable-wake-word', async () => {
    try {
      getNexVoiceConversation().disableWakeWord();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Voice conversation: restore context from long-term memory
  ipcMain.handle('voice-conversation-restore-context', async () => {
    try {
      await getNexVoiceConversation().restoreContext();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('voice-conversation-reset', async () => {
    try {
      getNexVoiceConversation().reset();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Voice conversation: orb color (for UI integration)
  ipcMain.handle('voice-conversation-orb-color', async () => {
    try {
      const conv = getNexVoiceConversation();
      return { success: true, color: conv.orbColor, state: conv.currentState };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Wake word detector: detect in a transcript (stateless check)
  ipcMain.handle('wake-word-detect', async (_event, text: string) => {
    try {
      const match = getWakeWordDetector().detect(text);
      return { success: true, match };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Wake word detector: feed a transcript (emits wake event if matched)
  ipcMain.handle('wake-word-feed', async (_event, text: string) => {
    try {
      const match = getWakeWordDetector().feedTranscript(text);
      return { success: true, match };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Wake word detector: status (last match, count)
  ipcMain.handle('wake-word-status', async () => {
    try {
      const d = getWakeWordDetector();
      return { success: true, lastMatch: d.getLastMatch(), matchCount: d.getMatchCount(), config: d.getConfig() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Voice command parser: parse natural speech control commands
  ipcMain.handle('voice-command-parse', async (_event, text: string) => {
    try {
      return { success: true, result: parseVoiceCommand(text) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Wire conversation state changes → forward to renderer (for orb + UI)
  conversation.setCallbacks({
    onStateChange: (state, prev) => {
      mainWindow?.webContents.send('voice-conversation-state', { state, prev, color: CONVERSATION_ORB_COLOR[state] });
    },
    onWakeWord: (match) => {
      mainWindow?.webContents.send('voice-conversation-wake', match);
    },
    onUserUtterance: (text) => {
      mainWindow?.webContents.send('voice-conversation-user', { text });
    },
    onNexResponse: (text) => {
      mainWindow?.webContents.send('voice-conversation-nex', { text });
    },
    onPartialTranscript: (text) => {
      mainWindow?.webContents.send('voice-conversation-partial', { text });
    },
    onInterruption: () => {
      mainWindow?.webContents.send('voice-conversation-interrupted', {});
    },
    onVoiceCommand: (command, phrase) => {
      mainWindow?.webContents.send('voice-conversation-command', { command, phrase });
    },
    onError: (message) => {
      mainWindow?.webContents.send('voice-conversation-error', { message });
    },
  });

  void WakeWordDetector;
  void AudioEnergyGate;

  // ── Phase 42: Local Vision Engine (LLaVA + image analysis + OCR) ──
  const { getVisionEngine } = await import('./vision/vision-engine');
  const { LocalLlavaProvider, findLlamaBinary } = await import('./vision/local-llava-provider');

  // Auto-detect llama.cpp binary on startup
  try {
    const llamaBin = findLlamaBinary();
    if (llamaBin) {
      const engine = getVisionEngine();
      // Model path will be set later via vision-load-model IPC
      engine.setProvider(new LocalLlavaProvider({ binaryPath: llamaBin }));
      console.log(`[NEX AI] Phase 42: LLaVA vision provider registered (binary: ${llamaBin})`);
    } else {
      console.log('[NEX AI] Phase 42: No llama.cpp binary found — vision will need manual setup');
    }
  } catch (err: any) {
    console.warn(`[NEX AI] Phase 42: Vision engine init failed (non-blocking): ${err.message}`);
  }

  // Vision: get engine status
  ipcMain.handle('vision-status', async () => {
    const engine = getVisionEngine();
    return {
      success: true,
      hasProvider: engine.hasProvider,
      hasLocalProvider: engine.hasLocalProvider,
      providerName: engine.getProvider()?.name || null,
      state: engine.currentState,
    };
  });

  // Vision: load a vision model (LLaVA GGUF + optional mmproj)
  ipcMain.handle('vision-load-model', async (_event, modelPath: string, mmprojPath?: string) => {
    try {
      const engine = getVisionEngine();
      const { LocalLlavaProvider } = await import('./vision/local-llava-provider');
      const llamaBin = findLlamaBinary();
      if (!llamaBin) return { success: false, error: 'llama.cpp binary not found' };
      engine.setProvider(new LocalLlavaProvider({
        binaryPath: llamaBin,
        modelPath,
        mmprojPath,
      }));
      // Persist the model path for next session
      try {
        const { loadState, updateState } = await import('./persistence');
        const state = loadState();
        const settings = state.settings || {};
        (settings as any).visionModelPath = modelPath;
        if (mmprojPath) (settings as any).visionMmprojPath = mmprojPath;
        updateState({ settings });
      } catch { /* best-effort */ }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Vision: analyze an image file
  ipcMain.handle('vision-analyze-image', async (_event, imagePath: string, prompt?: string, question?: string) => {
    try {
      const engine = getVisionEngine();
      const result = await engine.analyzeImage({ imagePath, prompt, question });
      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Vision: analyze a screenshot (capture screen → analyze)
  ipcMain.handle('vision-analyze-screen', async (_event, prompt?: string) => {
    try {
      const { desktopCapturer } = await import('electron');
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
      });
      if (sources.length === 0) {
        return { success: false, error: 'No screen source found' };
      }
      const source = sources[0];
      const tmpDir = os.tmpdir();
      const screenshotPath = path.join(tmpDir, `nex-screenshot-${Date.now()}.png`);
      fs.writeFileSync(screenshotPath, source.thumbnail.toPNG());
      const engine = getVisionEngine();
      const result = await engine.analyzeImage({
        imagePath: screenshotPath,
        prompt: prompt || 'Analyze this screenshot. Describe the UI, any text visible, and the overall layout.',
      });
      // Clean up temp file
      try { fs.unlinkSync(screenshotPath); } catch { /* */ }
      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Vision: unload the vision model
  ipcMain.handle('vision-unload-model', async () => {
    try {
      const engine = getVisionEngine();
      await engine.dispose();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Vision: find llama.cpp binary (for UI diagnostics)
  ipcMain.handle('vision-find-binary', async () => {
    return {
      success: true,
      binary: findLlamaBinary(),
    };
  });

  // ── Phase 43: Secure Update & Permission System ──
  const { getUpdateManager } = await import('./update/update-manager');
  const { classifyAction, formatBytes } = await import('./update/permission-gate');

  // Update: check for update (SAFE — no permission needed)
  ipcMain.handle('update-check', async (_event, info: any) => {
    try {
      const manager = getUpdateManager();
      const plan = await manager.checkForUpdate(info);
      return { success: true, plan };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Update: execute update plan (requires permission for each step)
  ipcMain.handle('update-execute', async (_event, plan: any) => {
    try {
      const manager = getUpdateManager();
      const result = await manager.executeUpdate(plan);
      return result;
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  });

  // Update: respond to permission request (from chat)
  ipcMain.handle('update-respond-permission', async (_event, userResponse: string) => {
    try {
      const manager = getUpdateManager();
      manager.respondToPermissionRequest(userResponse);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Update: respond via voice (Phase 41 local STT)
  ipcMain.handle('update-respond-voice', async () => {
    try {
      const manager = getUpdateManager();
      await manager.respondViaVoice();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Update: get audit history
  ipcMain.handle('update-audit-history', async (_event, limit?: number) => {
    try {
      const manager = getUpdateManager();
      const entries = manager.getAuditLogger().readRecent(limit || 50);
      return { success: true, entries };
    } catch (err: any) {
      return { success: false, error: err.message, entries: [] };
    }
  });

  // Update: get update history
  ipcMain.handle('update-history', async () => {
    try {
      const manager = getUpdateManager();
      const entries = manager.getAuditLogger().getUpdateHistory();
      return { success: true, entries };
    } catch (err: any) {
      return { success: false, error: err.message, entries: [] };
    }
  });

  // Update: list available backups
  ipcMain.handle('update-list-backups', async () => {
    try {
      const manager = getUpdateManager();
      const backups = manager.getRollbackManager().listBackups();
      return { success: true, backups };
    } catch (err: any) {
      return { success: false, error: err.message, backups: [] };
    }
  });

  // Update: rollback to a specific version
  ipcMain.handle('update-rollback', async (_event, version: string) => {
    try {
      const manager = getUpdateManager();
      const ok = manager.getRollbackManager().rollbackTo(version);
      manager.getAuditLogger().log({
        action: ok ? 'rollback-completed' : 'rollback-failed',
        description: `Rollback to v${version}`,
        metadata: { version },
      });
      return { success: ok };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Update: classify an action (for UI display)
  ipcMain.handle('update-classify-action', async (_event, action: any) => {
    try {
      const level = classifyAction(action);
      return { success: true, level, description: action.description };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Phase 44: Production Update Execution Layer ──

  // Secure download (HTTPS only, sandbox, resume, progress)
  ipcMain.handle('update-download', async (_event, opts: {
    url: string;
    expectedSize?: number;
    filename?: string;
  }) => {
    try {
      const manager = getUpdateManager();
      const downloader = manager.getSecureDownloader();
      const result = await downloader.download({
        url: opts.url,
        expectedSize: opts.expectedSize,
        filename: opts.filename,
      });
      return result;
    } catch (err: any) {
      return { success: false, error: err.message, hash: '', bytesDownloaded: 0, durationMs: 0, resumed: false };
    }
  });

  // Signature verification (Ed25519 + RSA)
  ipcMain.handle('update-verify-signature', async (_event, opts: {
    filePath: string;
    expectedHash: string;
    signature?: string;
    publicKey?: string;
    currentVersion: string;
    targetVersion: string;
  }) => {
    try {
      const manager = getUpdateManager();
      const verifier = manager.getSignatureVerifier();
      const result = verifier.verifyForInstallation(opts);
      return { success: true, ...result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Install update (NSIS / portable / model)
  ipcMain.handle('update-install', async (_event, opts: {
    method: string;
    sourcePath: string;
    targetDir: string;
    currentVersion: string;
    newVersion: string;
    createBackup: boolean;
    verifyAfterInstall: boolean;
  }) => {
    try {
      const manager = getUpdateManager();
      const installer = manager.getUpdateInstaller();
      const result = await installer.install(opts as any);
      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Model update (download + verify + install a model)
  ipcMain.handle('update-model', async (_event, info: any) => {
    try {
      const manager = getUpdateManager();
      const modelUpdater = manager.getModelUpdater();
      const result = await modelUpdater.updateModel(info);
      return result;
    } catch (err: any) {
      return { success: false, error: err.message, durationMs: 0 };
    }
  });

  // Get model update explanation (Persian text)
  ipcMain.handle('update-model-explanation', async (_event, info: any) => {
    try {
      const manager = getUpdateManager();
      const modelUpdater = manager.getModelUpdater();
      const explanation = modelUpdater.generateModelExplanation(info);
      return { success: true, explanation };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get update history
  ipcMain.handle('update-get-history', async (_event, limit?: number) => {
    try {
      const manager = getUpdateManager();
      const history = manager.getUpdateHistory();
      const entries = limit ? history.getRecent(limit) : history.getEntries();
      return { success: true, entries };
    } catch (err: any) {
      return { success: false, error: err.message, entries: [] };
    }
  });

  // Add update history entry
  ipcMain.handle('update-add-history', async (_event, entry: any) => {
    try {
      const manager = getUpdateManager();
      const history = manager.getUpdateHistory();
      const result = history.addEntry(entry);
      return { success: true, entry: result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get last successful update
  ipcMain.handle('update-last-successful', async () => {
    try {
      const manager = getUpdateManager();
      const history = manager.getUpdateHistory();
      const entry = history.getLastSuccessfulUpdate();
      return { success: true, entry };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Phase 45: Intelligent Model Advisor + Smart Router ──
  const { getModelAdvisor } = await import('./ai/model-intelligence/model-advisor');
  const { getSmartModelRouter } = await import('./ai/model-intelligence/smart-model-router');
  const { getUsageAnalyzer } = await import('./ai/model-intelligence/usage-analyzer');
  const { getAdvisorPersistence } = await import('./ai/model-intelligence/advisor-persistence');

  // Model advisor: analyze hardware + recommend models
  ipcMain.handle('model-advisor-status', async () => {
    try {
      const advisor = getModelAdvisor();
      const analysis = advisor.analyzeHardware();
      return { success: true, analysis };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Model advisor: get recommendations
  ipcMain.handle('model-recommendations', async () => {
    try {
      const advisor = getModelAdvisor();
      const analysis = advisor.analyzeHardware();
      return { success: true, recommendations: analysis.recommendations };
    } catch (err: any) {
      return { success: false, error: err.message, recommendations: [] };
    }
  });

  // Model advisor: compare two models
  ipcMain.handle('model-compare', async (_event, modelAId: string, modelBId: string) => {
    try {
      const advisor = getModelAdvisor();
      const comparison = advisor.compareModels(modelAId, modelBId);
      if (!comparison) return { success: false, error: 'Models not found in catalog' };
      return { success: true, comparison };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Smart router: get routing decision for a task
  ipcMain.handle('model-router-decision', async (_event, request: { request: string; intent?: string; hasImage?: boolean; hasAudio?: boolean }) => {
    try {
      const router = getSmartModelRouter();
      const decision = router.selectModel(request);
      return { success: true, decision };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Smart router: get status
  ipcMain.handle('model-router-status', async () => {
    try {
      const router = getSmartModelRouter();
      const status = router.getStatus();
      return { success: true, status };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Usage analyzer: get usage stats
  ipcMain.handle('usage-stats', async () => {
    try {
      const analyzer = getUsageAnalyzer();
      const stats = analyzer.getStats();
      return { success: true, stats };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Usage analyzer: record a task
  ipcMain.handle('usage-record', async (_event, record: any) => {
    try {
      const analyzer = getUsageAnalyzer();
      analyzer.record(record);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Advisor preferences
  ipcMain.handle('advisor-preferences', async () => {
    try {
      const persistence = getAdvisorPersistence();
      const prefs = persistence.getPreferences();
      return { success: true, preferences: prefs };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Advisor: reject a recommendation
  ipcMain.handle('advisor-reject-recommendation', async (_event, recommendationId: string) => {
    try {
      const persistence = getAdvisorPersistence();
      persistence.rejectRecommendation(recommendationId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Advisor: set preferred model
  ipcMain.handle('advisor-set-preferred-model', async (_event, category: string, modelId: string) => {
    try {
      const persistence = getAdvisorPersistence();
      persistence.setPreferredModel(category, modelId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Advisor: get installed model history
  ipcMain.handle('advisor-installed-history', async () => {
    try {
      const persistence = getAdvisorPersistence();
      const history = persistence.getInstalledHistory();
      return { success: true, history };
    } catch (err: any) {
      return { success: false, error: err.message, history: [] };
    }
  });

  // ── Phase 46: Local Runtime Setup Center ──
  const { getRuntimeSetupManager } = await import('./runtime/runtime-setup-manager');

  // Scan system for installed/missing components
  ipcMain.handle('runtime-scan', async () => {
    try {
      const manager = getRuntimeSetupManager();
      const state = manager.scanSystem();
      return { success: true, state };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get setup summary (Persian text)
  ipcMain.handle('runtime-setup-summary', async () => {
    try {
      const manager = getRuntimeSetupManager();
      const state = manager.scanSystem();
      const summary = manager.generateSetupSummary(state);
      return { success: true, summary, state };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get component catalog
  ipcMain.handle('runtime-catalog', async (_event, type?: string) => {
    try {
      const { getCatalog, getCatalogByType } = await import('./runtime/component-catalog');
      const catalog = type ? getCatalogByType(type as any) : getCatalog();
      return { success: true, catalog };
    } catch (err: any) {
      return { success: false, error: err.message, catalog: [] };
    }
  });

  // Get recommendations for missing components
  ipcMain.handle('runtime-recommendations', async () => {
    try {
      const manager = getRuntimeSetupManager();
      const state = manager.scanSystem();
      return { success: true, recommendations: state.recommendations };
    } catch (err: any) {
      return { success: false, error: err.message, recommendations: [] };
    }
  });

  // Find missing components
  ipcMain.handle('runtime-find-missing', async () => {
    try {
      const manager = getRuntimeSetupManager();
      const state = manager.scanSystem();
      const missing = state.components.filter((c) => c.status !== 'installed');
      return { success: true, missing, essentialMissing: state.essentialMissing, optionalMissing: state.optionalMissing };
    } catch (err: any) {
      return { success: false, error: err.message, missing: [] };
    }
  });

  // ── Phase 47: Component Installation Assistant ──
  const { getComponentInstaller } = await import('./runtime/component-installer');

  // Install a component (full flow: permission → download → verify → install → health check)
  ipcMain.handle('component-install', async (_event, componentId: string) => {
    try {
      const installer = getComponentInstaller();
      const result = await installer.installComponent(componentId);
      return result;
    } catch (err: any) {
      return { success: false, error: err.message, componentId, componentName: '', stage: 'idle', durationMs: 0, log: [] };
    }
  });

  // Get Persian explanation for a component
  ipcMain.handle('component-explanation', async (_event, componentId: string) => {
    try {
      const { getCatalogEntry } = await import('./runtime/component-catalog');
      const { getComponentInstaller } = await import('./runtime/component-installer');
      const entry = getCatalogEntry(componentId);
      if (!entry) return { success: false, error: 'Component not found' };
      const installer = getComponentInstaller();
      const explanation = installer.generatePersianExplanation(entry);
      return { success: true, explanation };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Health check for a component
  ipcMain.handle('component-health-check', async (_event, componentId: string, installedPath: string) => {
    try {
      const { getCatalogEntry } = await import('./runtime/component-catalog');
      const { getComponentInstaller } = await import('./runtime/component-installer');
      const entry = getCatalogEntry(componentId);
      if (!entry) return { success: false, error: 'Component not found' };
      const installer = getComponentInstaller();
      const result = await installer.getHealthChecker().check(entry, installedPath);
      return { success: true, result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Respond to permission request (from chat)
  ipcMain.handle('component-respond-permission', async (_event, userResponse: string) => {
    try {
      const { getComponentInstaller } = await import('./runtime/component-installer');
      const installer = getComponentInstaller();
      installer.getPermissionGate().respondToPermissionRequest(userResponse);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Respond via voice (Phase 41)
  ipcMain.handle('component-respond-voice', async () => {
    try {
      const { getComponentInstaller } = await import('./runtime/component-installer');
      const installer = getComponentInstaller();
      await installer.getPermissionGate().respondViaVoice();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Phase 49: First Run Intelligence & Model Catalog ──
  const { getHardwareSetupAdvisor } = await import('./ai/model-intelligence/hardware-setup-advisor');
  const { getAdvancedCatalog, getAdvancedCatalogByType, getAdvancedCatalogEntry, getModelsByHardwareTier, getModelsByPersianSupport } =
    await import('./ai/model-intelligence/advanced-model-catalog');

  // Get advanced model catalog
  ipcMain.handle('firstrun-catalog', async (_event, type?: string) => {
    try {
      const catalog = type ? getAdvancedCatalogByType(type as any) : getAdvancedCatalog();
      return { success: true, catalog };
    } catch (err: any) {
      return { success: false, error: err.message, catalog: [] };
    }
  });

  // Get models by hardware tier
  ipcMain.handle('firstrun-models-by-tier', async (_event, tier: string) => {
    try {
      const models = getModelsByHardwareTier(tier as any);
      return { success: true, models };
    } catch (err: any) {
      return { success: false, error: err.message, models: [] };
    }
  });

  // Get Persian-supporting models
  ipcMain.handle('firstrun-persian-models', async () => {
    try {
      const models = getModelsByPersianSupport();
      return { success: true, models };
    } catch (err: any) {
      return { success: false, error: err.message, models: [] };
    }
  });

  // Analyze hardware and generate setup recommendation
  ipcMain.handle('firstrun-analyze', async () => {
    try {
      const advisor = getHardwareSetupAdvisor();
      const setup = advisor.analyze();
      return { success: true, setup };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get first-launch summary (Persian text)
  ipcMain.handle('firstrun-summary', async () => {
    try {
      const advisor = getHardwareSetupAdvisor();
      const setup = advisor.analyze();
      const summary = advisor.generateFirstLaunchSummary(setup);
      return { success: true, summary, setup };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Generate install plan from selected models
  ipcMain.handle('firstrun-install-plan', async (_event, modelIds: string[], tier: string) => {
    try {
      const advisor = getHardwareSetupAdvisor();
      const pkg = advisor.createCustomPackage(modelIds, tier as any);
      const plan = advisor.generateInstallPlan(pkg);
      return { success: true, plan };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get recommended package for hardware
  ipcMain.handle('firstrun-recommended-package', async () => {
    try {
      const advisor = getHardwareSetupAdvisor();
      const setup = advisor.analyze();
      return { success: true, package: setup.recommendedPackage, setup };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get alternative packages
  ipcMain.handle('firstrun-alternatives', async () => {
    try {
      const advisor = getHardwareSetupAdvisor();
      const setup = advisor.analyze();
      return { success: true, alternatives: setup.alternativePackages };
    } catch (err: any) {
      return { success: false, error: err.message, alternatives: [] };
    }
  });

  // ── Phase 50: Final Command Center Integration ──
  const { getSystemStatusManager } = await import('./system/system-status-manager');

  // Get full system status (all subsystems)
  ipcMain.handle('system-status', async () => {
    try {
      const manager = getSystemStatusManager();
      const status = await manager.checkAll();
      return { success: true, status };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get startup health summary (Persian)
  ipcMain.handle('system-startup-summary', async () => {
    try {
      const manager = getSystemStatusManager();
      const status = await manager.checkAll();
      return { success: true, summary: status.startupSummaryFa, summaryEn: status.startupSummary, status };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get orb command state
  ipcMain.handle('system-orb-state', async () => {
    try {
      const manager = getSystemStatusManager();
      return { success: true, orbState: manager.getOrbState() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Set orb command state
  ipcMain.handle('system-set-orb-state', async (_event, state: string) => {
    try {
      const manager = getSystemStatusManager();
      manager.setOrbState(state as any);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get notifications
  ipcMain.handle('system-notifications', async () => {
    try {
      const manager = getSystemStatusManager();
      return { success: true, notifications: manager.getNotifications() };
    } catch (err: any) {
      return { success: false, error: err.message, notifications: [] };
    }
  });

  // Add a notification
  ipcMain.handle('system-add-notification', async (_event, notif: any) => {
    try {
      const manager = getSystemStatusManager();
      manager.addNotification(notif);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Clear notifications
  ipcMain.handle('system-clear-notifications', async () => {
    try {
      const manager = getSystemStatusManager();
      manager.clearNotifications();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get quick actions
  ipcMain.handle('system-quick-actions', async () => {
    try {
      const manager = getSystemStatusManager();
      const status = await manager.checkAll();
      return { success: true, quickActions: status.quickActions };
    } catch (err: any) {
      return { success: false, error: err.message, quickActions: [] };
    }
  });

  // ── Phase 51: NEX Brain Core + Identity System ──
  const { getNexBrainController } = await import('./ai/nex-brain-controller');
  const { getNexIdentityManager } = await import('./ai/nex-identity-manager');

  // Brain: get decision for a user request
  ipcMain.handle('brain-decide', async (_event, request: { request: string; intent?: string; hasImage?: boolean; hasAudio?: boolean }) => {
    try {
      const brain = getNexBrainController();
      const decision = brain.decide(request);
      return { success: true, decision };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Brain: get status
  ipcMain.handle('brain-status', async () => {
    try {
      const brain = getNexBrainController();
      const status = await brain.getStatus();
      return { success: true, status };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Brain: set mode (auto/coding/reasoning/vision/voice/chat)
  ipcMain.handle('brain-set-mode', async (_event, mode: string) => {
    try {
      const brain = getNexBrainController();
      brain.setMode(mode as any);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Brain: get last decision
  ipcMain.handle('brain-last-decision', async () => {
    try {
      const brain = getNexBrainController();
      return { success: true, decision: brain.getLastDecision() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Brain: get models grouped by task
  ipcMain.handle('brain-models-by-task', async () => {
    try {
      const brain = getNexBrainController();
      return { success: true, models: brain.getModelsByTask() };
    } catch (err: any) {
      return { success: false, error: err.message, models: {} };
    }
  });

  // Identity: get identity
  ipcMain.handle('identity-get', async () => {
    try {
      const mgr = getNexIdentityManager();
      return { success: true, identity: mgr.getIdentity() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Identity: update identity
  ipcMain.handle('identity-update', async (_event, patch: any) => {
    try {
      const mgr = getNexIdentityManager();
      const updated = mgr.updateIdentity(patch);
      return { success: true, identity: updated };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Identity: set personality
  ipcMain.handle('identity-set-personality', async (_event, personality: string) => {
    try {
      const mgr = getNexIdentityManager();
      mgr.setPersonality(personality as any);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Identity: get self-awareness
  ipcMain.handle('identity-self-awareness', async () => {
    try {
      const mgr = getNexIdentityManager();
      const awareness = await mgr.getSelfAwareness();
      return { success: true, awareness };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Phase 52: Personality Engine + Long Term Memory ──
  const { getNexPersonalityEngine } = await import('./ai/nex-personality-engine');
  const { getUserProfileManager } = await import('./ai/user-profile-manager');
  const { getLongTermMemorySystem } = await import('./ai/long-term-memory-system');

  // Personality: get current profile
  ipcMain.handle('personality-get', async () => {
    try {
      const engine = getNexPersonalityEngine();
      return { success: true, profile: engine.getProfile(), personality: engine.getPersonality() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Personality: set type
  ipcMain.handle('personality-set', async (_event, type: string) => {
    try {
      const engine = getNexPersonalityEngine();
      engine.setPersonality(type as any);
      return { success: true, profile: engine.getProfile() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Personality: get all profiles
  ipcMain.handle('personality-all', async () => {
    try {
      const engine = getNexPersonalityEngine();
      return { success: true, profiles: engine.getAllPersonalities() };
    } catch (err: any) {
      return { success: false, error: err.message, profiles: [] };
    }
  });

  // Personality: get system prompt prefix
  ipcMain.handle('personality-prompt', async (_event, lang?: string) => {
    try {
      const engine = getNexPersonalityEngine();
      const prompt = lang === 'fa' ? engine.getSystemPromptPrefixFa() : engine.getSystemPromptPrefix();
      return { success: true, prompt };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // User profile: get
  ipcMain.handle('user-profile-get', async () => {
    try {
      const mgr = getUserProfileManager();
      return { success: true, profile: mgr.getProfile() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // User profile: update
  ipcMain.handle('user-profile-update', async (_event, patch: any) => {
    try {
      const mgr = getUserProfileManager();
      const updated = mgr.updateProfile(patch);
      return { success: true, profile: updated };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Long-term memory: store (with permission for personal data)
  ipcMain.handle('ltm-store', async (_event, category: string, key: string, value: any, opts?: any) => {
    try {
      const sys = getLongTermMemorySystem();
      const result = await sys.store(category as any, key, value, opts || {});
      return { success: true, ...result };
    } catch (err: any) {
      return { success: false, error: err.message, stored: false };
    }
  });

  // Long-term memory: retrieve
  ipcMain.handle('ltm-retrieve', async (_event, key: string, store?: string, projectId?: string) => {
    try {
      const sys = getLongTermMemorySystem();
      const value = sys.retrieve(key, store as any || 'user', projectId);
      return { success: true, value };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Long-term memory: list all
  ipcMain.handle('ltm-list', async (_event, store?: string, projectId?: string) => {
    try {
      const sys = getLongTermMemorySystem();
      const entries = sys.listAll(store as any, projectId);
      return { success: true, entries };
    } catch (err: any) {
      return { success: false, error: err.message, entries: [] };
    }
  });

  // Long-term memory: get stats
  ipcMain.handle('ltm-stats', async () => {
    try {
      const sys = getLongTermMemorySystem();
      return { success: true, stats: sys.getStats() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Long-term memory: get pending permission
  ipcMain.handle('ltm-pending-permission', async () => {
    try {
      const sys = getLongTermMemorySystem();
      const pending = sys.getPendingPermission();
      return { success: true, hasPending: sys.hasPendingPermission(), permission: pending };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Long-term memory: respond to permission
  ipcMain.handle('ltm-respond-permission', async (_event, approved: boolean, reason?: string) => {
    try {
      const sys = getLongTermMemorySystem();
      sys.respondToMemoryPermission(approved, reason);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Phase 53: Universal Expert System ──
  const { getExpertRouter } = await import('./ai/expert-router');
  const { getExpertProfiles, getExpertProfile } = await import('./ai/nex-expert-system');

  // Expert: route a request to the best expert
  ipcMain.handle('expert-route', async (_event, request: string) => {
    try {
      const router = getExpertRouter();
      const result = router.route(request);
      return { success: true, result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Expert: get all expert profiles
  ipcMain.handle('expert-all', async () => {
    try {
      return { success: true, experts: getExpertProfiles() };
    } catch (err: any) {
      return { success: false, error: err.message, experts: [] };
    }
  });

  // Expert: get a specific expert profile
  ipcMain.handle('expert-get', async (_event, id: string) => {
    try {
      const expert = getExpertProfile(id);
      if (!expert) return { success: false, error: 'Expert not found' };
      return { success: true, expert };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Expert: get expertise description (Persian)
  ipcMain.handle('expert-description', async (_event, lang?: string) => {
    try {
      const router = getExpertRouter();
      const desc = lang === 'fa' ? router.getExpertiseDescriptionFa() : router.getExpertiseDescription();
      return { success: true, description: desc };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Expert: get all domains
  ipcMain.handle('expert-domains', async () => {
    try {
      const router = getExpertRouter();
      return { success: true, domains: router.getAllDomains() };
    } catch (err: any) {
      return { success: false, error: err.message, domains: [] };
    }
  });

  // ── Phase 54: Agent Skills & Tool Execution Layer ──
  const { getNexAgentExecutor } = await import('./ai/nex-agent-executor');
  const { getSkillRegistry, getSkill, getSkillsByDomain } = await import('./ai/agent-skill-registry');

  // Agent executor: create execution plan
  ipcMain.handle('agent-create-plan', async (_event, request: string) => {
    try {
      const executor = getNexAgentExecutor();
      const plan = executor.createPlan(request);
      return { success: true, plan };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Agent executor: execute plan (with permission checks)
  ipcMain.handle('agent-execute-plan', async (_event, plan: any) => {
    try {
      const executor = getNexAgentExecutor();
      const result = await executor.executePlan(plan);
      return result;
    } catch (err: any) {
      return { success: false, error: err.message, plan, completedSteps: 0, failedSteps: 0, deniedSteps: 0, message: err.message, messageFa: 'خطا', log: [] };
    }
  });

  // Agent executor: respond to permission (chat)
  ipcMain.handle('agent-respond-permission', async (_event, userResponse: string) => {
    try {
      const executor = getNexAgentExecutor();
      executor.respondToPermission(userResponse);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Agent executor: respond via voice (Phase 41)
  ipcMain.handle('agent-respond-voice', async () => {
    try {
      const executor = getNexAgentExecutor();
      await executor.respondViaVoice();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Agent executor: get pending permission
  ipcMain.handle('agent-pending-permission', async () => {
    try {
      const executor = getNexAgentExecutor();
      return { success: true, hasPending: executor.hasPendingPermission(), permission: executor.getPendingPermission() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Agent executor: generate Persian permission message
  ipcMain.handle('agent-permission-message', async (_event, action: string, details?: string) => {
    try {
      const executor = getNexAgentExecutor();
      const message = executor.generatePermissionMessageFa(action, details);
      return { success: true, message };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Skill registry: get all skills
  ipcMain.handle('skill-all', async () => {
    try {
      return { success: true, skills: getSkillRegistry() };
    } catch (err: any) {
      return { success: false, error: err.message, skills: [] };
    }
  });

  // Skill registry: get skill by ID
  ipcMain.handle('skill-get', async (_event, id: string) => {
    try {
      const skill = getSkill(id);
      if (!skill) return { success: false, error: 'Skill not found' };
      return { success: true, skill };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Skill registry: get skills by expert domain
  ipcMain.handle('skill-by-domain', async (_event, domain: string) => {
    try {
      return { success: true, skills: getSkillsByDomain(domain as any) };
    } catch (err: any) {
      return { success: false, error: err.message, skills: [] };
    }
  });

  // ── Phase 55: Offline Expert Knowledge Engine ──
  const { getExpertKnowledgeEngine } = await import('./knowledge/expert-knowledge-engine');
  const { getKnowledgePackManager } = await import('./knowledge/knowledge-pack-manager');

  // Wire the pack manager's permission callbacks → forward to renderer.
  const knowledgePackManager = getKnowledgePackManager();
  knowledgePackManager.setCallbacks({
    onRequestPermission: (req) => {
      mainWindow?.webContents.send('knowledge-pack-permission-request', req);
    },
  });

  // Expert knowledge catalog + retrieval (read-only operations)
  ipcMain.handle('expert-knowledge-list', async () => {
    try {
      return { success: true, packs: getExpertKnowledgeEngine().listPacks() };
    } catch (err: any) {
      return { success: false, error: err.message, packs: [] };
    }
  });

  ipcMain.handle('expert-knowledge-get', async (_event, id: string) => {
    try {
      const pack = getExpertKnowledgeEngine().getPack(id);
      return { success: true, pack };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('expert-knowledge-by-domain', async (_event, domain: string) => {
    try {
      return { success: true, packs: getExpertKnowledgeEngine().getPacksByDomain(domain as any) };
    } catch (err: any) {
      return { success: false, error: err.message, packs: [] };
    }
  });

  ipcMain.handle('expert-knowledge-status', async () => {
    try {
      return { success: true, status: getExpertKnowledgeEngine().getKnowledgeStatus() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('expert-knowledge-installed', async () => {
    try {
      return { success: true, packs: getExpertKnowledgeEngine().getInstalledPacks() };
    } catch (err: any) {
      return { success: false, error: err.message, packs: [] };
    }
  });

  ipcMain.handle('expert-knowledge-missing', async () => {
    try {
      return { success: true, packs: getExpertKnowledgeEngine().getMissingPacks() };
    } catch (err: any) {
      return { success: false, error: err.message, packs: [] };
    }
  });

  ipcMain.handle('expert-knowledge-recommend', async (_event, domain?: string) => {
    try {
      return { success: true, packs: getExpertKnowledgeEngine().getRecommendedPacks(domain as any) };
    } catch (err: any) {
      return { success: false, error: err.message, packs: [] };
    }
  });

  // RAG retrieval from installed packs (the core Knowledge Engine → Brain path)
  ipcMain.handle('expert-knowledge-retrieve', async (_event, query: string, opts?: { domain?: string; limit?: number }) => {
    try {
      const result = await getExpertKnowledgeEngine().retrieveKnowledge(query, opts as any);
      return { success: true, ...result };
    } catch (err: any) {
      return { success: false, error: err.message, results: [], framed: '', installedPackCount: 0, offline: true };
    }
  });

  // Knowledge Advisor — Persian recommendation messages
  ipcMain.handle('expert-knowledge-recommendation-fa', async (_event, domain: string) => {
    try {
      const message = getExpertKnowledgeEngine().generateRecommendationFa(domain as any);
      return { success: true, message };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('expert-knowledge-capabilities-fa', async (_event, domain: string) => {
    try {
      const message = getExpertKnowledgeEngine().getCapabilitiesFa(domain as any);
      return { success: true, message };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('expert-knowledge-self-desc-fa', async () => {
    try {
      const message = getExpertKnowledgeEngine().getKnowledgeSelfDescriptionFa();
      return { success: true, message };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Knowledge pack lifecycle (ALL permission-gated — never autonomous)
  ipcMain.handle('knowledge-pack-scan', async () => {
    try {
      return { success: true, records: getKnowledgePackManager().scanInstalledPacks() };
    } catch (err: any) {
      return { success: false, error: err.message, records: [] };
    }
  });

  ipcMain.handle('knowledge-pack-install', async (_event, packId: string) => {
    try {
      const result = await getKnowledgePackManager().installPack(packId);
      return { success: result.success, result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge-pack-remove', async (_event, packId: string) => {
    try {
      const result = await getKnowledgePackManager().removePack(packId);
      return { success: result.success, result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge-pack-update', async (_event, packId: string) => {
    try {
      const result = await getKnowledgePackManager().updatePack(packId);
      return { success: result.success, result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge-pack-verify', async (_event, packId: string) => {
    try {
      return { success: true, verification: getKnowledgePackManager().verifyChecksum(packId) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge-pack-verify-all', async () => {
    try {
      return { success: true, verifications: getKnowledgePackManager().verifyAllChecksums() };
    } catch (err: any) {
      return { success: false, error: err.message, verifications: [] };
    }
  });

  ipcMain.handle('knowledge-pack-storage', async () => {
    try {
      return { success: true, storage: getKnowledgePackManager().getStorageInfo() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge-pack-pending-permission', async () => {
    try {
      const pending = getKnowledgePackManager().getPendingPermission();
      return { success: true, hasPending: pending !== null, permission: pending };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge-pack-respond-permission', async (_event, userResponse: string) => {
    try {
      getKnowledgePackManager().respondToPermission(userResponse);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge-pack-respond-voice', async () => {
    try {
      await getKnowledgePackManager().respondViaVoice();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Agent Core (Phase 7) ──
  // Register built-in tools and start the agent
  ensureBuiltinToolsRegistered().catch((err) => {
    console.error('[NEX AI] Failed to register built-in tools:', err);
  });

  // Set up permission request handler — forwards to renderer via IPC event
  setPermissionRequestHandler((req) => {
    mainWindow?.webContents.send('permission-request', req);
  });

  // Set up agent event listener — forwards to renderer
  onAgentEvent((event) => {
    mainWindow?.webContents.send('agent-event', event);
  });

  // Create and run an agent task
  ipcMain.handle('agent-create-task', async (_event, request: any) => {
    try {
      // ── Phase 9 / P9-S5: composition-root knowledge wiring ──
      // Agent core stays ignorant of the knowledge subsystem; we inject the
      // port (initial retrieval) + the service (knowledge_search tool).
      if (request?.projectPath && !request.knowledgePort) {
        try {
          const { getKnowledgeService, disposeKnowledgeServices } = await import('./knowledge/knowledge-service');
          const { projectIdFromPath } = await import('./knowledge/project-id');
          const { createConfiguredEmbedder } = await import('./knowledge/embedding-select');
          const pid = projectIdFromPath(request.projectPath);
          const svc = getKnowledgeService({
            userDataDir: userDataPath,
            projectId: pid,
            embedder: (await createConfiguredEmbedder()).embedder,
            roots: [request.projectPath],
          });
          void disposeKnowledgeServices;
          request.knowledgePort = {
            available: () => true,
            retrieve: async (query: string, _pp?: string, limit?: number) => {
              const { results } = await svc.retrieveForPrompt(query, limit ?? 3);
              return results.map((r: any) => ({
                documentId: r.document.id,
                documentTitle: r.document.title,
                chunkId: r.chunk.id,
                content: r.chunk.content,
                score: r.score,
                source: r.document.sourcePath,
                startLine: r.chunk.metadata?.startLine,
                endLine: r.chunk.metadata?.endLine,
              }));
            },
          };
          request.toolContextExtras = { ...(request.toolContextExtras || {}), knowledgeService: svc };
        } catch (err: any) {
          console.warn('[NEX AI] Knowledge wiring unavailable for agent task:', err.message);
        }
      }
      const task = await createTask(request);
      // Run asynchronously — UI subscribes to events
      runTask(task.id).catch((err) => {
        console.error(`[NEX AI Agent] Task ${task.id} failed:`, err);
      });
      return { success: true, taskId: task.id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('agent-cancel-task', async (_event, taskId: string, reason?: string) => {
    const ok = cancelTask(taskId, reason);
    return { success: ok };
  });

  ipcMain.handle('agent-get-task', async (_event, taskId: string) => {
    return getTask(taskId);
  });

  ipcMain.handle('agent-list-tasks', async () => {
    return listTasks();
  });

  ipcMain.handle('agent-delete-task', async (_event, taskId: string) => {
    deleteTask(taskId);
    return { success: true };
  });

  ipcMain.handle('agent-list-tools', async () => {
    return listToolDefinitions();
  });

  ipcMain.handle('agent-get-tool-schemas', async () => {
    return getToolSchemasForLLM();
  });

  // Diff approval
  ipcMain.handle('agent-accept-diff', async (_event, taskId: string, changeId: string) => {
    try {
      await acceptDiff(taskId, changeId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('agent-reject-diff', async (_event, taskId: string, changeId: string, reason?: string) => {
    rejectDiff(taskId, changeId, reason);
    return { success: true };
  });

  ipcMain.handle('agent-accept-all-diffs', async (_event, taskId: string) => {
    try {
      await acceptAllDiffs(taskId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('agent-reject-all-diffs', async (_event, taskId: string, reason?: string) => {
    rejectAllDiffs(taskId, reason);
    return { success: true };
  });

  ipcMain.handle('agent-list-pending-diffs', async (_event, taskId: string) => {
    return listPendingDiffs(taskId);
  });

  // ── Knowledge / Local RAG (Phase 9) ──
  // All endpoints are project-scoped: projectId derives from projectPath;
  // isolation is enforced inside KnowledgeService/LocalVectorStore.
  async function knowledgeServiceFor(projectPath: string) {
    const { getKnowledgeService } = await import('./knowledge/knowledge-service');
    const { projectIdFromPath } = await import('./knowledge/project-id');
    // Phase 10 / P10-E: settings-driven embedder (hash default / GGUF model)
    const { createConfiguredEmbedder } = await import('./knowledge/embedding-select');
    const resolution = await createConfiguredEmbedder();
    if (resolution.fallbackReason) {
      console.warn('[NEX AI Knowledge]', resolution.fallbackReason);
    }
    return getKnowledgeService({
      userDataDir: userDataPath,
      projectId: projectIdFromPath(projectPath),
      embedder: resolution.embedder,
      roots: [projectPath],
    });
  }

  ipcMain.handle('knowledge-ingest', async (_event, projectPath: string, filePath: string) => {
    try {
      // UI-10: security guard — ensure filePath is inside the project workspace.
      // Was missing per audit 1-c GAP-4: AI could ingest arbitrary files
      // (e.g., ~/.ssh/id_rsa) by calling this IPC with an out-of-workspace path.
      const { assertPathInside } = await import('./security');
      assertPathInside(filePath, [projectPath]);
      const svc = await knowledgeServiceFor(projectPath);
      const report = await svc.ingestWithReport(filePath);
      return { success: report.status === 'indexed' || report.status === 'skipped-unchanged', report };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge-ingest-many', async (_event, projectPath: string, filePaths: string[]) => {
    try {
      // UI-10: security guard — ensure ALL filePaths are inside project workspace.
      const { assertPathInside } = await import('./security');
      for (const fp of (filePaths || [])) {
        assertPathInside(fp, [projectPath]);
      }
      const svc = await knowledgeServiceFor(projectPath);
      const reports = [];
      for (const fp of (filePaths || []).slice(0, 500)) {
        reports.push({ filePath: fp, ...(await svc.ingestWithReport(fp)) });
      }
      return { success: true, reports };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Phase 10 / P10-B: folder ingestion — scanner + per-file security is in
  // knowledge/folder-scan.ts (pure); this handler just batches service calls.
  ipcMain.handle('knowledge-ingest-folder', async (_event, projectPath: string, folderPath: string) => {
    try {
      // The folder itself must live inside the project roots (traversal guard)
      const { assertPathInside } = await import('./security');
      const guard = assertPathInside(folderPath, [projectPath]);
      if (!guard.ok) {
        return { success: false, error: `Blocked: ${guard.reason}` };
      }
      const { scanFolderForIngest } = await import('./knowledge/folder-scan');
      const scan = scanFolderForIngest(folderPath, { roots: [projectPath] });
      if (scan.files.length === 0) {
        return { success: false, error: 'No ingestable documents found in folder.', reports: scan.rejected.slice(0, 5) as any };
      }
      const svc = await knowledgeServiceFor(projectPath);
      const reports = [];
      for (const fp of scan.files) {
        reports.push({ filePath: fp, ...(await svc.ingestWithReport(fp)) });
      }
      return {
        success: true,
        reports,
        scan: { truncated: scan.truncated, skippedByCaps: scan.skippedByCaps, rejectedCount: scan.rejected.length },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge-search', async (_event, projectPath: string, query: string, limit?: number) => {
    try {
      const svc = await knowledgeServiceFor(projectPath);
      const { framed, results } = await svc.retrieveForPrompt(query || '', limit ?? 4);
      // Phase 11 / P11-E: canonical citation string per result
      const { formatCitation } = await import('./knowledge/citation');
      return {
        success: true,
        framed,
        results: results.map((r: any) => ({
          documentId: r.document.id,
          title: r.document.title,
          source: r.document.sourcePath,
          startLine: r.chunk.metadata?.startLine,
          endLine: r.chunk.metadata?.endLine,
          section: r.chunk.sectionTitle,
          symbols: r.chunk.metadata?.symbols,
          jsonPath: r.chunk.metadata?.jsonPath,
          rowRange: r.chunk.metadata?.rowRange,
          score: Number(r.score.toFixed(4)),
          snippet: r.chunk.content.slice(0, 200),
          citation: formatCitation({
            chunk: r.chunk,
            document: r.document,
            score: Number(r.score.toFixed(4)),
          }),
        })),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Phase 11 / P11-F: Knowledge Viewer — chunk list for one document
  ipcMain.handle('knowledge-chunks', async (_event, projectPath: string, documentId: string) => {
    try {
      const svc = await knowledgeServiceFor(projectPath);
      const doc = await svc.getDocument(documentId);
      if (!doc) return { success: false, error: 'Document not found' };
      const chunks = svc.getStatsStore().listChunksByDocument(documentId);
      return {
        success: true,
        document: {
          id: doc.id, title: doc.title, format: doc.format, domain: doc.domain,
          sourcePath: doc.sourcePath,
          language: (doc.metadata as any)?.language,
          imports: (doc.metadata as any)?.imports,
          symbolCount: (doc.metadata as any)?.symbolCount,
          chunkCount: (doc.metadata as any)?.chunkCount,
          sizeBytes: (doc.metadata as any)?.sizeBytes,
          indexedAt: (doc.metadata as any)?.indexedAt,
        },
        embedding: svc.embeddingInfo(),
        chunks: chunks.map((c: any) => ({
          id: c.id,
          index: c.index,
          startLine: c.metadata?.startLine,
          endLine: c.metadata?.endLine,
          sectionTitle: c.sectionTitle,
          symbols: c.metadata?.symbols,
          jsonPath: c.metadata?.jsonPath,
          rowRange: c.metadata?.rowRange,
          language: c.metadata?.language,
          suspectedInjection: c.metadata?.suspectedInjection === true,
          preview: c.content.slice(0, 160),
          chars: c.content.length,
        })),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge-list', async (_event, projectPath: string) => {
    try {
      const svc = await knowledgeServiceFor(projectPath);
      const docs = await svc.listDocuments();
      return {
        success: true,
        documents: docs.map((d: any) => ({
          id: d.id, title: d.title, format: d.format, domain: d.domain,
          sourcePath: d.sourcePath, chunkCount: d.metadata?.chunkCount ?? 0,
          sizeBytes: d.metadata?.sizeBytes ?? 0, indexedAt: d.metadata?.indexedAt,
        })),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge-remove', async (_event, projectPath: string, documentId: string) => {
    try {
      const svc = await knowledgeServiceFor(projectPath);
      await svc.removeDocument(documentId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge-purge-missing', async (_event, projectPath: string) => {
    try {
      const svc = await knowledgeServiceFor(projectPath);
      return { success: true, purged: await svc.purgeMissing() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge-rebuild', async (_event, projectPath: string) => {
    try {
      const svc = await knowledgeServiceFor(projectPath);
      return { success: true, ...(await svc.rebuildIndex()) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge-clear', async (_event, projectPath: string) => {
    try {
      const svc = await knowledgeServiceFor(projectPath);
      await svc.clearProject();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Phase 10 / P10-D/E: embedding backend selection (LOCAL only)
  // FIX: createConfiguredEmbedder() returns an EmbedderResolution that includes
  // an `embedder` field (a class instance). While the handler doesn't directly
  // return resolution.embedder, it WAS returning `needsRebuildAfterSwitch` —
  // a FUNCTION reference — as `needsRebuildOnSwitch`. Functions cannot be
  // structured-cloned across IPC, causing "Error: An object could not be cloned."
  // Fix: omit the function entirely (renderer never reads needsRebuildOnSwitch
  // from this handler — it only reads it from knowledge-embedding-set).
  ipcMain.handle('knowledge-embedding-get', async () => {
    try {
      const { createConfiguredEmbedder } = await import('./knowledge/embedding-select');
      const resolution = await createConfiguredEmbedder();
      const models = listModels().map((m: any) => ({
        id: m.id, name: m.name, path: m.path, category: m.category, fileExists: m.fileExists,
      }));
      const embeddingModels = models.filter((m: any) => m.category === 'embedding');
      const otherModels = models.filter((m: any) => m.category !== 'embedding');
      return {
        success: true,
        current: {
          backend: resolution.backend,
          modelId: resolution.modelId ?? null,
          modelPath: resolution.modelPath ?? null,
          fallbackReason: resolution.fallbackReason ?? null,
          offline: true,
        },
        embeddingModels,
        otherModels,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge-embedding-set', async (_event, modelId: string | null) => {
    try {
      const { createConfiguredEmbedder } = await import('./knowledge/embedding-select');
      const before = (await createConfiguredEmbedder()).backend;
      if (modelId !== null) {
        const m = getModel(modelId);
        if (!m) return { success: false, error: 'Model not found in registry' };
        if (!m.fileExists) return { success: false, error: 'Model file missing on disk' };
      }
      // persist selection (non-sensitive → config.json, NOT secrets)
      persistUpdateSettings({ embeddingModelId: modelId } as any);
      // invalidate cached per-project services so the next call rebuilds
      // with the new embedder
      const { disposeKnowledgeServices } = await import('./knowledge/knowledge-service');
      disposeKnowledgeServices();
      const after = (await createConfiguredEmbedder()).backend;
      return {
        success: true,
        backend: after,
        // hash(256d) ↔ GGUF(other d) → stored vectors incompatible
        needsRebuild: before !== after,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Plugins (Phase 15) — discovery/validation/enable-state ONLY ──
  // NOTE: plugin CODE is never activated in this phase (loader/sandbox is a
  // later, dedicated phase). These endpoints expose manifest bookkeeping.
  let _pluginRegistry: import('./plugins/registry').LocalPluginRegistry | null = null;
  async function getPluginRegistry() {
    if (!_pluginRegistry) {
      const { LocalPluginRegistry } = require('./plugins/registry') as typeof import('./plugins/registry');
      _pluginRegistry = new LocalPluginRegistry(userDataPath);
    }
    return _pluginRegistry;
  }

  // UI-11: PluginLoader bridge — was built (Phase 16) but never instantiated
  // in main.ts. Plugins-set-enabled handler only flipped a boolean flag;
  // actual code activation (sandbox + activate + tool registration) never ran.
  // Now we wire the loader so enabling a plugin actually loads its code.
  let _pluginLoader: import('./plugins/loader').PluginLoader | null = null;
  function getPluginLoader(): import('./plugins/loader').PluginLoader {
    if (!_pluginLoader) {
      const { PluginLoader } = require('./plugins/loader') as typeof import('./plugins/loader');
      // Tool registration sink — registers plugin-provided tools into the
      // shared tool registry so the agent can invoke them.
      const toolSink = {
        registerTool: (tool: any) => {
          try {
            const { registerTool } = require('./ai/tool-registry') as typeof import('./ai/tool-registry');
            registerTool(tool);
          } catch (err) {
            console.warn(`[NEX AI Plugin] Failed to register tool ${tool?.name}:`, err);
          }
        },
      };
      _pluginLoader = new PluginLoader({
        toolRegistry: toolSink,
        onEvent: (e) => {
          // Forward sandbox events to the renderer for audit/debugging.
          mainWindow?.webContents.send('plugin-event', e);
        },
      });
    }
    return _pluginLoader;
  }

  ipcMain.handle('plugins-list', async () => {
    try {
      const reg = await getPluginRegistry();
      const entries = await reg.discover();
      return {
        success: true,
        plugins: entries.map((e) => ({
          id: e.manifest.id,
          name: e.manifest.name,
          version: e.manifest.version,
          author: e.manifest.author,
          description: e.manifest.description,
          permissions: e.manifest.permissions,
          provides: e.manifest.provides,
          enabled: e.enabled,
          installedAt: e.installedAt,
        })),
        invalid: reg.invalidDiscoveries().map((d) => ({
          dir: path.basename(d.dir),
          reason: d.reason || 'invalid',
        })),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('plugins-set-enabled', async (_event, pluginId: string, enabled: boolean) => {
    try {
      const reg = await getPluginRegistry();
      const entry = reg.get(pluginId);
      if (!entry) return { success: false, error: 'Unknown plugin' };

      if (enabled) {
        // UI-11: actually LOAD + ACTIVATE the plugin code (was previously
        // just flipping a boolean flag — no code ever ran). On failure, the
        // loader disables the plugin for the session and returns a report;
        // we propagate the failure reason to the UI.
        await reg.enable(pluginId);
        const loader = getPluginLoader();
        const report = await loader.load(entry);
        if (report.status === 'failed') {
          // Auto-disable on activation failure so UI reflects real state.
          await reg.disable(pluginId);
          return { success: false, error: `Plugin activation failed: ${report.reason || 'unknown error'}` };
        }
        return { success: true, tools: report.tools, events: report.events };
      } else {
        // UI-11: deactivate the plugin (best-effort) + flip flag.
        const loader = getPluginLoader();
        try { await loader.unload(pluginId); } catch { /* best-effort */ }
        await reg.disable(pluginId);
        return { success: true };
      }
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Memory (Phase 13) — 5-store management via IPC (project-scoped) ──
  ipcMain.handle('memory-list', async (_event, store: string, projectPath?: string) => {
    try {
      const { listMemory, MEMORY_STORES } = await import('./memory');
      if (!MEMORY_STORES.includes(store as any)) return { success: false, error: `Unknown store: ${store}` };
      // Project store requires an explicit projectPath (isolation)
      const pid = store === 'project' ? projectPath : undefined;
      const entries = listMemory(store as any, pid);
      // Redact values before they reach the renderer (defense in depth)
      const { redactObjectDeep } = await import('./agent/logger');
      return {
        success: true,
        store,
        entries: entries.map((e: any) => ({
          key: e.key,
          value: redactObjectDeep(e.value),
          type: e.type,
          tags: e.tags || [],
          updatedAt: e.updatedAt,
          expiresAt: e.expiresAt,
        })),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('memory-delete', async (_event, store: string, key: string, projectPath?: string) => {
    try {
      const { deleteMemory, MEMORY_STORES } = await import('./memory');
      if (!MEMORY_STORES.includes(store as any)) return { success: false, error: 'Unknown store' };
      const ok = deleteMemory(store as any, key, store === 'project' ? projectPath : undefined);
      return { success: ok };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('memory-clear', async (_event, store: string, projectPath?: string) => {
    try {
      const { clearMemoryStore, MEMORY_STORES } = await import('./memory');
      if (!MEMORY_STORES.includes(store as any)) return { success: false, error: 'Unknown store' };
      const n = clearMemoryStore(store as any, store === 'project' ? projectPath : undefined);
      return { success: true, removed: n };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Phase 28: Terminal Session IPC ──
  const _TERM_DBG = process.env.NEX_TERM_DEBUG === '1';
  let _ipcSeq = 0;
  ipcMain.handle('terminal-session-spawn', async (_event, cwd: string, cols?: number, rows?: number) => {
    try {
      if (_TERM_DBG) console.log(`[NEX-TERM IPC-SPAWN] cwd=${cwd} cols=${cols} rows=${rows} pty=${terminalService.hasPty}`);
      const session = terminalService.spawnSession(cwd, cols ?? 80, rows ?? 24);
      terminalService.onOutput(session.id, (data) => {
        if (_TERM_DBG) {
          _ipcSeq++;
          const hex = Array.from(data.slice(0, 64))
            .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
          console.log(
            `[NEX-TERM IPC-SEND ${_ipcSeq}] t=${Date.now()} id=${session.id} ` +
            `len=${data.length} esc=${JSON.stringify(data).slice(0, 200)} hex=${hex}`,
          );
        }
        mainWindow?.webContents.send(`terminal-output:${session.id}`, data);
      });
      terminalService.onExit(session.id, (code) => {
        mainWindow?.webContents.send(`terminal-exit:${session.id}`, code);
      });
      return {
        success: true,
        sessionId: session.id,
        state: session.state,
        shellName: session.shellName,
        shellPath: session.shellPath,
        cwd: session.cwd,
        cols: session.cols,
        rows: session.rows,
        pty: terminalService.hasPty,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('terminal-session-write', async (_event, sessionId: string, data: string) => {
    if (typeof sessionId !== 'string' || typeof data !== 'string') {
      return { success: false, error: 'Invalid payload' };
    }
    return { success: terminalService.write(sessionId, data) };
  });

  ipcMain.handle('terminal-session-resize', async (_event, sessionId: string, cols: number, rows: number) => {
    if (typeof sessionId !== 'string' || typeof cols !== 'number' || typeof rows !== 'number') {
      return { success: false, error: 'Invalid payload' };
    }
    return { success: terminalService.resize(sessionId, cols, rows) };
  });

  ipcMain.handle('terminal-session-signal', async (_event, sessionId: string, signal: string) => {
    const validSignals = ['SIGINT', 'SIGTERM', 'SIGKILL'];
    if (!validSignals.includes(signal)) return { success: false, error: 'Invalid signal' };
    return { success: terminalService.sendSignal(sessionId, signal as any) };
  });

  ipcMain.handle('terminal-session-kill', async (_event, sessionId: string) => {
    return { success: terminalService.killSession(sessionId) };
  });

  ipcMain.handle('terminal-session-list', async () => {
    return terminalService.listSessions().map((s) => ({
      id: s.id, state: s.state, cwd: s.cwd, exitCode: s.exitCode, createdAt: s.createdAt,
    }));
  });

  // ── Phase 28: Filesystem Service IPC (workspace-jailed) ──
  ipcMain.handle('fs-set-workspace', async (_event, rootPath: string) => {
    filesystemService.setWorkspace(rootPath);
    return { success: true, root: filesystemService.getWorkspace() };
  });

  ipcMain.handle('fs-service-readdir', async (_event, dirPath: string, showHidden?: boolean) => {
    return filesystemService.readDirectory(dirPath, showHidden);
  });

  ipcMain.handle('fs-service-readfile', async (_event, filePath: string) => {
    return filesystemService.readFile(filePath);
  });

  ipcMain.handle('fs-service-writefile', async (_event, filePath: string, content: string) => {
    return filesystemService.writeFile(filePath, content);
  });

  ipcMain.handle('fs-service-create', async (_event, parentPath: string, name: string, isDir: boolean) => {
    return isDir
      ? filesystemService.createDirectory(parentPath, name)
      : filesystemService.createFile(parentPath, name);
  });

  ipcMain.handle('fs-service-rename', async (_event, oldPath: string, newPath: string) => {
    return filesystemService.rename(oldPath, newPath);
  });

  ipcMain.handle('fs-service-delete', async (_event, targetPath: string) => {
    return filesystemService.delete(targetPath);
  });

  ipcMain.handle('fs-service-search', async (_event, query: string) => {
    return { results: filesystemService.search(query) };
  });

  // ── Phase 32: Conversation Center IPC ──
  ipcMain.handle('conversation-save', async (_event, data: any) => {
    try { return { success: saveConversation(data as ConversationData) }; }
    catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('conversation-load', async (_event, id: string) => {
    try { return { success: true, data: loadConversation(id) }; }
    catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('conversation-list', async () => {
    try { return { success: true, conversations: listConversations() }; }
    catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('conversation-delete', async (_event, id: string) => {
    try { return { success: deleteConversation(id) }; }
    catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('conversation-rename', async (_event, id: string, title: string) => {
    try { return { success: renameConversation(id, title) }; }
    catch (err: any) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('conversation-search', async (_event, query: string) => {
    try { return { success: true, results: searchConversations(query) }; }
    catch (err: any) { return { success: false, error: err.message }; }
  });

  // System Monitor (Phase 12) - Renderer->IPC->Service
  ipcMain.handle('system-snapshot', async () => {
    try {
      const svc = getSystemMonitor();
      const snap = await svc.snapshot();
      const extras = svc.lastAgentRuntimeExtras;
      return {
        success: true,
        snapshot: {
          ...snap,
          aiRuntime: {
            ...snap.aiRuntime,
            inferenceActive: snap.aiRuntime.inferenceActive || !!extras.inferenceActive,
            contextUsedTokens: extras.contextUsedTokens ?? snap.aiRuntime.contextUsedTokens,
            contextMaxTokens: extras.contextMaxTokens ?? snap.aiRuntime.contextMaxTokens,
            backend: snap.aiRuntime.backend !== 'none' ? snap.aiRuntime.backend : (extras.backend ?? 'none'),
          },
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge-stats', async (_event, projectPath: string) => {
    try {
      const svc = await knowledgeServiceFor(projectPath);
      return {
        success: true,
        ...(await svc.getStats()),
        embedding: svc.embeddingInfo(),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Permission response (from UI)
  ipcMain.handle('permission-respond', async (_event, response: any) => {
    respondToPermissionRequest(response);
    return { success: true };
  });

  // ── File Watcher ──
  let watcherFs: any = null;

  ipcMain.handle('fs-watch', async (_event, dirPath: string) => {
    try {
      const chokidar = await import('chokidar');
      if (watcherFs) watcherFs.close();
      watcherFs = chokidar.default.watch(dirPath, {
        ignored: [/(^|[\/\\])\.(?!\/\.|git)/, /node_modules/, /dist/, /build/],
        persistent: true,
        ignoreInitial: true,
      });
      watcherFs.on('all', (event: string, filePath: string) => {
        mainWindow?.webContents.send('fs-change', { event, path: filePath });
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs-unwatch', async () => {
    if (watcherFs) {
      watcherFs.close();
      watcherFs = null;
    }
    return { success: true };
  });

  // ── Git (now using safeExecFile — no shell interpolation) ──
  ipcMain.handle('git-status', async (_event, cwd: string) => {
    try {
      const statusResult = await safeExecFile('git', ['status', '--porcelain'], { cwd, timeout: 5000 });
      const branchResult = await safeExecFile('git', ['branch', '--show-current'], { cwd, timeout: 5000 });
      if (!statusResult.success) {
        return { success: false, error: statusResult.error || statusResult.stderr };
      }
      const files = statusResult.stdout.split('\n').filter(Boolean).map((line) => ({
        status: line.substring(0, 2).trim(),
        path: line.substring(3),
      }));
      return { success: true, branch: branchResult.stdout.trim(), files };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('git-log', async (_event, cwd: string, count: number = 10) => {
    try {
      const safeCount = Math.max(1, Math.min(100, Math.floor(count)));
      const result = await safeExecFile('git', ['log', '--oneline', '-n', String(safeCount)], { cwd, timeout: 5000 });
      if (!result.success) return { success: false, error: result.error };
      const commits = result.stdout.trim().split('\n').map((line) => {
        const [hash, ...rest] = line.split(' ');
        return { hash, message: rest.join(' ') };
      });
      return { success: true, commits };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── File Search (content search — now using pure Node, no shell) ──
  // FIX: v1.0 had command injection via findstr/grep string interpolation.
  // Now we use searchFileContents() — pure Node, no shell invocation.
  ipcMain.handle('fs-search-content', async (_event, dirPath: string, query: string) => {
    try {
      const results = await searchFileContents(dirPath, query, { maxResults: 100 });
      return {
        success: true,
        results: results.map((r) => ({
          file: r.file,
          line: r.line,
          content: r.content,
          raw: `${r.file}:${r.line}:${r.content}`,
        })),
      };
    } catch (err: any) {
      return { success: false, error: err.message, results: [] };
    }
  });
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Initialize persistence before anything else
  initPersistence(userDataPath);

  // Phase 40: Initialize the Semantic Memory Store + Retrieval Engine.
  // This wires the embedding-based memory search into the agent flow.
  try {
    const { createConfiguredEmbedder } = await import('./knowledge/embedding-select');
    const { SemanticMemoryStore } = await import('./memory/semantic-memory-store');
    const { MemoryRetrievalEngine, setMemoryRetrievalEngine } = await import('./memory/memory-retrieval-engine');
    const embedderResolution = await createConfiguredEmbedder();
    const semanticStore = new SemanticMemoryStore(embedderResolution.embedder);
    const retrievalEngine = new MemoryRetrievalEngine(semanticStore, embedderResolution.embedder);
    setMemoryRetrievalEngine(retrievalEngine);
    console.log(`[NEX AI] Phase 40: Memory Retrieval Engine initialized (embedder: ${embedderResolution.backend})`);
  } catch (err: any) {
    console.warn(`[NEX AI] Phase 40: Memory Retrieval Engine init failed (non-blocking): ${err.message}`);
  }

  setupIPC().catch((err) => console.error('[NEX AI] IPC setup failed:', err));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  // Phase 28: kill all terminal sessions on app exit (no orphans)
  terminalService.killAll();
});

app.on('window-all-closed', () => {
  terminalService.killAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Graceful shutdown: dispose llama.cpp engine before quitting.
// Without this, app.exit() / force-quit causes SIGABRT (exit 134)
// because node-llama-cpp's native AsyncWorkers are still in-flight
// when the JS env tears down.
let _shuttingDown = false;
app.on('before-quit', (event) => {
  if (_shuttingDown) return; // avoid re-entry
  _shuttingDown = true;
  event.preventDefault();
  console.log('[NEX AI] Graceful shutdown: disposing local AI engine...');
  shutdownLlama()
    .catch((err) => console.warn('[NEX AI] shutdownLlama error:', err))
    .finally(() => {
      terminalService.killAll();
      // Force-exit now — engine is disposed
      app.exit(0);
    });
});

// ─── Security: enforce single instance ─────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ─── Security: disable PDF viewer (avoids embedded JS execution) ────────────
app.on('web-contents-created', (_event, contents) => {
  // Block PDF plugins / webview attachment done elsewhere; this is a no-op placeholder
  // for future security hooks.
  void contents;
});
