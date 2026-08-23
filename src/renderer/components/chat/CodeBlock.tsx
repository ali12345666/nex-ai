/**
 * NEX AI — Code Block Component (Phase 29)
 *
 * Syntax-highlighted code block with copy button and language label.
 * Pure TS highlighting (no new deps). Uses NEX token system.
 */

import React, { useState, useCallback } from 'react';
import { Check, Copy } from 'lucide-react';

function highlightCode(code: string, lang: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = esc(code);

  if (['ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml'].includes(lang)) {
    html = html.replace(/(&#39;[^&#39;\n]*&#39;|&#34;[^\n]*&#34;|"[^"\n]*")/g, '<span style="color:#a5d6ff">$1</span>');
    html = html.replace(
      /\b(const|let|var|function|return|if|else|for|while|switch|case|break|continue|new|class|extends|import|from|export|default|async|await|try|catch|finally|throw|typeof|instanceof|interface|type|enum|public|private|protected|readonly|static|get|set|yield|delete|in|of|do|this|super)\b/g,
      '<span style="color:#c792ea">$1</span>'
    );
    html = html.replace(/(\/\/[^\n]*)/g, '<span style="color:#546e7a">$1</span>');
    html = html.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#f78c6c">$1</span>');
    html = html.replace(/\b(true|false|null|undefined|NaN)\b/g, '<span style="color:#ff5874">$1</span>');
  } else if (lang === 'css' || lang === 'scss') {
    html = html.replace(/([a-z-]+)(\s*:)/g, '<span style="color:#82aaff">$1</span>$2');
    html = html.replace(/(\/\*[\s\S]*?\*\/)/g, '<span style="color:#546e7a">$1</span>');
  } else if (lang === 'py' || lang === 'python') {
    html = html.replace(
      /\b(def|class|return|if|elif|else|for|while|try|except|finally|with|as|import|from|pass|break|continue|lambda|yield|raise|in|not|and|or|is|None|True|False)\b/g,
      '<span style="color:#c792ea">$1</span>'
    );
    html = html.replace(/(#[^\n]*)/g, '<span style="color:#546e7a">$1</span>');
  } else if (lang === 'bash' || lang === 'sh' || lang === 'shell') {
    html = html.replace(/(#[^\n]*)/g, '<span style="color:#546e7a">$1</span>');
    html = html.replace(/\b(echo|cd|ls|cat|grep|find|npm|npx|node|git|export|source|sudo)\b/g, '<span style="color:#82aaff">$1</span>');
    html = html.replace(/(\$[A-Za-z_][A-Za-z0-9_]*)/g, '<span style="color:#f78c6c">$1</span>');
  } else if (lang === 'html') {
    html = html.replace(/(&lt;\/?[a-z][^&]*?&gt;)/gi, '<span style="color:#82aaff">$1</span>');
  }

  return html;
}

export interface CodeBlockProps {
  code: string;
  language?: string;
}

export default function CodeBlock({ code, language = '' }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }, [code]);

  const highlighted = highlightCode(code, language);

  return (
    <div
      className="rounded-lg overflow-hidden my-2"
      style={{ background: 'rgba(4, 6, 12, 0.9)', border: '1px solid var(--nex-glass-border)' }}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ borderBottom: '1px solid var(--nex-glass-border)' }}
      >
        <span className="text-[9px] font-mono tracking-wider" style={{ color: 'var(--nex-accent-text)' }}>
          {language || 'text'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] transition-colors hover:bg-white/[0.06]"
          style={{ color: copied ? 'var(--nex-success)' : 'var(--nex-text-muted)' }}
          aria-label={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? <Check size={10} /> : <Copy size={10} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        className="overflow-x-auto nex-scroll p-3 text-[11px] leading-relaxed"
        style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", color: '#c8d0e0' }}
      >
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}
