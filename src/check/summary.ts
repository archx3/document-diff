/**
 * A summary of what matters in the changes, from Claude (where the page can
 * ask it, and only when the reader asks): a short list of the substantive
 * changes in plain words, each pointing at its changes, with formatting-only
 * changes left out. Only the changed words and a little around them are sent.
 */
import type { Comparison } from '../core/compare';
import { findMoves } from '../core/moves';
import { blockText } from '../core/model';
import { changedWords } from '../review/risk';
import type { Sampler } from './claude';

export interface SummaryPoint {
  text: string;
  /** The changes it is about (0-based). */
  changes: number[];
}

/** Characters of changes in one request. */
const BATCH_CHARS = 24_000;
/** Characters of one side of one change. */
const SIDE_CHARS = 700;
const MAX_POINTS = 10;

interface ChangeText {
  n: number;
  removed: string;
  added: string;
  /** A paragraph moved (unchanged) from or to another change. */
  moved?: string;
}

const clip = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > SIDE_CHARS ? `${t.slice(0, SIDE_CHARS)}…` : t;
};

/** The changes whose words changed (not only their formatting), as text to send. */
export function changeTexts(cmp: Comparison): ChangeText[] {
  const out: ChangeText[] = [];
  const moved = new Map<number, string>();
  for (const m of findMoves(cmp)) {
    if (!m.exact) continue;
    const row = cmp.rows.find((r) => r.key === m.from);
    const text = clip(row?.l ? blockText(row.l) : '');
    moved.set(m.fromHunk, `${text} (moved to change ${m.toHunk + 1})`);
    moved.set(m.toHunk, `${text} (moved here from change ${m.fromHunk + 1})`);
  }
  cmp.hunks.forEach((_, h) => {
    const w = changedWords(cmp, h);
    if (!w.removed && !w.added && !moved.has(h)) return;
    out.push({ n: h + 1, removed: clip(w.removed), added: clip(w.added), moved: moved.get(h) });
  });
  return out;
}

function batchesOf(list: readonly ChangeText[]): ChangeText[][] {
  const out: ChangeText[][] = [];
  let cur: ChangeText[] = [];
  let size = 0;
  for (const c of list) {
    const n = c.removed.length + c.added.length + (c.moved?.length ?? 0) + 40;
    if (cur.length && size + n > BATCH_CHARS) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(c);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function summaryPrompt(a: string, b: string, changes: readonly ChangeText[]): string {
  return [
    `Two versions of a document are compared: A ("${a}") and B ("${b}"). Below are the numbered changes from A to B, with the words removed and added.`,
    `Summarise what matters for someone reviewing B: at most ${MAX_POINTS} short points in plain words, most important first.`,
    'Say what actually changed (amounts, dates, obligations, parties, rights, scope) and leave out changes of wording or formatting that do not change the meaning.',
    'Do not give advice or opinions. Group related changes into one point.',
    'Reply with only a JSON array: [{"text": "<the point, one sentence>", "changes": [<the change numbers it is about>]}]. Reply [] if nothing changes the meaning.',
    '',
    ...changes.map((c) => `Change ${c.n}:${c.removed ? `\n  removed: ${c.removed}` : ''}${c.added ? `\n  added: ${c.added}` : ''}${c.moved ? `\n  moved: ${c.moved}` : ''}`),
  ].join('\n');
}

export function combinePrompt(points: readonly SummaryPoint[]): string {
  return [
    `These points summarise parts of the changes between two versions of a document. Combine them into at most ${MAX_POINTS} points, most important first, merging those about the same thing.`,
    'Reply with only a JSON array: [{"text": "<the point, one sentence>", "changes": [<change numbers>]}].',
    '',
    JSON.stringify(points.map((p) => ({ text: p.text, changes: p.changes.map((c) => c + 1) }))),
  ].join('\n');
}

/** Claude's points, keeping only well-formed ones and changes that exist. */
export function readPoints(reply: unknown, total: number): SummaryPoint[] {
  if (!Array.isArray(reply)) return [];
  const out: SummaryPoint[] = [];
  for (const r of reply as Array<{ text?: unknown; changes?: unknown }>) {
    if (!r || typeof r.text !== 'string' || !r.text.trim()) continue;
    const changes = Array.isArray(r.changes) ? [...new Set(r.changes.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= total).map((n) => n - 1))].sort((x, y) => x - y) : [];
    out.push({ text: r.text.trim(), changes });
  }
  return out.slice(0, MAX_POINTS);
}

/** Asks Claude for the summary (in parts for many changes, then combined). */
export async function summarizeWithClaude(sample: Sampler, cmp: Comparison, signal?: AbortSignal): Promise<SummaryPoint[]> {
  const list = changeTexts(cmp);
  if (!list.length) return [];
  const total = cmp.hunks.length;
  const parts: SummaryPoint[] = [];
  for (const batch of batchesOf(list)) {
    if (signal?.aborted) return [];
    parts.push(...readPoints(await sample.json(summaryPrompt(cmp.left.name, cmp.right.name, batch), { signal, modelTier: 'default' }), total));
  }
  if (parts.length <= MAX_POINTS) return parts;
  return readPoints(await sample.json(combinePrompt(parts), { signal, modelTier: 'default' }), total);
}
