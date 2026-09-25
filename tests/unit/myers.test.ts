import { describe, expect, it } from 'vitest';
import { DEL, EQ, INS, diffSequences, toRegions } from '../../src/core/myers';

function lcsLength(a: number[], b: number[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
  return dp[a.length]![b.length]!;
}

function apply(a: number[], b: number[], runs: ReturnType<typeof diffSequences>) {
  const outA: number[] = [];
  const outB: number[] = [];
  let ai = 0;
  let bi = 0;
  let eq = 0;
  for (const [op, n] of runs) {
    for (let k = 0; k < n; k++) {
      if (op === EQ) {
        expect(a[ai]).toBe(b[bi]);
        outA.push(a[ai++]!);
        outB.push(b[bi++]!);
        eq++;
      } else if (op === DEL) outA.push(a[ai++]!);
      else if (op === INS) outB.push(b[bi++]!);
    }
  }
  return { outA, outB, eq };
}

// Small deterministic PRNG so failures are reproducible.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

describe('diffSequences', () => {
  it('handles empty inputs', () => {
    expect(diffSequences([], [])).toEqual([]);
    expect(diffSequences([1, 2], [])).toEqual([[DEL, 2]]);
    expect(diffSequences([], [1])).toEqual([[INS, 1]]);
  });

  it('finds a simple edit', () => {
    const runs = diffSequences([1, 2, 3, 4], [1, 3, 4, 5]);
    expect(runs).toEqual([
      [EQ, 1],
      [DEL, 1],
      [EQ, 2],
      [INS, 1],
    ]);
  });

  it('produces minimal, valid edit scripts on random input', () => {
    const rand = rng(42);
    for (let t = 0; t < 400; t++) {
      const alphabet = 1 + Math.floor(rand() * 6);
      const la = Math.floor(rand() * 40);
      const lb = Math.floor(rand() * 40);
      const a = Array.from({ length: la }, () => Math.floor(rand() * alphabet));
      const b = Array.from({ length: lb }, () => Math.floor(rand() * alphabet));
      const runs = diffSequences(a, b);
      const { outA, outB, eq } = apply(a, b, runs);
      expect(outA).toEqual(a);
      expect(outB).toEqual(b);
      expect(eq).toBe(lcsLength(a, b));
    }
  });

  it('degrades gracefully when the deadline has passed', () => {
    const a = Array.from({ length: 2000 }, (_, i) => i % 7);
    const b = Array.from({ length: 2000 }, (_, i) => (i * 3) % 11);
    const runs = diffSequences(a, b, Date.now() - 1);
    const { outA, outB } = apply(a, b, runs);
    expect(outA).toEqual(a);
    expect(outB).toEqual(b);
  });

  it('groups runs into regions', () => {
    const regions = toRegions(diffSequences([1, 2, 3, 9], [1, 5, 3, 8]));
    expect(regions).toEqual([
      { eq: true, a0: 0, a1: 1, b0: 0, b1: 1 },
      { eq: false, a0: 1, a1: 2, b0: 1, b1: 2 },
      { eq: true, a0: 2, a1: 3, b0: 2, b1: 3 },
      { eq: false, a0: 3, a1: 4, b0: 3, b1: 4 },
    ]);
  });
});
