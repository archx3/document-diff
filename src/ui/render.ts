/**
 * HTML rendering of documents and differences for the comparison view.
 * Everything is built as strings (fast for thousands of rows) and every
 * piece of document text goes through `esc`.
 */
import type { InlineDiff } from '../core/inline';
import { fullRange } from '../core/inline';
import type { Block, Fmt, ParaBlock, Span, TableCell, TableRow } from '../core/model';
import { describeProps } from '../core/model';
import type { Tokenized } from '../core/tokens';

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export type Labels = Map<ParaBlock, string>;

function fmtOpen(f: Fmt): string {
  let o = '';
  if (f.href) o += `<span class="lnk" title="${esc(f.href)}">`;
  if (f.b) o += '<b>';
  if (f.i) o += '<i>';
  if (f.u) o += '<u>';
  if (f.s) o += '<s>';
  if (f.sup) o += '<sup>';
  if (f.sub) o += '<sub>';
  if (f.code) o += '<code>';
  if (f.hl) o += '<mark>';
  return o;
}

function fmtClose(f: Fmt): string {
  let c = '';
  if (f.hl) c += '</mark>';
  if (f.code) c += '</code>';
  if (f.sub) c += '</sub>';
  if (f.sup) c += '</sup>';
  if (f.s) c += '</s>';
  if (f.u) c += '</u>';
  if (f.i) c += '</i>';
  if (f.b) c += '</b>';
  if (f.href) c += '</span>';
  return c;
}

function objectHtml(s: Span): string {
  const o = s.obj!;
  switch (o.kind) {
    case 'image': {
      if (o.src) {
        const w = o.width ? ` width="${Math.min(o.width, 560)}"` : '';
        const h = o.width && o.height ? ` style="aspect-ratio:${o.width}/${o.height}"` : '';
        return `<img class="obj-img" src="${esc(o.src)}" alt="${esc(o.label)}" title="${esc(o.label)}"${w}${h} loading="lazy" decoding="async">`;
      }
      return `<span class="obj" title="${esc(o.label)}">${esc(o.label)}</span>`;
    }
    case 'footnote':
    case 'endnote':
      return `<sup class="fn" title="${esc(o.label)}">${o.kind === 'footnote' ? 'fn' : 'en'}</sup>`;
    case 'pagebreak':
      return `<span class="pgbrk">${esc(o.label)}</span>`;
    case 'field':
      return `<span class="field" title="${esc(o.label)}">${esc(o.text || '\u00a0')}</span>`;
    case 'math':
      return `<span class="math" title="Equation">${esc(o.text ?? '')}</span>`;
    case 'symbol':
      return `<span class="sym" title="${esc(o.label)}">${esc(o.text ?? '')}</span>`;
    case 'textbox':
      return `<span class="obj" title="Text box">${esc(o.text ? `Text box: ${o.text}` : 'Text box')}</span>`;
    default:
      return `<span class="obj" title="${esc(o.label)}">${esc(o.label)}</span>`;
  }
}

function pieceHtml(s: Span, start: number, end: number): string {
  if (s.marker) return '';
  if (s.obj) return fmtOpen(s.fmt) + objectHtml(s) + fmtClose(s.fmt);
  const t = s.text.slice(start, end);
  if (!t) return '';
  return fmtOpen(s.fmt) + esc(t) + fmtClose(s.fmt);
}

export function spansHtml(spans: readonly Span[]): string {
  let out = '';
  for (const s of spans) out += pieceHtml(s, 0, s.text.length);
  return out;
}

function tokensHtml(spans: readonly Span[], t: Tokenized, from: number, to: number): string {
  let out = '';
  for (let k = from; k < to; k++) for (const p of t.tokens[k]!.pieces) out += pieceHtml(spans[p.span]!, p.start, p.end);
  return out;
}

/* --------------------------------------------------------------- blocks */

function paraClass(p: ParaBlock): string {
  const r = p.props.role;
  let cls = `blk r-${r}`;
  if (r === 'h' || r === 'toc') cls += ` l${Math.min(6, p.props.level ?? 1)}`;
  if (p.props.list) cls += ' li';
  if (p.props.align) cls += ` a-${p.props.align}`;
  return cls;
}

