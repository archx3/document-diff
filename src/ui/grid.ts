import type { Comparison, Row, TableRowDiff } from '../core/compare';
import { cellDiff, flattenBlocks, inlineDiff, propsChanged } from '../core/compare';
import { computeListLabels } from '../core/lists';
import type { Block, Doc, ParaBlock, TableBlock, TableCell, TableRow } from '../core/model';
import { optionsKey } from '../core/tokens';
import { icons } from './icons';
import type { Labels } from './render';
import { blockHtml, columnsOf, esc, modCellHtml, modParaHtml, tableRowHtml } from './render';

/** Unchanged rows kept around each change when showing changes only. */
const CONTEXT = 1;

export interface GridState {
  cmp: Comparison;
  changesOnly: boolean;
  /** Folds the reader opened, by the key of their first row. */
  expanded: Set<string>;
}

/** One element of the grid as laid out: where it is in the scrolled content and what it shows. */
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

type Kind = 'mod' | 'del' | 'ins';

function gutter(key: string, kind: Kind, sub?: string, scope?: string): string {
  const [toA, toB] =
    kind === 'del'
      ? ['Remove from A', 'Copy to B']
      : kind === 'ins'
        ? ['Copy to A', 'Remove from B']
        : ['Use B’s version in A', 'Use A’s version in B'];
  const what = scope === 'table' ? ' (whole table)' : sub ? ' (this row)' : '';
  const data = `data-key="${esc(key)}"${sub ? ` data-sub="${esc(sub)}"` : ''}`;
  return (
    `<button type="button" class="act to-a" data-act="r2l" ${data} data-tip="${toA}${what}" aria-label="${toA}${what}">${icons.toA}</button>` +
    `<button type="button" class="act to-b" data-act="l2r" ${data} data-tip="${toB}${what}" aria-label="${toB}${what}">${icons.toB}</button>`
  );
}

/** Rough length of a block's text (a picture counts as a short word). */
function textLength(b: Block): number {
  switch (b.type) {
    case 'p': {
      let n = 0;
      for (const s of b.spans) if (!s.marker) n += s.obj ? 6 : s.text.length;
      // An empty paragraph still takes a line.
      return Math.max(1, n);
    }
    case 'table':
      return b.rows.reduce((n, r) => n + rowLength(r), 0);
    case 'opaque':
      return Math.max(1, b.blocks.reduce((n, x) => n + textLength(x), 0));
    case 'marker':
      return 0;
  }
}

function rowLength(r: TableRow): number {
  return Math.max(1, r.cells.reduce((n, c) => n + c.blocks.reduce((m, x) => m + textLength(x), 0), 0));
}

const numberings = new WeakMap<Doc, Map<Block, number>>();

/** Paragraph numbers of a document, counting every paragraph and table (for text files, its lines). */
function numbering(doc: Doc): Map<Block, number> {
  let m = numberings.get(doc);
  if (!m) {
    m = new Map();
    let n = 0;
    for (const b of doc.blocks) if (b.type !== 'marker') m.set(b, ++n);
    numberings.set(doc, m);
  }
  return m;
}

function placeholder(side: 'A' | 'B'): string {
  return `<div class="ph"><span>not in ${side}</span></div>`;
}

function shell(key: string, anchor: string, kind: string, a: string, gut: string, b: string, extra = ''): string {
  return `<div class="row k-${kind}${extra}" data-key="${esc(key)}" data-a="${esc(anchor)}"><div class="cell a">${a}</div><div class="gut">${gut}</div><div class="cell b">${b}</div></div>`;
}

export class GridView {
  private cache = new Map<string, HTMLElement[]>();
  private cacheOpts = '';
  private labelsL: Labels = new Map();
  private labelsR: Labels = new Map();
  private cmp: Comparison | null = null;
  private current = -1;
  /** What each rendered element shows: its kind and how much text is on each side. */
  private meta = new WeakMap<HTMLElement, { kind: string; a: number; b: number }>();
  /** Bumped whenever the rows are rendered again or change size. */
  private gen = 0;
  private measured: Layout | null = null;

