/**
 * A redline: the comparison as one document, the way Word shows tracked
 * changes. It follows B (the newer version): B's paragraphs in B's order,
 * A's removed paragraphs where they were, and in a changed paragraph A's
 * words struck out beside B's new ones. Format writers turn the plan into a
 * file (see formats/docx/redline.ts).
 */
import type { Comparison } from './compare';
import { inlineDiff } from './compare';
import { findMoves } from './moves';
import type { InlineDiff } from './inline';
import type { Block, Doc, Fmt, ParaBlock, Span, TableBlock, TableRow } from './model';
import { newId } from './model';
import type { Tokenized } from './tokens';

export type RedSide = 'a' | 'b';

/**
 * Characters [start, end) of a span of one side's paragraph. `mark` says what
 * happened to them: removed (A's words), added (B's), or only reformatted
 * (B's words, `was` being A's formatting). Unmarked pieces are B's, unchanged.
 */
export interface RedPiece {
  side: RedSide;
  span: number;
  start: number;
  end: number;
  mark?: 'del' | 'ins' | 'fmt';
  was?: Fmt;
}

export interface RedRow {
  side: RedSide;
  row: TableRow;
  mark?: 'del' | 'ins';
}

/** The row of the comparison an item shows (none for B's blocks the comparison leaves out). */
interface RedItemBase {
  rowKey?: string;
  /** A paragraph moved unchanged: removed here (from) or added here (to), both ends sharing a name. */
  move?: { name: string; end: 'from' | 'to' };
}

export type RedItem = RedItemBase &
  (
    | /** A block of B that did not change (or that the comparison leaves out, like an empty paragraph). */ { kind: 'same'; block: Block }
    | /** A block only in B. */ { kind: 'ins'; block: Block }
    | /** A block only in A, where it was. */ { kind: 'del'; block: Block }
    | /** A paragraph in both, with its words marked. */ { kind: 'para'; a: ParaBlock; b: ParaBlock; pieces: RedPiece[] }
    | /** A table in both, row by row. */ { kind: 'table'; a: TableBlock; b: TableBlock; rows: RedRow[] }
  );

/** The redline of a comparison, in B's order. */
export function redlinePlan(cmp: Comparison): RedItem[] {
  const all = cmp.right.blocks;
  const pos = new Map<Block, number>();
  all.forEach((b, i) => pos.set(b, i));
  const out: RedItem[] = [];
  let cursor = 0;
  // B's blocks the comparison leaves out stay where they are.
  const flushTo = (idx: number) => {
    while (cursor < idx) out.push({ kind: 'same', block: all[cursor++]! });
  };
  for (const row of cmp.rows) {
    if (row.r) {
      const idx = pos.get(row.r);
      if (idx === undefined) continue;
      flushTo(idx);
      cursor = idx + 1;
    }
    const { l, r } = row;
    const rowKey = row.key;
    if (row.kind === 'eq' && r) out.push({ kind: 'same', block: r, rowKey });
    else if (!l && r) out.push({ kind: 'ins', block: r, rowKey });
    else if (l && !r) out.push({ kind: 'del', block: l, rowKey });
    else if (l && r) {
      if (row.kind === 'mod' && l.type === 'p' && r.type === 'p') out.push({ kind: 'para', a: l, b: r, pieces: paraPieces(inlineDiff(l, r, cmp.opts), l, r), rowKey });
      else if (row.kind === 'table' && row.table && l.type === 'table' && r.type === 'table') out.push({ kind: 'table', a: l, b: r, rows: tableRows(row.table.rows), rowKey });
      else out.push({ kind: 'del', block: l, rowKey }, { kind: 'ins', block: r, rowKey });
    }
  }
  flushTo(all.length);
  // Paragraphs moved unchanged are moves, not a removal and an addition.
  const moves = new Map<string, { name: string; end: 'from' | 'to' }>();
  findMoves(cmp).forEach((m, i) => {
    if (!m.exact) return;
    moves.set(m.from, { name: `move${i + 1}`, end: 'from' });
    moves.set(m.to, { name: `move${i + 1}`, end: 'to' });
  });
  for (const it of out) {
    const mv = it.rowKey ? moves.get(it.rowKey) : undefined;
    if (mv && ((it.kind === 'del' && mv.end === 'from') || (it.kind === 'ins' && mv.end === 'to')) && it.block.type === 'p') it.move = mv;
  }
  return out;
}

function tableRows(rows: NonNullable<Comparison['rows'][number]['table']>['rows']): RedRow[] {
  const out: RedRow[] = [];
  for (const r of rows) {
    if (r.kind === 'eq' && r.r) out.push({ side: 'b', row: r.r });
    else {
      // A changed row: A's struck out, then B's.
      if (r.l) out.push({ side: 'a', row: r.l, mark: 'del' });
      if (r.r) out.push({ side: 'b', row: r.r, mark: 'ins' });
    }
  }
  return out;
}

