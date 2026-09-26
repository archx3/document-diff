/**
 * What the comparison grid shows, as data: the lines of each aligned row (a
 * table takes several), with the HTML of both cells, and where unchanged rows
 * are folded away. The document text is rendered to HTML strings (render.ts),
 * which stays fast for documents of thousands of paragraphs.
 */
import type { Row, TableRowDiff } from '../core/compare';
import { cellDiff, flattenBlocks, inlineDiff, propsChanged } from '../core/compare';
import type { Block, Doc, TableBlock, TableCell, TableRow } from '../core/model';
import type { CompareOptions } from '../core/tokens';
import type { Labels } from './render';
import { blockHtml, columnsOf, modCellHtml, modParaHtml, tableRowHtml } from './render';

/** Unchanged rows kept around each change when showing changes only. */
const CONTEXT = 1;

export type ActKind = 'mod' | 'del' | 'ins';

/** The copy arrows beside a line: for the whole row, one row of a table (`sub`) or the whole table. */
export interface Act {
  kind: ActKind;
  sub?: string;
  table?: boolean;
}

/** One line of the grid: A's cell, the gutter, B's cell. */
export interface RowPart {
  /** Identifies the line when keeping the reader's place. */
  anchor: string;
  /** eq, mod, del, ins; tcap, teq, tmod, tdel, tins for the parts of a table. */
  kind: string;
  /** More classes: frag, t-first, t-last. */
  extra: string;
  /** HTML of each cell. */
  a: string;
  b: string;
  act?: Act;
  /** Characters of text on each side (0 when that side has nothing here), for the minimap. */
  la: number;
  lb: number;
}

export type GridItem = { type: 'row'; row: Row } | { type: 'fold'; key: string; count: number };

/** Tooltips (and names) of the arrows that copy towards A and towards B. */
export function actLabels(act: Act): [toA: string, toB: string] {
  const [toA, toB] =
    act.kind === 'del' ? ['Remove from A', 'Copy to B'] : act.kind === 'ins' ? ['Copy to A', 'Remove from B'] : ['Use B’s version in A', 'Use A’s version in B'];
  const what = act.table ? ' (whole table)' : act.sub ? ' (this row)' : '';
  return [toA + what, toB + what];
}

