/**
 * The side by side view with connection bands. Each document runs on in its
 * own column, without the gaps that line up the rows of the aligned view, and
 * the two columns slide against each other as the reader scrolls so that what
 * is level with the sync point (the middle of the screen, moving to the top or
 * bottom at the ends of the documents) corresponds, as in Meld or a JetBrains
 * IDE. Bands across the gutter join each change on one side to the same change
 * on the other.
 *
 * The page scrolls through the aligned layout: line i of the grid (a paragraph,
 * a row of a table, a fold) is as tall as the taller of its two sides, so the
 * scrollbar, the overview and every jump work as they do with aligned rows.
 * At each scroll position, the line at the sync point is found, and each column
 * is shifted so its side of that line is level with it. Inside a line that is
 * shorter on one side, that side moves more slowly; between changes, where
 * both sides are the same height, neither shift changes and the page scrolls
 * as it would without them.
 */
import type { Anchor, HunkBox, Layout, Measures, RowBox } from './layout';
import { lineMetrics } from './layout';

/** The lines of the grid in each column, and the aligned layout they make. */
export interface Lines {
  n: number;
  /** Top of each line in A's and in B's column, in px from the column's top; the last of the n + 1 is where the lines end. */
  a: Float64Array;
  b: Float64Array;
  /** Top of each line in the aligned layout, n + 1 of them. */
  v: Float64Array;
  /** Height of each column with its end cap. */
  lenA: number;
  lenB: number;
  /** Height of the aligned layout with the end cap. */
  total: number;
}

/** The aligned layout of lines whose tops in each column are `a` and `b` (n + 1 each: the last is the end of the lines). */
export function alignLines(a: ArrayLike<number>, b: ArrayLike<number>, lenA: number, lenB: number): Lines {
  const n = Math.max(0, Math.min(a.length, b.length) - 1);
  const ta = Float64Array.from({ length: n + 1 }, (_, i) => a[i]!);
  const tb = Float64Array.from({ length: n + 1 }, (_, i) => b[i]!);
  const v = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) v[i + 1] = v[i]! + Math.max(ta[i + 1]! - ta[i]!, tb[i + 1]! - tb[i]!, 0);
  const cap = Math.max(lenA - ta[n]!, lenB - tb[n]!, 0);
  return { n, a: ta, b: tb, v, lenA, lenB, total: v[n]! + cap };
}

/**
 * How far down the screen the sync point is, from 0 (the top) to 1 (the
 * bottom): the middle, except in the first and last half screen of the
 * documents, where it moves to the top and bottom so both columns start and
 * end together.
 */
export function syncPoint(s: number, h: number, sMax: number): number {
  if (h <= 0) return 0;
  const half = h / 2;
  const first = Math.min(1, Math.max(0, s / half));
  const last = sMax > 0 ? Math.min(1, Math.max(0, (s - (sMax - half)) / half)) : 0;
  return Math.min(1, 0.5 * first + 0.5 * last);
}

export interface Offsets {
  /** How far down the grid each column starts, in px. */
  a: number;
  b: number;
  /** The line at the sync point, how far through it (0 to 1), and where the sync point is in the aligned layout. */
  line: number;
  t: number;
  y: number;
}

/**
 * Where each column goes with the grid scrolled `s` px (from the top of the
 * grid to the top of the screen), a screen `h` px tall, and `sMax` px of
 * scrolling in all. A column never starts below the top of the screen or ends
 * above its bottom (it stops when it reaches its start or end, like a pane
 * scrolled all the way), and stays inside the grid.
 */
export function columnOffsets(L: Lines, s: number, h: number, sMax: number): Offsets {
  const { n, a, b, v } = L;
  if (!n) return { a: 0, b: 0, line: 0, t: 0, y: 0 };
  const y = Math.min(Math.max(s + syncPoint(s, h, sMax) * h, 0), v[n]!);
  // The last line that starts at or above the sync point.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (v[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  const height = v[lo + 1]! - v[lo]!;
  const t = height > 0 ? Math.min(1, (y - v[lo]!) / height) : 0;
  const fit = (off: number, len: number) => {
    let o = Math.max(off, Math.min(s + h, L.total) - len);
    o = Math.min(o, s);
    return Math.min(Math.max(o, 0), Math.max(0, L.total - len));
  };
  return {
    a: fit(y - (a[lo]! + t * (a[lo + 1]! - a[lo]!)), L.lenA),
    b: fit(y - (b[lo]! + t * (b[lo + 1]! - b[lo]!)), L.lenB),
    line: lo,
    t,
    y,
  };
}

