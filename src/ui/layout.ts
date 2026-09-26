/**
 * Where the comparison grid's rows are on the page: measured for the overview
 * and for stepping between changes, scrolled to, and kept in place when the
 * rows above the reader change. The scroller and the grid are positioned, so
 * rows' offsets are in the scrolled content's coordinates.
 */

/** One line of the grid as laid out: where it is in the scrolled content and what it shows. */
export interface RowBox {
  /** Offset from the top of the scrolled content, and height, in px. */
  top: number;
  height: number;
  /** eq, mod, del, ins; tcap, teq, tmod, tdel, tins for the parts of a table; fold. */
  kind: string;
  /** The change it belongs to, -1 for unchanged text. */
  hunk: number;
  /** Characters of text on each side; 0 when that side has nothing here. */
  a: number;
  b: number;
}

export interface HunkBox {
  hunk: number;
  top: number;
  bottom: number;
  kind: 'mod' | 'del' | 'ins';
}

export interface Layout {
  /** Changes whenever anything here may have moved. */
  key: string;
  /** Height of the scrolled content, and of the column heads that stay at its top. */
  total: number;
  head: number;
  rows: RowBox[];
  /** Every change, in order. */
  hunks: HunkBox[];
  /** Line height (px) and characters per line of each side's text, for drawing it in miniature. */
  line: Record<'a' | 'b', number>;
  chars: Record<'a' | 'b', number>;
}

type Get = () => HTMLElement | null;

/**
 * Measures the grid, again only when its rows were rendered again (see
 * invalidate) or something changed size. Rows far off screen have estimated
 * heights until they are first shown.
 */
export class GridLayout {
  private version = 0;
  private measured: Layout | null = null;

  constructor(
    private readonly scroller: Get,
    private readonly grid: Get,
  ) {}

  /** The rows changed. */
  invalidate(): void {
    this.version++;
  }

  measure(): Layout | null {
    const sc = this.scroller();
    const grid = this.grid();
    if (!sc || !grid) return null;
    const key = `${this.version}:${sc.scrollHeight}:${sc.clientWidth}`;
    if (this.measured?.key === key) return this.measured;
    const gridTop = grid.offsetTop;
    const rows: RowBox[] = [];
    const hunks: Array<HunkBox & { kinds: Set<string> }> = [];
    for (const el of Array.from(grid.children) as HTMLElement[]) {
      const top = gridTop + el.offsetTop;
      const height = el.offsetHeight;
      const kind = /\bk-(\w+)/.exec(el.className)?.[1] ?? 'fold';
      const hunk = el.dataset.hunk === undefined ? -1 : Number(el.dataset.hunk);
      rows.push({ top, height, kind, hunk, a: Number(el.dataset.la ?? 0), b: Number(el.dataset.lb ?? 0) });
      if (hunk < 0) continue;
      let h = hunks[hunks.length - 1];
      if (h?.hunk !== hunk) {
        h = { hunk, top, bottom: top + height, kind: 'mod', kinds: new Set() };
        hunks.push(h);
      }
      h.bottom = Math.max(h.bottom, top + height);
      const k = kind.replace(/^t/, '');
      if (k === 'mod' || k === 'del' || k === 'ins') h.kinds.add(k);
    }
    const ma = metrics(grid, 'a');
    const mb = metrics(grid, 'b');
    this.measured = {
      key,
      total: sc.scrollHeight,
      head: (sc.querySelector('.colheads') as HTMLElement | null)?.offsetHeight ?? 0,
      rows,
      hunks: hunks.map(({ kinds, ...h }) => ({ ...h, kind: kinds.size === 1 ? ([...kinds][0] as HunkBox['kind']) : 'mod' })),
      line: { a: ma.line, b: mb.line },
      chars: { a: ma.chars, b: mb.chars },
    };
    return this.measured;
  }
}

