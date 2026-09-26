import type { Comparison, Row, TableRowDiff } from '../core/compare';
import { cellDiff, flattenBlocks, inlineDiff, propsChanged } from '../core/compare';
import { computeListLabels } from '../core/lists';
import type { ParaBlock, TableBlock, TableCell } from '../core/model';
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
    `<button type="button" class="act to-a" data-act="r2l" ${data} title="${toA}${what}" aria-label="${toA}${what}">${icons.toA}</button>` +
    `<button type="button" class="act to-b" data-act="l2r" ${data} title="${toB}${what}" aria-label="${toB}${what}">${icons.toB}</button>`
  );
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
      i++;
    }
    this.cache = nextCache;
    this.el.replaceChildren(...out);
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
    div.innerHTML = `<button type="button" class="fold-btn" data-fold="${esc(key)}">${icons.fold}<span>${count} unchanged ${count === 1 ? 'paragraph' : 'paragraphs'}</span></button>`;
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
    return Array.from(tpl.content.children) as HTMLElement[];
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

  /** First hunk whose rows are at or below the top of the viewport. */
  hunkInView(): number {
    const sr = this.scroller.getBoundingClientRect();
    const head = (this.scroller.querySelector('.colheads') as HTMLElement | null)?.offsetHeight ?? 0;
    for (const el of Array.from(this.el.querySelectorAll<HTMLElement>('.row[data-hunk]'))) {
      const h = Number(el.dataset.hunk);
      if (h < 0) continue;
      if (el.getBoundingClientRect().bottom > sr.top + head) return h;
    }
    return -1;
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

  /* --------------------------------------------------------- overview */

  /** Positions (0–1) of each hunk in the scrollable content, for the overview ruler. */
  hunkPositions(): Array<{ hunk: number; top: number; height: number; kind: string }> {
    const total = this.scroller.scrollHeight || 1;
    const sr = this.scroller.getBoundingClientRect();
    const out: Array<{ hunk: number; top: number; height: number; kind: string }> = [];
    const byHunk = new Map<number, { top: number; bottom: number; kinds: Set<string> }>();
    for (const el of Array.from(this.el.querySelectorAll<HTMLElement>('.row[data-hunk]'))) {
      const h = Number(el.dataset.hunk);
      if (h < 0) continue;
      const r = el.getBoundingClientRect();
      const top = r.top - sr.top + this.scroller.scrollTop;
      const e = byHunk.get(h) ?? { top, bottom: top, kinds: new Set<string>() };
      e.bottom = Math.max(e.bottom, top + r.height);
      const k = /k-(t?)(mod|del|ins)/.exec(el.className)?.[2];
      if (k) e.kinds.add(k);
      byHunk.set(h, e);
    }
    for (const [hunk, e] of byHunk) {
      const kind = e.kinds.size === 1 ? [...e.kinds][0]! : 'mod';
      out.push({ hunk, top: e.top / total, height: (e.bottom - e.top) / total, kind });
    }
    return out;
  }
}
