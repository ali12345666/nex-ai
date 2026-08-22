export interface NexFileEntry {
  name: string;
  isDirectory: boolean;
  path: string;
}

export interface NexFileStat {
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  modified: string;
  created: string;
}

export interface NexSystemInfo {
  platform: string;
  arch: string;
  release: string;
  homedir: string;
  hostname: string;
  cpus: number;
  totalMemory: number;
  freeMemory: number;
}

export interface NexAPI {
  // Window
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
  windowIsMaximized: () => Promise<boolean>;

  // File System
  readFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  readDir: (dirPath: string) => Promise<{ success: boolean; files?: NexFileEntry[]; error?: string }>;
  mkdir: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
  deletePath: (targetPath: string) => Promise<{ success: boolean; error?: string }>;
  rename: (oldPath: string, newPath: string) => Promise<{ success: boolean; error?: string }>;
  stat: (targetPath: string) => Promise<{ success: boolean; stat?: NexFileStat; error?: string }>;
  search: (dirPath: string, pattern: string) => Promise<{ success: boolean; files?: string[]; error?: string }>;

  // Dialog
  openFolder: () => Promise<{ canceled?: boolean; path?: string }>;
  openFile: () => Promise<{ canceled?: boolean; path?: string }>;

  // Terminal
  terminalSpawn: (cwd: string) => void;
  terminalWrite: (data: string) => void;
  terminalResize: (cols: number, rows: number) => void;
  onTerminalOutput: (callback: (data: string) => void) => () => void;
  onTerminalExit: (callback: (code: number | null) => void) => () => void;

  // Exec
  execCommand: (command: string, cwd: string) => Promise<{ success: boolean; output?: string; error?: string }>;

  // System
  systemInfo: () => Promise<NexSystemInfo>;

  // Config (legacy)
  configGet: (key: string) => Promise<any>;
  configSet: (key: string, value: any) => Promise<{ success: boolean; error?: string }>;
  configGetAll: () => Promise<Record<string, any>>;

  // Settings (Phase 2)
  settingsLoad: () => Promise<{ settings: any; apiKey: string }>;
  settingsSave: (settings: any, apiKey?: string) => Promise<{ success: boolean; error?: string }>;
  settingsSetApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  settingsGetApiKey: () => Promise<string>;
  settingsDeleteApiKey: () => Promise<{ success: boolean }>;
  persistenceInfo: () => Promise<{ userDataPath: string; portable: boolean; secretsAvailable: boolean }>;

  // AI Chat
  aiChat: (config: any, messages: any[]) => Promise<{ success: boolean; content?: string; error?: string; tokens?: number }>;
  aiDefaultConfig: (provider: string) => Promise<any>;

  // File Watcher
  fsWatch: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
  fsUnwatch: () => Promise<{ success: boolean }>;
  onFsChange: (callback: (change: { event: string; path: string }) => void) => () => void;

  // Git
  gitStatus: (cwd: string) => Promise<{ success: boolean; branch?: string; files?: any[]; error?: string }>;
  gitLog: (cwd: string, count?: number) => Promise<{ success: boolean; commits?: any[]; error?: string }>;

  // Content Search
  fsSearchContent: (dirPath: string, query: string) => Promise<{ success: boolean; results?: any[]; error?: string }>;

  // External
  openExternal: (url: string) => Promise<void>;

  // Events
  onNewTerminal: (callback: () => void) => () => void;
  onKillTerminal: (callback: () => void) => () => void;
  onOpenSettings: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    nexAPI: NexAPI;
  }
}

export {};
