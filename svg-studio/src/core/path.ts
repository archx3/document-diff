import { arcExtremeAngles, arcPoint, arcToCenter, transformArcParams } from './arc';
import { type Pt, type Rect, bboxOfPoints } from './geometry';
import { type Matrix, apply } from './matrix';

/** Path data as absolute segments. H, V, S and T are expanded to L, C and Q, and every relative command is made absolute. */
export type Seg =
  | { t: 'M'; x: number; y: number }
  | { t: 'L'; x: number; y: number }
  | { t: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { t: 'Q'; x1: number; y1: number; x: number; y: number }
  | { t: 'A'; rx: number; ry: number; rot: number; large: 0 | 1; sweep: 0 | 1; x: number; y: number }
  | { t: 'Z' };

export interface ParsedPath {
  segs: Seg[];
  /** Why parsing stopped early, if it did. Everything before the problem is still returned, as browsers draw it. */
  error?: string;
}

const COUNTS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

export function parsePath(d: string): ParsedPath {
  const segs: Seg[] = [];
  const n = d.length;
  let i = 0;
  let cmd = '';
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let prevC: Pt | null = null;
  let prevQ: Pt | null = null;
  let needMove = false;

  const skip = () => {
    while (i < n) {
      const c = d.charCodeAt(i);
      if (c === 32 || c === 44 || c === 9 || c === 10 || c === 13 || c === 12) i++;
      else break;
    }
  };
  const num = (): number | null => {
    skip();
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(d);
    if (!m) return null;
    i = NUMBER.lastIndex;
    return parseFloat(m[0]);
  };
  const flag = (): 0 | 1 | null => {
    skip();
    const c = d[i];
    if (c === '0' || c === '1') {
      i++;
      return c === '1' ? 1 : 0;
    }
    return null;
  };

  for (;;) {
    skip();
    if (i >= n) break;
    const ch = d[i]!;
    if (/[a-zA-Z]/.test(ch)) {
      if (!(ch.toLowerCase() in COUNTS)) return { segs, error: `Unknown path command "${ch}"` };
      cmd = ch;
      i++;
      if (!segs.length && ch.toLowerCase() !== 'm') return { segs, error: 'A path must start with a moveto (M)' };
      if (ch === 'z' || ch === 'Z') {
        segs.push({ t: 'Z' });
        cx = sx;
        cy = sy;
        prevC = prevQ = null;
        needMove = true;
        cmd = '';
        continue;
      }
    } else if (!cmd) {
      return { segs, error: segs.length ? 'Numbers after a closepath need a command' : 'A path must start with a moveto (M)' };
    }

    const lower = cmd.toLowerCase();
    const rel = cmd === lower;
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    const a: number[] = [];
    let ok = true;
    for (let k = 0; k < COUNTS[lower]!; k++) {
      let v: number | null;
      if (lower === 'a' && (k === 3 || k === 4)) v = flag();
      else v = num();
      if (v === null) {
        ok = false;
        break;
      }
      a.push(v);
    }
    if (!ok) return { segs, error: `Missing or bad number for "${cmd}"` };

    if (needMove && lower !== 'm') {
      segs.push({ t: 'M', x: sx, y: sy });
    }
    needMove = false;

    let nextC: Pt | null = null;
    let nextQ: Pt | null = null;
    switch (lower) {
      case 'm':
        cx = a[0]! + ox;
        cy = a[1]! + oy;
        sx = cx;
        sy = cy;
        segs.push({ t: 'M', x: cx, y: cy });
        cmd = rel ? 'l' : 'L';
        break;
      case 'l':
        cx = a[0]! + ox;
        cy = a[1]! + oy;
        segs.push({ t: 'L', x: cx, y: cy });
        break;
      case 'h':
        cx = a[0]! + ox;
        segs.push({ t: 'L', x: cx, y: cy });
        break;
      case 'v':
        cy = a[0]! + oy;
        segs.push({ t: 'L', x: cx, y: cy });
        break;
      case 'c': {
        const [x1, y1, x2, y2, x, y] = [a[0]! + ox, a[1]! + oy, a[2]! + ox, a[3]! + oy, a[4]! + ox, a[5]! + oy];
        segs.push({ t: 'C', x1, y1, x2, y2, x, y });
        nextC = { x: x2, y: y2 };
        cx = x;
        cy = y;
        break;
      }
      case 's': {
        const x1: number = prevC ? 2 * cx - prevC.x : cx;
        const y1: number = prevC ? 2 * cy - prevC.y : cy;
        const [x2, y2, x, y] = [a[0]! + ox, a[1]! + oy, a[2]! + ox, a[3]! + oy];
        segs.push({ t: 'C', x1, y1, x2, y2, x, y });
        nextC = { x: x2, y: y2 };
        cx = x;
        cy = y;
        break;
      }
      case 'q': {
        const [x1, y1, x, y] = [a[0]! + ox, a[1]! + oy, a[2]! + ox, a[3]! + oy];
        segs.push({ t: 'Q', x1, y1, x, y });
        nextQ = { x: x1, y: y1 };
        cx = x;
        cy = y;
        break;
      }
      case 't': {
        const x1: number = prevQ ? 2 * cx - prevQ.x : cx;
        const y1: number = prevQ ? 2 * cy - prevQ.y : cy;
        const [x, y] = [a[0]! + ox, a[1]! + oy];
        segs.push({ t: 'Q', x1, y1, x, y });
        nextQ = { x: x1, y: y1 };
        cx = x;
        cy = y;
        break;
      }
      default: {
        const x = a[5]! + ox;
        const y = a[6]! + oy;
        segs.push({ t: 'A', rx: Math.abs(a[0]!), ry: Math.abs(a[1]!), rot: a[2]!, large: a[3] as 0 | 1, sweep: a[4] as 0 | 1, x, y });
        cx = x;
        cy = y;
      }
    }
    prevC = nextC;
    prevQ = nextQ;
  }
  return { segs };
}

const parseCache = new Map<string, ParsedPath>();

/** `parsePath` with a small cache: the same string is parsed many times while the canvas redraws. */
export function parsePathCached(d: string): ParsedPath {
  let hit = parseCache.get(d);
  if (!hit) {
    hit = parsePath(d);
    if (parseCache.size > 500) parseCache.clear();
    parseCache.set(d, hit);
  }
  return hit;
}

/** A number with at most `places` decimals and no trailing zeros. */
export function fmt(v: number, places = 3): string {
  const r = Number(v.toFixed(places));
  return Object.is(r, -0) || r === 0 ? '0' : String(r);
}

/**
 * Path data in the compact style icon sets use: whichever of the absolute or relative form of
 * each command is shorter, `h`/`v` for straight axis-aligned lines, no space before a minus sign.
 */
export function serializePath(segs: readonly Seg[], places = 3): string {
  let out = '';
  let prevLetter = '';
  // The current point as a reader of the output would reconstruct it.
  let px = 0;
  let py = 0;
  let sx = 0;
  let sy = 0;
  const half = 0.5 * 10 ** -places;
  const snap = (v: number) => Number(v.toFixed(places + 3));

  const render = (letter: string, nums: string[]): string => {
    const omit = letter === prevLetter && letter !== 'M' && letter !== 'm';
    let s = omit ? '' : letter;
    nums.forEach((t, k) => {
      s += k === 0 && !omit ? t : t.startsWith('-') ? t : ` ${t}`;
    });
    return s;
  };
  const emit = (abs: { letter: string; nums: number[]; end: Pt }, rel: { letter: string; nums: number[]; end: Pt } | null) => {
    const a = render(abs.letter, abs.nums.map((v) => fmt(v, places)));
    const r = rel ? render(rel.letter, rel.nums.map((v) => fmt(v, places))) : null;
    const useRel = r !== null && r.length <= a.length;
    const pick = useRel ? rel! : abs;
    out += useRel ? r : a;
    prevLetter = pick.letter;
    px = pick.end.x;
    py = pick.end.y;
  };

  for (const s of segs) {
    switch (s.t) {
      case 'M': {
        const X = Number(s.x.toFixed(places));
        const Y = Number(s.y.toFixed(places));
        const dx = Number((s.x - px).toFixed(places));
        const dy = Number((s.y - py).toFixed(places));
        emit({ letter: 'M', nums: [X, Y], end: { x: X, y: Y } }, out ? { letter: 'm', nums: [dx, dy], end: { x: snap(px + dx), y: snap(py + dy) } } : null);
        sx = px;
        sy = py;
        break;
      }
      case 'L': {
        const X = Number(s.x.toFixed(places));
        const Y = Number(s.y.toFixed(places));
        const dx = Number((s.x - px).toFixed(places));
        const dy = Number((s.y - py).toFixed(places));
        if (Math.abs(s.y - py) < half) {
          emit({ letter: 'H', nums: [X], end: { x: X, y: py } }, { letter: 'h', nums: [dx], end: { x: snap(px + dx), y: py } });
        } else if (Math.abs(s.x - px) < half) {
          emit({ letter: 'V', nums: [Y], end: { x: px, y: Y } }, { letter: 'v', nums: [dy], end: { x: px, y: snap(py + dy) } });
        } else {
          emit({ letter: 'L', nums: [X, Y], end: { x: X, y: Y } }, { letter: 'l', nums: [dx, dy], end: { x: snap(px + dx), y: snap(py + dy) } });
        }
        break;
      }
      case 'C': {
        const r = (v: number, o: number) => Number((v - o).toFixed(places));
        emit(
          { letter: 'C', nums: [s.x1, s.y1, s.x2, s.y2, s.x, s.y], end: { x: Number(s.x.toFixed(places)), y: Number(s.y.toFixed(places)) } },
          { letter: 'c', nums: [r(s.x1, px), r(s.y1, py), r(s.x2, px), r(s.y2, py), r(s.x, px), r(s.y, py)], end: { x: snap(px + r(s.x, px)), y: snap(py + r(s.y, py)) } },
        );
        break;
      }
      case 'Q': {
        const r = (v: number, o: number) => Number((v - o).toFixed(places));
        emit(
          { letter: 'Q', nums: [s.x1, s.y1, s.x, s.y], end: { x: Number(s.x.toFixed(places)), y: Number(s.y.toFixed(places)) } },
          { letter: 'q', nums: [r(s.x1, px), r(s.y1, py), r(s.x, px), r(s.y, py)], end: { x: snap(px + r(s.x, px)), y: snap(py + r(s.y, py)) } },
        );
        break;
      }
      case 'A': {
        const r = (v: number, o: number) => Number((v - o).toFixed(places));
        emit(
          { letter: 'A', nums: [s.rx, s.ry, s.rot, s.large, s.sweep, s.x, s.y], end: { x: Number(s.x.toFixed(places)), y: Number(s.y.toFixed(places)) } },
          { letter: 'a', nums: [s.rx, s.ry, s.rot, s.large, s.sweep, r(s.x, px), r(s.y, py)], end: { x: snap(px + r(s.x, px)), y: snap(py + r(s.y, py)) } },
        );
        break;
      }
      case 'Z':
        out += 'z';
        prevLetter = 'z';
        px = sx;
        py = sy;
        break;
    }
  }
  return out;
}

/** Applies an affine matrix to path data. Arcs stay arcs. */
export function transformSegs(segs: readonly Seg[], m: Matrix): Seg[] {
  return segs.map((s): Seg => {
    switch (s.t) {
      case 'M':
      case 'L': {
        const p = apply(m, s.x, s.y);
        return { t: s.t, x: p.x, y: p.y };
      }
      case 'C': {
        const a = apply(m, s.x1, s.y1);
        const b = apply(m, s.x2, s.y2);
        const p = apply(m, s.x, s.y);
        return { t: 'C', x1: a.x, y1: a.y, x2: b.x, y2: b.y, x: p.x, y: p.y };
      }
      case 'Q': {
        const a = apply(m, s.x1, s.y1);
        const p = apply(m, s.x, s.y);
        return { t: 'Q', x1: a.x, y1: a.y, x: p.x, y: p.y };
      }
      case 'A': {
        const p = apply(m, s.x, s.y);
        const arc = transformArcParams(s.rx, s.ry, s.rot, s.sweep, m);
        return { t: 'A', rx: arc.rx, ry: arc.ry, rot: arc.rot, large: s.large, sweep: arc.sweep as 0 | 1, x: p.x, y: p.y };
      }
      default:
        return s;
    }
  });
}

/** The point a segment ends at. */
export const segEnd = (s: Seg): Pt | null => (s.t === 'Z' ? null : { x: s.x, y: s.y });

/** Cubic Bézier extremes: the parameter values in (0, 1) at which one coordinate is at a minimum or maximum. */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const out: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) out.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      out.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
    }
  }
  return out.filter((t) => t > 0 && t < 1);
}

