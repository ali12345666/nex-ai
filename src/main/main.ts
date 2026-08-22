import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  nativeTheme,
  protocol,
  session,
  webContents,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync, spawn, ChildProcess } from 'child_process';
import { glob } from 'glob';
import { chatCompletion, getSystemPrompt, getDefaultConfig, type AIConfig, type AIMessage } from './ai-service';

// ─── Security ───────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set(['https://api.nexai.app']);
const BLOCKED_PERMISSIONS = new Set([
  'media',
  'geolocation',
  'notifications',
  'midi',
  'pointer-lock',
  'fullscreen',
  'clipboard-read',
]);

let mainWindow: BrowserWindow | null = null;
let terminalProcess: ChildProcess | null = null;
const isDev = !app.isPackaged;

// ─── Portable Mode Detection ──────────────────────────────────────────────
// Portable: data stored next to the executable in a `data/` folder
// Installed: data stored in AppData (standard Electron behavior)
function isPortableMode(): boolean {
  if (isDev) return false;
  // In packaged app, exe is at: resources/app.asar or resources/app/
  // For portable, we look for a `portable.txt` marker next to the exe
  // OR we check if the exe is running from a non-standard location
  const exePath = process.execPath;
  const appDir = path.dirname(exePath);
  const markerPath = path.join(appDir, 'portable.txt');
  
  // Check for portable marker file
  if (fs.existsSync(markerPath)) return true;
  
  // Also detect if running from a temp directory (extracted portable)
  if (appDir.includes('Temp') || appDir.includes('tmp')) return true;
  
  return false;
}

