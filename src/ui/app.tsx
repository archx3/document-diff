import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, MouseEvent, ReactNode } from 'react';
import type { Comparison } from '../core/compare';
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
import type { SummaryPoint } from '../check/summary';
import { summarizeWithClaude } from '../check/summary';
import { changeRisks } from '../review/risk';
import { movesByRow } from '../core/moves';
import { orderVersions, paragraphHistory } from '../core/versions';
import { withFingerprints } from '../image/draw';
import { HistoryDialog, VersionBar } from './versions';
import { ImageModes, ImageNav, ImageZoom, imageKey } from './image/image-tools';
import { ImageView } from './image/image-view';
import { useImageCompare } from './image/use-image-compare';
import { PicturesDialog } from './image/pictures-dialog';
import { AudioModes, AudioNav, AudioZoom, audioKey } from './audio/audio-tools';
import { AudioPanel } from './audio/audio-panel';
import { ImagePanel } from './image/image-panel';
import type { MediaNotesApi } from './media-notes-ui';
import type { MediaNote } from '../review/media-notes';
import { readMediaNotes, swapMediaNotes } from '../review/media-notes';
import { AudioView } from './audio/audio-view';
import type { KeptTranscripts } from './audio/use-audio-compare';
import { keptFor, readKeptTranscripts, useAudioCompare } from './audio/use-audio-compare';
import type { MediaKind } from '../media/kinds';
import { kindOf, pairKind } from '../media/kinds';
import { acceptFor } from '../components/kind-picker';
import { blockPictures, hunkPictures, pairFor, pictureSides } from './pictures';
import { replaceInParagraph } from '../check/edit';
import type { ClaudeFindings, PlacedIssue } from '../check/place';
import { countIssues, placeIssues } from '../check/place';
import type { Lang, Speller } from '../check/spell';
import { loadSpeller } from '../check/spell';
import { noteSource } from '../lib/sources';
import type { TextTarget } from '../review/anchor';
import { blockStream, changeTarget, findChange, findText, hashText, textTarget } from '../review/anchor';
import type { SelectionTarget } from '../review/dom';
import { paintMarks, paintRanges, rangeAt, segmentRange, selectionTarget } from '../review/dom';
import type { Decision, HighlightColor, HighlightMark, Mark, NoteMark, Placed, ReactionMark } from '../review/marks';
import { decisions, margins, markId, placeMarks, readMarks, redlineNotes, setDecision, streamsOf, swapMarks, toggleReaction } from '../review/marks';
import { SAMPLE_A, SAMPLE_A_NAME, SAMPLE_B, SAMPLE_B_NAME } from '../samples/sample';
import type { ChangeMarks, PanelMark, PanelReview } from './changes-panel';
import { ChangesPanel, DECISION_NAME } from './changes-panel';
import type { ClaudeState } from './check-ui';
import { CheckMenu, IssueCard } from './check-ui';
import type { DialogState } from './dialogs';
import { Dialog, GoogleDocDialog, HelpDialog, PasteDialog, RevisionsDialog, UnlockDialog } from './dialogs';
import type { CloudKind, DriveRevision } from '../lib/cloud';
import { CLOUD_NAME, PickCancelled, availableClouds, driveRefOf, driveRevisionFile, noteDrive, pickFromCloud } from '../lib/cloud';
import { DropOverlay, useFileDrop } from './drop';
import type { LoadKind } from './empty';
import { EmptyState } from './empty';
import { exportDocument, exportMade, exportRedline, printDocument } from './export';
import { mediaObject } from './facts';
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
import type { ReportChoices } from './menus';
import { CopyMenu, ExportMenu, InlineMenu, LoadMenu, OptionsMenu, Popover, RedlineMenu, ReportMenu, ShareMenu } from './menus';
import type { ReviewContent } from './review-file';
import { REVIEW_EXT, WrongPassword, packReview, unpackReview } from './review-file';
import { saveFile } from './files';
import { buildReport } from './report';
import type { Notice } from './notices';
import { Notices } from './notices';
import { Overview } from './overview';
import type { RailActions } from './rail';
import { REACTION_NAME } from './rail';
import type { CardNote, ReviewContext } from './review-card';
import { ChangeMenu, MarkMenu, ReviewCard } from './review-card';
import { gridItems } from './rows';
import type { Restored, SessionScope } from './session';
import { SessionWriter } from './session';
import { currentTheme, onSystemThemeChange, toggleTheme } from './theme';
import { Toasts, useToasts } from './toasts';
import type { NavOff } from './toolbar';
import { ALL_NAV_OFF, AppBar, HistoryTools, ShareTool, TextToolbar, Tool, ToolbarFrame } from './toolbar';
import { Tooltips } from './tooltip';
import type { Side, View } from './util';
import { SIDE_NAME, baseName, isTyping, other, plural, reducedMotion, sameText } from './util';

