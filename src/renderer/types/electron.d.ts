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

  // Exec
  runTscCheck: (cwd: string) => Promise<{ success: boolean; output?: string; error?: string; exitCode?: number | null }>;

  // System
  systemInfo: () => Promise<NexSystemInfo>;

  // Config (legacy)
  configGet: (key: string) => Promise<any>;
  configSet: (key: string, value: any) => Promise<{ success: boolean; error?: string }>;
  configGetAll: () => Promise<Record<string, any>>;

  // Settings (Phase 2)
  settingsLoad: () => Promise<{ settings: any; apiKey: string; glmApiKey?: string }>;
  settingsSave: (settings: any, apiKey?: string, glmApiKey?: string) => Promise<{ success: boolean; error?: string }>;
  settingsSetApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  settingsGetApiKey: () => Promise<string>;
  settingsDeleteApiKey: () => Promise<{ success: boolean }>;
  persistenceInfo: () => Promise<{ userDataPath: string; portable: boolean; secretsAvailable: boolean }>;

  // AI Chat
  aiChat: (config: any, messages: any[]) => Promise<{ success: boolean; content?: string; error?: string; tokens?: number; durationMs?: number; modelId?: string; modelName?: string }>;
  aiChatStream: (config: any, messages: any[]) => Promise<{ success: boolean; replyId?: string; content?: string; error?: string; tokens?: number; durationMs?: number; modelId?: string; modelName?: string }>;
  aiChatStreamCancel: () => Promise<{ success: boolean }>;
  onChatToken: (callback: (ev: { replyId: string; text: string; chars: number; done: boolean; phase?: string }) => void) => () => void;
  aiAbort: () => Promise<{ success: boolean }>;
  aiDefaultConfig: (provider: string) => Promise<any>;

  // Local Model Management (Phase 3-4)
  modelList: () => Promise<Array<{
    id: string; name: string; path: string; sizeBytes: number;
    contextSize: number; gpuLayers: number;
    category: 'general' | 'coding' | 'reasoning' | 'fast';
    addedAt: number; lastUsedAt?: number; fileExists: boolean;
  }>>;
  modelAdd: (filePath: string, opts?: { name?: string; contextSize?: number; gpuLayers?: number; category?: string }) =>
    Promise<{ success: boolean; model?: any; error?: string }>;
  modelRemove: (id: string) => Promise<{ success: boolean }>;
  modelUpdate: (id: string, patch: any) => Promise<{ success: boolean; model?: any }>;
  modelGet: (id: string) => Promise<any>;
  modelPickFile: () => Promise<{ canceled?: boolean; path?: string }>;

  // Agent Core (Phase 7)
  agentCreateTask: (request: any) => Promise<{ success: boolean; taskId?: string; error?: string }>;
  agentCancelTask: (taskId: string, reason?: string) => Promise<{ success: boolean }>;
  agentGetTask: (taskId: string) => Promise<any>;
  agentListTasks: () => Promise<any[]>;
  agentDeleteTask: (taskId: string) => Promise<{ success: boolean }>;
  agentListTools: () => Promise<any[]>;
  agentGetToolSchemas: () => Promise<any[]>;
  agentAcceptDiff: (taskId: string, changeId: string) => Promise<{ success: boolean; error?: string }>;
  agentRejectDiff: (taskId: string, changeId: string, reason?: string) => Promise<{ success: boolean }>;
  agentAcceptAllDiffs: (taskId: string) => Promise<{ success: boolean; error?: string }>;
  agentRejectAllDiffs: (taskId: string, reason?: string) => Promise<{ success: boolean }>;
  agentListPendingDiffs: (taskId: string) => Promise<any[]>;
  // ── Knowledge / Local RAG (Phase 9 services / Phase 10 bridge) ──
  knowledgeStats: (projectPath: string) => Promise<{ success: boolean; error?: string; documents?: number; chunks?: number; domains?: Record<string, number>; embedding?: { backend: 'hash' | 'llamacpp' | 'custom'; dimension?: number; offline: boolean; modelPath?: string } }>;
  // System Monitor (Phase 12)
  systemSnapshot: () => Promise<{ success: boolean; error?: string; snapshot?: import('./electron').SystemMonitorSnapshot }>;
  // Phase 32: Conversation Center
  conversationSave: (data: any) => Promise<{ success: boolean; error?: string }>;
  conversationLoad: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  conversationList: () => Promise<{ success: boolean; conversations?: Array<{ id: string; title: string; createdAt: number; updatedAt: number; messageCount: number; workspace?: string; provider?: string; model?: string; mode?: string }>; error?: string }>;
  conversationDelete: (id: string) => Promise<{ success: boolean; error?: string }>;
  conversationRename: (id: string, title: string) => Promise<{ success: boolean; error?: string }>;
  conversationSearch: (query: string) => Promise<{ success: boolean; results?: Array<{ id: string; title: string; createdAt: number; updatedAt: number; messageCount: number }>; error?: string }>;

  // ── Phase 28: Terminal Sessions (PTY-backed) ──
  terminalSessionSpawn: (cwd: string, cols?: number, rows?: number) => Promise<{
    success: boolean; sessionId?: string; state?: string; error?: string;
    shellName?: string; shellPath?: string; cwd?: string;
    cols?: number; rows?: number; pty?: boolean;
  }>;
  terminalSessionWrite: (sessionId: string, data: string) => Promise<{ success: boolean }>;
  terminalSessionResize: (sessionId: string, cols: number, rows: number) => Promise<{ success: boolean }>;
  terminalSessionSignal: (sessionId: string, signal: string) => Promise<{ success: boolean }>;
  terminalSessionKill: (sessionId: string) => Promise<{ success: boolean }>;
  terminalSessionList: () => Promise<Array<{ id: string; state: string; cwd: string; exitCode: number | null; createdAt: number }>>;
  onTerminalSessionOutput: (sessionId: string, callback: (data: string) => void) => () => void;
  onTerminalSessionExit: (sessionId: string, callback: (code: number | null) => void) => () => void;
  // ── Phase 28: Filesystem Service ──
  fsSetWorkspace: (rootPath: string) => Promise<{ success: boolean; root?: string }>;
  fsServiceReaddir: (dirPath: string, showHidden?: boolean) => Promise<{ path: string; entries: Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean; size: number; extension: string; modifiedAt: number }>; error?: string }>;
  fsServiceReadfile: (filePath: string) => Promise<{ ok: boolean; content?: string; error?: string; size?: number }>;
  fsServiceWritefile: (filePath: string, content: string) => Promise<{ ok: boolean; error?: string }>;
  fsServiceCreate: (parentPath: string, name: string, isDir: boolean) => Promise<{ ok: boolean; path?: string; error?: string }>;
  fsServiceRename: (oldPath: string, newPath: string) => Promise<{ ok: boolean; error?: string }>;
  fsServiceDelete: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
  fsServiceSearch: (query: string) => Promise<{ results: Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean; size: number; extension: string; modifiedAt: number }> }>;
  // Memory (Phase 13)
  memoryList: (store: string, projectPath?: string) => Promise<{ success: boolean; error?: string; store?: string; entries?: Array<{ key: string; value: any; type: string; tags: string[]; updatedAt: number; expiresAt?: number }> }>;
  // Plugins (Phase 15)
  pluginsList: () => Promise<{ success: boolean; error?: string; plugins?: Array<{ id: string; name: string; version: string; author: string; description: string; permissions: Array<{ type: string; scope: string; reason: string }>; provides: { tools: string[]; knowledgeDomains: any[]; runtimes: any[]; uiExtensions: string[] }; enabled: boolean; installedAt: number }>; invalid?: Array<{ dir: string; reason: string }> }>;
  pluginsSetEnabled: (pluginId: string, enabled: boolean) => Promise<{ success: boolean; error?: string }> ;
  memoryDelete: (store: string, key: string, projectPath?: string) => Promise<{ success: boolean; error?: string }>;
  memoryClear: (store: string, projectPath?: string) => Promise<{ success: boolean; removed?: number; error?: string }>;
  knowledgeList: (projectPath: string) => Promise<{ success: boolean; error?: string; documents?: Array<{ id: string; title: string; format: string; domain?: string; sourcePath?: string; chunkCount: number; sizeBytes: number; indexedAt?: number }> }>;
  knowledgeSearch: (projectPath: string, query: string, limit?: number) => Promise<{ success: boolean; error?: string; framed?: string; results?: Array<{ documentId: string; title: string; source?: string; startLine?: number; endLine?: number; section?: string; symbols?: string[]; jsonPath?: string; rowRange?: string; score: number; snippet: string; citation?: string }> }>;
  knowledgeChunks: (projectPath: string, documentId: string) => Promise<{ success: boolean; error?: string; document?: { id: string; title: string; format: string; domain?: string; sourcePath?: string; language?: string; imports?: string[]; symbolCount?: number; chunkCount?: number; sizeBytes?: number; indexedAt?: number }; embedding?: { backend: string; dimension?: number; offline: boolean; modelPath?: string }; chunks?: Array<{ id: string; index: number; startLine?: number; endLine?: number; sectionTitle?: string; symbols?: string[]; jsonPath?: string; rowRange?: string; language?: string; suspectedInjection: boolean; preview: string; chars: number }> }>;
  knowledgeIngest: (projectPath: string, filePath: string) => Promise<{ success: boolean; report?: { status: string; reason?: string; chunkCount?: number }; error?: string }>;
  knowledgeIngestMany: (projectPath: string, filePaths: string[]) => Promise<{ success: boolean; reports?: Array<{ filePath: string; status: string; reason?: string; chunkCount?: number }>; error?: string }>;
  knowledgeIngestFolder: (projectPath: string, folderPath: string) => Promise<{ success: boolean; reports?: Array<any>; scan?: { truncated: boolean; skippedByCaps: number; rejectedCount: number }; error?: string }>;
  knowledgeRemove: (projectPath: string, documentId: string) => Promise<{ success: boolean; error?: string }>;
  knowledgePurgeMissing: (projectPath: string) => Promise<{ success: boolean; purged?: string[]; error?: string }>;
  knowledgeRebuild: (projectPath: string) => Promise<{ success: boolean; indexed?: number; skipped?: number; failed?: number; error?: string }>;
  knowledgeClear: (projectPath: string) => Promise<{ success: boolean; error?: string }>;
  knowledgeEmbeddingGet: () => Promise<{ success: boolean; error?: string; current?: { backend: 'hash' | 'llamacpp'; modelId: string | null; modelPath: string | null; fallbackReason: string | null; offline: boolean }; embeddingModels?: Array<{ id: string; name: string; path: string; category: string; fileExists: boolean }>; otherModels?: Array<{ id: string; name: string; path: string; category: string; fileExists: boolean }> }>;
  knowledgeEmbeddingSet: (modelId: string | null) => Promise<{ success: boolean; error?: string; backend?: string; needsRebuild?: boolean }>;
  dialogOpenFiles: () => Promise<{ canceled: boolean; paths?: string[] }>;
  dialogOpenFolder: () => Promise<{ canceled: boolean; path?: string }>;
  permissionRespond: (response: any) => Promise<{ success: boolean }>;
  onAgentEvent: (callback: (event: any) => void) => () => void;
  onPermissionRequest: (callback: (request: any) => void) => () => void;

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

