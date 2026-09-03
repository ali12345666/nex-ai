/**
 * NEX AI — Basic Interaction Status Panel (Phase 62)
 *
 * Shows the MVP interaction status: active model, runtime status, STT/TTS
 * status, current language, and a text input to test the interaction loop.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity, RefreshCw, Send, Mic, Volume2, Cpu, Zap, Globe, ShieldCheck,
  AlertCircle, CheckCircle2, XCircle, Loader2, Square,
} from 'lucide-react';

function formatBytes(n: number): string {
  if (!n) return '—';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function BasicInteractionPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [textInput, setTextInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastResponse, setLastResponse] = useState<any>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.nexAPI.interactionStatus();
      if (res.success) setStatus(res.status);
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  const showToast = (kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const sendText = async () => {
    if (!textInput.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await window.nexAPI.interactionProcessText({ text: textInput, speakResponse: false });
      if (res.success && res.result?.success) {
        setLastResponse(res.result);
        showToast('ok', 'پاسخ دریافت شد');
      } else {
        setError(res.error || res.result?.error || 'خطا در پردازش');
        if (res.result) setLastResponse(res.result);
      }
      await refresh();
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setBusy(false);
    }
  };

  const speakResponse = async () => {
    if (!lastResponse?.response) return;
    setBusy(true);
    try {
      await window.nexAPI.interactionSpeak(lastResponse.response);
      showToast('ok', 'در حال پخش صدا');
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    await window.nexAPI.interactionStop();
    showToast('ok', 'متوقف شد');
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        <div className="flex items-center gap-2">
          <Activity size={16} style={{ color: 'var(--nex-accent)' }} />
          <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
            INTERACTION
          </span>
          {status?.modelReady ? (
            <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: '#86efac' }}>
              <CheckCircle2 size={8} /> آماده
            </span>
          ) : (
            <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}>
              <XCircle size={8} /> مدل موجود نیست
            </span>
          )}
        </div>
        <button onClick={refresh} disabled={loading} className="p-1 rounded transition-colors hover:bg-white/[0.06] disabled:opacity-50" style={{ color: 'var(--nex-text-muted)' }}>
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

        {/* Status grid */}
        {status && (
          <div className="p-3 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
            <div className="grid grid-cols-2 gap-3 text-[10px]">
              {/* Active model */}
              <div className="flex items-center gap-2">
                <Cpu size={12} style={{ color: status.modelReady ? 'var(--nex-accent)' : '#ef4444' }} />
                <div>
                  <div style={{ color: 'var(--nex-text-muted)' }}>مدل فعال</div>
                  <div className="font-medium truncate" style={{ color: 'var(--nex-text)', maxWidth: 140 }}>
                    {status.modelName || 'نصب نشده'}
                  </div>
                </div>
              </div>
              {/* Runtime / GPU */}
              <div className="flex items-center gap-2">
                <Zap size={12} style={{ color: 'var(--nex-accent)' }} />
                <div>
                  <div style={{ color: 'var(--nex-text-muted)' }}>GPU</div>
                  <div className="font-medium" style={{ color: 'var(--nex-text)' }}>{status.gpuBackend}</div>
                </div>
              </div>
              {/* STT */}
              <div className="flex items-center gap-2">
                <Mic size={12} style={{ color: status.sttReady ? 'var(--nex-success)' : '#64748b' }} />
                <div>
                  <div style={{ color: 'var(--nex-text-muted)' }}>تشخیص گفتار</div>
                  <div className="font-medium" style={{ color: status.sttReady ? 'var(--nex-success)' : 'var(--nex-text-muted)' }}>
                    {status.sttReady ? 'آماده' : 'نصب نیست'}
                  </div>
                </div>
              </div>
              {/* TTS */}
              <div className="flex items-center gap-2">
                <Volume2 size={12} style={{ color: status.ttsReady ? 'var(--nex-success)' : '#64748b' }} />
                <div>
                  <div style={{ color: 'var(--nex-text-muted)' }}>تولید گفتار</div>
                  <div className="font-medium" style={{ color: status.ttsReady ? 'var(--nex-success)' : 'var(--nex-text-muted)' }}>
                    {status.ttsReady ? 'آماده' : 'نصب نیست'}
                  </div>
                </div>
              </div>
              {/* Language */}
              <div className="flex items-center gap-2">
                <Globe size={12} style={{ color: 'var(--nex-accent)' }} />
                <div>
                  <div style={{ color: 'var(--nex-text-muted)' }}>زبان اخیر</div>
                  <div className="font-medium" style={{ color: 'var(--nex-text)' }}>{status.lastLanguageLabelFa || 'نامشخص'}</div>
                </div>
              </div>
              {/* Tokens/sec */}
              <div className="flex items-center gap-2">
                <Activity size={12} style={{ color: 'var(--nex-accent)' }} />
                <div>
                  <div style={{ color: 'var(--nex-text-muted)' }}>توکن/ثانیه</div>
                  <div className="font-medium" style={{ color: 'var(--nex-text)' }}>
                    {status.lastTokensPerSecond ? status.lastTokensPerSecond.toFixed(1) : '—'}
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2 text-[9px]" style={{ color: 'var(--nex-text-muted)' }}>
              <span>حجم مدل: {formatBytes(status.modelSizeBytes)}</span>
              <span>•</span>
              <span>تعاملات: {status.totalInteractions}</span>
              {status.inferenceActive && <><span>•</span><span style={{ color: '#06b6d4' }}>استنتاج فعال</span></>}
            </div>
          </div>
        )}

        {/* Text input */}
        <div className="p-2.5 rounded-lg nex-glass" style={{ border: '1px solid var(--nex-panel-border)' }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Send size={11} style={{ color: 'var(--nex-accent)' }} />
            <span className="text-[10px] font-medium tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>تست تعامل متنی</span>
          </div>
          <div className="flex gap-1.5">
            <input value={textInput} onChange={(e) => setTextInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && textInput.trim()) sendText(); }}
              placeholder="سوال خود را بنویسید..." className="flex-1 px-2 py-1.5 rounded-lg text-[11px] nex-focus" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }} />
            <button onClick={sendText} disabled={busy || !textInput.trim()} className="nex-click nex-focus flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium disabled:opacity-50" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }}>
              {busy ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />} ارسال
            </button>
            {status?.inferenceActive && (
              <button onClick={stop} className="nex-click nex-focus flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}>
                <Square size={10} /> توقف
              </button>
            )}
          </div>
        </div>

        {/* Last response */}
        {lastResponse && (
          <div className="p-2.5 rounded-lg nex-glass" style={{ border: `1px solid ${lastResponse.success ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
            <div className="flex items-center gap-1.5 mb-2">
              {lastResponse.success ? <CheckCircle2 size={11} style={{ color: 'var(--nex-success)' }} /> : <XCircle size={11} style={{ color: '#fca5a5' }} />}
              <span className="text-[10px] font-medium" style={{ color: 'var(--nex-text)' }}>پاسخ NEX</span>
              {lastResponse.success && (
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)' }}>
                    {lastResponse.responseLanguage === 'fa' ? 'فارسی' : 'English'}
                  </span>
                  {lastResponse.tokensPerSecond > 0 && (
                    <span className="text-[8px]" style={{ color: 'var(--nex-text-muted)' }}>{lastResponse.tokensPerSecond.toFixed(1)} tok/s</span>
                  )}
                  {status?.ttsReady && lastResponse.success && (
                    <button onClick={speakResponse} disabled={busy} className="nex-click nex-focus p-0.5 rounded" style={{ color: 'var(--nex-accent)' }} title="پخش صدا">
                      <Volume2 size={10} />
                    </button>
                  )}
                </div>
              )}
            </div>
            {lastResponse.response ? (
              <p className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--nex-text)' }}>
                {lastResponse.response}
              </p>
            ) : (
              <p className="text-[10px]" style={{ color: '#fca5a5' }}>{lastResponse.error || 'خطا'}</p>
            )}
          </div>
        )}

        {/* Security note */}
        <div className="p-2 rounded-lg text-[9px] flex items-start gap-1.5" style={{ background: 'rgba(34,197,94,0.06)', color: 'var(--nex-text-muted)' }}>
          <ShieldCheck size={10} className="mt-0.5 shrink-0" style={{ color: 'var(--nex-success)' }} />
          <span>تمام پردازش محلی و آفلاین است. استنتاج با node-llama-cpp، گفتار با whisper.cpp و piper. بدون API ابری.</span>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-3 left-3 right-3 p-2 rounded-lg text-[11px] nex-animate-in pointer-events-none" style={{
          background: toast.kind === 'ok' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
          color: toast.kind === 'ok' ? '#86efac' : '#fca5a5',
          border: `1px solid ${toast.kind === 'ok' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          zIndex: 25,
        }}>{toast.msg}</div>
      )}
    </div>
  );
}
