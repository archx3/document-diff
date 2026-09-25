/**
 * Linear-space Myers difference algorithm (the "middle snake" bisection used by
 * GNU diff and diff-match-patch), over sequences of interned integers.
 *
 * Output is a list of runs: [op, count] where op is EQ, DEL (only in `a`) or
 * INS (only in `b`). Runs of the same op are merged. The edit script is
 * minimal unless the optional deadline expires, in which case the unresolved
 * middle part degrades to "delete everything, insert everything".
 */

export const EQ = 0;
export const DEL = 1;
export const INS = 2;
export type OpCode = typeof EQ | typeof DEL | typeof INS;
export type Run = [op: OpCode, count: number];

export function diffSequences(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  deadline: number = Number.POSITIVE_INFINITY,
): Run[] {
  const out: Run[] = [];
  diffRange(a, 0, a.length, b, 0, b.length, out, deadline);
  return out;
}

function push(out: Run[], op: OpCode, n: number): void {
  if (n <= 0) return;
  const last = out[out.length - 1];
  if (last && last[0] === op) last[1] += n;
  else out.push([op, n]);
}

function diffRange(
  a: ArrayLike<number>,
  aLo: number,
  aHi: number,
  b: ArrayLike<number>,
  bLo: number,
  bHi: number,
  out: Run[],
  deadline: number,
): void {
  let pre = 0;
  while (aLo + pre < aHi && bLo + pre < bHi && a[aLo + pre] === b[bLo + pre]) pre++;
  let suf = 0;
  while (aHi - suf > aLo + pre && bHi - suf > bLo + pre && a[aHi - 1 - suf] === b[bHi - 1 - suf]) suf++;

  push(out, EQ, pre);
  const a0 = aLo + pre;
  const a1 = aHi - suf;
  const b0 = bLo + pre;
  const b1 = bHi - suf;
  if (a0 === a1) push(out, INS, b1 - b0);
  else if (b0 === b1) push(out, DEL, a1 - a0);
  else bisect(a, a0, a1, b, b0, b1, out, deadline);
  push(out, EQ, suf);
}

function bisect(
  a: ArrayLike<number>,
  a0: number,
  a1: number,
  b: ArrayLike<number>,
  b0: number,
  b1: number,
  out: Run[],
  deadline: number,
): void {
  const n = a1 - a0;
  const m = b1 - b0;
  const maxD = Math.ceil((n + m) / 2);
  const vOffset = maxD;
  const vLength = 2 * maxD;
  const v1 = new Int32Array(vLength).fill(-1);
  const v2 = new Int32Array(vLength).fill(-1);
  v1[vOffset + 1] = 0;
  v2[vOffset + 1] = 0;
  const delta = n - m;
  // With an odd delta the forward path collides with the reverse path.
  const front = delta % 2 !== 0;
  let k1start = 0;
  let k1end = 0;
  let k2start = 0;
  let k2end = 0;
  const timed = deadline !== Number.POSITIVE_INFINITY;

  for (let d = 0; d < maxD; d++) {
    if (timed && (d & 31) === 0 && Date.now() > deadline) break;

    // Walk the front path one step.
    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const k1Offset = vOffset + k1;
      let x1: number;
      if (k1 === -d || (k1 !== d && v1[k1Offset - 1]! < v1[k1Offset + 1]!)) x1 = v1[k1Offset + 1]!;
      else x1 = v1[k1Offset - 1]! + 1;
      let y1 = x1 - k1;
      while (x1 < n && y1 < m && a[a0 + x1] === b[b0 + y1]) {
        x1++;
        y1++;
      }
      v1[k1Offset] = x1;
      if (x1 > n) {
        k1end += 2; // ran off the right of the graph
      } else if (y1 > m) {
        k1start += 2; // ran off the bottom of the graph
      } else if (front) {
        const k2Offset = vOffset + delta - k1;
        if (k2Offset >= 0 && k2Offset < vLength && v2[k2Offset] !== -1) {
          const x2 = n - v2[k2Offset]!;
          if (x1 >= x2) {
            split(a, a0, a1, b, b0, b1, x1, y1, out, deadline);
            return;
          }
        }
      }
    }

    // Walk the reverse path one step.
    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const k2Offset = vOffset + k2;
      let x2: number;
      if (k2 === -d || (k2 !== d && v2[k2Offset - 1]! < v2[k2Offset + 1]!)) x2 = v2[k2Offset + 1]!;
      else x2 = v2[k2Offset - 1]! + 1;
      let y2 = x2 - k2;
      while (x2 < n && y2 < m && a[a1 - x2 - 1] === b[b1 - y2 - 1]) {
        x2++;
        y2++;
      }
      v2[k2Offset] = x2;
      if (x2 > n) {
        k2end += 2;
      } else if (y2 > m) {
        k2start += 2;
      } else if (!front) {
        const k1Offset = vOffset + delta - k2;
        if (k1Offset >= 0 && k1Offset < vLength && v1[k1Offset] !== -1) {
          const x1 = v1[k1Offset]!;
          const y1 = vOffset + x1 - k1Offset;
          if (x1 >= n - x2) {
            split(a, a0, a1, b, b0, b1, x1, y1, out, deadline);
            return;
          }
        }
      }
    }
  }

  // Deadline hit (or, in theory, no overlap): give up on this region.
  push(out, DEL, n);
  push(out, INS, m);
}

function split(
  a: ArrayLike<number>,
  a0: number,
  a1: number,
  b: ArrayLike<number>,
  b0: number,
  b1: number,
  x: number,
  y: number,
  out: Run[],
  deadline: number,
): void {
  diffRange(a, a0, a0 + x, b, b0, b0 + y, out, deadline);
  diffRange(a, a0 + x, a1, b, b0 + y, b1, out, deadline);
}

/** Maps strings to small integers so sequences can be compared with ===. */
export class Interner {
  private map = new Map<string, number>();
  id(key: string): number {
    let v = this.map.get(key);
    if (v === undefined) {
      v = this.map.size;
      this.map.set(key, v);
    }
    return v;
  }
  ids(keys: readonly string[]): Int32Array {
    const out = new Int32Array(keys.length);
    for (let i = 0; i < keys.length; i++) out[i] = this.id(keys[i]!);
    return out;
  }
}

/**
 * Groups runs into alternating equal / change regions, each described by
 * index ranges into both sequences.
 */
export interface Region {
  eq: boolean;
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

export function toRegions(runs: Run[]): Region[] {
  const out: Region[] = [];
  let ai = 0;
  let bi = 0;
  for (const [op, n] of runs) {
    if (op === EQ) {
      out.push({ eq: true, a0: ai, a1: ai + n, b0: bi, b1: bi + n });
      ai += n;
      bi += n;
      continue;
    }
    let last = out[out.length - 1];
    if (!last || last.eq) {
      last = { eq: false, a0: ai, a1: ai, b0: bi, b1: bi };
      out.push(last);
    }
    if (op === DEL) {
      ai += n;
      last.a1 = ai;
    } else {
      bi += n;
      last.b1 = bi;
    }
  }
  return out;
}
