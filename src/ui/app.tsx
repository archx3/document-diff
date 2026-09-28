import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, MouseEvent, ReactNode } from 'react';
import { compareDocs, inlineDiff } from '../core/compare';
import { fullRange } from '../core/inline';
import type { Dir, Selection } from '../core/merge';
import { applySelection, selectAll, selectHunk, selectInline, selectRows, selectTableRow } from '../core/merge';
import type { Block, Doc } from '../core/model';
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
import type { Ignores, Issue } from '../check/check';
import { ignoreKey } from '../check/check';
import { batches, claudeCheck, claudeError, claudeSampler } from '../check/claude';
import { replaceInParagraph } from '../check/edit';
import type { ClaudeFindings, PlacedIssue } from '../check/place';
import { countIssues, placeIssues } from '../check/place';
import type { Lang, Speller } from '../check/spell';
import { loadSpeller } from '../check/spell';
import { noteSource } from '../lib/sources';
import type { TextTarget } from '../review/anchor';
import { blockStream, changeTarget, findText, hashText, textTarget } from '../review/anchor';
import { paintMarks, paintRanges, rangeAt, segmentRange, selectionTarget } from '../review/dom';
import type { HighlightColor, HighlightMark, Mark, NoteMark, Placed, ReactionMark } from '../review/marks';
import { margins, markId, placeMarks, readMarks, streamsOf, swapMarks, toggleReaction } from '../review/marks';
import { SAMPLE_A, SAMPLE_A_NAME, SAMPLE_B, SAMPLE_B_NAME } from '../samples/sample';
import type { ChangeMarks, PanelMark, PanelReview } from './changes-panel';
import { ChangesPanel } from './changes-panel';
import type { ClaudeState } from './check-ui';
import { CheckMenu, IssueCard } from './check-ui';
import type { DialogState } from './dialogs';
import { Dialog, GoogleDocDialog, HelpDialog, PasteDialog } from './dialogs';
import { DropOverlay, useFileDrop } from './drop';
import type { LoadKind } from './empty';
import { EmptyState } from './empty';
import { exportDocument, printDocument } from './export';
import { ElasticLayout } from './elastic';
import { ElasticGrid } from './elastic-grid';
import type { Place, ReviewView } from './grid';
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
import type { RailActions } from './rail';
import type { CardNote, ReviewContext } from './review-card';
import { ReviewCard } from './review-card';
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
  /** Review mode: notes, highlights and reactions, and the margins to add them from. */
  review: boolean;
  /** Spelling and grammar checking, its language, and whether Claude may be asked. */
  check: boolean;
  lang: Lang;
  claude: boolean;
}

const WORDS_KEY = 'collate.words.v1';

/** British spelling where the browser's language says so. */
function defaultLang(): Lang {
  return /^en-(GB|AU|NZ|IE|ZA|IN)/i.test(globalThis.navigator?.language ?? '') ? 'en-GB' : 'en-US';
}

