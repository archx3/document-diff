import { describe, expect, it } from 'vitest';
import { boundsOf, editableIds, findNode, groupNodes, locate, moveNodes, normalizeSelection, orderIds, arrange, reconcileIds, selectableIn, transformNodes, ungroupNodes, removeNodes, cloneNodes, resolveStyle } from '../src/core/doc';
import { geomBounds, geomToPath, transformGeom } from '../src/core/shapes';
import { rotate, rotateAbout, scale, scaleAbout, translate, multiply } from '../src/core/matrix';
import { parseSvg, serializeSvg, serializeIconNode, serializeJsx, SvgParseError } from '../src/core/svg-io';
import type { Doc, Geometry, Node } from '../src/core/types';

const shape = (id: string, geom: Geometry, extra: Partial<Node> = {}): Node => ({ type: 'shape', id, geom, style: {}, ...extra }) as Node;
const rect = (id: string, x: number, y: number, w: number, h: number) => shape(id, { kind: 'rect', x, y, width: w, height: h, rx: 0, ry: 0 });
const mkdoc = (children: Node[]): Doc => ({ width: 24, height: 24, defaults: { stroke: 'currentColor', strokeWidth: 2, fill: 'none' }, children });

describe('transformGeom', () => {
  it('keeps rectangles as rectangles under axis-aligned scale and quarter turns', () => {
    const g: Geometry = { kind: 'rect', x: 2, y: 4, width: 10, height: 6, rx: 2, ry: 1 };
    expect(transformGeom(g, scaleAbout(2, 0.5, { x: 0, y: 0 }))).toEqual({ kind: 'rect', x: 4, y: 2, width: 20, height: 3, rx: 4, ry: 0.5 });
    const turned = transformGeom(g, rotateAbout(Math.PI / 2, { x: 12, y: 12 }));
    expect(turned.kind).toBe('rect');
    const b = geomBounds(turned)!;
    expect(b.w).toBeCloseTo(6);
    expect(b.h).toBeCloseTo(10);
    // Its corner radii trade places.
    expect((turned as { rx: number }).rx).toBeCloseTo(1);
    expect((turned as { ry: number }).ry).toBeCloseTo(2);
  });

  it('turns a rectangle into a path when it is rotated by something else', () => {
    const g = transformGeom({ kind: 'rect', x: 0, y: 0, width: 10, height: 4, rx: 0, ry: 0 }, rotate(Math.PI / 4));
    expect(g.kind).toBe('path');
    const b = geomBounds(g)!;
    expect(b.w).toBeCloseTo((10 + 4) * Math.SQRT1_2, 2);
  });

  it('keeps circles circles unless they are stretched', () => {
    const c: Geometry = { kind: 'circle', cx: 5, cy: 5, r: 2 };
    expect(transformGeom(c, rotateAbout(1, { x: 0, y: 0 })).kind).toBe('circle');
    expect(transformGeom(c, scaleAbout(2, 2, { x: 0, y: 0 }))).toEqual({ kind: 'circle', cx: 10, cy: 10, r: 4 });
    expect(transformGeom(c, scale(3, 1))).toEqual({ kind: 'ellipse', cx: 15, cy: 5, rx: 6, ry: 2 });
    expect(transformGeom({ kind: 'ellipse', cx: 0, cy: 0, rx: 1, ry: 3 }, scale(3, 1))).toEqual({ kind: 'circle', cx: 0, cy: 0, r: 3 });
    // Stretched and turned: only a path can describe it.
    expect(transformGeom(c, multiply(rotate(0.5), scale(3, 1))).kind).toBe('path');
  });

  it('the path of a shape covers the same area', () => {
    const shapes: Geometry[] = [
      { kind: 'rect', x: 1, y: 2, width: 8, height: 5, rx: 2, ry: 2 },
      { kind: 'circle', cx: 5, cy: 6, r: 3 },
      { kind: 'ellipse', cx: 5, cy: 6, rx: 4, ry: 2 },
      { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 4, y: 1 }, { x: 2, y: 5 }] },
      { kind: 'line', x1: 1, y1: 1, x2: 5, y2: 7 },
    ];
    for (const g of shapes) {
      const a = geomBounds(g)!;
      const b = geomBounds(geomToPath(g))!;
      expect([b.x, b.y, b.w, b.h].map((v) => +v.toFixed(3))).toEqual([a.x, a.y, a.w, a.h].map((v) => +v.toFixed(3)));
    }
  });
});

