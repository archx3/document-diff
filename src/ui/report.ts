/**
 * The change report: every change with its words before and after, the
 * reader's decision, reactions and notes, as a document of its own (saved
 * as PDF or Word by the usual writers). For handing over a review, or
 * keeping a record of one.
 */
import type { Comparison, Row } from '../core/compare';
import { inlineDiff } from '../core/compare';
import type { Block, Doc, Fmt, ParaBlock, ParaProps, Span, TableBlock, TableRow } from '../core/model';
import { blockText, newId } from '../core/model';
import type { Tokenized } from '../core/tokens';
import type { Decision, Placed, Reaction } from '../review/marks';
import { DECISIONS, REACTIONS } from '../review/marks';
import { findMoves } from '../core/moves';
import { RISK_NAME, changeRisks } from '../review/risk';
import { KIND_LABEL, summarizeChange } from './changes';

export interface ReportOptions {
  /** Only changes without a decision. */
  openOnly?: boolean;
  /** Only changes with a note or reaction. */
  notedOnly?: boolean;
  /** The unchanged paragraph before and after each change. */
  context?: boolean;
  /** Who made the report. */
  reviewer?: string;
  /** A summary of what matters (Claude's), one point a line. */
  summary?: readonly string[];
  date?: Date;
}

export interface ReportNames {
  reaction: Readonly<Record<Reaction, string>>;
  decision: Readonly<Record<Decision, string>>;
}

interface ChangeInfo {
  decision?: Decision;
  reactions: Reaction[];
  notes: Array<{ text: string; quote?: string; date: number; author?: string }>;
}

/* --------------------------------------------------------------- blocks */

const run = (text: string, fmt: Fmt = {}): Span => ({ text, fmt });
function para(spans: Span[], props: Partial<ParaProps> = {}): ParaBlock {
  return { id: newId('rp'), type: 'p', props: { role: 'p', ...props }, spans };
}
const text = (t: string, props: Partial<ParaProps> = {}, fmt: Fmt = {}) => para([run(t, fmt)], props);

function table(header: string[], rows: Span[][][]): TableBlock {
  const row = (cells: Span[][], head = false): TableRow => ({
    id: newId('rr'),
    header: head || undefined,
    cells: cells.map((spans) => ({ blocks: [para(spans)], header: head || undefined })),
  });
  return { id: newId('rt'), type: 'table', rows: [row(header.map((h) => [run(h, { b: true })]), true), ...rows.map((r) => row(r))] };
}

/** One side of a changed paragraph, with the words that changed marked as removed (A) or added (B). */
function markedSide(p: ParaBlock, t: Tokenized, changed: ReadonlySet<number>, rev: 'ins' | 'del'): Span[] {
  const out: Span[] = [];
  t.tokens.forEach((tok, k) => {
    const mark = changed.has(k);
    for (const piece of tok.pieces) {
      const s = p.spans[piece.span];
      if (!s || s.marker) continue;
      const slice = s.obj ? (s.obj.text ?? `[${s.obj.label}]`) : s.text.slice(piece.start, piece.end);
      if (!slice) continue;
      const fmt: Fmt = { b: s.fmt.b, i: s.fmt.i, sup: s.fmt.sup, sub: s.fmt.sub, ...(mark ? { rev } : {}) };
      const prev = out[out.length - 1];
      if (prev && prev.fmt.rev === fmt.rev && !!prev.fmt.b === !!fmt.b && !!prev.fmt.i === !!fmt.i) prev.text += slice;
      else out.push({ text: slice, fmt });
    }
  });
  return out;
}

function label(t: string): Span {
  return run(`${t}  `, { b: true });
}

