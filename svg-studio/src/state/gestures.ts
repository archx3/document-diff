import { boundsOf, cloneInPlace, findNode, insertNodes, locate, normalizeSelection, transformNodes, updateNode } from '../core/doc';
import { dist, rectFromPoints, type Pt, type Rect } from '../core/geometry';
import { meanScale, rotateAbout, scaleAbout, translate, type Matrix } from '../core/matrix';
import { isSmooth, moveNodes, setHandle, node as makeNode, type NodeRef, type SubPath } from '../core/nodes';
import { fmt } from '../core/path';
import { hitTest, marqueeSelect, type MarqueeMode } from '../core/pick';
import {
  CENTER_PIVOT,
  pivotPoint,
  pointOnBox,
  resizeMatrix,
  rotationAngle,
  snapMove,
  snapValue,
  toolScale,
  type HandleId,
  type ScaleTool,
} from '../core/transform';
import { uid, type Doc, type Geometry, type Node } from '../core/types';
import { finishPen, geomFromSubPaths, liveSelection, nodeTargetId, parseNodeKey, setSelection, subPathsOf } from './actions';
import { store, type ToolId } from './store';

/* Pointer gestures. Each pointer-down on the canvas turns into one of these, which then follows the pointer
   until it is released. Gestures that change the document preview the change as they go and record a
   single undo step when they end. */

export interface View {
  zoom: number;
  x: number;
  y: number;
}

/** A pointer event in the terms gestures care about. */
export interface Ptr {
  /** Document coordinates. */
  doc: Pt;
  /** Pixels in the canvas. */
  screen: Pt;
  shift: boolean;
  alt: boolean;
  /** Ctrl or ⌘. */
  mod: boolean;
}

export interface Gesture {
  move(p: Ptr): void;
  up(p: Ptr): void;
  cancel(): void;
}

export interface GestureContext {
  view(): View;
  setView(v: View): void;
}

const DRAG_THRESHOLD = 3;

const S = () => store.get();

const snapping = (p: Ptr): boolean => S().settings.snap !== p.mod;
const snapPoint = (p: Ptr, pt: Pt = p.doc): Pt => {
  if (!snapping(p)) return pt;
  const step = S().settings.snapStep;
  return { x: snapValue(pt.x, step), y: snapValue(pt.y, step) };
};

const movedFar = (a: Ptr, b: Ptr) => dist(a.screen, b.screen) >= DRAG_THRESHOLD;

/** Click tolerance for picking, in document units. */
export const pickTolerance = (zoom: number): number => 6 / zoom;

const noop: Gesture = { move() {}, up() {}, cancel() {} };

/* ------------------------------------------------------------------ viewport */

export function panGesture(start: Ptr, ctx: GestureContext): Gesture {
  const v0 = ctx.view();
  return {
    move: (p) => ctx.setView({ ...v0, x: v0.x + p.screen.x - start.screen.x, y: v0.y + p.screen.y - start.screen.y }),
    up() {},
    cancel: () => ctx.setView(v0),
  };
}

/* ----------------------------------------------------------------- selecting */

const fmtAngle = (rad: number) => `${fmt(Math.round(((rad * 180) / Math.PI) * 10) / 10, 1)}°`;

function moveGesture(ids: string[], start: Ptr, onClick: () => void): Gesture {
  let started = false;
  let base = S().doc;
  let moving = ids;
  const box = boundsOf(base, ids);
  return {
    move(p) {
      if (!started) {
        if (!movedFar(start, p)) return;
        started = true;
        store.begin();
        // Alt-drag drags a copy.
        if (p.alt) {
          const c = cloneInPlace(base, ids);
          base = c.doc;
          moving = c.ids;
          store.setDoc(base, { selection: normalizeSelection(base, moving) });
        }
      }
      let dx = p.doc.x - start.doc.x;
      let dy = p.doc.y - start.doc.y;
      if (p.shift) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (box && snapping(p)) ({ dx, dy } = snapMove(box, dx, dy, S().settings.snapStep));
      store.setDoc(transformNodes(base, moving, translate(dx, dy)));
    },
    up() {
      if (started) store.end();
      else onClick();
    },
    cancel() {
      if (started) store.abort();
    },
  };
}

