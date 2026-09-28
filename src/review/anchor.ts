/**
 * Where review marks are: a stretch of one document's text, or a change.
 *
 * Text is found again by what it says rather than by position, as web
 * annotations are: the marked words, a little of the text before and after
 * them, and roughly where they were. That survives a reload (when blocks get
 * new ids), switching views, and edits elsewhere in the document; the words
 * themselves changing (say, a change copied over them) loses the mark, which
 * then shows as no longer found.
 *
 * A document's text here is each block's text, one after the other, with a
 * line break between blocks. In a block, a picture or other object counts as
 * one character (U+FFFC), and table cells and rows are separated by tabs and
 * line breaks. The same text is read from the page (dom.ts) to show the marks.
 */
import type { Comparison, Row } from '../core/compare';
import type { Block, Doc } from '../core/model';
import { OBJ_CHAR } from '../core/model';

export type Side = 'a' | 'b';

/** Builds text with separators that only appear between two pieces of text. */
export class TextBuilder {
  out = '';
  private pending = '';

  /** A tab or line break before the next text, if any text comes before it (a line break wins over a tab). */
  sep(ch: '\n' | '\t'): void {
    if (this.out && this.pending !== '\n') this.pending = ch;
  }

  text(t: string): void {
    if (!t) return;
    if (this.pending) {
      this.out += this.pending;
      this.pending = '';
    }
    this.out += t;
  }
}

function emitBlock(e: TextBuilder, b: Block): void {
  switch (b.type) {
    case 'p':
      for (const s of b.spans) if (!s.marker) e.text(s.obj ? OBJ_CHAR : s.text);
      break;
    case 'table':
      b.rows.forEach((r, i) => {
        if (i) e.sep('\n');
        r.cells.forEach((c, j) => {
          if (j) e.sep('\t');
          // A cell covered by the one above shows nothing.
          if (c.vmerge === 'continue') return;
          c.blocks.forEach((x, k) => {
            if (k) e.sep('\n');
            emitBlock(e, x);
          });
        });
      });
      break;
    case 'opaque':
      b.blocks.forEach((x, k) => {
        if (k) e.sep('\n');
        emitBlock(e, x);
      });
      break;
    case 'marker':
      break;
  }
}

const blockTexts = new WeakMap<Block, string>();

/** A block's text as review marks see it. */
export function blockStream(b: Block): string {
  let t = blockTexts.get(b);
  if (t === undefined) {
    const e = new TextBuilder();
    emitBlock(e, b);
    t = e.out;
    blockTexts.set(b, t);
  }
  return t;
}

/** A document's text, and where each block's text starts in it. */
export interface Stream {
  text: string;
  blocks: Block[];
  starts: number[];
}

const streams = new WeakMap<Doc, Stream>();

export function docStream(doc: Doc): Stream {
  let s = streams.get(doc);
  if (s) return s;
  const blocks = doc.blocks.filter((b) => b.type !== 'marker');
  const starts: number[] = [];
  let text = '';
  blocks.forEach((b, i) => {
    if (i) text += '\n';
    starts.push(text.length);
    text += blockStream(b);
  });
  s = { text, blocks, starts };
  streams.set(doc, s);
  return s;
}

