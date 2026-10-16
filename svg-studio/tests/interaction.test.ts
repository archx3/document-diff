import { describe, expect, it } from 'vitest';
import { boundsOf, findNode, groupNodes, transformNodes } from '../src/core/doc';
import type { Rect } from '../src/core/geometry';
import { apply, type Matrix } from '../src/core/matrix';
import { deleteNodes, fromSubPaths, insertNode, isSmooth, moveNodes, nearestOnSubPaths, setHandle, setNodeType, toSubPaths } from '../src/core/nodes';
import { parsePath, serializePath } from '../src/core/path';
import { hitTest, marqueeSelect } from '../src/core/pick';
import {
  alignDeltas,
  distributeDeltas,
  flipMatrix,
  resizeMatrix,
  resizeToMatrix,
  rotateByDegrees,
  rotationAngle,
  snapMove,
  snapValue,
  toolScale,
} from '../src/core/transform';
import type { Doc, Geometry, Node } from '../src/core/types';

const shape = (id: string, geom: Geometry, style: Node['style'] = {}): Node => ({ type: 'shape', id, geom, style });
const rect = (id: string, x: number, y: number, w: number, h: number, style: Node['style'] = {}) => shape(id, { kind: 'rect', x, y, width: w, height: h, rx: 0, ry: 0 }, style);
const mkdoc = (children: Node[]): Doc => ({ width: 24, height: 24, defaults: { stroke: 'currentColor', strokeWidth: 2, fill: 'none' }, children });
const box = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe('marquee selection', () => {
  const doc = mkdoc([
    rect('inside', 4, 4, 4, 4),
    shape('circle', { kind: 'circle', cx: 14, cy: 6, r: 3 }),
    shape('line', { kind: 'line', x1: 2, y1: 20, x2: 22, y2: 20 }),
    rect('partly', 8, 8, 10, 10),
  ]);

  it('encompass selects only what lies completely inside the rectangle', () => {
    expect(marqueeSelect(doc, null, box(0, 0, 12, 12), 'encompass')).toEqual(['inside']);
    expect(marqueeSelect(doc, null, box(0, 0, 18, 12), 'encompass')).toEqual(['inside', 'circle']);
    expect(marqueeSelect(doc, null, box(0, 0, 24, 24), 'encompass')).toEqual(['inside', 'circle', 'line', 'partly']);
    // The circle's box reaches x = 17: a rectangle ending at 16 only crosses it.
    expect(marqueeSelect(doc, null, box(0, 0, 16, 12), 'encompass')).toEqual(['inside']);
  });

  it('the outline touching the edge still counts as inside', () => {
    expect(marqueeSelect(doc, null, box(4, 4, 4, 4), 'encompass')).toEqual(['inside']);
  });

  it('touch also selects what the rectangle only crosses, stroke included', () => {
    expect(marqueeSelect(doc, null, box(0, 0, 16, 12), 'touch')).toEqual(['inside', 'circle', 'partly']);
    // The line at y = 20 has a stroke 2 wide (19 to 21): a rectangle in the stroke but off the line itself touches it.
    expect(marqueeSelect(doc, null, box(10, 19.2, 2, 0.4), 'touch')).toEqual(['line']);
    expect(marqueeSelect(doc, null, box(10, 19.2, 2, 0.4), 'encompass')).toEqual([]);
  });

  it('an unfilled shape is not touched by a rectangle that only sits in its hollow', () => {
    expect(marqueeSelect(doc, null, box(13.5, 5.5, 1, 1), 'touch')).toEqual([]);
    const filled = mkdoc([shape('disc', { kind: 'circle', cx: 12, cy: 12, r: 8 }, { fill: 'red' })]);
    expect(marqueeSelect(filled, null, box(11, 11, 2, 2), 'touch')).toEqual(['disc']);
  });

  it('treats a group as one item and works inside an open group', () => {
    const g = groupNodes(doc, ['inside', 'circle'])!;
    // The group's box spans x 4..17, y 3..9.
    expect(marqueeSelect(g.doc, null, box(0, 0, 18, 12), 'encompass')).toEqual([g.groupId]);
    expect(marqueeSelect(g.doc, null, box(0, 0, 12, 12), 'encompass')).toEqual([]);
    expect(marqueeSelect(g.doc, g.groupId, box(0, 0, 12, 12), 'encompass')).toEqual(['inside']);
    expect(marqueeSelect(g.doc, null, box(0, 0, 12, 12), 'touch')).toEqual([g.groupId, 'partly']);
  });

  it('skips hidden and locked layers', () => {
    const d = mkdoc([{ ...rect('h', 1, 1, 2, 2), hidden: true }, { ...rect('l', 1, 1, 2, 2), locked: true }, rect('ok', 1, 1, 2, 2)]);
    expect(marqueeSelect(d, null, box(0, 0, 24, 24), 'encompass')).toEqual(['ok']);
  });
});