/** A row of a change: its paragraphs before and after. */
function rowBlocks(row: Row, cmp: Comparison): Block[] {
  const { l, r } = row;
  if (row.kind === 'mod' && l?.type === 'p' && r?.type === 'p') {
    const d = inlineDiff(l, r, cmp.opts);
    const a = new Set<number>();
    const b = new Set<number>();
    for (const seg of d.segs) {
      if (seg.eq || d.changes[seg.change]!.fmtOnly) continue;
      for (let k = seg.a0; k < seg.a1; k++) a.add(d.a.comp[k]!);
      for (let k = seg.b0; k < seg.b1; k++) b.add(d.b.comp[k]!);
    }
    const out: Block[] = [para([label('A'), ...markedSide(l, d.a, a, 'del')], { role: 'quote' }), para([label('B'), ...markedSide(r, d.b, b, 'ins')], { role: 'quote' })];
    if (!a.size && !b.size) out.push(text('Same words, different formatting.', {}, { i: true }));
    return out;
  }
  if (row.kind === 'table' && row.table) {
    const out: Block[] = [];
    for (const sr of row.table.rows) {
      if (sr.kind === 'eq') continue;
      const rowText = (tr: TableRow | undefined) => (tr ? tr.cells.map((c) => c.blocks.map(blockText).join(' ')).join(' | ') : '');
      if (sr.l) out.push(para([label('A'), run(rowText(sr.l), { rev: sr.kind === 'mod' || sr.kind === 'del' ? 'del' : undefined })], { role: 'quote' }));
      if (sr.r) out.push(para([label('B'), run(rowText(sr.r), { rev: sr.kind === 'mod' || sr.kind === 'ins' ? 'ins' : undefined })], { role: 'quote' }));
    }
    return out;
  }
  const out: Block[] = [];
  if (l) out.push(para([label(r ? 'A' : 'Only in A'), run(blockText(l), { rev: 'del' })], { role: 'quote' }));
  if (r) out.push(para([label(l ? 'B' : 'Only in B'), run(blockText(r), { rev: 'ins' })], { role: 'quote' }));
  return out;
}

/* --------------------------------------------------------------- report */

function infoByChange(placed: readonly Placed[]): { byHunk: Map<number, ChangeInfo>; loose: ChangeInfo['notes'] } {
  const byHunk = new Map<number, ChangeInfo>();
  const loose: ChangeInfo['notes'] = [];
  const at = (h: number) => {
    let i = byHunk.get(h);
    if (!i) byHunk.set(h, (i = { reactions: [], notes: [] }));
    return i;
  };
  for (const p of placed) {
    const m = p.mark;
    if (!p.found) continue;
    if (m.kind === 'status' && p.hunk >= 0) at(p.hunk).decision = m.status;
    else if (m.kind === 'reaction' && p.hunk >= 0) at(p.hunk).reactions.push(m.reaction);
    else if (m.kind === 'note') {
      const note = { text: m.text, quote: m.target.type === 'text' ? m.target.quote : undefined, date: m.updated ?? m.created, author: m.author };
      if (p.hunk >= 0) at(p.hunk).notes.push(note);
      else loose.push(note);
    }
  }
  for (const i of byHunk.values()) i.reactions.sort((x, y) => REACTIONS.indexOf(x) - REACTIONS.indexOf(y));
  return { byHunk, loose };
}

const day = (t: number | Date) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function noteBlocks(notes: ChangeInfo['notes']): Block[] {
  const out: Block[] = [];
  for (const n of notes) {
    const spans = [run(`${n.author ? `${n.author}, ` : ''}${day(n.date)}  `, { i: true })];
    if (n.quote) spans.push(run(`on “${clip(n.quote, 80)}”`, { i: true }));
    out.push(para(spans));
    for (const line of n.text.split('\n')) out.push(text(line, { role: 'quote' }));
  }
  return out;
}

