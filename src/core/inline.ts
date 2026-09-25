import type { ParaBlock, Span } from './model';
import { Interner, diffSequences, toRegions } from './myers';
import type { CompareOptions, Tokenized } from './tokens';
import { tokenizePara, tokenizeSpans } from './tokens';

/**
 * One word-level change inside a pair of paragraphs, as ranges of
 * *comparable* token indices (see Tokenized.comp) on each side.
 */
export interface InlineChange {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
  /** Same text, different formatting. */
  fmtOnly: boolean;
}

export interface InlineSeg {
  eq: boolean;
  a0: number;
  a1: number;
  b0: number;
  b1: number;
  /** Index into `changes` for change segments. */
  change: number;
}

export interface InlineDiff {
  a: Tokenized;
  b: Tokenized;
  segs: InlineSeg[];
  changes: InlineChange[];
}

export function diffParagraphs(pa: ParaBlock, pb: ParaBlock, o: CompareOptions): InlineDiff {
  return diffTokenized(tokenizePara(pa, o), tokenizePara(pb, o));
}

export function diffSpanLists(sa: readonly Span[], sb: readonly Span[], o: CompareOptions): InlineDiff {
  return diffTokenized(tokenizeSpans(sa, o), tokenizeSpans(sb, o));
}

const INLINE_BUDGET_MS = 250;

export function diffTokenized(a: Tokenized, b: Tokenized): InlineDiff {
  const interner = new Interner();
  const ka = interner.ids(a.comp.map((k) => a.tokens[k]!.key));
  const kb = interner.ids(b.comp.map((k) => b.tokens[k]!.key));
  const runs = diffSequences(ka, kb, Date.now() + INLINE_BUDGET_MS);
  let regions = toRegions(runs);
  regions = cleanupSemantic(regions, a, b);

  const segs: InlineSeg[] = [];
  const changes: InlineChange[] = [];
  for (const r of regions) {
    if (r.eq) {
      segs.push({ ...r, change: -1 });
      continue;
    }
    const fmtOnly = rangeContent(a, r.a0, r.a1) === rangeContent(b, r.b0, r.b1);
    changes.push({ a0: r.a0, a1: r.a1, b0: r.b0, b1: r.b1, fmtOnly });
    segs.push({ ...r, change: changes.length - 1 });
  }
  return { a, b, segs, changes };
}

/** Content of a token range without formatting (objects count by identity, e.g. footnote text). */
function rangeContent(t: Tokenized, c0: number, c1: number): string {
  let s = '';
  for (let k = c0; k < c1; k++) s += t.tokens[t.comp[k]!]!.key.split('\u0000')[0] + '\u0001';
  return s;
}

function rangeLen(t: Tokenized, c0: number, c1: number): number {
  let n = 0;
  for (let k = c0; k < c1; k++) n += t.tokens[t.comp[k]!]!.text.length;
  return n;
}

function rangeIsWhitespace(t: Tokenized, c0: number, c1: number): boolean {
  for (let k = c0; k < c1; k++) if (!t.tokens[t.comp[k]!]!.ws) return false;
  return true;
}

interface Reg {
  eq: boolean;
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

/**
 * Folds short equalities that sit between two changes into a single change,
 * so a rewritten phrase reads as one edit instead of a confetti of small ones.
 * This is diff-match-patch's semantic cleanup rule applied at token level:
 * an equality is removed when it is no longer than the edits on both sides,
 * and whitespace-only equalities between edits are always removed.
 */
export function cleanupSemantic(regions: Reg[], a: Tokenized, b: Tokenized): Reg[] {
  let regs = regions.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i + 1 < regs.length; i++) {
      const prev = regs[i - 1]!;
      const eq = regs[i]!;
      const next = regs[i + 1]!;
      if (!eq.eq || prev.eq || next.eq) continue;
      const eqLen = rangeLen(a, eq.a0, eq.a1);
      const before = Math.max(rangeLen(a, prev.a0, prev.a1), rangeLen(b, prev.b0, prev.b1));
      const after = Math.max(rangeLen(a, next.a0, next.a1), rangeLen(b, next.b0, next.b1));
      if (rangeIsWhitespace(a, eq.a0, eq.a1) || (eqLen <= before && eqLen <= after)) {
        const merged: Reg = { eq: false, a0: prev.a0, a1: next.a1, b0: prev.b0, b1: next.b1 };
        regs = [...regs.slice(0, i - 1), merged, ...regs.slice(i + 2)];
        changed = true;
        break;
      }
    }
  }
  return regs;
}

/** Full-token index range [start, end) covered by comparable range [c0, c1). */
export function fullRange(t: Tokenized, c0: number, c1: number): [number, number] {
  if (c1 > c0) return [t.comp[c0]!, t.comp[c1 - 1]! + 1];
  // Empty range: position before comparable token c0 (or after the last one).
  if (c0 < t.comp.length) return [t.comp[c0]!, t.comp[c0]!];
  if (t.comp.length) {
    const p = t.comp[t.comp.length - 1]! + 1;
    return [p, p];
  }
  // No comparable tokens at all: after any leading whitespace.
  return [t.tokens.length, t.tokens.length];
}
