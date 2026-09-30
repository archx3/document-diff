/**
 * Getting documents in: files (chosen, dropped, opened with the installed
 * app, or picked from a cloud drive), pastes, several versions of one
 * document, review files and the sample drafts; and swapping A and B, or
 * starting again.
 */
import type { ChangeEvent, RefObject } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Comparison } from '../../core/compare';
import type { Doc } from '../../core/model';
import type { CompareOptions } from '../../core/tokens';
import { orderVersions, paragraphHistory } from '../../core/versions';
import { ACCEPTED_EXTENSIONS, LoadError, loadFile, loadPaste } from '../../formats/load';
import { withKnownPictures } from '../../image/draw';
import type { CloudKind, DriveRevision } from '../../lib/cloud';
import { CLOUD_NAME, PickCancelled, availableClouds, driveRefOf, driveRevisionFile, noteDrive, pickFromCloud } from '../../lib/cloud';
import { noteSource } from '../../lib/sources';
import type { MediaKind } from '../../media/kinds';
import { acceptFor } from '../../components/kind-picker';
import type { DialogState } from '../dialogs';
import { useFileDrop } from '../drop';
import type { LoadKind } from '../empty';
import type { DocHistory } from '../history';
import { NO_DOCS } from '../history';
import { useStable } from '../hooks';
import type { ReviewContent } from '../review-file';
import { REVIEW_EXT, WrongPassword, unpackReview } from '../review-file';
import type { SavedExtra } from '../session';
import type { ToastFn } from '../toasts';
import type { Side } from '../util';
import { SIDE_NAME, isTyping, other, plural } from '../util';
import { hasText, sampleDocs, withDoc } from './docs';
import type { Navigation } from './use-navigation';
import type { Pop } from './pop';

/** The files the file picker offers: documents, pictures, recordings and review files. */
export const ACCEPT = [...ACCEPTED_EXTENSIONS, REVIEW_EXT].map((e) => `.${e}`).join(',');

/** What goes with the documents (the review, notes and findings): cleared, swapped and read back with them. */
export interface Extras {
  clear(): void;
  swap(): void;
  load(extra: SavedExtra): void;
}

interface LoadingDeps {
  history: DocHistory;
  a: Doc | null;
  b: Doc | null;
  kind: MediaKind;
  cmp: Comparison | null;
  opts: CompareOptions;
  toast: ToastFn;
  setBusy(message: string): void;
  dialog: DialogState | null;
  setDialog(dialog: DialogState | null): void;
  /** The dialog on the page, which closes to let the file picker open. */
  dialogEl: RefObject<HTMLDialogElement | null>;
  setPop(pop: Pop | null): void;
  navigation: Pick<Navigation, 'fromTop' | 'setCurrentState'>;
  extras: Extras;
}

export type Loading = ReturnType<typeof useLoading>;

