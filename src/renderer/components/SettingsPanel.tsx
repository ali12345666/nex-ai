import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
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
} from 'lucide-react';

interface SettingsSection {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const sections: SettingsSection[] = [
  { id: 'ai', label: 'AI Provider', icon: <Brain size={16} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={16} /> },
  { id: 'editor', label: 'Editor', icon: <Type size={16} /> },
  { id: 'terminal', label: 'Terminal', icon: <Terminal size={16} /> },
  { id: 'voice', label: 'Voice', icon: <Mic size={16} /> },
  { id: 'security', label: 'Security', icon: <Shield size={16} /> },
  { id: 'about', label: 'About', icon: <Info size={16} /> },
];

export default function SettingsPanel() {
  const { settings, updateSettings } = useStore();
  const [activeSection, setActiveSection] = useState('ai');
  const [saved, setSaved] = useState(false);
  const [localSettings, setLocalSettings] = useState({ ...settings });

  useEffect(() => {
    setLocalSettings({ ...settings });
  }, [settings]);

  const handleSave = () => {
    updateSettings(localSettings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const updateLocal = (key: string, value: any) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="h-full flex bg-nex-bg animate-in">
      {/* Sidebar */}
      <div className="w-[220px] border-r border-nex-border bg-nex-surface shrink-0">
        <div className="h-10 flex items-center px-4 border-b border-nex-border/50">
          <span className="text-xs font-semibold text-nex-text-dim uppercase tracking-wider">Settings</span>
        </div>
        <div className="py-2">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-all ${
                activeSection === section.id
                  ? 'text-nex-accent bg-nex-accent/10 border-r-2 border-r-nex-accent'
                  : 'text-nex-text-dim hover:text-nex-text hover:bg-nex-card'
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
          {/* AI Provider */}
          {activeSection === 'ai' && (
            <div className="space-y-6 animate-in">
              <div>
                <h2 className="text-lg font-semibold text-nex-text mb-1">AI Provider</h2>
                <p className="text-sm text-nex-text-muted">Configure your AI model and API credentials</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-nex-text mb-2">Provider</label>
                  <div className="flex gap-2">
                    {['openai', 'claude', 'custom'].map((p) => (
                      <button key={p} onClick={() => updateLocal('aiEndpoint', p === 'claude' ? 'https://api.anthropic.com/v1' : p === 'custom' ? '' : 'https://api.openai.com/v1')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
                          localSettings.aiEndpoint.includes(p === 'openai' ? 'openai' : p === 'claude' ? 'anthropic' : 'custom')
                            ? 'bg-nex-accent/20 border-nex-accent text-nex-accent-light'
                            : 'bg-nex-card border-nex-border text-nex-text-dim hover:text-nex-text'
                        }`}>
                        {p === 'openai' ? 'OpenAI' : p === 'claude' ? 'Claude' : 'Custom'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-nex-text mb-2">API Key</label>
                  <div className="relative">
                    <Key size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-nex-text-dim" />
                    <input
                      type="password"
                      value={localSettings.aiApiKey}
                      onChange={(e) => updateLocal('aiApiKey', e.target.value)}
                      placeholder="sk-... or sk-ant-..."
                      className="w-full bg-nex-card border border-nex-border rounded-lg pl-10 pr-4 py-2.5 text-sm text-nex-text placeholder-nex-text-muted outline-none focus:border-nex-accent/50 transition-colors font-mono"
                    />
                  </div>
                  <p className="text-[11px] text-nex-text-muted mt-1">Your API key is stored locally and never sent to our servers</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-nex-text mb-2">Endpoint URL</label>
                  <input
                    type="text"
                    value={localSettings.aiEndpoint}
                    onChange={(e) => updateLocal('aiEndpoint', e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className="w-full bg-nex-card border border-nex-border rounded-lg px-4 py-2.5 text-sm text-nex-text placeholder-nex-text-muted outline-none focus:border-nex-accent/50 transition-colors font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Appearance */}
          {activeSection === 'appearance' && (
            <div className="space-y-6 animate-in">
              <div>
                <h2 className="text-lg font-semibold text-nex-text mb-1">Appearance</h2>
                <p className="text-sm text-nex-text-muted">Customize the look and feel</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-nex-text mb-2">Theme</label>
                  <div className="flex gap-3">
                    {[
                      { id: 'dark', label: 'Dark', colors: ['#12121a', '#1a1a2e', '#6c5ce7'] },
                      { id: 'darker', label: 'Midnight', colors: ['#0a0a0f', '#12121a', '#6c5ce7'] },
                    ].map((theme) => (
                      <button key={theme.id} onClick={() => updateLocal('theme', theme.id)}
                        className={`flex-1 p-4 rounded-xl border transition-all ${
                          localSettings.theme === theme.id
                            ? 'border-nex-accent glow-accent'
                            : 'border-nex-border hover:border-nex-border-light'
                        }`}>
                        <div className="flex gap-1 mb-2">
                          {theme.colors.map((c, i) => (
                            <div key={i} className="w-6 h-6 rounded-full border border-white/10" style={{ backgroundColor: c }} />
                          ))}
                        </div>
                        <span className="text-sm font-medium text-nex-text">{theme.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-nex-text mb-2">Language</label>
                  <select
                    value={localSettings.language}
                    onChange={(e) => updateLocal('language', e.target.value)}
                    className="w-full bg-nex-card border border-nex-border rounded-lg px-4 py-2.5 text-sm text-nex-text outline-none focus:border-nex-accent/50">
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
                <h2 className="text-lg font-semibold text-nex-text mb-1">Editor</h2>
                <p className="text-sm text-nex-text-muted">Configure code editor settings</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-nex-text mb-2">Font Size: {localSettings.fontSize}px</label>
                  <input type="range" min="10" max="24" value={localSettings.fontSize}
                    onChange={(e) => updateLocal('fontSize', parseInt(e.target.value))}
                    className="w-full accent-nex-accent" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-nex-text mb-2">Font Family</label>
                  <select value={localSettings.fontFamily}
                    onChange={(e) => updateLocal('fontFamily', e.target.value)}
                    className="w-full bg-nex-card border border-nex-border rounded-lg px-4 py-2.5 text-sm text-nex-text outline-none focus:border-nex-accent/50">
                    <option value="JetBrains Mono, Fira Code, monospace">JetBrains Mono</option>
                    <option value="Fira Code, monospace">Fira Code</option>
                    <option value="Cascadia Code, monospace">Cascadia Code</option>
                    <option value="Source Code Pro, monospace">Source Code Pro</option>
                    <option value="Consolas, monospace">Consolas</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-nex-text mb-2">Tab Size: {localSettings.tabSize} spaces</label>
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
                <h2 className="text-lg font-semibold text-nex-text mb-1">Voice Commands</h2>
                <p className="text-sm text-nex-text-muted">Configure speech recognition settings</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-nex-card rounded-xl border border-nex-border">
                  <div>
                    <div className="text-sm font-medium text-nex-text">Voice Input</div>
                    <div className="text-xs text-nex-text-muted">Enable microphone for voice commands</div>
                  </div>
                  <button onClick={() => updateLocal('voiceEnabled', !localSettings.voiceEnabled)}
                    className={`w-12 h-6 rounded-full transition-all ${localSettings.voiceEnabled ? 'bg-nex-accent' : 'bg-nex-card border border-nex-border'}`}>
                    <div className={`w-5 h-5 rounded-full bg-white transition-transform ${localSettings.voiceEnabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                <div className="p-4 bg-nex-card rounded-xl border border-nex-border">
                  <div className="text-sm font-medium text-nex-text mb-2">Supported Languages</div>
                  <div className="flex flex-wrap gap-2">
                    {['English', 'فارسی', 'العربية', 'Español', 'Français', 'Deutsch', '日本語', '한국어', '中文', 'हिन्दी'].map((lang) => (
                      <span key={lang} className="px-2 py-1 bg-nex-surface rounded text-xs text-nex-text-dim">{lang}</span>
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
                <h2 className="text-lg font-semibold text-nex-text mb-1">Security</h2>
                <p className="text-sm text-nex-text-muted">Security features and firewall settings</p>
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
                  <div key={item.label} className="flex items-center justify-between p-3 bg-nex-card rounded-lg border border-nex-border">
                    <span className="text-sm text-nex-text">{item.label}</span>
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
                <h2 className="text-lg font-semibold text-nex-text mb-1">Terminal</h2>
                <p className="text-sm text-nex-text-muted">Configure terminal settings</p>
              </div>
              <div className="p-4 bg-nex-card rounded-xl border border-nex-border">
                <p className="text-sm text-nex-text-dim">Terminal uses PowerShell on Windows and Bash on macOS/Linux.</p>
                <p className="text-xs text-nex-text-muted mt-2">Font and colors follow the editor settings.</p>
              </div>
            </div>
          )}

          {/* About */}
          {activeSection === 'about' && (
            <div className="space-y-6 animate-in">
              <div className="text-center py-8">
                <div className="w-20 h-20 rounded-2xl nex-gradient flex items-center justify-center mx-auto mb-4 glow-accent-strong">
                  <Brain size={40} className="text-white" />
                </div>
                <h2 className="text-2xl font-bold nex-gradient bg-clip-text text-transparent">NEX AI</h2>
                <p className="text-sm text-nex-text-muted mt-1">Version 1.0.0</p>
                <p className="text-xs text-nex-text-muted mt-4 max-w-md mx-auto">
                  Advanced AI-Powered Code Assistant. Built with Electron, React, Monaco Editor, and xterm.js.
                </p>
              </div>
            </div>
          )}

          {/* Save Button */}
          <div className="mt-8 pt-4 border-t border-nex-border">
            <button onClick={handleSave}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                saved ? 'bg-green-500/20 text-green-400' : 'bg-nex-accent text-white hover:bg-nex-accent-light'
              }`}>
              {saved ? <><Check size={16} /> Saved!</> : <><Save size={16} /> Save Settings</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