/** The reader's own dictionary, kept in this browser. */
function loadWords(): string[] {
  try {
    const w = JSON.parse(localStorage.getItem(WORDS_KEY) ?? '[]') as unknown;
    return Array.isArray(w) ? w.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function readIgnored(raw: unknown): { words: string[]; rules: string[] } {
  const o = raw as { words?: unknown; rules?: unknown } | undefined;
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
  return { words: strings(o?.words), rules: strings(o?.rules) };
}

function readClaude(raw: unknown): Record<string, Issue[]> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, Issue[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue;
    out[k] = v.filter(
      (i): i is Issue => !!i && typeof i === 'object' && typeof (i as Issue).start === 'number' && typeof (i as Issue).end === 'number' && Array.isArray((i as Issue).suggestions),
    );
  }
  return out;
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

function sampleDocs(): Docs {
  return {
    a: { ...readHtml(SAMPLE_A, SAMPLE_A_NAME), kind: 'sample' },
    b: { ...readHtml(SAMPLE_B, SAMPLE_B_NAME), kind: 'sample' },
    edits: { a: 0, b: 0 },
    sample: true,
  };
}

/** The format backend that edits a document: in place for Word and OpenDocument files. */
function backendFor(doc: Doc) {
  return doc.pkg instanceof DocxPackage ? docxBackend : doc.pkg instanceof OdtPackage ? odtBackend : modelBackend;
}

function withDoc(docs: Docs, side: Side, doc: Doc | null, edits: number): Docs {
  return side === 'a' ? { ...docs, a: doc, edits: { ...docs.edits, a: edits } } : { ...docs, b: doc, edits: { ...docs.edits, b: edits } };
}

/** An open menu, and the button (or word) it belongs to. */
type Pop =
  | { type: 'load' | 'export'; side: Side; anchor: HTMLElement }
  | { type: 'options' | 'copy'; anchor: HTMLElement }
  | { type: 'inline'; anchor: HTMLElement; rowKey: string; change: number }
  /** The marks on one side of a row, from its margin; `selection` is the selected text it was opened for. */
  | { type: 'review'; anchor: HTMLElement; rowKey: string; side: Side; selection: TextTarget | null; writing: boolean }
  | { type: 'check'; anchor: HTMLElement }
  /** A spelling or grammar finding, from a click on its words; `anchor` marks the words on the screen. */
  | { type: 'issue'; anchor: HTMLElement; key: string; suggestions: string[] };

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
  const { opts, changesOnly, minimap, lines, bands, lowContrast, sidebar, review, check, lang } = prefs;
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

  /* ------------------------------------------------------------ review */

  const [marks, setMarks] = useState<Mark[]>(() => readMarks(restored?.extra.review));
  /** The line with text selected in it, as "anchor|side": review mode offers to mark it from its margin. */
  const [selLine, setSelLine] = useState<string | null>(null);
  const lastColor = useRef<HighlightColor>('yellow');
  /** Where each note's text is on the page, as last painted. */
  const noteRanges = useRef<Map<string, Range[]>>(new Map());
  const placed = useMemo(() => (cmp && review ? placeMarks(marks, cmp) : []), [cmp, marks, review]);
  const marginMap = useMemo(() => margins(placed), [placed]);

  /* ---------------------------------------------------------- checking */

  const [speller, setSpeller] = useState<Speller | null>(null);
  /** The reader's own dictionary (kept in the browser), and what they ignored in this comparison. */
  const [words, setWords] = useState<string[]>(loadWords);
  const [ignored, setIgnored] = useState(() => readIgnored(restored?.extra.ignored));
  /** Claude's findings, by the hash of the paragraph text they are about. */
  const [claudeFound, setClaudeFound] = useState<Record<string, Issue[]>>(() => readClaude(restored?.extra.claude));
  const [claudeAvailable, setClaudeAvailable] = useState<boolean | null>(null);
  const [claudeRun, setClaudeRun] = useState<ClaudeState['run']>(null);
  const claudeStop = useRef<AbortController | null>(null);
  /** Where each finding's words are on the page, as last painted. */
  const issueRanges = useRef<Map<string, Range[]>>(new Map());
  const issueCursor = useRef(-1);
  const ignores = useMemo<Ignores>(
    () => ({ words: new Set([...words, ...ignored.words].map((w) => w.toLowerCase())), rules: new Set(ignored.rules) }),
    [words, ignored],
  );
  const issues = useMemo<PlacedIssue[]>(
    () => (check && cmp && speller?.lang === lang ? placeIssues(cmp, speller, ignores, claudeFound as ClaudeFindings) : []),
    [check, cmp, speller, lang, ignores, claudeFound],
  );
  const issueCounts = check && speller?.lang === lang ? countIssues(issues) : null;
  const claudeReady = prefs.claude && !!claudeAvailable;

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
  useEffect(() => sessionWriter.extra({ review: marks, ignored, claude: claudeFound }), [sessionWriter, marks, ignored, claudeFound]);
  useEffect(() => {
    try {
      localStorage.setItem(WORDS_KEY, JSON.stringify(words));
    } catch {
      /* storage unavailable */
    }
  }, [words]);
  // The dictionary loads the first time checking is on (and again for the other language).
  useEffect(() => {
    if (!check) return;
    let live = true;
    loadSpeller(lang).then(
      (sp) => live && setSpeller(sp),
      (err) => {
        console.error(err);
        if (live) toast('The dictionary could not be loaded.', { error: true });
      },
    );
    return () => {
      live = false;
    };
  }, [check, lang]);
  useEffect(() => {
    let live = true;
    void claudeSampler().then((s) => live && setClaudeAvailable(!!s));
    return () => {
      live = false;
    };
  }, []);
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
  useLayoutEffect(() => layout.invalidate(), [layout, minimap, lines, sidebar, view, review]);

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
    setMarks((ms) => swapMarks(ms));
  };

  const startOver = () => {
    const now = history.latest();
    if (now.a || now.b) history.commit('New comparison', NO_DOCS);
    setMarks([]);
    setIgnored({ words: [], rules: [] });
    setClaudeFound({});
  };

  const loadSamples = () => {
    history.commit('Load samples', sampleDocs());
    setMarks([]);
    setIgnored({ words: [], rules: [] });
    setClaudeFound({});
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

  /* ------------------------------------------------------ review marks */

  /** The selected text in one document, as a text target. */
  const selectedTarget = (side: Side) => {
    const g = grid.current;
    return cmp && g ? selectionTarget(g, document.getSelection(), cmp, streamsOf(cmp), side) : null;
  };

  /** A whole paragraph (or table) of one side of a row, as a text target. */
  const paragraphTarget = (side: Side, rowKey: string): TextTarget | null => {
    const row = cmp?.rows.find((r) => r.key === rowKey);
    const block = row && (side === 'a' ? row.l : row.r);
    if (!cmp || !block) return null;
    const s = streamsOf(cmp)[side];
    const i = s.blocks.indexOf(block);
    const text = blockStream(block);
    return i < 0 || !text ? null : textTarget(s, side, s.starts[i]!, s.starts[i]! + text.length);
  };

  /** Highlights text in a colour (or with null, clears it), replacing the highlights it overlaps. */
  const highlight = (target: TextTarget, color: HighlightColor | null) => {
    if (!cmp) return;
    const s = streamsOf(cmp)[target.side];
    const at = findText(s, target);
    setMarks((ms) => {
      const kept = ms.filter((m) => {
        if (m.kind !== 'highlight' || m.target.side !== target.side || !at) return true;
        const o = findText(s, m.target);
        return !o || o.end <= at.start || o.start >= at.end;
      });
      if (color) {
        lastColor.current = color;
        kept.push({ id: markId(), kind: 'highlight', target, color, created: Date.now() });
      }
      return kept;
    });
  };

  const railOpen = useStable((anchor: HTMLElement, rowKey: string, side: Side) => openPop({ type: 'review', anchor, rowKey, side, selection: null, writing: false }));
  const railQuick = useStable((what: 'highlight' | 'note', anchor: HTMLElement, _rowKey: string, side: Side) => {
    const sel = selectedTarget(side);
    if (!sel) return;
    if (what === 'highlight') {
      highlight(sel.target, lastColor.current);
      document.getSelection()?.removeAllRanges();
    } else {
      openPop({ type: 'review', anchor, rowKey: sel.rowKey, side, selection: sel.target, writing: true });
    }
  });
  const railActions = useMemo<RailActions>(() => ({ open: railOpen, quick: railQuick }), [railOpen, railQuick]);
  const reviewView = useMemo<ReviewView | null>(
    () => (review && cmp ? { margins: marginMap, selected: selLine, actions: railActions } : null),
    [review, cmp, marginMap, selLine, railActions],
  );

  /** What the card opened from a margin is about, and the marks already there. */
  const reviewContext = (p: Extract<Pop, { type: 'review' }>): ReviewContext | null => {
    const row = cmp?.rows.find((r) => r.key === p.rowKey);
    if (!cmp || !row) return null;
    const block = p.side === 'a' ? row.l : row.r;
    const hunk = row.hunk;
    const onChange = (pl: Placed) => pl.mark.target.type === 'change' && hunk >= 0 && pl.hunk === hunk;
    const onRow = (pl: Placed) => pl.side === p.side && !!pl.parts?.some((x) => x.rowKey === p.rowKey);
    const here = placed.filter((pl) => pl.found && (onChange(pl) || onRow(pl)));
    const notes: CardNote[] = here
      .filter((pl): pl is Placed & { mark: NoteMark } => pl.mark.kind === 'note')
      .map(({ mark: m }) => ({ id: m.id, text: m.text, quote: m.target.type === 'text' ? m.target.quote : undefined, onChange: m.target.type === 'change', created: m.created, updated: m.updated }));
    const reactions = here.filter((pl): pl is Placed & { mark: ReactionMark } => pl.mark.kind === 'reaction').map((pl) => pl.mark.reaction);
    const highlights = [...new Set(here.filter((pl): pl is Placed & { mark: HighlightMark } => pl.mark.kind === 'highlight').map((pl) => pl.mark.color))];
    return {
      side: p.side,
      rowKey: p.rowKey,
      hunk,
      what: p.selection ? 'selection' : hunk >= 0 ? 'change' : 'paragraph',
      quote: p.selection?.quote ?? (block ? blockStream(block) : ''),
      notes,
      reactions,
      highlights,
      writing: p.writing,
    };
  };

  const reviewCard = (p: Extract<Pop, { type: 'review' }>, ctx: ReviewContext) => {
    const target = () => p.selection ?? (ctx.hunk >= 0 && cmp ? changeTarget(cmp, ctx.hunk) : paragraphTarget(p.side, p.rowKey));
    return (
      <ReviewCard
        key={`${p.rowKey}|${p.side}|${p.selection?.pos ?? ''}`}
        ctx={ctx}
        onReact={(r) => {
          if (cmp && ctx.hunk >= 0) setMarks((ms) => toggleReaction(ms, changeTarget(cmp, ctx.hunk), ctx.hunk, cmp, r));
        }}
        onHighlight={(color) => {
          const t = p.selection ?? paragraphTarget(p.side, p.rowKey);
          if (t) highlight(t, color);
        }}
        onAddNote={(text) => {
          const t = target();
          if (t) setMarks((ms) => [...ms, { id: markId(), kind: 'note', target: t, text, created: Date.now() }]);
        }}
        onEditNote={(id, text) => setMarks((ms) => ms.map((m) => (m.id === id && m.kind === 'note' ? { ...m, text, updated: Date.now() } : m)))}
        onDelete={(id) => setMarks((ms) => ms.filter((m) => m.id !== id))}
      />
    );
  };

  /** Scrolls a row into view, showing it first if it is folded away. */
  const goToRow = (rowKey: string) => {
    if (!cmp) return;
    const at = cmp.rows.findIndex((r) => r.key === rowKey);
    let fold: string | null = null;
    for (const it of items) {
      if (it.type !== 'fold') continue;
      const from = cmp.rows.findIndex((r) => r.key === it.key);
      if (from <= at && at < from + it.count) fold = it.key;
    }
    const show = () => place.restore([{ id: rowKey, offset: (heads.current?.offsetHeight ?? 0) + 48 }]);
    userScrolled.current = true;
    if (fold) {
      const key = fold;
      setExpanded((e) => new Set(e).add(key));
      afterRender.current = show;
    } else show();
    if (panelOverlays()) setPref({ sidebar: false });
  };

  const panelReview = useMemo<PanelReview | null>(() => {
    if (!review || !cmp) return null;
    const byHunk = new Map<number, ChangeMarks>();
    const order = new Map(cmp.rows.map((r, i) => [r.key, i]));
    const list: PanelMark[] = [];
    for (const p of placed) {
      const m = p.mark;
      if (p.found && p.hunk >= 0 && m.kind !== 'highlight') {
        let c = byHunk.get(p.hunk);
        if (!c) byHunk.set(p.hunk, (c = { reactions: [], notes: 0 }));
        if (m.kind === 'reaction') c.reactions.push(m.reaction);
        else c.notes++;
      }
      if (m.kind === 'reaction') continue;
      list.push({
        id: m.id,
        kind: m.kind,
        found: p.found,
        hunk: p.hunk,
        side: p.side,
        rowKey: p.rowKey,
        quote: m.target.type === 'text' ? m.target.quote : undefined,
        text: m.kind === 'note' ? m.text : undefined,
        color: m.kind === 'highlight' ? m.color : undefined,
        created: m.created,
      });
    }
    list.sort((x, y) => (order.get(x.rowKey ?? '') ?? Infinity) - (order.get(y.rowKey ?? '') ?? Infinity));
    return {
      byHunk,
      marks: list,
      onGo: (m) => {
        if (m.hunk >= 0 && !m.side) goToChange(m.hunk);
        else if (m.rowKey) goToRow(m.rowKey);
      },
      onDelete: (id) => setMarks((ms) => ms.filter((x) => x.id !== id)),
    };
    // goToChange and goToRow read the latest state when called.
  }, [review, cmp, placed]);

  // Marked text is coloured on the page; while a card is open for some selected text, that text too.
  useLayoutEffect(() => {
    const focus = pop?.type === 'review' && pop.selection && cmp ? placeMarks([{ id: 'focus', kind: 'note', target: pop.selection, text: '', created: 0 }], cmp) : [];
    noteRanges.current = paintMarks(review ? grid.current : null, placed, focus);
    // Findings are underlined: red for spelling, blue for grammar.
    const g = check ? grid.current : null;
    const spell: Range[] = [];
    const grammar: Range[] = [];
    const found = new Map<string, Range[]>();
    const cells = new Map();
    if (g)
      for (const pi of issues) {
        const r = segmentRange(g, pi.side, pi.rowKey, pi.block, pi.issue.start, pi.issue.end, cells);
        if (!r) continue;
        (pi.issue.kind === 'spelling' ? spell : grammar).push(r);
        found.set(pi.key, [r]);
      }
    paintRanges('collate-spell', spell);
    paintRanges('collate-grammar', grammar);
    issueRanges.current = found;
  });

  /** A click on noted text opens its card, as a comment in a word processor does. */
  const onNoteClick = (e: MouseEvent) => {
    if (onIssueClick(e)) return;
    if (!review || !noteRanges.current.size) return;
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return;
    const id = rangeAt(noteRanges.current, e.clientX, e.clientY);
    const p = id ? placed.find((x) => x.mark.id === id) : undefined;
    if (!p?.rowKey || !p.side) return;
    const button = grid.current?.querySelector<HTMLElement>(`.row[data-key="${CSS.escape(p.rowKey)}"] > .rail.${p.side} button`);
    if (!button) return;
    e.stopPropagation();
    openPop({ type: 'review', anchor: button, rowKey: p.rowKey, side: p.side, selection: null, writing: false });
  };

  // In review mode, the margin beside selected text offers to highlight it or add a note.
  useEffect(() => {
    if (!review) {
      setSelLine(null);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const sel = document.getSelection();
      let next: string | null = null;
      const node = sel && !sel.isCollapsed ? sel.focusNode : null;
      const el = node && (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement);
      const cell = el?.closest('.cell.a, .cell.b');
      const row = cell?.closest<HTMLElement>('.row');
      if (cell && row?.dataset.a && grid.current?.contains(row)) next = `${row.dataset.a}|${cell.classList.contains('a') ? 'a' : 'b'}`;
      setSelLine((prev) => (prev === next ? prev : next));
    };
    const onChange = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    document.addEventListener('selectionchange', onChange);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      cancelAnimationFrame(frame);
    };
  }, [review]);

  /* --------------------------------------------------- checking actions */

  /** Replaces a finding's words in its document: an edit like any other, which can be undone. */
  const fixIssue = (pi: PlacedIssue, replacement: string) => {
    setPop(null);
    const now = history.latest();
    const doc = now[pi.side];
    const next = doc && pi.block.type === 'p' ? replaceInParagraph(doc, pi.block, pi.issue.start, pi.issue.end, replacement, backendFor(doc)) : null;
    if (!doc || !next) {
      toast('That text can’t be changed here. Correct it in the file itself.', { error: true });
      return;
    }
    history.commit(`Corrected “${pi.issue.text}”`, withDoc(now, pi.side, next, now.edits[pi.side] + 1));
    toast(`Changed “${pi.issue.text}” to “${replacement}” in ${SIDE_NAME[pi.side]}`, { undo: true });
  };

  const ignoreIssue = (pi: PlacedIssue) => {
    setPop(null);
    const i = pi.issue;
    if (i.kind === 'spelling') setIgnored((x) => ({ ...x, words: [...x.words, i.text.replace(/’/g, "'")] }));
    else setIgnored((x) => ({ ...x, rules: [...x.rules, ignoreKey(i)] }));
  };

  const addWord = (pi: PlacedIssue) => {
    setPop(null);
    const w = pi.issue.text.replace(/’/g, "'");
    setWords((ws) => (ws.includes(w) ? ws : [...ws, w]));
    toast(`Added “${w}” to your dictionary`);
  };

  /** Asks Claude about one side's paragraphs (or just `only`), a batch at a time. */
  const askClaude = async (side: Side, only?: readonly Block[]) => {
    const sample = await claudeSampler();
    if (!sample || !cmp || claudeRun) return;
    const doc = side === 'a' ? cmp.left : cmp.right;
    if (doc.mono) {
      toast('Code and data files are not checked.');
      return;
    }
    const blocks = only ?? cmp.rows.map((r) => (side === 'a' ? r.l : r.r)).filter((b): b is Block => !!b);
    const seen = new Set<string>();
    const paras = blocks
      .map((b) => ({ key: hashText(blockStream(b)), text: blockStream(b) }))
      .filter((p) => p.text.trim() && !seen.has(p.key) && seen.add(p.key) && (only || !(p.key in claudeFound)));
    if (!paras.length) {
      toast(`Claude has already checked ${SIDE_NAME[side]}.`);
      return;
    }
    const ctl = new AbortController();
    claudeStop.current = ctl;
    setClaudeRun({ side, done: 0, total: batches(paras).length });
    let found = 0;
    try {
      await claudeCheck(
        sample,
        paras,
        lang,
        (m, done, total) => {
          for (const v of m.values()) found += v.length;
          setClaudeFound((prev) => ({ ...prev, ...Object.fromEntries(m) }));
          setClaudeRun({ side, done, total });
        },
        ctl.signal,
      );
      if (!ctl.signal.aborted) toast(found ? `Claude suggested ${plural(found, 'correction')} in ${SIDE_NAME[side]}` : `Claude found nothing to correct in ${SIDE_NAME[side]}`);
    } catch (e) {
      toast(claudeError(e), { error: (e as { code?: string }).code !== 'cancelled' });
    } finally {
      setClaudeRun(null);
      claudeStop.current = null;
    }
  };

  /** Scrolls to the next finding (after the last one visited). */
  const nextIssue = () => {
    if (!issues.length) return;
    setPop(null);
    issueCursor.current = (issueCursor.current + 1) % issues.length;
    goToRow(issues[issueCursor.current]!.rowKey);
  };

  /** A small box over some words on the screen, for a card to open from. */
  const floatingAnchor = (rect: DOMRect) => {
    for (const old of Array.from(document.querySelectorAll('.float-anchor'))) old.remove();
    const el = document.createElement('span');
    el.className = 'float-anchor';
    el.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;pointer-events:none`;
    root.current?.appendChild(el);
    return el;
  };

  /** A click on underlined words opens their finding. */
  const onIssueClick = (e: MouseEvent): boolean => {
    if (!check || !issueRanges.current.size) return false;
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return false;
    const key = rangeAt(issueRanges.current, e.clientX, e.clientY);
    const pi = key ? issues.find((x) => x.key === key) : undefined;
    const range = key ? issueRanges.current.get(key)?.[0] : undefined;
    if (!pi || !range) return false;
    e.stopPropagation();
    const suggestions = pi.issue.kind === 'spelling' && speller ? speller.suggest(pi.issue.text) : pi.issue.suggestions;
    openPop({ type: 'issue', anchor: floatingAnchor(range.getBoundingClientRect()), key: pi.key, suggestions });
    return true;
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
      case 'r':
        if (cmp) setPref({ review: !review });
        break;
      case 'g':
        if (cmp) setPref({ check: !check });
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
  } else if (pop?.type === 'check') {
    menuClass = 'wide';
    menu = (
      <CheckMenu
        lang={lang}
        counts={issueCounts}
        claude={{ enabled: prefs.claude, available: claudeAvailable, run: claudeRun }}
        words={words.length}
        onLang={(l) => setPref({ lang: l })}
        onClaude={(on) => setPref({ claude: on })}
        onClaudeCheck={(side) => void askClaude(side)}
        onStop={() => claudeStop.current?.abort()}
        onNext={nextIssue}
        onClearWords={() => setWords([])}
      />
    );
  } else if (pop?.type === 'issue') {
    const pi = issues.find((x) => x.key === pop.key);
    const doc = pi && (pi.side === 'a' ? a : b);
    menuClass = 'issue';
    if (pi && doc)
      menu = (
        <IssueCard
          issue={pi.issue}
          side={pi.side}
          suggestions={pop.suggestions}
          editable={pi.block.type === 'p' && doc.blocks.includes(pi.block)}
          canAsk={claudeReady}
          asking={!!claudeRun}
          onFix={(r) => fixIssue(pi, r)}
          onIgnore={() => ignoreIssue(pi)}
          onAddWord={() => addWord(pi)}
          onAsk={() => {
            setPop(null);
            void askClaude(pi.side, [pi.block]);
          }}
        />
      );
  } else if (pop?.type === 'review') {
    const ctx = reviewContext(pop);
    menuClass = 'review';
    if (ctx) menu = reviewCard(pop, ctx);
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

  const appClass = ['app', view, elastic && 'elastic', minimap && 'with-map', lines && 'with-lines', lowContrast && 'lowc', review && cmp && 'review', !cmp && 'is-empty', busy && 'is-busy']
    .filter(Boolean)
    .join(' ');
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
        review={review}
        marks={marks.length}
        check={check}
        issues={issueCounts ? issueCounts.a + issueCounts.b : null}
        checking={!!claudeRun}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        menu={pop?.type === 'options' || pop?.type === 'copy' || pop?.type === 'check' ? pop.type : null}
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
        onReview={() => setPref({ review: !review })}
        onCheck={() => setPref({ check: !check })}
        onCheckMenu={(e) => openPop({ type: 'check', anchor: e.currentTarget })}
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
              onClickCapture={onNoteClick}
              onWheel={manual}
              onTouchMove={manual}
              // A press on the scroller itself (not its content) is the scrollbar.
              onPointerDown={(e) => e.target === e.currentTarget && manual()}
              onKeyDown={(e) => SCROLL_KEYS.has(e.key) && manual()}
            >
              <ColumnHeads a={a} b={b} edits={edits} cmp={cmp} current={cur} open={openId} onMenu={openDocMenu} ref={heads} />
              {view === 'unified' && <div className="topcap" />}
              <KeepPlace place={place} watch={[items, minimap, lines, sidebar, view, elastic, review]}>
                {elastic ? (
                  <ElasticGrid
                    cmp={cmp}
                    items={items}
                    current={cur}
                    layout={elasticLayout}
                    onCopyHunk={copyHunk}
                    onFold={onFold}
                    onInline={onInline}
                    onPick={onPick}
                    review={reviewView}
                    ref={grid}
                  />
                ) : (
                  <DocumentGrid
                    cmp={cmp}
                    items={items}
                    current={cur}
                    onCopy={copyRow}
                    onFold={onFold}
                    onInline={onInline}
                    onPick={onPick}
                    onRender={onGridRender}
                    review={reviewView}
                    ref={grid}
                  />
                )}
              </KeepPlace>
              {!elastic && <div className="endcap" />}
            </div>
            <Overview layout={lay} scroller={scroller} current={cur} minimap={minimap} palette={`${dark}:${lowContrast}`} onGo={onOverviewGo} onScrolled={onOverviewScrolled} />
            {sidebar && <ChangesPanel cmp={cmp} current={cur} same={same} onGo={goToChange} onClose={closeSidebar} review={panelReview} />}
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
