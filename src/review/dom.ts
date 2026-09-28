/**
 * Review marks on the page. The documents are rendered as HTML strings, so
 * marks are not written into them: a cell's text is read back from the page
 * the same way anchor.ts reads a block's text from the model, a selection is
 * turned into a text target, and marked text is coloured with the CSS Custom
 * Highlight API, which paints ranges of the page without changing it.
 */
import type { Comparison, Row } from '../core/compare';
import type { Block } from '../core/model';
import { OBJ_CHAR } from '../core/model';
import type { Side, Stream, TextTarget } from './anchor';
import { TextBuilder, blockStream, textTarget } from './anchor';
import type { Placed } from './marks';

/** Parts of a cell that are not the document's text: list labels, change markers, placeholders, margins. */
const SKIP = '.lbl, .chip, .caret, .empty-p, .ph, .opaque-label, .tcap, .rail';
/** Things that stand for one object of the document (a picture, a footnote, a field …). */
const OBJECT = 'img.obj-img, .obj, .fn, .pgbrk, .field, .math, .sym';
const BLOCKISH = ['blk', 'tbl', 'trow', 'opaque'];

const blockish = (el: Element | null) => !!el && BLOCKISH.some((c) => el.classList.contains(c));

interface Piece {
  node: Node;
  start: number;
  len: number;
  obj: boolean;
}

/** The text of one or more cells showing one block, and where each character is on the page. */
export class CellText {
  readonly text: string;
  readonly pieces: Piece[] = [];

  constructor(cells: readonly Element[]) {
    const e = new TextBuilder();
    cells.forEach((cell, i) => {
      // A table shown one row per line: its rows are in separate cells.
      if (i) e.sep('\n');
      this.walk(cell, e);
    });
    this.text = e.out;
  }

  private walk(el: Element, e: TextBuilder): void {
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = (n as Text).data;
        if (!t) continue;
        e.text(t);
        this.pieces.push({ node: n, start: e.out.length - t.length, len: t.length, obj: false });
        continue;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const c = n as Element;
      if (c.matches(SKIP)) continue;
      if (c.matches(OBJECT)) {
        e.text(OBJ_CHAR);
        this.pieces.push({ node: c, start: e.out.length - 1, len: 1, obj: true });
        continue;
      }
      if (blockish(c) && blockish(c.previousElementSibling)) e.sep('\n');
      else if (c.classList.contains('tcell') && c.previousElementSibling?.classList.contains('tcell')) e.sep('\t');
      this.walk(c, e);
    }
  }

  /** The place on the page of a text offset: at the start of the next character, or the end of the last. */
  point(offset: number, edge: 'start' | 'end'): { node: Node; offset: number } | null {
    const ps = this.pieces;
    if (!ps.length) return null;
    let i = ps.findIndex((p) => (edge === 'start' ? offset < p.start + p.len : offset <= p.start + p.len));
    if (i < 0) i = ps.length - 1;
    const p = ps[i]!;
    // In a separator: the start goes forward to the next text, the end back to the last.
    if (edge === 'end' && offset < p.start && i > 0) return this.at(ps[i - 1]!, ps[i - 1]!.len);
    const within = Math.min(Math.max(offset - p.start, 0), p.len);
    return this.at(p, within);
  }

  private at(p: Piece, within: number): { node: Node; offset: number } {
    if (!p.obj) return { node: p.node, offset: within };
    const parent = p.node.parentNode!;
    const index = Array.prototype.indexOf.call(parent.childNodes, p.node) as number;
    return { node: parent, offset: index + (within > 0 ? 1 : 0) };
  }

  /** The text offset of a place on the page (a place in a label or marker counts as before the next text). */
  offsetOf(node: Node, offset: number): number {
    const own = this.pieces.find((p) => p.node === node && !p.obj);
    if (own) return own.start + Math.min(offset, own.len);
    const point = document.createRange();
    try {
      point.setStart(node, offset);
    } catch {
      return this.text.length;
    }
    point.collapse(true);
    for (const p of this.pieces) {
      // The first piece at or after the place.
      if (point.comparePoint(p.node, 0) >= 0) return p.start;
      if (!p.obj && point.comparePoint(p.node, p.len) >= 0) return p.start + p.len;
    }
    return this.text.length;
  }

  /** A range of the page covering [start, end) of the text. */
  range(start: number, end: number): Range | null {
    const a = this.point(start, 'start');
    const b = this.point(end, 'end');
    if (!a || !b) return null;
    const r = document.createRange();
    try {
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
    } catch {
      return null;
    }
    return r.collapsed ? null : r;
  }
}

