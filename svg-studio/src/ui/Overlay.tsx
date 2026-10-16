import { useMemo, type ReactNode } from 'react';
import { boundsOf, editableIds, findNode, shapesUnder } from '../core/doc';
import { dist, type Pt } from '../core/geometry';
import { apply } from '../core/matrix';
import { fromSubPaths, toSubPaths } from '../core/nodes';
import { fmt, serializePath } from '../core/path';
import { geomToSegs } from '../core/shapes';
import { HANDLES, HANDLE_FRACTION, pivotPoint, pointOnBox, type HandleId } from '../core/transform';
import type { Geometry } from '../core/types';
import type { EditorState } from '../state/store';
import type { View } from '../state/gestures';

const CURSORS: Record<HandleId, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
const HS = 8;
const ROTATE_ZONE = 18;

/** A cursor for rotating: a curved arrow with a white halo so it reads on any background. */
export const ROTATE_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'%3E%3Cg stroke='white' stroke-width='4.5'%3E%3Cpath d='M19 12a7 7 0 1 1-2.2-5.1M19.5 3.5V8H15'/%3E%3C/g%3E%3Cg stroke='black' stroke-width='2'%3E%3Cpath d='M19 12a7 7 0 1 1-2.2-5.1M19.5 3.5V8H15'/%3E%3C/g%3E%3C/svg%3E") 12 12, crosshair`;

const outlineCache = new WeakMap<Geometry, string>();
/** Path data for the outline of any shape. */
export function outlineD(g: Geometry): string {
  if (g.kind === 'path') return g.d;
  let d = outlineCache.get(g);
  if (d === undefined) {
    d = serializePath(geomToSegs(g));
    outlineCache.set(g, d);
  }
  return d;
}

/** Outlines of the given layers, drawn in document space so they follow the artwork exactly. */
export function Outlines({ s, ids, className }: { s: EditorState; ids: readonly string[]; className: string }) {
  const out: ReactNode[] = [];
  for (const id of ids) {
    const n = findNode(s.doc, id);
    if (!n || n.hidden) continue;
    for (const sh of shapesUnder([n])) if (!sh.hidden) out.push(<path key={sh.id} d={outlineD(sh.geom)} className={className} vectorEffect="non-scaling-stroke" />);
  }
  return <>{out}</>;
}

function Label({ x, y, text, width, height }: { x: number; y: number; text: string; width: number; height: number }) {
  const w = text.length * 6.6 + 14;
  // Keep the readout inside the canvas even when the box it belongs to runs off it.
  const cx = Math.min(Math.max(x, w / 2 + 6), Math.max(width - w / 2 - 6, w / 2 + 6));
  const cy = Math.min(Math.max(y, 22), Math.max(height - 70, 22));
  return (
    <g className="readout" transform={`translate(${cx} ${cy})`}>
      <rect x={-w / 2} y={-11} width={w} height={20} rx={5} />
      <text textAnchor="middle" y={4}>
        {text}
      </text>
    </g>
  );
}

interface Props {
  s: EditorState;
  view: View;
  width: number;
  height: number;
}

