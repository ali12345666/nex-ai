import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useStore, getProviderConfig } from '../store/useStore';
import { renderMarkdownToHtml } from '../lib/markdown';
import {
  Send,
  Bot,
  User,
  Sparkles,
  Copy,
  Check,
  Trash2,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  AlertCircle,
  RefreshCw,
  Cpu,
  Cloud,
  Zap,
} from 'lucide-react';

function MessageBubble({ message }: { message: any }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const html = isUser ? '' : renderMarkdownToHtml(message.content);

  return (
    <div className={`flex gap-3 animate-in ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isUser ? 'bg-nex-accent/20' : 'nex-gradient'}`}>
        {isUser ? <User size={16} className="text-nex-accent-light" /> : <Bot size={16} className="text-white" />}
      </div>
      <div className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${isUser ? 'bg-nex-accent/15 border border-nex-accent/20 text-nex-text' : 'bg-nex-card border border-nex-border text-nex-text'}`}>
        {isUser ? (
          <div className="leading-relaxed whitespace-pre-wrap break-words">{message.content}</div>
        ) : (
          <div className="markdown-content leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
        )}
        <div className="flex items-center justify-between mt-2 pt-1 border-t border-nex-border/30">
          <span className="text-[10px] text-nex-text-muted">
            {new Date(message.timestamp).toLocaleTimeString()}
            {message.tokens && <span className="ml-2">~{message.tokens} tokens</span>}
            {message.provider && <span className="ml-2">via {message.provider}</span>}
          </span>
          {!isUser && (
            <button onClick={handleCopy} className="text-nex-text-dim hover:text-nex-text transition-colors" title="Copy message">
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ChatPanel() {
  const { messages, addMessage, isAILoading, setAILoading, clearMessages, settings, openFiles, activeFile, projectPath, aiMode, activeLocalModel } = useStore();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const buildContext = useCallback(() => {
    const contextParts: string[] = [];
    if (activeFile) {
      const file = openFiles.find((f) => f.path === activeFile);
      if (file) {
        contextParts.push(`Currently active file: ${file.name}\n\`\`\`${file.language}\n${file.content}\n\`\`\``);
      }
    }
    if (openFiles.length > 1) {
      const otherFiles = openFiles.filter((f) => f.path !== activeFile).map((f) => f.name);
      contextParts.push(`Other open files: ${otherFiles.join(', ')}`);
    }
    if (projectPath) {
      contextParts.push(`Project directory: ${projectPath}`);
    }
    return contextParts.join('\n\n');
  }, [activeFile, openFiles, projectPath]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isAILoading) return;

    setError(null);
    addMessage({ role: 'user', content: trimmed });
    setInput('');
    setAILoading(true);

    const context = buildContext();
    const userMessage = context ? `Context:\n${context}\n\nUser request:\n${trimmed}` : trimmed;

    const recentMessages = messages.slice(-20)
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const apiMessages = [...recentMessages, { role: 'user' as const, content: userMessage }];

    // Build provider config based on aiMode
    const providerConfig = getProviderConfig(settings, aiMode, activeLocalModel);

    // Local mode requires no API key — show different empty-state messaging
    if (providerConfig.provider === 'openai' || providerConfig.provider === 'claude') {
      if (!settings.aiApiKey) {
        setError(`AI Mode is set to "${aiMode.toUpperCase()}" but no online API key is configured. Switch to Local mode in the AI Mode selector, or set an API key in Settings.`);
        setAILoading(false);
        return;
      }
    }

    try {
      const result = await window.nexAPI.aiChat(providerConfig, apiMessages);

      if (result.success && result.content) {
        addMessage({
          role: 'assistant',
          content: result.content,
          tokens: result.tokens,
          provider: providerConfig.provider,
        });
      } else {
        setError(result.error || 'Failed to get AI response');
        addMessage({
          role: 'assistant',
          content: `⚠️ Error: ${result.error || 'Unknown error'}`,
          provider: providerConfig.provider,
        });
      }
    } catch (err: any) {
      setError(err.message);
      addMessage({
        role: 'assistant',
        content: `⚠️ Connection error: ${err.message}`,
        provider: providerConfig.provider,
      });
    } finally {
      setAILoading(false);
    }
  }, [input, isAILoading, messages, settings, aiMode, activeLocalModel, buildContext, addMessage, setAILoading, openFiles, activeFile, projectPath]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleVoiceInput = () => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      setError('Speech recognition not supported in this browser');
      return;
    }
    if (isListening) { setIsListening(false); return; }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = settings.language === 'fa' ? 'fa-IR' : settings.language === 'ar' ? 'ar-SA' : 'en-US';
    recognition.onresult = (event: any) => {
      setInput((prev) => prev + event.results[0][0].transcript);
      setIsListening(false);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognition.start();
    setIsListening(true);
  };

  const modeIcon = aiMode === 'local' ? <Cpu size={12} /> : aiMode === 'online' ? <Cloud size={12} /> : <Zap size={12} />;
  const modeColor = aiMode === 'local' ? 'bg-green-500/20 text-green-400' : aiMode === 'online' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400';

  return (
    <div className="h-full flex flex-col bg-nex-bg">
      {/* Header */}
      <div className="h-10 flex items-center justify-between px-4 border-b border-nex-border bg-nex-surface shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-nex-accent" />
          <span className="text-sm font-medium text-nex-text">AI Assistant</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1 ${modeColor}`}>
            {modeIcon}
            {aiMode.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {activeFile && (
            <span className="text-[10px] px-2 py-0.5 bg-nex-accent/10 text-nex-accent-light rounded-full flex items-center gap-1">
              <Paperclip size={10} />
              {openFiles.find((f) => f.path === activeFile)?.name}
            </span>
          )}
          <button onClick={clearMessages} className="w-7 h-7 rounded flex items-center justify-center text-nex-text-dim hover:text-nex-text hover:bg-nex-card transition-all" title="Clear messages">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs animate-in">
          <AlertCircle size={14} />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="hover:text-red-300">
            <RefreshCw size={12} />
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center animate-in">
              <div className="w-16 h-16 rounded-2xl nex-gradient flex items-center justify-center mx-auto mb-4 glow-accent">
                <Sparkles size={28} className="text-white" />
              </div>
              <h3 className="text-lg font-semibold text-nex-text mb-1">How can I help you?</h3>
              <p className="text-sm text-nex-text-muted max-w-sm mb-2">
                {aiMode === 'local'
                  ? 'Running fully offline with your local model. No external API required.'
                  : aiMode === 'online'
                  ? 'Connected to online AI providers (OpenAI/Anthropic).'
                  : 'Auto mode: tries Local first, falls back to online if needed.'}
              </p>
              {aiMode !== 'local' && !settings.aiApiKey && (
                <p className="text-xs text-yellow-400/80 mb-4">
                  ⚠️ No online API key set. Switch to Local mode (top-right) or set a key in Settings.
                </p>
              )}
              <div className="flex flex-wrap gap-2 justify-center mt-6">
                {[
                  'Write a React component',
                  'Debug this error',
                  'Explain this code',
                  'Generate API endpoint',
                  'Refactor this function',
                  'Write unit tests',
                ].map((suggestion) => (
                  <button key={suggestion} onClick={() => setInput(suggestion)}
                    className="px-3 py-1.5 bg-nex-card border border-nex-border rounded-full text-xs text-nex-text-dim hover:text-nex-text hover:border-nex-accent/30 transition-all">
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
            {isAILoading && (
              <div className="flex gap-3 animate-in">
                <div className="w-8 h-8 rounded-lg nex-gradient flex items-center justify-center shrink-0">
                  <Bot size={16} className="text-white" />
                </div>
                <div className="bg-nex-card border border-nex-border rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 text-sm text-nex-text-dim">
                    <Loader2 size={14} className="animate-spin text-nex-accent" />
                    <span>Thinking ({aiMode})...</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="px-4 pb-4 pt-2 border-t border-nex-border/50 shrink-0">
        <div className="relative bg-nex-card border border-nex-border rounded-xl focus-within:border-nex-accent/50 focus-within:glow-accent transition-all">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={aiMode === 'local' ? 'Ask NEX AI (running locally)...' : 'Ask NEX AI anything about code...'}
            className="w-full bg-transparent px-4 py-3 pr-24 text-sm text-nex-text placeholder-nex-text-muted outline-none resize-none max-h-40"
            rows={1}
            style={{ height: 'auto', minHeight: '44px', maxHeight: '160px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 160) + 'px';
            }}
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-1">
            <button onClick={handleVoiceInput}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${isListening ? 'bg-red-500/20 text-red-400 animate-pulse' : 'text-nex-text-dim hover:text-nex-text hover:bg-nex-surface'}`}
              title="Voice input">
              {isListening ? <MicOff size={14} /> : <Mic size={14} />}
            </button>
            <button onClick={handleSend} disabled={!input.trim() || isAILoading}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${input.trim() && !isAILoading ? 'bg-nex-accent text-white hover:bg-nex-accent-light' : 'text-nex-text-muted cursor-not-allowed'}`}
              title="Send message">
              <Send size={14} />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between mt-2 px-1">
          <span className="text-[10px] text-nex-text-muted">
            Press Enter to send, Shift+Enter for new line
            {activeFile && ' • Active file context attached'}
          </span>
          <span className="text-[10px] text-nex-text-muted">
            {input.length > 0 && `${input.length} chars`}
          </span>
        </div>
      </div>
    </div>
  );
}