function paraWrap(p: ParaBlock, inner: string, labels: Labels, extraCls = '', chip = ''): string {
  const list = p.props.list;
  const body = inner || '<span class="empty-p">¶</span>';
  if (list) {
    const label = labels.get(p) ?? '•';
    return `<div class="${paraClass(p)}${extraCls}" style="--lvl:${list.level}">${chip}<span class="lbl">${esc(label)}</span><div class="txt">${body}</div></div>`;
  }
  return `<div class="${paraClass(p)}${extraCls}">${chip}${body}</div>`;
}

export function blockHtml(b: Block, labels: Labels): string {
  switch (b.type) {
    case 'p':
      return paraWrap(b, spansHtml(b.spans), labels);
    case 'table':
      return tableHtml(b.rows, labels);
    case 'opaque':
      return `<div class="opaque"><div class="opaque-label">${esc(b.label)}</div>${b.blocks.map((x) => blockHtml(x, labels)).join('')}</div>`;
    case 'marker':
      return '';
  }
}

function cellHtml(c: TableCell, labels: Labels): string {
  return c.blocks.map((x) => blockHtml(x, labels)).join('');
}

export function columnsOf(rows: readonly TableRow[]): number {
  let n = 1;
  for (const r of rows) n = Math.max(n, r.cells.reduce((s, c) => s + (c.colspan ?? 1), 0));
  return n;
}

export function tableRowHtml(r: TableRow, cols: number, labels: Labels, cellInner?: (c: TableCell, i: number) => string, extra = ''): string {
  let out = `<div class="trow${r.header ? ' th' : ''}${extra}" style="--cols:${cols}">`;
  r.cells.forEach((c, i) => {
    const span = c.colspan ?? 1;
    const merged = c.vmerge === 'continue' ? ' vcont' : '';
    out += `<div class="tcell${merged}" style="grid-column:span ${span}">${c.vmerge === 'continue' ? '' : (cellInner ? cellInner(c, i) : cellHtml(c, labels))}</div>`;
  });
  return out + '</div>';
}

export function tableHtml(rows: readonly TableRow[], labels: Labels): string {
  const cols = columnsOf(rows);
  return `<div class="tbl">${rows.map((r) => tableRowHtml(r, cols, labels)).join('')}</div>`;
}

/* ---------------------------------------------------------------- diffs */

/**
 * One side of a word-level diff. Changed words are wrapped in <del>/<ins>
 * with data-c set to the change index; where the other side has text this
 * side lacks, a caret marks the spot.
 */
export function inlineSideHtml(spans: readonly Span[], diff: InlineDiff, side: 'a' | 'b', withCarets = true): string {
  const t = side === 'a' ? diff.a : diff.b;
  const tag = side === 'a' ? 'del' : 'ins';
  let out = '';
  const first = t.comp.length ? t.comp[0]! : t.tokens.length;
  out += tokensHtml(spans, t, 0, first);
  let end = first;
  for (const seg of diff.segs) {
    const c0 = side === 'a' ? seg.a0 : seg.b0;
    const c1 = side === 'a' ? seg.a1 : seg.b1;
    const [f0, f1] = fullRange(t, c0, c1);
    if (f1 > end) end = f1;
    if (seg.eq) {
      out += tokensHtml(spans, t, f0, f1);
      continue;
    }
    const ch = diff.changes[seg.change]!;
    const cls = ch.fmtOnly ? 'chg fmt' : 'chg';
    const title = ch.fmtOnly ? ' title="Formatting differs"' : '';
    if (f1 > f0) out += `<${tag} class="${cls}" data-c="${seg.change}"${title}>${tokensHtml(spans, t, f0, f1)}</${tag}>`;
    else if (withCarets) out += `<span class="caret" data-c="${seg.change}" title="Text here only in ${side === 'a' ? 'B' : 'A'}"></span>`;
  }
  out += tokensHtml(spans, t, Math.max(end, first), t.tokens.length);
  return out;
}

export function modParaHtml(p: ParaBlock, diff: InlineDiff, side: 'a' | 'b', labels: Labels, propsDiffer: boolean): string {
  const chip = propsDiffer ? `<span class="chip prop" title="Paragraph style differs">${esc(describeProps(p.props))}</span>` : '';
  return paraWrap(p, inlineSideHtml(p.spans, diff, side), labels, propsDiffer ? ' propchg' : '', chip);
}

/** Changed table cell rendered from its flattened diff. */
export function modCellHtml(spans: readonly Span[], diff: InlineDiff, side: 'a' | 'b'): string {
  return `<div class="blk r-p cellflat">${inlineSideHtml(spans, diff, side, true) || '<span class="empty-p">¶</span>'}</div>`;
}
