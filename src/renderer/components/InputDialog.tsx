import React, { useState, useRef, useEffect } from 'react';
import { X, FileCode, FolderPlus, Pencil } from 'lucide-react';

type DialogType = 'file' | 'folder' | 'rename';

interface InputDialogProps {
  type: DialogType;
  title: string;
  defaultValue?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

export default function InputDialog({ type, title, defaultValue = '', onSubmit, onClose }: InputDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = () => {
    if (value.trim()) onSubmit(value.trim());
  };

  const icon = type === 'folder' ? <FolderPlus size={18} className="text-nex-accent" /> :
    type === 'rename' ? <Pencil size={18} className="text-nex-warning" /> :
    <FileCode size={18} className="text-nex-success" />;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[400px] mx-4 bg-nex-surface border border-nex-border rounded-xl shadow-2xl animate-in glow-accent">
        <div className="flex items-center justify-between px-5 py-4 border-b border-nex-border">
          <div className="flex items-center gap-3">
            {icon}
            <span className="text-sm font-semibold text-nex-text">{title}</span>
          </div>
          <button onClick={onClose} className="text-nex-text-dim hover:text-nex-text transition-colors"><X size={16} /></button>
        </div>
        <div className="px-5 py-4">
          <input ref={inputRef} type="text" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onClose(); }}
            placeholder={type === 'file' ? 'filename.ext' : type === 'folder' ? 'folder-name' : 'new-name'}
            className="w-full bg-nex-card border border-nex-border rounded-lg px-4 py-2.5 text-sm text-nex-text placeholder-nex-text-muted outline-none focus:border-nex-accent/50 font-mono" />
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-nex-border">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-nex-text-dim hover:text-nex-text hover:bg-nex-card transition-all">Cancel</button>
          <button onClick={handleSubmit} disabled={!value.trim()}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${value.trim() ? 'bg-nex-accent text-white hover:bg-nex-accent-light' : 'bg-nex-card text-nex-text-muted cursor-not-allowed'}`}>
            {type === 'rename' ? 'Rename' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
