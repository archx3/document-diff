import { alignRegion } from './align';
import type { InlineDiff } from './inline';
import { diffParagraphs, diffSpanLists } from './inline';
import type { Block, Doc, ParaBlock, Span, TableBlock, TableRow } from './model';
import { Interner, diffSequences, toRegions } from './myers';
import type { CompareOptions } from './tokens';
import { bagSimilarity, blockSig, propsSig, skipBlock, wordBag } from './tokens';

export type RowKind = 'eq' | 'mod' | 'del' | 'ins' | 'table';

/**
 * One aligned row of the side-by-side view.
 * `li` / `ri` are indices into the visible block lists; when the block is
 * missing on a side they are the insertion point on that side (the number of
 * that side's visible blocks that come before this row).
 */
export interface Row {
  key: string;
  kind: RowKind;
  l?: Block;
  r?: Block;
  li: number;
  ri: number;
  /** Index of the hunk this row belongs to, -1 for unchanged rows. */
  hunk: number;
  /** Paired tables: row-by-row differences. */
  table?: TableDiff;
}

export type SubKind = 'eq' | 'mod' | 'del' | 'ins';

export interface TableRowDiff {
  key: string;
  kind: SubKind;
  l?: TableRow;
  r?: TableRow;
}

export interface TableDiff {
  rows: TableRowDiff[];
}

export interface Hunk {
  /** Row index range [start, end). */
  start: number;
  end: number;
}

export interface Stats {
  changed: number;
  added: number;
  removed: number;
}

export interface Comparison {
  opts: CompareOptions;
  left: Doc;
  right: Doc;
  lv: Block[];
  rv: Block[];
  rows: Row[];
  hunks: Hunk[];
  stats: Stats;
}

const BLOCK_BUDGET_MS = 3000;

function compatible(a: Block, b: Block): boolean {
  return a.type === b.type;
}

export function compareDocs(left: Doc, right: Doc, opts: CompareOptions): Comparison {
  const lv = left.blocks.filter((b) => !skipBlock(b, opts));
  const rv = right.blocks.filter((b) => !skipBlock(b, opts));
  const interner = new Interner();
  const la = interner.ids(lv.map((b) => blockSig(b, opts)));
  const ra = interner.ids(rv.map((b) => blockSig(b, opts)));
  const regions = toRegions(diffSequences(la, ra, Date.now() + BLOCK_BUDGET_MS));

  const rows: Row[] = [];
  let lCount = 0;
  let rCount = 0;
  for (const reg of regions) {
    if (reg.eq) {
      for (let k = 0; k < reg.a1 - reg.a0; k++) {
        const l = lv[reg.a0 + k]!;
        const r = rv[reg.b0 + k]!;
        rows.push({ key: `e:${l.id}:${r.id}`, kind: 'eq', l, r, li: lCount++, ri: rCount++, hunk: -1 });
      }
      continue;
    }
    const L = lv.slice(reg.a0, reg.a1);
    const R = rv.slice(reg.b0, reg.b1);
    const bagsL: Array<Map<string, number> | undefined> = [];
    const bagsR: Array<Map<string, number> | undefined> = [];
    const bagL = (i: number) => (bagsL[i] ??= wordBag(L[i]!, opts));
    const bagR = (i: number) => (bagsR[i] ??= wordBag(R[i]!, opts));
    const steps = alignRegion(
      L.length,
      R.length,
      (i, j) => bagSimilarity(bagL(i), bagR(j)),
      (i, j) => compatible(L[i]!, R[j]!),
    );
    for (const st of steps) {
      if (st.l >= 0 && st.r >= 0) {
        const l = L[st.l]!;
        const r = R[st.r]!;
        if (blockSig(l, opts) === blockSig(r, opts)) {
          rows.push({ key: `e:${l.id}:${r.id}`, kind: 'eq', l, r, li: lCount++, ri: rCount++, hunk: -1 });
        } else if (l.type === 'table' && r.type === 'table') {
          const table = diffTables(l, r, opts);
          rows.push({ key: `t:${l.id}:${r.id}`, kind: 'table', l, r, li: lCount++, ri: rCount++, hunk: -1, table });
        } else {
          rows.push({ key: `m:${l.id}:${r.id}`, kind: 'mod', l, r, li: lCount++, ri: rCount++, hunk: -1 });
        }
      } else if (st.l >= 0) {
        const l = L[st.l]!;
        rows.push({ key: `d:${l.id}`, kind: 'del', l, li: lCount++, ri: rCount, hunk: -1 });
      } else {
        const r = R[st.r]!;
        rows.push({ key: `i:${r.id}`, kind: 'ins', r, li: lCount, ri: rCount++, hunk: -1 });
      }
    }
  }

  const hunks: Hunk[] = [];
  const stats: Stats = { changed: 0, added: 0, removed: 0 };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.kind === 'eq') continue;
    const prev = rows[i - 1];
    if (!prev || prev.kind === 'eq') hunks.push({ start: i, end: i + 1 });
    else hunks[hunks.length - 1]!.end = i + 1;
    row.hunk = hunks.length - 1;
    if (row.kind === 'mod') stats.changed++;
    else if (row.kind === 'del') stats.removed++;
    else if (row.kind === 'ins') stats.added++;
    else if (row.table) {
      for (const sr of row.table.rows) {
        if (sr.kind === 'mod') stats.changed++;
        else if (sr.kind === 'del') stats.removed++;
        else if (sr.kind === 'ins') stats.added++;
      }
    }
  }
  return { opts, left, right, lv, rv, rows, hunks, stats };
}

