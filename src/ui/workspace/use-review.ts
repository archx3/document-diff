/**
 * Review mode: notes, highlights, reactions and decisions on the documents'
 * text and changes; the margins they are added from; their colours on the
 * page; and what a click or a right-click on marked text, selected text or a
 * change opens.
 */
import type { MouseEvent, RefObject } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Comparison } from '../../core/compare';
import type { TextTarget } from '../../review/anchor';
import { blockStream, changeTarget, findChange, findText, textTarget } from '../../review/anchor';
import { paintMarks, paintRanges, rangeAt, selectionTarget } from '../../review/dom';
import type { Decision, HighlightColor, HighlightMark, Mark, NoteMark, Placed, Reaction, ReactionMark, Target } from '../../review/marks';
import { decisions, margins, markId, placeMarks, readMarks, setDecision, streamsOf, swapMarks, toggleReaction } from '../../review/marks';
import type { ChangeMarks, PanelMark, PanelReview } from '../changes-panel';
import type { ReviewView } from '../grid';
import { useStable } from '../hooks';
import type { RailActions } from '../rail';
import type { CardNote, ReviewContext } from '../review-card';
import type { SavedExtra } from '../session';
import type { Side } from '../util';
import type { Navigation } from './use-navigation';
import type { Pop, ReviewPop } from './pop';
import { floatingAnchor } from './pop';
import type { SetPref } from './prefs';

interface ReviewDeps {
  cmp: Comparison | null;
  /** Review mode is on. */
  on: boolean;
  /** What was kept with the comparison (before a reload). */
  saved: SavedExtra | undefined;
  /** The reader's name, for their marks. */
  me(): string | undefined;
  grid: RefObject<HTMLDivElement | null>;
  root: RefObject<HTMLDivElement | null>;
  pop: Pop | null;
  setPop(pop: Pop | null): void;
  openPop(pop: Pop): void;
  setPref: SetPref;
  /** Whether a spelling or grammar finding's words are at a point (they take the pointer, as marks do). */
  issueAt(x: number, y: number): boolean;
  navigation: Pick<Navigation, 'cur' | 'n' | 'step' | 'goToChange' | 'goToRow'>;
}

export type Review = ReturnType<typeof useReview>;

