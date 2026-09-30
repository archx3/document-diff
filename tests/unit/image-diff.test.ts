import { describe, expect, it } from 'vitest';
import type { Pixels } from '../../src/image/diff';
import { changedBoxes, diffImage, diffPixels, fingerprint, fingerprintDistance } from '../../src/image/diff';

/** A picture filled with one colour, with rectangles of other colours painted on. */
function picture(w: number, h: number, bg: [number, number, number], rects: Array<[number, number, number, number, [number, number, number]]> = []): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...bg, 255], i * 4);
  for (const [x, y, rw, rh, c] of rects) for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) data.set([...c, 255], (yy * w + xx) * 4);
  return { width: w, height: h, data };
}

/** A smooth picture (a gradient with a dark block), drawn at any size. */
function scene(w: number, h: number, noise = 0): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inBlock = x > w * 0.3 && x < w * 0.6 && y > h * 0.2 && y < h * 0.7;
      const v = inBlock ? 40 : Math.round(255 * (x / w) * 0.8 + 30 * (y / h));
      const jitter = noise ? ((x * 7 + y * 13) % 5) - 2 : 0;
      data.set([v + jitter, v + jitter, v + jitter, 255], (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
}

describe('image comparison', () => {
  const white: [number, number, number] = [255, 255, 255];
  const red: [number, number, number] = [200, 0, 0];

  it('finds the pixels that differ, and how much of the picture that is', () => {
    const a = picture(100, 50, white);
    const b = picture(100, 50, white, [[10, 10, 20, 5, red]]);
    const d = diffPixels(a, b);
    expect(d.changed).toBe(100);
    expect(d.ratio).toBeCloseTo(0.02);
    expect(diffPixels(a, a).changed).toBe(0);
  });

  it('lets small differences through at a lower sensitivity', () => {
    const a = picture(10, 10, [100, 100, 100]);
    const b = picture(10, 10, [110, 110, 110]);
    expect(diffPixels(a, b, 1).changed).toBe(100);
    expect(diffPixels(a, b, 0.9).changed).toBe(0);
  });

  it('outlines each changed area as a box', () => {
    const a = picture(200, 100, white);
    const b = picture(200, 100, white, [
      [10, 10, 30, 20, red],
      [150, 60, 10, 10, red],
    ]);
    b.data.set([0, 0, 0, 255], (90 * 200 + 190) * 4); // a speck, left out
    expect(changedBoxes(diffPixels(a, b))).toEqual([
      { x: 10, y: 10, width: 30, height: 20 },
      { x: 150, y: 60, width: 10, height: 10 },
    ]);
  });

  it('draws the difference: changed pixels in red over a faded picture', () => {
    const a = picture(4, 1, white);
    const b = picture(4, 1, white, [[1, 0, 1, 1, [0, 0, 255]]]);
    const img = diffImage(b, diffPixels(a, b));
    expect([...img.slice(4, 8)]).toEqual([220, 38, 38, 255]);
    expect([...img.slice(0, 4)]).toEqual([255, 255, 255, 255]);
  });

  it('knows a picture again after it is resized or saved again, and tells different ones apart', () => {
    const f = fingerprint(scene(320, 200));
    expect(fingerprintDistance(f, fingerprint(scene(160, 100)))).toBeLessThanOrEqual(2);
    expect(fingerprintDistance(f, fingerprint(scene(320, 200, 1)))).toBeLessThanOrEqual(2);
    expect(fingerprintDistance(f, fingerprint(picture(320, 200, white, [[200, 20, 100, 150, [0, 0, 0]]])))).toBeGreaterThan(10);
  });
});