/** The pieces of a changed paragraph: B's text, with A's removed words before the words that replaced them. */
export function paraPieces(diff: InlineDiff, a: ParaBlock, b: ParaBlock): RedPiece[] {
  const raw: RedPiece[] = [];
  const tokens = (side: RedSide, t: Tokenized, f0: number, f1: number, mark?: RedPiece['mark'], was?: Fmt) => {
    for (let k = f0; k < f1; k++) for (const p of t.tokens[k]!.pieces) raw.push({ side, span: p.span, start: p.start, end: p.end, mark, was });
  };
  const A = diff.a;
  const B = diff.b;
  const range = (t: Tokenized, c0: number, c1: number): [number, number] => (c1 > c0 ? [t.comp[c0]!, t.comp[c1 - 1]! + 1] : [0, 0]);
  // B's tokens outside the comparison (leading and trailing spaces).
  const bFirst = B.comp.length ? B.comp[0]! : B.tokens.length;
  tokens('b', B, 0, bFirst);
  let bEnd = bFirst;
  for (const seg of diff.segs) {
    const [b0, b1] = range(B, seg.b0, seg.b1);
    const [a0, a1] = range(A, seg.a0, seg.a1);
    if (b1 > b0) bEnd = b1;
    if (seg.eq) {
      tokens('b', B, b0, b1);
      continue;
    }
    const change = diff.changes[seg.change]!;
    if (change.fmtOnly) {
      // The same words: B's, noting A's formatting.
      const first = A.tokens[a0]?.pieces[0];
      tokens('b', B, b0, b1, 'fmt', first ? a.spans[first.span]?.fmt : undefined);
      continue;
    }
    tokens('a', A, a0, a1, 'del');
    tokens('b', B, b0, b1, 'ins');
  }
  tokens('b', B, Math.max(bEnd, bFirst), B.tokens.length);

  // Join neighbouring pieces of one span, and keep B's markers (bookmarks, comment anchors) in place.
  const merged: RedPiece[] = [];
  let lastB = -1;
  const markersBefore = (limit: number) => {
    for (let k = lastB + 1; k < limit; k++) if (b.spans[k]?.marker) merged.push({ side: 'b', span: k, start: 0, end: 0 });
  };
  for (const p of raw) {
    if (p.side === 'b' && p.span > lastB) {
      markersBefore(p.span);
      lastB = p.span;
    }
    const prev = merged[merged.length - 1];
    if (prev && prev.side === p.side && prev.span === p.span && prev.mark === p.mark && prev.end === p.start) prev.end = p.end;
    else merged.push({ ...p });
  }
  markersBefore(b.spans.length);
  return merged;
}

/* ------------------------------------------------------------ comments */

/** A review note (or reaction) to put in the redline as a comment. */
export interface RedNote {
  text: string;
  date: number;
  author?: string;
  /** The words it is on, for a list of the notes. */
  quote?: string;
  /** On some text of one side (block by block, offsets in each block's text as review marks count it), or on a change. */
  on: { kind: 'text'; side: RedSide; parts: ReadonlyArray<{ block: Block; start: number; end: number }> } | { kind: 'change'; hunk: number };
}

/**
 * One end of a comment's range: in an item at a character of one of its
 * paragraphs' spans, or (without `at`) at the start or end of the whole item.
 */
export interface RedPoint {
  item: number;
  at?: { side: RedSide; span: number; offset: number };
}

export interface RedComment {
  note: RedNote;
  start: RedPoint;
  end: RedPoint;
}

/** Which item shows a block, and whether its words can be pointed at there (they are laid out piece by piece). */
function itemsByBlock(plan: readonly RedItem[]): Map<Block, { item: number; exact: RedSide | null }> {
  const m = new Map<Block, { item: number; exact: RedSide | null }>();
  plan.forEach((it, i) => {
    if (it.kind === 'para') {
      m.set(it.b, { item: i, exact: 'b' });
      // A's words that stayed are shown as B's: A's paragraph as a whole.
      m.set(it.a, { item: i, exact: null });
    } else if (it.kind === 'table') {
      m.set(it.a, { item: i, exact: null });
      m.set(it.b, { item: i, exact: null });
    } else m.set(it.block, { item: i, exact: it.block.type === 'p' ? (it.kind === 'del' ? 'a' : 'b') : null });
  });
  return m;
}

/** A character of a paragraph's text (as review marks count it) as a span and a place in it. */
export function spanOffset(p: ParaBlock, offset: number, edge: 'start' | 'end'): { span: number; offset: number } {
  let at = 0;
  let last = -1;
  for (let i = 0; i < p.spans.length; i++) {
    const s = p.spans[i]!;
    if (s.marker) continue;
    const len = s.obj ? 1 : s.text.length;
    // A start goes to the span the character is in; an end, to the span it closes.
    if (edge === 'start' ? offset < at + len : offset <= at + len) return { span: i, offset: Math.max(0, offset - at) };
    at += len;
    last = i;
  }
  const s = last >= 0 ? p.spans[last]! : undefined;
  return { span: Math.max(last, 0), offset: s ? (s.obj ? 1 : s.text.length) : 0 };
}