/**
 * The shape of a band from A's range [a0, a1] to B's [b0, b1]: level across
 * A's side of the gutter (0 to xa), an S-curve to B's side (xb to x1), then
 * level again. A range of no height (the place where the other side's text
 * would go) makes a point of the band. `edges` are its top and bottom;
 * `outline` goes all the way round, its ends just inside the gutter so a line
 * along them shows in full beside the sheets.
 */
export function bandPath(xa: number, xb: number, x1: number, a0: number, a1: number, b0: number, b1: number): { fill: string; edges: string; outline: string } {
  const m = (xa + xb) / 2;
  const f = (x: number) => Math.round(x * 10) / 10;
  const shape = (l: number, r: number) =>
    `M${f(l)} ${f(a0)}H${f(xa)}C${f(m)} ${f(a0)} ${f(m)} ${f(b0)} ${f(xb)} ${f(b0)}H${f(r)}V${f(b1)}H${f(xb)}C${f(m)} ${f(b1)} ${f(m)} ${f(a1)} ${f(xa)} ${f(a1)}H${f(l)}Z`;
  const top = `M0 ${f(a0)}H${f(xa)}C${f(m)} ${f(a0)} ${f(m)} ${f(b0)} ${f(xb)} ${f(b0)}H${f(x1)}`;
  const bottom = `M0 ${f(a1)}H${f(xa)}C${f(m)} ${f(a1)} ${f(m)} ${f(b1)} ${f(xb)} ${f(b1)}H${f(x1)}`;
  return { fill: shape(0, x1), edges: a0 === a1 && b0 === b1 ? top : `${top}${bottom}`, outline: shape(0.75, x1 - 0.75) };
}

export interface ElasticParts {
  /** The page's scroller, which holds the grid. */
  scroller: HTMLElement;
  grid: HTMLElement;
  a: HTMLElement;
  b: HTMLElement;
  bands: SVGSVGElement;
}

/** What the lines are, read from the columns after they render. */
interface Meta {
  /** Each line's anchor (for keeping the reader's place), kind, change and characters of text on each side. */
  ids: string[];
  index: Map<string, number>;
  kinds: string[];
  hunks: Int32Array;
  ca: Int32Array;
  cb: Int32Array;
  /** Each change's first and last line. */
  ranges: Array<{ hunk: number; first: number; last: number; kind: HunkBox['kind'] }>;
  byHunk: Map<number, number>;
}

/**
 * Lays out, scrolls and keeps in step the two columns of the view with
 * connection bands, and measures it for the overview and for stepping between
 * changes (the same Layout as the aligned grid's, in the aligned layout's
 * coordinates).
 */
export class ElasticLayout implements Measures {
  private parts: ElasticParts | null = null;
  private lines: Lines | null = null;
  private meta: Meta | null = null;
  private version = 0;
  private measured: Layout | null = null;
  /** The grid's offset in the scrolled content, and the column heads' height, as last measured. */
  private gridTop = 0;
  private head = 0;
  /** Width of the gutter, and of each column's own part of it (line numbers and arrows). */
  private gut = 0;
  private side = 0;
  private applied = { a: Number.NaN, b: Number.NaN };
  private drawn = { from: 0, to: -1, a: Number.NaN, b: Number.NaN, key: '' };
  /** What was at the sync point: kept there when the lines change size. */
  private at: { id: string; t: number; c: number } | null = null;
  /** A smooth scroll of ours is under way; moving the page to keep the reader's place would stop it. */
  private smoothUntil = 0;
  private ro: ResizeObserver | null = null;
  private scroller(): HTMLElement | null {
    return this.parts?.scroller ?? null;
  }

