/**
 * What kind of thing a change touches, told from its changed words alone:
 * amounts, dates and periods, obligations, parties, defined terms, and text
 * removed outright. Worked out in the browser for every change (no Claude
 * needed), to point a reviewer at the changes that tend to matter.
 */
import type { Comparison, Row } from '../core/compare';
import { inlineDiff } from '../core/compare';
import type { Move } from '../core/moves';
import { movesByRow } from '../core/moves';
import type { TableRow } from '../core/model';
import { blockText } from '../core/model';
import type { Tokenized } from '../core/tokens';

export type RiskKind = 'amount' | 'date' | 'obligation' | 'party' | 'definition' | 'removed';
export const RISK_KINDS: readonly RiskKind[] = ['amount', 'date', 'obligation', 'party', 'definition', 'removed'];

export const RISK_NAME: Record<RiskKind, string> = {
  amount: 'Amount',
  date: 'Date or period',
  obligation: 'Obligation',
  party: 'Party',
  definition: 'Defined term',
  removed: 'Text removed',
};

/** The words a change removed and added. */
export interface ChangedWords {
  removed: string;
  added: string;
  /** Whole paragraphs taken out (not replaced). */
  dropped: number;
  /** A few words either side of the changed ones ("30" → "45" is a date in "30 days"). */
  around?: string;
}

/** Words of context either side of a change. */
const AROUND = 3;

const tokensText = (t: Tokenized, c0: number, c1: number) => {
  let s = '';
  for (let k = c0; k < c1; k++) s += t.tokens[t.comp[k]!]!.text;
  return s;
};
const rowText = (r: TableRow | undefined) => (r ? r.cells.map((c) => c.blocks.map(blockText).join(' ')).join(' ') : '');

function rowWords(row: Row, cmp: Comparison, acc: ChangedWords, moved: ReadonlyMap<string, Move>): void {
  const { l, r } = row;
  // A paragraph moved as it was: none of its words changed.
  if (moved.get(row.key)?.exact) return;
  if (row.kind === 'mod' && l?.type === 'p' && r?.type === 'p') {
    const d = inlineDiff(l, r, cmp.opts);
    for (const seg of d.segs) {
      if (seg.eq || d.changes[seg.change]!.fmtOnly) continue;
      acc.removed += ` ${tokensText(d.a, seg.a0, seg.a1)}`;
      acc.added += ` ${tokensText(d.b, seg.b0, seg.b1)}`;
      const n = d.b.comp.length;
      // Tokens alternate words and spaces: twice the words.
      acc.around = `${acc.around ?? ''} ${tokensText(d.b, Math.max(0, seg.b0 - AROUND * 2), seg.b0)} ${tokensText(d.b, seg.b1, Math.min(n, seg.b1 + AROUND * 2))}`;
    }
  } else if (row.kind === 'table' && row.table) {
    for (const sr of row.table.rows) {
      if (sr.kind === 'eq') continue;
      acc.removed += ` ${rowText(sr.l)}`;
      acc.added += ` ${rowText(sr.r)}`;
    }
  } else {
    if (l) acc.removed += ` ${blockText(l)}`;
    if (r) acc.added += ` ${blockText(r)}`;
    // A paragraph moved elsewhere is not gone.
    if (l && !r && blockText(l).trim() && !moved.has(row.key)) acc.dropped++;
  }
}

/** The words each change removed and added. */
export function changedWords(cmp: Comparison, hunk: number): ChangedWords {
  const h = cmp.hunks[hunk]!;
  const acc: ChangedWords = { removed: '', added: '', dropped: 0 };
  const moved = movesByRow(cmp);
  for (const row of cmp.rows.slice(h.start, h.end)) rowWords(row, cmp, acc, moved);
  acc.removed = acc.removed.trim();
  acc.added = acc.added.trim();
  return acc;
}

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const TESTS: Array<[RiskKind, RegExp]> = [
  ['amount', /[$€£¥₹]\s?\d|\d\s?(?:%|percent\b|per cent\b)|\b\d[\d,]*(?:\.\d+)?\s?(?:usd|eur|gbp|dollars?|euros?|pounds?|k|m|million|billion)\b|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/iu],
  [
    'date',
    new RegExp(
      `\\b(?:${MONTHS})\\b\\.?\\s*\\d|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\b|\\b\\d{1,4}[/.-]\\d{1,2}[/.-]\\d{2,4}\\b|\\b(?:19|20)\\d{2}\\b|\\b\\d+\\s*(?:business\\s+|working\\s+|calendar\\s+)?(?:days?|weeks?|months?|years?|hours?)\\b|\\b(?:annual(?:ly)?|monthly|quarterly|weekly|daily)\\b`,
      'iu',
    ),
  ],
  ['obligation', /\b(?:shall|must|will not|may not|required|obliged|obligat\w*|liab\w*|indemnif\w*|warrant\w*|guarantee\w*|terminat\w*|penalt\w*|breach\w*|responsible|agrees? to)\b/iu],
  ['party', /\b(?:party|parties|client|customer|contractor|supplier|vendor|licensee|licensor|buyer|seller|landlord|tenant|employer|employee|company)\b|\b(?:inc|ltd|llc|llp|gmbh|plc|corp)\b\.?/iu],
  ['definition', /[“"][\p{Lu}][^”"]{1,60}[”"]|\bmeans\b|\bdefined as\b|\bshall mean\b|\bhereinafter\b/iu],
];

/** What a change touches (in the order of RISK_KINDS). */
export function risksOf(w: ChangedWords): RiskKind[] {
  const both = `${w.removed}\n${w.added}`;
  const out = new Set<RiskKind>();
  for (const [kind, re] of TESTS) {
    // A changed number is an amount or a date by the words around it; other kinds, by the changed words alone.
    const unit = (kind === 'amount' || kind === 'date') && /\d/.test(both);
    if (re.test(both) || (unit && contextFits(kind, w))) out.add(kind);
  }
  if (w.dropped) out.add('removed');
  return RISK_KINDS.filter((k) => out.has(k));
}

/** A unit or currency in the words around a changed number, next to where the number was. */
function contextFits(kind: RiskKind, w: ChangedWords): boolean {
  const around = w.around ?? '';
  if (kind === 'amount') return /[$€£¥₹%]|\b(?:percent|per cent|usd|eur|gbp|dollars?|euros?|pounds?)\b/iu.test(around);
  return new RegExp(`\\b(?:days?|weeks?|months?|years?|hours?|${MONTHS})\\b`, 'iu').test(around);
}

/** What each change touches. */
export function changeRisks(cmp: Comparison): RiskKind[][] {
  return cmp.hunks.map((_, h) => risksOf(changedWords(cmp, h)));
}
