/**
 * NEX AI — Empty State Component
 *
 * Professional empty state with:
 *   - Animated illustration (CSS-only orb)
 *   - Short description
 *   - Call-to-action button
 */

import React from 'react';
import { Brain, Download, Search } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  variant?: 'models' | 'downloads' | 'installed' | 'generic';
}

export default function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  variant = 'generic',
}: EmptyStateProps) {
  const defaultIcon = variant === 'models' ? <Brain size={32} /> : variant === 'downloads' ? <Download size={32} /> : <Search size={32} />;

  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      {/* Animated orb illustration */}
      <div className="relative mb-6">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center animate-pulse"
          style={{
            background: 'var(--nex-accent-dim)',
            color: 'var(--nex-accent)',
            border: '2px solid var(--nex-accent-glow)',
            boxShadow: '0 0 30px var(--nex-accent-glow)',
          }}
        >
          {icon || defaultIcon}
        </div>
        {/* Orbital rings */}
        <div
          className="absolute inset-0 rounded-full animate-spin"
          style={{
            border: '1px solid var(--nex-accent-glow)',
            animationDuration: '8s',
            transform: 'scale(1.3)',
          }}
        />
        <div
          className="absolute inset-0 rounded-full animate-spin"
          style={{
            border: '1px dashed var(--nex-accent-glow)',
            animationDuration: '12s',
            animationDirection: 'reverse',
            transform: 'scale(1.6)',
          }}
        />
      </div>

      {/* Text */}
      <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--nex-text)' }}>{title}</h3>
      <p className="text-[11px] max-w-xs mb-4" style={{ color: 'var(--nex-text-muted)' }}>{description}</p>

      {/* CTA button */}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-medium transition-all nex-click"
          style={{
            background: 'var(--nex-accent-dim)',
            color: 'var(--nex-accent-text)',
            border: '1px solid var(--nex-accent-glow)',
          }}
        >
          {variant === 'models' && <Search size={12} />}
          {variant === 'downloads' && <Download size={12} />}
          {actionLabel}
        </button>
      )}
    </div>
  );
}