function marqueeGesture(start: Ptr, additive: boolean): Gesture {
  const initial = S().selection;
  const doc = S().doc;
  const scope = S().scope;
  let started = false;
  return {
    move(p) {
      if (!started && !movedFar(start, p)) return;
      started = true;
      const mode: MarqueeMode = p.alt ? (S().settings.selectMode === 'encompass' ? 'touch' : 'encompass') : S().settings.selectMode;
      const rect = rectFromPoints(start.doc, p.doc);
      const hit = marqueeSelect(doc, scope, rect, mode);
      setSelection(additive ? [...initial, ...hit] : hit);
      store.patch({ overlay: { kind: 'marquee', rect, mode } });
    },
    up() {
      if (!started && !additive) setSelection([]);
      store.patch({ overlay: null });
    },
    cancel() {
      setSelection(initial);
      store.patch({ overlay: null });
    },
  };
}

const matrixLabel = (box: Rect, m: Matrix): string => {
  const w = box.w * Math.hypot(m[0], m[1]);
  const h = box.h * Math.hypot(m[2], m[3]);
  return `${fmt(w, 2)} × ${fmt(h, 2)}`;
};

/** Previews `m` applied to the selection, with the oriented box and a readout. */
function previewTransform(base: Doc, ids: string[], box: Rect, m: Matrix, label: string, pivot?: Pt): void {
  const strokeScale = S().settings.scaleStroke ? meanScale(m) : 1;
  store.setDoc(transformNodes(base, ids, m, { strokeScale }), { overlay: { kind: 'box', box, m, label, pivot } });
}

function resizeGesture(handle: HandleId, ids: string[], box: Rect): Gesture {
  const base = S().doc;
  store.begin();
  return {
    move(p) {
      const step = S().settings.snapStep;
      const m = resizeMatrix(box, handle, p.doc, { uniform: p.shift, fromCenter: p.alt, snap: snapping(p) ? (v) => snapValue(v, step) : undefined });
      previewTransform(base, ids, box, m, matrixLabel(box, m));
    },
    up: () => store.end(),
    cancel: () => store.abort(),
  };
}

function rotateGesture(pivot: Pt, ids: string[], box: Rect, start: Ptr): Gesture {
  const base = S().doc;
  store.begin();
  return {
    move(p) {
      const a = rotationAngle(pivot, start.doc, p.doc, p.shift ? 15 : undefined);
      previewTransform(base, ids, box, rotateAbout(a, pivot), fmtAngle(a), pivot);
    },
    up: () => store.end(),
    cancel: () => store.abort(),
  };
}

function scaleToolGesture(kind: ScaleTool, pivot: Pt, ids: string[], box: Rect, start: Ptr, ctx: GestureContext): Gesture {
  const base = S().doc;
  store.begin();
  return {
    move(p) {
      const { sx, sy } = toolScale(kind, pivot, start.doc, p.doc, ctx.view().zoom, p.shift);
      const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
      const label = kind === 'h' ? `↔ ${pct(sx)}` : kind === 'v' ? `↕ ${pct(sy)}` : sx === sy ? pct(sx) : `${pct(sx)} × ${pct(sy)}`;
      previewTransform(base, ids, box, scaleAbout(sx, sy, pivot), label, pivot);
    },
    up: () => store.end(),
    cancel: () => store.abort(),
  };
}

/** Moves the pivot of the transform tools; it jumps to the box's corners, edges and centre when close to them. */
function pivotGesture(box: Rect, ctx: GestureContext): Gesture {
  const initial = S().pivot;
  return {
    move(p) {
      const z = ctx.view().zoom;
      let best: Pt | null = null;
      let bestKey: { fx: number; fy: number } | null = null;
      for (const fy of [0, 0.5, 1]) {
        for (const fx of [0, 0.5, 1]) {
          const q = pointOnBox(box, { x: fx, y: fy });
          if (dist(q, p.doc) * z < 10 && (!best || dist(q, p.doc) < dist(best, p.doc))) {
            best = q;
            bestKey = { fx, fy };
          }
        }
      }
      if (bestKey) store.patch({ pivot: { kind: 'box', fx: bestKey.fx, fy: bestKey.fy } });
      else {
        const q = snapPoint(p);
        store.patch({ pivot: { kind: 'point', x: q.x, y: q.y } });
      }
    },
    up() {},
    cancel: () => store.patch({ pivot: initial }),
  };
}

const SCALE_TOOLS: Partial<Record<ToolId, ScaleTool>> = { scale: 'both', scaleH: 'h', scaleV: 'v' };