/** The block a character of the stream belongs to (the one before a line break between blocks). */
export function blockAt(s: Stream, offset: number): number {
  let lo = 0;
  let hi = s.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s.starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** A piece of a stretch of text, inside one block. */
export interface Segment {
  block: Block;
  start: number;
  end: number;
}

/** The stretch [start, end) of the stream, block by block. */
export function segments(s: Stream, start: number, end: number): Segment[] {
  const out: Segment[] = [];
  if (!s.blocks.length) return out;
  for (let i = blockAt(s, start); i < s.blocks.length && s.starts[i]! < Math.max(end, start + 1); i++) {
    const b = s.blocks[i]!;
    const len = blockStream(b).length;
    const from = Math.max(start, s.starts[i]!) - s.starts[i]!;
    const to = Math.min(end, s.starts[i]! + len) - s.starts[i]!;
    if (to > from || (start === end && from === to)) out.push({ block: b, start: from, end: to });
  }
  return out;
}

/* ----------------------------------------------------------------- text */

/** Some text of one document. */
export interface TextTarget {
  type: 'text';
  side: Side;
  /** The marked text, and up to CONTEXT characters before and after it. */
  quote: string;
  prefix: string;
  suffix: string;
  /** Where it started in the document's text, to choose between repeats. */
  pos: number;
}

const CONTEXT = 40;
/** Places to consider for one quote, at most. */
const MAX_HITS = 400;

export function textTarget(s: Stream, side: Side, start: number, end: number): TextTarget {
  return {
    type: 'text',
    side,
    quote: s.text.slice(start, end),
    prefix: s.text.slice(Math.max(0, start - CONTEXT), start),
    suffix: s.text.slice(end, end + CONTEXT),
    pos: start,
  };
}

function sharedEnd(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function sharedStart(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Where the target's text is in the stream: of the places where its words
 * are, the one whose surroundings match best, then the nearest to where it
 * was. Null when its words are nowhere.
 */
export function findText(s: Stream, t: TextTarget): { start: number; end: number } | null {
  if (!t.quote) return null;
  let best = -1;
  let bestScore = -Infinity;
  let hits = 0;
  for (let at = s.text.indexOf(t.quote); at >= 0 && hits < MAX_HITS; at = s.text.indexOf(t.quote, at + 1), hits++) {
    const before = s.text.slice(Math.max(0, at - t.prefix.length), at);
    const after = s.text.slice(at + t.quote.length, at + t.quote.length + t.suffix.length);
    const score = sharedEnd(before, t.prefix) + sharedStart(after, t.suffix) - Math.abs(at - t.pos) / (s.text.length + 1);
    if (score > bestScore) {
      bestScore = score;
      best = at;
    }
  }
  return best < 0 ? null : { start: best, end: best + t.quote.length };
}

/* -------------------------------------------------------------- changes */

/** A change between the documents, known by the text of each side. */
export interface ChangeTarget {
  type: 'change';
  /** Hashes of A's and of B's text in the change. */
  ha: string;
  hb: string;
  /** The start of each side's text, to name the change when it is gone. */
  a: string;
  b: string;
  /** Which change it was, to choose between identical ones. */
  index: number;
}

export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}.${s.length.toString(36)}`;
}

function sideText(rows: readonly Row[], side: 'l' | 'r'): string {
  return rows.map((r) => (r[side] ? blockStream(r[side]) : '')).join('\n');
}

const changeHashes = new WeakMap<Comparison, Array<[string, string]>>();

function hashesOf(cmp: Comparison): Array<[string, string]> {
  let hs = changeHashes.get(cmp);
  if (!hs) {
    hs = cmp.hunks.map((h) => {
      const rows = cmp.rows.slice(h.start, h.end);
      return [hashText(sideText(rows, 'l')), hashText(sideText(rows, 'r'))];
    });
    changeHashes.set(cmp, hs);
  }
  return hs;
}

const EXCERPT = 120;

export function changeTarget(cmp: Comparison, hunk: number): ChangeTarget {
  const h = cmp.hunks[hunk]!;
  const rows = cmp.rows.slice(h.start, h.end);
  const [ha, hb] = hashesOf(cmp)[hunk]!;
  return { type: 'change', ha, hb, a: sideText(rows, 'l').slice(0, EXCERPT), b: sideText(rows, 'r').slice(0, EXCERPT), index: hunk };
}

/** The change the target is, in this comparison, or -1 when it is no longer there. */
export function findChange(cmp: Comparison, t: ChangeTarget): number {
  let best = -1;
  hashesOf(cmp).forEach(([ha, hb], i) => {
    if (ha === t.ha && hb === t.hb && (best < 0 || Math.abs(i - t.index) < Math.abs(best - t.index))) best = i;
  });
  return best;
}
