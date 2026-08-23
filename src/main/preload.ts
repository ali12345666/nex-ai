import { contextBridge, ipcRenderer } from 'electron';

/**
 * NEX AI Preload
 *
 * Security notes:
 *  - contextIsolation: true — renderer cannot access Node globals directly
 *  - Only the `nexAPI` object is exposed via contextBridge
 *  - The old `execCommand` channel was REMOVED (allowed arbitrary shell exec)
 *  - All IPC channels are explicitly listed here — no wildcard exposure
 */

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

  // ── System ──
  systemInfo: () => ipcRenderer.invoke('system-info'),

  // ── Config (legacy, kept for backwards-compat) ──
  configGet: (key: string) => ipcRenderer.invoke('config-get', key),
  configSet: (key: string, value: any) => ipcRenderer.invoke('config-set', key, value),
  configGetAll: () => ipcRenderer.invoke('config-get-all'),

  // ── Settings (Phase 2 — proper persistence with encrypted API keys) ──
  settingsLoad: () => ipcRenderer.invoke('settings-load'),
  settingsSave: (settings: any, apiKey?: string, glmApiKey?: string) =>
    ipcRenderer.invoke('settings-save', settings, apiKey, glmApiKey),
  settingsSetApiKey: (apiKey: string) =>
    ipcRenderer.invoke('settings-set-api-key', apiKey),
  settingsGetApiKey: () => ipcRenderer.invoke('settings-get-api-key'),
  settingsDeleteApiKey: () => ipcRenderer.invoke('settings-delete-api-key'),
  persistenceInfo: () => ipcRenderer.invoke('persistence-info'),

  // ── External (validated http/https only) ──
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // ── AI Chat ──
  aiChat: (config: any, messages: any[]) =>
    ipcRenderer.invoke('ai-chat', config, messages),
  aiAbort: () => ipcRenderer.invoke('ai-abort'),
  aiDefaultConfig: (provider: string) =>
    ipcRenderer.invoke('ai-default-config', provider),

  // ── Local Model Management (Phase 3-4) ──
  modelList: () => ipcRenderer.invoke('model-list'),
  modelAdd: (filePath: string, opts?: any) =>
    ipcRenderer.invoke('model-add', filePath, opts),
  modelRemove: (id: string) => ipcRenderer.invoke('model-remove', id),
  modelUpdate: (id: string, patch: any) => ipcRenderer.invoke('model-update', id, patch),
  modelGet: (id: string) => ipcRenderer.invoke('model-get', id),
  modelPickFile: () => ipcRenderer.invoke('model-pick-file'),

  // ── Agent Core (Phase 7) ──
  agentCreateTask: (request: any) => ipcRenderer.invoke('agent-create-task', request),
  agentCancelTask: (taskId: string, reason?: string) => ipcRenderer.invoke('agent-cancel-task', taskId, reason),
  agentGetTask: (taskId: string) => ipcRenderer.invoke('agent-get-task', taskId),
  agentListTasks: () => ipcRenderer.invoke('agent-list-tasks'),
  agentDeleteTask: (taskId: string) => ipcRenderer.invoke('agent-delete-task', taskId),
  agentListTools: () => ipcRenderer.invoke('agent-list-tools'),
  agentGetToolSchemas: () => ipcRenderer.invoke('agent-get-tool-schemas'),
  agentAcceptDiff: (taskId: string, changeId: string) => ipcRenderer.invoke('agent-accept-diff', taskId, changeId),
  agentRejectDiff: (taskId: string, changeId: string, reason?: string) => ipcRenderer.invoke('agent-reject-diff', taskId, changeId, reason),
  agentAcceptAllDiffs: (taskId: string) => ipcRenderer.invoke('agent-accept-all-diffs', taskId),
  agentRejectAllDiffs: (taskId: string, reason?: string) => ipcRenderer.invoke('agent-reject-all-diffs', taskId, reason),
  agentListPendingDiffs: (taskId: string) => ipcRenderer.invoke('agent-list-pending-diffs', taskId),
  permissionRespond: (response: any) => ipcRenderer.invoke('permission-respond', response),

  // ── Knowledge / Local RAG (Phase 9 services, Phase 10 UI bridge) ──
  // Renderer NEVER touches the filesystem directly for knowledge: every
  // operation flows through Main → KnowledgeService (project-isolated).
  knowledgeStats: (projectPath: string) => ipcRenderer.invoke('knowledge-stats', projectPath),
  knowledgeList: (projectPath: string) => ipcRenderer.invoke('knowledge-list', projectPath),
  knowledgeSearch: (projectPath: string, query: string, limit?: number) => ipcRenderer.invoke('knowledge-search', projectPath, query, limit),
  knowledgeIngest: (projectPath: string, filePath: string) => ipcRenderer.invoke('knowledge-ingest', projectPath, filePath),
  knowledgeIngestMany: (projectPath: string, filePaths: string[]) => ipcRenderer.invoke('knowledge-ingest-many', projectPath, filePaths),
  knowledgeIngestFolder: (projectPath: string, folderPath: string) => ipcRenderer.invoke('knowledge-ingest-folder', projectPath, folderPath),
  knowledgeRemove: (projectPath: string, documentId: string) => ipcRenderer.invoke('knowledge-remove', projectPath, documentId),
  knowledgePurgeMissing: (projectPath: string) => ipcRenderer.invoke('knowledge-purge-missing', projectPath),
  knowledgeRebuild: (projectPath: string) => ipcRenderer.invoke('knowledge-rebuild', projectPath),
  knowledgeClear: (projectPath: string) => ipcRenderer.invoke('knowledge-clear', projectPath),
  knowledgeEmbeddingGet: () => ipcRenderer.invoke('knowledge-embedding-get'),
  knowledgeEmbeddingSet: (modelId: string | null) => ipcRenderer.invoke('knowledge-embedding-set', modelId),
  dialogOpenFiles: () => ipcRenderer.invoke('dialog-open-files'),
  dialogOpenFolder: () => ipcRenderer.invoke('dialog-open-folder'),
  onAgentEvent: (callback: (event: any) => void) => {
    ipcRenderer.on('agent-event', (_event, ev) => callback(ev));
    return () => ipcRenderer.removeAllListeners('agent-event');
  },
  onPermissionRequest: (callback: (request: any) => void) => {
    ipcRenderer.on('permission-request', (_event, req) => callback(req));
    return () => ipcRenderer.removeAllListeners('permission-request');
  },

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

  // ── Content Search (now safe — pure Node, no shell) ──
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
