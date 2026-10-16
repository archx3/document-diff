import { type Pt, type Rect, center, clamp } from './geometry';
import { type Matrix, IDENTITY, multiply, rotateAbout, scaleAbout, translate } from './matrix';

/* Matrices for the editor's transform tools. They all take the selection's bounding box and a pivot,
   and return a matrix in document coordinates that the caller applies to the selected nodes. */

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLES: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Where a handle sits on the box, as fractions of its width and height. */
export const HANDLE_FRACTION: Record<HandleId, Pt> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};

export const pointOnBox = (box: Rect, f: Pt): Pt => ({ x: box.x + box.w * f.x, y: box.y + box.h * f.y });

/** The opposite handle: the point that stays put when a handle is dragged. */
export const oppositeFraction = (h: HandleId): Pt => ({ x: 1 - HANDLE_FRACTION[h].x, y: 1 - HANDLE_FRACTION[h].y });

/** A pivot is a point of the box (as fractions) or an absolute point of the canvas. */
export type Pivot = { kind: 'box'; fx: number; fy: number } | { kind: 'point'; x: number; y: number };

export const CENTER_PIVOT: Pivot = { kind: 'box', fx: 0.5, fy: 0.5 };

export const pivotPoint = (box: Rect, pv: Pivot): Pt => (pv.kind === 'point' ? { x: pv.x, y: pv.y } : pointOnBox(box, { x: pv.fx, y: pv.fy }));

/** Snaps to multiples of `step`. */
export function snapValue(v: number, step: number): number {
  if (!(step > 0)) return v;
  const r = Math.round(v / step) * step;
  return Number(r.toFixed(6));
}

/**
 * A move of `dx`, `dy` adjusted so that the left, centre or right edge of the box (whichever is
 * nearest to a grid line) lands on the grid, and likewise for the top, middle and bottom.
 */
export function snapMove(box: Rect, dx: number, dy: number, step: number): { dx: number; dy: number } {
  const axis = (start: number, size: number, d: number): number => {
    let best = 0;
    let bestAbs = Infinity;
    for (const e of [start, start + size / 2, start + size]) {
      const target = snapValue(e + d, step);
      const adj = target - (e + d);
      if (Math.abs(adj) < bestAbs - 1e-9) {
        bestAbs = Math.abs(adj);
        best = adj;
      }
    }
    return Number((d + best).toFixed(9)) + 0; // (+ 0 turns -0 into 0)
  };
  return { dx: axis(box.x, box.w, dx), dy: axis(box.y, box.h, dy) };
}

const MIN_SCALE = 0.001;
/** Keeps a scale factor away from zero (which would flatten the selection) while letting it flip sign. */
export function safeScale(s: number): number {
  if (!Number.isFinite(s)) return 1;
  return Math.abs(s) < MIN_SCALE ? (s < 0 ? -MIN_SCALE : MIN_SCALE) : s;
}

export interface ResizeOptions {
  /** Keep the proportions (Shift). */
  uniform?: boolean;
  /** Scale about the centre instead of the opposite handle (Alt). */
  fromCenter?: boolean;
  /** Snaps the dragged coordinate (to the grid). */
  snap?: (v: number) => number;
}

/** The matrix for dragging a resize handle of `box` to `pointer`. Dragging past the opposite side flips the selection. */
export function resizeMatrix(box: Rect, handle: HandleId, pointer: Pt, o: ResizeOptions = {}): Matrix {
  const f = HANDLE_FRACTION[handle];
  const movesX = f.x !== 0.5;
  const movesY = f.y !== 0.5;
  const hp = pointOnBox(box, f);
  const anchor = o.fromCenter ? center(box) : pointOnBox(box, oppositeFraction(handle));
  const p = { x: o.snap ? o.snap(pointer.x) : pointer.x, y: o.snap ? o.snap(pointer.y) : pointer.y };
  const ratio = (cur: number, handleAt: number, anchorAt: number): number => {
    const span = handleAt - anchorAt;
    return Math.abs(span) < 1e-9 ? 1 : safeScale((cur - anchorAt) / span);
  };
  let sx = movesX ? ratio(p.x, hp.x, anchor.x) : 1;
  let sy = movesY ? ratio(p.y, hp.y, anchor.y) : 1;
  const ctr = center(box);
  let ax = anchor.x;
  let ay = anchor.y;
  if (o.uniform) {
    if (movesX && movesY) {
      const k = Math.max(Math.abs(sx), Math.abs(sy));
      sx = (sx < 0 ? -1 : 1) * k;
      sy = (sy < 0 ? -1 : 1) * k;
    } else if (movesX) {
      sy = Math.abs(sx);
      ay = ctr.y;
    } else {
      sx = Math.abs(sy);
      ax = ctr.x;
    }
  }
  return scaleAbout(sx, sy, { x: ax, y: ay });
}