describe('svg import and export', () => {
  const lucide = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
    <circle cx="9" cy="9" r="2"/>
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
  </svg>`;

  it('reads a Lucide icon', () => {
    const { doc, warnings } = parseSvg(lucide);
    expect(warnings).toEqual([]);
    expect(doc.width).toBe(24);
    expect(doc.defaults).toMatchObject({ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' });
    expect(doc.children.map((n) => (n.type === 'shape' ? n.geom.kind : 'g'))).toEqual(['rect', 'circle', 'path']);
  });

  it('writes the icon back the way it was written', () => {
    const out = serializeSvg(parseSvg(lucide).doc);
    expect(out).toBe(`<svg
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect x="3" y="3" width="18" height="18" rx="2" />
  <circle cx="9" cy="9" r="2" />
  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
</svg>`);
  });

  it('bakes transforms into the shapes and shifts the view box origin to zero', () => {
    const { doc } = parseSvg(`<svg viewBox="10 10 20 20" xmlns="http://www.w3.org/2000/svg"><g transform="translate(5 0)"><rect x="12" y="12" width="4" height="4" transform="scale(2)"/></g></svg>`);
    expect(doc.width).toBe(20);
    const g = doc.children[0]!;
    expect(g.type).toBe('group');
    const r = (g as { children: Node[] }).children[0] as { geom: Geometry };
    // translate(5 0) · scale(2) on (12,12,4,4) -> (29, 24, 8, 8); then the origin moves by (-10, -10).
    expect(r.geom).toMatchObject({ kind: 'rect', x: 19, y: 14, width: 8, height: 8 });
  });

  it('takes style from inline CSS and reports what it cannot draw', () => {
    const { doc, warnings } = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1h5" style="stroke:red;stroke-width:3"/><text x="1" y="1">hi</text><image href="x"/></svg>`);
    expect((doc.children[0] as { style: unknown }).style).toMatchObject({ stroke: 'red', strokeWidth: 3 });
    expect(warnings.join(' ')).toMatch(/text, image/);
  });

  it('accepts bare path data and bare elements', () => {
    expect(parseSvg('M2 2l5 5').doc.children).toHaveLength(1);
    expect(parseSvg('<circle cx="5" cy="5" r="2"/><path d="M0 0h2"/>').doc.children).toHaveLength(2);
  });

  it('reads sloppy markup with the lenient parser', () => {
    const { doc } = parseSvg('<svg viewBox="0 0 16 16"><path d="M0 0h4"><circle cx=3 cy=3 r=1></svg>');
    expect(doc.width).toBe(16);
    expect(doc.children.length).toBeGreaterThan(0);
  });

  it('rejects text that is not an SVG', () => {
    expect(() => parseSvg('   ')).toThrow(SvgParseError);
    expect(() => parseSvg('<html><body>hello</body></html>')).not.toThrow(); // wrapped as an empty svg
    expect(parseSvg('<html><body>hello</body></html>').doc.children).toHaveLength(0);
  });

  it('leaves hidden layers out of exports but keeps them in the code view', () => {
    const doc = mkdoc([rect('a', 0, 0, 4, 4), { ...rect('b', 5, 5, 4, 4), hidden: true }]);
    expect(serializeSvg(doc)).not.toContain('y="5"');
    const code = serializeSvg(doc, { includeHidden: true });
    expect(code).toContain('display="none"');
    expect(parseSvg(code).doc.children[1]!.hidden).toBe(true);
  });

  it('writes JSX and Lucide icon nodes', () => {
    const doc = mkdoc([shape('a', { kind: 'circle', cx: 12, cy: 12, r: 10 }), shape('b', { kind: 'path', d: 'M2 2h4' }, { style: { strokeWidth: 3 } })]);
    expect(serializeJsx(doc, 'Dot')).toContain('strokeWidth="3"');
    expect(serializeJsx(doc, 'Dot')).toContain('{...props}');
    expect(serializeIconNode(doc)).toBe(`[\n  ["circle", { cx: "12", cy: "12", r: "10" }],\n  ["path", { d: "M2 2h4", stroke-width: "3" }],\n]`.replace('stroke-width:', '"stroke-width":'));
  });
});