/** Line height and characters per line of one side's body text. */
function metrics(grid: HTMLElement, side: 'a' | 'b'): { line: number; chars: number } {
  const cell = grid.querySelector<HTMLElement>(`.row > .cell.${side}`);
  if (!cell) return { line: 25, chars: 70 };
  const cs = getComputedStyle(cell);
  const size = parseFloat(cs.fontSize) || 16;
  const line = parseFloat(cs.lineHeight) || size * 1.5;
  const width = cell.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  const glyph = size * (grid.classList.contains(`mono-${side}`) ? 0.6 : 0.47);
  return { line, chars: Math.max(10, width / glyph) };
}

function headHeight(sc: HTMLElement): number {
  return (sc.querySelector('.colheads') as HTMLElement | null)?.offsetHeight ?? 0;
}

/** Scrolls a change into view: a short one a third of the way down, a long one to the top. */
export function scrollToHunk(sc: HTMLElement, grid: HTMLElement, hunk: number, smooth: boolean, retry = true): void {
  const all = grid.querySelectorAll<HTMLElement>(`.row[data-hunk="${hunk}"]`);
  const first = all[0];
  if (!first) return;
  const last = all[all.length - 1]!;
  const sr = sc.getBoundingClientRect();
  const top = first.getBoundingClientRect().top - sr.top + sc.scrollTop;
  const bottom = last.getBoundingClientRect().bottom - sr.top + sc.scrollTop;
  const head = headHeight(sc);
  const avail = sc.clientHeight - head;
  const target = Math.max(0, bottom - top < avail * 0.8 ? top - head - (avail - (bottom - top)) / 3 : top - head - 12);
  if (Math.abs(target - sc.scrollTop) < 2) return;
  if (retry) {
    // Rows far away have estimated heights until they render; correct once the scroll settles.
    const started = Date.now();
    const settle = () => {
      if (Date.now() - started > 2000 || !first.isConnected) return;
      const r = first.getBoundingClientRect();
      const s = sc.getBoundingClientRect();
      if (r.top < s.top + head || r.top > s.bottom - 60) scrollToHunk(sc, grid, hunk, false, false);
    };
    if ('onscrollend' in sc) sc.addEventListener('scrollend', settle, { once: true });
    else setTimeout(settle, smooth ? 500 : 60);
  }
  sc.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
}

/** A line near the top of the screen and how far down the screen it was. */
export type Anchor = Array<{ id: string; offset: number }>;

/** The lines at the top of the screen, to put back where they were after the rows change. */
export function captureAnchor(sc: HTMLElement, grid: HTMLElement): Anchor {
  const rows = grid.children;
  if (!rows.length) return [];
  const view = sc.scrollTop - grid.offsetTop;
  // The first line that ends below the top of the screen (lines are in order).
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const el = rows[mid] as HTMLElement;
    if (el.offsetTop + el.offsetHeight <= view) lo = mid + 1;
    else hi = mid;
  }
  const sr = sc.getBoundingClientRect();
  const out: Anchor = [];
  for (let i = lo; i < rows.length && out.length < 12; i++) {
    const el = rows[i] as HTMLElement;
    const r = el.getBoundingClientRect();
    if (r.top > sr.bottom) break;
    if (el.dataset.a) out.push({ id: el.dataset.a, offset: r.top - sr.top });
  }
  return out;
}

export function restoreAnchor(sc: HTMLElement, grid: HTMLElement, anchor: Anchor): void {
  if (!anchor.length) return;
  const byId = new Map<string, HTMLElement>();
  for (const el of Array.from(grid.children) as HTMLElement[]) if (el.dataset.a) byId.set(el.dataset.a, el);
  for (const a of anchor) {
    const el = byId.get(a.id);
    if (!el) continue;
    const delta = el.getBoundingClientRect().top - sc.getBoundingClientRect().top - a.offset;
    if (Math.abs(delta) > 1) sc.scrollTop += delta;
    return;
  }
}