/** The cells on the page that show one side of a row (a table can take several lines). */
export function cellsOf(grid: Element, rowKey: string, side: Side): Element[] {
  return Array.from(grid.querySelectorAll(`.row[data-key="${CSS.escape(rowKey)}"] > .cell.${side}`));
}

/**
 * Where [start, end) of a block's text is in its cells' text: the same place
 * when the page shows the block's text as it is, otherwise wherever those
 * words are (a changed table cell is shown flattened).
 */
function mapInto(ct: CellText, block: Block, start: number, end: number): [number, number] | null {
  const text = blockStream(block);
  if (ct.text === text) return [start, end];
  const words = text.slice(start, end);
  if (!words) return null;
  const at = ct.text.indexOf(words);
  return at < 0 ? null : [at, at + words.length];
}

/* ------------------------------------------------------------ selection */

export interface SelectionTarget {
  target: TextTarget;
  /** The row the selection starts in. */
  rowKey: string;
  side: Side;
}

/**
 * The text target of what is selected in one document (`side`, or the one the
 * selection starts in), or null when nothing there is selected.
 */
export function selectionTarget(grid: Element, sel: Selection | null, cmp: Comparison, streams: Record<Side, Stream>, prefer?: Side): SelectionTarget | null {
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!grid.contains(range.commonAncestorContainer)) return null;
  const startEl = range.startContainer.nodeType === Node.ELEMENT_NODE ? (range.startContainer as Element) : range.startContainer.parentElement;
  const first = startEl?.closest('.cell.a, .cell.b') ?? Array.from(grid.querySelectorAll('.cell.a, .cell.b')).find((c) => range.intersectsNode(c));
  if (!first) return null;
  const side: Side = prefer ?? (first.classList.contains('a') ? 'a' : 'b');
  const cells = Array.from(grid.querySelectorAll(`.cell.${side}`)).filter((c) => range.intersectsNode(c));
  if (!cells.length) return null;
  const byKey = new Map<string, Row>(cmp.rows.map((r) => [r.key, r]));
  const stream = streams[side];
  const offsetIn = (cell: Element, node: Node, offset: number, edge: 'start' | 'end'): number | null => {
    const rowKey = cell.closest<HTMLElement>('.row')?.dataset.key;
    const row = rowKey ? byKey.get(rowKey) : undefined;
    const block = row ? (side === 'a' ? row.l : row.r) : undefined;
    if (!rowKey || !block) return null;
    const bi = stream.blocks.indexOf(block);
    if (bi < 0) return null;
    const ct = new CellText(cellsOf(grid, rowKey, side));
    const inside = cell.contains(node);
    const at = inside ? ct.offsetOf(node, offset) : edge === 'start' ? 0 : ct.text.length;
    const text = blockStream(block);
    let local = at;
    if (ct.text !== text) {
      // Shown differently from the model: find the words up to the place.
      const around = edge === 'start' ? ct.text.slice(at, at + 20) : ct.text.slice(Math.max(0, at - 20), at);
      const found = around ? text.indexOf(around) : -1;
      if (found < 0) return edge === 'start' ? stream.starts[bi]! : stream.starts[bi]! + text.length;
      local = edge === 'start' ? found : found + around.length;
    }
    return stream.starts[bi]! + Math.min(local, text.length);
  };
  const last = cells[cells.length - 1]!;
  let start = offsetIn(cells[0]!, range.startContainer, range.startOffset, 'start');
  let end = offsetIn(last, range.endContainer, range.endOffset, 'end');
  if (start === null || end === null || end <= start) return null;
  // Spaces and line breaks at either end are not part of what was meant.
  while (start < end && /\s/.test(stream.text[start]!)) start++;
  while (end > start && /\s/.test(stream.text[end - 1]!)) end--;
  if (end <= start) return null;
  const rowKey = cells[0]!.closest<HTMLElement>('.row')!.dataset.key!;
  return { target: textTarget(stream, side, start, end), rowKey, side };
}

/* ------------------------------------------------------------- painting */