/** The report, as a document. */
export function buildReport(cmp: Comparison, placed: readonly Placed[], names: ReportNames, opts: ReportOptions = {}): Doc {
  const { byHunk, loose } = infoByChange(placed);
  const risks = changeRisks(cmp);
  // A change that is a moved paragraph (either end) is named for it.
  const moved = new Map<number, string>();
  for (const m of findMoves(cmp)) {
    moved.set(m.fromHunk, `Moved (to change ${m.toHunk + 1})`);
    moved.set(m.toHunk, `Moved (from change ${m.fromHunk + 1})`);
  }
  const kindOf = (h: number, kind: keyof typeof KIND_LABEL) => ((kind === 'del' || kind === 'ins') && moved.get(h)) || KIND_LABEL[kind];
  const all = cmp.hunks.map((_, h) => h);
  const shown = all.filter((h) => {
    const i = byHunk.get(h);
    if (opts.openOnly && i?.decision) return false;
    if (opts.notedOnly && !(i && (i.notes.length || i.reactions.length))) return false;
    return true;
  });
  const decided = DECISIONS.map((d) => [d, all.filter((h) => byHunk.get(h)?.decision === d).length] as const);
  const open = all.length - decided.reduce((n, [, k]) => n + k, 0);
  const s = cmp.stats;

  const blocks: Block[] = [
    text('Comparison report', { role: 'title' }),
    para([run(cmp.left.name, { b: true }), run('  →  '), run(cmp.right.name, { b: true })], { role: 'subtitle' }),
    text(`${day(opts.date ?? new Date())}${opts.reviewer?.trim() ? `, reviewed by ${opts.reviewer.trim()}` : ''}.`),
    text(
      `${all.length} ${all.length === 1 ? 'change' : 'changes'}: ${s.changed} changed, ${s.added} added and ${s.removed} removed paragraphs. ` +
        `${decided.map(([d, k]) => `${k} ${names.decision[d].toLowerCase()}`).join(', ')}, ${open} open.`,
    ),
  ];
  if (opts.openOnly || opts.notedOnly)
    blocks.push(text(`This report lists ${shown.length} of them: ${[opts.openOnly && 'the open ones', opts.notedOnly && 'those with notes or reactions'].filter(Boolean).join(' and ')}.`, {}, { i: true }));

  if (opts.summary?.length) {
    blocks.push(text('What matters', { role: 'h', level: 1 }));
    for (const line of opts.summary) blocks.push(text(line, { list: { ordered: false, level: 0, key: 'summary' } }));
  }

  if (shown.length) {
    blocks.push(text('Changes at a glance', { role: 'h', level: 1 }));
    blocks.push(
      table(
        ['#', 'Kind', 'Decision', 'Flags', 'Reactions', 'Notes', 'What changed'],
        shown.map((h) => {
          const sum = summarizeChange(cmp, h);
          const i = byHunk.get(h);
          const e = sum.edits[0];
          const what = e ? [e.a?.text && `−${clip(e.a.text, 40)}`, e.b?.text && `+${clip(e.b.text, 40)}`, e.note].filter(Boolean).join('  ') : '';
          return [
            [run(String(h + 1))],
            [run(kindOf(h, sum.kind))],
            [run(i?.decision ? names.decision[i.decision] : 'Open')],
            [run(risks[h]!.map((r) => RISK_NAME[r]).join(', '))],
            [run(i?.reactions.map((r) => names.reaction[r]).join(', ') ?? '')],
            [run(i?.notes.length ? String(i.notes.length) : '')],
            [run(what)],
          ];
        }),
      ),
    );

    blocks.push(text('The changes', { role: 'h', level: 1 }));
    for (const h of shown) {
      const sum = summarizeChange(cmp, h);
      const i = byHunk.get(h);
      blocks.push(text(`Change ${h + 1}: ${kindOf(h, sum.kind)}`, { role: 'h', level: 2 }));
      const facts = [i?.decision ? names.decision[i.decision] : 'Open', ...(i?.reactions.map((r) => names.reaction[r]) ?? []), ...risks[h]!.map((r) => RISK_NAME[r])];
      blocks.push(text(facts.join(' · '), {}, { b: true }));
      const hunk = cmp.hunks[h]!;
      const before = opts.context ? cmp.rows[hunk.start - 1] : undefined;
      const after = opts.context ? cmp.rows[hunk.end] : undefined;
      if (before?.r) blocks.push(text(`…${clip(blockText(before.r), 160)}`, { role: 'caption' }));
      for (const row of cmp.rows.slice(hunk.start, hunk.end)) blocks.push(...rowBlocks(row, cmp));
      if (after?.r) blocks.push(text(`${clip(blockText(after.r), 160)}…`, { role: 'caption' }));
      if (i?.notes.length) {
        blocks.push(text('Notes', { role: 'h', level: 3 }));
        blocks.push(...noteBlocks(i.notes));
      }
    }
  } else blocks.push(text(all.length ? 'No changes match the report’s options.' : 'The documents are the same.', {}, { i: true }));

  if (loose.length && !opts.openOnly) {
    blocks.push(text('Other notes', { role: 'h', level: 1 }));
    blocks.push(...noteBlocks(loose));
  }
  const base = cmp.right.name.replace(/\.[^.]+$/, '');
  return { id: newId('report'), name: `${base} (report)`, kind: 'html', blocks, version: 0 };
}
