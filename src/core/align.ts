/**
 * Pairs up items inside a change region so that edited paragraphs line up
 * side by side instead of showing as "removed" + "added".
 *
 * A monotonic alignment (no crossings) maximising total similarity is found
 * with dynamic programming; pairs below the threshold are not allowed. Gaps
 * between chosen pairs that hold the same number of items on both sides are
 * then paired positionally (a rewritten stretch reads best line by line).
 */

export type AlignStep = { l: number; r: number } | { l: number; r: -1 } | { l: -1; r: number };

export const PAIR_THRESHOLD = 0.4;
const DP_LIMIT = 250_000;

export function alignRegion(
  nl: number,
  nr: number,
  sim: (l: number, r: number) => number,
  compatible: (l: number, r: number) => boolean,
): AlignStep[] {
  const pairs: Array<[number, number]> = [];
  if (nl > 0 && nr > 0 && nl * nr <= DP_LIMIT) {
    // score[i][j]: best total similarity aligning first i left and j right items.
    const w = nr + 1;
    const score = new Float64Array((nl + 1) * w);
    const move = new Uint8Array((nl + 1) * w); // 1 = skip left, 2 = skip right, 3 = pair
    for (let i = 1; i <= nl; i++) move[i * w] = 1;
    for (let j = 1; j <= nr; j++) move[j] = 2;
    for (let i = 1; i <= nl; i++) {
      for (let j = 1; j <= nr; j++) {
        let best = score[(i - 1) * w + j]!;
        let mv = 1;
        const skipR = score[i * w + j - 1]!;
        if (skipR > best) {
          best = skipR;
          mv = 2;
        }
        if (compatible(i - 1, j - 1)) {
          const s = sim(i - 1, j - 1);
          if (s >= PAIR_THRESHOLD) {
            const pv = score[(i - 1) * w + j - 1]! + s;
            if (pv > best) {
              best = pv;
              mv = 3;
            }
          }
        }
        score[i * w + j] = best;
        move[i * w + j] = mv;
      }
    }
    let i = nl;
    let j = nr;
    while (i > 0 || j > 0) {
      const mv = move[i * w + j];
      if (mv === 3) {
        pairs.push([i - 1, j - 1]);
        i--;
        j--;
      } else if (mv === 1) i--;
      else j--;
    }
    pairs.reverse();
  }

  const out: AlignStep[] = [];
  let li = 0;
  let ri = 0;
  const flushGap = (lEnd: number, rEnd: number) => {
    const nL = lEnd - li;
    const nR = rEnd - ri;
    if (nL === nR) {
      for (let k = 0; k < nL; k++) {
        if (compatible(li + k, ri + k)) out.push({ l: li + k, r: ri + k });
        else {
          out.push({ l: li + k, r: -1 });
          out.push({ l: -1, r: ri + k });
        }
      }
    } else {
      for (let k = li; k < lEnd; k++) out.push({ l: k, r: -1 });
      for (let k = ri; k < rEnd; k++) out.push({ l: -1, r: k });
    }
    li = lEnd;
    ri = rEnd;
  };
  for (const [pl, pr] of pairs) {
    flushGap(pl, pr);
    out.push({ l: pl, r: pr });
    li = pl + 1;
    ri = pr + 1;
  }
  flushGap(nl, nr);
  return out;
}