function getUserDataPath(): string {
  if (isPortableMode()) {
    // Portable: store data next to the executable
    const exeDir = path.dirname(process.execPath);
    const dataDir = path.join(exeDir, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return dataDir;
  }
  // Installed: use standard AppData path
  return app.getPath('userData');
}

const isPortable = isPortableMode();
const userDataPath = getUserDataPath();

// ─── Window Creation ────────────────────────────────────────────────────────
function createWindow(): void {
  // Load saved window state
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
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // ── Load renderer ──
  if (isDev) {
    // Development: connect to Vite dev server
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      console.log('[NEX AI] Vite dev server not found. Make sure to run: npm run dev:renderer');
      // Fallback: load built files if they exist
      const fallbackPath = path.join(__dirname, '../renderer/index.html');
      if (fs.existsSync(fallbackPath)) {
        mainWindow?.loadFile(fallbackPath);
      }
    });
  } else {
    // Production: load built files from app resources
    // In packaged app, __dirname points into the asar archive
    // dist/main/main.js -> dist/renderer/index.html
    const rendererPath = path.join(__dirname, '../renderer/index.html');
    mainWindow.loadFile(rendererPath);
  }

  // Restore maximized state
  if (windowState.maximized) mainWindow.maximize();

  // Save window state on close
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

  // Block permissions
  sess.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (BLOCKED_PERMISSIONS.has(permission)) {
      callback(false);
    } else {
      callback(true);
    }
  });

  // CSP headers
  sess.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.openai.com https://api.anthropic.com https://api.nexai.app; img-src 'self' data: blob:; font-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com;",
        ],
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'X-XSS-Protection': ['1; mode=block'],
        'Referrer-Policy': ['strict-origin-when-cross-origin'],
      },
    });
  });

  // Block navigation to external URLs
  win.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.origin !== 'http://localhost:5173' && parsedUrl.origin !== 'file://') {
      event.preventDefault();
      shell.openExternal(url);
    }
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
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window-close', () => mainWindow?.close());
  ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);

  // ── File System ──
  ipcMain.handle('fs-read-file', async (_event, filePath: string) => {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return { success: true, content };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs-write-file', async (_event, filePath: string, content: string) => {
    try {
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

  ipcMain.handle('dialog-open-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Source Code', extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'cpp', 'c', 'h'] },
        { name: 'Web', extensions: ['html', 'css', 'scss', 'json', 'yaml', 'yml'] },
      ],
    });
    if (result.canceled) return { canceled: true };
    return { path: result.filePaths[0] };
  });

  // ── Terminal (PTY simulation with child_process) ──
  ipcMain.on('terminal-write', (_event, data: string) => {
    if (terminalProcess && terminalProcess.stdin) {
      terminalProcess.stdin.write(data);
    }
  });

  ipcMain.on('terminal-spawn', (_event, cwd: string) => {
    cleanupTerminal();
    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
    terminalProcess = spawn(shell, [], {
      cwd: cwd || os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

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

  ipcMain.on('terminal-resize', (_event, cols: number, rows: number) => {
    // Resize handled by xterm addon in renderer
  });

  // ── Code Execution ──
  ipcMain.handle('exec-command', async (_event, command: string, cwd: string) => {
    return new Promise((resolve) => {
      try {
        const result = execSync(command, {
          cwd: cwd || os.homedir(),
          encoding: 'utf-8',
          timeout: 30000,
          maxBuffer: 1024 * 1024 * 10,
        });
        resolve({ success: true, output: result });
      } catch (err: any) {
        resolve({
          success: false,
          output: err.stdout || '',
          error: err.stderr || err.message,
        });
      }
    });
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
  }));

  // ── Config Store (simple JSON-based) ──
  const configPath = path.join(app.getPath('userData'), 'config.json');

  ipcMain.handle('config-get', async (_event, key: string) => {
    try {
      const data = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
      return data[key];
    } catch {
      return undefined;
    }
  });

  ipcMain.handle('config-set', async (_event, key: string, value: any) => {
    try {
      let data: Record<string, any> = {};
      try {
        data = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
      } catch {}
      data[key] = value;
      await fs.promises.writeFile(configPath, JSON.stringify(data, null, 2));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('config-get-all', async () => {
    try {
      return JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
    } catch {
      return {};
    }
  });

  // ── Open external link ──
  ipcMain.handle('open-external', async (_event, url: string) => {
    await shell.openExternal(url);
  });

  // ── AI Chat ──
  ipcMain.handle('ai-chat', async (_event, config: AIConfig, messages: AIMessage[]) => {
    // Prepend system prompt
    const fullMessages: AIMessage[] = [
      { role: 'system', content: getSystemPrompt() },
      ...messages,
    ];
    return chatCompletion(config, fullMessages);
  });

  ipcMain.handle('ai-default-config', (_event, provider: string) => {
    return getDefaultConfig(provider);
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

  // ── Git ──
  ipcMain.handle('git-status', async (_event, cwd: string) => {
    try {
      const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8', timeout: 5000 });
      const branch = execSync('git branch --show-current', { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
      const files = status.split('\n').filter(Boolean).map((line) => ({
        status: line.substring(0, 2).trim(),
        path: line.substring(3),
      }));
      return { success: true, branch, files };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('git-log', async (_event, cwd: string, count: number = 10) => {
    try {
      const log = execSync(`git log --oneline -n ${count}`, { cwd, encoding: 'utf-8', timeout: 5000 });
      const commits = log.trim().split('\n').map((line) => {
        const [hash, ...rest] = line.split(' ');
        return { hash, message: rest.join(' ') };
      });
      return { success: true, commits };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── File Search (content search) ──
  ipcMain.handle('fs-search-content', async (_event, dirPath: string, query: string) => {
    try {
      const { execSync } = require('child_process');
      // Use ripgrep-like search via findstr on Windows
      const cmd = process.platform === 'win32'
        ? `findstr /s /n /i "${query}" "${dirPath}\*.*" 2>nul`
        : `grep -rn "${query}" "${dirPath}" --include="*.*" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist 2>/dev/null`;
      const result = execSync(cmd, { encoding: 'utf-8', timeout: 10000, maxBuffer: 1024*1024*5 });
      const results = result.split('\n').filter(Boolean).slice(0, 100).map((line: string) => ({ raw: line }));
      return { success: true, results };
    } catch (err: any) {
      return { success: false, error: err.message, results: [] };
    }
  });
}

function cleanupTerminal(): void {
  if (terminalProcess) {
    terminalProcess.kill();
    terminalProcess = null;
  }
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
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

app.on('before-quit', () => {
  cleanupTerminal();
});