  private readonly onScroll = () => this.sync();
  /** The current change, whose band is drawn more strongly. */
  current = -1;

  /** Lays out these columns from now on. */
  attach(parts: ElasticParts): void {
    this.detach();
    this.parts = parts;
    parts.scroller.addEventListener('scroll', this.onScroll, { passive: true });
    // The columns change size when their lines first render, when fonts arrive and when the window is resized.
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => this.refresh());
      this.ro.observe(parts.a);
      this.ro.observe(parts.b);
    }
  }

  detach(): void {
    this.parts?.scroller.removeEventListener('scroll', this.onScroll);
    this.ro?.disconnect();
    this.ro = null;
    this.parts = null;
    this.lines = null;
    this.meta = null;
    this.measured = null;
    this.applied = { a: Number.NaN, b: Number.NaN };
    this.drawn = { from: 0, to: -1, a: Number.NaN, b: Number.NaN, key: '' };
  }

  /** The columns rendered again: read what their lines are. */
  rendered(): void {
    this.meta = null;
    this.refresh();
  }

  /** Measures the columns again, keeping what was at the sync point there, and lines them up. */
  refresh(keep = true): void {
    const p = this.parts;
    const sc = this.scroller();
    if (!p || !sc) return;
    this.meta ??= readMeta(p.a);
    const at = keep && performance.now() > this.smoothUntil ? this.at : null;
    const ua = p.a.children;
    const ub = p.b.children;
    const n = Math.min(ua.length, ub.length);
    const ta = new Float64Array(n);
    const tb = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      ta[i] = (ua[i] as HTMLElement).offsetTop;
      tb[i] = (ub[i] as HTMLElement).offsetTop;
    }
    const lines = alignLines(ta, tb, p.a.offsetHeight, p.b.offsetHeight);
    const changed = !this.lines || lines.total !== this.lines.total || lines.n !== this.lines.n || lines.v.some((x, i) => x !== this.lines!.v[i]);
    this.lines = lines;
    if (changed) this.version++;
    this.gridTop = p.grid.offsetTop;
    this.head = (sc.querySelector('.colheads') as HTMLElement | null)?.offsetHeight ?? 0;
    this.gut = p.bands.clientWidth;
    this.side = (p.a.querySelector('.egut') as HTMLElement | null)?.offsetWidth ?? 0;
    const height = `${lines.total}px`;
    if (p.grid.style.height !== height) p.grid.style.height = height;
    if (at) this.goTo(sc, at.id, at.t, at.c);
    this.sync(true);
  }

  /** Scrolls so that line `id`, `t` of the way through, is `c` px down the screen. */
  private goTo(sc: HTMLElement, id: string, t: number, c: number): void {
    const L = this.lines;
    const i = this.meta?.index.get(id);
    if (!L || i === undefined) return;
    const y = L.v[i]! + t * (L.v[i + 1]! - L.v[i]!);
    const top = Math.max(0, y - c - this.head + this.gridTop);
    if (Math.abs(top - sc.scrollTop) >= 1) sc.scrollTop = top;
  }

  private view(sc: HTMLElement): { s: number; h: number; sMax: number } {
    const shift = this.head - this.gridTop;
    return { s: sc.scrollTop + shift, h: Math.max(1, sc.clientHeight - this.head), sMax: sc.scrollHeight - sc.clientHeight + shift };
  }

  /** Shifts the columns for the current scroll position and draws the bands in view. */
  sync(force = false): void {
    const sc = this.scroller();
    const p = this.parts;
    const L = this.lines;
    const m = this.meta;
    if (!sc || !p || !L || !m || !L.n) return;
    const { s, h, sMax } = this.view(sc);
    const o = columnOffsets(L, s, h, sMax);
    this.at = { id: m.ids[o.line]!, t: o.t, c: o.y - s };
    // Whole device pixels keep the text crisp; the columns stay inside the grid all the same.
    const dpr = window.devicePixelRatio || 1;
    const snap = (x: number, len: number) => Math.min(Math.round(x * dpr) / dpr, Math.max(0, L.total - len));
    const a = snap(o.a, L.lenA);
    const b = snap(o.b, L.lenB);
    if (a !== this.applied.a) p.a.style.transform = `translateY(${a}px)`;
    if (b !== this.applied.b) p.b.style.transform = `translateY(${b}px)`;
    this.applied = { a, b };
    this.drawBands(p.bands, L, m, s, h, force);
  }

  /**
   * The bands of the changes in view (and a screen either side, so scrolling
   * between changes, where the columns do not move, needs no drawing). The
   * drawing stays inside the grid: below it, it would make the page longer,
   * and with it the room to scroll.
   */
  private drawBands(svg: SVGSVGElement, L: Lines, m: Meta, s: number, h: number, force: boolean): void {
    const { a, b } = this.applied;
    const d = this.drawn;
    const key = `${this.version}:${this.current}:${this.gut}:${this.side}`;
    const covered = (s - h / 2 >= d.from || d.from <= 0) && (s + h * 1.5 <= d.to || d.to >= L.total);
    if (!force && a === d.a && b === d.b && key === d.key && covered) return;
    const from = Math.min(Math.max(0, Math.floor(s - h)), Math.floor(L.total));
    const to = Math.max(from, Math.min(Math.ceil(s + 2 * h), Math.floor(L.total)));
    this.drawn = { from, to, a, b, key };
    svg.style.top = `${from}px`;
    svg.style.height = `${to - from}px`;
    const xa = this.side;
    const xb = this.gut - this.side;
    let out = '';
    for (const r of m.ranges) {
      const a0 = a + L.a[r.first]! - from;
      const a1 = a + L.a[r.last + 1]! - from;
      const b0 = b + L.b[r.first]! - from;
      const b1 = b + L.b[r.last + 1]! - from;
      if (Math.max(a1, b1) < 0 || Math.min(a0, b0) > to - from) continue;
      const path = bandPath(xa, xb, this.gut, a0, a1, b0, b1);
      const cls = `k-${r.kind}${r.hunk === this.current ? ' cur' : ''}`;
      out += `<path class="band ${cls}" data-hunk="${r.hunk}" d="${path.fill}"/><path class="band-edge ${cls}" d="${path.edges}"/><path class="band-line ${cls}" d="${path.outline}"/>`;
    }
    svg.innerHTML = out;
  }

  /** The aligned layout, for the overview and for stepping between changes. */
  measure(): Layout | null {
    const sc = this.scroller();
    const p = this.parts;
    const L = this.lines;
    const m = this.meta;
    if (!sc || !p || !L || !m) return null;
    const key = `e${this.version}:${sc.scrollHeight}:${sc.clientWidth}`;
    if (this.measured?.key === key) return this.measured;
    const rows: RowBox[] = [];
    for (let i = 0; i < L.n; i++) rows.push({ top: this.gridTop + L.v[i]!, height: L.v[i + 1]! - L.v[i]!, kind: m.kinds[i]!, hunk: m.hunks[i]!, a: m.ca[i]!, b: m.cb[i]! });
    const hunks = m.ranges.map((r) => ({ hunk: r.hunk, top: this.gridTop + L.v[r.first]!, bottom: this.gridTop + L.v[r.last + 1]!, kind: r.kind }));
    const ma = lineMetrics(p.grid, 'a');
    const mb = lineMetrics(p.grid, 'b');
    this.measured = { key, total: sc.scrollHeight, head: this.head, rows, hunks, line: { a: ma.line, b: mb.line }, chars: { a: ma.chars, b: mb.chars } };
    return this.measured;
  }

  /** Scrolls a change into view: a short one a third of the way down, a long one to the top. */
  scrollToHunk(hunk: number, smooth: boolean, retry = true): void {
    const sc = this.scroller();
    const L = this.lines;
    const i = this.meta?.byHunk.get(hunk);
    if (!sc || !L || i === undefined) return;
    const r = this.meta!.ranges[i]!;
    const top = L.v[r.first]!;
    const size = L.v[r.last + 1]! - top;
    const { h } = this.view(sc);
    const s = size < h * 0.8 ? top - (h - size) / 3 : top - 12;
    const target = Math.max(0, s - this.head + this.gridTop);
    if (Math.abs(target - sc.scrollTop) < 2) return;
    if (retry) {
      // Lines far away may still have estimated heights; correct once the scroll settles.
      const started = Date.now();
      const settle = () => {
        this.smoothUntil = 0;
        if (Date.now() - started > 2500 || !this.lines) return;
        const j = this.meta?.byHunk.get(hunk);
        if (j === undefined) return;
        const view = this.view(sc);
        const y = this.lines.v[this.meta!.ranges[j]!.first]!;
        if (y < view.s || y > view.s + view.h - 60) this.scrollToHunk(hunk, false, false);
      };
      if ('onscrollend' in sc) sc.addEventListener('scrollend', settle, { once: true });
      else setTimeout(settle, smooth ? 500 : 60);
    }
    if (smooth) this.smoothUntil = performance.now() + 1500;
    sc.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
  }

  /** The lines at the top of the screen, as the aligned grid records them. */
  capture(): Anchor {
    const sc = this.scroller();
    const L = this.lines;
    const m = this.meta;
    if (!sc || !L || !m || !L.n) return [];
    const { s, h } = this.view(sc);
    const out: Anchor = [];
    for (let i = 0; i < L.n && out.length < 12; i++) {
      if (L.v[i + 1]! <= s) continue;
      if (L.v[i]! > s + h) break;
      if (m.ids[i]) out.push({ id: m.ids[i]!, offset: this.gridTop + L.v[i]! - sc.scrollTop });
    }
    return out;
  }

  /** Puts the first of the anchor's lines that is still there back where it was. */
  restore(anchor: Anchor): void {
    const sc = this.scroller();
    if (!sc || !this.parts) return;
    this.meta = null;
    this.refresh(false);
    const L = this.lines;
    // refresh() read the lines again.
    const m = this.meta as Meta | null;
    for (const a of anchor) {
      const i = m?.index.get(a.id);
      if (!L || i === undefined) continue;
      const top = this.gridTop + L.v[i]! - a.offset;
      if (Math.abs(top - sc.scrollTop) > 1) sc.scrollTop = top;
      this.sync(true);
      return;
    }
  }
}

