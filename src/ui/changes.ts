/**
 * The list of changes beside the comparison: one card per change (the same
 * changes N and P step through), saying what kind of change it is, how many
 * words are only in A and only in B, and showing the words themselves with a
 * little of the text around them.
 */
import type { Comparison, Row } from '../core/compare';
import { cellDiff, flattenBlocks, inlineDiff, propsChanged } from '../core/compare';
import type { InlineDiff } from '../core/inline';
import { fullRange } from '../core/inline';
import type { Block, InlineObject, Span, TableBlock, TableRow } from '../core/model';
import { describeProps } from '../core/model';
import type { Tokenized } from '../core/tokens';
import { esc } from './render';

export type ChangeKind = 'mod' | 'del' | 'ins' | 'fmt' | 'table';

export interface ChangeSummary {
  kind: ChangeKind;
  /** Words only in A, and only in B. */
  minus: number;
  plus: number;
  /** The first few edits, as HTML. */
  edits: Edit[];
  /** Edits not shown. */
  more: number;
}

export interface Edit {
  /** A's side of the edit, with the words only in A marked. */
  a?: string;
  /** B's side, with the words only in B marked. */
  b?: string;
  /** What changed when the words did not (formatting, paragraph style). */
  note?: string;
}

export const KIND_LABEL: Record<ChangeKind, string> = {
  mod: 'Changed',
  del: 'Only in A',
  ins: 'Only in B',
  fmt: 'Formatting',
  table: 'Table',
};

/** Edits shown on a card. */
const MAX_EDITS = 3;
/** Words of unchanged text shown on either side of an edit. */
const CONTEXT_WORDS = 3;
/** Longest stretch of changed text shown, and of the text around it. */
const MAX_TEXT = 180;
const MAX_CONTEXT = 48;

const WORDS = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

function countWords(s: string): number {
  return s.match(WORDS)?.length ?? 0;
}

function objectText(o: InlineObject): string {
  switch (o.kind) {
    case 'image':
      return '[picture]';
    case 'footnote':
    case 'endnote':
      return `[${o.kind}]`;
    case 'pagebreak':
      return '[page break]';
    case 'textbox':
      return o.text ? `[text box: ${o.text}]` : '[text box]';
    case 'field':
    case 'math':
    case 'symbol':
      return o.text ?? '';
    default:
      return `[${o.label}]`;
  }
}

function spansText(spans: readonly Span[]): string {
  let s = '';
  for (const x of spans) if (!x.marker) s += x.obj ? objectText(x.obj) : x.text;
  return s;
}

function tableRowText(r: TableRow): string {
  return r.cells.map((c) => c.blocks.map(blockPlain).join(' ')).join(' | ');
}

/** A block as one line of plain text. */
function blockPlain(b: Block): string {
  switch (b.type) {
    case 'p':
      return spansText(b.spans);
    case 'table':
      return b.rows.map(tableRowText).join(' / ');
    case 'opaque':
      return `${b.label}: ${b.blocks.map(blockPlain).join(' ')}`;
    case 'marker':
      return '';
  }
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ');
}

