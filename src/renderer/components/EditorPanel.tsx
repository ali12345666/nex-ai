import React, { useCallback, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { useStore } from '../store/useStore';
import {
  X,
  Save,
  FileCode,
  Copy,
  Search,
  Undo,
  Redo,
  WrapText,
  Maximize2,
} from 'lucide-react';

/**
 * Convert a filesystem path to a Monaco-compatible URI string.
 *
 * @monaco-editor/react's `path` prop is passed to `monaco.Uri.parse()`.
 * On Windows, a path like `C:\Users\...\file.ts` gets mis-parsed — the `C:`
 * is interpreted as a URI scheme, causing model creation to fail silently.
 *
 * This converts the path to a proper `file://` URI:
 *   C:\Users\AliK\file.ts  →  file:///C:/Users/AliK/file.ts
 *   /home/alik/file.ts     →  file:///home/alik/file.ts
 *
 * Monaco uses the URI as a unique model identifier — the exact format
 * doesn't matter as long as it's consistent and valid.
 */
function pathToMonacoUri(p: string): string {
  // Already a URI?
  if (/^[a-z]+:\/\//i.test(p)) return p;
  // Windows: C:\... → file:///C:/...
  const isWindows = /^[A-Za-z]:[\\/]/.test(p);
  if (isWindows) {
    const normalized = p.replace(/\\/g, '/');
    return `file:///${normalized}`;
  }
  // POSIX: /home/... → file:///home/...
  return `file://${p}`;
}

function FileTab({
  file,
  isActive,
  onSelect,
  onClose,
}: {
  file: { path: string; name: string; modified: boolean };
  isActive: boolean;
  onSelect: () => void;
  onClose: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 text-[13px] cursor-pointer border-r border-[var(--nex-glass-border)]/50 transition-all shrink-0 group ${
        isActive
          ? 'bg-[var(--nex-bg)] text-[var(--nex-text)] border-t-2 border-t-nex-accent'
          : 'text-[var(--nex-text-dim)] hover:bg-white/[0.04] hover:text-[var(--nex-text)]'
      }`}
      onClick={onSelect}
    >
      <FileCode size={13} className="shrink-0 opacity-60" />
      <span className="truncate max-w-[120px]">{file.name}</span>
      {file.modified && (
        <div className="w-2 h-2 rounded-full bg-[var(--nex-accent)] shrink-0" />
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose(e);
        }}
        className="w-4 h-4 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all shrink-0"
      >
        <X size={10} />
      </button>
    </div>
  );
}

export default function EditorPanel() {
  const {
    openFiles,
    activeFile,
    setActiveFile,
    closeFile,
    updateFileContent,
    saveFile,
    settings,
  } = useStore();
  const editorRef = useRef<any>(null);

  const activeFileData = openFiles.find((f) => f.path === activeFile);

  // Debug: log file selection for diagnosis.
  // Enable: localStorage.setItem('nex:editor-debug', '1')
  const ED_DEBUG = (() => {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem('nex:editor-debug') === '1'; }
    catch { return false; }
  })();
  useEffect(() => {
    if (!ED_DEBUG) return;
    console.log(
      `[EDITOR] file selected: path=${activeFile} ` +
      `size=${activeFileData?.content?.length ?? 0} ` +
      `language=${activeFileData?.language} ` +
      `contentLoaded=${!!activeFileData} ` +
      `openFiles=${openFiles.length}`,
    );
  }, [activeFile, activeFileData, openFiles.length, ED_DEBUG]);

  const handleEditorMount = useCallback((editor: any) => {
    editorRef.current = editor;
  }, []);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (activeFile && value !== undefined) {
        updateFileContent(activeFile, value);
      }
    },
    [activeFile, updateFileContent]
  );

  const handleSave = useCallback(() => {
    if (activeFile) {
      saveFile(activeFile);
    }
  }, [activeFile, saveFile]);

  if (openFiles.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-[var(--nex-text-muted)]">
        <div className="text-center animate-in">
          <FileCode size={48} className="mx-auto mb-4 opacity-20" />
          <p className="text-sm">Open a file to start editing</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[var(--nex-bg)]">
      {/* File Tabs */}
      <div className="flex items-center bg-[var(--nex-panel-solid)] border-b border-[var(--nex-glass-border)] overflow-x-auto">
        <div className="flex items-center overflow-x-auto flex-1">
          {openFiles.map((file) => (
            <FileTab
              key={file.path}
              file={file}
              isActive={file.path === activeFile}
              onSelect={() => setActiveFile(file.path)}
              onClose={() => closeFile(file.path)}
            />
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-0.5 px-2 shrink-0">
          <button
            onClick={handleSave}
            className="w-7 h-7 rounded flex items-center justify-center text-[var(--nex-text-dim)] hover:text-[var(--nex-text)] hover:bg-white/[0.04] transition-all"
            title="Save (Ctrl+S)"
          >
            <Save size={14} />
          </button>
          <button
            className="w-7 h-7 rounded flex items-center justify-center text-[var(--nex-text-dim)] hover:text-[var(--nex-text)] hover:bg-white/[0.04] transition-all"
            title="Copy"
          >
            <Copy size={14} />
          </button>
          <button
            className="w-7 h-7 rounded flex items-center justify-center text-[var(--nex-text-dim)] hover:text-[var(--nex-text)] hover:bg-white/[0.04] transition-all"
            title="Search"
          >
            <Search size={14} />
          </button>
        </div>
      </div>

      {/* Monaco Editor */}
      {activeFileData && (
        <div className="flex-1 overflow-hidden">
          <Editor
            height="100%"
            path={pathToMonacoUri(activeFileData.path)}
            language={activeFileData.language}
            value={activeFileData.content}
            onChange={handleChange}
            onMount={handleEditorMount}
            theme="vs-dark"
            options={{
              fontSize: settings.fontSize,
              fontFamily: settings.fontFamily,
              tabSize: settings.tabSize,
              minimap: { enabled: true, maxColumn: 80 },
              scrollBeyondLastLine: false,
              renderWhitespace: 'selection',
              bracketPairColorization: { enabled: true },
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              smoothScrolling: true,
              padding: { top: 12, bottom: 12 },
              lineNumbers: 'on',
              folding: true,
              automaticLayout: true,
              wordWrap: 'off',
              renderLineHighlight: 'all',
              guides: {
                bracketPairs: true,
                indentation: true,
              },
              suggest: {
                showMethods: true,
                showFunctions: true,
                showConstructors: true,
                showFields: true,
                showVariables: true,
                showClasses: true,
                showStructs: true,
                showInterfaces: true,
                showModules: true,
                showProperties: true,
                showEvents: true,
                showOperators: true,
                showUnits: true,
                showValues: true,
                showConstants: true,
                showEnums: true,
                showEnumMembers: true,
                showKeywords: true,
                showWords: true,
                showColors: true,
                showFiles: true,
                showReferences: true,
                showFolders: true,
                showTypeParameters: true,
                showSnippets: true,
              },
              formatOnPaste: true,
              formatOnType: true,
            }}
          />
        </div>
      )}
    </div>
  );
}