export function Overlay({ s, view, width, height }: Props) {
  const z = view.zoom;
  const X = (x: number) => x * z + view.x;
  const Y = (y: number) => y * z + view.y;
  const P = (p: Pt): Pt => ({ x: X(p.x), y: Y(p.y) });

  const ids = useMemo(() => editableIds(s.doc, s.selection), [s.doc, s.selection]);
  const box = useMemo(() => boundsOf(s.doc, ids), [s.doc, ids]);

  // The shape whose points are being edited.
  const nodeShape = useMemo(() => {
    if (s.tool !== 'node' || ids.length !== 1) return null;
    const n = findNode(s.doc, ids[0]!);
    return n && n.type === 'shape' ? n : null;
  }, [s.tool, s.doc, ids]);
  const subs = useMemo(() => (nodeShape ? toSubPaths(geomToSegs(nodeShape.geom)) : []), [nodeShape]);

  const els: ReactNode[] = [];
  const ov = s.overlay;

  /* Marquee */
  if (ov?.kind === 'marquee') {
    const r = ov.rect;
    els.push(<rect key="marquee" className={`marquee ${ov.mode}`} x={X(r.x)} y={Y(r.y)} width={r.w * z} height={r.h * z} />);
  }

  /* A transform being dragged: the selection's original box with the transform applied. */
  if (ov?.kind === 'box') {
    const b = ov.box;
    const corners = [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
      { x: b.x, y: b.y + b.h },
    ].map((c) => P(apply(ov.m, c.x, c.y)));
    els.push(<polygon key="xbox" className="xbox" points={corners.map((c) => `${c.x},${c.y}`).join(' ')} />);
    const top = corners.reduce((a, c) => (c.y < a.y ? c : a));
    const cx = corners.reduce((a, c) => a + c.x, 0) / 4;
    els.push(<Label key="xlabel" x={cx} y={top.y - 20} text={ov.label} width={width} height={height} />);
    if (ov.pivot) {
      const pv = P(ov.pivot);
      els.push(<circle key="xpivot" className="pivot" cx={pv.x} cy={pv.y} r={4} />);
    }
  }

  const gesturing = ov?.kind === 'box';

  /* Selection frame and handles */
  if (box && !gesturing && (s.tool === 'select' || s.tool === 'scale' || s.tool === 'scaleH' || s.tool === 'scaleV' || s.tool === 'rotate')) {
    const x0 = X(box.x);
    const y0 = Y(box.y);
    const w = box.w * z;
    const h = box.h * z;
    const transformTool = s.tool !== 'select';
    els.push(<rect key="frame" className={transformTool ? 'frame dashed' : 'frame'} x={x0} y={y0} width={w} height={h} />);
    if (!transformTool) {
      const corners: HandleId[] = ['nw', 'ne', 'se', 'sw'];
      // Rotate zones sit just outside the corners, under the resize handles.
      for (const c of corners) {
        const f = HANDLE_FRACTION[c];
        const px = x0 + w * f.x;
        const py = y0 + h * f.y;
        els.push(
          <rect
            key={`rot-${c}`}
            className="rotate-zone"
            data-hit={`rotate:${c}`}
            x={f.x === 0 ? px - ROTATE_ZONE : px}
            y={f.y === 0 ? py - ROTATE_ZONE : py}
            width={ROTATE_ZONE}
            height={ROTATE_ZONE}
            style={{ cursor: ROTATE_CURSOR }}
          />,
        );
      }
      for (const hd of HANDLES) {
        const f = HANDLE_FRACTION[hd];
        const isEdge = f.x === 0.5 || f.y === 0.5;
        if (isEdge && ((f.x === 0.5 && w < 24) || (f.y === 0.5 && h < 24))) continue;
        els.push(<rect key={hd} className="handle" data-hit={`resize:${hd}`} x={x0 + w * f.x - HS / 2} y={y0 + h * f.y - HS / 2} width={HS} height={HS} rx={1.5} style={{ cursor: CURSORS[hd] }} />);
      }
      els.push(<Label key="size" x={x0 + w / 2} y={y0 + h + 24} text={`${fmt(box.w, 2)} × ${fmt(box.h, 2)}`} width={width} height={height} />);
    } else {
      const pv = P(pivotPoint(box, s.pivot));
      els.push(
        <g key="pivot" className="pivot-marker" data-hit="pivot" transform={`translate(${pv.x} ${pv.y})`} style={{ cursor: 'move' }}>
          <circle r={11} className="pivot-hit" />
          <circle r={4.5} />
          <path d="M-9 0H-5.5M5.5 0H9M0-9V-5.5M0 5.5V9" />
        </g>,
      );
      // The box's own nine anchor points, as hints for where the pivot can jump to.
      for (const fy of [0, 0.5, 1]) for (const fx of [0, 0.5, 1]) {
        const a = P(pointOnBox(box, { x: fx, y: fy }));
        els.push(<circle key={`a${fx}${fy}`} className="anchor-dot" cx={a.x} cy={a.y} r={2} />);
      }
    }
  }

  /* Points of the shape being edited */
  if (nodeShape) {
    subs.forEach((sp, si) =>
      sp.nodes.forEach((n, ni) => {
        const key = `${si}:${ni}`;
        const selected = s.nodeSel.includes(key);
        const a = P(n);
        if (selected) {
          for (const which of ['in', 'out'] as const) {
            const hp = which === 'in' ? n.hin : n.hout;
            if (!hp) continue;
            const q = P(hp);
            els.push(<line key={`hl-${key}-${which}`} className="handle-line" x1={a.x} y1={a.y} x2={q.x} y2={q.y} />);
            els.push(<circle key={`h-${key}-${which}`} className="bezier-handle" data-hit={`handle:${si}:${ni}:${which}`} cx={q.x} cy={q.y} r={4} style={{ cursor: 'move' }} />);
          }
        }
        els.push(<rect key={`n-${key}`} className={selected ? 'anchor selected' : 'anchor'} data-hit={`node:${si}:${ni}`} x={a.x - 4} y={a.y - 4} width={8} height={8} style={{ cursor: 'move' }} />);
      }),
    );
  }

  /* The path being drawn with the pen */
  let penPath: string | null = null;
  if (s.tool === 'pen' && s.pen) {
    const { nodes, cursor } = s.pen;
    const preview = cursor ? [...nodes, { x: cursor.x, y: cursor.y, hin: null, hout: null, arc: null }] : nodes;
    if (preview.length > 1) penPath = serializePath(fromSubPaths([{ nodes: preview, closed: false }]));
    nodes.forEach((n, i) => {
      const a = P(n);
      const closing = i === 0 && nodes.length >= 2 && cursor && dist(n, cursor) * z < 10;
      if (i === nodes.length - 1) {
        for (const hp of [n.hin, n.hout]) {
          if (!hp) continue;
          const q = P(hp);
          els.push(<line key={`pl-${i}-${hp.x}`} className="handle-line" x1={a.x} y1={a.y} x2={q.x} y2={q.y} />);
          els.push(<circle key={`ph-${i}-${hp.x}`} className="bezier-handle" cx={q.x} cy={q.y} r={3.5} />);
        }
      }
      els.push(<rect key={`pn-${i}`} className={closing ? 'anchor selected closing' : 'anchor'} x={a.x - (closing ? 6 : 4)} y={a.y - (closing ? 6 : 4)} width={closing ? 12 : 8} height={closing ? 12 : 8} />);
    });
  }

  return (
    <svg className="overlay" width={width} height={height}>
      {penPath && (
        <g transform={`translate(${view.x} ${view.y}) scale(${z})`}>
          <path d={penPath} className="pen-preview" vectorEffect="non-scaling-stroke" />
        </g>
      )}
      {els}
    </svg>
  );
}