export const cubicAt = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt => {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return { x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x, y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y };
};

export const quadAt = (p0: Pt, p1: Pt, p2: Pt, t: number): Pt => {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
};

/** The tight bounding box of the drawn path (curve extremes, not control points). Null for an empty path. */
export function bboxSegs(segs: readonly Seg[]): Rect | null {
  const pts: Pt[] = [];
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = cur;
  for (const s of segs) {
    switch (s.t) {
      case 'M':
        cur = start = { x: s.x, y: s.y };
        pts.push(cur);
        break;
      case 'L':
        cur = { x: s.x, y: s.y };
        pts.push(cur);
        break;
      case 'C': {
        const p1 = { x: s.x1, y: s.y1 };
        const p2 = { x: s.x2, y: s.y2 };
        const p3 = { x: s.x, y: s.y };
        for (const t of [...cubicExtrema(cur.x, p1.x, p2.x, p3.x), ...cubicExtrema(cur.y, p1.y, p2.y, p3.y)]) pts.push(cubicAt(cur, p1, p2, p3, t));
        pts.push(p3);
        cur = p3;
        break;
      }
      case 'Q': {
        const p1 = { x: s.x1, y: s.y1 };
        const p2 = { x: s.x, y: s.y };
        for (const axis of ['x', 'y'] as const) {
          const den = cur[axis] - 2 * p1[axis] + p2[axis];
          if (Math.abs(den) > 1e-12) {
            const t = (cur[axis] - p1[axis]) / den;
            if (t > 0 && t < 1) pts.push(quadAt(cur, p1, p2, t));
          }
        }
        pts.push(p2);
        cur = p2;
        break;
      }
      case 'A': {
        const end = { x: s.x, y: s.y };
        const arc = arcToCenter(cur.x, cur.y, s.rx, s.ry, s.rot, s.large, s.sweep, s.x, s.y);
        if (arc) for (const t of arcExtremeAngles(arc)) pts.push(arcPoint(arc, t));
        pts.push(end);
        cur = end;
        break;
      }
      case 'Z':
        cur = start;
        break;
    }
  }
  return bboxOfPoints(pts);
}

