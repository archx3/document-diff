/**
 * Moved paragraphs: a paragraph that is only in A in one place and only in B
 * in another is a move when its text is the same (or, for a longer one,
 * nearly the same). The comparison still has them as a removal and an
 * addition; moves link the two, so they can be shown, and written to a
 * redline, as one moved paragraph.
 */
import type { Comparison, Row } from './compare';
import { isBlank } from './model';
import { bagSimilarity, blockSig, wordBag } from './tokens';

export interface Move {
  /** The row where the paragraph was (only in A), and where it went (only in B). */
  from: string;
  to: string;
  fromHunk: number;
  toHunk: number;
  /** The same text; otherwise moved and changed a little. */
  exact: boolean;
}

/** How alike a paragraph must be to count as moved and changed, and how long. */
const SIMILAR = 0.8;
const MIN_WORDS = 5;
/** Pairs of paragraphs compared for near matches, at most. */
const MAX_PAIRS = 250_000;

const cache = new WeakMap<Comparison, Move[]>();

/** The moved paragraphs of a comparison. */
export function findMoves(cmp: Comparison): Move[] {
  const hit = cache.get(cmp);
  if (hit) return hit;
  const dels = cmp.rows.filter((r): r is Row & { l: NonNullable<Row['l']> } => r.kind === 'del' && !!r.l && r.l.type !== 'marker' && !isBlank(r.l));
  const inss = cmp.rows.filter((r): r is Row & { r: NonNullable<Row['r']> } => r.kind === 'ins' && !!r.r && r.r.type !== 'marker' && !isBlank(r.r));
  const out: Move[] = [];
  const taken = new Set<string>();
  const order = new Map(cmp.rows.map((r, i) => [r.key, i]));
  const push = (d: Row, i: Row, exact: boolean) => {
    taken.add(d.key).add(i.key);
    out.push({ from: d.key, to: i.key, fromHunk: d.hunk, toHunk: i.hunk, exact });
  };

  // The same text: the nearest one.
  const bySig = new Map<string, Row[]>();
  for (const i of inss) {
    const sig = blockSig(i.r, cmp.opts);
    bySig.set(sig, [...(bySig.get(sig) ?? []), i]);
  }
  for (const d of dels) {
    const list = bySig.get(blockSig(d.l, cmp.opts))?.filter((i) => !taken.has(i.key));
    if (!list?.length) continue;
    const at = order.get(d.key)!;
    list.sort((x, y) => Math.abs(order.get(x.key)! - at) - Math.abs(order.get(y.key)! - at));
    push(d, list[0]!, true);
  }

  // Nearly the same, for paragraphs long enough to tell.
  const leftD = dels.filter((d) => !taken.has(d.key));
  const leftI = inss.filter((i) => !taken.has(i.key));
  if (leftD.length * leftI.length <= MAX_PAIRS) {
    const bags = new Map<Row, Map<string, number>>();
    const bag = (r: Row, side: 'l' | 'r') => {
      let b = bags.get(r);
      if (!b) bags.set(r, (b = wordBag(r[side]!, cmp.opts)));
      return b;
    };
    const words = (b: Map<string, number>) => [...b.values()].reduce((n, k) => n + k, 0);
    const pairs: Array<{ d: Row; i: Row; s: number }> = [];
    for (const d of leftD) {
      const bd = bag(d, 'l');
      if (words(bd) < MIN_WORDS) continue;
      for (const i of leftI) {
        if (d.l!.type !== i.r!.type) continue;
        const bi = bag(i, 'r');
        if (words(bi) < MIN_WORDS) continue;
        const s = bagSimilarity(bd, bi);
        if (s >= SIMILAR) pairs.push({ d, i, s });
      }
    }
    pairs.sort((x, y) => y.s - x.s);
    for (const p of pairs) if (!taken.has(p.d.key) && !taken.has(p.i.key)) push(p.d, p.i, false);
  }

  // A move within one change is just a change: only moves between changes count.
  const moves = out.filter((m) => m.fromHunk !== m.toHunk).sort((x, y) => order.get(x.from)! - order.get(y.from)!);
  cache.set(cmp, moves);
  return moves;
}

/** Each moved row's move, by row key (both ends). */
export function movesByRow(cmp: Comparison): Map<string, Move> {
  const m = new Map<string, Move>();
  for (const mv of findMoves(cmp)) m.set(mv.from, mv).set(mv.to, mv);
  return m;
}
