import { type Pt, type Rect, bboxOfPoints } from './geometry';
import { type Matrix, apply, isAxisAligned, isQuarterTurn, isSimilarity } from './matrix';
import { type Polyline, type Seg, bboxSegs, flattenSegs, parsePathCached, serializePath, transformSegs } from './path';
import type { Geometry } from './types';

type Of<K extends Geometry['kind']> = Extract<Geometry, { kind: K }>;

/** A rounded rectangle's outline as path data (corner radii are clamped as SVG does). */
export function rectSegs(g: Of<'rect'>): Seg[] {
  const { x, y, width: w, height: h } = g;
  const rx = Math.min(Math.abs(g.rx), w / 2);
  const ry = Math.min(Math.abs(g.ry), h / 2);
  if (rx <= 0 || ry <= 0) {
    return [{ t: 'M', x, y }, { t: 'L', x: x + w, y }, { t: 'L', x: x + w, y: y + h }, { t: 'L', x, y: y + h }, { t: 'Z' }];
  }
  const arc = (px: number, py: number): Seg => ({ t: 'A', rx, ry, rot: 0, large: 0, sweep: 1, x: px, y: py });
  return [
    { t: 'M', x: x + rx, y },
    { t: 'L', x: x + w - rx, y },
    arc(x + w, y + ry),
    { t: 'L', x: x + w, y: y + h - ry },
    arc(x + w - rx, y + h),
    { t: 'L', x: x + rx, y: y + h },
    arc(x, y + h - ry),
    { t: 'L', x, y: y + ry },
    arc(x + rx, y),
    { t: 'Z' },
  ];
}

function ellipseSegs(cx: number, cy: number, rx: number, ry: number): Seg[] {
  return [
    { t: 'M', x: cx - rx, y: cy },
    { t: 'A', rx, ry, rot: 0, large: 1, sweep: 0, x: cx + rx, y: cy },
    { t: 'A', rx, ry, rot: 0, large: 1, sweep: 0, x: cx - rx, y: cy },
    { t: 'Z' },
  ];
}

/** Any shape as path segments. */
export function geomToSegs(g: Geometry): Seg[] {
  switch (g.kind) {
    case 'path':
      return parsePathCached(g.d).segs;
    case 'line':
      return [{ t: 'M', x: g.x1, y: g.y1 }, { t: 'L', x: g.x2, y: g.y2 }];
    case 'rect':
      return rectSegs(g);
    case 'circle':
      return ellipseSegs(g.cx, g.cy, g.r, g.r);
    case 'ellipse':
      return ellipseSegs(g.cx, g.cy, g.rx, g.ry);
    case 'polyline':
    case 'polygon': {
      const segs: Seg[] = g.points.map((p, i): Seg => ({ t: i ? 'L' : 'M', x: p.x, y: p.y }));
      if (g.kind === 'polygon' && segs.length) segs.push({ t: 'Z' });
      return segs;
    }
  }
}

export const pathGeom = (segs: readonly Seg[]): Geometry => ({ kind: 'path', d: serializePath(segs) });

/** The same outline as a `<path>`. */
export const geomToPath = (g: Geometry): Geometry => (g.kind === 'path' ? g : pathGeom(geomToSegs(g)));

const boundsCache = new WeakMap<Geometry, Rect | null>();

/** The tight bounds of the shape's outline (the stroke is not counted). */
export function geomBounds(g: Geometry): Rect | null {
  if (boundsCache.has(g)) return boundsCache.get(g)!;
  let r: Rect | null;
  switch (g.kind) {
    case 'path':
      r = bboxSegs(parsePathCached(g.d).segs);
      break;
    case 'line':
      r = bboxOfPoints([{ x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 }]);
      break;
    case 'rect':
      r = { x: g.x, y: g.y, w: g.width, h: g.height };
      break;
    case 'circle':
      r = { x: g.cx - g.r, y: g.cy - g.r, w: 2 * g.r, h: 2 * g.r };
      break;
    case 'ellipse':
      r = { x: g.cx - g.rx, y: g.cy - g.ry, w: 2 * g.rx, h: 2 * g.ry };
      break;
    default:
      r = bboxOfPoints(g.points);
  }
  boundsCache.set(g, r);
  return r;
}

