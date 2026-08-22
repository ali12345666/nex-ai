import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('nexAPI', {
  // ── Window Controls ──
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // ── File System ──
  readFile: (filePath: string) => ipcRenderer.invoke('fs-read-file', filePath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('fs-write-file', filePath, content),
  readDir: (dirPath: string) => ipcRenderer.invoke('fs-readdir', dirPath),
  mkdir: (dirPath: string) => ipcRenderer.invoke('fs-mkdir', dirPath),
  deletePath: (targetPath: string) => ipcRenderer.invoke('fs-delete', targetPath),
  rename: (oldPath: string, newPath: string) =>
    ipcRenderer.invoke('fs-rename', oldPath, newPath),
  stat: (targetPath: string) => ipcRenderer.invoke('fs-stat', targetPath),
  search: (dirPath: string, pattern: string) =>
    ipcRenderer.invoke('fs-search', dirPath, pattern),

  // ── Dialog ──
  openFolder: () => ipcRenderer.invoke('dialog-open-folder'),
  openFile: () => ipcRenderer.invoke('dialog-open-file'),

  // ── Terminal ──
  terminalSpawn: (cwd: string) => ipcRenderer.send('terminal-spawn', cwd),
  terminalWrite: (data: string) => ipcRenderer.send('terminal-write', data),
  terminalResize: (cols: number, rows: number) =>
    ipcRenderer.send('terminal-resize', cols, rows),
  onTerminalOutput: (callback: (data: string) => void) => {
    ipcRenderer.on('terminal-output', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('terminal-output');
  },
  onTerminalExit: (callback: (code: number | null) => void) => {
    ipcRenderer.on('terminal-exit', (_event, code) => callback(code));
    return () => ipcRenderer.removeAllListeners('terminal-exit');
  },

  // ── Command Execution ──
  execCommand: (command: string, cwd: string) =>
    ipcRenderer.invoke('exec-command', command, cwd),

  // ── System ──
  systemInfo: () => ipcRenderer.invoke('system-info'),

  // ── Config ──
  configGet: (key: string) => ipcRenderer.invoke('config-get', key),
  configSet: (key: string, value: any) => ipcRenderer.invoke('config-set', key, value),
  configGetAll: () => ipcRenderer.invoke('config-get-all'),

  // ── External ──
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // ── AI Chat ──
  aiChat: (config: any, messages: any[]) =>
    ipcRenderer.invoke('ai-chat', config, messages),
  aiDefaultConfig: (provider: string) =>
    ipcRenderer.invoke('ai-default-config', provider),

  // ── File Watcher ──
  fsWatch: (dirPath: string) => ipcRenderer.invoke('fs-watch', dirPath),
  fsUnwatch: () => ipcRenderer.invoke('fs-unwatch'),
  onFsChange: (callback: (change: { event: string; path: string }) => void) => {
    ipcRenderer.on('fs-change', (_event, change) => callback(change));
    return () => ipcRenderer.removeAllListeners('fs-change');
  },

  // ── Git ──
  gitStatus: (cwd: string) => ipcRenderer.invoke('git-status', cwd),
  gitLog: (cwd: string, count?: number) => ipcRenderer.invoke('git-log', cwd, count),

  // ── Content Search ──
  fsSearchContent: (dirPath: string, query: string) =>
    ipcRenderer.invoke('fs-search-content', dirPath, query),

  // ── Events ──
  onNewTerminal: (callback: () => void) => {
    ipcRenderer.on('new-terminal', callback);
    return () => ipcRenderer.removeAllListeners('new-terminal');
  },
  onKillTerminal: (callback: () => void) => {
    ipcRenderer.on('kill-terminal', callback);
    return () => ipcRenderer.removeAllListeners('kill-terminal');
  },
  onOpenSettings: (callback: () => void) => {
    ipcRenderer.on('open-settings', callback);
    return () => ipcRenderer.removeAllListeners('open-settings');
  },
});

export {};
