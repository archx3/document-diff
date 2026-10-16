/**
 * 2D affine matrices in the layout SVG uses: `matrix(a b c d e f)` maps (x, y) to
 * (a·x + c·y + e, b·x + d·y + f). Rotation angles are in radians, positive clockwise
 * on screen (the y axis points down).
 */

export type Matrix = readonly [number, number, number, number, number, number];

export interface Pt {
  x: number;
  y: number;
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` applied after `n` (the product m·n). */
export function multiply(m: Matrix, n: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const [A, B, C, D, E, F] = n;
  return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
}

export const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy: number = sx): Matrix => [sx, 0, 0, sy, 0, 0];
export const rotate = (rad: number): Matrix => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
};

/** `m` applied about the point `p` instead of the origin. */
export function about(m: Matrix, p: Pt): Matrix {
  return multiply(translate(p.x, p.y), multiply(m, translate(-p.x, -p.y)));
}

export const scaleAbout = (sx: number, sy: number, p: Pt): Matrix => about(scale(sx, sy), p);
export const rotateAbout = (rad: number, p: Pt): Matrix => about(rotate(rad), p);

export function apply(m: Matrix, x: number, y: number): Pt {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export const applyPt = (m: Matrix, p: Pt): Pt => apply(m, p.x, p.y);

export const det = (m: Matrix): number => m[0] * m[3] - m[1] * m[2];

export function invert(m: Matrix): Matrix | null {
  const d = det(m);
  if (!d || !Number.isFinite(d)) return null;
  const [a, b, c, dd, e, f] = m;
  return [dd / d, -b / d, -c / d, a / d, (c * f - dd * e) / d, (b * e - a * f) / d];
}

const EPS = 1e-9;

export function isIdentity(m: Matrix, eps = EPS): boolean {
  return Math.abs(m[0] - 1) < eps && Math.abs(m[1]) < eps && Math.abs(m[2]) < eps && Math.abs(m[3] - 1) < eps && Math.abs(m[4]) < eps && Math.abs(m[5]) < eps;
}

/** The matrix only moves, scales and flips along the axes (no rotation or skew). */
export function isAxisAligned(m: Matrix, eps = EPS): boolean {
  return Math.abs(m[1]) < eps && Math.abs(m[2]) < eps;
}

/** The matrix turns by a multiple of 90° (with scaling and flips), so axis-aligned shapes stay axis-aligned. */
export function isQuarterTurn(m: Matrix, eps = EPS): boolean {
  return Math.abs(m[0]) < eps && Math.abs(m[3]) < eps;
}

/** Rotation, uniform scale and flips only: circles stay circles and angles are kept. */
export function isSimilarity(m: Matrix, eps = 1e-9): boolean {
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[2], m[3]);
  const dot = m[0] * m[2] + m[1] * m[3];
  const tol = eps * Math.max(1, sx, sy);
  return Math.abs(sx - sy) <= tol && Math.abs(dot) <= tol * Math.max(sx, 1);
}

/** The factor lengths are multiplied by on average (√|det|). */
export const meanScale = (m: Matrix): number => Math.sqrt(Math.abs(det(m)));

export function equal(m: Matrix, n: Matrix, eps = EPS): boolean {
  return m.every((v, i) => Math.abs(v - n[i]!) < eps);
}

const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';

/** Parses an SVG `transform` attribute. Returns null when it is malformed. */
export function parseTransform(text: string | null | undefined): Matrix | null {
  if (!text || !text.trim()) return IDENTITY;
  const re = new RegExp(`\\s*(matrix|translate|scale|rotate|skewX|skewY)\\s*\\(([^)]*)\\)\\s*,?`, 'gy');
  let m: Matrix = IDENTITY;
  let pos = 0;
  const src = text.trim();
  re.lastIndex = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const hit = re.exec(src);
    if (!hit) return null;
    pos = re.lastIndex;
    const args = (hit[2]!.match(new RegExp(NUM, 'g')) ?? []).map(Number);
    let t: Matrix;
    switch (hit[1]) {
      case 'matrix':
        if (args.length !== 6) return null;
        t = args as unknown as Matrix;
        break;
      case 'translate':
        if (args.length < 1 || args.length > 2) return null;
        t = translate(args[0]!, args[1] ?? 0);
        break;
      case 'scale':
        if (args.length < 1 || args.length > 2) return null;
        t = scale(args[0]!, args[1] ?? args[0]!);
        break;
      case 'rotate':
        if (args.length !== 1 && args.length !== 3) return null;
        t = args.length === 3 ? rotateAbout((args[0]! * Math.PI) / 180, { x: args[1]!, y: args[2]! }) : rotate((args[0]! * Math.PI) / 180);
        break;
      case 'skewX':
        if (args.length !== 1) return null;
        t = [1, 0, Math.tan((args[0]! * Math.PI) / 180), 1, 0, 0];
        break;
      default:
        if (args.length !== 1) return null;
        t = [1, Math.tan((args[0]! * Math.PI) / 180), 0, 1, 0, 0];
    }
    m = multiply(m, t);
  }
  return m;
}

export const radians = (deg: number): number => (deg * Math.PI) / 180;
export const degrees = (rad: number): number => (rad * 180) / Math.PI;