function clipEnd(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.replace(/\s+\S*$/, '') || cut}…`;
}

function clipStart(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(-max);
  return `…${cut.replace(/^\S*\s+/, '') || cut}`;
}

/** Text of tokens [from, to), pictures and notes named in brackets. */
function tokensText(spans: readonly Span[], t: Tokenized, from: number, to: number): string {
  let s = '';
  for (let k = from; k < to; k++) {
    const tok = t.tokens[k]!;
    const span = spans[tok.pieces[0]?.span ?? -1];
    s += span?.obj ? objectText(span.obj) : tok.text;
  }
  return s;
}

type Mark = 'del' | 'ins' | 'fmt';

function marked(text: string, mark: Mark): string {
  const inner = text ? esc(clipEnd(text, MAX_TEXT)) : '<i>spaces</i>';
  return mark === 'fmt' ? `<mark class="fmt">${inner}</mark>` : `<${mark}>${inner}</${mark}>`;
}

/** One side of a word-level edit, with a few words of the text around it. */
function excerpt(spans: readonly Span[], t: Tokenized, c0: number, c1: number, mark: Mark): string {
  const [f0, f1] = fullRange(t, c0, c1);
  let s = f0;
  for (let words = 0; s > 0; s--) {
    if (t.tokens[s - 1]!.word && words++ === CONTEXT_WORDS) break;
  }
  let e = f1;
  for (let words = 0; e < t.tokens.length; e++) {
    if (t.tokens[e]!.word && words++ === CONTEXT_WORDS) break;
  }
  let before = oneLine(tokensText(spans, t, s, f0));
  let text = oneLine(tokensText(spans, t, f0, f1));
  let after = oneLine(tokensText(spans, t, f1, e));
  // Spaces at the edges of the change belong to the text around it.
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  before += m[1];
  text = m[2]!;
  after = m[3] + after;
  before = clipStart(before.trimStart(), MAX_CONTEXT);
  after = clipEnd(after.trimEnd(), MAX_CONTEXT);
  const lead = s > 0 && !before.startsWith('…') ? '…' : '';
  const tail = e < t.tokens.length && !after.endsWith('…') ? '…' : '';
  return `${lead}${esc(before)}${marked(text, mark)}${esc(after)}${tail}`;
}

/** Collects a change's edits, keeping the first few and counting the rest. */
class Edits {
  minus = 0;
  plus = 0;
  /** Some words differ (not only formatting). */
  text = false;
  fmt = false;
  readonly shown: Edit[] = [];
  total = 0;

  /** Whether another edit would still be shown (so its HTML is worth building). */
  get room(): boolean {
    return this.shown.length < MAX_EDITS;
  }

  add(edit: () => Edit): void {
    if (this.room) this.shown.push(edit());
    this.total++;
  }

  /** The edits of a word-level diff. */
  diff(d: InlineDiff, sa: readonly Span[], sb: readonly Span[]): void {
    for (const ch of d.changes) {
      if (ch.fmtOnly) {
        this.fmt = true;
        this.add(() => ({ a: excerpt(sa, d.a, ch.a0, ch.a1, 'fmt'), note: 'Same words, different formatting' }));
        continue;
      }
      const [a0, a1] = fullRange(d.a, ch.a0, ch.a1);
      const [b0, b1] = fullRange(d.b, ch.b0, ch.b1);
      this.text = true;
      this.minus += countWords(tokensText(sa, d.a, a0, a1));
      this.plus += countWords(tokensText(sb, d.b, b0, b1));
      this.add(() => ({
        a: a1 > a0 ? excerpt(sa, d.a, ch.a0, ch.a1, 'del') : undefined,
        b: b1 > b0 ? excerpt(sb, d.b, ch.b0, ch.b1, 'ins') : undefined,
      }));
    }
  }

  /** Text that is only on one side. */
  whole(text: string, side: 'a' | 'b'): void {
    const line = oneLine(text).trim();
    this.text = true;
    if (side === 'a') this.minus += countWords(line);
    else this.plus += countWords(line);
    const html = line ? marked(line, side === 'a' ? 'del' : 'ins') : '<i>An empty paragraph</i>';
    this.add(() => (side === 'a' ? { a: html } : { b: html }));
  }
}

function rowEdits(row: Row, cmp: Comparison, acc: Edits): void {
  const o = cmp.opts;
  switch (row.kind) {
    case 'del':
      acc.whole(blockPlain(row.l!), 'a');
      return;
    case 'ins':
      acc.whole(blockPlain(row.r!), 'b');
      return;
    case 'mod': {
      const l = row.l!;
      const r = row.r!;
      acc.diff(inlineDiff(l, r, o), l.type === 'p' ? l.spans : flattenBlocks([l]), r.type === 'p' ? r.spans : flattenBlocks([r]));
      if (l.type === 'p' && r.type === 'p' && propsChanged(l, r, o)) {
        acc.fmt = true;
        acc.add(() => ({ note: `Paragraph style: ${describeProps(l.props)} in A, ${describeProps(r.props)} in B` }));
      }
      return;
    }
    case 'table':
      for (const sr of row.table?.rows ?? []) {
        if (sr.kind === 'del') acc.whole(tableRowText(sr.l!), 'a');
        else if (sr.kind === 'ins') acc.whole(tableRowText(sr.r!), 'b');
        else if (sr.kind === 'mod') {
          const lc = sr.l!.cells;
          const rc = sr.r!.cells;
          if (lc.length === rc.length) {
            lc.forEach((c, i) => {
              const d = cellDiff(c.blocks, rc[i]!.blocks, o);
              if (d.changes.length) acc.diff(d, flattenBlocks(c.blocks), flattenBlocks(rc[i]!.blocks));
            });
          } else {
            acc.whole(tableRowText(sr.l!), 'a');
            acc.whole(tableRowText(sr.r!), 'b');
          }
        }
      }
      return;
    case 'eq':
      return;
  }
}

/** What change `index` of the comparison consists of. */
export function summarizeChange(cmp: Comparison, index: number): ChangeSummary {
  const h = cmp.hunks[index]!;
  const rows = cmp.rows.slice(h.start, h.end);
  const acc = new Edits();
  for (const row of rows) rowEdits(row, cmp, acc);
  const only = (k: Row['kind']) => rows.every((r) => r.kind === k);
  // A row of a CSV file is a one-row table; a changed one is just a changed row.
  const tables = rows.every((r) => r.kind === 'table' && !(r.l as TableBlock).fragment);
  const kind: ChangeKind = only('del') ? 'del' : only('ins') ? 'ins' : tables ? 'table' : !acc.text && acc.fmt ? 'fmt' : 'mod';
  return { kind, minus: acc.minus, plus: acc.plus, edits: acc.shown, more: acc.total - acc.shown.length };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function cardHtml(index: number, s: ChangeSummary, current: boolean): string {
  const counts: string[] = [];
  if (s.minus) counts.push(`<span class="minus"><span class="vh">${plural(s.minus, 'word')} only in A,</span><span aria-hidden="true">−${s.minus.toLocaleString()}</span></span>`);
  if (s.plus) counts.push(`<span class="plus"><span class="vh">${plural(s.plus, 'word')} only in B,</span><span aria-hidden="true">+${s.plus.toLocaleString()}</span></span>`);
  let body = '';
  for (const e of s.edits) {
    if (e.a) body += `<span class="chg-line a">${e.a}</span>`;
    if (e.b) body += `<span class="chg-line b">${e.b}</span>`;
    if (e.note) body += `<span class="chg-note">${esc(e.note)}</span>`;
  }
  if (s.more) body += `<span class="chg-more">and ${plural(s.more, 'more edit')}</span>`;
  const cur = current ? ' cur' : '';
  const aria = current ? ' aria-current="true"' : '';
  return `<li><button type="button" class="chg-card k-${s.kind}${cur}"${aria} data-hunk="${index}"><span class="chg-head"><span class="chg-n">${index + 1}.</span><span class="chg-kind">${KIND_LABEL[s.kind]}</span>${counts.length ? `<span class="chg-counts">${counts.join('')}</span>` : ''}</span>${body}</button></li>`;
}

/** The cards for every change in the comparison. */
export function changeListHtml(cmp: Comparison, current: number): string {
  let html = '';
  for (let i = 0; i < cmp.hunks.length; i++) html += cardHtml(i, summarizeChange(cmp, i), i === current);
  return html;
}
