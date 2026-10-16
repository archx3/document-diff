import { parseSvg } from '../core/svg-io';
import type { Doc } from '../core/types';
import { DEFAULT_SETTINGS, store, type Settings } from './store';

const KEY = 'svg-studio:v1';

export interface Saved {
  doc: Doc;
  name: string;
  settings: Settings;
}

/** The work saved by a previous visit, if there is any and it still makes sense. */
export function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Saved>;
    const d = v.doc;
    if (!d || !Array.isArray(d.children) || !(d.width > 0) || !(d.height > 0) || typeof d.defaults !== 'object') return null;
    return { doc: d, name: typeof v.name === 'string' ? v.name : 'untitled', settings: { ...DEFAULT_SETTINGS, ...(v.settings ?? {}) } };
  } catch {
    return null;
  }
}

/** Saves the document and view options to this browser a moment after each change. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = store.get();
  const save = () => {
    const s = store.get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ doc: s.doc, name: s.name, settings: s.settings } satisfies Saved));
    } catch {
      /* storage unavailable or full: the work is simply not kept */
    }
  };
  const unsubscribe = store.subscribe(() => {
    const s = store.get();
    if (s.doc === last.doc && s.name === last.name && s.settings === last.settings) return;
    last = s;
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  });
  return () => {
    unsubscribe();
    clearTimeout(timer);
  };
}

/** Lucide's sun icon, which opens the editor the first time: a circle and a ring of rays to select, group and transform. */
export const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="4" />
  <path d="M12 2v2" />
  <path d="M12 20v2" />
  <path d="m4.93 4.93 1.41 1.41" />
  <path d="m17.66 17.66 1.41 1.41" />
  <path d="M2 12h2" />
  <path d="M20 12h2" />
  <path d="m6.34 17.66-1.41 1.41" />
  <path d="m19.07 4.93-1.41 1.41" />
</svg>`;

export const sampleDoc = (): Doc => parseSvg(SAMPLE_SVG).doc;
