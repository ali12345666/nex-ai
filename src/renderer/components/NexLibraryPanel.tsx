/**
 * NEX AI — Unified Library Panel (Professional Redesign)
 *
 * A single unified Library page with 6 tabs:
 *   1. Models — browse + download all available models
 *   2. Installed — manage installed models (activate/remove)
 *   3. Downloads — download manager with progress + controls
 *   4. Extensions — voice components + tools
 *   5. Knowledge Base — knowledge packs
 *   6. System Recommendations — hardware-aware suggestions
 *
 * Visual design: VS Code + AI Model Hub aesthetic
 *   - Glassmorphism cards
 *   - Professional badges + status indicators
 *   - Storage panel in header
 *   - Smooth animations
 *   - Lazy loading for model lists
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Brain, CheckCircle2, Download, Puzzle, BookOpen, Cpu,
  Search, RefreshCw, HardDrive, Star, X, Loader2, Plus, FileUp, AlertCircle,
} from 'lucide-react';
import ModelCard, { type ModelCardData, type ModelType } from './library/ModelCard';
import DownloadCard, { type DownloadCardData } from './library/DownloadCard';
import StoragePanel, { type StorageData } from './library/StoragePanel';
import EmptyState from './library/EmptyState';
import ModelDetailsModal from './library/ModelDetailsModal';
import { useDownloadStore } from '../store/download-store';
import { useStore } from '../store/useStore';

type Tab = 'models' | 'installed' | 'downloads' | 'extensions' | 'knowledge' | 'recommendations';

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'models', label: 'Models', icon: <Brain size={13} /> },
  { id: 'installed', label: 'Installed', icon: <CheckCircle2 size={13} /> },
  { id: 'downloads', label: 'Downloads', icon: <Download size={13} /> },
  { id: 'extensions', label: 'Extensions', icon: <Puzzle size={13} /> },
  { id: 'knowledge', label: 'Knowledge', icon: <BookOpen size={13} /> },
  { id: 'recommendations', label: 'Recommended', icon: <Star size={13} /> },
];

export default function NexLibraryPanel() {
  const [tab, setTab] = useState<Tab>('models');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | ModelType>('all');
  const [catalog, setCatalog] = useState<any[]>([]);
  const [installed, setInstalled] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [storageInfo, setStorageInfo] = useState<StorageData | null>(null);
  const [voiceComponents, setVoiceComponents] = useState<any[]>([]);
  const [unifiedDownloads, setUnifiedDownloads] = useState<Map<string, any>>(new Map());
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [downloadableModels, setDownloadableModels] = useState<any[]>([]);
  const [detailsModel, setDetailsModel] = useState<ModelCardData | null>(null);
  // Phase 116: Add Local Model — error/toast state for surfacing real load errors
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [addingModel, setAddingModel] = useState(false);
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({}); // modelId → error

  // Download store
  const { downloads, history } = useDownloadStore();

  // ── Data loading ────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, instRes, statRes, storageRes, voiceRes, dlRes] = await Promise.all([
        window.nexAPI.ecosystemCatalog().catch(() => ({ success: false, catalog: [] })),
        window.nexAPI.modelList().catch(() => []),
        window.nexAPI.localRuntimeStatus().catch(() => null),
        window.nexAPI.aiStorageInfo().catch(() => null),
        window.nexAPI.componentUnifiedVoiceList().catch(() => ({ success: false, components: [] })),
        window.nexAPI.modelDownloadList().catch(() => ({ success: false, models: [] })),
      ]);
      const cat = (catRes as any)?.catalog || (catRes as any) || [];
      const voice = (voiceRes as any)?.components || (voiceRes as any) || [];
      const dls = (dlRes as any)?.models || [];
      setCatalog(Array.isArray(cat) ? cat : []);
      setInstalled(Array.isArray(instRes) ? instRes : []);
      setStatus(statRes);
      setVoiceComponents(Array.isArray(voice) ? voice : []);
      setDownloadableModels(Array.isArray(dls) ? dls : []);

      // Build storage data
      if (storageRes) {
        const usedBytes = (instRes || []).reduce((sum: number, m: any) => sum + (m.sizeBytes || 0), 0);
        const totalBytes = (storageRes as any).totalSize || (storageRes as any).totalBytes || 200 * 1024 * 1024 * 1024;
        setStorageInfo({
          usedBytes,
          totalBytes,
          modelCount: (instRes || []).length,
          llmBytes: usedBytes,
        });
      }

      // Get active model
      const active = await window.nexAPI.localRuntimeGetActiveModel().catch(() => null);
      setActiveModelId((active as any)?.activeModelId || (active as any)?.modelId || null);
    } catch (err) {
      console.error('[Library] refresh error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Subscribe to download progress
  useEffect(() => {
    const offProgress = window.nexAPI?.onModelDownloadProgress?.((ev: any) => {
      setUnifiedDownloads((prev) => {
        const next = new Map(prev);
        next.set(ev.modelId, ev);
        return next;
      });
    });
    const offComplete = window.nexAPI?.onDownloadCompleted?.(() => { refresh(); });
    const offError = window.nexAPI?.onDownloadError?.(() => { refresh(); });
    return () => {
      if (offProgress) offProgress();
      if (offComplete) offComplete();
      if (offError) offError();
    };
  }, [refresh]);

  // ── Model catalog → ModelCardData mapping ───────────────────────────────
  // Merge ecosystem catalog (display metadata) with downloadable models (actual
  // download URLs). Only models present in downloadableModels can actually be
  // downloaded — the rest are display-only catalog entries.
  const allModels: ModelCardData[] = React.useMemo(() => {
    const installedIds = new Set((installed || []).map((m: any) => m.id));
    const downloadableIds = new Set((downloadableModels || []).map((m: any) => m.id));

    // Map ecosystem catalog entries
    const fromCatalog = (catalog || []).map((entry: any): ModelCardData => {
      const isInstalled = installedIds.has(entry.id);
      const dl = unifiedDownloads.get(entry.id);
      const isActive = entry.id === activeModelId;
      return {
        id: entry.id,
        name: entry.name,
        nameFa: entry.displayNameFa || entry.nameFa,
        provider: entry.provider || 'unknown',
        type: (entry.type === 'voice-stt' ? 'voice-stt' : entry.type === 'voice-tts' ? 'voice-tts' : entry.type === 'vision' ? 'vision' : entry.type === 'embedding' ? 'embedding' : 'llm') as ModelType,
        sizeBytes: (entry.sizeGB || 0) * 1024 * 1024 * 1024,
        quantization: entry.quantization,
        parameterCount: entry.parameterCount,
        architecture: entry.architecture,
        contextSize: entry.contextSize,
        requiredRAM: entry.requiredRAM ? entry.requiredRAM * 1024 * 1024 * 1024 : undefined,
        requiredVRAM: entry.requiredVRAM ? entry.requiredVRAM * 1024 * 1024 * 1024 : undefined,
        recommendedRAM: entry.recommendedRAM,
        recommendedVRAM: entry.recommendedVRAM,
        speedScore: entry.speedScore,
        qualityScore: entry.qualityScore,
        codingScore: entry.codingScore,
        reasoningScore: entry.reasoningScore,
        persianSupport: entry.persianSupport,
        multilingual: entry.multilingual,
        status: dl ? 'downloading' : isInstalled ? 'installed' : entry.recommendedTier === 'low' ? 'recommended' : 'available',
        isActive,
        downloadProgress: dl?.percentage || undefined,
        downloadSpeed: dl?.speed || undefined,
        downloadEta: dl?.eta || undefined,
      };
    });

    // Also add downloadable models not in the catalog
    const catalogIds = new Set((catalog || []).map((e: any) => e.id));
    const extraDownloadable = (downloadableModels || [])
      .filter((m: any) => !catalogIds.has(m.id))
      .map((m: any): ModelCardData => {
        const isInstalled = installedIds.has(m.id);
        const dl = unifiedDownloads.get(m.id);
        const isActive = m.id === activeModelId;
        return {
          id: m.id,
          name: m.name,
          nameFa: m.nameFa,
          provider: m.provider || 'unknown',
          type: (m.category === 'vision' ? 'vision' : m.category === 'embedding' ? 'embedding' : 'llm') as ModelType,
          sizeBytes: 0, // DownloadableModel doesn't have sizeBytes directly
          quantization: m.quantization,
          parameterCount: m.parameterCount,
          architecture: m.architecture,
          contextSize: undefined,
          requiredRAM: m.requiredRAM ? m.requiredRAM * 1024 * 1024 * 1024 : undefined,
          requiredVRAM: m.requiredVRAM ? m.requiredVRAM * 1024 * 1024 * 1024 : undefined,
          persianSupport: m.persianSupport,
          status: dl ? 'downloading' : isInstalled ? 'installed' : 'available',
          isActive,
          downloadProgress: dl?.percentage || undefined,
          downloadSpeed: dl?.speed || undefined,
          downloadEta: dl?.eta || undefined,
        };
      });

    return [...fromCatalog, ...extraDownloadable];
  }, [catalog, installed, unifiedDownloads, activeModelId, downloadableModels]);

  // Filter models
  const filteredModels = React.useMemo(() => {
    let result = allModels;
    if (filterType !== 'all') {
      result = result.filter((m) => m.type === filterType);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((m) =>
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        (m.parameterCount || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [allModels, filterType, searchQuery]);

  // ── Installed models ────────────────────────────────────────────────────
  const installedModels: ModelCardData[] = React.useMemo(() => {
    return (installed || []).map((m: any): ModelCardData => ({
      id: m.id,
      name: m.name,
      provider: m.architecture || 'local',
      type: (m.category === 'vision' ? 'vision' : m.category === 'embedding' ? 'embedding' : 'llm') as ModelType,
      sizeBytes: m.sizeBytes || 0,
      quantization: m.quantization,
      parameterCount: m.parameterCount,
      contextSize: m.contextSize,
      status: 'installed',
      isActive: m.id === activeModelId,
      installedPath: m.path,
    }));
  }, [installed, activeModelId]);

  // ── Download cards ──────────────────────────────────────────────────────
  const downloadCards: DownloadCardData[] = React.useMemo(() => {
    // From unified downloads
    const cards: DownloadCardData[] = [];
    unifiedDownloads.forEach((dl: any, modelId: string) => {
      const entry = catalog.find((c: any) => c.id === modelId);
      cards.push({
        id: dl.downloadId || modelId,
        modelName: entry?.name || dl.modelName || modelId,
        state: dl.state || 'downloading',
        progress: dl.percentage || 0,
        receivedBytes: dl.receivedBytes || 0,
        totalBytes: dl.totalBytes || 0,
        speed: dl.speed || 0,
        eta: dl.eta || -1,
        stageMessage: dl.stageMessage,
        stageMessageFa: dl.stageMessageFa,
        attempt: dl.attempt,
        maxAttempts: dl.maxAttempts,
        failure: dl.failure?.message,
        source: dl.currentSource?.label,
      });
    });
    // Also from download store
    (downloads || []).forEach((dl: any) => {
      if (!cards.find((c) => c.id === dl.id)) {
        cards.push({
          id: dl.id,
          modelName: dl.modelName,
          state: dl.status?.toLowerCase() || 'downloading',
          progress: dl.progress || 0,
          receivedBytes: dl.downloadedBytes || 0,
          totalBytes: dl.totalBytes || 0,
          speed: dl.speedBytesPerSec || 0,
          eta: dl.etaSeconds ? dl.etaSeconds * 1000 : -1,
          stageMessage: dl.stageMessage,
          stageMessageFa: dl.stageMessageFa,
          failure: dl.error,
        });
      }
    });
    return cards;
  }, [unifiedDownloads, downloads, catalog]);

  const activeDownloads = downloadCards.filter((d) => !['completed', 'cancelled', 'download-failed'].includes(d.state));
  const completedDownloads = downloadCards.filter((d) => d.state === 'completed');

  // ── Action handlers ─────────────────────────────────────────────────────
  // Download button opens the details modal (not direct download)
  const handleDownload = useCallback((modelId: string) => {
    const model = allModels.find((m) => m.id === modelId);
    if (model) {
      setDetailsModel(model);
    } else {
      console.error('[Library] Model not found for download:', modelId);
    }
  }, [allModels]);

  // Confirm download from the modal — actually starts the download
  const handleConfirmDownload = useCallback(async (model: ModelCardData) => {
    console.log('[Library] Confirming download for:', model.id, model.name);
    try {
      const result = await window.nexAPI.modelDownloadStart(model.id);
      if (!(result as any)?.success) {
        console.error('[Library] Download start failed:', (result as any)?.error);
        // If modelDownloadStart fails (model not in downloadable list),
        // try componentUnifiedInstall as fallback (for voice components)
        try {
          await window.nexAPI.componentUnifiedInstall(model.id);
        } catch (err2) {
          console.error('[Library] Fallback install also failed:', err2);
        }
      }
    } catch (err) {
      console.error('[Library] Download failed:', err);
    }
  }, []);
  const handleLoad = useCallback(async (modelId: string) => {
    // Phase 116: Surface real llama.cpp load errors to the UI.
    // Previously this only logged to console — the user never saw WHY
    // the model failed to load (missing file, invalid GGUF, OOM, etc.).
    setLoadErrors((prev) => { const n = { ...prev }; delete n[modelId]; return n; });
    try {
      const result = await window.nexAPI.localRuntimeActivateModel(modelId);
      if (!result.success) {
        const errMsg = result.error || 'Unknown load error';
        setLoadErrors((prev) => ({ ...prev, [modelId]: errMsg }));
        setToast({ type: 'error', message: `Load failed: ${errMsg}` });
      } else {
        // CRITICAL FIX: Update Zustand state so the renderer knows which
        // model is active. Without this, getProviderConfig() reads the
        // STALE settings.activeLocalModelId and sends the old model
        // as modelIdOverride to the ModelRouter — which overrides the
        // user's new selection.
        //
        // Previously this was missing — the main process persisted
        // activeLocalModelId, but the renderer's Zustand store was never
        // updated. On next chat, getProviderConfig() sent the OLD modelId,
        // causing the active model to silently revert to the previous one.
        const { setActiveLocalModel } = useStore.getState();
        setActiveLocalModel(modelId);
        await refresh();
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      setLoadErrors((prev) => ({ ...prev, [modelId]: errMsg }));
      setToast({ type: 'error', message: `Load failed: ${errMsg}` });
    }
  }, [refresh]);
  const handleRemove = useCallback(async (modelId: string) => {
    try { await window.nexAPI.modelRemove(modelId); await refresh(); } catch (err) { console.error('Remove failed:', err); }
  }, [refresh]);

  // Phase 116: Add Local Model — pick a .gguf file from disk, register by
  // its REAL absolute path (no copy, no re-download). The backend model-add
  // IPC already supports this — the issue was the button was hidden.
  const handleAddLocalModel = useCallback(async () => {
    setAddingModel(true);
    setToast(null);
    try {
      const pickResult = await window.nexAPI.modelPickFile();
      if (pickResult.canceled) { setAddingModel(false); return; }
      if (!pickResult.path) {
        setToast({ type: 'error', message: 'No file selected.' });
        setAddingModel(false);
        return;
      }
      const addResult = await window.nexAPI.modelAdd(pickResult.path);
      if (!addResult.success) {
        setToast({ type: 'error', message: `Failed to add model: ${addResult.error || 'unknown error'}` });
        setAddingModel(false);
        return;
      }
      await refresh();
      setToast({ type: 'success', message: `Model added: ${addResult.model?.name || pickResult.path}` });
      // Auto-switch to Installed tab so the user sees the newly added model
      setTab('installed');
    } catch (err: any) {
      setToast({ type: 'error', message: `Failed to add model: ${err?.message || String(err)}` });
    } finally {
      setAddingModel(false);
    }
  }, [refresh]);

  // Phase 116: Test Load — verify a model can be loaded WITHOUT activating it.
  // This catches invalid GGUF, corrupt files, OOM, etc. before the user
  // tries to use the model in chat. Shows the real llama.cpp error.
  const handleTestLoad = useCallback(async (modelId: string) => {
    setLoadErrors((prev) => { const n = { ...prev }; delete n[modelId]; return n; });
    setToast(null);
    try {
      const result = await window.nexAPI.modelTestLoad(modelId);
      if (result.success) {
        setToast({ type: 'success', message: `Test load OK: ${result.modelName || modelId}` });
      } else {
        const errMsg = result.error || 'Test load failed';
        setLoadErrors((prev) => ({ ...prev, [modelId]: errMsg }));
        setToast({ type: 'error', message: `Test load failed: ${errMsg}` });
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      setLoadErrors((prev) => ({ ...prev, [modelId]: errMsg }));
      setToast({ type: 'error', message: `Test load failed: ${errMsg}` });
    }
  }, []);
  const handleCancelDownload = useCallback(async (downloadId: string) => {
    try { await window.nexAPI.modelDownloadCancel(downloadId); } catch (err) { console.error('Cancel failed:', err); }
  }, []);
  // Phase 116: handleInstall — catalog "Install" button now also uses the
  // file-picker flow (consistent with "Add Local Model"). Catalog download
  // uses handleDownload; Install is for adding a local .gguf.
  const handleInstall = useCallback(async () => {
    await handleAddLocalModel();
  }, [handleAddLocalModel]);
  const handleInstallVoiceComponent = useCallback(async (componentId: string) => {
    try { await window.nexAPI.componentUnifiedInstall(componentId); } catch (err) { console.error('Voice install failed:', err); }
  }, []);
  const FILTER_PILLS: Array<{ id: 'all' | ModelType; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'llm', label: 'LLM' },
    { id: 'voice-stt', label: 'STT' },
    { id: 'voice-tts', label: 'TTS' },
    { id: 'vision', label: 'Vision' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)' }}>
        <div className="flex items-center gap-2">
          <Brain size={16} style={{ color: 'var(--nex-accent)' }} />
          <span className="text-xs font-medium tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>LIBRARY</span>
          {status?.modelReady && (
            <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: '#86efac' }}>
              <CheckCircle2 size={8} /> Ready
            </span>
          )}
          {activeDownloads.length > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(6,182,212,0.15)', color: '#67e8f9' }}>
              <Loader2 size={8} className="animate-spin" /> {activeDownloads.length} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {storageInfo && (
            <span className="text-[9px] px-2 py-1 rounded-full" style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text-muted)' }}>
              <HardDrive size={9} className="inline mr-1" />
              {(storageInfo.usedBytes / (1024 * 1024 * 1024)).toFixed(1)} GB • {storageInfo.modelCount} models
            </span>
          )}
          {/* Phase 116: Add Local Model — prominent button, visible on ALL tabs.
              Picks a .gguf file from disk and registers it by its real absolute
              path (no copy, no re-download). */}
          <button
            onClick={handleAddLocalModel}
            disabled={addingModel}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium nex-click shrink-0"
            style={{
              background: 'var(--nex-accent-dim)',
              color: 'var(--nex-accent-text)',
              border: '1px solid var(--nex-accent-glow)',
            }}
            title="Add a local .gguf model file from disk (no copy, no download)"
            aria-label="Add local model"
          >
            {addingModel ? <Loader2 size={11} className="animate-spin" /> : <FileUp size={11} />}
            <span>Add Local Model</span>
          </button>
          <button onClick={refresh} disabled={loading} className="p-1 rounded transition-colors hover:bg-white/[0.06] disabled:opacity-50" style={{ color: 'var(--nex-text-muted)' }} title="Refresh">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Phase 116: Toast notification — surfaces real load/add errors to the user */}
      {toast && (
        <div
          className="flex items-center gap-2 px-4 py-2 shrink-0 text-[10px]"
          style={{
            background: toast.type === 'error' ? 'rgba(239,68,68,0.12)' : toast.type === 'success' ? 'rgba(34,197,94,0.12)' : 'rgba(59,130,246,0.12)',
            borderBottom: '1px solid var(--nex-glass-border)',
            color: toast.type === 'error' ? '#fca5a5' : toast.type === 'success' ? '#86efac' : '#93c5fd',
          }}
        >
          {toast.type === 'error' ? <AlertCircle size={12} /> : toast.type === 'success' ? <CheckCircle2 size={12} /> : <Brain size={12} />}
          <span className="flex-1">{toast.message}</span>
          <button onClick={() => setToast(null)} className="p-0.5 rounded hover:bg-white/10" aria-label="Dismiss">
            <X size={11} />
          </button>
        </div>
      )}

      {/* Tab bar — equal width, flex, no scroll */}
      <div className="flex items-stretch gap-0.5 px-3 py-1.5 shrink-0" style={{ borderBottom: '1px solid var(--nex-glass-border)', overflowX: 'hidden' }}>
        {TABS.map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex items-center justify-center gap-1 flex-1 min-w-0 py-1 rounded-md text-[9px] font-medium transition-all nex-click truncate"
            style={
              tab === id
                ? { background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }
                : { background: 'transparent', color: 'var(--nex-text-muted)', border: '1px solid transparent' }
            }
          >
            {icon}
            <span className="truncate">{label}</span>
            {id === 'downloads' && activeDownloads.length > 0 && (
              <span className="ml-0.5 text-[7px] px-1 py-0.5 rounded-full shrink-0" style={{ background: 'var(--nex-accent)', color: 'var(--nex-bg)' }}>
                {activeDownloads.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto nex-scroll p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="animate-spin" size={24} style={{ color: 'var(--nex-accent)' }} />
          </div>
        ) : (
          <>
            {/* ── Models Tab ── */}
            {tab === 'models' && (
              <div className="space-y-3">
                {/* Search + filter */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--nex-text-muted)' }} />
                    <input
                      type="text"
                      placeholder="Search models..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 rounded-lg text-[11px] nex-focus"
                      style={{ background: 'var(--nex-bg)', border: '1px solid var(--nex-panel-border)', color: 'var(--nex-text)' }}
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    {FILTER_PILLS.map((pill) => (
                      <button
                        key={pill.id}
                        onClick={() => setFilterType(pill.id)}
                        className="px-2.5 py-1 rounded-lg text-[9px] font-medium transition-all nex-click"
                        style={
                          filterType === pill.id
                            ? { background: 'var(--nex-accent-dim)', color: 'var(--nex-accent-text)', border: '1px solid var(--nex-accent-glow)' }
                            : { background: 'rgba(255,255,255,0.03)', color: 'var(--nex-text-muted)', border: '1px solid var(--nex-panel-border)' }
                        }
                      >
                        {pill.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Model grid */}
                {filteredModels.length === 0 ? (
                  <EmptyState
                    variant="models"
                    title="No models found"
                    description="Try adjusting your search or filter. Browse the catalog to find models for your system."
                    actionLabel="Browse All Models"
                    onAction={() => { setSearchQuery(''); setFilterType('all'); }}
                  />
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                    {filteredModels.map((model) => (
                      <ModelCard
                        key={model.id}
                        model={model}
                        onDownload={handleDownload}
                        onInstall={handleInstall}
                        onLoad={handleLoad}
                        onRemove={handleRemove}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Installed Tab ── */}
            {tab === 'installed' && (
              <div className="space-y-3">
                {/* Runtime status card */}
                {status && (
                  <div className="nex-glass rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Cpu size={14} style={{ color: 'var(--nex-accent)' }} />
                      <span className="text-[11px] font-medium" style={{ color: 'var(--nex-text)' }}>Runtime Status</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px]">
                      <div>
                        <span style={{ color: 'var(--nex-text-muted)' }}>Loaded:</span>
                        <span className="ml-1" style={{ color: 'var(--nex-text)' }}>{status.loadedModelName || 'none'}</span>
                      </div>
                      <div>
                        <span style={{ color: 'var(--nex-text-muted)' }}>Backend:</span>
                        <span className="ml-1" style={{ color: 'var(--nex-text)' }}>{status.gpuBackend || 'cpu'}</span>
                      </div>
                      <div>
                        <span style={{ color: 'var(--nex-text-muted)' }}>Models:</span>
                        <span className="ml-1" style={{ color: 'var(--nex-text)' }}>{status.installedModels || 0}</span>
                      </div>
                      <div>
                        <span style={{ color: 'var(--nex-text-muted)' }}>Health:</span>
                        <span className="ml-1" style={{ color: status.healthy ? '#86efac' : '#fca5a5' }}>{status.healthy ? 'Healthy' : 'Issues'}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Storage panel */}
                {storageInfo && <StoragePanel storage={storageInfo} />}

                {/* Installed models */}
                {installedModels.length === 0 ? (
                  <EmptyState
                    variant="installed"
                    title="No models installed"
                    description="Add a local .gguf model file from disk, or browse the catalog to download one."
                    actionLabel="Add Local Model"
                    onAction={handleAddLocalModel}
                  />
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                    {installedModels.map((model) => (
                      <div key={model.id} className="flex flex-col gap-1.5">
                        <ModelCard
                          model={model}
                          onLoad={handleLoad}
                          onRemove={handleRemove}
                        />
                        {/* Phase 116: Per-model error display — shows the real
                            llama.cpp load error so the user knows WHY it failed */}
                        {loadErrors[model.id] && (
                          <div
                            className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-md text-[9px]"
                            style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}
                          >
                            <AlertCircle size={10} className="shrink-0 mt-0.5" />
                            <span className="flex-1 break-words">{loadErrors[model.id]}</span>
                            <button
                              onClick={() => handleTestLoad(model.id)}
                              className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium nex-click"
                              style={{ background: 'rgba(59,130,246,0.15)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.3)' }}
                              title="Retry loading this model to see if the issue persists"
                            >
                              Retry
                            </button>
                          </div>
                        )}
                        {/* Phase 116: Test Load button — verify the model can be
                            loaded WITHOUT activating it (catches corrupt GGUF, OOM, etc.) */}
                        {!loadErrors[model.id] && (
                          <button
                            onClick={() => handleTestLoad(model.id)}
                            className="self-start flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium nex-click"
                            style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--nex-text-muted)', border: '1px solid var(--nex-panel-border)' }}
                            title="Test load — verify the model can be loaded without activating it"
                          >
                            <Cpu size={9} /> Test Load
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Phase 116: Secondary add button at bottom of Installed tab.
                    The primary "Add Local Model" button is now in the header
                    (visible on ALL tabs). This is kept for discoverability
                    when the Installed tab is empty. */}
                <button
                  onClick={handleAddLocalModel}
                  disabled={addingModel}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[11px] font-medium transition-all nex-click disabled:opacity-50"
                  style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--nex-text-muted)', border: '1px dashed var(--nex-panel-border)' }}
                >
                  {addingModel ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />} Add Local Model (.gguf)
                </button>
              </div>
            )}

            {/* ── Downloads Tab ── */}
            {tab === 'downloads' && (
              <div className="space-y-3">
                {activeDownloads.length === 0 && completedDownloads.length === 0 && history.length === 0 ? (
                  <EmptyState
                    variant="downloads"
                    title="No downloads"
                    description="Browse the Models tab to find and download models. Active downloads will appear here."
                    actionLabel="Browse Models"
                    onAction={() => setTab('models')}
                  />
                ) : (
                  <>
                    {/* Active downloads */}
                    {activeDownloads.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>
                          Active ({activeDownloads.length})
                        </h3>
                        {activeDownloads.map((dl) => (
                          <DownloadCard key={dl.id} download={dl} onCancel={handleCancelDownload} />
                        ))}
                      </div>
                    )}

                    {/* Completed */}
                    {completedDownloads.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>
                          Completed ({completedDownloads.length})
                        </h3>
                        {completedDownloads.map((dl) => (
                          <DownloadCard key={dl.id} download={dl} />
                        ))}
                      </div>
                    )}

                    {/* History */}
                    {history.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>
                          History (last {history.length})
                        </h3>
                        {history.slice(0, 10).map((h: any, i: number) => (
                          <div key={i} className="nex-glass rounded-lg p-2.5 flex items-center gap-2 text-[10px]">
                            <span style={{ color: h.status === 'download-complete' ? '#86efac' : '#fca5a5' }}>
                              {h.status === 'download-complete' ? <CheckCircle2 size={11} /> : <X size={11} />}
                            </span>
                            <span style={{ color: 'var(--nex-text)' }}>{h.modelName}</span>
                            <span className="ml-auto" style={{ color: 'var(--nex-text-muted)' }}>
                              {h.completedAt ? new Date(h.completedAt).toLocaleString() : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Extensions Tab ── */}
            {tab === 'extensions' && (
              <div className="space-y-3">
                <h3 className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--nex-text-muted)' }}>
                  Voice Components
                </h3>
                {voiceComponents.length === 0 ? (
                  <EmptyState
                    variant="generic"
                    title="No extensions available"
                    description="Voice components (Whisper STT, Piper TTS) will appear here when available for installation."
                  />
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                    {voiceComponents.map((comp: any) => (
                      <ModelCard
                        key={comp.id}
                        model={{
                          id: comp.id,
                          name: comp.name,
                          nameFa: comp.nameFa,
                          provider: comp.type,
                          type: comp.type === 'voice-stt' ? 'voice-stt' : comp.type === 'voice-tts' ? 'voice-tts' : 'llm',
                          sizeBytes: comp.expectedSize || 0,
                          quantization: comp.quantization,
                          status: 'available',
                        }}
                        onDownload={handleInstallVoiceComponent}
                      />
                    ))}
                  </div>
                )}

                {/* Runtime tools */}
                <div className="nex-glass rounded-xl p-4 mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Cpu size={14} style={{ color: 'var(--nex-accent)' }} />
                    <span className="text-[11px] font-medium" style={{ color: 'var(--nex-text)' }}>Runtime Tools</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>
                    <CheckCircle2 size={11} style={{ color: '#86efac' }} />
                    <span>llama.cpp (node-llama-cpp) — Built-in</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Knowledge Tab ── */}
            {tab === 'knowledge' && (
              <div className="space-y-3">
                <EmptyState
                  variant="generic"
                  icon={<BookOpen size={32} />}
                  title="Knowledge Base"
                  description="Manage knowledge packs, documents, and project-specific knowledge. Import files or scan your project to build a local knowledge base."
                />
              </div>
            )}

            {/* ── Recommendations Tab ── */}
            {tab === 'recommendations' && (
              <div className="space-y-3">
                {/* Hardware-aware recommendations */}
                <div className="nex-glass rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Star size={14} style={{ color: 'var(--nex-accent)' }} />
                    <span className="text-[11px] font-medium" style={{ color: 'var(--nex-text)' }}>Best Models for Your System</span>
                  </div>
                  <p className="text-[10px]" style={{ color: 'var(--nex-text-muted)' }}>
                    Recommendations are based on your hardware profile (RAM, GPU, VRAM, CPU).
                  </p>
                </div>

                {/* Recommended models */}
                {allModels.filter((m) => m.status === 'recommended').length === 0 ? (
                  <EmptyState
                    variant="generic"
                    icon={<Star size={32} />}
                    title="No recommendations yet"
                    description="Install a model to get personalized recommendations based on your hardware."
                    actionLabel="Browse Models"
                    onAction={() => setTab('models')}
                  />
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                    {allModels
                      .filter((m) => m.status === 'recommended')
                      .map((model) => (
                        <ModelCard
                          key={model.id}
                          model={model}
                          onDownload={handleDownload}
                          onInstall={handleInstall}
                          onLoad={handleLoad}
                        />
                      ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Model Details Modal (shown before download) ── */}
      {detailsModel && (
        <ModelDetailsModal
          model={detailsModel}
          onClose={() => setDetailsModel(null)}
          onConfirmDownload={handleConfirmDownload}
          hardware={{
            gpu: status?.hardware?.gpu?.name,
            ram: status?.hardware?.ramTotalBytes ? `${(status.hardware.ramTotalBytes / (1024 * 1024 * 1024)).toFixed(0)} GB` : undefined,
            vram: status?.hardware?.gpu?.vramTotalBytes ? `${(status.hardware.gpu.vramTotalBytes / (1024 * 1024 * 1024)).toFixed(0)} GB` : undefined,
            backend: status?.gpuBackend,
            compatible: detailsModel.status !== 'not-compatible',
          }}
          downloadUrl={(downloadableModels.find((m: any) => m.id === detailsModel.id)?.sources?.[0]?.url) || undefined}
        />
      )}
    </div>
  );
}