/** Rough length of a block's text (a picture counts as a short word). */
export function textLength(b: Block): number {
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
export function numbering(doc: Doc): Map<Block, number> {
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

/** The lines of one aligned row. */
export function rowParts(row: Row, o: CompareOptions, L: Labels, R: Labels): RowPart[] {
  const first = row.l ?? row.r;
  const frag = first?.type === 'table' && first.fragment ? ' frag' : '';
  const la = row.l ? textLength(row.l) : 0;
  const lb = row.r ? textLength(row.r) : 0;
  const part = (kind: string, a: string, b: string, act?: Act, extra = ''): RowPart => ({ anchor: row.key, kind, extra, a, b, act, la, lb });
  switch (row.kind) {
    case 'eq':
      return [part('eq', blockHtml(row.l!, L), blockHtml(row.r!, R), undefined, frag)];
    case 'mod': {
      const l = row.l!;
      const r = row.r!;
      const d = inlineDiff(l, r, o);
      if (l.type === 'p' && r.type === 'p') {
        const pd = propsChanged(l, r, o);
        return [part('mod', modParaHtml(l, d, 'a', L, pd), modParaHtml(r, d, 'b', R, pd), { kind: 'mod' })];
      }
      return [part('mod', modCellHtml(flattenBlocks([l]), d, 'a'), modCellHtml(flattenBlocks([r]), d, 'b'), { kind: 'mod' })];
    }
    case 'del':
      return [part('del', blockHtml(row.l!, L), placeholder('B'), { kind: 'del' }, frag)];
    case 'ins':
      return [part('ins', placeholder('A'), blockHtml(row.r!, R), { kind: 'ins' }, frag)];
    case 'table':
      return frag ? [fragmentPart(row, o, L, R)] : tableParts(row, o, L, R);
  }
}

/** A changed table row's cells, each cell marked where it differs. */
function changedRowCells(lr: TableRow, rr: TableRow, colsL: number, colsR: number, o: CompareOptions, L: Labels, R: Labels): [string, string] {
  const diffs = lr.cells.map((c, i) => cellDiff(c.blocks, rr.cells[i]!.blocks, o));
  const cell = (side: 'a' | 'b') => (c: TableCell, i: number) =>
    diffs[i]!.changes.length ? modCellHtml(flattenBlocks(c.blocks), diffs[i]!, side) : c.blocks.map((x) => blockHtml(x, side === 'a' ? L : R)).join('');
  return [tableRowHtml(lr, colsL, L, cell('a')), tableRowHtml(rr, colsR, R, cell('b'))];
}

/** A changed row of a CSV-like table: one aligned row with cell-level changes. */
function fragmentPart(row: Row, o: CompareOptions, L: Labels, R: Labels): RowPart {
  const lt = row.l as TableBlock;
  const rt = row.r as TableBlock;
  const lr = lt.rows[0]!;
  const rr = rt.rows[0]!;
  let a: string;
  let b: string;
  if (lt.rows.length === 1 && rt.rows.length === 1 && lr.cells.length === rr.cells.length) {
    [a, b] = changedRowCells(lr, rr, columnsOf(lt.rows), columnsOf(rt.rows), o, L, R);
  } else {
    a = lt.rows.map((r) => tableRowHtml(r, columnsOf(lt.rows), L, undefined, ' whole')).join('');
    b = rt.rows.map((r) => tableRowHtml(r, columnsOf(rt.rows), R, undefined, ' whole')).join('');
  }
  return { anchor: row.key, kind: 'mod', extra: ' frag', a, b, act: { kind: 'mod' }, la: textLength(lt), lb: textLength(rt) };
}

/** A paired table: a caption line, then one line per table row. */
function tableParts(row: Row, o: CompareOptions, L: Labels, R: Labels): RowPart[] {
  const lt = row.l as TableBlock;
  const rt = row.r as TableBlock;
  const colsL = columnsOf(lt.rows);
  const colsR = columnsOf(rt.rows);
  const subs = row.table!.rows;
  const n = subs.filter((s) => s.kind !== 'eq').length;
  const cap = `<div class="tcap">Table <span>${n} ${n === 1 ? 'row differs' : 'rows differ'}</span></div>`;
  const parts: RowPart[] = [{ anchor: row.key, kind: 'tcap', extra: '', a: cap, b: cap, act: { kind: 'mod', table: true }, la: 0, lb: 0 }];
  subs.forEach((sr: TableRowDiff, idx) => {
    const line = (kind: string, a: string, b: string, act?: Act): RowPart => ({
      anchor: `${row.key}#${idx}`,
      kind,
      extra: idx === 0 ? ' t-first' : idx === subs.length - 1 ? ' t-last' : '',
      a,
      b,
      act,
      la: sr.l ? rowLength(sr.l) : 0,
      lb: sr.r ? rowLength(sr.r) : 0,
    });
    switch (sr.kind) {
      case 'eq':
        parts.push(line('teq', tableRowHtml(sr.l!, colsL, L), tableRowHtml(sr.r!, colsR, R)));
        break;
      case 'mod': {
        const lr = sr.l!;
        const rr = sr.r!;
        const [a, b] =
          lr.cells.length === rr.cells.length
            ? changedRowCells(lr, rr, colsL, colsR, o, L, R)
            : [tableRowHtml(lr, colsL, L, undefined, ' whole'), tableRowHtml(rr, colsR, R, undefined, ' whole')];
        parts.push(line('tmod', a, b, { kind: 'mod', sub: sr.key }));
        break;
      }
      case 'del':
        parts.push(line('tdel', tableRowHtml(sr.l!, colsL, L), placeholder('B'), { kind: 'del', sub: sr.key }));
        break;
      case 'ins':
        parts.push(line('tins', placeholder('A'), tableRowHtml(sr.r!, colsR, R), { kind: 'ins', sub: sr.key }));
        break;
    }
  });
  return parts;
}

/** The rows to show, with runs of hidden unchanged rows folded into one item each. */
export function gridItems(rows: readonly Row[], changesOnly: boolean, expanded: ReadonlySet<string>): GridItem[] {
  const show = rows.map(() => !changesOnly);
  if (changesOnly) {
    rows.forEach((r, i) => {
      if (r.kind === 'eq') return;
      for (let k = Math.max(0, i - CONTEXT); k <= Math.min(rows.length - 1, i + CONTEXT); k++) show[k] = true;
    });
    // Expanded folds, and folds too small to be worth hiding.
    for (let i = 0; i < rows.length; ) {
      if (show[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < rows.length && !show[j]) j++;
      if (j - i < 2 || expanded.has(rows[i]!.key)) for (let k = i; k < j; k++) show[k] = true;
      i = j;
    }
  }
  const items: GridItem[] = [];
  for (let i = 0; i < rows.length; ) {
    if (show[i]) {
      items.push({ type: 'row', row: rows[i]! });
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && !show[j]) j++;
    items.push({ type: 'fold', key: rows[i]!.key, count: j - i });
    i = j;
  }
  return items;
}
