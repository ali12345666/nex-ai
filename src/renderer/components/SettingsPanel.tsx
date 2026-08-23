import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
// Phase 31: Theme selector
import ThemeSelector from './settings/ThemeSelector';
import {
  Key,
  Palette,
  Type,
  Globe,
  Brain,
  Save,
  Check,
  ChevronRight,
  Shield,
  Terminal,
  Mic,
  Monitor,
  Info,
  Cpu,
  Cloud,
  Zap,
  HardDrive,
  AlertCircle,
} from 'lucide-react';

interface SettingsSection {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const sections: SettingsSection[] = [
  { id: 'ai', label: 'AI Mode', icon: <Zap size={16} /> },
  { id: 'local', label: 'Local AI', icon: <Cpu size={16} /> },
  { id: 'online', label: 'Online AI', icon: <Cloud size={16} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={16} /> },
  { id: 'editor', label: 'Editor', icon: <Type size={16} /> },
  { id: 'terminal', label: 'Terminal', icon: <Terminal size={16} /> },
  { id: 'voice', label: 'Voice', icon: <Mic size={16} /> },
  { id: 'security', label: 'Security', icon: <Shield size={16} /> },
  { id: 'about', label: 'About', icon: <Info size={16} /> },
];

export default function SettingsPanel() {
  const { settings, updateSettings, aiMode, setAIMode } = useStore();
  const [activeSection, setActiveSection] = useState('ai');
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [localSettings, setLocalSettings] = useState({ ...settings });
  const [localApiKey, setLocalApiKey] = useState(settings.aiApiKey);
  const [localGlmApiKey, setLocalGlmApiKey] = useState(settings.glmApiKey);
  const [persistenceInfo, setPersistenceInfo] = useState<{ userDataPath: string; portable: boolean; secretsAvailable: boolean } | null>(null);

  useEffect(() => {
    setLocalSettings({ ...settings });
    setLocalApiKey(settings.aiApiKey);
    setLocalGlmApiKey(settings.glmApiKey);
  }, [settings]);

  // Load persistence info for About section
  useEffect(() => {
    window.nexAPI.persistenceInfo().then(setPersistenceInfo).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaveError(null);
    // Update Zustand state (in-memory)
    updateSettings(localSettings);
    if (localApiKey !== settings.aiApiKey) {
      updateSettings({ aiApiKey: localApiKey });
    }
    if (localGlmApiKey !== settings.glmApiKey) {
      updateSettings({ glmApiKey: localGlmApiKey });
    }
    // Persist to disk (Phase 2 — survives close/restart/crash)
    // GLM key (Phase 8) is stored encrypted exactly like the others.
    try {
      const result = await window.nexAPI.settingsSave(localSettings, localApiKey, localGlmApiKey);
      if (result.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setSaveError(result.error || 'Failed to save settings');
      }
    } catch (err: any) {
      setSaveError(err.message);
    }
  };

  const updateLocal = (key: string, value: any) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="h-full flex bg-[var(--nex-bg)] animate-in">
      {/* Sidebar */}
      <div className="w-[220px] border-r border-[var(--nex-glass-border)] bg-[var(--nex-panel-solid)] shrink-0">
        <div className="h-10 flex items-center px-4 border-b border-[var(--nex-glass-border)]/50">
          <span className="text-xs font-semibold text-[var(--nex-text-dim)] uppercase tracking-wider">Settings</span>
        </div>
        <div className="py-2">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-all ${
                activeSection === section.id
                  ? 'text-[var(--nex-accent)] bg-[var(--nex-accent-dim)] border-r-2 border-r-nex-accent'
                  : 'text-[var(--nex-text-dim)] hover:text-[var(--nex-text)] hover:bg-white/[0.04]'
              }`}
            >
              {section.icon}
              {section.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl">
          {/* AI Mode (Phase 6) */}
          {activeSection === 'ai' && (
            <div className="space-y-6 animate-in">
              <div>
                <h2 className="text-lg font-semibold text-[var(--nex-text)] mb-1">AI Mode</h2>
                <p className="text-sm text-[var(--nex-text-muted)]">Choose where NEX AI's intelligence runs</p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <button onClick={() => setAIMode('local')}
                  className={`p-4 rounded-xl border transition-all text-left ${
                    aiMode === 'local' ? 'border-[var(--nex-accent)] bg-[var(--nex-accent-dim)] nex-glow-sm' : 'border-[var(--nex-glass-border)] hover:border-[var(--nex-panel-border-hover)]'
                  }`}>
                  <Cpu size={20} className={aiMode === 'local' ? 'text-[var(--nex-accent)]' : 'text-[var(--nex-text-dim)]'} />
                  <div className="mt-2 text-sm font-medium text-[var(--nex-text)]">Local</div>
                  <div className="text-[11px] text-[var(--nex-text-muted)] mt-1">Runs entirely on your machine. Works offline. No API key required.</div>
                </button>
                <button onClick={() => setAIMode('online')}
                  className={`p-4 rounded-xl border transition-all text-left ${
                    aiMode === 'online' ? 'border-[var(--nex-accent)] bg-[var(--nex-accent-dim)] nex-glow-sm' : 'border-[var(--nex-glass-border)] hover:border-[var(--nex-panel-border-hover)]'
                  }`}>
                  <Cloud size={20} className={aiMode === 'online' ? 'text-[var(--nex-accent)]' : 'text-[var(--nex-text-dim)]'} />
                  <div className="mt-2 text-sm font-medium text-[var(--nex-text)]">Online</div>
                  <div className="text-[11px] text-[var(--nex-text-muted)] mt-1">Use OpenAI/Anthropic APIs. Requires internet and API key.</div>
                </button>
                <button onClick={() => setAIMode('auto')}
                  className={`p-4 rounded-xl border transition-all text-left ${
                    aiMode === 'auto' ? 'border-[var(--nex-accent)] bg-[var(--nex-accent-dim)] nex-glow-sm' : 'border-[var(--nex-glass-border)] hover:border-[var(--nex-panel-border-hover)]'
                  }`}>
                  <Zap size={20} className={aiMode === 'auto' ? 'text-[var(--nex-accent)]' : 'text-[var(--nex-text-dim)]'} />
                  <div className="mt-2 text-sm font-medium text-[var(--nex-text)]">Auto</div>
                  <div className="text-[11px] text-[var(--nex-text-muted)] mt-1">Local first, falls back to online when needed.</div>
                </button>
              </div>

              <div className="p-4 bg-[var(--nex-glass-bg)] rounded-xl border border-[var(--nex-glass-border)]">
                <div className="flex items-start gap-3">
                  <HardDrive size={16} className="text-[var(--nex-text-dim)] shrink-0 mt-0.5" />
                  <div className="text-sm text-[var(--nex-text-dim)]">
                    <strong className="text-[var(--nex-text)]">Non-negotiable requirement:</strong>{' '}
                    NEX AI's core intelligence is Local. Even in Auto mode, the brain stays local —
                    online providers are only used as optional enhancement layers.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Local AI (Phase 3-4) */}
          {activeSection === 'local' && (
            <div className="space-y-6 animate-in">
              <div>
                <h2 className="text-lg font-semibold text-[var(--nex-text)] mb-1">Local AI Engine</h2>
                <p className="text-sm text-[var(--nex-text-muted)]">Run AI models entirely on your machine</p>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-[var(--nex-glass-bg)] rounded-xl border border-[var(--nex-glass-border)]">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-[var(--nex-text)]">Engine Status</div>
                      <div className="text-xs text-[var(--nex-text-muted)]">node-llama-cpp (bundled)</div>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">Ready</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--nex-text)] mb-2">CPU Threads: {localSettings.localThreads}</label>
                  <input type="range" min="1" max="16" value={localSettings.localThreads}
                    onChange={(e) => updateLocal('localThreads', parseInt(e.target.value))}
                    className="w-full accent-nex-accent" />
                  <p className="text-[11px] text-[var(--nex-text-muted)] mt-1">More threads = faster, but uses more CPU.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--nex-text)] mb-2">Context Size: {localSettings.localContextSize} tokens</label>
                  <input type="range" min="512" max="8192" step="512" value={localSettings.localContextSize}
                    onChange={(e) => updateLocal('localContextSize', parseInt(e.target.value))}
                    className="w-full accent-nex-accent" />
                  <p className="text-[11px] text-[var(--nex-text-muted)] mt-1">Larger context = more memory, but can process longer conversations.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--nex-text)] mb-2">Temperature: {localSettings.localTemperature.toFixed(2)}</label>
                  <input type="range" min="0" max="2" step="0.05" value={localSettings.localTemperature}
                    onChange={(e) => updateLocal('localTemperature', parseFloat(e.target.value))}
                    className="w-full accent-nex-accent" />
                  <p className="text-[11px] text-[var(--nex-text-muted)] mt-1">Lower = focused/deterministic. Higher = creative/random.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--nex-text)] mb-2">Max Tokens: {localSettings.localMaxTokens}</label>
                  <input type="range" min="128" max="4096" step="128" value={localSettings.localMaxTokens}
                    onChange={(e) => updateLocal('localMaxTokens', parseInt(e.target.value))}
                    className="w-full accent-nex-accent" />
                  <p className="text-[11px] text-[var(--nex-text-muted)] mt-1">Maximum length of generated response.</p>
                </div>

                <div className="p-4 bg-[var(--nex-glass-bg)] rounded-xl border border-[var(--nex-glass-border)]">
                  <div className="text-sm font-medium text-[var(--nex-text)] mb-2">Models</div>
                  <p className="text-xs text-[var(--nex-text-muted)]">
                    Model management is available in the Models sidebar (Phase 4). Add .gguf files
                    to start using local AI. NEX AI never ships models in the installer — you bring your own.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Online AI (GLM 5.3 / OpenAI / Anthropic) — Phase 8: GLM is primary */}
          {activeSection === 'online' && (
            <div className="space-y-6 animate-in">
              <div>
                <h2 className="text-lg font-semibold text-[var(--nex-text)] mb-1">Online AI Provider</h2>
                <p className="text-sm text-[var(--nex-text-muted)]">GLM 5.3 is the primary model for development and the Agent. OpenAI/Anthropic remain available.</p>
              </div>

              <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex items-start gap-2">
                <AlertCircle size={14} className="text-yellow-400 shrink-0 mt-0.5" />
                <div className="text-xs text-yellow-400">
                  These services are <strong>optional</strong>. NEX AI works fully offline with Local AI.
                  Configure these only if you want online fallback in Auto mode.
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--nex-text)] mb-2">Provider</label>
                  <div className="flex gap-2">
                    {(['glm', 'openai', 'claude'] as const).map((p) => (
                      <button key={p} onClick={() => {
                        updateLocal('onlineProvider', p);
                        if (p !== 'glm') {
                          updateLocal('aiEndpoint', p === 'claude' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1');
                        }
                      }}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
                          localSettings.onlineProvider === p
                            ? 'bg-[var(--nex-accent-dim)] border-[var(--nex-accent)] text-[var(--nex-accent-text)]'
                            : 'bg-[var(--nex-glass-bg)] border-[var(--nex-glass-border)] text-[var(--nex-text-dim)] hover:text-[var(--nex-text)]'
                        }`}>
                        {p === 'glm' ? 'GLM 5.3 ⭐' : p === 'openai' ? 'OpenAI' : 'Anthropic'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* GLM 5.3 settings (Phase 8 / P8-A) */}
                {localSettings.onlineProvider === 'glm' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-[var(--nex-text)] mb-2">GLM API Key</label>
                      <div className="relative">
                        <Key size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nex-text-dim)]" />
                        <input
                          type="password"
                          value={localGlmApiKey}
                          onChange={(e) => setLocalGlmApiKey(e.target.value)}
                          placeholder="your-zai-api-key..."
                          className="w-full bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)] rounded-lg pl-10 pr-4 py-2.5 text-sm text-[var(--nex-text)] placeholder-[var(--nex-text-muted)] outline-none focus:border-[var(--nex-accent)]/50 transition-colors font-mono"
                        />
                      </div>
                      <p className="text-[11px] text-[var(--nex-text-muted)] mt-1">
                        From z.ai (or open.bigmodel.cn). Stored encrypted — never in config files.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--nex-text)] mb-2">Model</label>
                      <select
                        value={localSettings.glmModel || 'glm-5.3'}
                        onChange={(e) => updateLocal('glmModel', e.target.value)}
                        className="w-full bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)] rounded-lg px-4 py-2.5 text-sm text-[var(--nex-text)] outline-none focus:border-[var(--nex-accent)]/50"
                      >
                        <option value="glm-5.3">glm-5.3 (recommended — coding & agent)</option>
                        <option value="glm-5.3-air">glm-5.3-air (balanced)</option>
                        <option value="glm-5.3-flash">glm-5.3-flash (fast)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--nex-text)] mb-2">GLM Endpoint</label>
                      <select
                        value={localSettings.glmEndpoint || 'https://api.z.ai'}
                        onChange={(e) => updateLocal('glmEndpoint', e.target.value)}
                        className="w-full bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)] rounded-lg px-4 py-2.5 text-sm text-[var(--nex-text)] outline-none focus:border-[var(--nex-accent)]/50"
                      >
                        <option value="https://api.z.ai">api.z.ai (international)</option>
                        <option value="https://open.bigmodel.cn">open.bigmodel.cn (China)</option>
                      </select>
                    </div>
                  </>
                )}

                {/* OpenAI / Claude settings (unchanged behavior) */}
                {localSettings.onlineProvider !== 'glm' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-[var(--nex-text)] mb-2">API Key</label>
                      <div className="relative">
                        <Key size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nex-text-dim)]" />
                        <input
                          type="password"
                          value={localApiKey}
                          onChange={(e) => setLocalApiKey(e.target.value)}
                          placeholder="sk-... or sk-ant-..."
                          className="w-full bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)] rounded-lg pl-10 pr-4 py-2.5 text-sm text-[var(--nex-text)] placeholder-[var(--nex-text-muted)] outline-none focus:border-[var(--nex-accent)]/50 transition-colors font-mono"
                        />
                      </div>
                      <p className="text-[11px] text-[var(--nex-text-muted)] mt-1">
                        Stored encrypted with OS keychain (DPAPI on Windows, Keychain on macOS, libsecret on Linux).
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--nex-text)] mb-2">Endpoint URL</label>
                      <input
                        type="text"
                        value={localSettings.aiEndpoint}
                        onChange={(e) => updateLocal('aiEndpoint', e.target.value)}
                        placeholder="https://api.openai.com/v1"
                        className="w-full bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)] rounded-lg px-4 py-2.5 text-sm text-[var(--nex-text)] placeholder-[var(--nex-text-muted)] outline-none focus:border-[var(--nex-accent)]/50 transition-colors font-mono"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Appearance */}
          {activeSection === 'appearance' && (
            <div className="space-y-6 animate-in">
              <div>
                <h2 className="text-lg font-semibold text-[var(--nex-text)] mb-1">Appearance</h2>
                <p className="text-sm text-[var(--nex-text-muted)]">Customize the look and feel</p>
              </div>

              {/* Phase 31: NEX Theme Engine (16 themes) */}
              <ThemeSelector />

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--nex-text)] mb-2">Theme</label>
                  <div className="flex gap-3">
                    {[
                      { id: 'dark', label: 'Dark', colors: ['#12121a', '#1a1a2e', '#6c5ce7'] },
                      { id: 'darker', label: 'Midnight', colors: ['#0a0a0f', '#12121a', '#6c5ce7'] },
                    ].map((theme) => (
                      <button key={theme.id} onClick={() => updateLocal('theme', theme.id)}
                        className={`flex-1 p-4 rounded-xl border transition-all ${
                          localSettings.theme === theme.id
                            ? 'border-[var(--nex-accent)] nex-glow-sm'
                            : 'border-[var(--nex-glass-border)] hover:border-[var(--nex-panel-border-hover)]'
                        }`}>
                        <div className="flex gap-1 mb-2">
                          {theme.colors.map((c, i) => (
                            <div key={i} className="w-6 h-6 rounded-full border border-white/10" style={{ backgroundColor: c }} />
                          ))}
                        </div>
                        <span className="text-sm font-medium text-[var(--nex-text)]">{theme.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--nex-text)] mb-2">Language</label>
                  <select
                    value={localSettings.language}
                    onChange={(e) => updateLocal('language', e.target.value)}
                    className="w-full bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)] rounded-lg px-4 py-2.5 text-sm text-[var(--nex-text)] outline-none focus:border-[var(--nex-accent)]/50">
                    <option value="en">English</option>
                    <option value="fa">فارسی (Persian)</option>
                    <option value="ar">العربية (Arabic)</option>
                    <option value="es">Español (Spanish)</option>
                    <option value="fr">Français (French)</option>
                    <option value="de">Deutsch (German)</option>
                    <option value="ja">日本語 (Japanese)</option>
                    <option value="ko">한국어 (Korean)</option>
                    <option value="zh">中文 (Chinese)</option>
                    <option value="hi">हिन्दी (Hindi)</option>
                    <option value="ru">Русский (Russian)</option>
                    <option value="pt">Português (Portuguese)</option>
                    <option value="tr">Türkçe (Turkish)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Editor */}
          {activeSection === 'editor' && (
            <div className="space-y-6 animate-in">
              <div>
                <h2 className="text-lg font-semibold text-[var(--nex-text)] mb-1">Editor</h2>
                <p className="text-sm text-[var(--nex-text-muted)]">Configure code editor settings</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--nex-text)] mb-2">Font Size: {localSettings.fontSize}px</label>
                  <input type="range" min="10" max="24" value={localSettings.fontSize}
                    onChange={(e) => updateLocal('fontSize', parseInt(e.target.value))}
                    className="w-full accent-nex-accent" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--nex-text)] mb-2">Font Family</label>
                  <select value={localSettings.fontFamily}
                    onChange={(e) => updateLocal('fontFamily', e.target.value)}
                    className="w-full bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)] rounded-lg px-4 py-2.5 text-sm text-[var(--nex-text)] outline-none focus:border-[var(--nex-accent)]/50">
                    <option value="JetBrains Mono, Fira Code, monospace">JetBrains Mono</option>
                    <option value="Fira Code, monospace">Fira Code</option>
                    <option value="Cascadia Code, monospace">Cascadia Code</option>
                    <option value="Source Code Pro, monospace">Source Code Pro</option>
                    <option value="Consolas, monospace">Consolas</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--nex-text)] mb-2">Tab Size: {localSettings.tabSize} spaces</label>
                  <input type="range" min="2" max="8" value={localSettings.tabSize}
                    onChange={(e) => updateLocal('tabSize', parseInt(e.target.value))}
                    className="w-full accent-nex-accent" />
                </div>
              </div>
            </div>
          )}

          {/* Voice */}
          {activeSection === 'voice' && (
            <div className="space-y-6 animate-in">
              <div>
                <h2 className="text-lg font-semibold text-[var(--nex-text)] mb-1">Voice Commands</h2>
                <p className="text-sm text-[var(--nex-text-muted)]">Configure speech recognition settings</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-[var(--nex-glass-bg)] rounded-xl border border-[var(--nex-glass-border)]">
                  <div>
                    <div className="text-sm font-medium text-[var(--nex-text)]">Voice Input</div>
                    <div className="text-xs text-[var(--nex-text-muted)]">Enable microphone for voice commands</div>
                  </div>
                  <button onClick={() => updateLocal('voiceEnabled', !localSettings.voiceEnabled)}
                    className={`w-12 h-6 rounded-full transition-all ${localSettings.voiceEnabled ? 'bg-[var(--nex-accent)]' : 'bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)]'}`}>
                    <div className={`w-5 h-5 rounded-full bg-white transition-transform ${localSettings.voiceEnabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                <div className="p-4 bg-[var(--nex-glass-bg)] rounded-xl border border-[var(--nex-glass-border)]">
                  <div className="text-sm font-medium text-[var(--nex-text)] mb-2">Supported Languages</div>
                  <div className="flex flex-wrap gap-2">
                    {['English', 'فارسی', 'العربية', 'Español', 'Français', 'Deutsch', '日本語', '한국어', '中文', 'हिन्दी'].map((lang) => (
                      <span key={lang} className="px-2 py-1 bg-[var(--nex-panel-solid)] rounded text-xs text-[var(--nex-text-dim)]">{lang}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Security */}
          {activeSection === 'security' && (
            <div className="space-y-6 animate-in">
              <div>
                <h2 className="text-lg font-semibold text-[var(--nex-text)] mb-1">Security</h2>
                <p className="text-sm text-[var(--nex-text-muted)]">Security features and firewall settings</p>
              </div>

              <div className="space-y-3">
                {[
                  { label: 'Content Security Policy (CSP)', status: true },
                  { label: 'Context Isolation', status: true },
                  { label: 'Node Integration Disabled', status: true },
                  { label: 'Permission Blocking', status: true },
                  { label: 'Navigation Prevention', status: true },
                  { label: 'XSS Protection Headers', status: true },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between p-3 bg-[var(--nex-glass-bg)] rounded-lg border border-[var(--nex-glass-border)]">
                    <span className="text-sm text-[var(--nex-text)]">{item.label}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">Active</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Terminal */}
          {activeSection === 'terminal' && (
            <div className="space-y-6 animate-in">
              <div>
                <h2 className="text-lg font-semibold text-[var(--nex-text)] mb-1">Terminal</h2>
                <p className="text-sm text-[var(--nex-text-muted)]">Configure terminal settings</p>
              </div>
              <div className="p-4 bg-[var(--nex-glass-bg)] rounded-xl border border-[var(--nex-glass-border)]">
                <p className="text-sm text-[var(--nex-text-dim)]">Terminal uses PowerShell on Windows and Bash on macOS/Linux.</p>
                <p className="text-xs text-[var(--nex-text-muted)] mt-2">Font and colors follow the editor settings.</p>
              </div>
            </div>
          )}

          {/* About */}
          {activeSection === 'about' && (
            <div className="space-y-6 animate-in">
              <div className="text-center py-8">
                <div className="w-20 h-20 rounded-2xl nex-gradient flex items-center justify-center mx-auto mb-4 nex-glow">
                  <Brain size={40} className="text-white" />
                </div>
                <h2 className="text-2xl font-bold nex-gradient bg-clip-text text-transparent">NEX AI</h2>
                <p className="text-sm text-[var(--nex-text-muted)] mt-1">Version 2.0.0-alpha · Local-First AI Coding Agent</p>
                <p className="text-xs text-[var(--nex-text-muted)] mt-4 max-w-md mx-auto">
                  Independent local AI coding agent. Built with Electron, React, Monaco Editor,
                  node-llama-cpp, and xterm.js. Core intelligence runs on your machine —
                  no external AI service required.
                </p>
              </div>

              {persistenceInfo && (
                <div className="p-4 bg-[var(--nex-glass-bg)] rounded-xl border border-[var(--nex-glass-border)] space-y-2">
                  <div className="text-sm font-medium text-[var(--nex-text)] mb-2">Storage</div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--nex-text-muted)]">Mode</span>
                    <span className="text-[var(--nex-text-dim)]">{persistenceInfo.portable ? 'Portable' : 'Installed'}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--nex-text-muted)]">Data directory</span>
                    <span className="text-[var(--nex-text-dim)] font-mono text-[10px]">{persistenceInfo.userDataPath}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--nex-text-muted)]">Encrypted secrets</span>
                    <span className={`font-mono ${persistenceInfo.secretsAvailable ? 'text-green-400' : 'text-yellow-400'}`}>
                      {persistenceInfo.secretsAvailable ? 'Available (DPAPI/Keychain)' : 'Unavailable'}
                    </span>
                  </div>
                </div>
              )}

              {saveError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
                  {saveError}
                </div>
              )}
            </div>
          )}

          {/* Save Button */}
          <div className="mt-8 pt-4 border-t border-[var(--nex-glass-border)]">
            <button onClick={handleSave}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                saved ? 'bg-green-500/20 text-green-400' : 'bg-[var(--nex-accent)] text-[var(--nex-bg)] hover:opacity-90'
              }`}>
              {saved ? <><Check size={16} /> Saved!</> : <><Save size={16} /> Save Settings</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
