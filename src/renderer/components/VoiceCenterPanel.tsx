/**
 * NEX AI — Voice Center Panel (Phase 56)
 *
 * Shows the advanced voice conversation system status:
 *   - Microphone / wake-word status
 *   - Current conversation state (idle/listening/thinking/speaking/interrupted)
 *   - Orb color indicator (idle→blue, listening→green, thinking→purple, speaking→cyan, error→red)
 *   - Conversation context (previous topic, current task, turn count)
 *   - Personality selector
 *   - Recent turns
 *   - Natural speech control buttons (stop / resume / cancel)
 *
 * All actions go through IPC → main → NexVoiceConversation. The panel never
 * touches the microphone or audio directly.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Mic, MicOff, Radio, Brain, Volume2, VolumeX, Play, Square, RotateCw,
  RefreshCw, Sparkles, AlertCircle, MessageCircle, Clock, Tag,
  ShieldCheck, Loader2, Zap, Pause,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────

type ConversationState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'interrupted';
type PersonalityType = 'professional' | 'technical' | 'friendly' | 'patient';

interface ConversationContext {
  currentUtterance: string;
  previousUtterance: string;
  currentTopic: string | null;
  previousTopic: string | null;
  currentTask: string | null;
  turnCount: number;
  startedAt: number;
  lastActivityAt: number;
  pendingPermission: boolean;
}

interface ConversationTurn {
  role: 'user' | 'nex';
  text: string;
  timestamp: number;
  state: ConversationState;
}

interface ConversationStatus {
  state: ConversationState;
  active: boolean;
  wakeWordEnabled: boolean;
  context: ConversationContext;
  recentTurns: ConversationTurn[];
  personality: PersonalityType;
  orbColor: string;
}

// State → icon + label + color (mirrors the Phase 56 spec orb mapping)
const STATE_META: Record<ConversationState | 'error', { label: string; labelFa: string; color: string; icon: React.ReactNode }> = {
  idle:         { label: 'Idle',         labelFa: 'آماده',          color: '#3b82f6', icon: <Radio size={14} /> },     // blue
  listening:    { label: 'Listening',    labelFa: 'در حال شنیدن',   color: '#22c55e', icon: <Mic size={14} /> },       // green
  thinking:     { label: 'Thinking',     labelFa: 'در حال تفکر',    color: '#8b5cf6', icon: <Brain size={14} /> },     // purple
  speaking:     { label: 'Speaking',     labelFa: 'در حال صحبت',    color: '#06b6d4', icon: <Volume2 size={14} /> },  // cyan
  interrupted:  { label: 'Interrupted',  labelFa: 'قطع شد',         color: '#f59e0b', icon: <Pause size={14} /> },     // amber
  error:        { label: 'Error',        labelFa: 'خطا',            color: '#ef4444', icon: <AlertCircle size={14} /> }, // red
};

const PERSONALITIES: Array<{ id: PersonalityType; label: string; labelFa: string }> = [
  { id: 'professional', label: 'Professional', labelFa: 'حرفه‌ای (تحلیل شده و دقیق)' },
  { id: 'technical', label: 'Technical', labelFa: 'فنی (جزئیات کامل)' },
  { id: 'friendly', label: 'Friendly', labelFa: 'دوستانه (محترمانه و ساده)' },
  { id: 'patient', label: 'Patient', labelFa: 'صبور (توضیح دقیق)' },
];

// ─── Component ──────────────────────────────────────────────────────────────

export default function VoiceCenterPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ConversationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [testInput, setTestInput] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.nexAPI.voiceConversationStatus();
      if (res.success) setStatus(res.status || null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load voice status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Subscribe to live state changes
  useEffect(() => {
    const unsub = window.nexAPI.onVoiceConversationState(() => {
      refresh();
    });
    return unsub;
  }, [refresh]);

  useEffect(() => {
    const unsub = window.nexAPI.onVoiceConversationError((ev: any) => {
      setError(ev?.message || 'Voice error');
    });
    return unsub;
  }, []);

  const showToast = (kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Actions ──

  const toggle = async () => {
    setBusy(true);
    try {
      const res = await window.nexAPI.voiceConversationToggle();
      if (!res.success) setError(res.error || 'Toggle failed');
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Toggle failed');
    } finally {
      setBusy(false);
    }
  };

  const startTurn = async () => {
    setBusy(true);
    try {
      const res = await window.nexAPI.voiceConversationStartTurn(testInput || undefined);
      if (res.success) { showToast('ok', 'گفتگو شروع شد'); setTestInput(''); }
      else setError(res.error || 'Start failed');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const stopSpeaking = async () => {
    await window.nexAPI.voiceConversationStopSpeaking();
    showToast('ok', 'صحبت متوقف شد');
    refresh();
  };

  const abort = async () => {
    await window.nexAPI.voiceConversationAbort();
    showToast('ok', 'لغو شد');
    refresh();
  };

  const reset = async () => {
    await window.nexAPI.voiceConversationReset();
    showToast('ok', 'بازنشانی شد');
    refresh();
  };

  const setPersonality = async (p: PersonalityType) => {
    const res = await window.nexAPI.voiceConversationSetPersonality(p);
    if (res.success) showToast('ok', 'شخصیت تغییر کرد');
    refresh();
  };

  const toggleWake = async () => {
    if (status?.wakeWordEnabled) {
      await window.nexAPI.voiceConversationDisableWakeWord();
      showToast('ok', 'واک‌ورد غیرفعال شد');
    } else {
      await window.nexAPI.voiceConversationEnableWakeWord();
      showToast('ok', 'واک‌ورد فعال شد');
    }
    refresh();
  };

  const feedTest = async () => {
    if (!testInput.trim()) return;
    await window.nexAPI.voiceConversationFeed(testInput);
    setTestInput('');
    refresh();
  };

  // ── Render ──

  const currentState = status?.state || 'idle';
  const meta = STATE_META[currentState] || STATE_META.idle;
  const orbColor = status?.orbColor || meta.color;
  const active = status?.active || false;

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        <div className="flex items-center gap-2">
          <Mic size={16} style={{ color: 'var(--nex-accent)' }} />
          <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
            VOICE CENTER
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>
            {active ? 'فعال' : 'غیرفعال'}
          </span>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="p-1 rounded transition-colors hover:bg-white/[0.06] disabled:opacity-50"
          style={{ color: 'var(--nex-text-muted)' }}
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto nex-scroll p-3 space-y-3" style={{ maxHeight: 'calc(100vh - 180px)' }}>
        {error && (
          <div className="flex items-start gap-2 p-2 rounded-lg text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* State + Orb indicator */}
        <div className="p-3 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
          <div className="flex items-center gap-3">
            {/* Orb indicator (live color) */}
            <div
              className="rounded-full flex items-center justify-center shrink-0 nex-animate-breathe"
              style={{
                width: 44, height: 44,
                background: `radial-gradient(circle at 40% 40%, ${orbColor} 0%, ${orbColor}88 60%, transparent 100%)`,
                boxShadow: `0 0 20px ${orbColor}66`,
                border: `1px solid ${orbColor}44`,
              }}
            >
              <span style={{ color: '#fff' }}>{meta.icon}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium" style={{ color: 'var(--nex-text)' }}>
                {meta.labelFa}
              </div>
              <div className="text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>
                State: {currentState} • Orb: <span style={{ color: orbColor }}>{orbColor}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Conversation controls */}
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={toggle}
            disabled={busy}
            className="nex-click nex-focus flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium disabled:opacity-50"
            style={{ background: active ? 'rgba(239,68,68,0.15)' : 'var(--nex-accent-dim)', color: active ? '#fca5a5' : 'var(--nex-accent-text)', border: active ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--nex-accent-glow)' }}
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : active ? <MicOff size={11} /> : <Mic size={11} />}
            {active ? 'متوقف' : 'شروع'}
          </button>
          <button
            onClick={stopSpeaking}
            className="nex-click nex-focus flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium"
            style={{ background: 'transparent', color: 'var(--nex-text-muted)', border: '1px solid var(--nex-panel-border)' }}
            title="توقف صحبت (صبر کن)"
          >
            <VolumeX size={11} /> صبر کن
          </button>
          <button
            onClick={abort}
            className="nex-click nex-focus flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium"
            style={{ background: 'transparent', color: 'var(--nex-text-muted)', border: '1px solid var(--nex-panel-border)' }}
            title="لغو نوبت"
          >
            <Square size={11} /> لغو
          </button>
          <button
            onClick={reset}
            className="nex-click nex-focus flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium"
            style={{ background: 'transparent', color: 'var(--nex-text-muted)', border: '1px solid var(--nex-panel-border)' }}
            title="بازنشانی"
          >
            <RotateCw size={11} /> بازنشانی
          </button>
        </div>

        {/* Wake word + Personality */}
        <div className="p-2.5 rounded-lg nex-glass space-y-2" style={{ border: '1px solid var(--nex-panel-border)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Radio size={11} style={{ color: status?.wakeWordEnabled ? 'var(--nex-success)' : 'var(--nex-text-muted)' }} />
              <span className="text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>واک‌ورد (سلام NEX)</span>
            </div>
            <button
              onClick={toggleWake}
              className="nex-click nex-focus px-2 py-0.5 rounded text-[9px] font-medium"
              style={{
                background: status?.wakeWordEnabled ? 'var(--nex-accent-dim)' : 'transparent',
                color: status?.wakeWordEnabled ? 'var(--nex-accent-text)' : 'var(--nex-text-muted)',
                border: '1px solid var(--nex-panel-border)',
              }}
            >
              {status?.wakeWordEnabled ? 'روشن' : 'خاموش'}
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 shrink-0">
              <Sparkles size={11} style={{ color: 'var(--nex-accent)' }} />
              <span className="text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>شخصیت</span>
            </div>
            <select
              value={status?.personality || 'professional'}
              onChange={(e) => setPersonality(e.target.value as PersonalityType)}
              className="flex-1 px-1.5 py-0.5 rounded text-[10px] nex-focus"
              style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }}
            >
              {PERSONALITIES.map((p) => (
                <option key={p.id} value={p.id}>{p.labelFa}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Conversation context */}
        {status?.context && (
          <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
            <div className="flex items-center gap-1.5 mb-2">
              <MessageCircle size={11} style={{ color: 'var(--nex-text-muted)' }} />
              <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>
                زمینه گفتگو
              </span>
              <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>
                نوبت {status.context.turnCount}
              </span>
            </div>
            <div className="space-y-1.5 text-[10px]">
              <ContextRow icon={<Tag size={9} />} label="موضوع فعلی" value={status.context.currentTopic} />
              <ContextRow icon={<Tag size={9} />} label="موضوع قبلی" value={status.context.previousTopic} />
              <ContextRow icon={<Clock size={9} />} label="وخته اخیر" value={status.context.currentUtterance} />
              <ContextRow icon={<Clock size={9} />} label="وخته قبلی" value={status.context.previousUtterance} />
            </div>
            {status.context.pendingPermission && (
              <div className="mt-2 p-1.5 rounded flex items-center gap-1.5 text-[10px]" style={{ background: 'rgba(245,158,11,0.1)', color: '#fcd34d' }}>
                <ShieldCheck size={10} />
                <span>در انتظار تأیید اجازه صوتی...</span>
              </div>
            )}
          </div>
        )}

        {/* Recent turns */}
        {status?.recentTurns && status.recentTurns.length > 0 && (
          <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Zap size={11} style={{ color: 'var(--nex-accent)' }} />
              <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>
                گفتگوهای اخیر
              </span>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto nex-scroll">
              {status.recentTurns.slice().reverse().map((turn, i) => (
                <div key={i} className="text-[10px] p-1.5 rounded" style={{
                  background: turn.role === 'user' ? 'var(--nex-accent-dim)' : 'transparent',
                  border: `1px solid ${turn.role === 'user' ? 'var(--nex-accent-glow)' : 'var(--nex-panel-border)'}`,
                }}>
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-[9px] font-bold" style={{ color: turn.role === 'user' ? 'var(--nex-accent-text)' : 'var(--nex-text-muted)' }}>
                      {turn.role === 'user' ? 'کاربر' : 'NEX'}
                    </span>
                    <span className="text-[8px]" style={{ color: 'var(--nex-text-muted)' }}>
                      {new Date(turn.timestamp).toLocaleTimeString('fa-IR')}
                    </span>
                  </div>
                  <p style={{ color: 'var(--nex-text)' }}>{turn.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Test input (simulate a transcript) */}
        <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Play size={11} style={{ color: 'var(--nex-text-muted)' }} />
            <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>
              تست ورودی متنی
            </span>
          </div>
          <div className="flex gap-1.5">
            <input
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && testInput.trim()) feedTest(); }}
              placeholder="مثلاً: سلام NEX یک مدار طراحی کن"
              className="flex-1 px-2 py-1 rounded-lg text-[11px] nex-focus"
              style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }}
            />
            <button
              onClick={feedTest}
              disabled={!testInput.trim()}
              className="nex-click nex-focus px-2 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50"
              style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}
            >
              ارسال
            </button>
            <button
              onClick={startTurn}
              disabled={busy}
              className="nex-click nex-focus px-2 py-1 rounded-lg text-[10px] font-medium disabled:opacity-50"
              style={{ background: 'transparent', color: 'var(--nex-text-muted)', border: '1px solid var(--nex-panel-border)' }}
              title="شروع نوبت"
            >
              <Play size={10} />
            </button>
          </div>
          <p className="text-[9px] mt-1.5" style={{ color: 'var(--nex-text-muted)' }}>
            دستورات صوتی: «صبر کن» / «ادامه بده» / «متوقف شو» / «تکرار کن»
          </p>
        </div>

        {/* Security note */}
        <div className="p-2 rounded-lg text-[9px] flex items-start gap-1.5" style={{ background: 'rgba(34,197,94,0.06)', color: 'var(--nex-text-muted)' }}>
          <ShieldCheck size={10} className="mt-0.5 shrink-0" style={{ color: 'var(--nex-success)' }} />
          <span>
            تمام پردازش صوتی محلی است (Whisper + Piper). صدا هرگز آپلود نمی‌شود. عملیات حساس نیازمند تأیید صوتی صریح است.
          </span>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-3 left-3 right-3 p-2 rounded-lg text-[11px] nex-animate-in pointer-events-none" style={{
          background: toast.kind === 'ok' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
          color: toast.kind === 'ok' ? '#86efac' : '#fca5a5',
          border: `1px solid ${toast.kind === 'ok' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          zIndex: 25,
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function ContextRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="mt-0.5" style={{ color: 'var(--nex-text-muted)' }}>{icon}</span>
      <span className="shrink-0" style={{ color: 'var(--nex-text-muted)' }}>{label}:</span>
      <span className="truncate" style={{ color: value ? 'var(--nex-text)' : 'var(--nex-text-muted)', opacity: value ? 1 : 0.5 }}>
        {value || '—'}
      </span>
    </div>
  );
}