describe('hit testing', () => {
  const doc = mkdoc([rect('frame', 2, 2, 20, 20), shape('disc', { kind: 'circle', cx: 12, cy: 12, r: 3 }, { fill: 'blue' })]);
  it('hits strokes within a tolerance and filled areas, topmost first', () => {
    expect(hitTest(doc, { x: 2, y: 10 }, null, 0.2)).toBe('frame');
    expect(hitTest(doc, { x: 3.1, y: 10 }, null, 0.2)).toBe('frame'); // within half the stroke (1) + tol
    expect(hitTest(doc, { x: 6, y: 10 }, null, 0.2)).toBeNull(); // the hollow inside the frame
    expect(hitTest(doc, { x: 12, y: 12 }, null, 0.2)).toBe('disc');
  });
  it('a click inside a closed group picks the group, with deep the shape', () => {
    const g = groupNodes(doc, ['frame', 'disc'])!;
    expect(hitTest(g.doc, { x: 12, y: 12 }, null, 0.2)).toBe(g.groupId);
    expect(hitTest(g.doc, { x: 12, y: 12 }, null, 0.2, true)).toBe('disc');
    expect(hitTest(g.doc, { x: 12, y: 12 }, g.groupId, 0.2)).toBe('disc');
  });
});

describe('scale and rotate tools', () => {
  const b = box(4, 4, 8, 4);

  it('a corner handle scales both axes about the opposite corner', () => {
    const m = resizeMatrix(b, 'se', { x: 20, y: 12 });
    expect(apply(m, 12, 8)).toEqual({ x: 20, y: 12 });
    expect(apply(m, 4, 4)).toEqual({ x: 4, y: 4 });
  });
  it('a side handle scales one axis only', () => {
    const e = resizeMatrix(b, 'e', { x: 20, y: 99 });
    expect(apply(e, 12, 8)).toEqual({ x: 20, y: 8 });
    const s = resizeMatrix(b, 's', { x: 99, y: 16 });
    expect(apply(s, 12, 8)).toEqual({ x: 12, y: 16 });
  });
  it('shift keeps proportions, alt scales from the centre', () => {
    const u = resizeMatrix(b, 'se', { x: 20, y: 9 }, { uniform: true }); // x wants 2x, y wants 1.25x: the larger wins
    expect(apply(u, 12, 8)).toEqual({ x: 20, y: 12 });
    const c = resizeMatrix(b, 'e', { x: 16, y: 6 }, { fromCenter: true }); // centre x = 8, handle at 12 -> 16
    expect(apply(c, 12, 6).x).toBeCloseTo(16);
    expect(apply(c, 4, 6).x).toBeCloseTo(0);
    const edge = resizeMatrix(b, 'e', { x: 20, y: 6 }, { uniform: true });
    expect(apply(edge, 12, 6).x).toBeCloseTo(20);
    expect(apply(edge, 8, 8).y).toBeCloseTo(8 + 2 * 1); // height doubled about the centre y = 6
  });
  it('dragging past the opposite side flips the selection', () => {
    const m = resizeMatrix(b, 'e', { x: 0, y: 6 });
    expect(m[0]).toBeLessThan(0);
    expect(apply(m, 12, 6).x).toBeCloseTo(0);
  });
  it('snaps the dragged edge to the grid', () => {
    const m = resizeMatrix(b, 'e', { x: 13.4, y: 6 }, { snap: (v) => snapValue(v, 1) });
    expect(apply(m, 12, 6).x).toBe(13);
  });

  it('scale H, V and both tools follow the pointer from the pivot', () => {
    const pivot = { x: 0, y: 0 };
    const start = { x: 10, y: 10 };
    expect(toolScale('h', pivot, start, { x: 20, y: 30 }, 10)).toEqual({ sx: 2, sy: 1 });
    expect(toolScale('v', pivot, start, { x: 20, y: 30 }, 10)).toEqual({ sx: 1, sy: 3 });
    const both = toolScale('both', pivot, start, { x: 20, y: 20 }, 10);
    expect(both.sx).toBeCloseTo(2);
    expect(both.sy).toBeCloseTo(2);
    const free = toolScale('both', pivot, start, { x: 20, y: 30 }, 10, true);
    expect(free).toEqual({ sx: 2, sy: 3 });
  });
  it('starting a drag at the pivot does not blow up', () => {
    const r = toolScale('h', { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5.5, y: 5 }, 10);
    expect(Number.isFinite(r.sx)).toBe(true);
    expect(r.sx).toBeGreaterThan(1);
    expect(r.sx).toBeLessThan(2);
  });
  it('rotation follows the angle swept around the pivot and snaps with shift', () => {
    const pivot = { x: 10, y: 10 };
    expect(rotationAngle(pivot, { x: 20, y: 10 }, { x: 10, y: 20 })).toBeCloseTo(Math.PI / 2); // clockwise on screen
    expect(rotationAngle(pivot, { x: 20, y: 10 }, { x: 19, y: 12 }, 15) * (180 / Math.PI)).toBeCloseTo(15);
    expect(rotationAngle(pivot, { x: 20, y: 10 }, { x: 0, y: 11 })).toBeCloseTo(Math.PI - Math.atan2(1, 10), 5);
  });
  it('numeric rotate, flip and resize use the pivot', () => {
    const r = rotateByDegrees(90, { x: 5, y: 5 });
    expect(apply(r, 10, 5).x).toBeCloseTo(5);
    expect(apply(r, 10, 5).y).toBeCloseTo(10);
    expect(apply(flipMatrix('h', { x: 5, y: 0 }), 8, 3)).toEqual({ x: 2, y: 3 });
    expect(apply(flipMatrix('v', { x: 0, y: 5 }), 8, 3)).toEqual({ x: 8, y: 7 });
    const m = resizeToMatrix(b, 16, null, { x: 4, y: 4 });
    expect(apply(m, 12, 8)).toEqual({ x: 20, y: 8 });
  });
});

