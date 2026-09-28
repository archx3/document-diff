import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { compareDocs, inlineDiff } from '../core/compare';
import { fullRange } from '../core/inline';
import type { Dir, Selection } from '../core/merge';
import { applySelection, selectAll, selectHunk, selectInline, selectRows, selectTableRow } from '../core/merge';
import type { Doc } from '../core/model';
import { isBlank } from '../core/model';
import { modelBackend } from '../core/model-backend';
import type { CompareOptions } from '../core/tokens';
import { DEFAULT_OPTIONS } from '../core/tokens';
import { docxBackend } from '../formats/docx/backend';
import { DocxPackage } from '../formats/docx/package';
import { readHtml } from '../formats/html/read';
import { ACCEPTED_EXTENSIONS, LoadError, loadFile, loadPaste } from '../formats/load';
import { odtBackend } from '../formats/odt/backend';
import { OdtPackage } from '../formats/odt/package';
import { noteSource } from '../lib/sources';
import { SAMPLE_A, SAMPLE_A_NAME, SAMPLE_B, SAMPLE_B_NAME } from '../samples/sample';
import { ChangesPanel } from './changes-panel';
import type { DialogState } from './dialogs';
import { Dialog, GoogleDocDialog, HelpDialog, PasteDialog } from './dialogs';
import { DropOverlay, useFileDrop } from './drop';
import type { LoadKind } from './empty';
import { EmptyState } from './empty';
import { exportDocument, printDocument } from './export';
import { ElasticLayout } from './elastic';
import { ElasticGrid } from './elastic-grid';
import type { Place } from './grid';
import { DocumentGrid, KeepPlace } from './grid';
import type { DocMenu } from './heads';
import { ColumnHeads } from './heads';
import type { Docs } from './history';
import { NO_DOCS, useDocHistory } from './history';
import { useInstance, useStable } from './hooks';
import { GridLayout, captureAnchor, restoreAnchor, scrollToHunk } from './layout';
import { CopyMenu, ExportMenu, InlineMenu, LoadMenu, OptionsMenu, Popover } from './menus';
import type { Notice } from './notices';
import { Notices } from './notices';
import { Overview } from './overview';
import { gridItems } from './rows';
import type { Restored, SessionScope } from './session';
import { SessionWriter } from './session';
import { currentTheme, onSystemThemeChange, toggleTheme } from './theme';
import { Toasts, useToasts } from './toasts';
import type { NavOff } from './toolbar';
import { ALL_NAV_OFF, AppBar, Toolbar } from './toolbar';
import { Tooltips } from './tooltip';
import type { Side, View } from './util';
import { SIDE_NAME, baseName, isTyping, other, plural, reducedMotion, sameText } from './util';

const ACCEPT = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(',');
const PREFS_KEY = 'collate.prefs.v1';
/** Below this width the list of changes covers the documents instead of sitting beside them. */
const PANEL_OVERLAYS = '(max-width: 1099px)';
/** Below this width there is no room for two columns: the view is always unified. */
const PHONE = '(max-width: 640px)';
/** Keys that scroll the documents when they have focus. */
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);

/** View settings kept in this browser. */
interface Prefs {
  opts: CompareOptions;
  changesOnly: boolean;
  view: View;
  minimap: boolean;
  lines: boolean;
  /** Side by side, each document unbroken with bands joining the changes (rather than aligned rows). */
  bands: boolean;
  lowContrast: boolean;
  sidebar: boolean;
}

function panelOverlays(): boolean {
  return window.matchMedia?.(PANEL_OVERLAYS).matches ?? false;
}

/** Whether a media query matches, kept up to date. */
function useMedia(query: string): boolean {
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
  const prefs: Prefs = { opts: { ...DEFAULT_OPTIONS }, changesOnly: false, view: 'split', minimap: false, lines: false, bands: true, lowContrast: false, sidebar: false };
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
    };
  } catch {
    /* storage unavailable */
    return prefs;
  }
}

function sampleDocs(): Docs {
  return {
    a: { ...readHtml(SAMPLE_A, SAMPLE_A_NAME), kind: 'sample' },
    b: { ...readHtml(SAMPLE_B, SAMPLE_B_NAME), kind: 'sample' },
    edits: { a: 0, b: 0 },
    sample: true,
  };
}

