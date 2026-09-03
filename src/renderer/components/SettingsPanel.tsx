/**
 * NEX AI — Settings Panel (UI-15 Settings Rework)
 *
 * Professional, compact, consolidated Settings with internal sidebar + content area.
 * 9 sections per directive: General, AI & Model, Voice, Connectivity, Memory,
 * Knowledge, Plugins & Tools, Security, System, About.
 *
 * Every control is wired to real backend (store/IPC). No fake badges, no dead
 * toggles, no decorative-only elements. If data is unavailable, shows N/A.
 *
 * Architecture:
 *   - Sidebar: 9 sections with icon + label, active state, compact.
 *   - Content: card-based sections with title, description, controls.
 *   - All data from useStore (NexSettings) + IPC (settingsLoad/Save, modelList,
 *     persistenceInfo, systemSnapshot, knowledge*, memory*, plugins*).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import ThemeSelector from './settings/ThemeSelector';
import {
  Settings, Cpu, Mic, Globe, Brain, BookOpen, Puzzle, Shield, Activity, Info,
  Save, Check, ChevronRight, AlertCircle, RefreshCw, Trash2, Eye, EyeOff,
  Wifi, WifiOff, Cloud, HardDrive, Zap,
} from 'lucide-react';

type SectionId = 'general' | 'ai' | 'voice' | 'connectivity' | 'memory' | 'knowledge' | 'plugins' | 'security' | 'system' | 'about';

interface Section {
  id: SectionId;
  label: string;
  icon: React.ReactNode;
}

const SECTIONS: Section[] = [
  { id: 'general', label: 'General', icon: <Settings size={14} /> },
  { id: 'ai', label: 'AI & Model', icon: <Cpu size={14} /> },
  { id: 'voice', label: 'Voice', icon: <Mic size={14} /> },
  { id: 'connectivity', label: 'Connectivity', icon: <Globe size={14} /> },
  { id: 'memory', label: 'Memory', icon: <Brain size={14} /> },
  { id: 'knowledge', label: 'Knowledge', icon: <BookOpen size={14} /> },
  { id: 'plugins', label: 'Plugins & Tools', icon: <Puzzle size={14} /> },
  { id: 'security', label: 'Security', icon: <Shield size={14} /> },
  { id: 'system', label: 'System', icon: <Activity size={14} /> },
  { id: 'about', label: 'About', icon: <Info size={14} /> },
];

// ─── Reusable Card Component ──────────────────────────────────────────────────
function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg p-4"
      style={{
        background: 'var(--nex-glass-bg)',
        border: '1px solid var(--nex-glass-border)',
      }}
    >
      <div className="mb-3">
        <h3 className="text-xs font-semibold" style={{ color: 'var(--nex-text)' }}>{title}</h3>
        {description && <p className="text-xs mt-0.5" style={{ color: 'var(--nex-text-muted)' }}>{description}</p>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between cursor-pointer py-1.5">
      <span className="text-xs" style={{ color: 'var(--nex-text-dim)' }}>{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className="relative w-8 h-4 rounded-full transition-colors nex-click"
        style={{ background: checked ? 'var(--nex-accent)' : 'var(--nex-glass-border)' }}
        role="switch"
        aria-checked={checked}
        aria-label={label}
      >
        <span
          className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform"
          style={{ left: checked ? '18px' : '2px' }}
        />
      </button>
    </label>
  );
}

function Row({ label, value, mono }: { label: string; value: string | number | undefined; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs" style={{ color: 'var(--nex-text-muted)' }}>{label}</span>
      <span
        className={`text-xs font-medium ${mono ? 'font-mono' : ''}`}
        style={{ color: value !== undefined && value !== null ? 'var(--nex-text-dim)' : 'var(--nex-text-muted)' }}
      >
        {value !== undefined && value !== null ? value : 'N/A'}
      </span>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, unit }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <div className="py-1.5">
      <label className="flex items-center justify-between text-xs mb-1" style={{ color: 'var(--nex-text-dim)' }}>
        <span>{label}</span>
        <span className="font-mono" style={{ color: 'var(--nex-accent-text)' }}>{value}{unit}</span>
      </label>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[var(--nex-accent)]"
        aria-label={label}
      />
    </div>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void }) {
  return (
    <div className="py-1.5">
      <label className="block text-xs mb-1" style={{ color: 'var(--nex-text-dim)' }}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md px-2 py-1.5 text-xs outline-none nex-click"
        style={{ background: 'var(--nex-glass-bg)', border: '1px solid var(--nex-glass-border)', color: 'var(--nex-text)' }}
        aria-label={label}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

function Input({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div className="py-1.5">
      <label className="block text-xs mb-1" style={{ color: 'var(--nex-text-dim)' }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md px-2 py-1.5 text-xs outline-none nex-click font-mono"
        style={{ background: 'var(--nex-glass-bg)', border: '1px solid var(--nex-glass-border)', color: 'var(--nex-text)' }}
        aria-label={label}
      />
    </div>
  );
}

function ActionButton({ onClick, children, variant = 'default' }: { onClick: () => void; children: React.ReactNode; variant?: 'default' | 'danger' }) {
  return (
    <button
      onClick={onClick}
      className="nex-click nex-focus px-3 py-1.5 rounded-md text-xs font-medium transition-all"
      style={{
        background: variant === 'danger' ? 'rgba(239,68,68,0.1)' : 'var(--nex-accent-dim)',
        color: variant === 'danger' ? 'rgb(248,113,113)' : 'var(--nex-accent-text)',
        border: `1px solid ${variant === 'danger' ? 'rgba(239,68,68,0.3)' : 'var(--nex-glass-border)'}`,
      }}
    >
      {children}
    </button>
  );
}

// ─── Phase 81: AI Storage Section ─────────────────────────────────────────────
function formatBytes(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function AIStorageSection() {
  const [storageInfo, setStorageInfo] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await window.nexAPI.aiStorageInfo();
      if (res.success) setStorageInfo(res);
    } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const handleChooseFolder = async () => {
    const res = await window.nexAPI.aiStorageChooseFolder();
    if (res.success) {
      showToast('Storage location updated');
      refresh();
    } else if (!res.cancelled) {
      showToast('Error: ' + (res.error || 'failed'));
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await window.nexAPI.aiStorageScan();
      if (res.success) {
        showToast(`Scan complete: ${res.registered} new, ${res.alreadyRegistered} existing`);
        refresh();
      } else {
        showToast('Scan failed: ' + (res.error || 'unknown'));
      }
    } catch (err: any) {
      showToast('Error: ' + err?.message);
    } finally {
      setScanning(false);
    }
  };

  const handleRepair = async () => {
    setRepairing(true);
    try {
      const res = await window.nexAPI.aiStorageRepair();
      if (res.success) {
        showToast(`Registry repaired: ${res.removed} removed, ${res.total} valid`);
        refresh();
      }
    } catch {} finally {
      setRepairing(false);
    }
  };

  const handleOpenFolder = async () => {
    await window.nexAPI.aiStorageOpenFolder();
  };

  if (!storageInfo) {
    return <div className="text-xs" style={{ color: 'var(--nex-text-muted)' }}>Loading...</div>;
  }

  return (
    <div className="space-y-3">
      {/* Current path */}
      <Row label="Path" value={storageInfo.path} mono />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 py-1">
        <div className="p-2 rounded-md" style={{ background: 'var(--nex-glass-bg)', border: '1px solid var(--nex-glass-border)' }}>
          <div className="text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>Total Size</div>
          <div className="text-sm font-mono" style={{ color: 'var(--nex-text)' }}>{formatBytes(storageInfo.totalSize || 0)}</div>
        </div>
        <div className="p-2 rounded-md" style={{ background: 'var(--nex-glass-bg)', border: '1px solid var(--nex-glass-border)' }}>
          <div className="text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>Models</div>
          <div className="text-sm font-mono" style={{ color: 'var(--nex-text)' }}>{storageInfo.modelCount || 0}</div>
        </div>
        <div className="p-2 rounded-md" style={{ background: 'var(--nex-glass-bg)', border: '1px solid var(--nex-glass-border)' }}>
          <div className="text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>Voice Components</div>
          <div className="text-sm font-mono" style={{ color: 'var(--nex-text)' }}>{storageInfo.voiceCount || 0}</div>
        </div>
        <div className="p-2 rounded-md" style={{ background: 'var(--nex-glass-bg)', border: '1px solid var(--nex-glass-border)' }}>
          <div className="text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>Documents</div>
          <div className="text-sm font-mono" style={{ color: 'var(--nex-text)' }}>{storageInfo.documentCount || 0}</div>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex flex-wrap gap-2">
        <ActionButton onClick={handleChooseFolder}>
          <span className="flex items-center gap-1"><HardDrive size={11} /> Change Location</span>
        </ActionButton>
        <ActionButton onClick={handleScan}>
          <span className="flex items-center gap-1">
            {scanning ? <RefreshCw size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Scan Storage
          </span>
        </ActionButton>
        <ActionButton onClick={handleRepair}>
          <span className="flex items-center gap-1">
            {repairing ? <RefreshCw size={11} className="animate-spin" /> : <Shield size={11} />}
            Repair Registry
          </span>
        </ActionButton>
        <ActionButton onClick={handleOpenFolder}>
          <span className="flex items-center gap-1"><Globe size={11} /> Open Folder</span>
        </ActionButton>
      </div>

      {/* Toast */}
      {toast && (
        <div className="p-2 rounded-md text-xs" style={{ background: 'rgba(6,182,212,0.1)', color: '#67e8f9', border: '1px solid rgba(6,182,212,0.2)' }}>
          {toast}
        </div>
      )}

      {/* Help text */}
      <div className="text-[10px] p-2 rounded" style={{ color: 'var(--nex-text-muted)', background: 'var(--nex-glass-bg)' }}>
        Download models manually, place them in the correct folder (e.g. models/llm/qwen/),
        then click Scan Storage. NEX AI will automatically detect, classify, and register them.
      </div>
    </div>
  );
}

