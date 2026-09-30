/**
 * Spelling, grammar and contract checking: the dictionary for the chosen
 * language and the reader's own words, what they ignored, Claude's findings,
 * the findings underlined on the page, and what can be done with one.
 */
import type { MouseEvent, RefObject } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Ignores, Issue } from '../../check/check';
import { ignoreKey } from '../../check/check';
import { batches, claudeCheck, claudeError, claudeSampler } from '../../check/claude';
import { replaceInParagraph } from '../../check/edit';
import type { ClaudeFindings, PlacedIssue } from '../../check/place';
import { countIssues, placeIssues } from '../../check/place';
import type { Lang, Speller } from '../../check/spell';
import { loadSpeller } from '../../check/spell';
import type { Comparison } from '../../core/compare';
import type { Block } from '../../core/model';
import { blockStream, hashText } from '../../review/anchor';
import { paintRanges, rangeAt, segmentRange } from '../../review/dom';
import type { ClaudeState } from '../check-ui';
import type { DocHistory } from '../history';
import type { SavedExtra } from '../session';
import type { ToastFn } from '../toasts';
import type { Side } from '../util';
import { SIDE_NAME, plural } from '../util';
import { backendFor, withDoc } from './docs';
import type { Pop } from './pop';
import { floatingAnchor } from './pop';

const WORDS_KEY = 'collate.words.v1';

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

interface CheckingDeps {
  cmp: Comparison | null;
  /** Checking is on, in `lang`; `claude`: the reader lets Claude be asked. */
  on: boolean;
  lang: Lang;
  claude: boolean;
  /** What was kept with the comparison (before a reload). */
  saved: SavedExtra | undefined;
  history: DocHistory;
  toast: ToastFn;
  setPop(pop: Pop | null): void;
  openPop(pop: Pop): void;
  goToRow(rowKey: string): void;
  grid: RefObject<HTMLDivElement | null>;
  root: RefObject<HTMLDivElement | null>;
}

export type Checking = ReturnType<typeof useChecking>;

export function useChecking({ cmp, on, lang, claude, saved, history, toast, setPop, openPop, goToRow, grid, root }: CheckingDeps) {
  const [speller, setSpeller] = useState<Speller | null>(null);
  /** The reader's own dictionary (kept in the browser), and what they ignored in this comparison. */
  const [words, setWords] = useState<string[]>(loadWords);
  const [ignored, setIgnored] = useState(() => readIgnored(saved?.ignored));
  /** Claude's findings, by the hash of the paragraph text they are about. */
  const [claudeFound, setClaudeFound] = useState<Record<string, Issue[]>>(() => readClaude(saved?.claude));
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
    () => (on && cmp && speller?.lang === lang ? placeIssues(cmp, speller, ignores, claudeFound as ClaudeFindings) : []),
    [on, cmp, speller, lang, ignores, claudeFound],
  );
  const counts = on && speller?.lang === lang ? countIssues(issues) : null;
  const claudeReady = claude && !!claudeAvailable;

  useEffect(() => {
    try {
      localStorage.setItem(WORDS_KEY, JSON.stringify(words));
    } catch {
      /* storage unavailable */
    }
  }, [words]);
  // The dictionary loads the first time checking is on (and again for the other language).
  useEffect(() => {
    if (!on) return;
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
  }, [on, lang]);
  useEffect(() => {
    let live = true;
    void claudeSampler().then((s) => live && setClaudeAvailable(!!s));
    return () => {
      live = false;
    };
  }, []);

  // Findings are underlined: red for spelling, blue for grammar.
  useLayoutEffect(() => {
    const g = on ? grid.current : null;
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
  });

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

  /** A click on underlined words opens their finding. */
  const onIssueClick = (e: MouseEvent): boolean => {
    if (!on || !issueRanges.current.size) return false;
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return false;
    const key = rangeAt(issueRanges.current, e.clientX, e.clientY);
    const pi = key ? issues.find((x) => x.key === key) : undefined;
    const range = key ? issueRanges.current.get(key)?.[0] : undefined;
    if (!pi || !range) return false;
    e.stopPropagation();
    const suggestions = pi.issue.kind === 'spelling' && speller ? speller.suggest(pi.issue.text) : pi.issue.suggestions;
    openPop({ type: 'issue', anchor: floatingAnchor(root.current, range.getBoundingClientRect()), key: pi.key, suggestions });
    return true;
  };

  /** Whether underlined words are at a point on the screen. */
  const issueAt = (x: number, y: number) => on && issueRanges.current.size > 0 && !!rangeAt(issueRanges.current, x, y);

  return {
    issues,
    counts,
    words,
    ignored,
    claudeFound,
    claudeAvailable,
    claudeRun,
    claudeReady,
    fixIssue,
    ignoreIssue,
    addWord,
    clearWords: () => setWords([]),
    askClaude,
    stopClaude: () => claudeStop.current?.abort(),
    nextIssue,
    onIssueClick,
    issueAt,
    /** Forgets what was ignored and found in this comparison (for new documents). */
    clear: () => {
      setIgnored({ words: [], rules: [] });
      setClaudeFound({});
    },
    /** What was ignored and found, as kept with the documents. */
    load: (extra: SavedExtra) => {
      setIgnored(readIgnored(extra.ignored));
      setClaudeFound(readClaude(extra.claude));
    },
  };
}