function selectGesture(start: Ptr, hit: string | null, ctx: GestureContext): Gesture {
  const s = S();
  const ids = liveSelection();
  const box = boundsOf(s.doc, ids);
  if (hit && box && ids.length) {
    if (hit.startsWith('resize:')) return resizeGesture(hit.slice(7) as HandleId, ids, box);
    if (hit.startsWith('rotate:')) return rotateGesture(pivotPoint(box, CENTER_PIVOT), ids, box, start);
  }
  const zoom = ctx.view().zoom;
  const target = hitTest(s.doc, start.doc, s.scope, pickTolerance(zoom), start.mod);
  if (target) {
    const selected = ids.includes(target);
    if (start.shift) {
      if (selected) return moveGesture(ids, start, () => setSelection(ids.filter((i) => i !== target)));
      const next = [...ids, target];
      setSelection(next);
      return moveGesture(next, start, () => {});
    }
    if (selected) return moveGesture(ids, start, () => (ids.length > 1 ? setSelection([target]) : undefined));
    // A click on something deep inside a closed group with Ctrl/⌘ held selects the shape itself and opens its group.
    if (start.mod) {
      const parent = locate(s.doc, target)?.parent?.id ?? null;
      setSelection([target], parent);
    } else setSelection([target]);
    return moveGesture([target], start, () => {});
  }
  return marqueeGesture(start, start.shift);
}

function transformToolGesture(tool: ToolId, start: Ptr, hit: string | null, ctx: GestureContext): Gesture {
  const s = S();
  const ids = liveSelection();
  const box = boundsOf(s.doc, ids);
  if (hit === 'pivot' && box) return pivotGesture(box, ctx);
  // Clicking something that is not selected selects it, like the select tool does.
  const target = hitTest(s.doc, start.doc, s.scope, pickTolerance(ctx.view().zoom));
  if (target && !ids.includes(target)) {
    setSelection([target]);
    return noop;
  }
  if (!box || !ids.length) {
    if (!target) return marqueeGesture(start, start.shift);
    return noop;
  }
  const pivot = pivotPoint(box, s.pivot);
  if (tool === 'rotate') return rotateGesture(pivot, ids, box, start);
  return scaleToolGesture(SCALE_TOOLS[tool]!, pivot, ids, box, start, ctx);
}

/* -------------------------------------------------------------------- drawing */

function newShapeGesture(make: (a: Pt, b: Pt, p: Ptr) => Geometry | null, start: Ptr): Gesture {
  const base = S().doc;
  const scope = S().scope;
  const id = uid();
  const a = snapPoint(start);
  let started = false;
  return {
    move(p) {
      if (!started) {
        if (!movedFar(start, p)) return;
        started = true;
        store.begin();
      }
      const geom = make(a, snapPoint(p), p);
      const node: Node = { type: 'shape', id, geom: geom ?? { kind: 'path', d: '' }, style: {}, hidden: geom ? undefined : true };
      store.setDoc(insertNodes(base, scope, null, [node]), { selection: [id], nodeSel: [] });
    },
    up() {
      if (started) {
        const n = findNode(S().doc, id);
        if (!n || n.hidden) store.abort();
        else store.end();
      }
    },
    cancel() {
      if (started) store.abort();
    },
  };
}

const MIN_SIZE = 0.2;

function rectGeom(a: Pt, b: Pt, p: Ptr): Geometry | null {
  let w = b.x - a.x;
  let h = b.y - a.y;
  if (p.shift) {
    const m = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * m;
    h = Math.sign(h || 1) * m;
  }
  let x = a.x;
  let y = a.y;
  if (p.alt) {
    x = a.x - w;
    y = a.y - h;
    w *= 2;
    h *= 2;
  }
  const r = { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) };
  if (r.w < MIN_SIZE || r.h < MIN_SIZE) return null;
  return { kind: 'rect', x: r.x, y: r.y, width: r.w, height: r.h, rx: 0, ry: 0 };
}

