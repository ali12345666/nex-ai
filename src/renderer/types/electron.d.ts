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

  // Phase 39: Professional Model Manager
  modelComputeHash: (modelId: string) => Promise<{ success: boolean; hash?: string; algorithm?: string; error?: string }>;
  modelVerifyIntegrity: (modelId: string) => Promise<{ success: boolean; status?: 'verified' | 'mismatch' | 'unknown' | 'missing'; error?: string }>;
  modelVerifyAllIntegrity: () => Promise<{ success: boolean; results?: Array<{ modelId: string; modelName: string; status: string; message: string }>; error?: string }>;
  modelRegistryRollback: () => Promise<{ success: boolean }>;
  modelRegistryBackupInfo: () => Promise<{ success: boolean; hasBackup: boolean; info?: { backedUpAt: number; modelCount: number } | null }>;
  modelRegistryMigrate: () => Promise<{ success: boolean; migrated: number; fromVersion: number; toVersion: number }>;
  modelDetectHardware: () => Promise<{ success: boolean; profile?: any; error?: string }>;
  modelRecommend: (criteria?: { capability?: string; category?: string; preferSmaller?: boolean }) =>
    Promise<{ success: boolean; recommendations?: Array<{
      modelId: string; modelName: string; score: number; rank: number;
      canRun: boolean; reason: string;
      suggestedGpuLayers: number; suggestedThreads: number; suggestedContextSize: number;
      estimatedLoadSeconds: number; capabilityMatch: boolean;
      parameterCount?: string; sizeBytes: number;
    }>; error?: string }>;
  modelCanRun: (modelId: string) => Promise<{ success: boolean; verdict?: any; error?: string }>;

  // Phase 41: Local Voice Engine
  voiceStatus: () => Promise<{
    success: boolean; hasLocalSTT: boolean; hasLocalTTS: boolean;
    sttProvider: string | null; ttsProvider: string | null;
    state: string; isListening: boolean; isSpeaking: boolean;
  }>;
  voiceSetSTTModel: (modelPath: string) => Promise<{ success: boolean; error?: string }>;
  voiceSetTTSModel: (voiceModelPath: string) => Promise<{ success: boolean; error?: string }>;
  voiceTranscribe: (audioPath: string, opts?: any) => Promise<{ success: boolean; text: string; language?: string; error?: string; durationMs?: number }>;
  voiceSynthesize: (text: string, opts?: any) => Promise<{ success: boolean; audioFilePath?: string; duration?: number; sampleRate?: number; error?: string; durationMs?: number }>;
  voiceListVoices: () => Promise<{ success: boolean; voices?: Array<{ name: string; language: string; gender?: string }>; error?: string }>;
  voiceFindBinaries: () => Promise<{ success: boolean; whisper: string | null; piper: string | null }>;

  // Phase 42: Local Vision Engine
  visionStatus: () => Promise<{
    success: boolean; hasProvider: boolean; hasLocalProvider: boolean;
    providerName: string | null; state: string;
  }>;
  visionLoadModel: (modelPath: string, mmprojPath?: string) => Promise<{ success: boolean; error?: string }>;
  visionAnalyzeImage: (imagePath: string, prompt?: string, question?: string) =>
    Promise<{ success: boolean; text?: string; error?: string; durationMs?: number }>;
  visionAnalyzeScreen: (prompt?: string) =>
    Promise<{ success: boolean; text?: string; error?: string; durationMs?: number }>;
  visionUnloadModel: () => Promise<{ success: boolean; error?: string }>;
  visionFindBinary: () => Promise<{ success: boolean; binary: string | null }>;

  // Phase 43: Secure Update & Permission System
  updateCheck: (info: any) => Promise<{ success: boolean; plan?: any; error?: string }>;
  updateExecute: (plan: any) => Promise<{ success: boolean; message: string }>;
  updateRespondPermission: (userResponse: string) => Promise<{ success: boolean; error?: string }>;
  updateRespondVoice: () => Promise<{ success: boolean; error?: string }>;
  updateAuditHistory: (limit?: number) => Promise<{ success: boolean; entries?: any[]; error?: string }>;
  updateHistory: () => Promise<{ success: boolean; entries?: any[]; error?: string }>;
  updateListBackups: () => Promise<{ success: boolean; backups?: any[]; error?: string }>;
  updateRollback: (version: string) => Promise<{ success: boolean; error?: string }>;
  updateClassifyAction: (action: any) => Promise<{ success: boolean; level?: string; description?: string; error?: string }>;

  // Phase 44: Production Update Execution Layer
  updateDownload: (opts: { url: string; expectedSize?: number; filename?: string }) =>
    Promise<{ success: boolean; sandboxPath?: string; hash: string; bytesDownloaded: number; durationMs: number; error?: string; resumed: boolean }>;
  updateVerifySignature: (opts: {
    filePath: string; expectedHash: string; signature?: string;
    publicKey?: string; currentVersion: string; targetVersion: string;
  }) => Promise<{ success: boolean; canInstall?: boolean; hashVerified?: boolean; signatureVerified?: boolean; versionCompatible?: boolean; errors?: string[]; error?: string }>;
  updateInstall: (opts: {
    method: string; sourcePath: string; targetDir: string;
    currentVersion: string; newVersion: string; createBackup: boolean; verifyAfterInstall: boolean;
  }) => Promise<{ success: boolean; method?: string; backupPath?: string; rolledBack?: boolean; durationMs?: number; error?: string; log?: string[] }>;
  updateModel: (info: any) => Promise<{ success: boolean; modelPath?: string; hash?: string; error?: string; durationMs: number }>;
  updateModelExplanation: (info: any) => Promise<{ success: boolean; explanation?: string; error?: string }>;
  updateGetHistory: (limit?: number) => Promise<{ success: boolean; entries?: any[]; error?: string }>;
  updateAddHistory: (entry: any) => Promise<{ success: boolean; entry?: any; error?: string }>;
  updateLastSuccessful: () => Promise<{ success: boolean; entry?: any; error?: string }>;

  // Phase 45: Intelligent Model Advisor + Smart Router
  modelAdvisorStatus: () => Promise<{ success: boolean; analysis?: any; error?: string }>;
  modelRecommendations: () => Promise<{ success: boolean; recommendations?: any[]; error?: string }>;
  modelCompare: (modelAId: string, modelBId: string) => Promise<{ success: boolean; comparison?: any; error?: string }>;
  modelRouterDecision: (request: { request: string; intent?: string; hasImage?: boolean; hasAudio?: boolean }) =>
    Promise<{ success: boolean; decision?: any; error?: string }>;
  modelRouterStatus: () => Promise<{ success: boolean; status?: any; error?: string }>;
  usageStats: () => Promise<{ success: boolean; stats?: any; error?: string }>;
  usageRecord: (record: any) => Promise<{ success: boolean; error?: string }>;
  advisorPreferences: () => Promise<{ success: boolean; preferences?: any; error?: string }>;
  advisorRejectRecommendation: (recommendationId: string) => Promise<{ success: boolean; error?: string }>;
  advisorSetPreferredModel: (category: string, modelId: string) => Promise<{ success: boolean; error?: string }>;
  advisorInstalledHistory: () => Promise<{ success: boolean; history?: any[]; error?: string }>;

  // Phase 46: Local Runtime Setup Center
  runtimeScan: () => Promise<{ success: boolean; state?: any; error?: string }>;
  runtimeSetupSummary: () => Promise<{ success: boolean; summary?: string; state?: any; error?: string }>;
  runtimeCatalog: (type?: string) => Promise<{ success: boolean; catalog?: any[]; error?: string }>;
  runtimeRecommendations: () => Promise<{ success: boolean; recommendations?: any[]; error?: string }>;
  runtimeFindMissing: () => Promise<{ success: boolean; missing?: any[]; essentialMissing?: number; optionalMissing?: number; error?: string }>;

  // Phase 47: Component Installation Assistant
  componentInstall: (componentId: string) =>
    Promise<{ success: boolean; componentId: string; componentName: string; stage: string; installedPath?: string; hash?: string; durationMs: number; error?: string; log: string[] }>;
  componentExplanation: (componentId: string) => Promise<{ success: boolean; explanation?: any; error?: string }>;
  componentHealthCheck: (componentId: string, installedPath: string) => Promise<{ success: boolean; result?: any; error?: string }>;
  componentRespondPermission: (userResponse: string) => Promise<{ success: boolean; error?: string }>;
  componentRespondVoice: () => Promise<{ success: boolean; error?: string }>;

  // Phase 49: First Run Intelligence & Model Catalog
  firstrunCatalog: (type?: string) => Promise<{ success: boolean; catalog?: any[]; error?: string }>;
  firstrunModelsByTier: (tier: string) => Promise<{ success: boolean; models?: any[]; error?: string }>;
  firstrunPersianModels: () => Promise<{ success: boolean; models?: any[]; error?: string }>;
  firstrunAnalyze: () => Promise<{ success: boolean; setup?: any; error?: string }>;
  firstrunSummary: () => Promise<{ success: boolean; summary?: string; setup?: any; error?: string }>;
  firstrunInstallPlan: (modelIds: string[], tier: string) => Promise<{ success: boolean; plan?: any; error?: string }>;
  firstrunRecommendedPackage: () => Promise<{ success: boolean; package?: any; setup?: any; error?: string }>;
  firstrunAlternatives: () => Promise<{ success: boolean; alternatives?: any[]; error?: string }>;

  // Phase 50: Final Command Center Integration
  systemStatus: () => Promise<{ success: boolean; status?: any; error?: string }>;
  systemStartupSummary: () => Promise<{ success: boolean; summary?: string; summaryEn?: string; status?: any; error?: string }>;
  systemOrbState: () => Promise<{ success: boolean; orbState?: string; error?: string }>;
  systemSetOrbState: (state: string) => Promise<{ success: boolean; error?: string }>;
  systemNotifications: () => Promise<{ success: boolean; notifications?: any[]; error?: string }>;
  systemAddNotification: (notif: any) => Promise<{ success: boolean; error?: string }>;
  systemClearNotifications: () => Promise<{ success: boolean; error?: string }>;
  systemQuickActions: () => Promise<{ success: boolean; quickActions?: any[]; error?: string }>;

  // Phase 51: NEX Brain Core + Identity System
  brainDecide: (request: { request: string; intent?: string; hasImage?: boolean; hasAudio?: boolean }) =>
    Promise<{ success: boolean; decision?: any; error?: string }>;
  brainStatus: () => Promise<{ success: boolean; status?: any; error?: string }>;
  brainSetMode: (mode: string) => Promise<{ success: boolean; error?: string }>;
  brainLastDecision: () => Promise<{ success: boolean; decision?: any; error?: string }>;
  brainModelsByTask: () => Promise<{ success: boolean; models?: any; error?: string }>;
  identityGet: () => Promise<{ success: boolean; identity?: any; error?: string }>;
  identityUpdate: (patch: any) => Promise<{ success: boolean; identity?: any; error?: string }>;
  identitySetPersonality: (personality: string) => Promise<{ success: boolean; error?: string }>;
  identitySelfAwareness: () => Promise<{ success: boolean; awareness?: any; error?: string }>;

  // Phase 52: Personality Engine + Long Term Memory
  personalityGet: () => Promise<{ success: boolean; profile?: any; personality?: string; error?: string }>;
  personalitySet: (type: string) => Promise<{ success: boolean; profile?: any; error?: string }>;
  personalityAll: () => Promise<{ success: boolean; profiles?: any[]; error?: string }>;
  personalityPrompt: (lang?: string) => Promise<{ success: boolean; prompt?: string; error?: string }>;
  userProfileGet: () => Promise<{ success: boolean; profile?: any; error?: string }>;
  userProfileUpdate: (patch: any) => Promise<{ success: boolean; profile?: any; error?: string }>;
  ltmStore: (category: string, key: string, value: any, opts?: any) => Promise<{ success: boolean; stored?: boolean; reason?: string; error?: string }>;
  ltmRetrieve: (key: string, store?: string, projectId?: string) => Promise<{ success: boolean; value?: any; error?: string }>;
  ltmList: (store?: string, projectId?: string) => Promise<{ success: boolean; entries?: any[]; error?: string }>;
  ltmStats: () => Promise<{ success: boolean; stats?: any; error?: string }>;
  ltmPendingPermission: () => Promise<{ success: boolean; hasPending?: boolean; permission?: any; error?: string }>;
  ltmRespondPermission: (approved: boolean, reason?: string) => Promise<{ success: boolean; error?: string }>;

  // Phase 53: Universal Expert System
  expertRoute: (request: string) => Promise<{ success: boolean; result?: any; error?: string }>;
  expertAll: () => Promise<{ success: boolean; experts?: any[]; error?: string }>;
  expertGet: (id: string) => Promise<{ success: boolean; expert?: any; error?: string }>;
  expertDescription: (lang?: string) => Promise<{ success: boolean; description?: string; error?: string }>;
  expertDomains: () => Promise<{ success: boolean; domains?: string[]; error?: string }>;

  // Phase 54: Agent Skills & Tool Execution Layer
  agentCreatePlan: (request: string) => Promise<{ success: boolean; plan?: any; error?: string }>;
  agentExecutePlan: (plan: any) => Promise<{ success: boolean; plan?: any; completedSteps?: number; failedSteps?: number; deniedSteps?: number; message?: string; messageFa?: string; log?: string[]; error?: string }>;
  agentRespondPermission: (userResponse: string) => Promise<{ success: boolean; error?: string }>;
  agentRespondVoice: () => Promise<{ success: boolean; error?: string }>;
  agentPendingPermission: () => Promise<{ success: boolean; hasPending?: boolean; permission?: any; error?: string }>;
  agentPermissionMessage: (action: string, details?: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  skillAll: () => Promise<{ success: boolean; skills?: any[]; error?: string }>;
  skillGet: (id: string) => Promise<{ success: boolean; skill?: any; error?: string }>;
  skillByDomain: (domain: string) => Promise<{ success: boolean; skills?: any[]; error?: string }>;

  // Phase 55: Offline Expert Knowledge Engine
  expertKnowledgeList: () => Promise<{ success: boolean; packs?: any[]; error?: string }>;
  expertKnowledgeGet: (id: string) => Promise<{ success: boolean; pack?: any; error?: string }>;
  expertKnowledgeByDomain: (domain: string) => Promise<{ success: boolean; packs?: any[]; error?: string }>;
  expertKnowledgeStatus: () => Promise<{ success: boolean; status?: any; error?: string }>;
  expertKnowledgeInstalled: () => Promise<{ success: boolean; packs?: any[]; error?: string }>;
  expertKnowledgeMissing: () => Promise<{ success: boolean; packs?: any[]; error?: string }>;
  expertKnowledgeRecommend: (domain?: string) => Promise<{ success: boolean; packs?: any[]; error?: string }>;
  expertKnowledgeRetrieve: (query: string, opts?: { domain?: string; limit?: number }) => Promise<{ success: boolean; query?: string; results?: any[]; framed?: string; installedPackCount?: number; offline?: boolean; error?: string }>;
  expertKnowledgeRecommendationFa: (domain: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  expertKnowledgeCapabilitiesFa: (domain: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  expertKnowledgeSelfDescFa: () => Promise<{ success: boolean; message?: string; error?: string }>;
  knowledgePackScan: () => Promise<{ success: boolean; records?: any[]; error?: string }>;
  knowledgePackInstall: (packId: string) => Promise<{ success: boolean; result?: any; error?: string }>;
  knowledgePackRemove: (packId: string) => Promise<{ success: boolean; result?: any; error?: string }>;
  knowledgePackUpdate: (packId: string) => Promise<{ success: boolean; result?: any; error?: string }>;
  knowledgePackVerify: (packId: string) => Promise<{ success: boolean; verification?: any; error?: string }>;
  knowledgePackVerifyAll: () => Promise<{ success: boolean; verifications?: any[]; error?: string }>;
  knowledgePackStorage: () => Promise<{ success: boolean; storage?: any; error?: string }>;
  knowledgePackPendingPermission: () => Promise<{ success: boolean; hasPending?: boolean; permission?: any; error?: string }>;
  knowledgePackRespondPermission: (userResponse: string) => Promise<{ success: boolean; error?: string }>;
  knowledgePackRespondVoice: () => Promise<{ success: boolean; error?: string }>;
  onKnowledgePackPermissionRequest: (callback: (req: any) => void) => () => void;

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
