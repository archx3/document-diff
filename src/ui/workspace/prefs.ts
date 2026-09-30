/**
 * What the workspace keeps in this browser: its view settings, the reader's
 * name and the colour theme; and the screen sizes its layout follows.
 */
import { useEffect, useState } from 'react';
import type { Lang } from '../../check/spell';
import type { CompareOptions } from '../../core/tokens';
import { DEFAULT_OPTIONS } from '../../core/tokens';
import { currentTheme, onSystemThemeChange, toggleTheme } from '../theme';
import type { View } from '../util';

const PREFS_KEY = 'collate.prefs.v1';
/** The reader's name, put on the changes in a redline. */
const AUTHOR_KEY = 'collate.author.v1';
/** Below this width the list of changes covers the documents instead of sitting beside them. */
const PANEL_OVERLAYS = '(max-width: 1099px)';
/** Below this width there is no room for two columns: the view is always unified. */
const PHONE = '(max-width: 640px)';

/** View settings kept in this browser. */
export interface Prefs {
  opts: CompareOptions;
  changesOnly: boolean;
  view: View;
  minimap: boolean;
  lines: boolean;
  /** Side by side, each document unbroken with bands joining the changes (rather than aligned rows). */
  bands: boolean;
  lowContrast: boolean;
  sidebar: boolean;
  /** Review mode: notes, highlights and reactions, and the margins to add them from. */
  review: boolean;
  /** Spelling and grammar checking, its language, and whether Claude may be asked. */
  check: boolean;
  lang: Lang;
  claude: boolean;
}

export type SetPref = (patch: Partial<Prefs>) => void;

/** British spelling where the browser's language says so. */
function defaultLang(): Lang {
  return /^en-(GB|AU|NZ|IE|ZA|IN)/i.test(globalThis.navigator?.language ?? '') ? 'en-GB' : 'en-US';
}

/** Whether the list of changes covers the documents (on a narrow screen) rather than sitting beside them. */
export function panelOverlays(): boolean {
  return window.matchMedia?.(PANEL_OVERLAYS).matches ?? false;
}

/** Whether a media query matches, kept up to date. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

function loadPrefs(): Prefs {
  const prefs: Prefs = {
    opts: { ...DEFAULT_OPTIONS },
    changesOnly: false,
    view: 'split',
    minimap: false,
    lines: false,
    bands: true,
    lowContrast: false,
    sidebar: false,
    review: false,
    check: false,
    lang: defaultLang(),
    claude: false,
  };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return prefs;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      opts: { ...DEFAULT_OPTIONS, ...p.opts },
      changesOnly: !!p.changesOnly,
      view: p.view === 'unified' ? 'unified' : 'split',
      minimap: !!p.minimap,
      lines: !!p.lines,
      bands: p.bands ?? true,
      lowContrast: !!p.lowContrast,
      // An open list would cover a narrow screen's documents; it opens on request there.
      sidebar: !!p.sidebar && !panelOverlays(),
      review: !!p.review,
      check: !!p.check,
      lang: p.lang === 'en-GB' || p.lang === 'en-US' ? p.lang : defaultLang(),
      claude: !!p.claude,
    };
  } catch {
    /* storage unavailable */
    return prefs;
  }
}

/**
 * The view settings, kept in this browser as they change, and the view they
 * make on this screen: a phone has room for one column only.
 */
export function usePrefs(): { prefs: Prefs; setPref: SetPref; phone: boolean; view: View; elastic: boolean } {
  const [prefs, setPrefs] = useState(loadPrefs);
  const phone = useMediaQuery(PHONE);
  const view: View = phone ? 'unified' : prefs.view;
  /** Side by side with each document unbroken and bands joining the changes. */
  const elastic = view === 'split' && prefs.bands;
  const setPref = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable */
    }
  }, [prefs]);
  return { prefs, setPref, phone, view, elastic };
}

/** The reader's name, for their marks, redlines and review files (none until they give one), and a way to change it. */
export function useAuthor(): { author: string; saveAuthor(name: string): void; me(): string | undefined } {
  const [author, setAuthor] = useState(() => {
    try {
      return localStorage.getItem(AUTHOR_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const saveAuthor = (name: string) => {
    setAuthor(name);
    try {
      localStorage.setItem(AUTHOR_KEY, name);
    } catch {
      /* storage unavailable */
    }
  };
  return { author, saveAuthor, me: () => author.trim() || undefined };
}

/** Whether the page is dark (following the system until the reader chooses), and a switch between light and dark. */
export function useDarkTheme(): { dark: boolean; switchTheme(): void } {
  const [dark, setDark] = useState(() => currentTheme() === 'dark');
  useEffect(() => onSystemThemeChange(() => setDark(currentTheme() === 'dark')), []);
  const switchTheme = () => {
    toggleTheme();
    setDark(currentTheme() === 'dark');
  };
  return { dark, switchTheme };
}
