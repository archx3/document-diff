import { describe, expect, it } from 'vitest';
import { arcPoint, arcToCenter } from '../src/core/arc';
import { type Pt, dist } from '../src/core/geometry';
import { multiply, rotate, rotateAbout, scale, translate, type Matrix, apply, parseTransform, IDENTITY } from '../src/core/matrix';
import { bboxSegs, flattenSegs, parsePath, serializePath, transformSegs, type Seg } from '../src/core/path';

const d = (s: Seg[]) => serializePath(s);
const roundtrip = (path: string) => d(parsePath(path).segs);

describe('parsePath', () => {
  it('reads absolute and relative commands into absolute segments', () => {
    const { segs, error } = parsePath('M2 3l4 0 0 5h-4v-5z');
    expect(error).toBeUndefined();
    expect(segs).toEqual([
      { t: 'M', x: 2, y: 3 },
      { t: 'L', x: 6, y: 3 },
      { t: 'L', x: 6, y: 8 },
      { t: 'L', x: 2, y: 8 },
      { t: 'L', x: 2, y: 3 },
      { t: 'Z' },
    ]);
  });

  it('treats extra pairs after a moveto as lines', () => {
    expect(parsePath('M0 0 5 5 10 0').segs.map((s) => s.t)).toEqual(['M', 'L', 'L']);
    expect(parsePath('m1 1 2 2').segs).toEqual([{ t: 'M', x: 1, y: 1 }, { t: 'L', x: 3, y: 3 }]);
  });

  it('reads numbers packed together and arc flags without separators', () => {
    expect(parsePath('M1.5.5-2-.5').segs).toEqual([{ t: 'M', x: 1.5, y: 0.5 }, { t: 'L', x: -2, y: -0.5 }]);
    const arc = parsePath('M0 0a2 2 0 011 1').segs[1]!;
    expect(arc).toEqual({ t: 'A', rx: 2, ry: 2, rot: 0, large: 0, sweep: 1, x: 1, y: 1 });
    expect(parsePath('M0 0a2 2 0 1 1-6.2-8.5').segs[1]).toMatchObject({ large: 1, sweep: 1, x: -6.2, y: -8.5 });
  });

  it('expands smooth curve shorthands', () => {
    const s = parsePath('M0 0C0 10 10 10 10 0S20 -10 20 0').segs[2]!;
    expect(s).toEqual({ t: 'C', x1: 10, y1: -10, x2: 20, y2: -10, x: 20, y: 0 });
    const q = parsePath('M0 0Q5 5 10 0T20 0').segs[2]!;
    expect(q).toEqual({ t: 'Q', x1: 15, y1: -5, x: 20, y: 0 });
  });

  it('starts a new subpath where the last one was closed when a drawing command follows', () => {
    const { segs } = parsePath('M1 1h4v4zl2 2');
    expect(segs.slice(-2)).toEqual([{ t: 'M', x: 1, y: 1 }, { t: 'L', x: 3, y: 3 }]);
  });

  it('keeps what it could read before a mistake, as browsers draw it', () => {
    const r = parsePath('M0 0L5 5L oops');
    expect(r.segs).toHaveLength(2);
    expect(r.error).toBeTruthy();
    expect(parsePath('L1 1').error).toMatch(/moveto/);
  });
});

