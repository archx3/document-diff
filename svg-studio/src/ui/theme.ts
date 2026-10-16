export type Theme = 'light' | 'dark';

const KEY = 'svg-studio:theme';
const QUERY = '(prefers-color-scheme: dark)';

export const systemTheme = (): Theme => (window.matchMedia?.(QUERY).matches ? 'dark' : 'light');

export function currentTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'dark' ? t : systemTheme();
}

export function applyStoredTheme(): void {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch {
    /* storage unavailable */
  }
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* the choice lasts until the page is left */
  }
  return next;
}