export function useLoading({ history, a, b, kind, cmp, opts, toast, setBusy, dialog, setDialog, dialogEl, setPop, navigation, extras }: LoadingDeps) {
  const { fromTop, setCurrentState } = navigation;
  /** The file picker, and what its files are for. */
  const file = useRef<HTMLInputElement>(null);
  const fileTarget = useRef<Side | 'versions'>('a');
  /** Drafts of the document, in order: any two of them are compared. */
  const [versions, setVersions] = useState<Doc[]>(() => [history.now.a, history.now.b].filter((d): d is Doc => !!d && !history.now.sample));
  const clouds = useMemo(() => availableClouds(), []);
  /** The kind of file the load menu opens (it starts as what is compared). */
  const [loadMedia, setLoadMedia] = useState<MediaKind>(kind);
  useEffect(() => setLoadMedia(kind), [kind]);

  const swap = () => {
    const now = history.latest();
    if (!now.a && !now.b) return;
    history.commit('Swap A and B', { ...now, a: now.b, b: now.a, edits: { a: now.edits.b, b: now.edits.a } });
    extras.swap();
  };

  const startOver = () => {
    const now = history.latest();
    if (now.a || now.b) history.commit('New comparison', NO_DOCS);
    extras.clear();
  };

  const loadSamples = () => {
    history.commit('Load samples', sampleDocs());
    extras.clear();
    setCurrentState(0);
  };

  /** Installs a newly loaded document. Loading over the samples clears them. */
  const install = (side: Side, doc: Doc, message: string) => {
    const now = history.latest();
    history.commit(`Load ${SIDE_NAME[side]}`, withDoc(now.sample ? NO_DOCS : now, side, doc, 0));
    // With two documents, replacing one replaces it; once there are more versions, a loaded document is one more.
    setVersions((vs) => {
      if (vs.includes(doc)) return vs;
      if (vs.length > 2) return [...vs, doc];
      const kept = now.sample ? null : side === 'a' ? now.b : now.a;
      return (side === 'a' ? [doc, kept] : [kept, doc]).filter((d): d is Doc => !!d);
    });
    fromTop();
    toast(message, { undo: true });
  };

  /** Reads files as versions of one document, in the order their names give, and compares the last two. */
  const loadVersions = async (files: File[]) => {
    const read: Doc[] = [];
    for (const f of files) {
      setBusy(`Reading ${f.name}…`);
      try {
        await new Promise((r) => setTimeout(r, 20));
        const doc = await loadFile(f);
        if (!hasText(doc)) throw new LoadError(`"${f.name}" has no text to compare.`);
        noteSource(doc, f);
        noteDrive(doc, f);
        read.push(doc);
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), { error: true });
      } finally {
        setBusy('');
      }
    }
    if (!read.length) return;
    const now = history.latest();
    const all = orderVersions([...(now.sample ? [] : versions), ...read]);
    setVersions(all);
    if (all.length < 2) {
      install('a', all[0]!, `Loaded “${all[0]!.name}”`);
      return;
    }
    comparePair(all.length - 2, all.length - 1, all, `Loaded ${plural(read.length, 'version')}: comparing the last two`);
  };

  /** Compares two of the versions. */
  const comparePair = (ia: number, ib: number, list: readonly Doc[] = versions, message?: string) => {
    const va = list[ia];
    const vb = list[ib];
    if (!va || !vb || ia === ib) return;
    history.commit(`Compare ${va.name} with ${vb.name}`, { a: va, b: vb, edits: { a: 0, b: 0 }, sample: false });
    fromTop();
    toast(message ?? `Comparing ${ia + 1}. ${va.name} with ${ib + 1}. ${vb.name}`, { undo: true });
  };
  const pickVersion = (side: Side, index: number) => {
    const ia = side === 'a' ? index : versions.indexOf(a!);
    const ib = side === 'b' ? index : versions.indexOf(b!);
    if (ia < 0 || ib < 0) {
      // The other side is an edited document: keep it.
      const v = versions[index];
      if (v) install(side, v, `${v.name} is now ${SIDE_NAME[side]}`);
      return;
    }
    comparePair(ia, ib);
  };
  const stepVersions = (delta: 1 | -1) => {
    const ia = versions.indexOf(a!);
    const base = Math.min(Math.max((ia < 0 ? versions.length - 2 : ia) + delta, 0), versions.length - 2);
    comparePair(base, base + 1);
  };
  /** One paragraph (of a change's row) through every version. */
  const showHistory = (rowKey: string) => {
    const row = cmp?.rows.find((r) => r.key === rowKey);
    if (!cmp || !row) return;
    setPop(null);
    const ib = versions.indexOf(cmp.right);
    const ia = versions.indexOf(cmp.left);
    const start = row.r && ib >= 0 ? { at: ib, block: row.r } : row.l && ia >= 0 ? { at: ia, block: row.l } : null;
    if (!start) {
      toast('The paragraph’s history is kept for the versions as loaded. Undo the edits to see it.', { error: true });
      return;
    }
    setDialog({ type: 'history', steps: paragraphHistory(versions, start.at, start.block, opts) });
  };

  /* ------------------------------------------------------- review files */

  /** Opens a review file: its documents, versions and review take the place of what is here. */
  const applyReview = (content: ReviewContent & { reviewer?: string }, name: string) => {
    history.commit(`Open ${name}`, content.docs);
    const vs = content.versions.length ? content.versions : [content.docs.a, content.docs.b].filter((d): d is Doc => !!d);
    setVersions(vs);
    extras.load(content.extra);
    fromTop();
    toast(`Opened “${name}”${content.reviewer ? `, reviewed by ${content.reviewer}` : ''}`, { undo: true });
  };

  const openReview = async (name: string, bytes: Uint8Array, password?: string) => {
    setBusy(`Opening ${name}…`);
    try {
      const content = await unpackReview(bytes, password);
      for (const d of new Set([content.docs.a, content.docs.b, ...content.versions])) if (d) await withKnownPictures(d);
      applyReview(content, name);
      setDialog(null);
    } catch (err) {
      if (err instanceof WrongPassword) setDialog({ type: 'unlock', name, bytes, error: password ? err.message : undefined });
      else toast((err as Error).message, { error: true });
    } finally {
      setBusy('');
    }
  };

  /* -------------------------------------------------- files and pastes */

  const loadFiles = async (files: File[], side: Side | 'versions') => {
    const review = files.find((f) => f.name.toLowerCase().endsWith(`.${REVIEW_EXT}`));
    if (review) {
      await openReview(review.name, new Uint8Array(await review.arrayBuffer()));
      return;
    }
    if (side === 'versions' || files.length > 2) {
      await loadVersions(files);
      return;
    }
    const targets: Side[] = files.length > 1 ? [side, other(side)] : [side];
    for (let i = 0; i < Math.min(2, files.length); i++) {
      const f = files[i]!;
      const s = targets[i]!;
      setBusy(`Reading ${f.name}…`);
      try {
        // Lets the message show before the file is read.
        await new Promise((r) => setTimeout(r, 20));
        const doc = await loadFile(f);
        if (!hasText(doc)) throw new LoadError(`"${f.name}" has no text to compare.`);
        noteSource(doc, f);
        noteDrive(doc, f);
        install(s, doc, `Loaded “${f.name}” as ${SIDE_NAME[s]}`);
      } catch (err) {
        if (err instanceof LoadError && err.googleDocId !== undefined) {
          setDialog({ type: 'gdoc', side: s, presetId: err.googleDocId });
          return;
        }
        toast(err instanceof Error ? err.message : String(err), { error: true });
        console.error(err);
        return;
      } finally {
        setBusy('');
      }
    }
  };

  const loadPasted = (side: Side, html: string, text: string) => {
    try {
      const { doc, source } = loadPaste(html, text);
      if (!hasText(doc)) {
        toast('The clipboard has no text to compare.', { error: true });
        return;
      }
      const from = source === 'google-docs' ? 'from Google Docs' : source === 'word' ? 'from Word' : source === 'text' ? 'as plain text' : '';
      install(side, doc, `Pasted ${from} into ${SIDE_NAME[side]}`.replace('  ', ' '));
    } catch (err) {
      toast(`The pasted content could not be read. ${(err as Error).message}`, { error: true });
    }
  };

  // Files opened with the installed app ("Open with Collate") load as if they were dropped here.
  const launched = useStable(async (files: File[]) => {
    if (files.length) await loadFiles(files, 'a');
  });
  useEffect(() => {
    const queue = (window as { launchQueue?: { setConsumer(cb: (p: { files?: Array<{ getFile(): Promise<File> }> }) => void): void } }).launchQueue;
    queue?.setConsumer((p) => {
      if (p.files?.length) void Promise.all(p.files.map((h) => h.getFile())).then(launched);
    });
  }, [launched]);

  /** Documents from a cloud drive's picker: one fills `side`, two fill both, more are versions. */
  const loadFromCloud = async (cloud: CloudKind, side: Side) => {
    try {
      const files = await pickFromCloud(cloud, { multiple: true, extensions: ACCEPTED_EXTENSIONS });
      if (files.length) await loadFiles(files, side);
    } catch (err) {
      if (!(err instanceof PickCancelled)) toast(`${CLOUD_NAME[cloud]}: ${(err as Error).message}`, { error: true });
    }
  };
  /** An earlier version of a Drive file, compared with it (it goes on the other side). */
  const loadRevision = async (side: Side, rev: DriveRevision) => {
    const ref = dialog?.type === 'revisions' ? dialog.ref : undefined;
    if (!ref) return;
    setDialog(null);
    setBusy('Getting that version from Google Drive…');
    try {
      await loadFiles([await driveRevisionFile(ref, rev)], side);
    } catch (err) {
      toast((err as Error).message, { error: true });
    } finally {
      setBusy('');
    }
  };

  const startLoad = (how: LoadKind, side: Side) => {
    setPop(null);
    if (how === 'gdrive' || how === 'onedrive' || how === 'dropbox') {
      void loadFromCloud(how, side);
      return;
    }
    if (how === 'drive-version') {
      const doc = side === 'a' ? a : b;
      const ref = doc && driveRefOf(doc);
      if (ref) setDialog({ type: 'revisions', side: other(side), ref });
      return;
    }
    if (how === 'file') {
      // The file input is outside the dialog, which must close first to let it open.
      dialogEl.current?.close();
      fileTarget.current = side;
      // Only the kind of file chosen first.
      if (file.current) file.current.accept = acceptFor(loadMedia);
      file.current?.click();
    } else if (how === 'paste') setDialog({ type: 'paste', side });
    else setDialog({ type: 'gdoc', side });
  };

  /** Opens the file picker, for a side (or both) or for more versions. */
  const chooseFiles = (target: Side | 'versions') => {
    fileTarget.current = target;
    file.current?.click();
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = '';
    e.currentTarget.accept = ACCEPT;
    // For a side: one file replaces it, two replace both; more versions come by "Add versions".
    if (fileTarget.current !== 'versions' && files.length > 2) {
      toast('Choose one file, or two (for A and B).', { error: true });
      return;
    }
    if (files.length) void loadFiles(files, fileTarget.current);
  };

  // Pasting anywhere loads the clipboard into a side that is still empty.
  const onPaste = useStable((e: ClipboardEvent) => {
    if (dialog || isTyping(e)) return;
    const now = history.latest();
    const empty: Side | undefined = !now.a ? 'a' : !now.b ? 'b' : undefined;
    if (!empty) return;
    const html = e.clipboardData?.getData('text/html') ?? '';
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!html.trim() && !text.trim()) return;
    e.preventDefault();
    loadPasted(empty, html, text);
  });
  useEffect(() => {
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [onPaste]);

  // Files dropped on a half of the window load there; one dropped on a dialog's drop zone, on its side.
  const drop = useFileDrop((files, target, x) => {
    let side: Side = (target?.closest<HTMLElement>('[data-side]')?.dataset.side as Side | undefined) ?? (x < window.innerWidth / 2 ? 'a' : 'b');
    if (dialog) {
      const zone = target?.closest<HTMLElement>('.dropzone');
      if (zone?.dataset.side) side = zone.dataset.side as Side;
      setDialog(null);
    }
    void loadFiles(files, side);
  });

  return {
    file,
    versions,
    clouds,
    loadMedia,
    setLoadMedia,
    swap,
    startOver,
    loadSamples,
    pickVersion,
    stepVersions,
    showHistory,
    openReview,
    loadPasted,
    loadRevision,
    startLoad,
    chooseFiles,
    onFile,
    drop,
  };
}
