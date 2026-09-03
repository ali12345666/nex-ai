/**
 * Phase 34 / P34 — Token Migration Script
 * Maps old Tailwind nex-* classes to NEX CSS variables.
 * This is a reference mapping; the actual migration is done
 * via targeted replacements in each panel file.
 */

// Old Tailwind class → NEX token equivalent
export const TOKEN_MAP: Record<string, string> = {
  // Backgrounds
  'bg-nex-bg': 'bg-[var(--nex-bg)]',
  'bg-nex-surface': 'bg-[var(--nex-panel-solid)]',
  'bg-nex-card': 'bg-[var(--nex-glass-bg)]',
  // Text
  'text-nex-text': 'text-[var(--nex-text)]',
  'text-nex-text-dim': 'text-[var(--nex-text-dim)]',
  'text-nex-text-muted': 'text-[var(--nex-text-muted)]',
  'text-nex-accent': 'text-[var(--nex-accent)]',
  'text-nex-accent-light': 'text-[var(--nex-accent-text)]',
  'text-nex-success': 'text-[var(--nex-success)]',
  'text-nex-warning': 'text-[var(--nex-warning)]',
  'text-nex-error': 'text-[var(--nex-error)]',
  // Borders
  'border-nex-border': 'border-[var(--nex-glass-border)]',
  'border-nex-border-light': 'border-[var(--nex-panel-border-hover)]',
  'border-nex-accent': 'border-[var(--nex-accent)]',
  // Backgrounds with alpha (common patterns)
  'bg-nex-accent/10': 'bg-[var(--nex-accent-dim)]',
  'bg-nex-accent/20': 'bg-[var(--nex-accent-dim)]',
  'hover:bg-nex-card': 'hover:bg-white/[0.04]',
  'hover:bg-nex-surface': 'hover:bg-white/[0.03]',
  // Placeholder
  'placeholder-nex-text-muted': 'placeholder-[var(--nex-text-muted)]',
  'placeholder-nex-text-dim': 'placeholder-[var(--nex-text-dim)]',
  // Gradient
  'nex-gradient': '',
  'glow-accent': 'nex-glow',
  'glow-accent-strong': 'nex-glow',
};
