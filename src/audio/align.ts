/**
 * Lining two recordings up in time and finding where they differ. The frames
 * of each (analyze.ts features) are aligned with dynamic time warping, so a
 * pause added in B or a phrase taken out of A doesn't make everything after
 * it look different; then the aligned path is walked for stretches that sound
 * different (changed), or that only one recording has (added, removed).
 */
import type { Features } from './analyze';
import { frameDistance } from './analyze';

/** Aligned frames: A's frame and B's, from start to end. */
export type Path = Array<[number, number]>;

/** The most frames a recording is lined up at directly: longer ones are lined up coarsely first (see alignFrames). */
const DIRECT = 8000;
/** How far from the coarse path (in coarse frames, either side) the full-scale path may go. */
const RADIUS = 3;

/**
 * The cheapest path of aligned frames through the two recordings, within a
 * band around the diagonal wide enough for the difference in length and
 * then some (Sakoe–Chiba), so long recordings stay quick. Longer ones still
 * (over DIRECT frames) are lined up at a coarser scale first, their frames
 * averaged, and then at the full scale near that path only (as FastDTW
 * does): every frame counts, and the time it takes grows with the length,
 * not its square.
 */
export function alignFrames(a: Features, b: Features, direct = DIRECT): Path {
  const n = a.frames;
  const m = b.frames;
  const lo = new Int32Array(n);
  const hi = new Int32Array(n);
  if (n <= direct && m <= direct) {
    const slope = m / n;
    const band = Math.max(Math.abs(n - m), Math.round(0.15 * Math.max(n, m))) + 40;
    for (let i = 0; i < n; i++) {
      lo[i] = Math.max(0, Math.floor(i * slope) - band);
      hi[i] = Math.min(m - 1, Math.ceil(i * slope) + band);
    }
    return warp(a, b, lo, hi);
  }
  const k = Math.ceil(Math.max(n, m) / direct);
  const coarse = alignFrames(pool(a, k), pool(b, k), direct);
  // Near the coarse path: its frames, and RADIUS coarse frames either side.
  lo.fill(m);
  hi.fill(-1);
  for (const [ci, cj] of coarse) {
    for (let i = ci * k; i < Math.min(n, (ci + 1) * k); i++) {
      lo[i] = Math.min(lo[i]!, Math.max(0, (cj - RADIUS) * k));
      hi[i] = Math.max(hi[i]!, Math.min(m - 1, (cj + 1 + RADIUS) * k - 1));
    }
  }
  return warp(a, b, lo, hi);
}

/** Frames `k` at a time, averaged: a recording at a coarser scale. */
function pool(f: Features, k: number): Features {
  const frames = Math.ceil(f.frames / k);
  const bands = f.shape.length / f.frames;
  const notes = f.chroma.length / f.frames;
  const level = new Float32Array(frames);
  const shape = new Float32Array(frames * bands);
  const chroma = new Float32Array(frames * notes);
  for (let c = 0; c < frames; c++) {
    const from = c * k;
    const to = Math.min(f.frames, from + k);
    const count = to - from;
    let sum = 0;
    for (let i = from; i < to; i++) {
      sum += f.level[i]!;
      for (let x = 0; x < bands; x++) shape[c * bands + x] = shape[c * bands + x]! + f.shape[i * bands + x]! / count;
      for (let x = 0; x < notes; x++) chroma[c * notes + x] = chroma[c * notes + x]! + f.chroma[i * notes + x]! / count;
    }
    level[c] = sum / count;
  }
  return { fps: f.fps / k, frames, level, shape, chroma };
}

/** The cheapest path of aligned frames from the start of both to the end of both, row i of A kept to B's frames lo[i] to hi[i]. */
function warp(a: Features, b: Features, lo: Int32Array, hi: Int32Array): Path {
  const n = a.frames;
  const m = b.frames;
  // Costs and steps, row by row within the band.
  const cost: Float32Array[] = [];
  const step: Uint8Array[] = [];
  const at = (i: number, j: number) => (i < 0 || j < 0 || j < lo[i]! || j > hi[i]! ? Infinity : cost[i]![j - lo[i]!]!);
  for (let i = 0; i < n; i++) {
    const l = lo[i]!;
    const h = hi[i]!;
    const row = new Float32Array(h - l + 1);
    const moves = new Uint8Array(h - l + 1);
    for (let j = l; j <= h; j++) {
      const d = frameDistance(a, i, b, j);
      if (i === 0 && j === 0) {
        row[0] = d;
        continue;
      }
      const diag = at(i - 1, j - 1);
      const up = i > 0 ? at(i - 1, j) : Infinity;
      const left = j > l ? row[j - 1 - l]! : at(i, j - 1);
      // Skipping (a frame of one recording against nothing new in the other) costs a little more than moving on together.
      const best = Math.min(diag, up + 0.02, left + 0.02);
      row[j - l] = d + best;
      moves[j - l] = best === diag ? 0 : best === up + 0.02 ? 1 : 2;
    }
    cost.push(row);
    step.push(moves);
  }
  const path: Path = [];
  let i = n - 1;
  let j = m - 1;
  while (i > 0 || j > 0) {
    path.push([i, j]);
    const mv = step[i]![j - lo[i]!] ?? 0;
    if (i === 0) j--;
    else if (j === 0) i--;
    else if (mv === 0) {
      i--;
      j--;
    } else if (mv === 1) i--;
    else j--;
    j = Math.min(Math.max(j, lo[i]!), hi[i]!);
  }
  path.push([0, 0]);
  return path.reverse();
}

