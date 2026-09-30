/**
 * Changing the documents: copying changes from one to the other (all of
 * them, one, a row, or the words of one), putting A's text back in B for
 * the rejected changes, and undoing and redoing.
 */
import type { Comparison } from '../../core/compare';
import type { Dir, Selection } from '../../core/merge';
import { applySelection, selectAll, selectHunk, selectInline, selectRows, selectTableRow } from '../../core/merge';
import type { CompareOptions } from '../../core/tokens';
import type { Decision } from '../../review/marks';
import type { DocHistory } from '../history';
import { useStable } from '../hooks';
import type { ToastFn } from '../toasts';
import type { Side } from '../util';
import { plural } from '../util';
import { backendFor, inlineWords, withDoc } from './docs';
import type { Pop } from './pop';

interface EditingDeps {
  history: DocHistory;
  cmp: Comparison | null;
  opts: CompareOptions;
  /** The current change. */
  cur: number;
  /** The reader's decision on each change. */
  decided: ReadonlyMap<number, Decision>;
  toast: ToastFn;
  setPop(pop: Pop | null): void;
  openPop(pop: Pop): void;
  setCurrentState(h: number): void;
}

export type Editing = ReturnType<typeof useEditing>;

export function useEditing({ history, cmp, opts, cur, decided, toast, setPop, openPop, setCurrentState }: EditingDeps) {
  const apply = (dir: Dir, sel: Selection, verb: string) => {
    const now = history.latest();
    if (!cmp || !now.a || !now.b) return;
    const side: Side = dir === 'l2r' ? 'b' : 'a';
    const backend = backendFor(now[side]!);
    let res;
    try {
      res = applySelection(cmp, dir, sel, backend);
    } catch (err) {
      console.error(err);
      toast(`That change could not be copied: ${(err as Error).message}`, { error: true });
      return;
    }
    if (!res.applied) return;
    history.commit(verb, withDoc(now, side, res.doc, now.edits[side] + res.applied));
    toast(res.applied > 1 ? `${verb}: ${plural(res.applied, 'change')}` : verb, { undo: true });
  };

  const applyCurrent = (dir: Dir) => {
    if (!cmp || cur < 0) return;
    apply(dir, selectHunk(cmp, cur), dir === 'l2r' ? 'Copied to B' : 'Copied to A');
  };

  const applyAll = (dir: Dir) => {
    if (cmp) apply(dir, selectAll(cmp), dir === 'l2r' ? 'B now matches A' : 'A now matches B');
  };

  /** Puts A's text back in B for every rejected change: B becomes the version the decisions make. */
  const applyDecisions = () => {
    if (!cmp) return;
    const rows = [...decided].filter(([, s]) => s === 'rejected').flatMap(([h]) => cmp.rows.slice(cmp.hunks[h]!.start, cmp.hunks[h]!.end));
    if (!rows.length) return;
    const k = new Set(rows.map((r) => r.hunk)).size;
    apply('l2r', selectRows(rows), `Put back A’s text for ${plural(k, 'rejected change')} in B`);
  };

  /** Copies a whole change across (the view with connection bands has one pair of arrows per change). */
  const copyHunk = useStable((h: number, dir: Dir) => {
    if (!cmp || !cmp.hunks[h]) return;
    setCurrentState(h);
    apply(dir, selectHunk(cmp, h), dir === 'l2r' ? 'Copied to B' : 'Copied to A');
  });

  /** Copies a row, or one row of a table, across. */
  const copyRow = useStable((rowKey: string, dir: Dir, sub?: string) => {
    const row = cmp?.rows.find((r) => r.key === rowKey);
    if (!row) return;
    setCurrentState(row.hunk);
    apply(dir, sub ? selectTableRow(rowKey, sub) : selectRows([row]), dir === 'l2r' ? 'Copied to B' : 'Copied to A');
  });

  const copyWording = (rowKey: string, change: number, dir: Dir) => {
    setPop(null);
    const row = cmp?.rows.find((r) => r.key === rowKey);
    if (row) setCurrentState(row.hunk);
    apply(dir, selectInline(rowKey, change), dir === 'l2r' ? 'Copied wording to B' : 'Copied wording to A');
  };

  /** A click on changed words offers to copy them across. */
  const onInline = useStable((anchor: HTMLElement, rowKey: string, change: number) => {
    if (inlineWords(cmp, opts, rowKey, change)) openPop({ type: 'inline', anchor, rowKey, change });
  });

  const undo = useStable(() => {
    const label = history.undo();
    if (label) toast(`Undid: ${label}`);
  });

  const redo = () => {
    const label = history.redo();
    if (label) toast(`Redid: ${label}`);
  };

  return { applyCurrent, applyAll, applyDecisions, copyHunk, copyRow, copyWording, onInline, undo, redo };
}
