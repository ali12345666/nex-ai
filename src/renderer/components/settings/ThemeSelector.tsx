/**
 * NEX AI — Theme Selector (Phase 31)
 *
 * Premium glass-card grid of 16 themes with live preview colors.
 * Uses the existing token system. Persisted via configSet IPC.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Check } from 'lucide-react';
import { NEX_THEMES, DEFAULT_THEME, getThemePreview } from '../../lib/theme-engine';

export default function ThemeSelector() {
  const [activeTheme, setActiveTheme] = useState(DEFAULT_THEME);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const saved = await window.nexAPI?.configGet?.('nexTheme');
        if (saved && NEX_THEMES.some((t) => t.id === String(saved))) {
          setActiveTheme(String(saved));
        }
      } catch { /* default */ }
      setLoaded(true);
    })();
  }, []);

  const selectTheme = useCallback(async (themeId: string) => {
    setActiveTheme(themeId);
    document.documentElement.setAttribute('data-theme', themeId);
    try {
      await window.nexAPI?.configSet?.('nexTheme', themeId);
    } catch { /* non-critical */ }
  }, []);

  if (!loaded) return null;

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--nex-text)' }}>Theme</h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--nex-text-muted)' }}>
          Personalize the NEX AI environment
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="Color theme"
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2"
      >
        {NEX_THEMES.map((theme) => {
          const isActive = activeTheme === theme.id;
          const preview = getThemePreview(theme.id);
          return (
            <button
              key={theme.id}
              onClick={() => selectTheme(theme.id)}
              role="radio"
              aria-checked={isActive}
              aria-label={`${theme.name} theme${isActive ? ' (active)' : ''}`}
              className={`relative flex flex-col items-center gap-2 p-3 rounded-xl nex-click nex-focus transition-all duration-200 ${isActive ? 'nex-border-glow' : ''}`}
              style={{
                background: isActive ? 'var(--nex-accent-dim)' : 'var(--nex-glass-bg)',
                border: `1px solid ${isActive ? 'var(--nex-accent)' : 'var(--nex-glass-border)'}`,
                backdropFilter: 'blur(12px)',
              }}
            >
              <div
                className="rounded-full"
                style={{
                  width: 32, height: 32,
                  background: `radial-gradient(circle at 40% 40%, ${preview.orb} 0%, ${preview.orbSecondary} 70%, transparent 100%)`,
                  boxShadow: `0 0 ${isActive ? '16px' : '8px'} ${preview.accent}40`,
                  transition: 'box-shadow 0.2s ease',
                }}
                aria-hidden
              />
              <span
                className="text-[10px] font-semibold tracking-wide"
                style={{ color: isActive ? 'var(--nex-accent-text)' : 'var(--nex-text-dim)' }}
              >
                {theme.name.toUpperCase()}
              </span>
              {isActive && (
                <span
                  className="absolute top-2 right-2 flex items-center justify-center rounded-full"
                  style={{ width: 16, height: 16, background: 'var(--nex-accent)' }}
                  aria-label="Active theme"
                >
                  <Check size={10} style={{ color: 'var(--nex-bg)' }} />
                </span>
              )}
              <div
                className="w-full h-[2px] rounded-full"
                style={{ background: isActive ? preview.accent : 'transparent' }}
                aria-hidden
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
