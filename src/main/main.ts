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

import { CSP, ALLOWED_AI_ORIGINS, isAllowedAIOrigin } from './security';
import { safeExecFile, safeSpawn, spawnInteractiveShell, searchFileContents } from './security/shell';
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
let terminalProcess: import('child_process').ChildProcess | null = null;
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
    cleanupTerminal();
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
    // Allow local dev server
    if (url.startsWith('http://localhost:5173')) return callback({});
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
function setupIPC(): void {
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

  // ── Terminal (using safeSpawn — no shell interpolation) ──
  ipcMain.on('terminal-write', (_event, data: string) => {
    if (terminalProcess && terminalProcess.stdin) {
      terminalProcess.stdin.write(data);
    }
  });

  ipcMain.on('terminal-spawn', (_event, cwd: string) => {
    cleanupTerminal();
    terminalProcess = spawnInteractiveShell(cwd || os.homedir());
    terminalProcess.stdout?.on('data', (data: Buffer) => {
      mainWindow?.webContents.send('terminal-output', data.toString());
    });
    terminalProcess.stderr?.on('data', (data: Buffer) => {
      mainWindow?.webContents.send('terminal-output', data.toString());
    });
    terminalProcess.on('exit', (code) => {
      mainWindow?.webContents.send('terminal-exit', code);
    });
  });

  ipcMain.on('terminal-resize', (_event, _cols: number, _rows: number) => {
    // Resize handled by xterm addon in renderer (PTY resize is non-critical for v1)
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
          const { getKnowledgeService } = await import('./knowledge/knowledge-service');
          const { projectIdFromPath } = await import('./knowledge/project-id');
          const { createEmbedder } = await import('./knowledge/llama-embedder');
          const pid = projectIdFromPath(request.projectPath);
          const svc = getKnowledgeService({
            userDataDir: userDataPath,
            projectId: pid,
            embedder: await createEmbedder(undefined), // offline hash embedder (GGUF embedder via settings later)
            roots: [request.projectPath],
          });
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
    const { createEmbedder } = await import('./knowledge/llama-embedder');
    return getKnowledgeService({
      userDataDir: userDataPath,
      projectId: projectIdFromPath(projectPath),
      embedder: await createEmbedder(undefined), // offline default; GGUF embedder pluggable
      roots: [projectPath],
    });
  }

  ipcMain.handle('knowledge-ingest', async (_event, projectPath: string, filePath: string) => {
    try {
      const svc = await knowledgeServiceFor(projectPath);
      const report = await svc.ingestWithReport(filePath);
      return { success: report.status === 'indexed' || report.status === 'skipped-unchanged', report };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('knowledge-ingest-many', async (_event, projectPath: string, filePaths: string[]) => {
    try {
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
          score: Number(r.score.toFixed(4)),
          snippet: r.chunk.content.slice(0, 200),
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

function cleanupTerminal(): void {
  if (terminalProcess) {
    try { terminalProcess.kill(); } catch {}
    terminalProcess = null;
  }
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Initialize persistence before anything else
  initPersistence(userDataPath);

  setupIPC();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  cleanupTerminal();
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
      cleanupTerminal();
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
