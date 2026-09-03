import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import {
  Cpu, Plus, Trash2, Check, AlertCircle, Loader2, HardDrive, Zap,
  Brain, Clock, FileText, RefreshCw,
} from 'lucide-react';

interface ModelInfo {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  contextSize: number;
  gpuLayers: number;
  category: 'general' | 'coding' | 'reasoning' | 'fast';
  addedAt: number;
  lastUsedAt?: number;
  fileExists: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function categoryIcon(cat: string) {
  switch (cat) {
    case 'coding': return <Code2 size={14} />;
    case 'reasoning': return <Brain size={14} />;
    case 'fast': return <Zap size={14} />;
    default: return <FileText size={14} />;
  }
}

import { Code2 } from 'lucide-react';

export default function ModelsPanel() {
  const { activeLocalModel, setActiveLocalModel, localModels, setLocalModels, settings, updateSettings } = useStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingModel, setAddingModel] = useState(false);

  // Load models on mount
  useEffect(() => {
    refreshModels();
  }, []);

  async function refreshModels() {
    setLoading(true);
    setError(null);
    try {
      const models = await window.nexAPI.modelList();
      setLocalModels(models);
      // If settings has an active model id, verify it still exists
      if (settings.activeLocalModelId) {
        const exists = models.find((m: ModelInfo) => m.id === settings.activeLocalModelId);
        if (!exists) {
          setActiveLocalModel(null);
        } else {
          setActiveLocalModel(settings.activeLocalModelId);
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddModel() {
    setAddingModel(true);
    setError(null);
    try {
      const result = await window.nexAPI.modelPickFile();
      if (result.canceled) {
        setAddingModel(false);
        return;
      }
      if (!result.path) {
        setAddingModel(false);
        return;
      }
      // Auto-detect category from filename
      const filename = result.path.split(/[\\/]/).pop() || '';
      const lower = filename.toLowerCase();
      let category: 'general' | 'coding' | 'reasoning' | 'fast' = 'general';
      if (lower.includes('coder') || lower.includes('code')) category = 'coding';
      else if (lower.includes('reason') || lower.includes('think')) category = 'reasoning';
      else if (lower.includes('0.5b') || lower.includes('1b') || lower.includes('tiny')) category = 'fast';

      const addResult = await window.nexAPI.modelAdd(result.path, {
        category,
        contextSize: 2048,
        gpuLayers: -1,
      });
      if (addResult.success) {
        await refreshModels();
        // Auto-select newly added model
        if (addResult.model) {
          setActiveLocalModel(addResult.model.id);
        }
      } else {
        setError(addResult.error || 'Failed to add model');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAddingModel(false);
    }
  }

  async function handleRemoveModel(id: string) {
    if (!confirm('Remove this model from the registry? (The .gguf file will NOT be deleted from disk.)')) {
      return;
    }
    setError(null);
    try {
      await window.nexAPI.modelRemove(id);
      if (activeLocalModel?.id === id) {
        setActiveLocalModel(null);
      }
      await refreshModels();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleSelectModel(id: string) {
    setActiveLocalModel(id);
    updateSettings({ activeLocalModelId: id });
    // Persist to disk
    try {
      await window.nexAPI.settingsSave({ ...settings, activeLocalModelId: id });
    } catch {}
  }

  return (
    <div className="h-full flex flex-col bg-[var(--nex-panel-solid)]">
      {/* Header */}
      <div className="h-10 flex items-center justify-between px-3 border-b border-[var(--nex-glass-border)] shrink-0">
        <div className="flex items-center gap-2">
          <Cpu size={14} className="text-[var(--nex-accent)]" />
          <span className="text-xs font-semibold text-[var(--nex-text-dim)] uppercase tracking-wider">Local Models</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--nex-glass-bg)] text-[var(--nex-text-muted)]">
            {localModels.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={refreshModels} disabled={loading}
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--nex-text-dim)] hover:text-[var(--nex-text)] hover:bg-white/[0.04] transition-all disabled:opacity-50"
            title="Refresh">
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
          <button onClick={handleAddModel} disabled={addingModel}
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--nex-accent)] hover:bg-[var(--nex-accent-dim)] transition-all disabled:opacity-50"
            title="Add model (.gguf)">
            {addingModel ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs flex items-start gap-2">
          <AlertCircle size={12} className="shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="hover:text-red-300">×</button>
        </div>
      )}

      {/* Empty state */}
      {localModels.length === 0 && !loading && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <div className="w-14 h-14 rounded-2xl bg-[var(--nex-glass-bg)] border border-[var(--nex-glass-border)] flex items-center justify-center mx-auto mb-3">
              <Cpu size={24} className="text-[var(--nex-text-dim)]" />
            </div>
            <h3 className="text-sm font-medium text-[var(--nex-text)] mb-1">No local models</h3>
            <p className="text-xs text-[var(--nex-text-muted)] mb-4 max-w-xs">
              Add a <code className="text-[var(--nex-accent)]">.gguf</code> model file to start using NEX AI locally.
              Models run entirely on your machine — no internet needed.
            </p>
            <button onClick={handleAddModel} disabled={addingModel}
              className="px-4 py-2 bg-[var(--nex-accent)] text-[var(--nex-bg)] rounded-lg text-xs font-medium hover:opacity-90 transition-all flex items-center gap-2 mx-auto disabled:opacity-50">
              {addingModel ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Add Model File
            </button>
            <p className="text-[10px] text-[var(--nex-text-muted)] mt-3">
              Recommended: Qwen2.5-Coder-1.5B (~1GB) for fast iteration, or
              Qwen2.5-7B-Instruct (~4.5GB) for better quality.
            </p>
          </div>
        </div>
      )}

      {/* Models list */}
      {localModels.length > 0 && (
        <div className="flex-1 overflow-auto py-2">
          {localModels.map((model) => {
            const isActive = activeLocalModel?.id === model.id;
            return (
              <div key={model.id}
                className={`mx-2 mb-1 rounded-lg border transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[var(--nex-accent-dim)] border-[var(--nex-accent)]'
                    : 'bg-[var(--nex-glass-bg)] border-[var(--nex-glass-border)] hover:border-[var(--nex-panel-border-hover)]'
                }`}
                onClick={() => handleSelectModel(model.id)}>
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {isActive && <Check size={12} className="text-[var(--nex-accent)] shrink-0" />}
                        <span className="text-sm font-medium text-[var(--nex-text)] truncate">{model.name}</span>
                      </div>
                      <div className="text-[10px] text-[var(--nex-text-muted)] mt-0.5 truncate font-mono" title={model.path}>
                        {model.path}
                      </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); handleRemoveModel(model.id); }}
                      className="w-6 h-6 rounded flex items-center justify-center text-[var(--nex-text-dim)] hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0"
                      title="Remove from registry">
                      <Trash2 size={11} />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full flex items-center gap-1 ${
                      model.category === 'coding' ? 'bg-blue-500/15 text-blue-400' :
                      model.category === 'reasoning' ? 'bg-purple-500/15 text-purple-400' :
                      model.category === 'fast' ? 'bg-green-500/15 text-green-400' :
                      'bg-[var(--nex-panel-solid)] text-[var(--nex-text-dim)]'
                    }`}>
                      {categoryIcon(model.category)}
                      {model.category}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--nex-panel-solid)] text-[var(--nex-text-dim)] flex items-center gap-1">
                      <HardDrive size={10} />
                      {formatBytes(model.sizeBytes)}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--nex-panel-solid)] text-[var(--nex-text-dim)] flex items-center gap-1">
                      <Clock size={10} />
                      {model.contextSize} ctx
                    </span>
                    {!model.fileExists && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 flex items-center gap-1">
                        <AlertCircle size={10} />
                        Missing
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div className="p-3 border-t border-[var(--nex-glass-border)] shrink-0">
        <p className="text-[10px] text-[var(--nex-text-muted)] leading-relaxed">
          Models are NEVER shipped with NEX AI — you bring your own.
          Download from{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); window.nexAPI.openExternal('https://huggingface.co/Qwen'); }}
            className="text-[var(--nex-accent)] hover:underline">HuggingFace</a>.
        </p>
      </div>
    </div>
  );
}
