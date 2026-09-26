import { useMemo, useRef, useState } from 'react';
import type { Doc } from '../core/model';
import type { Side } from './util';

/** The two documents being compared, and what the reader did to them. */
export interface Docs {
  a: Doc | null;
  b: Doc | null;
  /** Changes copied into each side since it was loaded. */
  edits: Readonly<Record<Side, number>>;
  /** They are the sample drafts. */
  sample: boolean;
}

export const NO_DOCS: Docs = { a: null, b: null, edits: { a: 0, b: 0 }, sample: false };

const LIMIT = 200;

interface Entry {
  docs: Docs;
  label: string;
}

interface History {
  now: Docs;
  past: readonly Entry[];
  future: readonly Entry[];
}

export interface DocHistory {
  now: Docs;
  canUndo: boolean;
  canRedo: boolean;
  /** The documents as of the last change, even before the page shows it (for async work). */
  latest(): Docs;
  /** Moves to `docs`; undo comes back to the documents before, under `label`. */
  commit(label: string, docs: Docs): void;
  /** Goes back one change; returns what it was called, or null when there is nothing to undo. */
  undo(): string | null;
  redo(): string | null;
}

/** The documents, with undo and redo of every load, copy and swap. */
export function useDocHistory(init: () => Docs): DocHistory {
  const [history, setHistory] = useState<History>(() => ({ now: init(), past: [], future: [] }));
  // Handlers read and write through this, so two changes in a row build on each other.
  const latest = useRef(history);
  return useMemo(() => {
    const set = (h: History) => {
      latest.current = h;
      setHistory(h);
    };
    return {
      now: history.now,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      latest: () => latest.current.now,
      commit(label, docs) {
        const h = latest.current;
        set({ now: docs, past: [...h.past, { docs: h.now, label }].slice(-LIMIT), future: [] });
      },
      undo() {
        const h = latest.current;
        const last = h.past[h.past.length - 1];
        if (!last) return null;
        set({ now: last.docs, past: h.past.slice(0, -1), future: [...h.future, { docs: h.now, label: last.label }] });
        return last.label;
      },
      redo() {
        const h = latest.current;
        const next = h.future[h.future.length - 1];
        if (!next) return null;
        set({ now: next.docs, past: [...h.past, { docs: h.now, label: next.label }], future: h.future.slice(0, -1) });
        return next.label;
      },
    };
  }, [history]);
}
