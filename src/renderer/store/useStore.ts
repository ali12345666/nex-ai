import { create } from 'zustand';

export type Panel = 'chat' | 'editor' | 'terminal' | 'settings' | 'explorer';
export type SidebarView = 'files' | 'search' | 'git' | 'extensions' | 'snippets' | 'diagnostics' | 'diff';

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
  settings: {
    theme: 'darker',
    fontSize: 14,
    fontFamily: 'JetBrains Mono, Fira Code, monospace',
    tabSize: 2,
    aiEndpoint: 'https://api.openai.com/v1',
    aiApiKey: '',
    language: 'en',
    voiceEnabled: false,
  },
  updateSettings: (partial) =>
    set((s) => ({ settings: { ...s.settings, ...partial } })),

  // Terminal
  terminalVisible: false,
  toggleTerminal: () => set((s) => ({ terminalVisible: !s.terminalVisible })),
  setTerminalVisible: (v) => set({ terminalVisible: v }),

  // Command Palette
  commandPaletteOpen: false,
  toggleCommandPalette: () =>
    set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
}));
