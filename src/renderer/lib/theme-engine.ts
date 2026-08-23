/**
 * NEX AI — Theme Engine (Phase 31)
 *
 * Resolves CSS custom properties to actual color values for the Orb,
 * and manages theme selection + persistence using the existing
 * settings system.
 *
 * The Orb receives actual hex colors (Three.js can't parse CSS vars),
 * while the rest of the UI uses CSS variables directly.
 */

// ─── Theme List (matches tokens.css exactly) ────────────────────────────────

export interface NexTheme {
  id: string;
  name: string;
  /** Display description */
  hint: string;
}

export const NEX_THEMES: NexTheme[] = [
  { id: 'cyan', name: 'Cyan', hint: 'Electric cyan / deep blue' },
  { id: 'electric-blue', name: 'Electric Blue', hint: 'Bright energy blue' },
  { id: 'deep-blue', name: 'Deep Blue', hint: 'Ocean depth' },
  { id: 'azure', name: 'Azure', hint: 'Sky clarity' },
  { id: 'turquoise', name: 'Turquoise', hint: 'Tropical clarity' },
  { id: 'violet', name: 'Violet', hint: 'Cosmic purple' },
  { id: 'purple', name: 'Purple', hint: 'Royal depth' },
  { id: 'magenta', name: 'Magenta', hint: 'Neon intensity' },
  { id: 'pink', name: 'Pink', hint: 'Soft luminance' },
  { id: 'red', name: 'Red', hint: 'Focused energy' },
  { id: 'orange', name: 'Orange', hint: 'Warm signal' },
  { id: 'amber', name: 'Amber', hint: 'Golden warmth' },
  { id: 'gold', name: 'Gold', hint: 'Precise luxury' },
  { id: 'lime', name: 'Lime', hint: 'Fresh signal' },
  { id: 'green', name: 'Green', hint: 'Natural flow' },
  { id: 'ice', name: 'Ice', hint: 'Crystalline light' },
];

export const DEFAULT_THEME = 'cyan';

export function isValidTheme(id: string): boolean {
  return NEX_THEMES.some((t) => t.id === id);
}

// ─── CSS Variable Resolution (for the Orb) ──────────────────────────────────

/**
 * Resolve a CSS custom property to its actual computed value.
 * Must be called in the browser (document must exist).
 */
export function resolveCssVar(varName: string): string {
  if (typeof document === 'undefined') return '#00e5ff'; // fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || '#00e5ff';
}

/**
 * Get the current theme's Orb colors as hex strings (for Three.js).
 * Called on theme change; Orb updates shader uniforms without recreating geometry.
 */
export function getOrbColors(): { primary: string; secondary: string } {
  return {
    primary: resolveCssVar('--nex-orb-primary'),
    secondary: resolveCssVar('--nex-orb-secondary'),
  };
}

// ─── Theme Application ──────────────────────────────────────────────────────

/**
 * Apply a theme to the document root (sets data-theme attribute).
 * CSS variables cascade instantly — no page reload needed.
 */
export function applyTheme(themeId: string): void {
  if (!isValidTheme(themeId)) themeId = DEFAULT_THEME;
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', themeId);
  }
}

/**
 * Get the currently applied theme from the document.
 */
export function getCurrentTheme(): string {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  return document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
}

// ─── Theme Persistence (uses existing settings system) ─────────────────────

const THEME_SETTING_KEY = 'nexTheme';

export function persistTheme(themeId: string): void {
  if (!isValidTheme(themeId)) return;
  try {
    window.nexAPI?.configSet?.(THEME_SETTING_KEY, themeId).catch(() => {});
  } catch { /* IPC may not be available */ }
}

export async function restoreTheme(): Promise<string> {
  try {
    const saved = await window.nexAPI?.configGet?.(THEME_SETTING_KEY);
    if (saved && isValidTheme(String(saved))) {
      applyTheme(String(saved));
      return String(saved);
    }
  } catch { /* fall through to default */ }
  applyTheme(DEFAULT_THEME);
  return DEFAULT_THEME;
}

// ─── Theme Preview Colors (for the selector UI) ─────────────────────────────

/**
 * Get the accent + orb colors for a theme without applying it.
 * Reads from a temporary element with the theme's data-theme attribute.
 */
export function getThemePreview(themeId: string): { accent: string; orb: string; orbSecondary: string } {
  if (typeof document === 'undefined') {
    return { accent: '#00e5ff', orb: '#00e5ff', orbSecondary: '#2563ff' };
  }
  const el = document.createElement('div');
  el.setAttribute('data-theme', themeId);
  el.style.display = 'none';
  document.body.appendChild(el);
  const style = getComputedStyle(el);
  const accent = style.getPropertyValue('--nex-accent').trim() || '#00e5ff';
  const orb = style.getPropertyValue('--nex-orb-primary').trim() || '#00e5ff';
  const orbSecondary = style.getPropertyValue('--nex-orb-secondary').trim() || '#2563ff';
  document.body.removeChild(el);
  return { accent, orb, orbSecondary };
}
