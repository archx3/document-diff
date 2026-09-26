/**
 * Light and dark themes. The page follows the system setting until the reader
 * picks the other theme; the choice is kept in this browser and applies to
 * every page of the site. Choosing the system's own theme again goes back to
 * following the system.
 */

export type Theme = 'light' | 'dark';

const KEY = 'collate.theme';

/** For the page head: applies the stored theme before the first paint (src/ui/theme.ts). */
export const THEME_SCRIPT = `try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function systemTheme(): Theme {
  return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

/** The theme the page is showing. */
export function currentTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'dark' ? t : systemTheme();
}

export function setTheme(theme: Theme): void {
  const root = document.documentElement;
  const follow = theme === systemTheme();
  if (follow) delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (follow) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable: the choice lasts until the page is left */
  }
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/** Applies the stored theme (for pages without the head script). */
export function applyStoredTheme(): void {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch {
    /* storage unavailable */
  }
}

/** Calls `fn` when the system theme changes; returns a function that stops listening. */
export function onSystemThemeChange(fn: () => void): () => void {
  const mq = window.matchMedia?.(DARK_QUERY);
  if (!mq) return () => {};
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
}