const ACCEPT = [...ACCEPTED_EXTENSIONS, REVIEW_EXT].map((e) => `.${e}`).join(',');
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
/** The reader's name, put on the changes in a redline. */
const AUTHOR_KEY = 'collate.author.v1';

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
  | { type: 'options' | 'copy' | 'redline' | 'report' | 'share'; anchor: HTMLElement }
  | { type: 'inline'; anchor: HTMLElement; rowKey: string; change: number }
  /**
   * The marks on one side of a row, from its margin; `selection` is the selected text it was opened for,
   * and `mark` the highlight clicked to open it.
   */
  | { type: 'review'; anchor: HTMLElement; rowKey: string; side: Side; selection: TextTarget | null; writing: boolean; mark?: string }
  /** What can be done with a highlight or a note, from a right-click on its words. */
  | { type: 'mark'; anchor: HTMLElement; id: string }
  /** What can be done with selected text, from a right-click on it. */
  | { type: 'select'; anchor: HTMLElement; sel: SelectionTarget }
  /**
   * Everything that can be done with a change, from a right-click on it: a word-level change (`change`), or with
   * `change` -1 a whole changed paragraph; `target` is its words on `side`.
   */
  | { type: 'change'; anchor: HTMLElement; rowKey: string; side: Side; change: number; target: TextTarget | null }
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
  /** What is compared: text, images or audio (each has its own tools and view). */
  const kind = pairKind(a, b);
  const n = cmp?.hunks.length ?? 0;
  const cur = n ? Math.min(Math.max(current, 0), n - 1) : -1;
  // With no changes there is nothing to fold away.
  const items = useMemo(() => (cmp ? gridItems(cmp.rows, changesOnly && n > 0, expanded) : []), [cmp, changesOnly, n, expanded]);
  const same = sameText(opts);

  /* ------------------------------------------------------------ review */

  const [marks, setMarks] = useState<Mark[]>(() => readMarks(restored?.extra.review));
  /** Notes on pictures and recordings (kept beside the marks on text). */
  const [mediaNotes, setMediaNotes] = useState<MediaNote[]>(() => readMediaNotes(restored?.extra.media));
  /** What was said in the recordings, kept with the session (a reload doesn't transcribe them again). */
  const [transcripts, setTranscripts] = useState<KeptTranscripts | null>(() => readKeptTranscripts(restored?.extra.transcripts));
  const [openNote, setOpenNote] = useState<string | null>(null);
  /** The line with text selected in it, as "anchor|side": review mode offers to mark it from its margin. */
  const [selLine, setSelLine] = useState<string | null>(null);
  const lastColor = useRef<HighlightColor>('yellow');
  /** Where each note's and highlight's text is on the page, as last painted. */
  const markRanges = useRef<Map<string, Range[]>>(new Map());
  /** The mark under the pointer, painted as it moves. */
  const hovered = useRef<string | null>(null);
  const placed = useMemo(() => (cmp && review ? placeMarks(marks, cmp) : []), [cmp, marks, review]);
  /** The reader's decision on each change (accepted or rejected); the others are open. */
  const decided = useMemo(() => (cmp ? decisions(marks, cmp) : new Map<number, Decision>()), [cmp, marks]);
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
  const fileTarget = useRef<Side | 'versions'>('a');
  /** Drafts of the document, in order: any two of them are compared. */
  const [versions, setVersions] = useState<Doc[]>(() => [history.now.a, history.now.b].filter((d): d is Doc => !!d && !history.now.sample));
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
  /** The recordings compared, by their content (none for documents): the transcripts kept are theirs. */
  const recordings = [a, b].map((d) => (d && mediaObject(d)?.key) ?? '').join(' ');
  useEffect(
    () => sessionWriter.extra({ review: marks, media: mediaNotes, ignored, claude: claudeFound, transcripts: keptFor(transcripts, recordings.split(' ')) }),
    [sessionWriter, marks, mediaNotes, ignored, claudeFound, transcripts, recordings],
  );
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

  /** Records a decision on a change (the same one again takes it back). */
  const decide = (h: number, status: Decision) => {
    if (!cmp || !cmp.hunks[h]) return;
    const again = decided.get(h) === status;
    setMarks((ms) => setDecision(ms, changeTarget(cmp, h), h, cmp, again ? null : status, me()));
  };
  /** Decides the current change and goes on to the next one. */
  const decideCurrent = (status: Decision) => {
    if (cur < 0) return;
    const again = decided.get(cur) === status;
    decide(cur, status);
    if (!again && cur < n - 1) step(1);
  };
  /** Puts A's text back in B for every rejected change: B becomes the version the decisions make. */
  const applyDecisions = () => {
    if (!cmp) return;
    const rows = [...decided].filter(([, s]) => s === 'rejected').flatMap(([h]) => cmp.rows.slice(cmp.hunks[h]!.start, cmp.hunks[h]!.end));
    if (!rows.length) return;
    const k = new Set(rows.map((r) => r.hunk)).size;
    apply('l2r', selectRows(rows), `Put back A’s text for ${plural(k, 'rejected change')} in B`);
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
    setMediaNotes((ns) => swapMediaNotes(ns));
  };

  const startOver = () => {
    const now = history.latest();
    if (now.a || now.b) history.commit('New comparison', NO_DOCS);
    setMarks([]);
    setMediaNotes([]);
    setIgnored({ words: [], rules: [] });
    setClaudeFound({});
  };

  const loadSamples = () => {
    history.commit('Load samples', sampleDocs());
    setMarks([]);
    setMediaNotes([]);
    setIgnored({ words: [], rules: [] });
    setClaudeFound({});
    setCurrentState(0);
  };

  /* ----------------------------------------------------------- loading */

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
    setCurrentState(0);
    setExpanded(new Set());
    userScrolled.current = false;
    afterRender.current = () => scroller.current?.scrollTo({ top: 0 });
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
        if (!doc.blocks.some((x) => x.type !== 'marker' && !isBlank(x))) throw new LoadError(`"${f.name}" has no text to compare.`);
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
    setCurrentState(0);
    setExpanded(new Set());
    userScrolled.current = false;
    afterRender.current = () => scroller.current?.scrollTo({ top: 0 });
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

  /** Saves the comparison and its review as a .collate file (locked with the password, if any). */
  const saveReview = async (password: string) => {
    setPop(null);
    const now = history.latest();
    if (!now.a || !now.b) return;
    setBusy(password ? 'Locking the review file…' : 'Making the review file…');
    try {
      const bytes = await packReview(
        { docs: now, extra: { review: marks, media: mediaNotes, ignored, claude: claudeFound }, versions: versions.length > 2 ? versions : [] },
        { reviewer: me(), password: password || undefined },
      );
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

  /** Opens a review file: its documents, versions and review take the place of what is here. */
  const applyReview = (content: ReviewContent & { reviewer?: string }, name: string) => {
    history.commit(`Open ${name}`, content.docs);
    const vs = content.versions.length ? content.versions : [content.docs.a, content.docs.b].filter((d): d is Doc => !!d);
    setVersions(vs);
    const ms = readMarks(content.extra.review);
    setMediaNotes(readMediaNotes(content.extra.media));
    setMarks(ms);
    setIgnored(readIgnored(content.extra.ignored));
    setClaudeFound(readClaude(content.extra.claude));
    if (ms.some((m) => m.kind !== 'status')) setPref({ review: true });
    setCurrentState(0);
    setExpanded(new Set());
    afterRender.current = () => scroller.current?.scrollTo({ top: 0 });
    toast(`Opened “${name}”${content.reviewer ? `, reviewed by ${content.reviewer}` : ''}`, { undo: true });
  };

  const openReview = async (name: string, bytes: Uint8Array, password?: string) => {
    setBusy(`Opening ${name}…`);
    try {
      const content = await unpackReview(bytes, password);
      for (const d of new Set([content.docs.a, content.docs.b, ...content.versions])) if (d) await withFingerprints(d);
      applyReview(content, name);
      setDialog(null);
    } catch (err) {
      if (err instanceof WrongPassword) setDialog({ type: 'unlock', name, bytes, error: password ? err.message : undefined });
      else toast((err as Error).message, { error: true });
    } finally {
      setBusy('');
    }
  };

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
        if (!doc.blocks.some((x) => x.type !== 'marker' && !isBlank(x))) throw new LoadError(`"${f.name}" has no text to compare.`);
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

  const clouds = useMemo(() => availableClouds(), []);
  /** The kind of file the load menu opens (it starts as what is compared). */
  const [loadMedia, setLoadMedia] = useState<MediaKind>(kind);
  useEffect(() => setLoadMedia(kind), [kind]);
  /** Two picture files: compared as pictures, filling the workspace. */
  const bothPictures = useMemo(() => {
    if (a?.kind !== 'image' || b?.kind !== 'image') return null;
    const pa = blockPictures(a.blocks[0])[0];
    const pb = blockPictures(b.blocks[0])[0];
    return pa && pb ? pictureSides({ a: pa, b: pb }, a.name, b.name) : null;
  }, [a, b]);
  const imageSides = useMemo(() => (bothPictures ? { a: bothPictures[0], b: bothPictures[1] } : null), [bothPictures]);
  const imageCtl = useImageCompare(imageSides);
  /** Two recordings: compared as sound, filling the workspace. */
  const audioDocs = useMemo(() => (kind === 'audio' && a && b ? { a, b } : null), [kind, a, b]);
  const audioCtl = useAudioCompare(audioDocs, { kept: transcripts, setKept: setTranscripts });
  /** The right of a picture's or recording's toolbar: its own tools, then undo, redo and sharing. */
  const mediaRight = (own: ReactNode) => (
    <>
      {own}
      <div className="tgroup edit" role="group" aria-label="Edit">
        <HistoryTools canUndo={history.canUndo} canRedo={history.canRedo} onUndo={undo} onRedo={redo} />
        <ShareTool expanded={pop?.type === 'share'} onClick={(e) => openPop({ type: 'share', anchor: e.currentTarget })} />
      </div>
    </>
  );
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
  const loadFromCloud = async (kind: CloudKind, side: Side) => {
    try {
      const files = await pickFromCloud(kind, { multiple: true, extensions: ACCEPTED_EXTENSIONS });
      if (files.length) await loadFiles(files, side);
    } catch (err) {
      if (!(err instanceof PickCancelled)) toast(`${CLOUD_NAME[kind]}: ${(err as Error).message}`, { error: true });
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

  const startLoad = (kind: LoadKind, side: Side) => {
    setPop(null);
    if (kind === 'gdrive' || kind === 'onedrive' || kind === 'dropbox') {
      void loadFromCloud(kind, side);
      return;
    }
    if (kind === 'drive-version') {
      const doc = side === 'a' ? a : b;
      const ref = doc && driveRefOf(doc);
      if (ref) setDialog({ type: 'revisions', side: other(side), ref });
      return;
    }
    if (kind === 'file') {
      // The file input is outside the dialog, which must close first to let it open.
      dialogEl.current?.close();
      fileTarget.current = side;
      // Only the kind of file chosen first.
      if (file.current) file.current.accept = acceptFor(loadMedia);
      file.current?.click();
    } else if (kind === 'paste') setDialog({ type: 'paste', side });
    else setDialog({ type: 'gdoc', side });
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
        kept.push({ id: markId(), kind: 'highlight', target, color, created: Date.now(), author: me() });
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

  /** The colours of the highlights on some text. */
  const colorsOn = (target: TextTarget): HighlightColor[] => {
    if (!cmp) return [];
    const stream = streamsOf(cmp)[target.side];
    const at = findText(stream, target);
    if (!at) return [];
    const over = (m: Mark): m is HighlightMark => {
      if (m.kind !== 'highlight' || m.target.side !== target.side) return false;
      const o = findText(stream, m.target);
      return !!o && o.start < at.end && o.end > at.start;
    };
    return [...new Set(marks.filter(over).map((m) => m.color))];
  };

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
      .map(({ mark: m }) => ({
        id: m.id,
        text: m.text,
        quote: m.target.type === 'text' ? m.target.quote : undefined,
        onChange: m.target.type === 'change',
        created: m.created,
        updated: m.updated,
        author: m.author,
      }));
    const reactions = here.filter((pl): pl is Placed & { mark: ReactionMark } => pl.mark.kind === 'reaction').map((pl) => pl.mark.reaction);
    // For selected text, the highlights on it; otherwise those on the row.
    const highlights = p.selection
      ? colorsOn(p.selection)
      : [...new Set(here.filter((pl): pl is Placed & { mark: HighlightMark } => pl.mark.kind === 'highlight').map((pl) => pl.mark.color))];
    return {
      side: p.side,
      rowKey: p.rowKey,
      hunk,
      what: p.mark ? 'highlight' : p.selection ? 'selection' : hunk >= 0 ? 'change' : 'paragraph',
      quote: p.selection?.quote ?? (block ? blockStream(block) : ''),
      notes,
      reactions,
      highlights,
      writing: p.writing,
      decision: hunk >= 0 ? decided.get(hunk) : undefined,
    };
  };

  const reviewCard = (p: Extract<Pop, { type: 'review' }>, ctx: ReviewContext) => {
    const target = () => p.selection ?? (ctx.hunk >= 0 && cmp ? changeTarget(cmp, ctx.hunk) : paragraphTarget(p.side, p.rowKey));
    return (
      <ReviewCard
        key={`${p.rowKey}|${p.side}|${p.selection?.pos ?? ''}`}
        ctx={ctx}
        onReact={(r) => {
          if (cmp && ctx.hunk >= 0) setMarks((ms) => toggleReaction(ms, changeTarget(cmp, ctx.hunk), ctx.hunk, cmp, r, me()));
        }}
        onDecide={(status) => decide(ctx.hunk, status)}
        onHighlight={(color) => {
          const t = p.selection ?? paragraphTarget(p.side, p.rowKey);
          if (t) highlight(t, color);
        }}
        onAddNote={(text) => {
          const t = target();
          if (t) setMarks((ms) => [...ms, { id: markId(), kind: 'note', target: t, text, created: Date.now(), author: me() }]);
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
      if (p.found && p.hunk >= 0 && (m.kind === 'note' || m.kind === 'reaction')) {
        let c = byHunk.get(p.hunk);
        if (!c) byHunk.set(p.hunk, (c = { reactions: [], notes: 0 }));
        if (m.kind === 'reaction') c.reactions.push(m.reaction);
        else c.notes++;
      }
      if (m.kind === 'reaction' || m.kind === 'status') continue;
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
        author: m.author,
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

  // Marked text is coloured on the page; while a card or menu is open for some text, that text too.
  useLayoutEffect(() => {
    const focusTarget =
      pop?.type === 'review' ? pop.selection : pop?.type === 'mark' ? (marks.find((m) => m.id === pop.id)?.target ?? null) : pop?.type === 'select' ? pop.sel.target : pop?.type === 'change' ? pop.target : null;
    const focus = focusTarget?.type === 'text' && cmp ? placeMarks([{ id: 'focus', kind: 'note', target: focusTarget, text: '', created: 0 }], cmp) : [];
    // (Out of review mode there are no marks, but text a menu is open for is still shown.)
    markRanges.current = paintMarks(grid.current, placed, focus);
    paintHover(hovered.current);
    // Findings are underlined: red for spelling, blue for grammar.
    const g = check ? grid.current : null;
    const spell: Range[] = [];
    const grammar: Range[] = [];
    const contract: Range[] = [];
    const found = new Map<string, Range[]>();
    const cells = new Map();
    if (g)
      for (const pi of issues) {
        const r = segmentRange(g, pi.side, pi.rowKey, pi.block, pi.issue.start, pi.issue.end, cells);
        if (!r) continue;
        (pi.issue.kind === 'spelling' ? spell : pi.issue.kind === 'contract' ? contract : grammar).push(r);
        found.set(pi.key, [r]);
      }
    paintRanges('collate-spell', spell);
    paintRanges('collate-grammar', grammar);
    paintRanges('collate-contract', contract);
    issueRanges.current = found;
    // Moved paragraphs say where they went, or came from (shown by the stylesheet).
    const moved = cmp ? movesByRow(cmp) : new Map();
    for (const el of Array.from(grid.current?.querySelectorAll<HTMLElement>('.row[data-moved]') ?? [])) {
      if (moved.has(el.dataset.key!)) continue;
      delete el.dataset.moved;
      for (const c of Array.from(el.querySelectorAll<HTMLElement>('.cell[data-moved-label]'))) delete c.dataset.movedLabel;
    }
    for (const [key, mv] of moved) {
      const from = mv.from === key;
      for (const el of Array.from(grid.current?.querySelectorAll<HTMLElement>(`.row[data-key="${CSS.escape(key)}"]`) ?? [])) {
        el.dataset.moved = from ? 'a' : 'b';
        const cell = el.querySelector<HTMLElement>(`:scope > .cell.${from ? 'a' : 'b'}`);
        if (cell) cell.dataset.movedLabel = `${from ? 'Moved to' : 'Moved here from'} change ${(from ? mv.toHunk : mv.fromHunk) + 1}${mv.exact ? '' : ', with changes'}`;
      }
    }
  });

  /** Shades the words of the mark under the pointer. */
  const paintHover = (id: string | null) => {
    hovered.current = id;
    paintRanges('collate-hover', (id && markRanges.current.get(id)) || [], 1);
  };

  /** The note or highlight whose words are at a point on the screen. */
  const markAt = (x: number, y: number): Placed | undefined => {
    if (!review || !markRanges.current.size) return undefined;
    const id = rangeAt(markRanges.current, x, y);
    return id ? placed.find((p) => p.mark.id === id && p.found && p.rowKey && p.side) : undefined;
  };

  /** A button in the margin beside one side of a row. */
  const railButton = (rowKey: string, side: Side) => grid.current?.querySelector<HTMLElement>(`.row[data-key="${CSS.escape(rowKey)}"] > .rail.${side} button`) ?? null;

  /** The margin button beside the row a mark starts on (or, where there is none, a box over its words). */
  const markAnchor = (p: Placed) => {
    const rect = markRanges.current.get(p.mark.id)?.[0]?.getBoundingClientRect();
    return railButton(p.rowKey!, p.side!) ?? (rect ? floatingAnchor(rect) : null);
  };

  /** Opens the margin card of a mark: a highlight's card is about its words, a note's about its row. */
  const openMark = (p: Placed, writing = false) => {
    const anchor = markAnchor(p);
    if (!anchor || !p.rowKey || !p.side) return;
    const m = p.mark;
    if (m.kind === 'highlight') setPop({ type: 'review', anchor, rowKey: p.rowKey, side: p.side, selection: m.target, writing, mark: m.id });
    else setPop({ type: 'review', anchor, rowKey: p.rowKey, side: p.side, selection: null, writing });
  };

  /** A click on noted or highlighted text opens its card in the margin, as a comment in a word processor does. */
  const onNoteClick = (e: MouseEvent) => {
    if (onPictureClick(e)) return;
    if (onIssueClick(e)) return;
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return;
    const p = markAt(e.clientX, e.clientY);
    if (!p) return;
    e.stopPropagation();
    openMark(p);
  };

  /** A click on a picture in a change opens the two versions of it side by side. */
  const onPictureClick = (e: MouseEvent): boolean => {
    const img = (e.target as Element).closest?.<HTMLImageElement>('img.obj-img');
    const cell = img?.closest('.cell.a, .cell.b');
    const key = cell?.closest<HTMLElement>('.row')?.dataset.key;
    const row = key ? cmp?.rows.find((r) => r.key === key) : undefined;
    if (!img || !cell || !row || row.hunk < 0 || !a || !b) return false;
    const side = cell.classList.contains('a') ? 'a' : 'b';
    const pair = pairFor(row, side, Array.from(cell.querySelectorAll('img.obj-img')).indexOf(img));
    if (!pair) return false;
    e.stopPropagation();
    const [pa, pb] = pictureSides(pair, a.name, b.name);
    setDialog({ type: 'pictures', a: pa, b: pb });
    return true;
  };

  /** A right-click on noted or highlighted text selects it and opens its menu in place of the browser's (Shift keeps the browser's). */
  const onMarkMenu = (e: MouseEvent) => {
    if (e.shiftKey || !cmp) return;
    const anchor = () => floatingAnchor(new DOMRect(e.clientX, e.clientY, 0, 0));
    // A right-click on selected text: what can be done with the selection.
    const range = document.getSelection()?.rangeCount ? document.getSelection()!.getRangeAt(0) : null;
    const onSelection = range && !range.collapsed && Array.from(range.getClientRects()).some((b) => e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom);
    const sel = onSelection && grid.current ? selectionTarget(grid.current, document.getSelection(), cmp, streamsOf(cmp)) : null;
    if (sel) {
      e.preventDefault();
      paintHover(null);
      setPop({ type: 'select', anchor: anchor(), sel });
      return;
    }
    // A right-click in a changed paragraph (added, removed or changed; marked or not): everything that can be done
    // with the change: with the changed words where it is on them, otherwise with the whole paragraph.
    const cell = (e.target as Element).closest?.('.cell.a, .cell.b');
    const rowKey = cell?.closest<HTMLElement>('.row')?.dataset.key;
    const row = rowKey ? cmp.rows.find((r) => r.key === rowKey) : undefined;
    if (cell && row && row.hunk >= 0) {
      e.preventDefault();
      paintHover(null);
      const side: Side = cell.classList.contains('a') ? 'a' : 'b';
      const chg = (e.target as Element).closest<HTMLElement>('[data-c]');
      const change = chg && cell.contains(chg) ? Number(chg.dataset.c) : -1;
      const target = change >= 0 ? changeWords(cell, side, change) : paragraphTarget(side, row.key);
      setPop({ type: 'change', anchor: anchor(), rowKey: row.key, side, change, target });
      return;
    }
    // A highlight or a note elsewhere.
    const p = markAt(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    paintHover(null);
    setPop({ type: 'mark', anchor: anchor(), id: p.mark.id });
  };

  /** The words of a word-level change in a cell, as a text target (null where they are only in the other document). */
  const changeWords = (cell: Element, side: Side, change: number): TextTarget | null => {
    const parts = Array.from(cell.querySelectorAll(`[data-c="${change}"]:not(.caret)`));
    if (!cmp || !grid.current || !parts.length) return null;
    const range = document.createRange();
    range.setStartBefore(parts[0]!);
    range.setEndAfter(parts[parts.length - 1]!);
    // Read as if the words were selected.
    const sel = { rangeCount: 1, isCollapsed: false, getRangeAt: () => range } as unknown as globalThis.Selection;
    return selectionTarget(grid.current, sel, cmp, streamsOf(cmp), side)?.target ?? null;
  };

  // The words of the mark under the pointer are shaded, and the pointer shows they can be clicked.
  const hoverFrame = useRef(0);
  const hoverAt = useRef({ x: 0, y: 0, buttons: 0 });
  const onMarkHover = (e: MouseEvent) => {
    // Once a frame, where the pointer is by then.
    hoverAt.current = { x: e.clientX, y: e.clientY, buttons: e.buttons };
    const el = e.currentTarget as HTMLElement;
    if (hoverFrame.current) return;
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = 0;
      const { x, y, buttons } = hoverAt.current;
      // Not while text is being selected.
      const id = buttons ? null : (markAt(x, y)?.mark.id ?? null);
      const onIssue = !buttons && check && issueRanges.current.size > 0 && !!rangeAt(issueRanges.current, x, y);
      el.classList.toggle('on-mark', !!id || onIssue);
      if (id !== hovered.current) paintHover(id);
    });
  };
  const onMarkLeave = (e: MouseEvent) => {
    cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = 0;
    (e.currentTarget as HTMLElement).classList.remove('on-mark');
    if (hovered.current) paintHover(null);
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

  const [author, setAuthor] = useState(() => {
    try {
      return localStorage.getItem(AUTHOR_KEY) ?? '';
    } catch {
      return '';
    }
  });
  /** The reader's name for their marks (none until they give one). */
  const me = () => author.trim() || undefined;
  /** What the picture and recording views do with notes. */
  const notesApi = useMemo<MediaNotesApi>(
    () => ({
      list: mediaNotes,
      add: (n) => setMediaNotes((ns) => [...ns, n]),
      update: (id, patch) => setMediaNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch, updated: Date.now() } : n))),
      remove: (id) => {
        setMediaNotes((ns) => ns.filter((n) => n.id !== id));
        setOpenNote((o) => (o === id ? null : o));
      },
      author: author.trim() || undefined,
      open: openNote,
      setOpen: setOpenNote,
    }),
    [mediaNotes, openNote, author],
  );
  const saveAuthor = (name: string) => {
    setAuthor(name);
    try {
      localStorage.setItem(AUTHOR_KEY, name);
    } catch {
      /* storage unavailable */
    }
  };
  const [redlineWithNotes, setRedlineWithNotes] = useState(true);
  const [reportChoices, setReportChoices] = useState<ReportChoices>({ format: 'pdf', openOnly: false, notedOnly: false, context: true, summary: true });
  /** Claude's summary of what matters in the changes, once asked for (kept for the comparison it was made for). */
  const [summary, setSummary] = useState<{ cmp: Comparison; points: SummaryPoint[] } | null>(null);
  const summaryPoints = summary && summary.cmp === cmp ? summary.points : null;
  const [summarizing, setSummarizing] = useState(false);
  const summaryStop = useRef<AbortController | null>(null);
  /** What each change touches (amounts, dates, obligations …), worked out here. */
  const risks = useMemo(() => (cmp ? changeRisks(cmp) : []), [cmp]);
  const summarize = async () => {
    const sample = await claudeSampler();
    if (!sample || !cmp || summarizing) return;
    const ctl = new AbortController();
    summaryStop.current = ctl;
    setSummarizing(true);
    try {
      const points = await summarizeWithClaude(sample, cmp, ctl.signal);
      if (ctl.signal.aborted) return;
      setSummary({ cmp, points });
      if (!points.length) toast('Claude found no changes to the meaning, only wording or formatting.');
    } catch (e) {
      toast(claudeError(e), { error: (e as { code?: string }).code !== 'cancelled' });
    } finally {
      setSummarizing(false);
      summaryStop.current = null;
    }
  };
  const downloadReport = () => {
    setPop(null);
    if (!cmp) return;
    const c = reportChoices;
    const doc = buildReport(
      cmp,
      placeMarks(marks, cmp),
      { reaction: REACTION_NAME, decision: DECISION_NAME },
      { openOnly: c.openOnly, notedOnly: c.notedOnly, context: c.context, reviewer: author, summary: c.summary ? summaryPoints?.map((p) => p.text) : undefined },
    );
    void exportMade(doc, c.format, { toast, busy: setBusy });
  };
  /** The review notes and reactions a redline can carry as comments. */
  const notesForRedline = () => (cmp ? redlineNotes(placeMarks(marks, cmp), { ...REACTION_NAME, ...DECISION_NAME }) : []);
  /** Downloads the comparison as a Word file with tracked changes, named after B. */
  const downloadRedline = (format: 'docx' | 'pdf') => {
    setPop(null);
    if (!cmp || !b) return;
    void exportRedline(cmp, format, author, redlineWithNotes ? notesForRedline() : [], `${baseName(b)} (redline)`, { toast, busy: setBusy });
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
    // Pictures and recordings have their own keys; the text ones don't apply.
    if (kind === 'image' || kind === 'audio') {
      // A dialog of the tools' own (asking before sending recordings away) has the keys.
      if (document.querySelector('dialog[open]')) return;
      // Space on a focused button or slider is that control's; elsewhere it plays and pauses.
      if (k === ' ' && (e.target as Element | null)?.closest?.('button, input, [role="slider"], a')) return;
      if (k === '?') openDialog({ type: 'help' });
      else if (k === 's' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        toggleSidebar();
      } else if (kind === 'image' ? imageKey(imageCtl, e) : audioKey(audioCtl, e)) e.preventDefault();
      return;
    }
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
      case 'a':
        decideCurrent('accepted');
        break;
      case 'x':
        decideCurrent('rejected');
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
  // A picture or recording beside a document is compared as text: say so, and how to compare the media itself.
  if (a && b && kind === 'text' && (kindOf(a) !== 'text' || kindOf(b) !== 'text')) {
    const media = kindOf(a) !== 'text' ? a : b;
    const what = kindOf(media) === 'image' ? 'picture' : 'recording';
    notes.push({
      key: `mixed:${a.id}:${b.id}`,
      content: (
        <span>
          <b>{media === a ? 'A' : 'B'} is a {what}</b> and the other a document, so they are compared as text. Replace the document with another {what} to compare the{' '}
          {what === 'picture' ? 'pictures' : 'sound'}.
        </span>
      ),
    });
  }
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
  if (pop?.type === 'load') {
    const here = pop.side === 'a' ? a : b;
    menu = (
      <LoadMenu
        side={pop.side}
        clouds={clouds}
        driveFile={here ? driveRefOf(here)?.name : undefined}
        onLoad={startLoad}
        media={loadMedia}
        onMedia={setLoadMedia}
      />
    );
  }
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
  } else if (pop?.type === 'redline') {
    menuClass = 'wide';
    if (cmp && a && b)
      menu = (
        <RedlineMenu
          a={a.name}
          b={b.name}
          author={author}
          changes={n}
          notes={notesForRedline().length}
          withNotes={redlineWithNotes}
          onAuthor={saveAuthor}
          onWithNotes={setRedlineWithNotes}
          onDownload={downloadRedline}
        />
      );
  } else if (pop?.type === 'share') {
    menuClass = 'wide';
    menu = (
      <ShareMenu
        canSave={!!(a && b)}
        author={author}
        onAuthor={saveAuthor}
        onSave={(pw) => void saveReview(pw)}
        onOpen={() => {
          setPop(null);
          fileTarget.current = 'a';
          file.current?.click();
        }}
      />
    );
  } else if (pop?.type === 'report') {
    menuClass = 'wide';
    if (cmp) menu = <ReportMenu choices={reportChoices} hasSummary={!!summaryPoints?.length} onChange={setReportChoices} onDownload={downloadReport} />;
  } else if (pop?.type === 'mark') {
    const p = placed.find((x) => x.mark.id === pop.id);
    const m = p?.mark;
    menuClass = 'mark';
    if (p?.side && m && (m.kind === 'note' || m.kind === 'highlight') && m.target.type === 'text') {
      const target = m.target;
      menu = (
        <MarkMenu
          kind={m.kind}
          side={p.side}
          quote={target.quote}
          color={m.kind === 'highlight' ? m.color : undefined}
          onColor={(c) => {
            setPop(null);
            highlight(target, c);
          }}
          onOpen={() => openMark(p)}
          onNote={() => openMark(p, true)}
          onCopy={() => {
            setPop(null);
            navigator.clipboard.writeText(target.quote).then(
              () => toast('Copied the text'),
              () => toast('The text could not be copied.', { error: true }),
            );
          }}
          onRemove={() => {
            setPop(null);
            setMarks((ms) => ms.filter((x) => x.id !== m.id));
          }}
        />
      );
    }
  } else if (pop?.type === 'select') {
    const { target, rowKey, side } = pop.sel;
    // Marks show in review mode: annotating turns it on.
    const showMarks = () => {
      if (!review) setPref({ review: true });
    };
    menuClass = 'mark';
    menu = (
      <MarkMenu
        kind="selection"
        side={side}
        quote={target.quote}
        onColor={(c) => {
          setPop(null);
          highlight(target, c);
          document.getSelection()?.removeAllRanges();
          showMarks();
        }}
        onNote={() => {
          const rect = document.getSelection()?.rangeCount ? document.getSelection()!.getRangeAt(0).getBoundingClientRect() : pop.anchor.getBoundingClientRect();
          const anchor = railButton(rowKey, side) ?? floatingAnchor(rect);
          setPop({ type: 'review', anchor, rowKey, side, selection: target, writing: true });
          showMarks();
        }}
        onCopy={() => {
          setPop(null);
          navigator.clipboard.writeText(target.quote).then(
            () => toast('Copied the text'),
            () => toast('The text could not be copied.', { error: true }),
          );
        }}
      />
    );
  } else if (pop?.type === 'change') {
    const row = cmp?.rows.find((r) => r.key === pop.rowKey);
    const hunk = row?.hunk ?? -1;
    menuClass = 'mark';
    if (cmp && hunk >= 0) {
      const { target, rowKey, side, change } = pop;
      const reactions = marks.filter((m): m is ReactionMark => m.kind === 'reaction' && findChange(cmp, m.target) === hunk).map((m) => m.reaction);
      // Marks show in review mode: annotating turns it on.
      const showMarks = () => {
        if (!review) setPref({ review: true });
      };
      menu = (
        <ChangeMenu
          side={side}
          hunk={hunk}
          decision={decided.get(hunk)}
          onDecide={(status) => decide(hunk, status)}
          onHistory={versions.length > 2 ? () => showHistory(rowKey) : undefined}
          onPictures={(() => {
            const pairs = hunkPictures(cmp, hunk);
            if (!pairs.length || !a || !b) return undefined;
            return () => {
              setPop(null);
              const [pa, pb] = pictureSides(pairs[0]!, a.name, b.name);
              setDialog({ type: 'pictures', a: pa, b: pb });
            };
          })()}
          moved={(() => {
            const mv = movesByRow(cmp).get(rowKey);
            if (!mv) return undefined;
            const from = mv.from === rowKey;
            return {
              label: from ? `Go to where it moved (change ${mv.toHunk + 1})` : `Go to where it came from (change ${mv.fromHunk + 1})`,
              go: () => {
                setPop(null);
                goToRow(from ? mv.to : mv.from);
                setCurrentState(from ? mv.toHunk : mv.fromHunk);
              },
            };
          })()}
          quote={target?.quote ?? ''}
          reactions={reactions}
          highlights={target ? colorsOn(target) : []}
          apply={change < 0 || !!inlineWords(rowKey, change)}
          whole={change < 0}
          onReact={(r) => {
            setMarks((ms) => toggleReaction(ms, changeTarget(cmp, hunk), hunk, cmp, r, me()));
            showMarks();
          }}
          onColor={(c) => {
            setPop(null);
            if (target) highlight(target, c);
            showMarks();
          }}
          onClearHighlight={() => {
            setPop(null);
            if (target) highlight(target, null);
          }}
          onOpen={(writing) => {
            const anchor = railButton(rowKey, side) ?? pop.anchor;
            setPop({ type: 'review', anchor, rowKey, side, selection: null, writing });
            showMarks();
          }}
          onCopy={() => {
            setPop(null);
            if (target)
              navigator.clipboard.writeText(target.quote).then(
                () => toast('Copied the text'),
                () => toast('The text could not be copied.', { error: true }),
              );
          }}
          onApply={(dir) => {
            if (change >= 0) copyWording(rowKey, change, dir);
            else {
              setPop(null);
              copyRow(rowKey, dir);
            }
          }}
        />
      );
    }
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
  else if (dialog?.type === 'history' && a && b) dialogBody = <HistoryDialog versions={versions} steps={dialog.steps} opts={opts} a={a} b={b} />;
  else if (dialog?.type === 'pictures') dialogBody = <PicturesDialog a={dialog.a} b={dialog.b} />;
  else if (dialog?.type === 'revisions') {
    const d = dialog;
    dialogBody = <RevisionsDialog file={d.ref} onPick={(rev) => void loadRevision(d.side, rev)} />;
  } else if (dialog?.type === 'unlock') {
    const d = dialog;
    dialogBody = <UnlockDialog key={d.error ?? ''} name={d.name} error={d.error} onUnlock={(pw) => void openReview(d.name, d.bytes, pw)} />;
  }

  // Review mode's margins are for documents: pictures and recordings have notes of their own (and a transcript's rows no rails).
  const appClass = ['app', view, elastic && 'elastic', minimap && 'with-map', lines && 'with-lines', lowContrast && 'lowc', review && cmp && kind === 'text' && 'review', !cmp && 'is-empty', busy && 'is-busy']
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
      {kind === 'image' ? (
        <ToolbarFrame
          kind="image"
          idle={!imageCtl.loaded}
          same={!!imageCtl.diff && !imageCtl.diff.changed}
          left={<ImageNav ctl={imageCtl} />}
          middle={<ImageModes ctl={imageCtl} annotatable />}
          right={mediaRight(
            <>
              <ImageZoom ctl={imageCtl} />
              <Tool id="btn-sidebar" icon="sidebar" label="Notes" kbd="S" toggle pressed={sidebar} controls="changes" onClick={() => toggleSidebar()} />
            </>,
          )}
        />
      ) : kind === 'audio' ? (
        <ToolbarFrame
          kind="audio"
          idle={!audioCtl.sides}
          same={!!audioCtl.sides && !audioCtl.busy && !audioCtl.differences.length}
          left={<AudioNav ctl={audioCtl} />}
          middle={<AudioModes ctl={audioCtl} />}
          right={mediaRight(
            <>
              <AudioZoom ctl={audioCtl} />
              <Tool id="btn-sidebar" icon="sidebar" label="List of differences" kbd="S" toggle pressed={sidebar} controls="changes" onClick={() => toggleSidebar()} />
            </>,
          )}
        />
      ) : (
        <TextToolbar
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
          menu={
            pop?.type === 'options' || pop?.type === 'copy' || pop?.type === 'check' || pop?.type === 'redline' || pop?.type === 'report' || pop?.type === 'share' ? pop.type : null
          }
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
          onRedline={(e) => openPop({ type: 'redline', anchor: e.currentTarget })}
          onReport={(e) => openPop({ type: 'report', anchor: e.currentTarget })}
          onShare={(e) => openPop({ type: 'share', anchor: e.currentTarget })}
          onSidebar={() => toggleSidebar()}
          onReview={() => setPref({ review: !review })}
          onCheck={() => setPref({ check: !check })}
          onCheckMenu={(e) => openPop({ type: 'check', anchor: e.currentTarget })}
        />
      )}
      <Notices notices={notes.filter((x) => !dismissed.has(x.key))} onDismiss={(key) => setDismissed((d) => new Set(d).add(key))} />
      {versions.length > 2 && a && b && (
        <VersionBar
          versions={versions}
          a={a}
          b={b}
          onPick={pickVersion}
          onStep={stepVersions}
          onAdd={() => {
            fileTarget.current = 'versions';
            file.current?.click();
          }}
        />
      )}
      <main className="stage" id="stage">
        {cmp && a && b ? (
          <>
            <div
              className="scroller"
              id="scroller"
              ref={scroller}
              onScroll={() => {
                // Menus on the documents' words or margins would be left behind; the toolbar's stay open.
                if (pop && (scroller.current?.contains(pop.anchor) || pop.anchor.classList.contains('float-anchor'))) setPop(null);
                scheduleNav();
                saveView();
              }}
              onClickCapture={onNoteClick}
              onContextMenu={onMarkMenu}
              onMouseMove={onMarkHover}
              onMouseLeave={onMarkLeave}
              onWheel={manual}
              onTouchMove={manual}
              // A press on the scroller itself (not its content) is the scrollbar.
              onPointerDown={(e) => e.target === e.currentTarget && manual()}
              onKeyDown={(e) => SCROLL_KEYS.has(e.key) && manual()}
            >
              {/* Recordings have their heads beside their tracks. */}
              {kind !== 'audio' && <ColumnHeads a={a} b={b} edits={edits} cmp={cmp} current={cur} open={openId} onMenu={openDocMenu} ref={heads} />}
              {view === 'unified' && kind === 'text' && <div className="topcap" />}
              {kind === 'image' && bothPictures ? (
                <ImageView ctl={imageCtl} notes={notesApi} />
              ) : kind === 'audio' ? (
                <AudioView ctl={audioCtl} heads={{ docs: { a, b }, open: openId, onMenu: openDocMenu }} notes={notesApi} bands={elastic} />
              ) : (
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
              )}
              {!elastic && kind === 'text' && <div className="endcap" />}
            </div>
            {kind === 'text' && (
              <Overview layout={lay} scroller={scroller} current={cur} minimap={minimap} palette={`${dark}:${lowContrast}`} onGo={onOverviewGo} onScrolled={onOverviewScrolled} />
            )}
            {sidebar && kind === 'audio' && <AudioPanel ctl={audioCtl} notes={notesApi} onClose={closeSidebar} />}
            {sidebar && kind === 'image' && bothPictures && <ImagePanel ctl={imageCtl} notes={notesApi} onClose={closeSidebar} />}
            {sidebar && kind === 'text' && (
              <ChangesPanel
                cmp={cmp}
                current={cur}
                same={same}
                onGo={goToChange}
                onClose={closeSidebar}
                review={panelReview}
                decisions={decided}
                onDecide={decide}
                onApplyDecisions={applyDecisions}
                risks={risks}
                summary={{ points: summaryPoints, available: !!claudeAvailable, running: summarizing }}
                onSummarize={() => void summarize()}
                onStopSummary={() => summaryStop.current?.abort()}
              />
            )}
          </>
        ) : (
          <EmptyState a={a} b={b} onLoad={startLoad} onMenu={openDocMenu} onSamples={loadSamples} media={loadMedia} onMedia={setLoadMedia} />
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
