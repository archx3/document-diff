import { describe, expect, it } from 'vitest';
import { alignLines, bandPath, columnOffsets, syncPoint } from '../../src/ui/elastic';

// Three lines: the same 100 px paragraph on both sides, 300 px only in B, the same 100 px again.
// A's column: 0, 100, 100, 200 (then a 20 px end cap); B's: 0, 100, 400, 500.
const lines = () => alignLines([0, 100, 100, 200], [0, 100, 400, 500], 220, 520);

describe('connection bands', () => {
  it('lines up each line as tall as its taller side', () => {
    const L = lines();
    expect(L.n).toBe(3);
    expect(Array.from(L.v)).toEqual([0, 100, 400, 500]);
    expect(L.total).toBe(520);
  });

  it('keeps the sync point in the middle of the screen except near the ends', () => {
    expect(syncPoint(0, 400, 1000)).toBe(0);
    expect(syncPoint(100, 400, 1000)).toBe(0.25);
    expect(syncPoint(500, 400, 1000)).toBe(0.5);
    expect(syncPoint(900, 400, 1000)).toBe(0.75);
    expect(syncPoint(1000, 400, 1000)).toBe(1);
    // Nothing to scroll: the top.
    expect(syncPoint(0, 400, 0)).toBe(0);
  });

  it('starts both columns at the top', () => {
    expect(columnOffsets(lines(), 0, 200, 340)).toMatchObject({ a: 0, b: 0 });
  });

  it('holds A still while B’s extra text passes the sync point', () => {
    const L = alignLines([0, 100, 100, 1100], [0, 100, 400, 1400], 1120, 1420);
    // Screen 200 px tall, scrolled well into the long last paragraph's side of the page.
    const at = (s: number) => columnOffsets(L, s, 200, L.total - 200);
    // The sync point (100 px down the screen) is in B's extra text: A's column is shifted down
    // by as much of it as has passed, so its next paragraph waits at the sync point.
    const mid = at(150);
    expect(mid.line).toBe(1);
    expect(mid.a).toBeCloseTo(150);
    expect(mid.b).toBe(0);
    // Past it, both move with the page again: A stays 300 px down, B at 0.
    expect(at(500)).toMatchObject({ a: 300, b: 0, line: 2 });
    expect(at(700)).toMatchObject({ a: 300, b: 0 });
  });

  it('stops a column at its start and end, like a pane scrolled all the way', () => {
    // B has 300 px of text before anything A has.
    const L = alignLines([0, 0, 1000], [0, 300, 1300], 1020, 1320);
    const h = 200;
    const sMax = L.total - h;
    // Scrolled 50 px, the sync point is inside B's extra text: A would start below the top of the
    // screen, so it starts at the top.
    const o = columnOffsets(L, 50, h, sMax);
    expect(o.a).toBe(50);
    expect(o.b).toBe(0);
    // At the end both end at the bottom of the grid.
    const end = columnOffsets(L, sMax, h, sMax);
    expect(end.a + L.lenA).toBe(L.total);
    expect(end.b + L.lenB).toBe(L.total);
  });

  it('keeps a column shorter than the screen at its top', () => {
    const L = alignLines([0, 100], [0, 900], 120, 920);
    for (const s of [0, 200, 400]) expect(columnOffsets(L, s, 400, L.total - 400).a).toBe(s);
  });

  it('draws a band as an S from one side’s range to the other’s', () => {
    const { fill, edges, outline } = bandPath(20, 80, 100, 10, 30, 50, 90);
    expect(fill).toBe('M0 10H20C50 10 50 50 80 50H100V90H80C50 90 50 30 20 30H0Z');
    expect(edges).toBe('M0 10H20C50 10 50 50 80 50H100M0 30H20C50 30 50 90 80 90H100');
    // The outline's ends are just inside the gutter.
    expect(outline).toBe('M0.8 10H20C50 10 50 50 80 50H99.3V90H80C50 90 50 30 20 30H0.8Z');
    // Where one side has nothing, its edges meet: a line marks the place.
    expect(bandPath(20, 80, 100, 10, 10, 50, 90).fill).toContain('M0 10H20');
  });
});