/** Where each note goes in the redline. Notes whose text or change the redline doesn't show are left out. */
export function redlineComments(cmp: Comparison, plan: readonly RedItem[], notes: readonly RedNote[]): RedComment[] {
  const byBlock = itemsByBlock(plan);
  const byRow = new Map<string, number[]>();
  plan.forEach((it, i) => {
    if (!it.rowKey) return;
    const list = byRow.get(it.rowKey);
    if (list) list.push(i);
    else byRow.set(it.rowKey, [i]);
  });
  const out: RedComment[] = [];
  for (const note of notes) {
    if (note.on.kind === 'change') {
      const h = cmp.hunks[note.on.hunk];
      if (!h) continue;
      const items = cmp.rows.slice(h.start, h.end).flatMap((r) => byRow.get(r.key) ?? []);
      if (!items.length) continue;
      out.push({ note, start: { item: Math.min(...items) }, end: { item: Math.max(...items) } });
      continue;
    }
    const { side, parts } = note.on;
    const first = parts[0];
    const last = parts[parts.length - 1];
    const f = first && byBlock.get(first.block);
    const l = last && byBlock.get(last.block);
    if (!first || !last || !f || !l) continue;
    const point = (hit: { item: number; exact: RedSide | null }, block: Block, offset: number, edge: 'start' | 'end'): RedPoint =>
      hit.exact === side && block.type === 'p' ? { item: hit.item, at: { side, ...spanOffset(block, offset, edge) } } : { item: hit.item };
    out.push({ note, start: point(f, first.block, first.start, 'start'), end: point(l, last.block, last.end, 'end') });
  }
  return out;
}

/* ------------------------------------------------------ as a document */

/** A block (and everything in it) with its text marked as added or removed. */
function revBlock(b: Block, rev: 'ins' | 'del'): Block {
  const spans = (ss: readonly Span[]) => ss.map((s) => (s.marker ? s : { ...s, fmt: { ...s.fmt, rev }, x: undefined }));
  switch (b.type) {
    case 'p':
      return { ...b, id: newId('r'), spans: spans(b.spans), x: undefined };
    case 'table':
      return { ...b, id: newId('r'), rows: b.rows.map((r) => revRow(r, rev)), x: undefined };
    case 'opaque':
      return { ...b, id: newId('r'), blocks: b.blocks.map((x) => revBlock(x, rev)), x: undefined };
    case 'marker':
      return b;
  }
}

function revRow(r: TableRow, rev: 'ins' | 'del'): TableRow {
  return { ...r, id: newId('r'), x: undefined, cells: r.cells.map((c) => ({ ...c, x: undefined, blocks: c.blocks.map((x) => revBlock(x, rev)) })) };
}

/**
 * The redline as a document of its own, for formats without tracked changes
 * (PDF): removed text and added text are marked in their formatting (`rev`).
 */
export function redlineDoc(cmp: Comparison, plan: readonly RedItem[] = redlinePlan(cmp), notes: readonly RedNote[] = []): Doc {
  const blocks: Block[] = [];
  for (const it of plan) {
    switch (it.kind) {
      case 'same':
        blocks.push(it.block);
        break;
      case 'ins':
      case 'del':
        blocks.push(revBlock(it.block, it.kind));
        break;
      case 'para': {
        const spans: Span[] = [];
        for (const p of it.pieces) {
          const s = (p.side === 'a' ? it.a : it.b).spans[p.span];
          if (!s || s.marker) continue;
          const rev = p.mark === 'ins' || p.mark === 'del' ? p.mark : undefined;
          const text = s.obj ? s.text : s.text.slice(p.start, p.end);
          if (text) spans.push({ ...s, text, fmt: rev ? { ...s.fmt, rev } : s.fmt, x: undefined });
        }
        blocks.push({ ...it.b, id: newId('r'), spans, x: undefined });
        break;
      }
      case 'table':
        blocks.push({ ...it.b, id: newId('r'), x: undefined, rows: it.rows.map((r) => (r.mark ? revRow(r.row, r.mark) : r.row)) });
        break;
    }
  }
  if (notes.length) blocks.push(...notesBlocks(notes));
  const b = cmp.right;
  return { id: newId('d'), name: b.name, kind: b.kind, blocks, version: 0, mono: b.mono };
}

const para = (spans: Span[], role: ParaBlock['props']['role'] = 'p', level?: number): ParaBlock => ({ id: newId('r'), type: 'p', props: { role, level }, spans });
const run = (text: string, fmt: Fmt = {}): Span => ({ text, fmt });

/** The review notes, listed after the document (formats without comments in the margin). */
export function notesBlocks(notes: readonly RedNote[]): Block[] {
  const out: Block[] = [para([run('Review notes')], 'h', 1)];
  for (const n of notes) {
    const where = n.on.kind === 'change' ? `Change ${n.on.hunk + 1}` : n.quote ? `“${n.quote.replace(/\s+/g, ' ').slice(0, 120)}”` : `Text in ${n.on.side.toUpperCase()}`;
    const who = [n.author, n.date ? new Date(n.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''].filter(Boolean).join(', ');
    out.push(para([run(where, { b: true }), run(who ? `  (${who})` : '', { i: true })]));
    for (const line of n.text.split('\n')) out.push(para([run(line)], 'quote'));
  }
  return out;
}
