/**
 * Review marks: notes, highlights and reactions (thumbs up, thumbs down, an
 * idea) that the reader puts on changes and on the documents' text. They are
 * the reader's own, kept with the comparison in this browser; they never go
 * into the documents.
 */
import type { Comparison } from '../core/compare';
import type { Block } from '../core/model';
import type { ChangeTarget, Segment, Side, Stream, TextTarget } from './anchor';
import { docStream, findChange, findText, segments } from './anchor';

export type Reaction = 'up' | 'down' | 'idea';
export const REACTIONS: readonly Reaction[] = ['up', 'down', 'idea'];

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export type Target = TextTarget | ChangeTarget;

interface MarkBase {
  id: string;
  target: Target;
  created: number;
  updated?: number;
}

export interface NoteMark extends MarkBase {
  kind: 'note';
  text: string;
}

export interface HighlightMark extends MarkBase {
  kind: 'highlight';
  target: TextTarget;
  color: HighlightColor;
}

export interface ReactionMark extends MarkBase {
  kind: 'reaction';
  target: ChangeTarget;
  reaction: Reaction;
}

export type Mark = NoteMark | HighlightMark | ReactionMark;

let seq = 0;
export function markId(): string {
  seq += 1;
  return `m${Date.now().toString(36)}${seq.toString(36)}`;
}

/* -------------------------------------------------------------- placing */

/** Where a mark is in the comparison as it is now. */
export interface Placed {
  mark: Mark;
  /** Its text or change is still there. */
  found: boolean;
  /** The document its text is in (text marks). */
  side?: Side;
  /** The change it is on, or that its text is in (-1 for none). */
  hunk: number;
  /** The row it shows beside. */
  rowKey?: string;
  /** Its text, block by block, with the row each block is on. */
  parts?: Array<Segment & { rowKey: string }>;
}

/** The row each block of a side is on. */
function rowsOf(cmp: Comparison, side: Side): Map<Block, { key: string; hunk: number }> {
  const m = new Map<Block, { key: string; hunk: number }>();
  for (const r of cmp.rows) {
    const b = side === 'a' ? r.l : r.r;
    if (b) m.set(b, { key: r.key, hunk: r.hunk });
  }
  return m;
}

export function streamsOf(cmp: Comparison): Record<Side, Stream> {
  return { a: docStream(cmp.left), b: docStream(cmp.right) };
}

/** Finds every mark in the comparison. */
export function placeMarks(marks: readonly Mark[], cmp: Comparison): Placed[] {
  const streams = streamsOf(cmp);
  const rows: Partial<Record<Side, ReturnType<typeof rowsOf>>> = {};
  const rowsFor = (side: Side) => (rows[side] ??= rowsOf(cmp, side));
  return marks.map((mark): Placed => {
    const t = mark.target;
    if (t.type === 'change') {
      const hunk = findChange(cmp, t);
      if (hunk < 0) return { mark, found: false, hunk: -1 };
      return { mark, found: true, hunk, rowKey: cmp.rows[cmp.hunks[hunk]!.start]!.key };
    }
    const at = findText(streams[t.side], t);
    if (!at) return { mark, found: false, side: t.side, hunk: -1 };
    const byBlock = rowsFor(t.side);
    const parts: Array<Segment & { rowKey: string }> = [];
    let hunk = -1;
    for (const seg of segments(streams[t.side], at.start, at.end)) {
      const row = byBlock.get(seg.block);
      // A block the comparison leaves out (an empty paragraph) has no row to show it on.
      if (!row) continue;
      if (!parts.length) hunk = row.hunk;
      parts.push({ ...seg, rowKey: row.key });
    }
    if (!parts.length) return { mark, found: false, side: t.side, hunk: -1 };
    return { mark, found: true, side: t.side, hunk, rowKey: parts[0]!.rowKey, parts };
  });
}

/* --------------------------------------------------------------- margins */

/** What the margin beside one side of a row shows. */
export interface MarginInfo {
  notes: number;
  highlights: HighlightColor[];
  reactions: Reaction[];
}

export const marginKey = (rowKey: string, side: Side) => `${rowKey}|${side}`;

/**
 * The marks in each margin: text marks beside the row their text starts on,
 * change marks beside the change's first row, on both sides.
 */