function ellipseGeom(a: Pt, b: Pt, p: Ptr): Geometry | null {
  let w = b.x - a.x;
  let h = b.y - a.y;
  if (p.shift) {
    const m = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * m;
    h = Math.sign(h || 1) * m;
  }
  let cx = a.x + w / 2;
  let cy = a.y + h / 2;
  let rx = Math.abs(w) / 2;
  let ry = Math.abs(h) / 2;
  if (p.alt) {
    cx = a.x;
    cy = a.y;
    rx = Math.abs(w);
    ry = Math.abs(h);
  }
  if (rx * 2 < MIN_SIZE || ry * 2 < MIN_SIZE) return null;
  return Math.abs(rx - ry) < 1e-9 ? { kind: 'circle', cx, cy, r: rx } : { kind: 'ellipse', cx, cy, rx, ry };
}

function lineGeom(a: Pt, b: Pt, p: Ptr): Geometry | null {
  let end = b;
  if (p.shift) {
    const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 12)) * (Math.PI / 12);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    end = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
    if (snapping(p)) end = { x: snapValue(end.x, S().settings.snapStep), y: snapValue(end.y, S().settings.snapStep) };
  }
  if (Math.hypot(end.x - a.x, end.y - a.y) < MIN_SIZE) return null;
  const from = p.alt ? { x: 2 * a.x - end.x, y: 2 * a.y - end.y } : a;
  return { kind: 'line', x1: from.x, y1: from.y, x2: end.x, y2: end.y };
}

function penGesture(start: Ptr, ctx: GestureContext): Gesture {
  const pen = S().pen ?? { nodes: [], cursor: null };
  const pt = snapPoint(start);
  const zoom = ctx.view().zoom;
  const first = pen.nodes[0];
  if (pen.nodes.length >= 2 && first && dist(first, pt) * zoom < 10) {
    finishPen(true);
    return noop;
  }
  const last = pen.nodes[pen.nodes.length - 1];
  // A second click on the same spot (a double-click) ends the path.
  if (last && last.x === pt.x && last.y === pt.y && pen.nodes.length >= 2) {
    finishPen(false);
    return noop;
  }
  store.patch({ pen: { nodes: [...pen.nodes, makeNode(pt.x, pt.y)], cursor: pt } });
  let dragged = false;
  return {
    move(p) {
      if (!dragged && !movedFar(start, p)) return;
      dragged = true;
      const h = snapPoint(p);
      const cur = S().pen;
      if (!cur) return;
      const nodes = cur.nodes.slice();
      const n = nodes[nodes.length - 1]!;
      if (Math.hypot(h.x - n.x, h.y - n.y) < 1e-9) return;
      nodes[nodes.length - 1] = { ...n, hout: h, hin: { x: 2 * n.x - h.x, y: 2 * n.y - h.y } };
      store.patch({ pen: { ...cur, nodes } });
    },
    up() {},
    cancel() {},
  };
}

/* ---------------------------------------------------------------- node editing */

/** Previews a change to the points of the shape being edited; the shape becomes a path on the first change. */
function editPoints(base: Doc, id: string, subs: SubPath[]): void {
  store.setDoc(updateNode(base, id, (n) => (n.type === 'shape' ? { ...n, geom: geomFromSubPaths(subs) } : n)));
}

function nodeDragGesture(id: string, grabbed: NodeRef, start: Ptr): Gesture {
  const base = S().doc;
  const subs0 = subPathsOf(id);
  const keys = S().nodeSel;
  const refs = keys.map(parseNodeKey);
  const grab = subs0[grabbed.sub]!.nodes[grabbed.idx]!;
  let started = false;
  return {
    move(p) {
      if (!started) {
        if (!movedFar(start, p)) return;
        started = true;
        store.begin();
      }
      let dx = p.doc.x - start.doc.x;
      let dy = p.doc.y - start.doc.y;
      if (p.shift) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (snapping(p)) {
        const t = snapPoint(p, { x: grab.x + dx, y: grab.y + dy });
        dx = t.x - grab.x;
        dy = t.y - grab.y;
      }
      editPoints(base, id, moveNodes(subs0, refs, dx, dy));
    },
    up() {
      if (started) store.end();
    },
    cancel() {
      if (started) store.abort();
    },
  };
}

function handleDragGesture(id: string, ref: NodeRef & { which: 'in' | 'out' }, start: Ptr): Gesture {
  const base = S().doc;
  const subs0 = subPathsOf(id);
  const coupled = isSmooth(subs0[ref.sub]!.nodes[ref.idx]!);
  let started = false;
  return {
    move(p) {
      if (!started) {
        if (!movedFar(start, p)) return;
        started = true;
        store.begin();
      }
      const to = snapPoint(p);
      editPoints(base, id, setHandle(subs0, ref, to, coupled && !p.alt));
    },
    up() {
      if (started) store.end();
    },
    cancel() {
      if (started) store.abort();
    },
  };
}