/* ---------------------------------------------------------------- tables */

function rowSig(row: TableRow, o: CompareOptions): string {
  return row.cells
    .map((c) =>
      c.blocks
        .filter((b) => !skipBlock(b, o))
        .map((b) => blockSig(b, o))
        .join('\u0003'),
    )
    .join('\u0004');
}

function rowBag(row: TableRow, o: CompareOptions): Map<string, number> {
  const bag = new Map<string, number>();
  for (const c of row.cells)
    for (const b of c.blocks) for (const [k, v] of wordBag(b, o)) bag.set(k, (bag.get(k) ?? 0) + v);
  return bag;
}

export function diffTables(l: TableBlock, r: TableBlock, o: CompareOptions): TableDiff {
  const interner = new Interner();
  const la = interner.ids(l.rows.map((x) => rowSig(x, o)));
  const ra = interner.ids(r.rows.map((x) => rowSig(x, o)));
  const regions = toRegions(diffSequences(la, ra, Date.now() + BLOCK_BUDGET_MS));
  const rows: TableRowDiff[] = [];
  for (const reg of regions) {
    if (reg.eq) {
      for (let k = 0; k < reg.a1 - reg.a0; k++) {
        const lr = l.rows[reg.a0 + k]!;
        const rr = r.rows[reg.b0 + k]!;
        rows.push({ key: `${lr.id}:${rr.id}`, kind: 'eq', l: lr, r: rr });
      }
      continue;
    }
    const L = l.rows.slice(reg.a0, reg.a1);
    const R = r.rows.slice(reg.b0, reg.b1);
    const bl = L.map((x) => rowBag(x, o));
    const br = R.map((x) => rowBag(x, o));
    const steps = alignRegion(
      L.length,
      R.length,
      (i, j) => bagSimilarity(bl[i]!, br[j]!),
      () => true,
    );
    for (const st of steps) {
      if (st.l >= 0 && st.r >= 0) {
        const lr = L[st.l]!;
        const rr = R[st.r]!;
        rows.push({ key: `${lr.id}:${rr.id}`, kind: 'mod', l: lr, r: rr });
      } else if (st.l >= 0) {
        const lr = L[st.l]!;
        rows.push({ key: `${lr.id}:`, kind: 'del', l: lr });
      } else {
        const rr = R[st.r]!;
        rows.push({ key: `:${rr.id}`, kind: 'ins', r: rr });
      }
    }
  }
  return { rows };
}

/* ---------------------------------------------------------- inline diffs */

const inlineCache = new WeakMap<Block, WeakMap<Block, { key: string; value: InlineDiff }>>();

/** Word-level diff between two paired blocks (paragraphs or other flattened blocks). */
export function inlineDiff(l: Block, r: Block, o: CompareOptions): InlineDiff {
  const key = JSON.stringify(o);
  let inner = inlineCache.get(l);
  if (!inner) {
    inner = new WeakMap();
    inlineCache.set(l, inner);
  }
  const hit = inner.get(r);
  if (hit && hit.key === key) return hit.value;
  const value =
    l.type === 'p' && r.type === 'p' ? diffParagraphs(l, r, o) : diffSpanLists(flattenBlocks([l]), flattenBlocks([r]), o);
  inner.set(r, { key, value });
  return value;
}

/** Word-level diff between two table cells (lists of blocks). */
export function cellDiff(l: Block[], r: Block[], o: CompareOptions): InlineDiff {
  return diffSpanLists(flattenBlocks(l), flattenBlocks(r), o);
}

/** Flattens blocks into one span list, paragraphs separated by line breaks. */
export function flattenBlocks(blocks: readonly Block[]): Span[] {
  const out: Span[] = [];
  const sep = () => {
    if (out.length) out.push({ text: '\n', fmt: {} });
  };
  const walk = (b: Block) => {
    if (b.type === 'p') {
      sep();
      for (const s of b.spans) if (!s.marker) out.push(s);
    } else if (b.type === 'opaque') {
      b.blocks.forEach(walk);
    } else if (b.type === 'table') {
      // Nested table: rows on separate lines, cells separated by a bar.
      b.rows.forEach((r) => {
        sep();
        r.cells.forEach((c, i) => {
          if (i) out.push({ text: ' | ', fmt: {} });
          const inner = flattenBlocks(c.blocks).map((s) => (s.text === '\n' && !s.obj ? { ...s, text: ' ' } : s));
          out.push(...inner);
        });
      });
    }
  };
  blocks.forEach(walk);
  return out;
}

export function propsChanged(l: Block, r: Block, o: CompareOptions): boolean {
  return l.type === 'p' && r.type === 'p' && propsSig(l.props, o) !== propsSig(r.props, o);
}

export function isPara(b: Block | undefined): b is ParaBlock {
  return !!b && b.type === 'p';
}
