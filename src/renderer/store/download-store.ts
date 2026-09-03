/**
 * NEX AI — Download Store (Phase 68)
 *
 * Zustand store for download state. This store lives OUTSIDE any component
 * lifecycle — it persists across tab switches, panel unmounts, and navigation
 * changes. The main process sends IPC events; this store receives them and
 * updates the download state.
 *
 * Architecture:
 *
 *   Main Process (DownloadManager)
 *       ↓ IPC events
 *   This Store (Zustand — persistent across component lifecycle)
 *       ↓
 *   Components (NexLibraryPanel > Downloads tab, Recommended tab, etc.)
 *
 * The store is the SINGLE SOURCE OF TRUTH for download state in the renderer.
 * Components read from it; they do not own download state.
 */
import { create } from 'zustand';

// ─── Types ─────────────────────────────────────────────────────────────────

export type DownloadStatus =
  | 'idle'
  | 'requesting-permission'
  | 'permission-denied'
  | 'downloading'
  | 'download-complete'
  | 'download-failed'
  | 'verifying'
  | 'verification-passed'
  | 'verification-failed'
  | 'registering'
  | 'registration-complete'
  | 'registration-failed'
  | 'testing-inference'
  | 'inference-passed'
  | 'inference-failed'
  | 'deployed'
  | 'rolled-back';

export interface DownloadEntry {
  id: string;
  modelName: string;
  url: string;
  status: DownloadStatus;
  progress: number;           // 0-100
  downloadedBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  stageMessage: string;
  stageMessageFa: string;
  error?: string;
  /** Phase 71: Detailed error info for UI */
  errorCode?: string;
  errorStage?: string;
  errorHost?: string;
  bytesExpected?: number;
  /** Phase 72: CDN connection failure classification */
  errorClassification?: string;
  cdnHost?: string;
  hasAlternativeSource?: boolean;
  startedAt: number;
  completedAt?: number;
  filePath?: string;
  result?: any;               // Final deployment result
}

export interface DownloadStore {
  // ── State ──
  downloads: DownloadEntry[];
  activeDownloadId: string | null;
  history: any[];              // Completed/failed downloads
  pendingPermission: any | null;

  // ── Actions ──
  startDownload: (id: string, modelName: string, url: string) => void;
  updateProgress: (id: string, progress: Partial<DownloadEntry>) => void;
  completeDownload: (id: string, result: any) => void;
  failDownload: (id: string, error: string, details?: { code?: string; stage?: string; host?: string; bytesExpected?: number; classification?: string; cdnHost?: string; hasAlternativeSource?: boolean }) => void;
  setPendingPermission: (perm: any | null) => void;
  clearActive: (id: string) => void;
  addToHistory: (result: any) => void;
  syncFromMain: (downloads: DownloadEntry[]) => void;
  reset: () => void;
}

// ─── Store ────────────────────────────────────────────────────────────────

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  downloads: [],
  activeDownloadId: null,
  history: [],
  pendingPermission: null,

  startDownload: (id, modelName, url) => {
    const entry: DownloadEntry = {
      id, modelName, url,
      status: 'requesting-permission',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      speedBytesPerSec: 0,
      etaSeconds: -1,
      stageMessage: 'Starting...',
      stageMessageFa: 'در حال شروع...',
      startedAt: Date.now(),
    };
    set((s) => ({
      downloads: [...s.downloads, entry],
      activeDownloadId: id,
    }));
    console.log('[DOWNLOAD_STORE] startDownload — id:', id, 'model:', modelName);
  },

  updateProgress: (id, progress) => {
    set((s) => ({
      downloads: s.downloads.map((d) =>
        d.id === id ? { ...d, ...progress } : d
      ),
    }));
  },

  completeDownload: (id, result) => {
    set((s) => ({
      downloads: s.downloads.map((d) =>
        d.id === id
          ? { ...d, status: 'deployed', progress: 100, result, completedAt: Date.now() }
          : d
      ),
      history: [result, ...s.history].slice(0, 20),
    }));
    console.log('[DOWNLOAD_STORE] completeDownload — id:', id);
  },

  failDownload: (id, error, details) => {
    set((s) => ({
      downloads: s.downloads.map((d) =>
        d.id === id
          ? {
              ...d,
              status: 'download-failed' as DownloadStatus,
              error,
              errorCode: details?.code,
              errorStage: details?.stage,
              errorHost: details?.host,
              bytesExpected: details?.bytesExpected,
              errorClassification: details?.classification,
              cdnHost: details?.cdnHost,
              hasAlternativeSource: details?.hasAlternativeSource,
              completedAt: Date.now(),
            }
          : d
      ),
    }));
    console.log('[DOWNLOAD_STORE] failDownload — id:', id, 'error:', error, 'details:', details);
  },

  setPendingPermission: (perm) => {
    set({ pendingPermission: perm });
  },

  clearActive: (id) => {
    set((s) => ({
      activeDownloadId: s.activeDownloadId === id ? null : s.activeDownloadId,
    }));
  },

  addToHistory: (result) => {
    set((s) => ({
      history: [result, ...s.history].slice(0, 20),
    }));
  },

  syncFromMain: (downloads) => {
    set({ downloads });
  },

  reset: () => {
    set({ downloads: [], activeDownloadId: null, history: [], pendingPermission: null });
  },
}));

// ─── Helper: get active download ───────────────────────────────────────────

export function getActiveDownload(): DownloadEntry | null {
  const { downloads, activeDownloadId } = useDownloadStore.getState();
  if (!activeDownloadId) return null;
  return downloads.find((d) => d.id === activeDownloadId) || null;
}

// ─── Helper: is anything downloading? ──────────────────────────────────────

export function isDownloading(): boolean {
  const { downloads } = useDownloadStore.getState();
  return downloads.some((d) =>
    !['deployed', 'download-failed', 'rolled-back', 'permission-denied',
      'verification-failed', 'registration-failed', 'inference-failed'].includes(d.status)
  );
}
