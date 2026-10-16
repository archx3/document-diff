import type { Pt } from './geometry';

/** Presentation attributes. A property that is missing is inherited from the group around it, or from the document. */
export interface Style {
  fill?: string;
  fillRule?: 'nonzero' | 'evenodd';
  stroke?: string;
  strokeWidth?: number;
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
  strokeDasharray?: string;
  strokeMiterlimit?: number;
  opacity?: number;
}

export type StyleKey = keyof Style;

export type Geometry =
  | { kind: 'path'; d: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number; ry: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'polyline'; points: Pt[] }
  | { kind: 'polygon'; points: Pt[] };

export type ShapeKind = Geometry['kind'];

interface NodeBase {
  id: string;
  /** A name given in the layers list. Kept in the editor only; it is not written to the SVG. */
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  style: Style;
}

export interface ShapeNode extends NodeBase {
  type: 'shape';
  geom: Geometry;
}

export interface GroupNode extends NodeBase {
  type: 'group';
  children: Node[];
  /** Shown folded in the layers list. */
  collapsed?: boolean;
}

export type Node = ShapeNode | GroupNode;

export interface Doc {
  width: number;
  height: number;
  /** The style every element inherits unless it says otherwise (the attributes of the root `<svg>`). */
  defaults: Style;
  children: Node[];
}

/** What an SVG without any presentation attributes looks like. */
export const SPEC_STYLE = {
  fill: '#000000',
  fillRule: 'nonzero',
  stroke: 'none',
  strokeWidth: 1,
  strokeLinecap: 'butt',
  strokeLinejoin: 'miter',
  strokeMiterlimit: 4,
  opacity: 1,
} as const satisfies Style;

/** The conventions of Lucide icons: stroked outlines with round ends, 2 units thick, in the text colour. */
export const LUCIDE_STYLE: Style = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export const emptyDoc = (size = 24): Doc => ({ width: size, height: size, defaults: { ...LUCIDE_STYLE }, children: [] });

let counter = 0;
const salt = Math.random().toString(36).slice(2, 5);
/** A fresh id, unique within the session and (in practice) across restored sessions. */
export const uid = (): string => `n${(counter++).toString(36)}${salt}`;
