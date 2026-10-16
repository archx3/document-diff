import { type Matrix, degrees, radians } from './matrix';
import type { Pt } from './geometry';

/** An elliptical arc in centre form (SVG implementation notes F.6.5). Angles in radians. */
export interface ArcCenter {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  phi: number;
  theta1: number;
  dtheta: number;
}

const angleBetween = (ux: number, uy: number, vx: number, vy: number): number => {
  const sign = ux * vy - uy * vx < 0 ? -1 : 1;
  const dot = ux * vx + uy * vy;
  const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  return sign * Math.acos(Math.max(-1, Math.min(1, dot / len)));
};

/**
 * Converts the endpoint form of an arc to its centre form. Returns null when the arc is
 * degenerate (zero radius or equal endpoints), in which case it draws a straight line or nothing.
 */
export function arcToCenter(x1: number, y1: number, rxIn: number, ryIn: number, rotDeg: number, large: number, sweep: number, x2: number, y2: number): ArcCenter | null {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return null;
  const phi = radians(rotDeg);
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosP * dx2 + sinP * dy2;
  const y1p = -sinP * dx2 + cosP * dy2;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const theta1 = angleBetween(1, 0, ux, uy);
  let dtheta = angleBetween(ux, uy, vx, vy);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  else if (sweep && dtheta < 0) dtheta += 2 * Math.PI;
  return { cx, cy, rx, ry, phi, theta1, dtheta };
}

/** The point on the arc's ellipse at parameter angle `theta`. */
export function arcPoint(a: ArcCenter, theta: number): Pt {
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const cosP = Math.cos(a.phi);
  const sinP = Math.sin(a.phi);
  return { x: a.cx + a.rx * cosT * cosP - a.ry * sinT * sinP, y: a.cy + a.rx * cosT * sinP + a.ry * sinT * cosP };
}

function arcTangent(a: ArcCenter, theta: number): Pt {
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const cosP = Math.cos(a.phi);
  const sinP = Math.sin(a.phi);
  return { x: -a.rx * sinT * cosP - a.ry * cosT * sinP, y: -a.rx * sinT * sinP + a.ry * cosT * cosP };
}

/** Cubic Béziers (control point pairs and end points) that follow the arc to within a hair. */
export function arcToCubics(a: ArcCenter): Array<{ c1: Pt; c2: Pt; to: Pt }> {
  const n = Math.max(1, Math.ceil(Math.abs(a.dtheta) / (Math.PI / 2) - 1e-9));
  const d = a.dtheta / n;
  const k = (4 / 3) * Math.tan(d / 4);
  const out: Array<{ c1: Pt; c2: Pt; to: Pt }> = [];
  for (let i = 0; i < n; i++) {
    const t1 = a.theta1 + i * d;
    const t2 = t1 + d;
    const p1 = arcPoint(a, t1);
    const p2 = arcPoint(a, t2);
    const d1 = arcTangent(a, t1);
    const d2 = arcTangent(a, t2);
    out.push({ c1: { x: p1.x + k * d1.x, y: p1.y + k * d1.y }, c2: { x: p2.x - k * d2.x, y: p2.y - k * d2.y }, to: p2 });
  }
  return out;
}

/** The parameter angles at which the arc is leftmost/rightmost/topmost/bottommost, within its sweep. */
export function arcExtremeAngles(a: ArcCenter): number[] {
  const cosP = Math.cos(a.phi);
  const sinP = Math.sin(a.phi);
  const tx = Math.atan2(-a.ry * sinP, a.rx * cosP);
  const ty = Math.atan2(a.ry * cosP, a.rx * sinP);
  const out: number[] = [];
  const lo = Math.min(a.theta1, a.theta1 + a.dtheta);
  const hi = Math.max(a.theta1, a.theta1 + a.dtheta);
  for (const base of [tx, tx + Math.PI, ty, ty + Math.PI]) {
    // The first angle at or after the sweep's start that is congruent with `base`.
    const t = base + Math.ceil((lo - base) / (2 * Math.PI) - 1e-12) * 2 * Math.PI;
    if (t <= hi + 1e-12) out.push(t);
  }
  return out;
}

/**
 * The arc's radii and rotation after the linear part of `m` is applied to it. An affine map
 * takes an ellipse to an ellipse: its axes come from the singular values of m·R(φ)·diag(rx, ry).
 * The large-arc flag is kept as it was and the sweep flag flips when `m` mirrors.
 */
export function transformArcParams(rx: number, ry: number, rotDeg: number, sweep: number, m: Matrix): { rx: number; ry: number; rot: number; sweep: number } {
  const phi = radians(rotDeg);
  const ux = rx * Math.cos(phi);
  const uy = rx * Math.sin(phi);
  const vx = -ry * Math.sin(phi);
  const vy = ry * Math.cos(phi);
  // The columns of E are the images of the ellipse's two semi-axes.
  const m00 = m[0] * ux + m[2] * uy;
  const m10 = m[1] * ux + m[3] * uy;
  const m01 = m[0] * vx + m[2] * vy;
  const m11 = m[1] * vx + m[3] * vy;
  const E = (m00 + m11) / 2;
  const F = (m00 - m11) / 2;
  const G = (m10 + m01) / 2;
  const H = (m10 - m01) / 2;
  const Q = Math.hypot(E, H);
  const R = Math.hypot(F, G);
  const a1 = Math.atan2(G, F);
  const a2 = Math.atan2(H, E);
  const rot = (a2 + a1) / 2;
  const mirrored = m[0] * m[3] - m[1] * m[2] < 0;
  return { rx: Q + R, ry: Math.abs(Q - R), rot: degrees(rot), sweep: mirrored ? 1 - sweep : sweep };
}
