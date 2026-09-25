import type { MergeBackend, MergeContext, SplicePiece } from './merge';
import type { Block, ListInfo, ParaBlock, Span, TableBlock, TableRow } from './model';
import { newId, normalizeSpans } from './model';

/** Deep copy of a block without any format backend data, with fresh ids. */
export function cloneModel(b: Block): Block {
  switch (b.type) {
    case 'p':
      return {
        id: newId('p'),
        type: 'p',
        props: { ...b.props, list: b.props.list ? { ...b.props.list } : undefined },
        spans: b.spans.filter((s) => !s.marker).map(cloneSpan),
      };
    case 'table':
      return { id: newId('t'), type: 'table', rows: b.rows.map(cloneRow) };
    case 'opaque':
      return { id: newId('o'), type: 'opaque', label: b.label, blocks: b.blocks.map(cloneModel) };
    case 'marker':
      return { id: newId('m'), type: 'marker' };
  }
}

function cloneSpan(s: Span): Span {
  const out: Span = { text: s.text, fmt: { ...s.fmt } };
  if (s.obj) out.obj = { ...s.obj };
  return out;
}

export function cloneRow(r: TableRow): TableRow {
  return {
    id: newId('r'),
    header: r.header,
    cells: r.cells.map((c) => ({
      blocks: c.blocks.map(cloneModel),
      colspan: c.colspan,
      rowspan: c.rowspan,
      vmerge: c.vmerge,
      header: c.header,
    })),
  };
}

/**
 * A list item copied next to items of the same kind joins their list, so
 * numbering continues instead of restarting.
 */
export function neighborList(list: ListInfo, ctx: MergeContext): ListInfo | undefined {
  const candidates = [ctx.replacing, ctx.prev, ctx.next];
  for (const c of candidates) {
    if (c && c.type === 'p' && c.props.list && c.props.list.ordered === list.ordered) return c.props.list;
  }
  return undefined;
}

function adoptList(p: ParaBlock, ctx: MergeContext): ParaBlock {
  const list = p.props.list;
  if (!list) return p;
  const n = neighborList(list, ctx);
  const merged: ListInfo = n
    ? { ...list, key: n.key, overrideKey: n.overrideKey, formats: n.formats ?? list.formats, starts: n.starts ?? list.starts }
    : { ...list, key: `${ctx.source.id}/${list.key ?? ''}`, overrideKey: undefined };
  return { ...p, props: { ...p.props, list: merged } };
}

export function spliceSpans(target: ParaBlock, source: ParaBlock, plan: SplicePiece[]): Span[] {
  const spans: Span[] = [];
  for (const piece of plan) {
    const src = (piece.from === 't' ? target : source).spans[piece.span];
    if (!src || src.marker) continue;
    if (src.obj) spans.push(cloneSpan(src));
    else spans.push({ text: src.text.slice(piece.start, piece.end), fmt: { ...src.fmt } });
  }
  return normalizeSpans(spans);
}

export const modelBackend: MergeBackend = {
  adopt(block, ctx) {
    const copy = cloneModel(block);
    return copy.type === 'p' ? adoptList(copy, ctx) : copy;
  },
  remove() {
    return [];
  },
  splice(target, source, plan) {
    return { id: newId('p'), type: 'p', props: target.props, spans: spliceSpans(target, source, plan) };
  },
  spliceTable(_target: TableBlock, _source, plan) {
    return {
      id: newId('t'),
      type: 'table',
      rows: plan.map((p) => (p.from === 't' ? p.row : cloneRow(p.row))),
    };
  },
};