/** Rotation from dragging around `pivot`: the angle (radians, clockwise) between where the drag began and where it is now. */
export function rotationAngle(pivot: Pt, start: Pt, current: Pt, snapDegrees?: number): number {
  let a = Math.atan2(current.y - pivot.y, current.x - pivot.x) - Math.atan2(start.y - pivot.y, start.x - pivot.x);
  a = Math.atan2(Math.sin(a), Math.cos(a));
  if (snapDegrees) {
    const step = (snapDegrees * Math.PI) / 180;
    a = Math.round(a / step) * step;
  }
  return a;
}

export type ScaleTool = 'both' | 'h' | 'v';

/** How far from the pivot (in document units) a drag has to start for its distance to give a stable ratio. */
export function minReach(zoom: number): number {
  return 24 / Math.max(zoom, 1e-6);
}

/**
 * The scale factors for dragging with one of the scale tools. The factor is how far the pointer is from the pivot
 * now compared with where the drag began, so the selection follows the pointer. Starting close to the pivot gives
 * a gentler, continuous response instead of a jump.
 */
export function toolScale(tool: ScaleTool, pivot: Pt, start: Pt, current: Pt, zoom: number, free = false): { sx: number; sy: number } {
  const reach = minReach(zoom);
  const axis = (a: 'x' | 'y'): number => {
    const d0 = start[a] - pivot[a];
    const L = (d0 < 0 ? -1 : 1) * Math.max(Math.abs(d0), reach);
    return safeScale(1 + (current[a] - start[a]) / L);
  };
  if (tool === 'h') return { sx: axis('x'), sy: 1 };
  if (tool === 'v') return { sx: 1, sy: axis('y') };
  if (free) return { sx: axis('x'), sy: axis('y') };
  const d0 = Math.hypot(start.x - pivot.x, start.y - pivot.y);
  const d1 = Math.hypot(current.x - pivot.x, current.y - pivot.y);
  const k = safeScale(1 + (d1 - d0) / Math.max(d0, reach));
  return { sx: Math.abs(k), sy: Math.abs(k) };
}

/* Numeric transforms (the inspector's fields and buttons). */

export const scaleMatrix = (sx: number, sy: number, pivot: Pt): Matrix => scaleAbout(safeScale(sx), safeScale(sy), pivot);

export const flipMatrix = (axis: 'h' | 'v', pivot: Pt): Matrix => (axis === 'h' ? scaleAbout(-1, 1, pivot) : scaleAbout(1, -1, pivot));

export const rotateByDegrees = (deg: number, pivot: Pt): Matrix => rotateAbout((deg * Math.PI) / 180, pivot);

/** Resizes the box to the given size about the pivot; a missing size keeps that dimension. */
export function resizeToMatrix(box: Rect, width: number | null, height: number | null, pivot: Pt): Matrix {
  const sx = width !== null && box.w > 1e-9 ? width / box.w : 1;
  const sy = height !== null && box.h > 1e-9 ? height / box.h : 1;
  return scaleMatrix(sx, sy, pivot);
}

export const moveToMatrix = (box: Rect, x: number | null, y: number | null): Matrix => translate(x === null ? 0 : x - box.x, y === null ? 0 : y - box.y);

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** How far each box has to move to line up with the reference box. */
export function alignDeltas(boxes: ReadonlyMap<string, Rect>, mode: AlignMode, reference: Rect): Map<string, Pt> {
  const out = new Map<string, Pt>();
  for (const [id, b] of boxes) {
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = reference.x - b.x;
    else if (mode === 'center') dx = reference.x + reference.w / 2 - (b.x + b.w / 2);
    else if (mode === 'right') dx = reference.x + reference.w - (b.x + b.w);
    else if (mode === 'top') dy = reference.y - b.y;
    else if (mode === 'middle') dy = reference.y + reference.h / 2 - (b.y + b.h / 2);
    else dy = reference.y + reference.h - (b.y + b.h);
    out.set(id, { x: dx, y: dy });
  }
  return out;
}

/** Spaces boxes evenly between the outermost two along an axis. */
export function distributeDeltas(boxes: ReadonlyMap<string, Rect>, axis: 'h' | 'v'): Map<string, Pt> {
  const out = new Map<string, Pt>();
  const items = [...boxes].sort((a, b) => (axis === 'h' ? a[1].x - b[1].x : a[1].y - b[1].y));
  if (items.length < 3) return new Map(items.map(([id]) => [id, { x: 0, y: 0 }]));
  const size = (r: Rect) => (axis === 'h' ? r.w : r.h);
  const start = (r: Rect) => (axis === 'h' ? r.x : r.y);
  const first = items[0]![1];
  const last = items[items.length - 1]![1];
  const total = start(last) + size(last) - start(first);
  const gap = (total - items.reduce((s, [, r]) => s + size(r), 0)) / (items.length - 1);
  let at = start(first);
  for (const [id, r] of items) {
    const d = at - start(r);
    out.set(id, axis === 'h' ? { x: d, y: 0 } : { x: 0, y: d });
    at += size(r) + gap;
  }
  return out;
}

export const translation = (dx: number, dy: number): Matrix => (dx || dy ? translate(dx, dy) : IDENTITY);

export { clamp, multiply };