type Paint = 'note' | 'hl-yellow' | 'hl-green' | 'hl-blue' | 'hl-pink' | 'focus';
const PAINTS: readonly Paint[] = ['note', 'hl-yellow', 'hl-green', 'hl-blue', 'hl-pink', 'focus'];

interface HighlightRegistry {
  set(name: string, h: unknown): void;
  delete(name: string): void;
}

/**
 * How each kind of mark is painted. Added to the page from here because the
 * build's CSS tools don't know the ::highlight() pseudo-element yet.
 */
const HIGHLIGHT_CSS = `
::highlight(collate-hl-yellow) { background-color: var(--hl-yellow); }
::highlight(collate-hl-green) { background-color: var(--hl-green); }
::highlight(collate-hl-blue) { background-color: var(--hl-blue); }
::highlight(collate-hl-pink) { background-color: var(--hl-pink); }
::highlight(collate-note) {
  background-color: var(--note-mark);
  text-decoration: underline dotted var(--accent);
  text-decoration-thickness: 1.5px;
  text-underline-offset: 3px;
}
::highlight(collate-focus) { background-color: var(--focus-mark); }
::highlight(collate-spell) { text-decoration: underline wavy var(--spell); text-decoration-thickness: 1.25px; text-underline-offset: 3px; }
::highlight(collate-grammar) { text-decoration: underline wavy var(--grammar); text-decoration-thickness: 1.25px; text-underline-offset: 3px; }
`;

let styled = false;

function addHighlightStyles(): void {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const style = document.createElement('style');
  style.dataset.collate = 'highlights';
  style.textContent = HIGHLIGHT_CSS;
  document.head.appendChild(style);
}

function registry(): { reg: HighlightRegistry; Highlight: new (...ranges: Range[]) => unknown } | null {
  const css = globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined;
  const Highlight = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!css?.highlights || !Highlight) return null;
  addHighlightStyles();
  return { reg: css.highlights, Highlight };
}

/** The page ranges of a placed text mark. */
export function markRanges(grid: Element, p: Placed): Range[] {
  const out: Range[] = [];
  if (!p.found || !p.side || !p.parts) return out;
  for (const part of p.parts) {
    const cells = cellsOf(grid, part.rowKey, p.side);
    if (!cells.length) continue;
    const ct = new CellText(cells);
    const at = mapInto(ct, part.block, part.start, part.end);
    if (!at) continue;
    const r = ct.range(at[0], at[1]);
    if (r) out.push(r);
  }
  return out;
}

/**
 * Colours the marked text on the page, and `focus` (the text a card is open
 * for) more strongly. Without a grid it clears them; where the browser can't
 * paint ranges, it does nothing.
 */
export function paintMarks(grid: Element | null, placed: readonly Placed[], focus: readonly Placed[] = []): Map<string, Range[]> {
  const notes = new Map<string, Range[]>();
  const api = registry();
  if (!api) return notes;
  const groups = new Map<Paint, Range[]>(PAINTS.map((p) => [p, []]));
  if (grid) {
    for (const p of placed) {
      const m = p.mark;
      if (m.kind === 'reaction' || !p.found || !p.side) continue;
      const paint: Paint = m.kind === 'note' ? 'note' : `hl-${m.color}`;
      const ranges = markRanges(grid, p);
      groups.get(paint)!.push(...ranges);
      if (m.kind === 'note') notes.set(m.id, ranges);
    }
    for (const p of focus) groups.get('focus')!.push(...markRanges(grid, p));
  }
  for (const [paint, ranges] of groups) {
    const name = `collate-${paint}`;
    if (ranges.length) api.reg.set(name, new api.Highlight(...ranges));
    else api.reg.delete(name);
  }
  return notes;
}

/** The note (of those painted) whose text is at a point on the screen, if any. */
export function noteAt(notes: ReadonlyMap<string, Range[]>, x: number, y: number): string | null {
  const doc = document as Document & {
    caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?(x: number, y: number): Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) {
    node = pos.offsetNode;
    offset = pos.offset;
  } else {
    const r = doc.caretRangeFromPoint?.(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }
  if (!node) return null;
  for (const [id, ranges] of notes) {
    for (const r of ranges) {
      try {
        // Inside the range, not just touching its end.
        if (r.isPointInRange(node, offset) && !(node === r.endContainer && offset === r.endOffset)) return id;
      } catch {
        /* a range from another document */
      }
    }
  }
  return null;
}