export function margins(placed: readonly Placed[]): Map<string, MarginInfo> {
  const m = new Map<string, MarginInfo>();
  const at = (key: string) => {
    let info = m.get(key);
    if (!info) m.set(key, (info = { notes: 0, highlights: [], reactions: [] }));
    return info;
  };
  for (const p of placed) {
    if (!p.found || !p.rowKey) continue;
    const mark = p.mark;
    const sides: Side[] = p.side ? [p.side] : ['a', 'b'];
    for (const side of sides) {
      const info = at(marginKey(p.rowKey, side));
      if (mark.kind === 'note') info.notes++;
      else if (mark.kind === 'highlight') {
        if (!info.highlights.includes(mark.color)) info.highlights.push(mark.color);
      } else if (!info.reactions.includes(mark.reaction)) info.reactions.push(mark.reaction);
    }
  }
  for (const info of m.values()) info.reactions.sort((x, y) => REACTIONS.indexOf(x) - REACTIONS.indexOf(y));
  return m;
}

/** A short string that changes when the margin does, for memoized rows. */
export function marginSig(info: MarginInfo | undefined): string {
  return info ? `${info.notes}:${info.highlights.join(',')}:${info.reactions.join(',')}` : '';
}

/* ------------------------------------------------------------- changing */

/** The reactions on a change: thumbs up and down exclude each other, an idea goes with either. */
export function toggleReaction(marks: readonly Mark[], target: ChangeTarget, hunk: number, cmp: Comparison, reaction: Reaction): Mark[] {
  const on = (m: Mark): m is ReactionMark => m.kind === 'reaction' && findChange(cmp, m.target) === hunk;
  const had = marks.some((m) => on(m) && m.reaction === reaction);
  const out = marks.filter((m) => !(on(m) && (m.reaction === reaction || (reaction !== 'idea' && m.reaction !== 'idea'))));
  if (!had) out.push({ id: markId(), kind: 'reaction', target, reaction, created: Date.now() });
  return out;
}

/** Marks with A and B the other way round (the documents were swapped). */
export function swapMarks(marks: readonly Mark[]): Mark[] {
  return marks.map((m): Mark => {
    const t = m.target;
    if (t.type === 'text') return { ...m, target: { ...t, side: t.side === 'a' ? 'b' : 'a' } } as Mark;
    return { ...m, target: { ...t, ha: t.hb, hb: t.ha, a: t.b, b: t.a } } as Mark;
  });
}

/* --------------------------------------------------------------- saving */

const isStr = (x: unknown): x is string => typeof x === 'string';

function readTarget(t: unknown): Target | null {
  if (!t || typeof t !== 'object') return null;
  const o = t as Record<string, unknown>;
  if (o.type === 'text' && (o.side === 'a' || o.side === 'b') && isStr(o.quote) && o.quote && isStr(o.prefix) && isStr(o.suffix) && typeof o.pos === 'number')
    return { type: 'text', side: o.side, quote: o.quote, prefix: o.prefix, suffix: o.suffix, pos: o.pos };
  if (o.type === 'change' && isStr(o.ha) && isStr(o.hb) && isStr(o.a) && isStr(o.b) && typeof o.index === 'number')
    return { type: 'change', ha: o.ha, hb: o.hb, a: o.a, b: o.b, index: o.index };
  return null;
}

/** Marks read back from storage, keeping only well-formed ones. */
export function readMarks(raw: unknown): Mark[] {
  if (!Array.isArray(raw)) return [];
  const out: Mark[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const target = readTarget(o.target);
    if (!target || !isStr(o.id) || typeof o.created !== 'number') continue;
    const base = { id: o.id, created: o.created, updated: typeof o.updated === 'number' ? o.updated : undefined };
    if (o.kind === 'note' && isStr(o.text)) out.push({ ...base, kind: 'note', target, text: o.text });
    else if (o.kind === 'highlight' && target.type === 'text' && HIGHLIGHT_COLORS.includes(o.color as HighlightColor))
      out.push({ ...base, kind: 'highlight', target, color: o.color as HighlightColor });
    else if (o.kind === 'reaction' && target.type === 'change' && REACTIONS.includes(o.reaction as Reaction))
      out.push({ ...base, kind: 'reaction', target, reaction: o.reaction as Reaction });
  }
  return out;
}
