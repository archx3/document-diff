import { type Pt, type Rect, containsRect, distToSegmentSq, inflate, intersectsRect, segmentIntersectsRect, windingNumber } from './geometry';
import { childrenOf, findNode, isLive, locate, nodeBounds, selectableIn } from './doc';
import { geomBounds, geomPolylines } from './shapes';
import type { Doc, Node, ShapeNode, Style } from './types';

/* Finding what is under the pointer, and what a dragged rectangle selects. */

const paintVisible = (v: string | undefined): boolean => v !== undefined && v !== 'none' && v !== 'transparent';

/** The style that applies inside the open group `scope`: the document's, then each group's on the way down. */
export function styleAtScope(doc: Doc, scope: string | null): Style {
  const base: Style = { ...doc.defaults };
  if (scope === null) return base;
  const loc = locate(doc, scope);
  if (!loc) return base;
  return [...loc.ancestors, loc.node].reduce<Style>((acc, n) => ({ ...acc, ...n.style }), base);
}

function hitShape(n: ShapeNode, style: Style, p: Pt, tol: number): boolean {
  const eff = { ...style, ...n.style };
  const stroked = paintVisible(eff.stroke) && (eff.strokeWidth ?? 1) > 0;
  const filled = n.geom.kind !== 'line' && paintVisible(eff.fill ?? '#000');
  const half = stroked ? (eff.strokeWidth ?? 1) / 2 : 0;
  // Something with neither paint can still be picked at its outline, or it could never be selected again.
  const reach = half + (stroked || filled ? tol * (stroked ? 1 : 0.5) : tol);
  const b = geomBounds(n.geom);
  if (!b) return false;
  if (!filled && (p.x < b.x - reach || p.x > b.x + b.w + reach || p.y < b.y - reach || p.y > b.y + b.h + reach)) return false;
  const lines = geomPolylines(n.geom);
  if (filled) {
    const evenOdd = eff.fillRule === 'evenodd';
    let w = 0;
    let parity = 0;
    for (const pl of lines) {
      const k = windingNumber(p, pl.pts);
      w += k;
      parity += k !== 0 ? 1 : 0;
    }
    if (evenOdd ? parity % 2 === 1 : w !== 0) return true;
  }
  const r2 = reach * reach;
  for (const pl of lines) {
    const pts = pl.pts;
    for (let i = 0; i + 1 < pts.length; i++) if (distToSegmentSq(p, pts[i]!, pts[i + 1]!) <= r2) return true;
    if (pl.closed && pts.length > 2 && distToSegmentSq(p, pts[pts.length - 1]!, pts[0]!) <= r2) return true;
    if (pts.length === 1 && Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y) <= reach) return true;
  }
  return false;
}

/** The topmost shape under `p` among `nodes` (any depth), or null. */
function hitDeep(nodes: readonly Node[], style: Style, p: Pt, tol: number): string | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    if (!isLive(n)) continue;
    if (n.type === 'group') {
      const hit = hitDeep(n.children, { ...style, ...n.style }, p, tol);
      if (hit) return hit;
    } else if (hitShape(n, style, p, tol)) return n.id;
  }
  return null;
}

/**
 * What a click at `p` selects. `scope` is the group that is open (null: the top level): a click on
 * something inside a closed group selects that group. With `deep` it selects the shape itself.
 * `tol` is the click tolerance in document units.
 */
export function hitTest(doc: Doc, p: Pt, scope: string | null, tol: number, deep = false): string | null {
  const hit = hitDeep(childrenOf(doc, scope), styleAtScope(doc, scope), p, tol);
  if (!hit) return null;
  return deep ? hit : selectableIn(doc, hit, scope);
}

function touchesShape(n: ShapeNode, style: Style, rect: Rect): boolean {
  const eff = { ...style, ...n.style };
  const stroked = paintVisible(eff.stroke) && (eff.strokeWidth ?? 1) > 0;
  const half = stroked ? (eff.strokeWidth ?? 1) / 2 : 0;
  const b = geomBounds(n.geom);
  if (!b || !intersectsRect(inflate(b, half), rect)) return false;
  const lines = geomPolylines(n.geom);
  const grown = inflate(rect, half);
  for (const pl of lines) {
    const pts = pl.pts;
    for (let i = 0; i + 1 < pts.length; i++) if (segmentIntersectsRect(pts[i]!, pts[i + 1]!, grown)) return true;
    if (pl.closed && pts.length > 2 && segmentIntersectsRect(pts[pts.length - 1]!, pts[0]!, grown)) return true;
    if (pts.length === 1 && segmentIntersectsRect(pts[0]!, pts[0]!, grown)) return true;
  }
  // A filled shape also counts when the rectangle sits entirely inside it.
  if (n.geom.kind !== 'line' && paintVisible(eff.fill ?? '#000')) {
    const c = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    if (lines.some((pl) => windingNumber(c, pl.pts) !== 0)) return true;
  }
  return false;
}

function touches(n: Node, style: Style, rect: Rect): boolean {
  if (!isLive(n)) return false;
  if (n.type === 'shape') return touchesShape(n, style, rect);
  const below = { ...style, ...n.style };
  return n.children.some((c) => touches(c, below, rect));
}

export type MarqueeMode = 'encompass' | 'touch';

/**
 * The items a dragged rectangle selects at the level of the open group `scope`. In `encompass` mode an item
 * is selected only when its whole outline is inside the rectangle; in `touch` mode when any part of it,
 * stroke included, is. A group is one item. Results are in z-order.
 */
export function marqueeSelect(doc: Doc, scope: string | null, rect: Rect, mode: MarqueeMode): string[] {
  const style = styleAtScope(doc, scope);
  const out: string[] = [];
  for (const n of childrenOf(doc, scope)) {
    if (!isLive(n)) continue;
    if (mode === 'encompass') {
      const b = nodeBounds(n);
      if (b && containsRect(rect, b)) out.push(n.id);
    } else if (touches(n, style, rect)) out.push(n.id);
  }
  return out;
}

/** Whether a node exists and can be picked on the canvas. */
export function isPickable(doc: Doc, id: string): boolean {
  const loc = locate(doc, id);
  return !!loc && isLive(loc.node) && loc.ancestors.every(isLive) && !!findNode(doc, id);
}