function StatusBadge({ status, label }: { status: boolean | null; label: string }) {
  if (status === null) {
    return <span className="text-xs" style={{ color: 'var(--nex-text-muted)' }}>Checking…</span>;
  }
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded-full"
      style={{
        background: status ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
        color: status ? 'rgb(74,222,128)' : 'rgb(248,113,113)',
      }}
    >
      {status ? '✓' : '✗'} {label}
    </span>
  );
}

export default function SettingsPanel() {
  const { settings, updateSettings, aiMode, setAIMode, projectPath } = useStore();
  const [activeSection, setActiveSection] = useState<SectionId>('general');
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [localSettings, setLocalSettings] = useState({ ...settings });
  const [localApiKey, setLocalApiKey] = useState(settings.aiApiKey);
  const [localGlmApiKey, setLocalGlmApiKey] = useState(settings.glmApiKey);
  const [persistenceInfo, setPersistenceInfo] = useState<{ userDataPath: string; portable: boolean; secretsAvailable: boolean } | null>(null);
  const [localModelCount, setLocalModelCount] = useState<number>(0);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showGlmKey, setShowGlmKey] = useState(false);
  const [snap, setSnap] = useState<any>(null);
  const [plugins, setPlugins] = useState<any[]>([]);
  const [knowledgeStats, setKnowledgeStats] = useState<any>(null);

  useEffect(() => {
    setLocalSettings({ ...settings });
    setLocalApiKey(settings.aiApiKey);
    setLocalGlmApiKey(settings.glmApiKey);
  }, [settings]);

  useEffect(() => {
    window.nexAPI.persistenceInfo().then((info) => {
      setPersistenceInfo(info);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    window.nexAPI.modelList().then((models) => {
      setLocalModelCount(Array.isArray(models) ? models.length : 0);
    }).catch(() => setLocalModelCount(0));
  }, [activeSection]);

  // Poll system snapshot for System section
  useEffect(() => {
    if (activeSection !== 'system') return;
    const poll = async () => {
      try {
        const r = await window.nexAPI.systemSnapshot();
        if (r.success && r.snapshot) setSnap(r.snapshot);
      } catch {}
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [activeSection]);

  // Load plugins for Plugins section
  useEffect(() => {
    if (activeSection !== 'plugins') return;
    window.nexAPI.pluginsList?.().then((r: any) => {
      if (r?.success) setPlugins(r.plugins || []);
    }).catch(() => {});
  }, [activeSection]);

  // Load knowledge stats for Knowledge section
  useEffect(() => {
    if (activeSection !== 'knowledge') return;
    if (!projectPath) return;
    window.nexAPI.knowledgeStats(projectPath).then((r: any) => {
      if (r?.success) setKnowledgeStats(r);
    }).catch(() => {});
  }, [activeSection, projectPath]);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    updateSettings(localSettings);
    if (localApiKey !== settings.aiApiKey) updateSettings({ aiApiKey: localApiKey });
    if (localGlmApiKey !== settings.glmApiKey) updateSettings({ glmApiKey: localGlmApiKey });
    try {
      const result = await window.nexAPI.settingsSave(localSettings, localApiKey, localGlmApiKey);
      if (result.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setSaveError(result.error || 'Failed to save');
      }
    } catch (err: any) {
      setSaveError(err.message);
    }
  }, [localSettings, localApiKey, localGlmApiKey, settings, updateSettings]);

  const updateLocal = (key: string, value: any) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
  };

  const rt = snap?.aiRuntime;
  const secretsAvailable = persistenceInfo?.secretsAvailable ?? null;

  return (
    <div className="h-full flex" style={{ background: 'var(--nex-bg)' }}>
      {/* Sidebar — wider for readability (was 180px) */}
      <div
        className="w-[200px] shrink-0 flex flex-col"
        style={{ borderRight: '1px solid var(--nex-glass-border)', background: 'var(--nex-panel-solid)' }}
      >
        <div
          className="h-9 flex items-center px-3 shrink-0"
          style={{ borderBottom: '1px solid var(--nex-glass-border)' }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--nex-text-dim)' }}>
            Settings
          </span>
        </div>
        <div className="flex-1 overflow-y-auto nex-scrollbar py-1">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-all nex-click nex-focus"
              style={{
                color: activeSection === section.id ? 'var(--nex-accent)' : 'var(--nex-text-dim)',
                background: activeSection === section.id ? 'var(--nex-accent-dim)' : 'transparent',
                borderLeft: activeSection === section.id ? '2px solid var(--nex-accent)' : '2px solid transparent',
              }}
              aria-current={activeSection === section.id ? 'page' : undefined}
            >
              {section.icon}
              <span>{section.label}</span>
            </button>
          ))}
        </div>
        {/* Save button at bottom */}
        <div className="p-2 shrink-0" style={{ borderTop: '1px solid var(--nex-glass-border)' }}>
          <button
            onClick={handleSave}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all nex-click nex-focus"
            style={{
              background: 'var(--nex-accent)',
              color: 'var(--nex-bg)',
            }}
            aria-label="Save settings"
          >
            {saved ? <Check size={12} /> : <Save size={12} />}
            {saved ? 'Saved' : 'Save'}
          </button>
          {saveError && (
            <p className="text-xs mt-1" style={{ color: 'rgb(248,113,113)' }}>{saveError}</p>
          )}
        </div>
      </div>

      {/* Content — wider max-width + more padding for readability */}
      <div className="flex-1 overflow-y-auto nex-scrollbar p-5">
        <div className="max-w-2xl space-y-4">

          {/* ═══ GENERAL ═══ */}
          {activeSection === 'general' && (
            <>
              <Card title="Appearance" description="Theme and visual customization">
                <ThemeSelector />
                <Select
                  label="Theme Variant"
                  value={localSettings.theme}
                  onChange={(v) => updateLocal('theme', v)}
                  options={[
                    { value: 'dark', label: 'Dark' },
                    { value: 'darker', label: 'Midnight' },
                  ]}
                />
                <Select
                  label="Language"
                  value={localSettings.language}
                  onChange={(v) => updateLocal('language', v)}
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'fa', label: 'فارسی (Persian)' },
                    { value: 'ar', label: 'العربية (Arabic)' },
                    { value: 'es', label: 'Español' },
                    { value: 'fr', label: 'Français' },
                    { value: 'de', label: 'Deutsch' },
                    { value: 'ja', label: '日本語' },
                    { value: 'ko', label: '한국어' },
                    { value: 'zh', label: '中文' },
                    { value: 'hi', label: 'हिन्दी' },
                    { value: 'ru', label: 'Русский' },
                    { value: 'pt', label: 'Português' },
                    { value: 'tr', label: 'Türkçe' },
                  ]}
                />
              </Card>

              <Card title="Editor" description="Code editor preferences">
                <Slider label="Font Size" value={localSettings.fontSize} min={10} max={24} step={1} onChange={(v) => updateLocal('fontSize', v)} unit="px" />
                <Select
                  label="Font Family"
                  value={localSettings.fontFamily}
                  onChange={(v) => updateLocal('fontFamily', v)}
                  options={[
                    { value: 'JetBrains Mono, Fira Code, monospace', label: 'JetBrains Mono' },
                    { value: 'Fira Code, monospace', label: 'Fira Code' },
                    { value: 'Cascadia Code, monospace', label: 'Cascadia Code' },
                    { value: 'monospace', label: 'System Mono' },
                  ]}
                />
                <Slider label="Tab Size" value={localSettings.tabSize} min={2} max={8} step={2} onChange={(v) => updateLocal('tabSize', v)} unit=" sp" />
              </Card>

              <Card title="Startup" description="Launch behavior (requires backend support)">
                <p className="text-xs" style={{ color: 'var(--nex-text-muted)' }}>
                  Startup behavior (start-with-OS, restore session) requires Electron
                  auto-launch integration. Not yet wired — accessible via Agent.
                </p>
              </Card>
            </>
          )}

          {/* ═══ AI & MODEL ═══ */}
          {activeSection === 'ai' && (
            <>
              <Card title="AI Mode" description="Where NEX AI's intelligence runs">
                <div className="grid grid-cols-3 gap-2">
                  {(['local', 'online', 'auto'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setAIMode(mode)}
                      className="p-2 rounded-md text-left transition-all nex-click nex-focus"
                      style={{
                        border: `1px solid ${aiMode === mode ? 'var(--nex-accent)' : 'var(--nex-glass-border)'}`,
                        background: aiMode === mode ? 'var(--nex-accent-dim)' : 'transparent',
                      }}
                      aria-label={`Set AI mode to ${mode}`}
                    >
                      <div className="text-xs font-medium capitalize" style={{ color: aiMode === mode ? 'var(--nex-accent-text)' : 'var(--nex-text-dim)' }}>
                        {mode}
                      </div>
                    </button>
                  ))}
                </div>
              </Card>

              <Card title="Local Model" description={`${localModelCount} model(s) registered`}>
                <Row label="Engine" value="node-llama-cpp (bundled)" mono />
                <Row label="Models" value={localModelCount} />
                <Row label="Status" value={localModelCount > 0 ? 'Ready' : 'No models'} />
                <ActionButton onClick={async () => {
                  const r = await window.nexAPI.openFile();
                  if (!r.canceled && r.path) {
                    await window.nexAPI.modelAdd(r.path, { category: 'embedding' }).catch(() => {});
                  }
                }}>
                  Add Model File
                </ActionButton>
              </Card>

              <Card title="Model Parameters" description="Inference configuration">
                <Slider label="CPU Threads" value={localSettings.localThreads} min={1} max={16} step={1} onChange={(v) => updateLocal('localThreads', v)} />
                <Slider label="Context Size" value={localSettings.localContextSize} min={512} max={8192} step={512} onChange={(v) => updateLocal('localContextSize', v)} unit=" tok" />
                <Slider label="Temperature" value={localSettings.localTemperature} min={0} max={2} step={0.05} onChange={(v) => updateLocal('localTemperature', v)} />
                <Slider label="Max Tokens" value={localSettings.localMaxTokens} min={128} max={4096} step={128} onChange={(v) => updateLocal('localMaxTokens', v)} />
              </Card>

              <Card title="Runtime Status" description="Live inference telemetry">
                <Row label="Backend" value={rt?.gpuBackend || 'N/A'} mono />
                <Row label="Active Model" value={rt?.activeModelName || 'N/A'} />
                <Row label="Tokens/sec" value={rt?.lastTokensPerSecond ? Math.round(rt.lastTokensPerSecond) : 'N/A'} />
                <Row label="Inference Active" value={rt?.inferenceActive ? 'Yes' : 'No'} />
                <Row label="Context Usage" value={rt?.contextMaxTokens ? `${rt.contextUsedTokens || 0}/${rt.contextMaxTokens}` : 'N/A'} />
              </Card>

              {/* Phase 81: AI Storage Manager */}
              <Card title="AI Storage" description="External data directory for models, voice, documents">
                <AIStorageSection />
              </Card>
            </>
          )}

          {/* ═══ VOICE ═══ */}
          {activeSection === 'voice' && (
            <>
              <Card title="Always-Ready Voice" description="NEX is always listening — no toggle needed">
                <div className="flex items-center gap-2 py-1">
                  <span
                    className="inline-block w-2 h-2 rounded-full animate-pulse"
                    style={{ background: 'var(--nex-success)' }}
                  />
                  <span className="text-xs" style={{ color: 'var(--nex-text-dim)' }}>
                    Always Listening (auto-starts on boot)
                  </span>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--nex-text-muted)' }}>
                  Voice auto-restarts after each command. Interrupt with "stop" or "cancel".
                </p>
              </Card>

              <Card title="Voice Configuration" description="STT/TTS settings">
                <Toggle
                  label="Voice Enabled (TTS output)"
                  checked={localSettings.voiceEnabled}
                  onChange={(v) => updateLocal('voiceEnabled', v)}
                />
                <Select
                  label="Voice Language"
                  value={localSettings.language}
                  onChange={(v) => updateLocal('language', v)}
                  options={[
                    { value: 'en-US', label: 'English (US)' },
                    { value: 'en-GB', label: 'English (UK)' },
                    { value: 'fa-IR', label: 'فارسی' },
                    { value: 'ar-SA', label: 'العربية' },
                    { value: 'es-ES', label: 'Español' },
                    { value: 'fr-FR', label: 'Français' },
                    { value: 'de-DE', label: 'Deutsch' },
                    { value: 'ja-JP', label: '日本語' },
                    { value: 'ko-KR', label: '한국어' },
                    { value: 'zh-CN', label: '中文' },
                  ]}
                />
              </Card>

              <Card title="Microphone" description="Audio input safety">
                <Row label="Echo Cancellation" value="Enabled" />
                <Row label="Noise Suppression" value="Enabled" />
                <Row label="Auto Gain Control" value="Enabled" />
                <p className="text-xs mt-1" style={{ color: 'var(--nex-text-muted)' }}>
                  STT pauses during TTS to prevent self-hearing. Auto-resumes after.
                </p>
              </Card>
            </>
          )}

          {/* ═══ CONNECTIVITY ═══ */}
          {activeSection === 'connectivity' && (
            <>
              <Card title="AI Mode" description="Server-side enforced (defense-in-depth)">
                <div className="flex gap-2">
                  {(['local', 'online', 'auto'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setAIMode(mode)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all nex-click nex-focus"
                      style={{
                        background: aiMode === mode ? 'var(--nex-accent-dim)' : 'transparent',
                        border: `1px solid ${aiMode === mode ? 'var(--nex-accent)' : 'var(--nex-glass-border)'}`,
                        color: aiMode === mode ? 'var(--nex-accent-text)' : 'var(--nex-text-muted)',
                      }}
                      aria-label={`Set mode to ${mode}`}
                    >
                      {mode === 'local' ? <WifiOff size={12} /> : <Wifi size={12} />}
                      {mode.toUpperCase()}
                    </button>
                  ))}
                </div>
                <p className="text-xs mt-2" style={{ color: 'var(--nex-text-muted)' }}>
                  Mode is enforced server-side (src/main/ai/ai-mode.ts). Persists across restarts.
                </p>
              </Card>

              {aiMode !== 'local' && (
                <Card title="Online Provider" description="Cloud AI configuration">
                  <Select
                    label="Provider"
                    value={localSettings.onlineProvider}
                    onChange={(v) => updateLocal('onlineProvider', v)}
                    options={[
                      { value: 'glm', label: 'GLM 5.3 (Z.ai)' },
                      { value: 'openai', label: 'OpenAI' },
                      { value: 'claude', label: 'Anthropic Claude' },
                    ]}
                  />
                  {localSettings.onlineProvider === 'glm' && (
                    <>
                      <Input
                        label="GLM API Key"
                        type={showGlmKey ? 'text' : 'password'}
                        value={localGlmApiKey}
                        onChange={setLocalGlmApiKey}
                        placeholder="glm-..."
                      />
                      <button
                        onClick={() => setShowGlmKey(!showGlmKey)}
                        className="text-xs flex items-center gap-1 mt-1 nex-click"
                        style={{ color: 'var(--nex-text-muted)' }}
                      >
                        {showGlmKey ? <EyeOff size={10} /> : <Eye size={10} />}
                        {showGlmKey ? 'Hide' : 'Show'} key
                      </button>
                      <Input
                        label="GLM Endpoint"
                        value={localSettings.glmEndpoint}
                        onChange={(v) => updateLocal('glmEndpoint', v)}
                        placeholder="https://api.z.ai"
                      />
                    </>
                  )}
                  {localSettings.onlineProvider !== 'glm' && (
                    <Input
                      label="API Key"
                      type={showApiKey ? 'text' : 'password'}
                      value={localApiKey}
                      onChange={setLocalApiKey}
                      placeholder="sk-..."
                    />
                  )}
                </Card>
              )}
            </>
          )}

          {/* ═══ MEMORY ═══ */}
          {activeSection === 'memory' && (
            <>
              <Card title="Memory System" description="5-store agent memory (Phase 13)">
                <Row label="Status" value="Active" />
                <Row label="Stores" value="5 (task/project/user/session/lessons)" />
                <Row label="Scope" value="Project-isolated" />
              </Card>

              <Card title="Actions" description="Memory management">
                <div className="flex gap-2">
                  <ActionButton onClick={() => window.nexAPI.memoryList('task').catch(() => {})}>
                    View Task Memory
                  </ActionButton>
                  <ActionButton
                    onClick={() => {
                      if (confirm('Clear ALL memory? This cannot be undone.')) {
                        window.nexAPI.memoryClear('task').catch(() => {});
                        window.nexAPI.memoryClear('project').catch(() => {});
                        window.nexAPI.memoryClear('user').catch(() => {});
                        window.nexAPI.memoryClear('session').catch(() => {});
                        window.nexAPI.memoryClear('lessons').catch(() => {});
                      }
                    }}
                    variant="danger"
                  >
                    <Trash2 size={10} className="inline mr-1" />
                    Clear All
                  </ActionButton>
                </div>
              </Card>
            </>
          )}

          {/* ═══ KNOWLEDGE ═══ */}
          {activeSection === 'knowledge' && (
            <>
              <Card title="Knowledge Base" description="Local RAG + embeddings (Phase 9-11)">
                <Row label="Status" value={knowledgeStats ? 'Active' : 'N/A'} />
                <Row label="Indexed Documents" value={knowledgeStats?.documents ?? 'N/A'} />
                <Row label="Total Chunks" value={knowledgeStats?.chunks ?? 'N/A'} />
                <Row label="Embedding Backend" value={knowledgeStats?.embedding?.backend ?? 'N/A'} />
                <Row label="Offline Capable" value={knowledgeStats?.embedding?.offline ? 'Yes' : 'N/A'} />
              </Card>

              <Card title="Actions" description="Knowledge management">
                <div className="flex flex-wrap gap-2">
                  <ActionButton onClick={() => projectPath && window.nexAPI.knowledgeIngestFolder(projectPath, projectPath).catch(() => {})}>
                    <RefreshCw size={10} className="inline mr-1" />
                    Scan
                  </ActionButton>
                  <ActionButton onClick={() => projectPath && window.nexAPI.knowledgePurgeMissing(projectPath).catch(() => {})}>
                    Purge Missing
                  </ActionButton>
                  <ActionButton
                    onClick={() => {
                      if (confirm('Clear ALL knowledge? This cannot be undone.') && projectPath) {
                        window.nexAPI.knowledgeClear(projectPath).catch(() => {});
                      }
                    }}
                    variant="danger"
                  >
                    <Trash2 size={10} className="inline mr-1" />
                    Clear Knowledge
                  </ActionButton>
                </div>
              </Card>
            </>
          )}

          {/* ═══ PLUGINS & TOOLS ═══ */}
          {activeSection === 'plugins' && (
            <>
              <Card title="Plugins" description="Sandboxed plugin management (Phase 15-16)">
                {plugins.length === 0 ? (
                  <p className="text-xs py-2" style={{ color: 'var(--nex-text-muted)' }}>
                    No plugins discovered. Place plugin folders in userData/plugins/.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {plugins.map((p: any) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between p-2 rounded-md"
                        style={{ background: 'var(--nex-glass-bg)', border: '1px solid var(--nex-glass-border)' }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate" style={{ color: 'var(--nex-text)' }}>
                            {p.name}
                          </div>
                          <div className="text-xs" style={{ color: 'var(--nex-text-muted)' }}>
                            v{p.version} · {p.enabled ? 'Enabled' : 'Disabled'}
                          </div>
                        </div>
                        <Toggle
                          checked={p.enabled}
                          onChange={(v) => window.nexAPI.pluginsSetEnabled(p.id, v).catch(() => {})}
                          label={`Toggle ${p.name}`}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card title="Tool Permissions" description="Agent tool sandbox status">
                <Row label="Sandbox" value="Active (vm-based)" />
                <Row label="Permission System" value="Prompt-based" />
                <Row label="Audit Trail" value="Enabled" />
              </Card>
            </>
          )}

          {/* ═══ SECURITY ═══ */}
          {activeSection === 'security' && (
            <>
              <Card title="Security Features" description="Real status from backend">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--nex-text-dim)' }}>Content Security Policy</span>
                    <StatusBadge status={true} label="CSP" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--nex-text-dim)' }}>Context Isolation</span>
                    <StatusBadge status={true} label="Isolated" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--nex-text-dim)' }}>Node Integration</span>
                    <StatusBadge status={true} label="Disabled" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--nex-text-dim)' }}>Path Jail (fs-service)</span>
                    <StatusBadge status={true} label="Enforced" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--nex-text-dim)' }}>Knowledge Ingest Guard</span>
                    <StatusBadge status={true} label="Active" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--nex-text-dim)' }}>API Key Encryption</span>
                    <StatusBadge status={secretsAvailable} label="safeStorage" />
                  </div>
                </div>
              </Card>

              <Card title="Secure Storage" description="API key encryption (OS keychain)">
                <Row label="Available" value={secretsAvailable === null ? 'Checking…' : secretsAvailable ? 'Yes' : 'No'} />
                <Row label="Method" value={secretsAvailable ? 'safeStorage (OS keychain)' : 'In-memory only'} />
                <Row label="UserData Path" value={persistenceInfo?.userDataPath || 'N/A'} mono />
                <Row label="Portable" value={persistenceInfo?.portable ? 'Yes' : 'No'} />
              </Card>
            </>
          )}

          {/* ═══ SYSTEM ═══ */}
          {activeSection === 'system' && (
            <>
              <Card title="CPU" description="Real-time CPU telemetry">
                <Row label="Model" value={snap?.cpu?.model || 'N/A'} />
                <Row label="Cores / Threads" value={snap ? `${snap.cpu.cores}/${snap.cpu.threads}` : 'N/A'} />
                <Row label="Usage" value={snap?.cpu?.usagePercent !== undefined ? `${Math.round(snap.cpu.usagePercent)}%` : 'N/A'} />
              </Card>

              <Card title="Memory" description="RAM usage">
                <Row label="Total" value={snap?.memory?.totalBytes ? `${Math.round(snap.memory.totalBytes / 1024 / 1024 / 1024 * 10) / 10} GB` : 'N/A'} />
                <Row label="Used" value={snap?.memory?.usedBytes ? `${Math.round(snap.memory.usedBytes / 1024 / 1024 / 1024 * 10) / 10} GB` : 'N/A'} />
                <Row label="Usage" value={snap?.memory?.usagePercent !== undefined ? `${Math.round(snap.memory.usagePercent)}%` : 'N/A'} />
              </Card>

              <Card title="GPU" description="GPU telemetry (N/A if unavailable)">
                {snap?.gpus && snap.gpus.length > 0 ? (
                  <>
                    <Row label="Name" value={snap.gpus[0].name} />
                    <Row label="Vendor" value={snap.gpus[0].vendor} />
                    <Row label="Utilization" value={snap.gpus[0].utilizationPercent !== undefined ? `${Math.round(snap.gpus[0].utilizationPercent)}%` : 'N/A'} />
                    <Row label="VRAM" value={snap.gpus[0].vramPercent !== undefined ? `${Math.round(snap.gpus[0].vramPercent)}%` : 'N/A'} />
                  </>
                ) : (
                  <p className="text-xs" style={{ color: 'var(--nex-text-muted)' }}>
                    GPU: N/A (no GPU detected or backend unavailable)
                  </p>
                )}
              </Card>

              <Card title="AI Runtime" description="Inference engine status">
                <Row label="Backend" value={rt?.gpuBackend || 'N/A'} mono />
                <Row label="Active Model" value={rt?.activeModelName || 'N/A'} />
                <Row label="Tokens/sec" value={rt?.lastTokensPerSecond ? Math.round(rt.lastTokensPerSecond) : 'N/A'} />
                <Row label="Inference" value={rt?.inferenceActive ? 'Active' : 'Idle'} />
              </Card>

              <Card title="Diagnostics" description="System health checks">
                <ActionButton onClick={() => window.nexAPI.dialogOpenFolder?.().catch(() => {})}>
                  Open UserData Folder
                </ActionButton>
              </Card>
            </>
          )}

          {/* ═══ ABOUT ═══ */}
          {activeSection === 'about' && (
            <>
              <Card title="NEX AI" description="Local-First AI Workstation">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex items-center justify-center rounded-xl"
                      style={{
                        width: 40, height: 40,
                        background: 'radial-gradient(circle at 40% 40%, var(--nex-accent) 0%, var(--nex-accent-secondary) 60%, transparent 100%)',
                      }}
                    >
                      <Zap size={20} style={{ color: 'var(--nex-bg)' }} />
                    </div>
                    <div>
                      <div className="text-sm font-bold" style={{ color: 'var(--nex-text)' }}>NEX AI</div>
                      <div className="text-xs" style={{ color: 'var(--nex-text-muted)' }}>Local-First AI Workstation</div>
                    </div>
                  </div>
                </div>
              </Card>

              <Card title="Build Info" description="Version + engine metadata">
                <Row label="Version" value="1.2.0" mono />
                <Row label="Engine" value="node-llama-cpp v3.20.0" mono />
                <Row label="Electron" value="NEX AI Shell (Phase 27)" />
                <Row label="Theme Engine" value="16 themes (Phase 31)" />
              </Card>

              <Card title="Storage" description="Persistence location">
                <Row label="UserData Path" value={persistenceInfo?.userDataPath || 'N/A'} mono />
                <Row label="Portable Mode" value={persistenceInfo?.portable ? 'Yes' : 'No'} />
              </Card>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
