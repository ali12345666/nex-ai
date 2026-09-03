/**
 * NEX AI — Voice Manager Panel
 *
 * Full voice system lifecycle UI:
 *   detect → setup → activate → listen → transcribe → respond → speak
 *
 * Shows:
 *   - Component detection status (whisper binary/model, piper binary/voice)
 *   - Activate/Deactivate button
 *   - Voice mode selector (push-to-talk / wake-word / continuous)
 *   - Language selector
 *   - STT model selector (whisper models found on disk)
 *   - TTS voice selector (piper voices found on disk)
 *   - Conversation start/stop controls
 *   - Live conversation state + orb color indicator
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Mic, MicOff, Volume2, VolumeX, Radio, Zap, Ear, EarOff,
  RefreshCw, CheckCircle2, XCircle, AlertCircle, Loader2, Power,
} from 'lucide-react';

interface VoiceComponentStatus {
  whisperBinary: string | null;
  whisperBinaryFound: boolean;
  whisperModel: string | null;
  whisperModelFound: boolean;
  whisperModels: Array<{ name: string; path: string; sizeBytes: number }>;
  piperBinary: string | null;
  piperBinaryFound: boolean;
  piperVoice: string | null;
  piperVoiceFound: boolean;
  piperVoices: Array<{ name: string; path: string; sizeBytes: number }>;
  sttReady: boolean;
  ttsReady: boolean;
  activated: boolean;
  conversationActive: boolean;
  mode: 'push-to-talk' | 'wake-word' | 'continuous';
  wakeWordEnabled: boolean;
  missingComponents: string[];
}

export default function VoiceManagerPanel() {
  const [status, setStatus] = useState<VoiceComponentStatus | null>(null);
  const [loading, setLoading] = useState<'detect' | 'activate' | 'mode' | 'conversation' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conversationState, setConversationState] = useState<string>('idle');
  const [orbColor, setOrbColor] = useState<string>('#3b82f6');

  const refresh = useCallback(async () => {
    setLoading('detect');
    setError(null);
    try {
      const res = await window.nexAPI.voiceManagerStatus();
      if (res.success && res.status) {
        setStatus(res.status as VoiceComponentStatus);
      } else {
        // Try detect if status not available
        const detectRes = await window.nexAPI.voiceManagerDetect();
        if (detectRes.success && detectRes.status) {
          setStatus(detectRes.status as VoiceComponentStatus);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to get voice status');
    } finally {
      setLoading(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Subscribe to conversation state changes
    const offState = window.nexAPI.onVoiceConversationState?.((ev: any) => {
      setConversationState(ev.state || 'idle');
      if (ev.orbColor) setOrbColor(ev.orbColor);
    });
    const interval = setInterval(refresh, 5000); // auto-refresh every 5s
    return () => {
      clearInterval(interval);
      if (offState) offState();
    };
  }, [refresh]);

  const handleActivate = async () => {
    setLoading('activate');
    setError(null);
    try {
      const res = await window.nexAPI.voiceManagerActivate();
      if (!res.success) {
        setError(res.error || 'Activation failed');
      } else if (res.missingComponents && res.missingComponents.length > 0) {
        setError(`Missing components: ${res.missingComponents.join(', ')}. Install them in Library → Components.`);
      }
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Activation failed');
    } finally {
      setLoading(null);
    }
  };

  const handleDeactivate = async () => {
    setLoading('activate');
    setError(null);
    try {
      await window.nexAPI.voiceManagerDeactivate();
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Deactivation failed');
    } finally {
      setLoading(null);
    }
  };

  const handleSetMode = async (mode: string) => {
    setLoading('mode');
    setError(null);
    try {
      await window.nexAPI.voiceManagerSetMode(mode);
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to set mode');
    } finally {
      setLoading(null);
    }
  };

  const handleToggleConversation = async () => {
    setLoading('conversation');
    setError(null);
    try {
      const res = await window.nexAPI.voiceManagerToggleConversation();
      if (!res.success) {
        setError(res.error || 'Failed to toggle conversation');
      }
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to toggle conversation');
    } finally {
      setLoading(null);
    }
  };

  const handleSetSTTModel = async (modelPath: string) => {
    setLoading('mode');
    try {
      await window.nexAPI.voiceManagerSetSTTModel(modelPath);
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to set STT model');
    } finally {
      setLoading(null);
    }
  };

  const handleSetTTSVoice = async (voicePath: string) => {
    setLoading('mode');
    try {
      await window.nexAPI.voiceManagerSetTTSVoice(voicePath);
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to set TTS voice');
    } finally {
      setLoading(null);
    }
  };

  const handleSetLanguage = async (language: string) => {
    setLoading('mode');
    try {
      await window.nexAPI.voiceManagerSetLanguage(language);
    } catch (err: any) {
      setError(err?.message || 'Failed to set language');
    } finally {
      setLoading(null);
    }
  };

  const fmtSize = (bytes: number): string => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const StatusIcon = ({ ok }: { ok: boolean }) => ok
    ? <CheckCircle2 size={14} style={{ color: '#22c55e' }} />
    : <XCircle size={14} style={{ color: '#ef4444' }} />;

  if (!status) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin" size={20} style={{ color: 'var(--nex-accent)' }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        <div className="flex items-center gap-2">
          <Mic size={16} style={{ color: 'var(--nex-accent)' }} />
          <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
            VOICE MANAGER
          </span>
          {status.activated ? (
            <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: '#86efac' }}>
              <Power size={8} /> Active
            </span>
          ) : (
            <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(100,116,139,0.15)', color: '#94a3b8' }}>
              <Power size={8} /> Inactive
            </span>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={loading === 'detect'}
          className="p-1 rounded transition-colors hover:bg-white/[0.06] disabled:opacity-50"
          style={{ color: 'var(--nex-text-muted)' }}
          title="Refresh"
        >
          <RefreshCw size={12} className={loading === 'detect' ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto nex-scroll p-4 space-y-4" style={{ maxHeight: 'calc(100vh - 120px)' }}>

        {error && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto shrink-0 hover:opacity-70">
              <XCircle size={12} />
            </button>
          </div>
        )}

        {/* Activation Control */}
        <div className="p-3 rounded-lg" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium" style={{ color: 'var(--nex-text)' }}>Activation</span>
            {status.activated ? (
              <button
                onClick={handleDeactivate}
                disabled={loading === 'activate'}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors"
                style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                {loading === 'activate' ? <Loader2 size={10} className="animate-spin" /> : <Power size={10} />}
                Deactivate
              </button>
            ) : (
              <button
                onClick={handleActivate}
                disabled={loading === 'activate' || (!status.sttReady && !status.ttsReady)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors disabled:opacity-50"
                style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}
              >
                {loading === 'activate' ? <Loader2 size={10} className="animate-spin" /> : <Power size={10} />}
                Activate
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="flex items-center gap-1.5">
              <StatusIcon ok={status.sttReady} />
              <span style={{ color: 'var(--nex-text-muted)' }}>STT (Whisper)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <StatusIcon ok={status.ttsReady} />
              <span style={{ color: 'var(--nex-text-muted)' }}>TTS (Piper)</span>
            </div>
          </div>
          {status.missingComponents.length > 0 && (
            <div className="mt-2 text-[10px] p-2 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: '#fcd34d' }}>
              Missing: {status.missingComponents.join(', ')}
              <br />
              <span style={{ opacity: 0.7 }}>Install in Library → Components</span>
            </div>
          )}
        </div>

        {/* Voice Mode Selector */}
        <div className="p-3 rounded-lg" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)' }}>
          <span className="text-[11px] font-medium mb-2 block" style={{ color: 'var(--nex-text)' }}>Voice Mode</span>
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: 'push-to-talk', label: 'Push to Talk', icon: <Zap size={12} /> },
              { id: 'wake-word', label: 'Wake Word', icon: <Ear size={12} /> },
              { id: 'continuous', label: 'Continuous', icon: <Radio size={12} /> },
            ] as const).map((m) => (
              <button
                key={m.id}
                onClick={() => handleSetMode(m.id)}
                disabled={loading === 'mode'}
                className="flex flex-col items-center gap-1 p-2 rounded-lg text-[10px] transition-colors disabled:opacity-50"
                style={
                  status.mode === m.id
                    ? { background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }
                    : { background: 'rgba(255,255,255,0.03)', color: 'var(--nex-text-muted)', border: '1px solid var(--nex-panel-border)' }
                }
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Conversation Control */}
        <div className="p-3 rounded-lg" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium" style={{ color: 'var(--nex-text)' }}>Conversation</span>
            <button
              onClick={handleToggleConversation}
              disabled={loading === 'conversation' || !status.activated}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors disabled:opacity-50"
              style={
                status.conversationActive
                  ? { background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }
                  : { background: 'rgba(34,197,94,0.15)', color: '#86efac', border: '1px solid rgba(34,197,94,0.3)' }
              }
            >
              {loading === 'conversation' ? <Loader2 size={10} className="animate-spin" /> : status.conversationActive ? <MicOff size={10} /> : <Mic size={10} />}
              {status.conversationActive ? 'Stop' : 'Start'}
            </button>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ background: orbColor, boxShadow: `0 0 8px ${orbColor}` }}
            />
            <span style={{ color: 'var(--nex-text-muted)' }}>State: {conversationState}</span>
          </div>
        </div>

        {/* STT Model Selector */}
        <div className="p-3 rounded-lg" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)' }}>
          <span className="text-[11px] font-medium mb-2 block" style={{ color: 'var(--nex-text)' }}>
            STT Model (Whisper)
          </span>
          {status.whisperModels.length === 0 ? (
            <div className="text-[10px] flex items-center gap-1.5" style={{ color: 'var(--nex-text-muted)' }}>
              <XCircle size={12} style={{ color: '#ef4444' }} />
              No models found in &lt;userData&gt;/models/whisper/
            </div>
          ) : (
            <select
              className="w-full text-[10px] p-1.5 rounded-lg nex-focus"
              style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }}
              value={status.whisperModel || ''}
              onChange={(e) => handleSetSTTModel(e.target.value)}
            >
              {status.whisperModels.map((m) => (
                <option key={m.path} value={m.path}>
                  {m.name} ({fmtSize(m.sizeBytes)})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* TTS Voice Selector */}
        <div className="p-3 rounded-lg" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)' }}>
          <span className="text-[11px] font-medium mb-2 block" style={{ color: 'var(--nex-text)' }}>
            TTS Voice (Piper)
          </span>
          {status.piperVoices.length === 0 ? (
            <div className="text-[10px] flex items-center gap-1.5" style={{ color: 'var(--nex-text-muted)' }}>
              <XCircle size={12} style={{ color: '#ef4444' }} />
              No voices found in &lt;userData&gt;/models/piper/
            </div>
          ) : (
            <select
              className="w-full text-[10px] p-1.5 rounded-lg nex-focus"
              style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }}
              value={status.piperVoice || ''}
              onChange={(e) => handleSetTTSVoice(e.target.value)}
            >
              {status.piperVoices.map((v) => (
                <option key={v.path} value={v.path}>
                  {v.name} ({fmtSize(v.sizeBytes)})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Language Selector */}
        <div className="p-3 rounded-lg" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)' }}>
          <span className="text-[11px] font-medium mb-2 block" style={{ color: 'var(--nex-text)' }}>Language</span>
          <select
            className="w-full text-[10px] p-1.5 rounded-lg nex-focus"
            style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }}
            defaultValue="auto"
            onChange={(e) => handleSetLanguage(e.target.value)}
          >
            <option value="auto">Auto-detect</option>
            <option value="en">English (en)</option>
            <option value="fa">فارسی (fa)</option>
            <option value="ar">العربية (ar)</option>
            <option value="zh">中文 (zh)</option>
            <option value="es">Español (es)</option>
            <option value="fr">Français (fr)</option>
            <option value="de">Deutsch (de)</option>
            <option value="ru">Русский (ru)</option>
            <option value="ja">日本語 (ja)</option>
          </select>
        </div>

        {/* Component Detection Details */}
        <div className="p-3 rounded-lg" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)' }}>
          <span className="text-[11px] font-medium mb-2 block" style={{ color: 'var(--nex-text)' }}>
            Component Detection
          </span>
          <div className="space-y-1.5 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5" style={{ color: 'var(--nex-text-muted)' }}>
                <StatusIcon ok={status.whisperBinaryFound} /> Whisper Binary
              </span>
              <span className="truncate ml-2 max-w-[180px]" style={{ color: 'var(--nex-text-muted)' }} title={status.whisperBinary || ''}>
                {status.whisperBinary || 'not found'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5" style={{ color: 'var(--nex-text-muted)' }}>
                <StatusIcon ok={status.whisperModelFound} /> Whisper Model
              </span>
              <span className="truncate ml-2 max-w-[180px]" style={{ color: 'var(--nex-text-muted)' }} title={status.whisperModel || ''}>
                {status.whisperModel || 'not found'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5" style={{ color: 'var(--nex-text-muted)' }}>
                <StatusIcon ok={status.piperBinaryFound} /> Piper Binary
              </span>
              <span className="truncate ml-2 max-w-[180px]" style={{ color: 'var(--nex-text-muted)' }} title={status.piperBinary || ''}>
                {status.piperBinary || 'not found'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5" style={{ color: 'var(--nex-text-muted)' }}>
                <StatusIcon ok={status.piperVoiceFound} /> Piper Voice
              </span>
              <span className="truncate ml-2 max-w-[180px]" style={{ color: 'var(--nex-text-muted)' }} title={status.piperVoice || ''}>
                {status.piperVoice || 'not found'}
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
