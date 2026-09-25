import type { Comparison, Row, TableRowDiff } from './compare';
import { inlineDiff } from './compare';
import type { InlineDiff } from './inline';
import type { Block, Doc, ParaBlock, TableBlock, TableRow } from './model';

/** Direction of a copy: 'l2r' makes the right document match the left one. */
export type Dir = 'l2r' | 'r2l';

export interface Selection {
  /** Rows copied as a whole (paragraph replaced, inserted or removed). */
  rows?: Set<string>;
  /** Word-level changes inside paired paragraphs: row key → change indices. */
  inline?: Map<string, Set<number>>;
  /** Rows inside paired tables: row key → table-row keys. */
  tableRows?: Map<string, Set<string>>;
}

export interface MergeContext {
  source: Doc;
  target: Doc;
  /** Target block being replaced (for whole-block copies). */
  replacing?: Block;
  /** Previous visible block in the new target, and the next visible block after the edit. */
  prev?: Block;
  next?: Block;
}

/** A piece of a paragraph: characters [start, end) of a span from the target or source paragraph. */
export interface SplicePiece {
  from: 't' | 's';
  span: number;
  start: number;
  end: number;
}

export interface TableRowPlan {
  from: 't' | 's';
  row: TableRow;
}

/** Format-specific operations used to build the edited target document. */
export interface MergeBackend {
  adopt(block: Block, ctx: MergeContext): Block;
  /** The target block is removed; returns anything that must stay behind (e.g. a section break). */
  remove(block: Block, ctx: MergeContext): Block[];
  splice(target: ParaBlock, source: ParaBlock, plan: SplicePiece[], ctx: MergeContext): Block;
  spliceTable(target: TableBlock, source: TableBlock, plan: TableRowPlan[], ctx: MergeContext): Block;
}

export interface MergeResult {
  doc: Doc;
  /** Number of edits applied. */
  applied: number;
}

const HIDDEN = Symbol('hidden');

/**
 * Applies the selected changes in one direction and returns the new target
 * document. Blocks that are not visible in the comparison (empty paragraphs,
 * bookmarks …) stay where they are.
 */
export function applySelection(cmp: Comparison, dir: Dir, sel: Selection, backend: MergeBackend): MergeResult {
  const target = dir === 'l2r' ? cmp.right : cmp.left;
  const source = dir === 'l2r' ? cmp.left : cmp.right;
  const visible = dir === 'l2r' ? cmp.rv : cmp.lv;
  const all = target.blocks;
  const pos = new Map<Block, number>();
  all.forEach((b, i) => pos.set(b, i));
  const visibleSet = new Set<Block>(visible);

  const out: Block[] = [];
  let lastVisible: Block | undefined;
  let cursor = 0;
  let applied = 0;
  const emit = (b: Block, isVisible: boolean | typeof HIDDEN) => {
    out.push(b);
    if (isVisible === true) lastVisible = b;
  };
  const flushTo = (idx: number) => {
    while (cursor < idx) {
      const b = all[cursor++]!;
      emit(b, visibleSet.has(b));
    }
  };

  for (const row of cmp.rows) {
    const t = dir === 'l2r' ? row.r : row.l;
    const s = dir === 'l2r' ? row.l : row.r;
    const tIndex = dir === 'l2r' ? row.ri : row.li;
    if (t) {
      const idx = pos.get(t);
      if (idx === undefined) continue;
      flushTo(idx);
      cursor = idx + 1;
      const next = visible[tIndex + 1];
      const ctx: MergeContext = { source, target, replacing: t, prev: lastVisible, next };
      if (row.kind !== 'eq' && sel.rows?.has(row.key)) {
        applied++;
        if (s) emit(backend.adopt(s, ctx), true);
        else for (const kept of backend.remove(t, ctx)) emit(kept, HIDDEN);
        continue;
      }
      const inl = sel.inline?.get(row.key);
      if (row.kind === 'mod' && inl?.size && s && t.type === 'p' && s.type === 'p') {
        const diff = inlineDiff(row.l!, row.r!, cmp.opts);
        const plan = splicePlan(diff, dir, inl, t);
        emit(backend.splice(t, s, plan, ctx), true);
        applied += inl.size;
        continue;
      }
      const tr = sel.tableRows?.get(row.key);
      if (row.kind === 'table' && tr?.size && row.table && t.type === 'table' && s?.type === 'table') {
        const plan = tableRowPlan(row.table.rows, dir, tr);
        emit(backend.spliceTable(t, s, plan, ctx), true);
        applied += tr.size;
        continue;
      }
      emit(t, true);
    } else if (s && sel.rows?.has(row.key)) {
      const next = visible[tIndex];
      const idx = next ? (pos.get(next) ?? all.length) : all.length;
      flushTo(idx);
      emit(backend.adopt(s, { source, target, prev: lastVisible, next }), true);
      applied++;
    }
  }
  flushTo(all.length);
  if (!applied) return { doc: target, applied };
  return { doc: { ...target, blocks: out, version: target.version + 1 }, applied };
}

