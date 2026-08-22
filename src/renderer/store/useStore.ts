import { create } from 'zustand';

export type Panel = 'chat' | 'editor' | 'terminal' | 'settings' | 'explorer';
export type SidebarView = 'files' | 'search' | 'git' | 'extensions' | 'snippets' | 'diagnostics' | 'diff' | 'models';

/**
 * AI Mode (Phase 6)
 * - local:  only Local AI (no external calls, works offline)
 * - online: only online providers (OpenAI/Claude)
 * - auto:   tries Local first, falls back to online if local unavailable
 */
export type AIMode = 'local' | 'online' | 'auto';

/**
 * AI Provider Type
 */
export type AIProviderType = 'local' | 'openai' | 'claude';

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  language: string;
  modified: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  tokens?: number;
  provider?: string;
}

export interface LocalModelInfo {
  id: string;            // internal id (uuid)
  name: string;          // user-friendly name
  path: string;          // absolute path to .gguf file
  sizeBytes: number;
  contextSize: number;   // default 2048
  gpuLayers: number;     // -1 = auto, 0 = CPU only, >0 = N layers offloaded
  category: 'general' | 'coding' | 'reasoning' | 'fast';
  addedAt: number;
}

export interface NexSettings {
  theme: 'dark' | 'darker';
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  aiEndpoint: string;
  aiApiKey: string;
  language: string;
  voiceEnabled: boolean;
  // Phase 6: AI mode
  aiMode: AIMode;
  // Phase 4: Local model selection
  activeLocalModelId: string | null;
  // Phase 3: Local engine options
  localThreads: number;        // CPU threads for inference
  localContextSize: number;     // context window in tokens
  localTemperature: number;
  localMaxTokens: number;
}

/**
 * Get the provider config to pass to aiChat IPC.
 * Decides Local vs OpenAI vs Claude based on aiMode + availability.
 */
export function getProviderConfig(
  settings: NexSettings,
  mode: AIMode,
  localModel: LocalModelInfo | null
): {
  provider: AIProviderType;
  apiKey?: string;
  model?: string;
  endpoint?: string;
  maxTokens: number;
  temperature: number;
  // Local-only fields (ignored by online providers)
  localModelPath?: string;
  localContextSize?: number;
  localThreads?: number;
  localGpuLayers?: number;
} {
  if (mode === 'local' || (mode === 'auto' && localModel)) {
    return {
      provider: 'local',
      model: localModel?.name || 'local',
      localModelPath: localModel?.path,
      localContextSize: localModel?.contextSize || settings.localContextSize,
      localThreads: settings.localThreads,
      localGpuLayers: localModel?.gpuLayers ?? -1,
      maxTokens: settings.localMaxTokens,
      temperature: settings.localTemperature,
    };
  }
  // Online mode (or Auto with no local model)
  const isClaude = settings.aiEndpoint.includes('anthropic');
  return {
    provider: isClaude ? 'claude' : 'openai',
    apiKey: settings.aiApiKey,
    model: isClaude ? 'claude-sonnet-4-20250514' : 'gpt-4o',
    endpoint: isClaude
      ? 'https://api.anthropic.com/v1/messages'
      : (settings.aiEndpoint || 'https://api.openai.com/v1') + '/chat/completions',
    maxTokens: 4096,
    temperature: 0.7,
  };
}

interface AppState {
  // Panels
  activePanel: Panel;
  setActivePanel: (panel: Panel) => void;
  sidebarView: SidebarView;
  setSidebarView: (view: SidebarView) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Files
  openFiles: OpenFile[];
  activeFile: string | null;
  openFile: (filePath: string) => Promise<void>;
  closeFile: (filePath: string) => void;
  setActiveFile: (filePath: string) => void;
  updateFileContent: (filePath: string, content: string) => void;
  saveFile: (filePath: string) => Promise<void>;

  // Project
  projectPath: string | null;
  setProjectPath: (path: string) => void;

  // Chat
  messages: ChatMessage[];
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  clearMessages: () => void;
  isAILoading: boolean;
  setAILoading: (loading: boolean) => void;

  // Settings
  settings: NexSettings;
  updateSettings: (partial: Partial<NexSettings>) => void;

  // Phase 6: AI Mode
  aiMode: AIMode;
  setAIMode: (mode: AIMode) => void;

  // Phase 4: Local Models registry
  localModels: LocalModelInfo[];
  setLocalModels: (models: LocalModelInfo[]) => void;
  activeLocalModel: LocalModelInfo | null;
  setActiveLocalModel: (id: string | null) => void;

  // Terminal
  terminalVisible: boolean;
  toggleTerminal: () => void;
  setTerminalVisible: (v: boolean) => void;

  // Command Palette
  commandPaletteOpen: boolean;
  toggleCommandPalette: () => void;
}

function getLanguageFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    cpp: 'cpp', c: 'c', h: 'c', cs: 'csharp', php: 'php',
    html: 'html', css: 'css', scss: 'scss', less: 'less',
    json: 'json', yaml: 'yaml', yml: 'yaml', xml: 'xml',
    md: 'markdown', sql: 'sql', sh: 'shell', bash: 'shell',
    dockerfile: 'dockerfile', toml: 'ini', ini: 'ini',
    vue: 'vue', svelte: 'svelte', dart: 'dart', swift: 'swift',
    kt: 'kotlin', scala: 'scala', ex: 'elixir', erl: 'erlang',
    lua: 'lua', r: 'r', matlab: 'matlab', tex: 'latex',
  };
  return map[ext] || 'plaintext';
}

const DEFAULT_SETTINGS: NexSettings = {
  theme: 'darker',
  fontSize: 14,
  fontFamily: 'JetBrains Mono, Fira Code, monospace',
  tabSize: 2,
  aiEndpoint: 'https://api.openai.com/v1',
  aiApiKey: '',
  language: 'en',
  voiceEnabled: false,
  aiMode: 'local',  // ✅ Phase 6: default to Local
  activeLocalModelId: null,
  localThreads: 4,
  localContextSize: 2048,
  localTemperature: 0.7,
  localMaxTokens: 1024,
};

export const useStore = create<AppState>((set, get) => ({
  // Panels
  activePanel: 'chat',
  setActivePanel: (panel) => set({ activePanel: panel }),
  sidebarView: 'files',
  setSidebarView: (view) => set({ sidebarView: view }),
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  // Files
  openFiles: [],
  activeFile: null,
  openFile: async (filePath) => {
    const existing = get().openFiles.find((f) => f.path === filePath);
    if (existing) {
      set({ activeFile: filePath, activePanel: 'editor' });
      return;
    }
    const result = await window.nexAPI.readFile(filePath);
    if (result.success && result.content !== undefined) {
      const name = filePath.split(/[\\/]/).pop() || filePath;
      const file: OpenFile = {
        path: filePath,
        name,
        content: result.content,
        language: getLanguageFromFilename(name),
        modified: false,
      };
      set((s) => ({
        openFiles: [...s.openFiles, file],
        activeFile: filePath,
        activePanel: 'editor',
      }));
    }
  },
  closeFile: (filePath) => {
    set((s) => {
      const remaining = s.openFiles.filter((f) => f.path !== filePath);
      return {
        openFiles: remaining,
        activeFile:
          s.activeFile === filePath
            ? remaining.length > 0
              ? remaining[remaining.length - 1].path
              : null
            : s.activeFile,
        activePanel: remaining.length === 0 ? 'chat' : s.activePanel,
      };
    });
  },
  setActiveFile: (filePath) => set({ activeFile: filePath, activePanel: 'editor' }),
  updateFileContent: (filePath, content) => {
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === filePath ? { ...f, content, modified: true } : f
      ),
    }));
  },
  saveFile: async (filePath) => {
    const file = get().openFiles.find((f) => f.path === filePath);
    if (file) {
      const result = await window.nexAPI.writeFile(filePath, file.content);
      if (result.success) {
        set((s) => ({
          openFiles: s.openFiles.map((f) =>
            f.path === filePath ? { ...f, modified: false } : f
          ),
        }));
      }
    }
  },

  // Project
  projectPath: null,
  setProjectPath: (path) => set({ projectPath: path }),

  // Chat
  messages: [],
  addMessage: (msg) =>
    set((s) => ({
      messages: [
        ...s.messages,
        { ...msg, id: crypto.randomUUID(), timestamp: Date.now() },
      ],
    })),
  clearMessages: () => set({ messages: [] }),
  isAILoading: false,
  setAILoading: (loading) => set({ isAILoading: loading }),

  // Settings
  settings: DEFAULT_SETTINGS,
  updateSettings: (partial) =>
    set((s) => ({ settings: { ...s.settings, ...partial } })),

  // Phase 6: AI Mode
  aiMode: 'local',
  setAIMode: (mode) => set({ aiMode: mode }),

  // Phase 4: Local Models registry
  localModels: [],
  setLocalModels: (models) => set({ localModels: models }),
  activeLocalModel: null,
  setActiveLocalModel: (id) => {
    const model = get().localModels.find((m) => m.id === id) || null;
    set({ activeLocalModel: model, settings: { ...get().settings, activeLocalModelId: id } });
  },

  // Terminal
  terminalVisible: false,
  toggleTerminal: () => set((s) => ({ terminalVisible: !s.terminalVisible })),
  setTerminalVisible: (v) => set({ terminalVisible: v }),

  // Command Palette
  commandPaletteOpen: false,
  toggleCommandPalette: () =>
    set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
}));

// Attach helper as a static method on the store for use in components
// (kept here so types align)
(useStore as any).getProviderConfig = getProviderConfig;