function withDoc(docs: Docs, side: Side, doc: Doc | null, edits: number): Docs {
  return side === 'a' ? { ...docs, a: doc, edits: { ...docs.edits, a: edits } } : { ...docs, b: doc, edits: { ...docs.edits, b: edits } };
}

/** An open menu, and the button (or word) it belongs to. */
type Pop =
  | { type: 'load' | 'export'; side: Side; anchor: HTMLElement }
  | { type: 'options' | 'copy'; anchor: HTMLElement }
  | { type: 'inline'; anchor: HTMLElement; rowKey: string; change: number };

export interface CompareAppProps {
  /** Documents to compare straight away. */
  docs?: { a: Doc; b: Doc | null };
  /** Without documents, show the sample drafts instead of asking for two. */
  sample?: boolean;
  /** Where the name in the app bar links to. */
  home?: string;
  /** Keeps the comparison in this browser under this name, so a reload brings it back. */
  session?: SessionScope;
  /** A comparison kept from before the page was reloaded, to carry on with. */
  restored?: Restored | null;
}

/** The comparison workspace. */
export function CompareApp({ docs, sample = false, home, session, restored }: CompareAppProps) {
  const history = useDocHistory(() =>
    restored ? restored.docs : docs ? { a: docs.a, b: docs.b, edits: { a: 0, b: 0 }, sample: false } : sample ? sampleDocs() : NO_DOCS,
  );
  const { a, b, edits } = history.now;
  const [prefs, setPrefs] = useState(loadPrefs);
  const { opts, changesOnly, minimap, lines, bands, lowContrast, sidebar } = prefs;
  // A phone has room for one column only.
  const phone = useMedia(PHONE);
  const view: View = phone ? 'unified' : prefs.view;
  /** Side by side with each document unbroken and bands joining the changes. */
  const elastic = view === 'split' && bands;
  const setPref = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable */
    }
  }, [prefs]);

  const [current, setCurrentState] = useState(() => restored?.view?.current ?? 0);
  /** Folds the reader opened, by the key of their first row. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  /** Notices the reader closed, which stay closed while the page is open. */
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState('');
  const [pop, setPop] = useState<Pop | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dark, setDark] = useState(() => currentTheme() === 'dark');
  const [nav, setNav] = useState<NavOff>(ALL_NAV_OFF);
  const { toasts, toast, dismiss: dismissToast } = useToasts();

  const cmp = useMemo(() => (a && b ? compareDocs(a, b, opts) : null), [a, b, opts]);
  const n = cmp?.hunks.length ?? 0;
  const cur = n ? Math.min(Math.max(current, 0), n - 1) : -1;
  // With no changes there is nothing to fold away.
  const items = useMemo(() => (cmp ? gridItems(cmp.rows, changesOnly && n > 0, expanded) : []), [cmp, changesOnly, n, expanded]);
  const same = sameText(opts);

  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const heads = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const dialogEl = useRef<HTMLDialogElement>(null);
  const fileTarget = useRef<Side>('a');
  /** The reader scrolled by hand since the last jump to a change. */
  const userScrolled = useRef(false);
  /** Runs once the page shows the next update. */
  const afterRender = useRef<(() => void) | null>(null);
  const layout = useInstance(GridLayout, () => new GridLayout(() => scroller.current, () => grid.current));
  const sessionWriter = useInstance(SessionWriter, () => new SessionWriter(session));
  const elasticLayout = useInstance(ElasticLayout, () => new ElasticLayout());
  /** Measures whichever grid is showing. */
  const lay = elastic ? elasticLayout : layout;
  /** The grid on the page is the one with connection bands (in a commit, it may not be the one being rendered). */
  const isElastic = () => !!grid.current?.classList.contains('egrid');
  const place = useMemo<Place>(
    () => ({
      capture: () => {
        const sc = scroller.current;
        const g = grid.current;
        if (!sc || !g) return null;
        return g.classList.contains('egrid') ? elasticLayout.capture() : captureAnchor(sc, g);
      },
      restore: (anchor) => {
        const sc = scroller.current;
        const g = grid.current;
        if (!sc || !g) return;
        if (g.classList.contains('egrid')) elasticLayout.restore(anchor);
        else restoreAnchor(sc, g, anchor);
      },
    }),
    [elasticLayout],
  );

  /** Scrolls a change into view in whichever grid is showing. */
  const scrollToChange = (h: number, smooth: boolean) => {
    const sc = scroller.current;
    const g = grid.current;
    if (!sc || !g) return;
    if (isElastic()) elasticLayout.scrollToHunk(h, smooth);
    else scrollToHunk(sc, g, h, smooth);
  };

  /* -------------------------------------------------------- navigation */

  /**
   * The change N (delta 1) or P (delta -1) goes to, or -1 when there is none.
   * After the reader scrolled away from the current change, it goes from what
   * is on screen instead.
   */
  const navTarget = (delta: 1 | -1): number => {
    if (!n) return -1;
    let base = cur;
    const sc = scroller.current;
    const L = userScrolled.current && sc ? lay.measure() : null;
    if (L && sc) {
      const top = sc.scrollTop + L.head;
      const bottom = sc.scrollTop + sc.clientHeight;
      const box = L.hunks[cur];
      if (!box || box.bottom <= top || box.top >= bottom) {
        // The first change that ends below the top of the screen (n when all are above it).
        let lo = 0;
        let hi = L.hunks.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (L.hunks[mid]!.bottom > top) hi = mid;
          else lo = mid + 1;
        }
        const next = lo < L.hunks.length ? L.hunks[lo]!.hunk : n;
        base = delta > 0 ? next - 1 : next;
      }
    }
    const t = base + delta;
    return t >= 0 && t < n ? t : -1;
  };

  /** Turns the change and page buttons off where they would do nothing. */
  const updateNav = () => {
    const sc = scroller.current;
    let next = ALL_NAV_OFF;
    if (cmp && sc) {
      const bottom = sc.scrollHeight - sc.clientHeight - 1;
      next = { prev: navTarget(-1) < 0, next: navTarget(1) < 0, pageUp: sc.scrollTop <= 0, pageDown: sc.scrollTop >= bottom };
    }
    setNav((v) => (v.prev === next.prev && v.next === next.next && v.pageUp === next.pageUp && v.pageDown === next.pageDown ? v : next));
  };
  const latestUpdateNav = useRef(updateNav);
  const navFrame = useRef(0);
  const scheduleNav = useCallback(() => {
    if (navFrame.current) return;
    navFrame.current = requestAnimationFrame(() => {
      navFrame.current = 0;
      latestUpdateNav.current();
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(navFrame.current), []);

  // After every update: queued work, then the navigation buttons.
  useLayoutEffect(() => {
    const fn = afterRender.current;
    afterRender.current = null;
    fn?.();
    latestUpdateNav.current = updateNav;
    updateNav();
  });

  /* ----------------------------------------------------------- session */

  const saveView = () => sessionWriter.view({ current: cur, scrollTop: scroller.current?.scrollTop ?? 0 });
  useEffect(() => sessionWriter.docs(history.now), [sessionWriter, history.now]);
  useEffect(saveView, [cur]);
  useEffect(() => {
    // A reload or a closed tab writes what is still waiting.
    const flush = () => void sessionWriter.flush();
    const hidden = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [sessionWriter]);
  // Back where the reader was before the reload.
  useEffect(() => {
    if (!restored) return;
    const top = restored.view?.scrollTop ?? 0;
    if (top > 0) requestAnimationFrame(() => scroller.current?.scrollTo({ top }));
    if (restored.lost.length) toast(`${restored.lost.join(' and ')} could not be opened again. Load ${restored.lost.length > 1 ? 'them' : 'it'} again to carry on.`, { error: true });
    // Once, for the comparison the page opened with.
  }, []);

  // Widening the gutter or the list of changes, or changing the view, moves every row.
  useLayoutEffect(() => layout.invalidate(), [layout, minimap, lines, sidebar, view]);

  const setCurrent = (h: number, scroll: boolean) => {
    setCurrentState(h);
    if (scroll) scrollToChange(h, !reducedMotion());
  };

  const step = (delta: 1 | -1) => {
    const t = navTarget(delta);
    if (t < 0) return;
    userScrolled.current = false;
    setCurrent(t, true);
  };

  /** Scrolls the documents by a screen, keeping a little of the last one in view. */
  const page = (delta: 1 | -1) => {
    const sc = scroller.current;
    if (!cmp || !sc) return;
    const bottom = sc.scrollHeight - sc.clientHeight - 1;
    if (delta < 0 ? sc.scrollTop <= 0 : sc.scrollTop >= bottom) return;
    userScrolled.current = true;
    setPop(null);
    sc.scrollBy({ top: delta * Math.max(80, sc.clientHeight - (heads.current?.offsetHeight ?? 0) - 48), behavior: reducedMotion() ? 'auto' : 'smooth' });
  };

  const goToChange = useStable((h: number) => {
    userScrolled.current = false;
    setCurrent(h, true);
    // Where the list covers the documents, get it out of the way (keyboard focus goes back to its button).
    if (!panelOverlays()) return;
    const hadFocus = !!document.activeElement?.closest('#changes');
    setPref({ sidebar: false });
    if (hadFocus) afterRender.current = () => root.current?.querySelector<HTMLElement>('#btn-sidebar')?.focus({ preventScroll: true });
  });

  /* ----------------------------------------------------------- editing */

  const apply = (dir: Dir, sel: Selection, verb: string) => {
    const now = history.latest();
    if (!cmp || !now.a || !now.b) return;
    const side: Side = dir === 'l2r' ? 'b' : 'a';
    const target = now[side]!;
    const backend = target.pkg instanceof DocxPackage ? docxBackend : target.pkg instanceof OdtPackage ? odtBackend : modelBackend;
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

  const undo = useStable(() => {
    const label = history.undo();
    if (label) toast(`Undid: ${label}`);
  });

  const redo = () => {
    const label = history.redo();
    if (label) toast(`Redid: ${label}`);
  };

  const swap = () => {
    const now = history.latest();
    if (!now.a && !now.b) return;
    history.commit('Swap A and B', { ...now, a: now.b, b: now.a, edits: { a: now.edits.b, b: now.edits.a } });
  };

  const startOver = () => {
    const now = history.latest();
    if (now.a || now.b) history.commit('New comparison', NO_DOCS);
  };

  const loadSamples = () => {
    history.commit('Load samples', sampleDocs());
    setCurrentState(0);
  };

  /* ----------------------------------------------------------- loading */

  /** Installs a newly loaded document. Loading over the samples clears them. */
  const install = (side: Side, doc: Doc, message: string) => {
    const now = history.latest();
    history.commit(`Load ${SIDE_NAME[side]}`, withDoc(now.sample ? NO_DOCS : now, side, doc, 0));
    setCurrentState(0);
    setExpanded(new Set());
    userScrolled.current = false;
    afterRender.current = () => scroller.current?.scrollTo({ top: 0 });
    toast(message, { undo: true });
  };

  const loadFiles = async (files: File[], side: Side) => {
    const targets: Side[] = files.length > 1 ? [side, other(side)] : [side];
    for (let i = 0; i < Math.min(2, files.length); i++) {
      const f = files[i]!;
      const s = targets[i]!;
      setBusy(`Reading ${f.name}…`);
      try {
        // Lets the message show before the file is read.
        await new Promise((r) => setTimeout(r, 20));
        const doc = await loadFile(f);
        if (!doc.blocks.some((x) => x.type !== 'marker' && !isBlank(x))) throw new LoadError(`"${f.name}" has no text to compare.`);
        noteSource(doc, f);
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
      if (!doc.blocks.some((x) => x.type !== 'marker' && !isBlank(x))) {
        toast('The clipboard has no text to compare.', { error: true });
        return;
      }
      const from = source === 'google-docs' ? 'from Google Docs' : source === 'word' ? 'from Word' : source === 'text' ? 'as plain text' : '';
      install(side, doc, `Pasted ${from} into ${SIDE_NAME[side]}`.replace('  ', ' '));
    } catch (err) {
      toast(`The pasted content could not be read. ${(err as Error).message}`, { error: true });
    }
  };

  const startLoad = (kind: LoadKind, side: Side) => {
    setPop(null);
    if (kind === 'file') {
      // The file input is outside the dialog, which must close first to let it open.
      dialogEl.current?.close();
      fileTarget.current = side;
      file.current?.click();
    } else if (kind === 'paste') setDialog({ type: 'paste', side });
    else setDialog({ type: 'gdoc', side });
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = '';
    if (files.length) void loadFiles(files, fileTarget.current);
  };

  /* -------------------------------------------------------------- view */

  const toggleChangesOnly = () => {
    if (!n) return;
    setPref({ changesOnly: !changesOnly });
    setExpanded(new Set());
    afterRender.current = () => {
      if (cur >= 0) scrollToChange(cur, false);
    };
  };

  const setView = (v: View) => {
    if (phone || v === prefs.view) return;
    setPref({ view: v });
  };

  const toggleBands = () => {
    if (cmp && view === 'split') setPref({ bands: !bands });
  };

  const toggleSidebar = (open = !sidebar) => {
    if (open !== sidebar && (!open || cmp)) setPref({ sidebar: open });
  };

  const switchTheme = () => {
    toggleTheme();
    setDark(currentTheme() === 'dark');
  };
  useEffect(() => onSystemThemeChange(() => setDark(currentTheme() === 'dark')), []);

  const openPop = (next: Pop) => setPop((p) => (p?.anchor === next.anchor ? null : next));
  const closePop = useCallback(() => setPop(null), []);
  const openDocMenu = (menu: DocMenu, side: Side, anchor: HTMLElement) => openPop({ type: menu, side, anchor });
  const openDialog = (d: DialogState) => {
    setPop(null);
    setDialog(d);
  };

  const exportDoc = (format: string, side: Side) => {
    setPop(null);
    const now = history.latest();
    const doc = now[side];
    if (!doc) return;
    const base = baseName(doc) + (now.edits[side] ? ' (merged)' : '');
    if (format === 'print') printDocument(doc, base, () => toast('Printing isn’t available here. Download the document as PDF instead.', { error: true }));
    else void exportDocument(doc, SIDE_NAME[side], format, base, { toast, busy: setBusy });
  };

  /** The words on each side of a word-level change, for its menu. */
  const inlineWords = (rowKey: string, change: number) => {
    const row = cmp?.rows.find((r) => r.key === rowKey);
    if (!row || row.l?.type !== 'p' || row.r?.type !== 'p') return null;
    const d = inlineDiff(row.l, row.r, opts);
    const ch = d.changes[change];
    if (!ch) return null;
    const words = (t: typeof d.a, c0: number, c1: number) => {
      const [f0, f1] = fullRange(t, c0, c1);
      return t.tokens
        .slice(f0, f1)
        .map((x) => x.text)
        .join('')
        .trim();
    };
    return { a: words(d.a, ch.a0, ch.a1), b: words(d.b, ch.b0, ch.b1), fmtOnly: ch.fmtOnly };
  };

  /* -------------------------------------------------- page-wide events */

  const onKey = useStable((e: KeyboardEvent) => {
    if (e.key === 'Escape' && pop) {
      setPop(null);
      return;
    }
    if (dialog || isTyping(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && !e.altKey && (k === 'z' || k === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && (k === 'y' || k === 'Y')) {
      e.preventDefault();
      redo();
      return;
    }
    if (mod) return;
    if ((k === 'PageDown' || k === 'PageUp') && !e.altKey && !e.shiftKey) {
      // Inside the documents or the list of changes, the key scrolls that; anywhere else it pages the documents.
      const t = e.target as Node;
      if (!scroller.current?.contains(t) && !root.current?.querySelector('#changes')?.contains(t)) {
        e.preventDefault();
        page(k === 'PageDown' ? 1 : -1);
      }
      return;
    }
    if (e.altKey && (k === 'ArrowRight' || k === 'ArrowLeft')) {
      e.preventDefault();
      applyCurrent(k === 'ArrowRight' ? 'l2r' : 'r2l');
      return;
    }
    if (e.altKey) return;
    switch (k) {
      case 'n':
      case 'j':
        e.preventDefault();
        step(1);
        break;
      case 'p':
      case 'k':
        e.preventDefault();
        step(-1);
        break;
      case '>':
        applyCurrent('l2r');
        break;
      case '<':
        applyCurrent('r2l');
        break;
      case 'c':
        toggleChangesOnly();
        break;
      case 'm':
        if (cmp) setPref({ minimap: !minimap });
        break;
      case 'l':
        if (cmp) setPref({ lines: !lines });
        break;
      case 'v':
        if (cmp) setView(view === 'split' ? 'unified' : 'split');
        break;
      case 'b':
        toggleBands();
        break;
      case 's':
        toggleSidebar();
        break;
      case '?':
        openDialog({ type: 'help' });
        break;
    }
  });

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
    const resize = () => {
      setPop(null);
      scheduleNav();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('resize', resize);
    };
  }, [onKey, onPaste, scheduleNav]);

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

  /* ------------------------------------------------------------ render */

  const manual = () => {
    userScrolled.current = true;
  };
  const onOverviewGo = useStable((h: number) => {
    userScrolled.current = false;
    setCurrent(h, true);
  });
  const onOverviewScrolled = useStable(() => {
    userScrolled.current = true;
    setPop(null);
  });
  const onFold = useStable((key: string) => setExpanded((e) => new Set(e).add(key)));
  const onInline = useStable((anchor: HTMLElement, rowKey: string, change: number) => {
    if (inlineWords(rowKey, change)) openPop({ type: 'inline', anchor, rowKey, change });
  });
  const onPick = useStable((h: number) => setCurrent(h, false));
  const onGridRender = useCallback(() => layout.invalidate(), [layout]);
  const closeSidebar = useStable(() => {
    toggleSidebar(false);
    afterRender.current = () => root.current?.querySelector<HTMLElement>('#btn-sidebar')?.focus();
  });

  const notes: Notice[] = [];
  if (history.now.sample && a && b)
    notes.push({
      key: 'sample',
      content: (
        <>
          <span>
            <b>Sample drafts.</b> Replace A and B with your own documents, or drop two files anywhere on the page.
          </span>
          <button type="button" className="btn sm" data-cmd="clear" onClick={startOver}>
            Use my own documents
          </button>
        </>
      ),
    });
  // Notes that apply to both documents are shown once.
  const notesA = a?.notes ?? [];
  const notesB = b?.notes ?? [];
  for (const note of new Set([...notesA, ...notesB])) {
    const who = notesA.includes(note) && notesB.includes(note) ? 'A and B' : notesA.includes(note) ? 'A' : 'B';
    notes.push({
      key: `note:${note}`,
      content: (
        <span>
          <b>{who}:</b> {note}
        </span>
      ),
    });
  }

  let menu: ReactNode = null;
  let menuClass = '';
  if (pop?.type === 'load') menu = <LoadMenu side={pop.side} onLoad={startLoad} />;
  else if (pop?.type === 'export') {
    const doc = pop.side === 'a' ? a : b;
    if (doc) menu = <ExportMenu side={pop.side} doc={doc} onExport={exportDoc} />;
  } else if (pop?.type === 'copy')
    menu = (
      <CopyMenu
        current={cur}
        total={n}
        onApply={(scope, dir) => {
          setPop(null);
          if (scope === 'cur') applyCurrent(dir);
          else applyAll(dir);
        }}
      />
    );
  else if (pop?.type === 'options') {
    menuClass = 'wide';
    menu = <OptionsMenu opts={opts} onChange={(o) => setPref({ opts: o })} />;
  } else if (pop?.type === 'inline') {
    const words = inlineWords(pop.rowKey, pop.change);
    menuClass = 'inline';
    if (words) menu = <InlineMenu {...words} onApply={(dir) => copyWording(pop.rowKey, pop.change, dir)} />;
  }

  let dialogBody: ReactNode = null;
  if (dialog?.type === 'paste')
    dialogBody = (
      <PasteDialog
        side={dialog.side}
        onPaste={(html, text) => {
          setDialog(null);
          loadPasted(dialog.side, html, text);
        }}
      />
    );
  else if (dialog?.type === 'gdoc') dialogBody = <GoogleDocDialog side={dialog.side} presetId={dialog.presetId} onLoad={startLoad} />;
  else if (dialog?.type === 'help') dialogBody = <HelpDialog />;

  const appClass = ['app', view, elastic && 'elastic', minimap && 'with-map', lines && 'with-lines', lowContrast && 'lowc', !cmp && 'is-empty', busy && 'is-busy'].filter(Boolean).join(' ');
  const openId = pop && (pop.type === 'load' || pop.type === 'export') ? `${pop.type}-${pop.side}` : null;
  return (
    <div className={appClass} data-busy={busy || undefined} ref={root}>
      <AppBar
        home={home}
        hasDocs={!!(a || b)}
        lowContrast={lowContrast}
        dark={dark}
        onSwap={swap}
        onNew={startOver}
        onContrast={() => setPref({ lowContrast: !lowContrast })}
        onTheme={switchTheme}
        onHelp={() => openDialog({ type: 'help' })}
      />
      <Toolbar
        cmp={cmp}
        current={cur}
        nav={nav}
        changesOnly={changesOnly}
        view={view}
        minimap={minimap}
        lines={lines}
        bands={bands}
        sidebar={sidebar}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        menu={pop?.type === 'options' || pop?.type === 'copy' ? pop.type : null}
        same={same}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onChangesOnly={toggleChangesOnly}
        onView={setView}
        onMinimap={() => setPref({ minimap: !minimap })}
        onLines={() => setPref({ lines: !lines })}
        onBands={toggleBands}
        onOptions={(e) => openPop({ type: 'options', anchor: e.currentTarget })}
        onPagePrev={() => page(-1)}
        onPageNext={() => page(1)}
        onUndo={undo}
        onRedo={redo}
        onCopy={(e) => openPop({ type: 'copy', anchor: e.currentTarget })}
        onSidebar={() => toggleSidebar()}
      />
      <Notices notices={notes.filter((x) => !dismissed.has(x.key))} onDismiss={(key) => setDismissed((d) => new Set(d).add(key))} />
      <main className="stage" id="stage">
        {cmp && a && b ? (
          <>
            <div
              className="scroller"
              id="scroller"
              ref={scroller}
              onScroll={() => {
                if (pop) setPop(null);
                scheduleNav();
                saveView();
              }}
              onWheel={manual}
              onTouchMove={manual}
              // A press on the scroller itself (not its content) is the scrollbar.
              onPointerDown={(e) => e.target === e.currentTarget && manual()}
              onKeyDown={(e) => SCROLL_KEYS.has(e.key) && manual()}
            >
              <ColumnHeads a={a} b={b} edits={edits} cmp={cmp} current={cur} open={openId} onMenu={openDocMenu} ref={heads} />
              {view === 'unified' && <div className="topcap" />}
              <KeepPlace place={place} watch={[items, minimap, lines, sidebar, view, elastic]}>
                {elastic ? (
                  <ElasticGrid cmp={cmp} items={items} current={cur} layout={elasticLayout} onCopyHunk={copyHunk} onFold={onFold} onInline={onInline} onPick={onPick} ref={grid} />
                ) : (
                  <DocumentGrid cmp={cmp} items={items} current={cur} onCopy={copyRow} onFold={onFold} onInline={onInline} onPick={onPick} onRender={onGridRender} ref={grid} />
                )}
              </KeepPlace>
              {!elastic && <div className="endcap" />}
            </div>
            <Overview layout={lay} scroller={scroller} current={cur} minimap={minimap} palette={`${dark}:${lowContrast}`} onGo={onOverviewGo} onScrolled={onOverviewScrolled} />
            {sidebar && <ChangesPanel cmp={cmp} current={cur} same={same} onGo={goToChange} onClose={closeSidebar} />}
          </>
        ) : (
          <EmptyState a={a} b={b} onLoad={startLoad} onMenu={openDocMenu} onSamples={loadSamples} />
        )}
      </main>
      <Toasts toasts={toasts} onUndo={undo} onDismiss={dismissToast} />
      {drop.active && <DropOverlay hot={drop.hot} />}
      <input type="file" id="file-input" accept={ACCEPT} multiple hidden ref={file} onChange={onFile} />
      {pop && menu && (
        <Popover anchor={pop.anchor} className={menuClass} onClose={closePop}>
          {menu}
        </Popover>
      )}
      {dialog && (
        <Dialog key={dialog.type} className={dialog.type} onClose={() => setDialog(null)} ref={dialogEl}>
          {dialogBody}
        </Dialog>
      )}
      <Tooltips root={root} />
    </div>
  );
}
