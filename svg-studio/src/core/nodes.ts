import { arcPoint, arcToCenter } from './arc';
import { type Pt, dist } from './geometry';
import { type Seg, cubicAt } from './path';

/**
 * Paths as editable anchor points, the way a pen tool sees them: each node has an optional handle
 * on either side, and the segment from a node to the next is a line, a cubic curve (when either
 * node has a handle there) or an elliptical arc (when `arc` is set on the first node).
 */
export interface ArcParams {
  rx: number;
  ry: number;
  rot: number;
  large: 0 | 1;
  sweep: 0 | 1;
}

export interface PNode {
  x: number;
  y: number;
  /** Handle on the side of the previous node, as an absolute position. */
  hin: Pt | null;
  /** Handle on the side of the next node. */
  hout: Pt | null;
  /** When set, the segment from this node to the next is an arc. */
  arc: ArcParams | null;
}

export interface SubPath {
  nodes: PNode[];
  closed: boolean;
}

export interface NodeRef {
  sub: number;
  idx: number;
}

export interface HandleRef extends NodeRef {
  which: 'in' | 'out';
}

export const node = (x: number, y: number): PNode => ({ x, y, hin: null, hout: null, arc: null });

const EPS = 1e-9;
const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;

export function toSubPaths(segs: readonly Seg[]): SubPath[] {
  const subs: SubPath[] = [];
  let cur: SubPath | null = null;
  const flush = () => {
    if (cur && cur.nodes.length > 1) subs.push(cur);
    cur = null;
  };
  for (const s of segs) {
    if (s.t === 'M') {
      flush();
      cur = { nodes: [node(s.x, s.y)], closed: false };
      continue;
    }
    if (!cur) continue;
    const last: PNode = cur.nodes[cur.nodes.length - 1]!;
    switch (s.t) {
      case 'L':
        cur.nodes.push(node(s.x, s.y));
        break;
      case 'C': {
        const n = node(s.x, s.y);
        const c1 = { x: s.x1, y: s.y1 };
        const c2 = { x: s.x2, y: s.y2 };
        last.hout = same(c1, last) ? null : c1;
        n.hin = same(c2, n) ? null : c2;
        cur.nodes.push(n);
        break;
      }
      case 'Q': {
        // A quadratic curve is the cubic with its control points two thirds of the way to the quadratic one.
        const n = node(s.x, s.y);
        const c1 = { x: last.x + (2 / 3) * (s.x1 - last.x), y: last.y + (2 / 3) * (s.y1 - last.y) };
        const c2 = { x: s.x + (2 / 3) * (s.x1 - s.x), y: s.y + (2 / 3) * (s.y1 - s.y) };
        last.hout = same(c1, last) ? null : c1;
        n.hin = same(c2, n) ? null : c2;
        cur.nodes.push(n);
        break;
      }
      case 'A': {
        last.arc = { rx: s.rx, ry: s.ry, rot: s.rot, large: s.large, sweep: s.sweep };
        cur.nodes.push(node(s.x, s.y));
        break;
      }
      case 'Z': {
        cur.closed = true;
        const first = cur.nodes[0]!;
        // "M a … L a Z" has the same point twice: that is one node on a closed path.
        if (cur.nodes.length > 2 && same(last, first)) {
          first.hin = last.hin;
          cur.nodes.pop();
        }
        flush();
        break;
      }
    }
  }
  flush();
  return subs;
}

/** The segment leaving node `a` for node `b`. */
function segmentBetween(a: PNode, b: PNode): Seg {
  if (a.arc) return { t: 'A', ...a.arc, x: b.x, y: b.y };
  if (a.hout || b.hin) {
    const c1 = a.hout ?? a;
    const c2 = b.hin ?? b;
    return { t: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: b.x, y: b.y };
  }
  return { t: 'L', x: b.x, y: b.y };
}

export function fromSubPaths(subs: readonly SubPath[]): Seg[] {
  const out: Seg[] = [];
  for (const sp of subs) {
    const n = sp.nodes.length;
    if (!n) continue;
    out.push({ t: 'M', x: sp.nodes[0]!.x, y: sp.nodes[0]!.y });
    for (let i = 1; i < n; i++) out.push(segmentBetween(sp.nodes[i - 1]!, sp.nodes[i]!));
    if (sp.closed) {
      const a = sp.nodes[n - 1]!;
      const b = sp.nodes[0]!;
      if (a.arc || a.hout || b.hin) out.push(segmentBetween(a, b));
      out.push({ t: 'Z' });
    }
  }
  return out;
}