export interface Polyline {
  pts: Pt[];
  closed: boolean;
}

/** The path as straight pieces, close enough to draw or hit-test (about `tol` units from the true curve). */
export function flattenSegs(segs: readonly Seg[], tol = 0.05): Polyline[] {
  const out: Polyline[] = [];
  let cur: Polyline | null = null;
  let pos: Pt = { x: 0, y: 0 };
  let start: Pt = pos;
  const begin = (p: Pt) => {
    cur = { pts: [p], closed: false };
    out.push(cur);
  };
  const lineTo = (p: Pt) => {
    if (!cur) begin(pos);
    cur!.pts.push(p);
    pos = p;
  };
  const steps = (len: number) => Math.max(4, Math.min(96, Math.ceil(Math.sqrt(len / tol) * 1.2)));
  for (const s of segs) {
    switch (s.t) {
      case 'M':
        pos = start = { x: s.x, y: s.y };
        begin(pos);
        break;
      case 'L':
        lineTo({ x: s.x, y: s.y });
        break;
      case 'C': {
        const p1 = { x: s.x1, y: s.y1 };
        const p2 = { x: s.x2, y: s.y2 };
        const p3 = { x: s.x, y: s.y };
        const from = pos;
        const len = Math.hypot(p1.x - from.x, p1.y - from.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y) + Math.hypot(p3.x - p2.x, p3.y - p2.y);
        const n = steps(len);
        for (let i = 1; i <= n; i++) lineTo(i === n ? p3 : cubicAt(from, p1, p2, p3, i / n));
        break;
      }
      case 'Q': {
        const p1 = { x: s.x1, y: s.y1 };
        const p2 = { x: s.x, y: s.y };
        const from = pos;
        const n = steps(Math.hypot(p1.x - from.x, p1.y - from.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y));
        for (let i = 1; i <= n; i++) lineTo(i === n ? p2 : quadAt(from, p1, p2, i / n));
        break;
      }
      case 'A': {
        const end = { x: s.x, y: s.y };
        const arc = arcToCenter(pos.x, pos.y, s.rx, s.ry, s.rot, s.large, s.sweep, s.x, s.y);
        if (!arc) {
          lineTo(end);
          break;
        }
        const n = steps(Math.abs(arc.dtheta) * Math.max(arc.rx, arc.ry));
        for (let i = 1; i <= n; i++) lineTo(i === n ? end : arcPoint(arc, arc.theta1 + (arc.dtheta * i) / n));
        break;
      }
      case 'Z':
        if (cur) (cur as Polyline).closed = true;
        pos = start;
        cur = null;
        break;
    }
  }
  return out.filter((p) => p.pts.length > 1 || p.closed);
}

/** Whether every subpath is closed (so the shape has an inside). */
export function isClosedPath(segs: readonly Seg[]): boolean {
  let any = false;
  let open = false;
  for (const s of segs) {
    if (s.t === 'M') {
      if (open) return false;
      open = true;
      any = true;
    } else if (s.t === 'Z') open = false;
  }
  return any && !open;
}