/**
 * Plans a paragraph that keeps the target's text except for the selected
 * word-level changes, which are taken from the source. Target markers
 * (bookmarks, comment anchors) are kept in place.
 */
export function splicePlan(diff: InlineDiff, dir: Dir, selected: ReadonlySet<number>, target: ParaBlock): SplicePiece[] {
  const T = dir === 'l2r' ? diff.b : diff.a;
  const S = dir === 'l2r' ? diff.a : diff.b;
  const raw: SplicePiece[] = [];
  const emitTokens = (from: 't' | 's', tokens: typeof T.tokens, f0: number, f1: number) => {
    for (let k = f0; k < f1; k++) for (const p of tokens[k]!.pieces) raw.push({ from, span: p.span, start: p.start, end: p.end });
  };
  const tFirst = T.comp.length ? T.comp[0]! : T.tokens.length;
  emitTokens('t', T.tokens, 0, tFirst);
  let tEnd = tFirst;
  for (const seg of diff.segs) {
    const t0 = dir === 'l2r' ? seg.b0 : seg.a0;
    const t1 = dir === 'l2r' ? seg.b1 : seg.a1;
    const s0 = dir === 'l2r' ? seg.a0 : seg.b0;
    const s1 = dir === 'l2r' ? seg.a1 : seg.b1;
    if (t1 > t0) tEnd = T.comp[t1 - 1]! + 1;
    if (seg.eq || !selected.has(seg.change)) {
      if (t1 > t0) emitTokens('t', T.tokens, T.comp[t0]!, T.comp[t1 - 1]! + 1);
    } else if (s1 > s0) {
      emitTokens('s', S.tokens, S.comp[s0]!, S.comp[s1 - 1]! + 1);
    }
  }
  emitTokens('t', T.tokens, Math.max(tEnd, tFirst), T.tokens.length);

  // Merge contiguous pieces of the same span and weave target markers back in.
  const merged: SplicePiece[] = [];
  let lastT = -1;
  const pushMarkersBefore = (limit: number) => {
    for (let k = lastT + 1; k < limit; k++) {
      if (target.spans[k]?.marker) merged.push({ from: 't', span: k, start: 0, end: 0 });
    }
  };
  for (const p of raw) {
    if (p.from === 't') {
      if (p.span > lastT) {
        pushMarkersBefore(p.span);
        lastT = p.span;
      }
    }
    const prev = merged[merged.length - 1];
    if (prev && prev.from === p.from && prev.span === p.span && prev.end === p.start) prev.end = p.end;
    else merged.push({ ...p });
  }
  pushMarkersBefore(target.spans.length);
  return merged;
}

function tableRowPlan(rows: TableRowDiff[], dir: Dir, selected: ReadonlySet<string>): TableRowPlan[] {
  const plan: TableRowPlan[] = [];
  for (const r of rows) {
    const t = dir === 'l2r' ? r.r : r.l;
    const s = dir === 'l2r' ? r.l : r.r;
    const pick = r.kind !== 'eq' && selected.has(r.key);
    if (pick) {
      if (s) plan.push({ from: 's', row: s });
      // no source row: the target row is removed
    } else if (t) {
      plan.push({ from: 't', row: t });
    }
  }
  return plan;
}

/* ------------------------------------------------------------ selections */

export function selectRows(rows: Iterable<Row>): Selection {
  const sel: Selection = { rows: new Set() };
  for (const r of rows) if (r.kind !== 'eq') sel.rows!.add(r.key);
  return sel;
}

export function selectHunk(cmp: Comparison, hunk: number): Selection {
  const h = cmp.hunks[hunk];
  if (!h) return {};
  return selectRows(cmp.rows.slice(h.start, h.end));
}

export function selectAll(cmp: Comparison): Selection {
  return selectRows(cmp.rows);
}

export function selectInline(rowKey: string, change: number): Selection {
  return { inline: new Map([[rowKey, new Set([change])]]) };
}

export function selectTableRow(rowKey: string, subKey: string): Selection {
  return { tableRows: new Map([[rowKey, new Set([subKey])]]) };
}