/** Number of segments in a subpath (the closing one included). */
export const segmentCount = (sp: SubPath): number => (sp.closed ? sp.nodes.length : sp.nodes.length - 1);

/** The point at parameter `t` (0 to 1) along the segment that leaves node `i`. */
export function segmentPointAt(sp: SubPath, i: number, t: number): Pt {
  const a = sp.nodes[i]!;
  const b = sp.nodes[(i + 1) % sp.nodes.length]!;
  const seg = segmentBetween(a, b);
  if (seg.t === 'C') return cubicAt(a, { x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 }, b, t);
  if (seg.t === 'A') {
    const arc = arcToCenter(a.x, a.y, seg.rx, seg.ry, seg.rot, seg.large, seg.sweep, b.x, b.y);
    if (arc) return arcPoint(arc, arc.theta1 + arc.dtheta * t);
  }
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export interface NearestOnPath {
  sub: number;
  /** The segment leaves node `idx`. */
  idx: number;
  t: number;
  point: Pt;
  dist: number;
}

/** The point of the paths closest to `p`. */
export function nearestOnSubPaths(subs: readonly SubPath[], p: Pt): NearestOnPath | null {
  let best: NearestOnPath | null = null;
  subs.forEach((sp, si) => {
    for (let i = 0; i < segmentCount(sp); i++) {
      const sample = (t: number) => dist(segmentPointAt(sp, i, t), p);
      let bt = 0;
      let bd = Infinity;
      const N = 40;
      for (let k = 0; k <= N; k++) {
        const d = sample(k / N);
        if (d < bd) {
          bd = d;
          bt = k / N;
        }
      }
      // Narrow in around the best sample.
      let lo = Math.max(0, bt - 1 / N);
      let hi = Math.min(1, bt + 1 / N);
      for (let r = 0; r < 20; r++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        if (sample(m1) < sample(m2)) hi = m2;
        else lo = m1;
      }
      bt = (lo + hi) / 2;
      bd = sample(bt);
      if (!best || bd < best.dist) best = { sub: si, idx: i, t: bt, point: segmentPointAt(sp, i, bt), dist: bd };
    }
  });
  return best;
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Splits the segment leaving node `idx` at `t`, adding a node there. Returns the new paths and the new node. */
export function insertNode(subs: readonly SubPath[], sub: number, idx: number, t: number): { subs: SubPath[]; ref: NodeRef } {
  const sp = subs[sub]!;
  const n = sp.nodes.length;
  const a = sp.nodes[idx]!;
  const bi = (idx + 1) % n;
  const b = sp.nodes[bi]!;
  const mid = node(0, 0);
  const nodes = sp.nodes.map((q) => ({ ...q }));
  const na = nodes[idx]!;
  const nb = nodes[bi]!;
  if (a.arc) {
    const arc = arcToCenter(a.x, a.y, a.arc.rx, a.arc.ry, a.arc.rot, a.arc.large, a.arc.sweep, b.x, b.y);
    if (arc) {
      const p = arcPoint(arc, arc.theta1 + arc.dtheta * t);
      mid.x = p.x;
      mid.y = p.y;
      const keep = { rx: arc.rx, ry: arc.ry, rot: a.arc.rot, sweep: a.arc.sweep };
      na.arc = { ...keep, large: Math.abs(arc.dtheta * t) > Math.PI ? 1 : 0 };
      mid.arc = { ...keep, large: Math.abs(arc.dtheta * (1 - t)) > Math.PI ? 1 : 0 };
    } else {
      const p = lerp(a, b, t);
      mid.x = p.x;
      mid.y = p.y;
      na.arc = null;
    }
  } else if (a.hout || b.hin) {
    const p0 = a;
    const p1 = a.hout ?? a;
    const p2 = b.hin ?? b;
    const p3 = b;
    const q0 = lerp(p0, p1, t);
    const q1 = lerp(p1, p2, t);
    const q2 = lerp(p2, p3, t);
    const r0 = lerp(q0, q1, t);
    const r1 = lerp(q1, q2, t);
    const s = lerp(r0, r1, t);
    mid.x = s.x;
    mid.y = s.y;
    na.hout = q0;
    mid.hin = r0;
    mid.hout = r1;
    nb.hin = q2;
  } else {
    const p = lerp(a, b, t);
    mid.x = p.x;
    mid.y = p.y;
  }
  nodes.splice(idx + 1, 0, mid);
  const out = subs.map((s, i) => (i === sub ? { ...sp, nodes } : s));
  return { subs: out, ref: { sub, idx: idx + 1 } };
}

/** Whether the node's two handles are in line on opposite sides, so that the curve passes through it smoothly. */
export function isSmooth(nd: PNode): boolean {
  if (!nd.hin || !nd.hout) return false;
  const ax = nd.hin.x - nd.x;
  const ay = nd.hin.y - nd.y;
  const bx = nd.hout.x - nd.x;
  const by = nd.hout.y - nd.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < EPS || lb < EPS) return false;
  return Math.abs(ax * by - ay * bx) / (la * lb) < 1e-3 && ax * bx + ay * by < 0;
}

export const nodeKey = (r: NodeRef): string => `${r.sub}:${r.idx}`;

export function moveNodes(subs: readonly SubPath[], refs: readonly NodeRef[], dx: number, dy: number): SubPath[] {
  const keys = new Set(refs.map(nodeKey));
  const mv = (p: Pt | null): Pt | null => (p ? { x: p.x + dx, y: p.y + dy } : null);
  return subs.map((sp, si) => ({
    ...sp,
    nodes: sp.nodes.map((q, ni) => (keys.has(`${si}:${ni}`) ? { ...q, x: q.x + dx, y: q.y + dy, hin: mv(q.hin), hout: mv(q.hout) } : q)),
  }));
}

/**
 * Moves a handle. With `couple` the handle on the other side of the node turns to stay in line
 * (keeping its own length, or mirroring this one's with `mirror`).
 */
export function setHandle(subs: readonly SubPath[], ref: HandleRef, to: Pt, couple: boolean, mirror = false): SubPath[] {
  return subs.map((sp, si) =>
    si !== ref.sub
      ? sp
      : {
          ...sp,
          nodes: sp.nodes.map((q, ni) => {
            if (ni !== ref.idx) return q;
            const next: PNode = { ...q };
            const mine = ref.which === 'in' ? 'hin' : 'hout';
            const other = ref.which === 'in' ? 'hout' : 'hin';
            const tiny = Math.hypot(to.x - q.x, to.y - q.y) < EPS;
            next[mine] = tiny ? null : to;
            if (couple) {
              const o = q[other];
              const len = mirror ? Math.hypot(to.x - q.x, to.y - q.y) : o ? Math.hypot(o.x - q.x, o.y - q.y) : 0;
              const d = Math.hypot(to.x - q.x, to.y - q.y);
              next[other] = !tiny && len > EPS && d > EPS ? { x: q.x - ((to.x - q.x) / d) * len, y: q.y - ((to.y - q.y) / d) * len } : null;
            }
            return next;
          }),
        },
  );
}

export function deleteNodes(subs: readonly SubPath[], refs: readonly NodeRef[]): SubPath[] {
  const keys = new Set(refs.map(nodeKey));
  const out: SubPath[] = [];
  subs.forEach((sp, si) => {
    const nodes = sp.nodes.filter((_, ni) => !keys.has(`${si}:${ni}`));
    if (nodes.length >= 2) out.push({ ...sp, nodes });
  });
  return out;
}

/** Makes the node a corner (no handles) or a smooth curve point (handles in line with its neighbours). */
export function setNodeType(subs: readonly SubPath[], ref: NodeRef, type: 'corner' | 'smooth'): SubPath[] {
  return subs.map((sp, si) => {
    if (si !== ref.sub) return sp;
    const n = sp.nodes.length;
    return {
      ...sp,
      nodes: sp.nodes.map((q, ni) => {
        if (ni !== ref.idx) return q;
        if (type === 'corner') return { ...q, hin: null, hout: null };
        const prev = ni > 0 ? sp.nodes[ni - 1]! : sp.closed ? sp.nodes[n - 1]! : null;
        const next = ni < n - 1 ? sp.nodes[ni + 1]! : sp.closed ? sp.nodes[0]! : null;
        const a = prev ?? q;
        const b = next ?? q;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d < EPS) return q;
        const ux = dx / d;
        const uy = dy / d;
        const lin = prev && !prev.arc ? dist(prev, q) / 3 : 0;
        const lout = next && !q.arc ? dist(q, next) / 3 : 0;
        return {
          ...q,
          hin: lin ? { x: q.x - ux * lin, y: q.y - uy * lin } : null,
          hout: lout ? { x: q.x + ux * lout, y: q.y + uy * lout } : null,
        };
      }),
    };
  });
}

export function setClosed(subs: readonly SubPath[], sub: number, closed: boolean): SubPath[] {
  return subs.map((sp, i) => (i === sub ? { ...sp, closed } : sp));
}