/** Phase 12: System Monitor snapshot (mirror of main/system-monitor/types). */
export interface SystemMonitorSnapshot {
  timestamp: number;
  platform: string;
  cpu: { model: string; cores: number; threads: number; usagePercent?: number; perCore?: number[]; frequencyMHz?: number; temperatureC?: number };
  memory: { totalBytes: number; usedBytes: number; freeBytes: number; usagePercent: number };
  gpus: Array<{ name: string; vendor: string; utilizationPercent?: number; vramTotalBytes?: number; vramUsedBytes?: number; vramPercent?: number; temperatureC?: number; powerWatts?: number; driverVersion?: string; source: string }>;
  aiRuntime: { backend: 'local' | 'online' | 'none'; runtimeType: string; activeModelName?: string; modelLoaded: boolean; inferenceActive: boolean; lastTokensPerSecond?: number; lastPromptTokens?: number; lastGeneratedTokens?: number; lastInferenceDurationMs?: number; lastModelLoadMs?: number; contextUsedTokens?: number; contextMaxTokens?: number; gpuBackend?: string };
  agent: { currentTask?: string; currentStep?: string; stepProgress?: { current: number; total: number }; activeTool?: string; toolDurationMs?: number; queueState: 'idle' | 'running' | 'waiting-permission' | 'queued' | 'unknown'; cancelled: boolean };
  degradedSources: string[];
}