describe('serializePath', () => {
  it('writes the short forms icon sets use', () => {
    expect(roundtrip('M 2 12 L 22 12')).toBe('M2 12h20');
    expect(roundtrip('M12 2 L12 22')).toBe('M12 2v20');
    expect(roundtrip('M5 12H19')).toBe('M5 12h14');
    expect(roundtrip('M21 12a9 9 0 1 1-6.219-8.56')).toBe('M21 12a9 9 0 1 1-6.219-8.56');
  });

  it('has no space before a minus sign and no repeated command letters', () => {
    // Each command is written in whichever of its absolute or relative forms is shorter.
    expect(roundtrip('M0 0 L 10 5 L 20 -5 L 30 5')).toBe('M0 0l10 5L20-5 30 5');
    expect(roundtrip('M0 0l10 5 10 5 10 5')).toBe('M0 0l10 5 10 5 10 5');
  });

  it('chooses the absolute form when it is shorter', () => {
    expect(roundtrip('M100 100l-99-99')).toBe('M100 100L1 1');
  });

  it('rounds, drops trailing zeros and negative zero', () => {
    expect(serializePath([{ t: 'M', x: 1.0004, y: -0.0001 }, { t: 'L', x: 2.12349, y: 3 }])).toBe('M1 0l1.123 3');
  });

  it('reads back what it wrote', () => {
    const paths = ['M3 3h18v18H3z', 'M4 20C4 10 20 10 20 20', 'M2 2q10 0 10 10t10 10', 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M1 1h2M5 5v3z'];
    for (const p of paths) {
      const a = parsePath(p).segs;
      const b = parsePath(d(a)).segs;
      expect(b).toHaveLength(a.length);
      b.forEach((s, i) => {
        const o = a[i]!;
        expect(s.t).toBe(o.t);
        for (const k of Object.keys(o) as Array<keyof typeof o>) {
          if (typeof o[k] === 'number') expect((s as never)[k]).toBeCloseTo(o[k] as number, 3);
        }
      });
    }
  });
});

describe('bboxSegs', () => {
  it('uses the curve, not its control points', () => {
    const b = bboxSegs(parsePath('M0 10C0 -10 10 -10 10 10').segs)!;
    expect(b.x).toBeCloseTo(0);
    expect(b.w).toBeCloseTo(10);
    expect(b.y).toBeCloseTo(-5); // t = 0.5: 10 - 30*0.125*... = -5
    expect(b.h).toBeCloseTo(15);
  });

  it('finds the extremes of an arc', () => {
    // A half circle of radius 5 over the top.
    const b = bboxSegs(parsePath('M0 0A5 5 0 0 1 10 0').segs)!;
    expect(b.x).toBeCloseTo(0);
    expect(b.w).toBeCloseTo(10);
    expect(b.y).toBeCloseTo(-5);
    expect(b.h).toBeCloseTo(5);
    // A full circle drawn as two arcs.
    const c = bboxSegs(parsePath('M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0').segs)!;
    expect(c).toMatchObject({ x: expect.closeTo(2), y: expect.closeTo(2), w: expect.closeTo(20), h: expect.closeTo(20) });
  });

  it('handles a rotated elliptical arc', () => {
    const segs = parsePath('M-6 0A6 3 45 0 1 6 0').segs;
    const b = bboxSegs(segs)!;
    // Compare with a dense sampling of the flattened curve.
    const pts = flattenSegs(segs, 0.001)[0]!.pts;
    expect(b.x).toBeCloseTo(Math.min(...pts.map((p) => p.x)), 2);
    expect(b.y).toBeCloseTo(Math.min(...pts.map((p) => p.y)), 2);
    expect(b.x + b.w).toBeCloseTo(Math.max(...pts.map((p) => p.x)), 2);
    expect(b.y + b.h).toBeCloseTo(Math.max(...pts.map((p) => p.y)), 2);
  });
});

/** Points along an arc drawn from `from`, using its centre form. */
function sampleArc(from: Pt, a: Extract<Seg, { t: 'A' }>, n = 40): Pt[] {
  const c = arcToCenter(from.x, from.y, a.rx, a.ry, a.rot, a.large, a.sweep, a.x, a.y)!;
  return Array.from({ length: n + 1 }, (_, i) => arcPoint(c, c.theta1 + (c.dtheta * i) / n));
}

describe('transformSegs on arcs', () => {
  const matrices: Matrix[] = [
    translate(3, -2),
    scale(2, 0.5),
    scale(-1, 1),
    rotate(0.7),
    multiply(rotate(0.4), scale(3, 1.2)),
    multiply(scale(1, -2), rotate(-1.1)),
    [1, 0.3, 0.7, 1, 4, 5],
    [0.5, -1.2, 2, 0.4, 0, 0],
  ];
  const arcs = ['M0 0A6 3 0 0 1 10 2', 'M0 0A6 3 30 1 0 10 2', 'M2 1A5 5 0 1 1 -3 4', 'M0 0A2 1 20 0 0 8 3'];

  for (const path of arcs) {
    it(`keeps ${path} on the curve under any affine map`, () => {
      for (const m of matrices) {
        const segs = parsePath(path).segs;
        const from = { x: (segs[0] as { x: number }).x, y: (segs[0] as { y: number }).y };
        const arc = segs[1] as Extract<Seg, { t: 'A' }>;
        const expected = sampleArc(from, arc).map((p) => apply(m, p.x, p.y));
        const moved = transformSegs(segs, m);
        const f2 = apply(m, from.x, from.y);
        const got = sampleArc(f2, moved[1] as Extract<Seg, { t: 'A' }>, 400);
        for (const p of expected) {
          const nearest = Math.min(...got.map((q) => dist(p, q)));
          expect(nearest).toBeLessThan(0.05);
        }
        // The sweep direction is the same curve, not its mirror image: midpoints agree.
        const mid = expected[Math.floor(expected.length / 2)]!;
        expect(Math.min(...got.map((q) => dist(mid, q)))).toBeLessThan(0.05);
        expect(dist(got[0]!, expected[0]!)).toBeLessThan(1e-6);
        expect(dist(got[got.length - 1]!, expected[expected.length - 1]!)).toBeLessThan(1e-6);
      }
    });
  }

  it('keeps circles circular under rotation and uniform scaling', () => {
    const m = multiply(rotate(1), scale(2));
    const a = transformSegs(parsePath('M0 0a5 5 0 1 1 10 0').segs, m)[1] as Extract<Seg, { t: 'A' }>;
    expect(a.rx).toBeCloseTo(10);
    expect(a.ry).toBeCloseTo(10);
  });
});

describe('transformSegs on lines and curves', () => {
  it('moves every point', () => {
    const segs = transformSegs(parsePath('M0 0C1 1 2 2 3 3Q1 2 3 4').segs, translate(10, 20));
    expect(d(segs)).toBe('M10 20c1 1 2 2 3 3q-2-1 0 1');
  });
  it('rotates about a point', () => {
    const m = rotateAbout(Math.PI / 2, { x: 5, y: 5 });
    const [a, b] = transformSegs(parsePath('M0 5L10 5').segs, m) as Array<{ x: number; y: number }>;
    expect(a!.x).toBeCloseTo(5);
    expect(a!.y).toBeCloseTo(0);
    expect(b!.x).toBeCloseTo(5);
    expect(b!.y).toBeCloseTo(10);
  });
});

describe('parseTransform', () => {
  it('reads the transform list syntax', () => {
    expect(parseTransform('translate(10 20)')).toEqual([1, 0, 0, 1, 10, 20]);
    expect(parseTransform('scale(2)')).toEqual([2, 0, 0, 2, 0, 0]);
    expect(parseTransform('')).toEqual(IDENTITY);
    const m = parseTransform('translate(5,5) rotate(90) scale(2 3)')!;
    const p = apply(m, 1, 1); // scale -> (2, 3), rotate 90° -> (-3, 2), translate -> (2, 7)
    expect(p.x).toBeCloseTo(2);
    expect(p.y).toBeCloseTo(7);
    const r = parseTransform('rotate(180 10 10)')!;
    expect(apply(r, 10, 0).y).toBeCloseTo(20);
    expect(parseTransform('wiggle(3)')).toBeNull();
  });
});