  constructor(
    readonly el: HTMLElement,
    readonly scroller: HTMLElement,
  ) {}

  render(state: GridState): void {
    const { cmp } = state;
    this.cmp = cmp;
    const ok = optionsKey(cmp.opts);
    if (ok !== this.cacheOpts) {
      this.cache.clear();
      this.cacheOpts = ok;
    }
    this.labelsL = computeListLabels(cmp.left.blocks);
    this.labelsR = computeListLabels(cmp.right.blocks);
    this.el.classList.toggle('mono-a', !!cmp.left.mono);
    this.el.classList.toggle('mono-b', !!cmp.right.mono);
    const numA = numbering(cmp.left);
    const numB = numbering(cmp.right);
    const anchor = this.captureAnchor();

    const rows = cmp.rows;
    const show = this.visibility(rows, state);
    const out: HTMLElement[] = [];
    const nextCache = new Map<string, HTMLElement[]>();
    let i = 0;
    while (i < rows.length) {
      if (!show[i]) {
        let j = i;
        while (j < rows.length && !show[j]) j++;
        out.push(this.foldElement(rows[i]!.key, j - i));
        i = j;
        continue;
      }
      const row = rows[i]!;
      const ck = this.cacheKey(row);
      const els = this.cache.get(ck) ?? this.build(row);
      nextCache.set(ck, els);
      for (const e of els) {
        e.dataset.hunk = String(row.hunk);
        e.classList.toggle('cur', row.hunk >= 0 && row.hunk === this.current);
        out.push(e);
      }
      // Paragraph numbers for the gutter (shown when line numbers are on). Rows are
      // reused across edits, so the numbers are set on every render.
      const gut = els[0]?.children[1] as HTMLElement | undefined;
      if (gut?.classList.contains('gut')) {
        gut.dataset.na = row.l ? String(numA.get(row.l) ?? '') : '';
        gut.dataset.nb = row.r ? String(numB.get(row.r) ?? '') : '';
      }
      i++;
    }
    this.cache = nextCache;
    this.el.replaceChildren(...out);
    this.gen++;
    this.restoreAnchor(anchor);
  }

  /** Runs a change that resizes the rows (such as widening the gutter), keeping the reader's place. */
  keepPlace(change: () => void): void {
    const anchor = this.captureAnchor();
    change();
    this.gen++;
    this.restoreAnchor(anchor);
  }