const flatCache = new WeakMap<Geometry, Polyline[]>();

/** The outline as polylines, for hit testing. */
export function geomPolylines(g: Geometry): Polyline[] {
  let out = flatCache.get(g);
  if (!out) {
    out = flattenSegs(geomToSegs(g));
    flatCache.set(g, out);
  }
  return out;
}

const EPS = 1e-9;
const near = (a: number, b: number, eps = 1e-7) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * The shape after `m` is applied to it. The transform is baked into the geometry (so the stroke
 * width stays what it was): a rectangle that is turned by something other than a quarter becomes a
 * path, a circle that is stretched becomes an ellipse, and so on.
 */
export function transformGeom(g: Geometry, m: Matrix): Geometry {
  switch (g.kind) {
    case 'path': {
      const { segs } = parsePathCached(g.d);
      return { kind: 'path', d: serializePath(transformSegs(segs, m)) };
    }
    case 'line': {
      const a = apply(m, g.x1, g.y1);
      const b = apply(m, g.x2, g.y2);
      return { kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    case 'polyline':
    case 'polygon':
      return { kind: g.kind, points: g.points.map((p) => apply(m, p.x, p.y)) };
    case 'rect': {
      const axis = isAxisAligned(m);
      const quarter = isQuarterTurn(m);
      if (axis || quarter) {
        const p = apply(m, g.x, g.y);
        const q = apply(m, g.x + g.width, g.y + g.height);
        return {
          kind: 'rect',
          x: Math.min(p.x, q.x),
          y: Math.min(p.y, q.y),
          width: Math.abs(q.x - p.x),
          height: Math.abs(q.y - p.y),
          rx: axis ? g.rx * Math.abs(m[0]) : g.ry * Math.abs(m[2]),
          ry: axis ? g.ry * Math.abs(m[3]) : g.rx * Math.abs(m[1]),
        };
      }
      return { kind: 'path', d: serializePath(transformSegs(rectSegs(g), m)) };
    }
    case 'circle': {
      const c = apply(m, g.cx, g.cy);
      if (isSimilarity(m)) return { kind: 'circle', cx: c.x, cy: c.y, r: g.r * Math.hypot(m[0], m[1]) };
      return transformGeom({ kind: 'ellipse', cx: g.cx, cy: g.cy, rx: g.r, ry: g.r }, m);
    }
    case 'ellipse': {
      const axis = isAxisAligned(m);
      const quarter = isQuarterTurn(m);
      if (axis || quarter) {
        const c = apply(m, g.cx, g.cy);
        const rx = axis ? g.rx * Math.abs(m[0]) : g.ry * Math.abs(m[2]);
        const ry = axis ? g.ry * Math.abs(m[3]) : g.rx * Math.abs(m[1]);
        return near(rx, ry) ? { kind: 'circle', cx: c.x, cy: c.y, r: rx } : { kind: 'ellipse', cx: c.x, cy: c.y, rx, ry };
      }
      return { kind: 'path', d: serializePath(transformSegs(ellipseSegs(g.cx, g.cy, g.rx, g.ry), m)) };
    }
  }
}

/** Whether `a` and `b` describe the same shape. */
export function sameGeom(a: Geometry, b: Geometry): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'path') return a.d === (b as Of<'path'>).d;
  if (a.kind === 'polyline' || a.kind === 'polygon') {
    const pb = (b as Of<'polyline'>).points;
    return a.points.length === pb.length && a.points.every((p, i) => near(p.x, pb[i]!.x, EPS) && near(p.y, pb[i]!.y, EPS));
  }
  return (Object.keys(a) as Array<keyof typeof a>).every((k) => (typeof a[k] === 'number' ? near(a[k] as number, (b as never)[k] as number, EPS) : a[k] === (b as never)[k]));
}

export const pointsToString = (pts: readonly Pt[]): string => pts.map((p) => `${p.x},${p.y}`).join(' ');