export function useReview({ cmp, on, saved, me, grid, root, pop, setPop, openPop, setPref, issueAt, navigation }: ReviewDeps) {
  const { cur, n, step, goToChange, goToRow } = navigation;
  const [marks, setMarks] = useState<Mark[]>(() => readMarks(saved?.review));
  /** The line with text selected in it, as "anchor|side": review mode offers to mark it from its margin. */
  const [selLine, setSelLine] = useState<string | null>(null);
  const lastColor = useRef<HighlightColor>('yellow');
  /** Where each note's and highlight's text is on the page, as last painted. */
  const markRanges = useRef<Map<string, Range[]>>(new Map());
  /** The mark under the pointer, painted as it moves. */
  const hovered = useRef<string | null>(null);
  const placed = useMemo(() => (cmp && on ? placeMarks(marks, cmp) : []), [cmp, marks, on]);
  /** The reader's decision on each change (accepted or rejected); the others are open. */
  const decided = useMemo(() => (cmp ? decisions(marks, cmp) : new Map<number, Decision>()), [cmp, marks]);
  const marginMap = useMemo(() => margins(placed), [placed]);

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
    () => (on && cmp ? { margins: marginMap, selected: selLine, actions: railActions } : null),
    [on, cmp, marginMap, selLine, railActions],
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

  /** The reactions on a change. */
  const reactionsOn = (hunk: number): Reaction[] =>
    cmp ? marks.filter((m): m is ReactionMark => m.kind === 'reaction' && findChange(cmp, m.target) === hunk).map((m) => m.reaction) : [];

  /** What the card opened from a margin is about, and the marks already there. */
  const cardContext = (p: ReviewPop): ReviewContext | null => {
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

  /* ---------------------------------------------------------- marking */

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
  /** Reacts to a change, or takes the reaction back. */
  const react = (hunk: number, r: Reaction) => {
    if (cmp && hunk >= 0) setMarks((ms) => toggleReaction(ms, changeTarget(cmp, hunk), hunk, cmp, r, me()));
  };
  const addNote = (target: Target, text: string) => setMarks((ms) => [...ms, { id: markId(), kind: 'note', target, text, created: Date.now(), author: me() }]);
  const editNote = (id: string, text: string) => setMarks((ms) => ms.map((m) => (m.id === id && m.kind === 'note' ? { ...m, text, updated: Date.now() } : m)));
  const remove = (id: string) => setMarks((ms) => ms.filter((m) => m.id !== id));
  /** Marks show in review mode: annotating turns it on. */
  const show = () => {
    if (!on) setPref({ review: true });
  };

  const panelReview = useMemo<PanelReview | null>(() => {
    if (!on || !cmp) return null;
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
  }, [on, cmp, placed]);

  /* ----------------------------------------------------- on the page */

  // Marked text is coloured on the page; while a card or menu is open for some text, that text too.
  useLayoutEffect(() => {
    const focusTarget =
      pop?.type === 'review' ? pop.selection : pop?.type === 'mark' ? (marks.find((m) => m.id === pop.id)?.target ?? null) : pop?.type === 'select' ? pop.sel.target : pop?.type === 'change' ? pop.target : null;
    const focus = focusTarget?.type === 'text' && cmp ? placeMarks([{ id: 'focus', kind: 'note', target: focusTarget, text: '', created: 0 }], cmp) : [];
    // (Out of review mode there are no marks, but text a menu is open for is still shown.)
    markRanges.current = paintMarks(grid.current, placed, focus);
    paintHover(hovered.current);
  });

  /** Shades the words of the mark under the pointer. */
  const paintHover = (id: string | null) => {
    hovered.current = id;
    paintRanges('collate-hover', (id && markRanges.current.get(id)) || [], 1);
  };

  /** The note or highlight whose words are at a point on the screen. */
  const markAt = (x: number, y: number): Placed | undefined => {
    if (!on || !markRanges.current.size) return undefined;
    const id = rangeAt(markRanges.current, x, y);
    return id ? placed.find((p) => p.mark.id === id && p.found && p.rowKey && p.side) : undefined;
  };

  /** A button in the margin beside one side of a row. */
  const railButton = (rowKey: string, side: Side) => grid.current?.querySelector<HTMLElement>(`.row[data-key="${CSS.escape(rowKey)}"] > .rail.${side} button`) ?? null;

  /** The margin button beside the row a mark starts on (or, where there is none, a box over its words). */
  const markAnchor = (p: Placed) => {
    const rect = markRanges.current.get(p.mark.id)?.[0]?.getBoundingClientRect();
    return railButton(p.rowKey!, p.side!) ?? (rect ? floatingAnchor(root.current, rect) : null);
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
  const onMarkClick = (e: MouseEvent) => {
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return;
    const p = markAt(e.clientX, e.clientY);
    if (!p) return;
    e.stopPropagation();
    openMark(p);
  };

  /** A right-click on noted or highlighted text selects it and opens its menu in place of the browser's (Shift keeps the browser's). */
  const onMarkMenu = (e: MouseEvent) => {
    if (e.shiftKey || !cmp) return;
    const anchor = () => floatingAnchor(root.current, new DOMRect(e.clientX, e.clientY, 0, 0));
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
      const onIssue = !buttons && issueAt(x, y);
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
    if (!on) {
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
  }, [on]);

  return {
    marks,
    placed,
    decided,
    reviewView,
    panelReview,
    paragraphTarget,
    highlight,
    colorsOn,
    reactionsOn,
    cardContext,
    decide,
    decideCurrent,
    react,
    addNote,
    editNote,
    remove,
    show,
    railButton,
    openMark,
    onMarkClick,
    onMarkMenu,
    onMarkHover,
    onMarkLeave,
    /** Forgets the marks (for new documents). */
    clear: () => setMarks([]),
    /** Moves each mark to the other side, as the documents are swapped. */
    swap: () => setMarks((ms) => swapMarks(ms)),
    /** The marks kept with the documents; review mode comes on to show them. */
    load: (extra: SavedExtra) => {
      const ms = readMarks(extra.review);
      setMarks(ms);
      if (ms.some((m) => m.kind !== 'status')) setPref({ review: true });
    },
  };
}