  private visibility(rows: readonly Row[], state: GridState): boolean[] {
    const show = rows.map(() => !state.changesOnly);
    if (!state.changesOnly) return show;
    rows.forEach((r, i) => {
      if (r.kind === 'eq') return;
      for (let k = Math.max(0, i - CONTEXT); k <= Math.min(rows.length - 1, i + CONTEXT); k++) show[k] = true;
    });
    // Expanded folds, and folds too small to be worth hiding.
    let i = 0;
    while (i < rows.length) {
      if (show[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < rows.length && !show[j]) j++;
      if (j - i < 2 || state.expanded.has(rows[i]!.key)) for (let k = i; k < j; k++) show[k] = true;
      i = j;
    }
    return show;
  }

  private foldElement(key: string, count: number): HTMLElement {
    const div = document.createElement('div');
    div.className = 'row fold';
    div.dataset.a = 'fold:' + key;
    // The label is shown on both columns, clear of the overview on the gutter.
    const label = `${icons.fold}<span>${count} unchanged ${count === 1 ? 'paragraph' : 'paragraphs'}</span>`;
    div.innerHTML = `<button type="button" class="fold-btn" data-fold="${esc(key)}"><span class="fold-side">${label}</span><span class="fold-side" aria-hidden="true">${label}</span></button>`;
    return div;
  }

  private cacheKey(row: Row): string {
    const l = row.l?.type === 'p' ? (this.labelsL.get(row.l as ParaBlock) ?? '') : '';
    const r = row.r?.type === 'p' ? (this.labelsR.get(row.r as ParaBlock) ?? '') : '';
    return `${row.key}|${l}|${r}`;
  }

  private build(row: Row): HTMLElement[] {
    const tpl = document.createElement('template');
    tpl.innerHTML = this.rowHtml(row);
    const els = Array.from(tpl.content.children) as HTMLElement[];
    const kindOf = (el: HTMLElement) => /\bk-(\w+)/.exec(el.className)?.[1] ?? 'eq';
    if (row.kind === 'table' && row.table && els.length === row.table.rows.length + 1) {
      // A caption, then one element per table row.
      this.meta.set(els[0]!, { kind: 'tcap', a: 0, b: 0 });
      row.table.rows.forEach((sr, i) => {
        const el = els[i + 1]!;
        this.meta.set(el, { kind: kindOf(el), a: sr.l ? rowLength(sr.l) : 0, b: sr.r ? rowLength(sr.r) : 0 });
      });
    } else {
      for (const el of els) this.meta.set(el, { kind: kindOf(el), a: row.l ? textLength(row.l) : 0, b: row.r ? textLength(row.r) : 0 });
    }
    return els;
  }

  private rowHtml(row: Row): string {
    const o = this.cmp!.opts;
    const L = this.labelsL;
    const R = this.labelsR;
    const frag = (row.l ?? row.r)?.type === 'table' && ((row.l ?? row.r) as TableBlock).fragment ? ' frag' : '';
    switch (row.kind) {
      case 'eq':
        return shell(row.key, row.key, 'eq', blockHtml(row.l!, L), '', blockHtml(row.r!, R), frag);
      case 'mod': {
        const l = row.l!;
        const r = row.r!;
        const d = inlineDiff(l, r, o);
        if (l.type === 'p' && r.type === 'p') {
          const pd = propsChanged(l, r, o);
          return shell(row.key, row.key, 'mod', modParaHtml(l, d, 'a', L, pd), gutter(row.key, 'mod'), modParaHtml(r, d, 'b', R, pd));
        }
        return shell(row.key, row.key, 'mod', modCellHtml(flattenBlocks([l]), d, 'a'), gutter(row.key, 'mod'), modCellHtml(flattenBlocks([r]), d, 'b'));
      }
      case 'del':
        return shell(row.key, row.key, 'del', blockHtml(row.l!, L), gutter(row.key, 'del'), placeholder('B'), frag);
      case 'ins':
        return shell(row.key, row.key, 'ins', placeholder('A'), gutter(row.key, 'ins'), blockHtml(row.r!, R), frag);
      case 'table':
        return frag ? this.fragmentHtml(row) : this.tableHtml(row);
    }
  }

  /** A changed row of a CSV-like table: one aligned row with cell-level changes. */
  private fragmentHtml(row: Row): string {
    const lt = row.l as TableBlock;
    const rt = row.r as TableBlock;
    const o = this.cmp!.opts;
    const lr = lt.rows[0]!;
    const rr = rt.rows[0]!;
    let a: string;
    let b: string;
    if (lt.rows.length === 1 && rt.rows.length === 1 && lr.cells.length === rr.cells.length) {
      const diffs = lr.cells.map((c, i) => cellDiff(c.blocks, rr.cells[i]!.blocks, o));
      const cell = (side: 'a' | 'b') => (c: TableCell, i: number) =>
        diffs[i]!.changes.length ? modCellHtml(flattenBlocks(c.blocks), diffs[i]!, side) : c.blocks.map((x) => blockHtml(x, side === 'a' ? this.labelsL : this.labelsR)).join('');
      a = tableRowHtml(lr, columnsOf(lt.rows), this.labelsL, cell('a'));
      b = tableRowHtml(rr, columnsOf(rt.rows), this.labelsR, cell('b'));
    } else {
      a = lt.rows.map((r) => tableRowHtml(r, columnsOf(lt.rows), this.labelsL, undefined, ' whole')).join('');
      b = rt.rows.map((r) => tableRowHtml(r, columnsOf(rt.rows), this.labelsR, undefined, ' whole')).join('');
    }
    return shell(row.key, row.key, 'mod', a, gutter(row.key, 'mod'), b, ' frag');
  }

  private tableHtml(row: Row): string {
    const lt = row.l as TableBlock;
    const rt = row.r as TableBlock;
    const o = this.cmp!.opts;
    const colsL = columnsOf(lt.rows);
    const colsR = columnsOf(rt.rows);
    const subs = row.table!.rows;
    const n = subs.filter((s) => s.kind !== 'eq').length;
    const cap = `<div class="tcap">Table <span>${n} ${n === 1 ? 'row differs' : 'rows differ'}</span></div>`;
    let html = shell(row.key, row.key, 'tcap', cap, gutter(row.key, 'mod', undefined, 'table'), cap);
    subs.forEach((sr: TableRowDiff, idx) => {
      const anchor = `${row.key}#${idx}`;
      const pos = idx === 0 ? ' t-first' : idx === subs.length - 1 ? ' t-last' : '';
      switch (sr.kind) {
        case 'eq':
          html += shell(row.key, anchor, 'teq', tableRowHtml(sr.l!, colsL, this.labelsL), '', tableRowHtml(sr.r!, colsR, this.labelsR), pos);
          break;
        case 'mod': {
          const lr = sr.l!;
          const rr = sr.r!;
          let a: string;
          let b: string;
          if (lr.cells.length === rr.cells.length) {
            const diffs = lr.cells.map((c, i) => cellDiff(c.blocks, rr.cells[i]!.blocks, o));
            const cell = (side: 'a' | 'b') => (c: TableCell, i: number) =>
              diffs[i]!.changes.length ? modCellHtml(flattenBlocks(c.blocks), diffs[i]!, side) : c.blocks.map((x) => blockHtml(x, side === 'a' ? this.labelsL : this.labelsR)).join('');
            a = tableRowHtml(lr, colsL, this.labelsL, cell('a'));
            b = tableRowHtml(rr, colsR, this.labelsR, cell('b'));
          } else {
            a = tableRowHtml(lr, colsL, this.labelsL, undefined, ' whole');
            b = tableRowHtml(rr, colsR, this.labelsR, undefined, ' whole');
          }
          html += shell(row.key, anchor, 'tmod', a, gutter(row.key, 'mod', sr.key), b, pos);
          break;
        }
        case 'del':
          html += shell(row.key, anchor, 'tdel', tableRowHtml(sr.l!, colsL, this.labelsL), gutter(row.key, 'del', sr.key), placeholder('B'), pos);
          break;
        case 'ins':
          html += shell(row.key, anchor, 'tins', placeholder('A'), gutter(row.key, 'ins', sr.key), tableRowHtml(sr.r!, colsR, this.labelsR), pos);
          break;
      }
    });
    return html;
  }

  /* ---------------------------------------------------- current change */

  setCurrent(hunk: number): void {
    this.current = hunk;
    for (const el of Array.from(this.el.querySelectorAll('.row.cur'))) el.classList.remove('cur');
    if (hunk < 0) return;
    for (const el of Array.from(this.el.querySelectorAll(`.row[data-hunk="${hunk}"]`))) el.classList.add('cur');
  }

  scrollToHunk(hunk: number, smooth: boolean, retry = true): void {
    const first = this.el.querySelector<HTMLElement>(`.row[data-hunk="${hunk}"]`);
    if (!first) return;
    const all = this.el.querySelectorAll<HTMLElement>(`.row[data-hunk="${hunk}"]`);
    const last = all[all.length - 1]!;
    const sr = this.scroller.getBoundingClientRect();
    const top = first.getBoundingClientRect().top - sr.top + this.scroller.scrollTop;
    const bottom = last.getBoundingClientRect().bottom - sr.top + this.scroller.scrollTop;
    const head = (this.scroller.querySelector('.colheads') as HTMLElement | null)?.offsetHeight ?? 0;
    const avail = this.scroller.clientHeight - head;
    const target = Math.max(0, bottom - top < avail * 0.8 ? top - head - (avail - (bottom - top)) / 3 : top - head - 12);
    if (Math.abs(target - this.scroller.scrollTop) < 2) return;
    if (retry) {
      // Rows far away have estimated heights until they render; correct once the scroll settles.
      const started = Date.now();
      const settle = () => {
        if (Date.now() - started > 2000) return;
        const r = first.getBoundingClientRect();
        const s = this.scroller.getBoundingClientRect();
        if (r.top < s.top + head || r.top > s.bottom - 60) this.scrollToHunk(hunk, false, false);
      };
      if ('onscrollend' in this.scroller) this.scroller.addEventListener('scrollend', settle, { once: true });
      else setTimeout(settle, smooth ? 500 : 60);
    }
    this.scroller.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
  }

  /* ------------------------------------------------------- anchoring */

  private captureAnchor(): Array<{ id: string; offset: number }> {
    const sr = this.scroller.getBoundingClientRect();
    const out: Array<{ id: string; offset: number }> = [];
    for (const el of Array.from(this.el.children) as HTMLElement[]) {
      const r = el.getBoundingClientRect();
      if (r.bottom < sr.top) continue;
      if (r.top > sr.bottom) break;
      if (el.dataset.a) out.push({ id: el.dataset.a, offset: r.top - sr.top });
      if (out.length >= 12) break;
    }
    return out;
  }

  private restoreAnchor(anchor: Array<{ id: string; offset: number }>): void {
    if (!anchor.length) return;
    const byId = new Map<string, HTMLElement>();
    for (const el of Array.from(this.el.children) as HTMLElement[]) if (el.dataset.a) byId.set(el.dataset.a, el);
    for (const a of anchor) {
      const el = byId.get(a.id);
      if (!el) continue;
      const sr = this.scroller.getBoundingClientRect();
      const delta = el.getBoundingClientRect().top - sr.top - a.offset;
      if (Math.abs(delta) > 1) this.scroller.scrollTop += delta;
      return;
    }
  }

  /* ----------------------------------------------------------- layout */

  /**
   * Where every row is in the scrolled content (the scroller and the grid are
   * positioned, so offsets are in content coordinates). Measured again only
   * when the rows were rendered or anything changed size. Rows far off screen
   * have estimated heights until they are first shown.
   */
  layout(): Layout {
    const sc = this.scroller;
    const key = `${this.gen}:${sc.scrollHeight}:${sc.clientWidth}`;
    if (this.measured?.key === key) return this.measured;
    const gridTop = this.el.offsetTop;
    const rows: RowBox[] = [];
    const hunks: Array<HunkBox & { kinds: Set<string> }> = [];
    for (const el of Array.from(this.el.children) as HTMLElement[]) {
      const m = this.meta.get(el);
      const top = gridTop + el.offsetTop;
      const height = el.offsetHeight;
      const hunk = el.dataset.hunk === undefined ? -1 : Number(el.dataset.hunk);
      rows.push({ top, height, kind: m?.kind ?? 'fold', hunk, a: m?.a ?? 0, b: m?.b ?? 0 });
      if (hunk < 0) continue;
      let h = hunks[hunks.length - 1];
      if (h?.hunk !== hunk) {
        h = { hunk, top, bottom: top + height, kind: 'mod', kinds: new Set() };
        hunks.push(h);
      }
      h.bottom = Math.max(h.bottom, top + height);
      const k = m?.kind.replace(/^t/, '');
      if (k === 'mod' || k === 'del' || k === 'ins') h.kinds.add(k);
    }
    const ma = this.metrics('a');
    const mb = this.metrics('b');
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

  /** Line height and characters per line of one side's body text. */
  private metrics(side: 'a' | 'b'): { line: number; chars: number } {
    const cell = this.el.querySelector<HTMLElement>(`.row > .cell.${side}`);
    if (!cell) return { line: 25, chars: 70 };
    const cs = getComputedStyle(cell);
    const size = parseFloat(cs.fontSize) || 16;
    const line = parseFloat(cs.lineHeight) || size * 1.5;
    const width = cell.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const glyph = size * (this.el.classList.contains(`mono-${side}`) ? 0.6 : 0.47);
    return { line, chars: Math.max(10, width / glyph) };
  }
}