describe('transforming a group of paths', () => {
  const doc = mkdoc([
    shape('p1', { kind: 'path', d: 'M4 4h8v4H4z' }),
    shape('p2', { kind: 'path', d: 'M6 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0' }),
    rect('outside', 18, 18, 2, 2),
  ]);
  const g = groupNodes(doc, ['p1', 'p2'])!;

  it('scales every path in the group about one pivot', () => {
    const before = boundsOf(g.doc, [g.groupId])!;
    expect(before).toEqual({ x: 4, y: 4, w: 8, h: 11 });
    const out = transformNodes(g.doc, [g.groupId], resizeToMatrix(before, 16, null, { x: 4, y: 4 }));
    expect(boundsOf(out, [g.groupId])).toEqual({ x: 4, y: 4, w: 16, h: 11 });
    // The relative layout is kept: the arc path doubled in width too.
    expect(boundsOf(out, ['p2'])!.w).toBeCloseTo(12);
    expect(boundsOf(out, ['p2'])!.x).toBeCloseTo(8);
    expect(findNode(out, 'outside')).toBe(findNode(g.doc, 'outside'));
  });

  it('rotates a group as a whole', () => {
    const before = boundsOf(g.doc, [g.groupId])!;
    const pivot = { x: before.x + before.w / 2, y: before.y + before.h / 2 };
    const out = transformNodes(g.doc, [g.groupId], rotateByDegrees(90, pivot));
    const after = boundsOf(out, [g.groupId])!;
    expect(after.w).toBeCloseTo(11, 2);
    expect(after.h).toBeCloseTo(8, 2);
    expect(after.x + after.w / 2).toBeCloseTo(pivot.x, 2);
  });

  it('flips a group', () => {
    const before = boundsOf(g.doc, [g.groupId])!;
    const out = transformNodes(g.doc, [g.groupId], flipMatrix('h', { x: before.x + before.w / 2, y: 0 }));
    expect(boundsOf(out, [g.groupId])).toEqual(before);
    expect((findNode(out, 'p1') as { geom: { d: string } }).geom.d).not.toBe('M4 4h8v4H4z');
  });
});

describe('snapping and alignment', () => {
  it('snaps the nearest edge of a moved box to the grid', () => {
    expect(snapMove(box(2, 2, 4, 4), 0.3, 0.2, 1)).toEqual({ dx: 0, dy: 0 });
    const r = snapMove(box(2.4, 2, 3, 2), 0.1, 0, 1); // left 2.5 -> 3 (0.5), centre 4 -> 4 (0)
    expect(r.dx).toBeCloseTo(0.1 + 0);
    expect(snapValue(2.26, 0.25)).toBe(2.25);
  });
  it('aligns and distributes', () => {
    const boxes = new Map<string, Rect>([['a', box(0, 0, 2, 2)], ['b', box(5, 3, 4, 2)], ['c', box(20, 10, 2, 2)]]);
    expect(alignDeltas(boxes, 'right', box(0, 0, 24, 24)).get('a')).toEqual({ x: 22, y: 0 });
    expect(alignDeltas(boxes, 'middle', box(0, 0, 24, 24)).get('b')).toEqual({ x: 0, y: 8 });
    const d = distributeDeltas(boxes, 'h');
    expect(d.get('a')).toEqual({ x: 0, y: 0 });
    expect(d.get('c')).toEqual({ x: 0, y: 0 });
    // Widths 2 + 4 + 2 = 8 in a span of 22: two gaps of 7, so b starts at 9.
    expect(d.get('b')).toEqual({ x: 4, y: 0 });
  });
});

