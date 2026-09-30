/**
 * Getting documents out: each document as a file (or printed), the redline,
 * the report on the changes, and the review file that carries the documents
 * and their review to someone else.
 */
import { useState } from 'react';
import type { SummaryPoint } from '../../check/summary';
import type { Comparison } from '../../core/compare';
import type { Doc } from '../../core/model';
import type { Mark } from '../../review/marks';
import { placeMarks, redlineNotes } from '../../review/marks';
import { DECISION_NAME } from '../changes-panel';
import { exportDocument, exportMade, exportRedline, printDocument } from '../export';
import { saveFile } from '../files';
import type { DocHistory } from '../history';
import type { ReportChoices } from '../menus';
import { REACTION_NAME } from '../rail';
import { buildReport } from '../report';
import { REVIEW_EXT, packReview } from '../review-file';
import type { SavedExtra } from '../session';
import type { ToastFn } from '../toasts';
import type { Side } from '../util';
import { SIDE_NAME, baseName } from '../util';
import type { Pop } from './pop';

interface ExportsDeps {
  history: DocHistory;
  cmp: Comparison | null;
  b: Doc | null;
  marks: readonly Mark[];
  /** The reader's name, as the author of a redline and the reviewer of a review file. */
  author: string;
  me(): string | undefined;
  toast: ToastFn;
  setBusy(message: string): void;
  setPop(pop: Pop | null): void;
  /** The versions of the document (a review file keeps them when there are more than two). */
  versions: readonly Doc[];
  /** What goes into a review file with the documents: the review, notes and findings. */
  extras(): SavedExtra;
  /** Claude's summary of the changes, if asked for. */
  summary: readonly SummaryPoint[] | null;
}

export type Exports = ReturnType<typeof useExports>;

export function useExports({ history, cmp, b, marks, author, me, toast, setBusy, setPop, versions, extras, summary }: ExportsDeps) {
  const [redlineWithNotes, setRedlineWithNotes] = useState(true);
  const [reportChoices, setReportChoices] = useState<ReportChoices>({ format: 'pdf', openOnly: false, notedOnly: false, context: true, summary: true });

  const exportDoc = (format: string, side: Side) => {
    setPop(null);
    const now = history.latest();
    const doc = now[side];
    if (!doc) return;
    const base = baseName(doc) + (now.edits[side] ? ' (merged)' : '');
    if (format === 'print') printDocument(doc, base, () => toast('Printing isn’t available here. Download the document as PDF instead.', { error: true }));
    else void exportDocument(doc, SIDE_NAME[side], format, base, { toast, busy: setBusy });
  };

  /** The review notes and reactions a redline can carry as comments. */
  const notesForRedline = () => (cmp ? redlineNotes(placeMarks(marks, cmp), { ...REACTION_NAME, ...DECISION_NAME }) : []);
  /** Downloads the comparison as a Word file with tracked changes, named after B. */
  const downloadRedline = (format: 'docx' | 'pdf') => {
    setPop(null);
    if (!cmp || !b) return;
    void exportRedline(cmp, format, author, redlineWithNotes ? notesForRedline() : [], `${baseName(b)} (redline)`, { toast, busy: setBusy });
  };

  const downloadReport = () => {
    setPop(null);
    if (!cmp) return;
    const c = reportChoices;
    const doc = buildReport(
      cmp,
      placeMarks(marks, cmp),
      { reaction: REACTION_NAME, decision: DECISION_NAME },
      { openOnly: c.openOnly, notedOnly: c.notedOnly, context: c.context, reviewer: author, summary: c.summary ? summary?.map((p) => p.text) : undefined },
    );
    void exportMade(doc, c.format, { toast, busy: setBusy });
  };

  /** Saves the comparison and its review as a .collate file (locked with the password, if any). */
  const saveReview = async (password: string) => {
    setPop(null);
    const now = history.latest();
    if (!now.a || !now.b) return;
    setBusy(password ? 'Locking the review file…' : 'Making the review file…');
    try {
      const bytes = await packReview({ docs: now, extra: extras(), versions: versions.length > 2 ? [...versions] : [] }, { reviewer: me(), password: password || undefined });
      const name = `${baseName(now.b)} (review).${REVIEW_EXT}`;
      const res = await saveFile(name, new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
      if (res === 'saved') toast(password ? `Saved “${name}”, locked. Send the password separately.` : `Saved “${name}”. Anyone can open it in Collate.`);
      else if (res !== 'declined') toast('The review file could not be saved from this page.', { error: true });
    } catch (err) {
      console.error(err);
      toast(`The review file could not be made: ${(err as Error).message}`, { error: true });
    } finally {
      setBusy('');
    }
  };

  return { exportDoc, notesForRedline, downloadRedline, redlineWithNotes, setRedlineWithNotes, reportChoices, setReportChoices, downloadReport, saveReview };
}