function nodeMarqueeGesture(id: string, start: Ptr, additive: boolean): Gesture {
  const initial = S().nodeSel;
  const subs = subPathsOf(id);
  let started = false;
  return {
    move(p) {
      if (!started && !movedFar(start, p)) return;
      started = true;
      const rect = rectFromPoints(start.doc, p.doc);
      const keys: string[] = [];
      subs.forEach((sp, si) =>
        sp.nodes.forEach((n, ni) => {
          if (n.x >= rect.x && n.x <= rect.x + rect.w && n.y >= rect.y && n.y <= rect.y + rect.h) keys.push(`${si}:${ni}`);
        }),
      );
      store.patch({ nodeSel: additive ? [...new Set([...initial, ...keys])] : keys, overlay: { kind: 'marquee', rect, mode: 'encompass' } });
    },
    up() {
      if (!started && !additive) store.patch({ nodeSel: [] });
      store.patch({ overlay: null });
    },
    cancel() {
      store.patch({ nodeSel: initial, overlay: null });
    },
  };
}

function nodeToolGesture(start: Ptr, hit: string | null, ctx: GestureContext): Gesture {
  const s = S();
  const id = nodeTargetId();
  if (id && hit?.startsWith('node:')) {
    const [, si, ni] = hit.split(':');
    const ref = { sub: Number(si), idx: Number(ni) };
    const key = `${ref.sub}:${ref.idx}`;
    const sel = s.nodeSel;
    if (start.shift) store.patch({ nodeSel: sel.includes(key) ? sel.filter((k) => k !== key) : [...sel, key] });
    else if (!sel.includes(key)) store.patch({ nodeSel: [key] });
    if (!S().nodeSel.includes(key)) return noop;
    return nodeDragGesture(id, ref, start);
  }
  if (id && hit?.startsWith('handle:')) {
    const [, si, ni, which] = hit.split(':');
    return handleDragGesture(id, { sub: Number(si), idx: Number(ni), which: which as 'in' | 'out' }, start);
  }
  // Another shape: edit that one instead.
  const target = hitTest(s.doc, start.doc, s.scope, pickTolerance(ctx.view().zoom), true);
  if (target && target !== id) {
    setSelection([target], locate(s.doc, target)?.parent?.id ?? null);
    return noop;
  }
  if (id && !target) return nodeMarqueeGesture(id, start, start.shift);
  if (!target) return marqueeGesture(start, start.shift);
  return noop;
}

/* ------------------------------------------------------------------- dispatch */

/** What the pointer is over among the overlay's handles, from the `data-hit` attribute of the element under it. */
export type Hit = string | null;

export function startGesture(tool: ToolId, p: Ptr, hit: Hit, ctx: GestureContext): Gesture {
  switch (tool) {
    case 'hand':
      return panGesture(p, ctx);
    case 'select':
      return selectGesture(p, hit, ctx);
    case 'node':
      return nodeToolGesture(p, hit, ctx);
    case 'rect':
      return newShapeGesture(rectGeom, p);
    case 'ellipse':
      return newShapeGesture(ellipseGeom, p);
    case 'line':
      return newShapeGesture(lineGeom, p);
    case 'pen':
      return penGesture(p, ctx);
    case 'scale':
    case 'scaleH':
    case 'scaleV':
    case 'rotate':
      return transformToolGesture(tool, p, hit, ctx);
  }
}

/* The gesture under way, so that Escape (anywhere) can cancel it. */
let active: Gesture | null = null;

/**
 * Starts tracking a gesture. Once it has been cancelled it ignores the rest of the pointer's movement and its
 * release, so cancelling in the middle of a drag cannot leave stray changes behind.
 */
export function track(g: Gesture): Gesture {
  let dead = false;
  const tracked: Gesture = {
    move: (p) => void (dead || g.move(p)),
    up: (p) => void (dead || g.up(p)),
    cancel() {
      if (dead) return;
      dead = true;
      g.cancel();
    },
  };
  active = tracked;
  return tracked;
}

export const untrack = (): void => void (active = null);

export function cancelActiveGesture(): boolean {
  if (!active) return false;
  active.cancel();
  active = null;
  return true;
}