/** Where in B a time in A is (and the other way round), by the aligned path. */
export interface TimeMap {
  aToB(t: number): number;
  bToA(t: number): number;
}

export function timeMap(path: Path, fpsA: number, fpsB: number): TimeMap {
  const lookup = (from: 0 | 1, to: 0 | 1, fpsFrom: number, fpsTo: number) => {
    const first = new Map<number, number>();
    for (const p of path) if (!first.has(p[from])) first.set(p[from], p[to]);
    const max = path[path.length - 1]![from];
    return (t: number) => {
      const f = Math.min(max, Math.max(0, t * fpsFrom));
      const k = Math.floor(f);
      const x = first.get(k) ?? 0;
      const y = first.get(Math.min(max, k + 1)) ?? x;
      return (x + (y - x) * (f - k)) / fpsTo;
    };
  };
  return { aToB: lookup(0, 1, fpsA, fpsB), bToA: lookup(1, 0, fpsB, fpsA) };
}

export type DifferenceKind = 'changed' | 'added' | 'removed';

/** A stretch where the recordings differ, in seconds on each. */
export interface AudioDifference {
  kind: DifferenceKind;
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
  /** How different it is, 0 to 1. */
  score: number;
}

export interface DifferenceOptions {
  /** 0 to 100: how small a difference counts. */
  sensitivity?: number;
  /** Stretches shorter than this (seconds) are left out, and ones closer than `join` joined. */
  shortest?: number;
  join?: number;
}

/**
 * The differences along an aligned path: stretches that sound different, and
 * stretches one recording has and the other doesn't (the path running along
 * one recording while the other stands still).
 */
export function findDifferences(a: Features, b: Features, path: Path, opts: DifferenceOptions = {}): AudioDifference[] {
  const sensitivity = Math.min(100, Math.max(0, opts.sensitivity ?? 70));
  const threshold = 0.55 - (sensitivity / 100) * 0.45;
  const shortest = opts.shortest ?? 0.15;
  const join = opts.join ?? 0.3;
  // Each step: how different, and whether it holds one recording still.
  const marks: Array<{ i: number; j: number; d: number; kind: DifferenceKind | null }> = [];
  for (let k = 0; k < path.length; k++) {
    const [i, j] = path[k]!;
    const [pi, pj] = path[k - 1] ?? [-1, -1];
    const d = frameDistance(a, i, b, j);
    const stillB = pj === j && pi !== i;
    const stillA = pi === i && pj !== j;
    // A stretch only one recording has is one where the other holds still over sound.
    let kind: DifferenceKind | null = null;
    if (stillB && a.level[i]! > -50) kind = 'removed';
    else if (stillA && b.level[j]! > -50) kind = 'added';
    else if (d > threshold) kind = 'changed';
    marks.push({ i, j, d, kind });
  }
  // Runs of marked steps, smoothed: a lone unmarked step inside a run stays in it.
  const out: AudioDifference[] = [];
  let run: { from: number; to: number; kinds: Record<DifferenceKind, number>; score: number } | null = null;
  const flush = () => {
    if (!run) return;
    const s = marks[run.from]!;
    const e = marks[run.to]!;
    const kind = (Object.entries(run.kinds).sort((x, y) => y[1] - x[1])[0]![0] as DifferenceKind) ?? 'changed';
    out.push({
      kind,
      aStart: s.i / a.fps,
      aEnd: (e.i + 1) / a.fps,
      bStart: s.j / b.fps,
      bEnd: (e.j + 1) / b.fps,
      score: Math.min(1, run.score / (run.to - run.from + 1)),
    });
    run = null;
  };
  const gap = Math.max(1, Math.round(join * Math.min(a.fps, b.fps)));
  let quiet = 0;
  marks.forEach((mk, k) => {
    if (mk.kind) {
      if (!run) run = { from: k, to: k, kinds: { changed: 0, added: 0, removed: 0 }, score: 0 };
      run.to = k;
      run.kinds[mk.kind]++;
      run.score += mk.kind === 'changed' ? mk.d : 1;
      quiet = 0;
    } else if (run) {
      quiet++;
      if (quiet > gap) flush();
    }
  });
  flush();
  // Too short to hear is left out; an added or removed stretch is empty on the other side.
  return out
    .filter((d) => Math.max(d.aEnd - d.aStart, d.bEnd - d.bStart) >= shortest)
    .map((d) => (d.kind === 'added' ? { ...d, aEnd: d.aStart } : d.kind === 'removed' ? { ...d, bEnd: d.bStart } : d));
}