function readMeta(col: HTMLElement): Meta {
  const els = Array.from(col.children).slice(0, -1) as HTMLElement[];
  const n = els.length;
  const meta: Meta = { ids: [], index: new Map(), kinds: [], hunks: new Int32Array(n), ca: new Int32Array(n), cb: new Int32Array(n), ranges: [], byHunk: new Map() };
  let kinds = new Set<string>();
  els.forEach((el, i) => {
    const id = el.dataset.a ?? '';
    meta.ids.push(id);
    if (id && !meta.index.has(id)) meta.index.set(id, i);
    const kind = /\bk-(\w+)/.exec(el.className)?.[1] ?? 'fold';
    meta.kinds.push(kind);
    const hunk = el.dataset.hunk === undefined ? -1 : Number(el.dataset.hunk);
    meta.hunks[i] = hunk;
    meta.ca[i] = Number(el.dataset.la ?? 0);
    meta.cb[i] = Number(el.dataset.lb ?? 0);
    if (hunk < 0) return;
    let r = meta.ranges[meta.ranges.length - 1];
    if (r?.hunk !== hunk) {
      if (r) r.kind = rangeKind(kinds);
      kinds = new Set();
      r = { hunk, first: i, last: i, kind: 'mod' };
      meta.byHunk.set(hunk, meta.ranges.length);
      meta.ranges.push(r);
    }
    r.last = i;
    const k = kind.replace(/^t/, '');
    if (k === 'mod' || k === 'del' || k === 'ins') kinds.add(k);
  });
  const last = meta.ranges[meta.ranges.length - 1];
  if (last) last.kind = rangeKind(kinds);
  return meta;
}

function rangeKind(kinds: Set<string>): HunkBox['kind'] {
  return kinds.size === 1 ? ([...kinds][0] as HunkBox['kind']) : 'mod';
}
