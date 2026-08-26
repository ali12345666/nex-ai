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

  // ── System ──
  systemInfo: () => ipcRenderer.invoke('system-info'),
  // Phase 26: safe tsc check (replaces removed execCommand)
  runTscCheck: (cwd: string) => ipcRenderer.invoke('run-tsc-check', cwd),

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
  // Phase 17: streaming chat
  aiChatStream: (config: any, messages: any[]) => ipcRenderer.invoke('ai-chat-stream', config, messages),
  aiChatStreamCancel: () => ipcRenderer.invoke('ai-chat-stream-cancel'),
  onChatToken: (callback: (ev: any) => void) => {
    const listener = (_e: any, ev: any) => callback(ev);
    ipcRenderer.on('chat-token', listener);
    return () => ipcRenderer.removeListener('chat-token', listener);
  },
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

  // ── Phase 39: Professional Model Manager (versioning, hash, hardware, backup) ──
  modelComputeHash: (modelId: string) =>
    ipcRenderer.invoke('model-compute-hash', modelId),
  modelVerifyIntegrity: (modelId: string) =>
    ipcRenderer.invoke('model-verify-integrity', modelId),
  modelVerifyAllIntegrity: () =>
    ipcRenderer.invoke('model-verify-all-integrity'),
  modelRegistryRollback: () =>
    ipcRenderer.invoke('model-registry-rollback'),
  modelRegistryBackupInfo: () =>
    ipcRenderer.invoke('model-registry-backup-info'),
  modelRegistryMigrate: () =>
    ipcRenderer.invoke('model-registry-migrate'),
  modelDetectHardware: () =>
    ipcRenderer.invoke('model-detect-hardware'),
  modelRecommend: (criteria?: { capability?: string; category?: string; preferSmaller?: boolean }) =>
    ipcRenderer.invoke('model-recommend', criteria),
  modelCanRun: (modelId: string) =>
    ipcRenderer.invoke('model-can-run', modelId),

  // ── Phase 41: Local Voice Engine (STT + TTS + VAD) ──
  voiceStatus: () => ipcRenderer.invoke('voice-status'),
  voiceSetSTTModel: (modelPath: string) => ipcRenderer.invoke('voice-set-stt-model', modelPath),
  voiceSetTTSModel: (voiceModelPath: string) => ipcRenderer.invoke('voice-set-tts-model', voiceModelPath),
  voiceTranscribe: (audioPath: string, opts?: any) => ipcRenderer.invoke('voice-transcribe', audioPath, opts),
  voiceSynthesize: (text: string, opts?: any) => ipcRenderer.invoke('voice-synthesize', text, opts),
  voiceListVoices: () => ipcRenderer.invoke('voice-list-voices'),
  voiceFindBinaries: () => ipcRenderer.invoke('voice-find-binaries'),

  // ── Phase 56: Advanced Voice Conversation System ──
  voiceConversationStart: () => ipcRenderer.invoke('voice-conversation-start'),
  voiceConversationStop: () => ipcRenderer.invoke('voice-conversation-stop'),
  voiceConversationToggle: () => ipcRenderer.invoke('voice-conversation-toggle'),
  voiceConversationStatus: () => ipcRenderer.invoke('voice-conversation-status'),
  voiceConversationFeed: (text: string) => ipcRenderer.invoke('voice-conversation-feed', text),
  voiceConversationSpeak: (text: string) => ipcRenderer.invoke('voice-conversation-speak', text),
  voiceConversationStartTurn: (initialText?: string) => ipcRenderer.invoke('voice-conversation-start-turn', initialText),
  voiceConversationAbort: () => ipcRenderer.invoke('voice-conversation-abort'),
  voiceConversationStopSpeaking: () => ipcRenderer.invoke('voice-conversation-stop-speaking'),
  voiceConversationSetPersonality: (type: string) => ipcRenderer.invoke('voice-conversation-set-personality', type),
  voiceConversationPersonalityPrefix: () => ipcRenderer.invoke('voice-conversation-personality-prefix'),
  voiceConversationEnableWakeWord: () => ipcRenderer.invoke('voice-conversation-enable-wake-word'),
  voiceConversationDisableWakeWord: () => ipcRenderer.invoke('voice-conversation-disable-wake-word'),
  voiceConversationRestoreContext: () => ipcRenderer.invoke('voice-conversation-restore-context'),
  voiceConversationReset: () => ipcRenderer.invoke('voice-conversation-reset'),
  voiceConversationOrbColor: () => ipcRenderer.invoke('voice-conversation-orb-color'),
  wakeWordDetect: (text: string) => ipcRenderer.invoke('wake-word-detect', text),
  wakeWordFeed: (text: string) => ipcRenderer.invoke('wake-word-feed', text),
  wakeWordStatus: () => ipcRenderer.invoke('wake-word-status'),
  voiceCommandParse: (text: string) => ipcRenderer.invoke('voice-command-parse', text),
  onVoiceConversationState: (callback: (ev: any) => void) => {
    const listener = (_e: any, ev: any) => callback(ev);
    ipcRenderer.on('voice-conversation-state', listener);
    return () => ipcRenderer.removeListener('voice-conversation-state', listener);
  },
  onVoiceConversationWake: (callback: (ev: any) => void) => {
    const listener = (_e: any, ev: any) => callback(ev);
    ipcRenderer.on('voice-conversation-wake', listener);
    return () => ipcRenderer.removeListener('voice-conversation-wake', listener);
  },
  onVoiceConversationUser: (callback: (ev: any) => void) => {
    const listener = (_e: any, ev: any) => callback(ev);
    ipcRenderer.on('voice-conversation-user', listener);
    return () => ipcRenderer.removeListener('voice-conversation-user', listener);
  },
  onVoiceConversationNex: (callback: (ev: any) => void) => {
    const listener = (_e: any, ev: any) => callback(ev);
    ipcRenderer.on('voice-conversation-nex', listener);
    return () => ipcRenderer.removeListener('voice-conversation-nex', listener);
  },
  onVoiceConversationInterrupted: (callback: (ev: any) => void) => {
    const listener = (_e: any, ev: any) => callback(ev);
    ipcRenderer.on('voice-conversation-interrupted', listener);
    return () => ipcRenderer.removeListener('voice-conversation-interrupted', listener);
  },
  onVoiceConversationCommand: (callback: (ev: any) => void) => {
    const listener = (_e: any, ev: any) => callback(ev);
    ipcRenderer.on('voice-conversation-command', listener);
    return () => ipcRenderer.removeListener('voice-conversation-command', listener);
  },
  onVoiceConversationError: (callback: (ev: any) => void) => {
    const listener = (_e: any, ev: any) => callback(ev);
    ipcRenderer.on('voice-conversation-error', listener);
    return () => ipcRenderer.removeListener('voice-conversation-error', listener);
  },

  // ── Phase 57: Executive Planner & Multi-Agent Orchestration ──
  plannerCreate: (request: string, opts?: { projectId?: string }) => ipcRenderer.invoke('planner-create', request, opts),
  plannerExecute: (plan: any, opts?: { speakResults?: boolean }) => ipcRenderer.invoke('planner-execute', plan, opts),
  plannerAbort: (plan: any) => ipcRenderer.invoke('planner-abort', plan),
  plannerStatus: () => ipcRenderer.invoke('planner-status'),
  plannerDecompose: (request: string) => ipcRenderer.invoke('planner-decompose', request),
  plannerSwarm: (plan: any) => ipcRenderer.invoke('planner-swarm', plan),
  plannerEvaluate: (plan: any) => ipcRenderer.invoke('planner-evaluate', plan),
  plannerSetPersonality: (type: string) => ipcRenderer.invoke('planner-set-personality', type),
  plannerExperts: () => ipcRenderer.invoke('planner-experts'),
  plannerSkills: () => ipcRenderer.invoke('planner-skills'),
  plannerSecurityAudit: () => ipcRenderer.invoke('planner-security-audit'),
  onPlannerPlanCreated: (callback: (ev: any) => void) => {
    const listener = (_e: any, ev: any) => callback(ev);
    ipcRenderer.on('planner-plan-created', listener);
    return () => ipcRenderer.removeListener('planner-plan-created', listener);
  },
  onPlannerPlanUpdated: (callback: (ev: any) => void) => {
    const listener = (_e: any, ev: any) => callback(ev);
    ipcRenderer.on('planner-plan-updated', listener);
    return () => ipcRenderer.removeListener('planner-plan-updated', listener);
  },
  onPlannerPlanCompleted: (callback: (ev: any) => void) => {
    const listener = (_e: any, ev: any) => callback(ev);
    ipcRenderer.on('planner-plan-completed', listener);
    return () => ipcRenderer.removeListener('planner-plan-completed', listener);
  },
  onPlannerSubTaskStarted: (callback: (ev: any) => void) => {
    const listener = (_e: any, ev: any) => callback(ev);
    ipcRenderer.on('planner-subtask-started', listener);
    return () => ipcRenderer.removeListener('planner-subtask-started', listener);
  },
  onPlannerSubTaskCompleted: (callback: (ev: any) => void) => {
    const listener = (_e: any, ev: any) => callback(ev);
    ipcRenderer.on('planner-subtask-completed', listener);
    return () => ipcRenderer.removeListener('planner-subtask-completed', listener);
  },
  onPlannerSelfEvaluation: (callback: (ev: any) => void) => {
    const listener = (_e: any, ev: any) => callback(ev);
    ipcRenderer.on('planner-self-evaluation', listener);
    return () => ipcRenderer.removeListener('planner-self-evaluation', listener);
  },
  onPlannerError: (callback: (ev: any) => void) => {
    const listener = (_e: any, ev: any) => callback(ev);
    ipcRenderer.on('planner-error', listener);
    return () => ipcRenderer.removeListener('planner-error', listener);
  },

  // ── Phase 42: Local Vision Engine (LLaVA + image analysis) ──
  visionStatus: () => ipcRenderer.invoke('vision-status'),
  visionLoadModel: (modelPath: string, mmprojPath?: string) =>
    ipcRenderer.invoke('vision-load-model', modelPath, mmprojPath),
  visionAnalyzeImage: (imagePath: string, prompt?: string, question?: string) =>
    ipcRenderer.invoke('vision-analyze-image', imagePath, prompt, question),
  visionAnalyzeScreen: (prompt?: string) =>
    ipcRenderer.invoke('vision-analyze-screen', prompt),
  visionUnloadModel: () => ipcRenderer.invoke('vision-unload-model'),
  visionFindBinary: () => ipcRenderer.invoke('vision-find-binary'),

  // ── Phase 43: Secure Update & Permission System ──
  updateCheck: (info: any) => ipcRenderer.invoke('update-check', info),
  updateExecute: (plan: any) => ipcRenderer.invoke('update-execute', plan),
  updateRespondPermission: (userResponse: string) =>
    ipcRenderer.invoke('update-respond-permission', userResponse),
  updateRespondVoice: () => ipcRenderer.invoke('update-respond-voice'),
  updateAuditHistory: (limit?: number) => ipcRenderer.invoke('update-audit-history', limit),
  updateHistory: () => ipcRenderer.invoke('update-history'),
  updateListBackups: () => ipcRenderer.invoke('update-list-backups'),
  updateRollback: (version: string) => ipcRenderer.invoke('update-rollback', version),
  updateClassifyAction: (action: any) => ipcRenderer.invoke('update-classify-action', action),

  // ── Phase 44: Production Update Execution Layer ──
  updateDownload: (opts: { url: string; expectedSize?: number; filename?: string }) =>
    ipcRenderer.invoke('update-download', opts),
  updateVerifySignature: (opts: {
    filePath: string; expectedHash: string; signature?: string;
    publicKey?: string; currentVersion: string; targetVersion: string;
  }) => ipcRenderer.invoke('update-verify-signature', opts),
  updateInstall: (opts: {
    method: string; sourcePath: string; targetDir: string;
    currentVersion: string; newVersion: string; createBackup: boolean; verifyAfterInstall: boolean;
  }) => ipcRenderer.invoke('update-install', opts),
  updateModel: (info: any) => ipcRenderer.invoke('update-model', info),
  updateModelExplanation: (info: any) => ipcRenderer.invoke('update-model-explanation', info),
  updateGetHistory: (limit?: number) => ipcRenderer.invoke('update-get-history', limit),
  updateAddHistory: (entry: any) => ipcRenderer.invoke('update-add-history', entry),
  updateLastSuccessful: () => ipcRenderer.invoke('update-last-successful'),

  // ── Phase 45: Intelligent Model Advisor + Smart Router ──
  modelAdvisorStatus: () => ipcRenderer.invoke('model-advisor-status'),
  modelRecommendations: () => ipcRenderer.invoke('model-recommendations'),
  modelCompare: (modelAId: string, modelBId: string) => ipcRenderer.invoke('model-compare', modelAId, modelBId),
  modelRouterDecision: (request: { request: string; intent?: string; hasImage?: boolean; hasAudio?: boolean }) =>
    ipcRenderer.invoke('model-router-decision', request),
  modelRouterStatus: () => ipcRenderer.invoke('model-router-status'),
  usageStats: () => ipcRenderer.invoke('usage-stats'),
  usageRecord: (record: any) => ipcRenderer.invoke('usage-record', record),
  advisorPreferences: () => ipcRenderer.invoke('advisor-preferences'),
  advisorRejectRecommendation: (recommendationId: string) => ipcRenderer.invoke('advisor-reject-recommendation', recommendationId),
  advisorSetPreferredModel: (category: string, modelId: string) => ipcRenderer.invoke('advisor-set-preferred-model', category, modelId),
  advisorInstalledHistory: () => ipcRenderer.invoke('advisor-installed-history'),

  // ── Phase 46: Local Runtime Setup Center ──
  runtimeScan: () => ipcRenderer.invoke('runtime-scan'),
  runtimeSetupSummary: () => ipcRenderer.invoke('runtime-setup-summary'),
  runtimeCatalog: (type?: string) => ipcRenderer.invoke('runtime-catalog', type),
  runtimeRecommendations: () => ipcRenderer.invoke('runtime-recommendations'),
  runtimeFindMissing: () => ipcRenderer.invoke('runtime-find-missing'),

  // ── Phase 47: Component Installation Assistant ──
  componentInstall: (componentId: string) => ipcRenderer.invoke('component-install', componentId),
  componentExplanation: (componentId: string) => ipcRenderer.invoke('component-explanation', componentId),
  componentHealthCheck: (componentId: string, installedPath: string) =>
    ipcRenderer.invoke('component-health-check', componentId, installedPath),
  componentRespondPermission: (userResponse: string) =>
    ipcRenderer.invoke('component-respond-permission', userResponse),
  componentRespondVoice: () => ipcRenderer.invoke('component-respond-voice'),

  // ── Phase 49: First Run Intelligence & Model Catalog ──
  firstrunCatalog: (type?: string) => ipcRenderer.invoke('firstrun-catalog', type),
  firstrunModelsByTier: (tier: string) => ipcRenderer.invoke('firstrun-models-by-tier', tier),
  firstrunPersianModels: () => ipcRenderer.invoke('firstrun-persian-models'),
  firstrunAnalyze: () => ipcRenderer.invoke('firstrun-analyze'),
  firstrunSummary: () => ipcRenderer.invoke('firstrun-summary'),
  firstrunInstallPlan: (modelIds: string[], tier: string) => ipcRenderer.invoke('firstrun-install-plan', modelIds, tier),
  firstrunRecommendedPackage: () => ipcRenderer.invoke('firstrun-recommended-package'),
  firstrunAlternatives: () => ipcRenderer.invoke('firstrun-alternatives'),

  // ── Phase 50: Final Command Center Integration ──
  systemStatus: () => ipcRenderer.invoke('system-status'),
  systemStartupSummary: () => ipcRenderer.invoke('system-startup-summary'),
  systemOrbState: () => ipcRenderer.invoke('system-orb-state'),
  systemSetOrbState: (state: string) => ipcRenderer.invoke('system-set-orb-state', state),
  systemNotifications: () => ipcRenderer.invoke('system-notifications'),
  systemAddNotification: (notif: any) => ipcRenderer.invoke('system-add-notification', notif),
  systemClearNotifications: () => ipcRenderer.invoke('system-clear-notifications'),
  systemQuickActions: () => ipcRenderer.invoke('system-quick-actions'),

  // ── Phase 51: NEX Brain Core + Identity System ──
  brainDecide: (request: { request: string; intent?: string; hasImage?: boolean; hasAudio?: boolean }) =>
    ipcRenderer.invoke('brain-decide', request),
  brainStatus: () => ipcRenderer.invoke('brain-status'),
  brainSetMode: (mode: string) => ipcRenderer.invoke('brain-set-mode', mode),
  brainLastDecision: () => ipcRenderer.invoke('brain-last-decision'),
  brainModelsByTask: () => ipcRenderer.invoke('brain-models-by-task'),
  identityGet: () => ipcRenderer.invoke('identity-get'),
  identityUpdate: (patch: any) => ipcRenderer.invoke('identity-update', patch),
  identitySetPersonality: (personality: string) => ipcRenderer.invoke('identity-set-personality', personality),
  identitySelfAwareness: () => ipcRenderer.invoke('identity-self-awareness'),

  // ── Phase 52: Personality Engine + Long Term Memory ──
  personalityGet: () => ipcRenderer.invoke('personality-get'),
  personalitySet: (type: string) => ipcRenderer.invoke('personality-set', type),
  personalityAll: () => ipcRenderer.invoke('personality-all'),
  personalityPrompt: (lang?: string) => ipcRenderer.invoke('personality-prompt', lang),
  userProfileGet: () => ipcRenderer.invoke('user-profile-get'),
  userProfileUpdate: (patch: any) => ipcRenderer.invoke('user-profile-update', patch),
  ltmStore: (category: string, key: string, value: any, opts?: any) => ipcRenderer.invoke('ltm-store', category, key, value, opts),
  ltmRetrieve: (key: string, store?: string, projectId?: string) => ipcRenderer.invoke('ltm-retrieve', key, store, projectId),
  ltmList: (store?: string, projectId?: string) => ipcRenderer.invoke('ltm-list', store, projectId),
  ltmStats: () => ipcRenderer.invoke('ltm-stats'),
  ltmPendingPermission: () => ipcRenderer.invoke('ltm-pending-permission'),
  ltmRespondPermission: (approved: boolean, reason?: string) => ipcRenderer.invoke('ltm-respond-permission', approved, reason),

  // ── Phase 53: Universal Expert System ──
  expertRoute: (request: string) => ipcRenderer.invoke('expert-route', request),
  expertAll: () => ipcRenderer.invoke('expert-all'),
  expertGet: (id: string) => ipcRenderer.invoke('expert-get', id),
  expertDescription: (lang?: string) => ipcRenderer.invoke('expert-description', lang),
  expertDomains: () => ipcRenderer.invoke('expert-domains'),

  // ── Phase 54: Agent Skills & Tool Execution Layer ──
  agentCreatePlan: (request: string) => ipcRenderer.invoke('agent-create-plan', request),
  agentExecutePlan: (plan: any) => ipcRenderer.invoke('agent-execute-plan', plan),
  agentRespondPermission: (userResponse: string) => ipcRenderer.invoke('agent-respond-permission', userResponse),
  agentRespondVoice: () => ipcRenderer.invoke('agent-respond-voice'),
  agentPendingPermission: () => ipcRenderer.invoke('agent-pending-permission'),
  agentPermissionMessage: (action: string, details?: string) => ipcRenderer.invoke('agent-permission-message', action, details),
  skillAll: () => ipcRenderer.invoke('skill-all'),
  skillGet: (id: string) => ipcRenderer.invoke('skill-get', id),
  skillByDomain: (domain: string) => ipcRenderer.invoke('skill-by-domain', domain),

  // ── Phase 55: Offline Expert Knowledge Engine ──
  expertKnowledgeList: () => ipcRenderer.invoke('expert-knowledge-list'),
  expertKnowledgeGet: (id: string) => ipcRenderer.invoke('expert-knowledge-get', id),
  expertKnowledgeByDomain: (domain: string) => ipcRenderer.invoke('expert-knowledge-by-domain', domain),
  expertKnowledgeStatus: () => ipcRenderer.invoke('expert-knowledge-status'),
  expertKnowledgeInstalled: () => ipcRenderer.invoke('expert-knowledge-installed'),
  expertKnowledgeMissing: () => ipcRenderer.invoke('expert-knowledge-missing'),
  expertKnowledgeRecommend: (domain?: string) => ipcRenderer.invoke('expert-knowledge-recommend', domain),
  expertKnowledgeRetrieve: (query: string, opts?: { domain?: string; limit?: number }) => ipcRenderer.invoke('expert-knowledge-retrieve', query, opts),
  expertKnowledgeRecommendationFa: (domain: string) => ipcRenderer.invoke('expert-knowledge-recommendation-fa', domain),
  expertKnowledgeCapabilitiesFa: (domain: string) => ipcRenderer.invoke('expert-knowledge-capabilities-fa', domain),
  expertKnowledgeSelfDescFa: () => ipcRenderer.invoke('expert-knowledge-self-desc-fa'),
  knowledgePackScan: () => ipcRenderer.invoke('knowledge-pack-scan'),
  knowledgePackInstall: (packId: string) => ipcRenderer.invoke('knowledge-pack-install', packId),
  knowledgePackRemove: (packId: string) => ipcRenderer.invoke('knowledge-pack-remove', packId),
  knowledgePackUpdate: (packId: string) => ipcRenderer.invoke('knowledge-pack-update', packId),
  knowledgePackVerify: (packId: string) => ipcRenderer.invoke('knowledge-pack-verify', packId),
  knowledgePackVerifyAll: () => ipcRenderer.invoke('knowledge-pack-verify-all'),
  knowledgePackStorage: () => ipcRenderer.invoke('knowledge-pack-storage'),
  knowledgePackPendingPermission: () => ipcRenderer.invoke('knowledge-pack-pending-permission'),
  knowledgePackRespondPermission: (userResponse: string) => ipcRenderer.invoke('knowledge-pack-respond-permission', userResponse),
  knowledgePackRespondVoice: () => ipcRenderer.invoke('knowledge-pack-respond-voice'),
  onKnowledgePackPermissionRequest: (callback: (req: any) => void) => {
    const listener = (_event: any, req: any) => callback(req);
    ipcRenderer.on('knowledge-pack-permission-request', listener);
    return () => ipcRenderer.removeListener('knowledge-pack-permission-request', listener);
  },

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
  // System Monitor (Phase 12)
  systemSnapshot: () => ipcRenderer.invoke('system-snapshot'),

  // ── Phase 32: Conversation Center ──
  conversationSave: (data: any) => ipcRenderer.invoke('conversation-save', data),
  conversationLoad: (id: string) => ipcRenderer.invoke('conversation-load', id),
  conversationList: () => ipcRenderer.invoke('conversation-list'),
  conversationDelete: (id: string) => ipcRenderer.invoke('conversation-delete', id),
  conversationRename: (id: string, title: string) => ipcRenderer.invoke('conversation-rename', id, title),
  conversationSearch: (query: string) => ipcRenderer.invoke('conversation-search', query),

  // ── Phase 28: Terminal Sessions (PTY-backed) ──
  terminalSessionSpawn: (cwd: string, cols?: number, rows?: number) =>
    ipcRenderer.invoke('terminal-session-spawn', cwd, cols, rows),
  terminalSessionWrite: (sessionId: string, data: string) => ipcRenderer.invoke('terminal-session-write', sessionId, data),
  terminalSessionResize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('terminal-session-resize', sessionId, cols, rows),
  terminalSessionSignal: (sessionId: string, signal: string) => ipcRenderer.invoke('terminal-session-signal', sessionId, signal),
  terminalSessionKill: (sessionId: string) => ipcRenderer.invoke('terminal-session-kill', sessionId),
  terminalSessionList: () => ipcRenderer.invoke('terminal-session-list'),
  onTerminalSessionOutput: (sessionId: string, callback: (data: string) => void) => {
    const channel = `terminal-output:${sessionId}`;
    const listener = (_e: any, data: string) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onTerminalSessionExit: (sessionId: string, callback: (code: number | null) => void) => {
    const channel = `terminal-exit:${sessionId}`;
    const listener = (_e: any, code: number | null) => callback(code);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  // ── Phase 28: Filesystem Service (workspace-jailed) ──
  fsSetWorkspace: (rootPath: string) => ipcRenderer.invoke('fs-set-workspace', rootPath),
  fsServiceReaddir: (dirPath: string, showHidden?: boolean) => ipcRenderer.invoke('fs-service-readdir', dirPath, showHidden),
  fsServiceReadfile: (filePath: string) => ipcRenderer.invoke('fs-service-readfile', filePath),
  fsServiceWritefile: (filePath: string, content: string) => ipcRenderer.invoke('fs-service-writefile', filePath, content),
  fsServiceCreate: (parentPath: string, name: string, isDir: boolean) => ipcRenderer.invoke('fs-service-create', parentPath, name, isDir),
  fsServiceRename: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs-service-rename', oldPath, newPath),
  fsServiceDelete: (targetPath: string) => ipcRenderer.invoke('fs-service-delete', targetPath),
  fsServiceSearch: (query: string) => ipcRenderer.invoke('fs-service-search', query),
  // Memory (Phase 13)
  memoryList: (store: string, projectPath?: string) => ipcRenderer.invoke('memory-list', store, projectPath),
  // Plugins (Phase 15) — manifests only, no code activation
  pluginsList: () => ipcRenderer.invoke('plugins-list'),
  pluginsSetEnabled: (pluginId: string, enabled: boolean) => ipcRenderer.invoke('plugins-set-enabled', pluginId, enabled),
  memoryDelete: (store: string, key: string, projectPath?: string) => ipcRenderer.invoke('memory-delete', store, key, projectPath),
  memoryClear: (store: string, projectPath?: string) => ipcRenderer.invoke('memory-clear', store, projectPath),
  knowledgeList: (projectPath: string) => ipcRenderer.invoke('knowledge-list', projectPath),
  knowledgeSearch: (projectPath: string, query: string, limit?: number) => ipcRenderer.invoke('knowledge-search', projectPath, query, limit),
  knowledgeIngest: (projectPath: string, filePath: string) => ipcRenderer.invoke('knowledge-ingest', projectPath, filePath),
  knowledgeIngestMany: (projectPath: string, filePaths: string[]) => ipcRenderer.invoke('knowledge-ingest-many', projectPath, filePaths),
  knowledgeIngestFolder: (projectPath: string, folderPath: string) => ipcRenderer.invoke('knowledge-ingest-folder', projectPath, folderPath),
  knowledgeRemove: (projectPath: string, documentId: string) => ipcRenderer.invoke('knowledge-remove', projectPath, documentId),
  knowledgePurgeMissing: (projectPath: string) => ipcRenderer.invoke('knowledge-purge-missing', projectPath),
  knowledgeRebuild: (projectPath: string) => ipcRenderer.invoke('knowledge-rebuild', projectPath),
  knowledgeClear: (projectPath: string) => ipcRenderer.invoke('knowledge-clear', projectPath),
  knowledgeChunks: (projectPath: string, documentId: string) => ipcRenderer.invoke('knowledge-chunks', projectPath, documentId),
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