describe('node editing', () => {
  const roundtrip = (d: string) => serializePath(fromSubPaths(toSubPaths(parsePath(d).segs)));

  it('round-trips lines, curves, arcs and closed shapes', () => {
    for (const d of ['M2 12h20', 'M3 3h18v18H3z', 'M4 20C4 10 20 10 20 20', 'M21 12a9 9 0 1 1-6.219-8.56', 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z']) {
      const once = roundtrip(d);
      expect(roundtrip(once)).toBe(once);
      expect(serializePath(parsePath(d).segs)).toBe(once);
    }
  });

  it('treats a repeated closing point as one node', () => {
    const subs = toSubPaths(parsePath('M0 0L10 0L10 10L0 0Z').segs);
    expect(subs[0]!.nodes).toHaveLength(3);
    expect(subs[0]!.closed).toBe(true);
  });

  it('moves a node together with its handles', () => {
    const subs = toSubPaths(parsePath('M0 0C0 5 5 10 10 10').segs);
    const moved = moveNodes(subs, [{ sub: 0, idx: 1 }], 2, 3);
    expect(serializePath(fromSubPaths(moved))).toBe('M0 0c0 5 7 13 12 13');
  });

  it('splits a curve without changing its shape, and a line at the point clicked', () => {
    const subs = toSubPaths(parsePath('M0 0C0 10 10 10 10 0').segs);
    const { subs: split, ref } = insertNode(subs, 0, 0, 0.5);
    expect(split[0]!.nodes).toHaveLength(3);
    expect(split[0]!.nodes[ref.idx]).toMatchObject({ x: 5, y: 7.5 });
    expect(isSmooth(split[0]!.nodes[ref.idx]!)).toBe(true);
    const near = nearestOnSubPaths(toSubPaths(parsePath('M0 0L10 0').segs), { x: 3, y: 2 })!;
    expect(near.point.x).toBeCloseTo(3);
    expect(near.dist).toBeCloseTo(2);
    const line = insertNode(toSubPaths(parsePath('M0 0L10 0').segs), 0, 0, near.t);
    expect(serializePath(fromSubPaths(line.subs))).toBe('M0 0h3 7');
  });

  it('splits an arc into two arcs that follow the same circle', () => {
    const subs = toSubPaths(parsePath('M-5 0A5 5 0 0 1 5 0').segs);
    const { subs: split } = insertNode(subs, 0, 0, 0.5);
    const out = fromSubPaths(split);
    expect(out).toHaveLength(3);
    expect(out[1]).toMatchObject({ t: 'A', rx: 5, ry: 5 });
    expect((out[1] as { x: number }).x).toBeCloseTo(0);
    expect((out[1] as { y: number }).y).toBeCloseTo(-5);
  });

  it('deletes nodes, keeps the neighbours, drops paths that become too short', () => {
    const subs = toSubPaths(parsePath('M0 0L5 0L10 0L10 5').segs);
    expect(serializePath(fromSubPaths(deleteNodes(subs, [{ sub: 0, idx: 1 }])))).toBe('M0 0h10v5');
    expect(deleteNodes(toSubPaths(parsePath('M0 0L5 5').segs), [{ sub: 0, idx: 0 }])).toEqual([]);
  });

  it('makes nodes smooth or corners, and keeps a smooth node smooth when a handle is dragged', () => {
    const subs = toSubPaths(parsePath('M0 0L10 0L20 10').segs);
    const smooth = setNodeType(subs, { sub: 0, idx: 1 }, 'smooth');
    const n = smooth[0]!.nodes[1]!;
    expect(isSmooth(n)).toBe(true);
    expect(setNodeType(smooth, { sub: 0, idx: 1 }, 'corner')[0]!.nodes[1]).toMatchObject({ hin: null, hout: null });
    const dragged = setHandle(smooth, { sub: 0, idx: 1, which: 'out' }, { x: 10, y: 8 }, true);
    expect(isSmooth(dragged[0]!.nodes[1]!)).toBe(true);
    expect(dragged[0]!.nodes[1]!.hin!.y).toBeLessThan(10);
    const free = setHandle(smooth, { sub: 0, idx: 1, which: 'out' }, { x: 10, y: 8 }, false);
    expect(free[0]!.nodes[1]!.hin).toEqual(n.hin);
  });
});

// Keeps the matrix type import used in this file.
export type _M = Matrix;
