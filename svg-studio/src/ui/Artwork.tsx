import { memo } from 'react';
import { pointsToString } from '../core/shapes';
import type { Doc, Node, Style } from '../core/types';

/** Presentation attributes for an element: the style's own properties, which already carry React's attribute names. */
export function styleProps(s: Style): Style {
  const p: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (v !== undefined) p[k] = v;
  return p as Style;
}

/** One layer, drawn exactly as it will be exported. Nodes are immutable, so unchanged layers are not redrawn. */
export const NodeView = memo(function NodeView({ node }: { node: Node }) {
  if (node.hidden) return null;
  const sp = styleProps(node.style);
  if (node.type === 'group') {
    return (
      <g {...sp}>
        {node.children.map((c) => (
          <NodeView key={c.id} node={c} />
        ))}
      </g>
    );
  }
  const g = node.geom;
  switch (g.kind) {
    case 'path':
      return <path d={g.d} {...sp} />;
    case 'line':
      return <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} {...sp} />;
    case 'rect':
      return <rect x={g.x} y={g.y} width={g.width} height={g.height} rx={g.rx || undefined} ry={g.ry || undefined} {...sp} />;
    case 'circle':
      return <circle cx={g.cx} cy={g.cy} r={g.r} {...sp} />;
    case 'ellipse':
      return <ellipse cx={g.cx} cy={g.cy} rx={g.rx} ry={g.ry} {...sp} />;
    case 'polyline':
      return <polyline points={pointsToString(g.points)} {...sp} />;
    case 'polygon':
      return <polygon points={pointsToString(g.points)} {...sp} />;
  }
});

/** The document's artwork inside a `<g>` carrying the root's presentation attributes. */
export function Artwork({ doc }: { doc: Doc }) {
  return (
    <g {...styleProps(doc.defaults)}>
      {doc.children.map((n) => (
        <NodeView key={n.id} node={n} />
      ))}
    </g>
  );
}