describe('groups', () => {
  const base = () => mkdoc([rect('a', 0, 0, 4, 4), rect('b', 6, 0, 4, 4), rect('c', 12, 0, 4, 4), rect('d', 18, 0, 4, 4)]);

  it('groups nodes where the topmost of them was, keeping their order', () => {
    const r = groupNodes(base(), ['c', 'a'])!;
    expect(orderIds(r.doc)).toEqual(['b', r.groupId, 'a', 'c', 'd']);
    expect(r.doc.children.map((n) => n.id)).toEqual(['b', r.groupId, 'd']);
  });

  it('ungroups into the same place and passes the group style down', () => {
    const g = groupNodes(base(), ['b', 'c'])!;
    const styled = { ...g.doc, children: g.doc.children.map((n) => (n.id === g.groupId ? { ...n, style: { stroke: 'red' } } : n)) } as Doc;
    const u = ungroupNodes(styled, [g.groupId]);
    expect(u.ids).toEqual(['b', 'c']);
    expect(u.doc.children.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(u.doc.children[1]!.style.stroke).toBe('red');
  });

  it('nests groups and keeps the selection free of duplicates', () => {
    const g1 = groupNodes(base(), ['a', 'b'])!;
    const g2 = groupNodes(g1.doc, [g1.groupId, 'c'])!;
    expect(normalizeSelection(g2.doc, [g2.groupId, g1.groupId, 'a', 'd'])).toEqual([g2.groupId, 'd']);
    expect(locate(g2.doc, 'a')!.ancestors.map((g) => g.id)).toEqual([g2.groupId, g1.groupId]);
    expect(selectableIn(g2.doc, 'a', null)).toBe(g2.groupId);
    expect(selectableIn(g2.doc, 'a', g2.groupId)).toBe(g1.groupId);
    expect(selectableIn(g2.doc, 'a', g1.groupId)).toBe('a');
    expect(selectableIn(g2.doc, 'd', g1.groupId)).toBeNull();
  });

  it('moves nodes between groups but not a group into itself', () => {
    const g = groupNodes(base(), ['a', 'b'])!;
    const moved = moveNodes(g.doc, ['c'], g.groupId, 0);
    expect(((findNode(moved, g.groupId) as { children: Node[] }).children).map((n) => n.id)).toEqual(['c', 'a', 'b']);
    expect(moveNodes(g.doc, [g.groupId], g.groupId, 0)).toBe(g.doc);
  });

  it('changes z-order', () => {
    const d = base();
    expect(arrange(d, ['a'], 'front').children.map((n) => n.id)).toEqual(['b', 'c', 'd', 'a']);
    expect(arrange(d, ['d'], 'back').children.map((n) => n.id)).toEqual(['d', 'a', 'b', 'c']);
    expect(arrange(d, ['b', 'c'], 'forward').children.map((n) => n.id)).toEqual(['a', 'd', 'b', 'c']);
    expect(arrange(d, ['b', 'a'], 'backward').children.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(arrange(d, ['c'], 'backward').children.map((n) => n.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('clones with fresh ids and removes', () => {
    const g = groupNodes(base(), ['a', 'b'])!;
    const copy = cloneNodes([findNode(g.doc, g.groupId)!])[0] as { id: string; children: Node[] };
    expect(copy.id).not.toBe(g.groupId);
    expect(copy.children.map((n) => n.id)).not.toContain('a');
    expect(removeNodes(g.doc, ['a']).children.length).toBe(3);
    expect(orderIds(removeNodes(g.doc, [g.groupId]))).toEqual(['c', 'd']);
  });

  it('cascades styles from groups', () => {
    const g = groupNodes(base(), ['a'])!;
    const d = { ...g.doc, children: g.doc.children.map((n) => (n.id === g.groupId ? { ...n, style: { strokeWidth: 3 } } : n)) } as Doc;
    expect(resolveStyle(d, 'a')).toMatchObject({ strokeWidth: 3, stroke: 'currentColor' });
  });
});

describe('transforming groups', () => {
  it('bakes a scale into every shape under a group', () => {
    const g = groupNodes(mkdoc([rect('a', 2, 2, 4, 4), shape('p', { kind: 'path', d: 'M10 10h4' }), rect('x', 20, 20, 2, 2)]), ['a', 'p'])!;
    const out = transformNodes(g.doc, [g.groupId], scaleAbout(2, 1, { x: 0, y: 0 }));
    const grp = findNode(out, g.groupId) as { children: Array<{ geom: Geometry }> };
    expect(grp.children[0]!.geom).toMatchObject({ kind: 'rect', x: 4, y: 2, width: 8, height: 4 });
    expect((grp.children[1]!.geom as { d: string }).d).toBe('M20 10h8');
    // The shape outside the group is untouched (same object).
    expect(findNode(out, 'x')).toBe(findNode(g.doc, 'x'));
    expect(boundsOf(out, [g.groupId])).toEqual({ x: 4, y: 2, w: 24, h: 8 });
  });

  it('leaves stroke widths alone unless asked to scale them', () => {
    const d = mkdoc([shape('p', { kind: 'path', d: 'M0 0h4' }, { style: { strokeWidth: 3 } }), shape('q', { kind: 'path', d: 'M0 0h4' })]);
    const a = transformNodes(d, ['p', 'q'], scale(2, 2));
    expect(findNode(a, 'p')!.style.strokeWidth).toBe(3);
    expect(findNode(a, 'q')!.style.strokeWidth).toBeUndefined();
    const b = transformNodes(d, ['p', 'q'], scale(2, 2), { strokeScale: 2 });
    expect(findNode(b, 'p')!.style.strokeWidth).toBe(6);
    expect(findNode(b, 'q')!.style.strokeWidth).toBe(4);
  });

  it('skips hidden and locked nodes', () => {
    const d = mkdoc([{ ...rect('a', 0, 0, 2, 2), locked: true }, { ...rect('b', 0, 0, 2, 2), hidden: true }, rect('c', 0, 0, 2, 2)]);
    const out = transformNodes(d, ['a', 'b', 'c'], translate(5, 5));
    expect(findNode(out, 'a')).toBe(findNode(d, 'a'));
    expect(findNode(out, 'b')).toBe(findNode(d, 'b'));
    expect(findNode(out, 'c')).not.toBe(findNode(d, 'c'));
    expect(editableIds(d, ['a', 'b', 'c'])).toEqual(['c']);
  });
});

describe('reconcileIds', () => {
  it('keeps ids across an edit that does not change the structure', () => {
    const prev = mkdoc([rect('a', 0, 0, 2, 2), shape('b', { kind: 'path', d: 'M0 0h4' }, { name: 'Line' })]);
    const next = parseSvg(serializeSvg(prev)).doc;
    const same = reconcileIds(prev, next);
    expect(same.children.map((n) => n.id)).toEqual(['a', 'b']);
    expect(same.children[1]!.name).toBe('Line');
    const fewer = reconcileIds(prev, { ...next, children: next.children.slice(0, 1) });
    expect(fewer.children[0]!.id).not.toBe('a');
  });
});
