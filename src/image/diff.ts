/**
 * Comparing pictures, pixel by pixel: which pixels differ (beyond a
 * sensitivity), how much of the picture that is, the areas that changed as
 * boxes, and how a picture looks (small, with its fingerprint), by which it is
 * known again after being resized or saved again. Pure functions on RGBA
 * pixels; the page decodes and draws the pictures (image/draw.ts).
 */

/** RGBA pixels, as a canvas gives them. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface PixelDiff {
  width: number;
  height: number;
  /** 1 where the pictures differ. */
  mask: Uint8Array;
  changed: number;
  /** Share of the picture that differs, 0 to 1. */
  ratio: number;
}

/**
 * The pixels that differ between two pictures of the same size. `sensitivity`
 * (0 to 1) is how small a difference counts: at 1 any difference does, at 0
 * only a complete change of colour.
 */
export function diffPixels(a: Pixels, b: Pixels, sensitivity = 0.9): PixelDiff {
  if (a.width !== b.width || a.height !== b.height) throw new Error('The pictures must be the same size to compare their pixels.');
  const n = a.width * a.height;
  const mask = new Uint8Array(n);
  // The largest colour distance (all of R, G, B and A at full difference) is 510 by this measure.
  const limit = Math.max(1, (1 - Math.min(Math.max(sensitivity, 0), 1)) * 510);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    // Transparent pixels are compared as white, as a page shows them.
    const aa = a.data[k + 3]! / 255;
    const ba = b.data[k + 3]! / 255;
    const ar = a.data[k]! * aa + 255 * (1 - aa);
    const ag = a.data[k + 1]! * aa + 255 * (1 - aa);
    const ab = a.data[k + 2]! * aa + 255 * (1 - aa);
    const br = b.data[k]! * ba + 255 * (1 - ba);
    const bg = b.data[k + 1]! * ba + 255 * (1 - ba);
    const bb = b.data[k + 2]! * ba + 255 * (1 - ba);
    // Weighted as the eye sees colour.
    const d = Math.abs(ar - br) * 0.6 + Math.abs(ag - bg) * 1.2 + Math.abs(ab - bb) * 0.3;
    if (d >= limit) {
      mask[i] = 1;
      changed++;
    }
  }
  return { width: a.width, height: a.height, mask, changed, ratio: n ? changed / n : 0 };
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The areas that changed, as boxes: changed pixels are gathered into cells of
 * `cell` pixels, neighbouring changed cells (and cells within `gap` of each
 * other) join, and each group gives the box around its pixels. Specks smaller
 * than `minPixels` are left out.
 */
export function changedBoxes(d: PixelDiff, cell = 8, gap = 1, minPixels = 4): Box[] {
  const cw = Math.ceil(d.width / cell);
  const ch = Math.ceil(d.height / cell);
  const count = new Uint32Array(cw * ch);
  for (let y = 0; y < d.height; y++) {
    const row = y * d.width;
    const cy = Math.floor(y / cell) * cw;
    for (let x = 0; x < d.width; x++) if (d.mask[row + x]) count[cy + Math.floor(x / cell)]!++;
  }
  const group = new Int32Array(cw * ch).fill(-1);
  const boxes: Array<Box & { pixels: number }> = [];
  for (let start = 0; start < count.length; start++) {
    if (!count[start] || group[start]! >= 0) continue;
    const id = boxes.length;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let pixels = 0;
    const stack = [start];
    group[start] = id;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % cw;
      const cy = Math.floor(c / cw);
      pixels += count[c]!;
      x0 = Math.min(x0, cx);
      y0 = Math.min(y0, cy);
      x1 = Math.max(x1, cx);
      y1 = Math.max(y1, cy);
      for (let dy = -1 - gap; dy <= 1 + gap; dy++) {
        for (let dx = -1 - gap; dx <= 1 + gap; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const nc = ny * cw + nx;
          if (!count[nc] || group[nc]! >= 0) continue;
          group[nc] = id;
          stack.push(nc);
        }
      }
    }
    boxes.push({ x: x0 * cell, y: y0 * cell, width: Math.min(d.width, (x1 + 1) * cell) - x0 * cell, height: Math.min(d.height, (y1 + 1) * cell) - y0 * cell, pixels });
  }
  // The exact bounds of each box's pixels.
  const out: Box[] = [];
  for (const b of boxes) {
    if (b.pixels < minPixels) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    for (let y = b.y; y < b.y + b.height; y++) {
      for (let x = b.x; x < b.x + b.width; x++) {
        if (!d.mask[y * d.width + x]) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 >= 0) out.push({ x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 });
  }
  return out.sort((p, q) => q.width * q.height - p.width * p.height);
}

/** The difference as a picture: the new version faded to grey, with changed pixels in `color`. */
export function diffImage(b: Pixels, d: PixelDiff, color: [number, number, number] = [220, 38, 38]): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(d.width * d.height * 4);
  for (let i = 0; i < d.width * d.height; i++) {
    const k = i * 4;
    if (d.mask[i]) {
      out[k] = color[0];
      out[k + 1] = color[1];
      out[k + 2] = color[2];
      out[k + 3] = 255;
      continue;
    }
    const alpha = b.data[k + 3]! / 255;
    const grey = (b.data[k]! * 0.3 + b.data[k + 1]! * 0.59 + b.data[k + 2]! * 0.11) * alpha + 255 * (1 - alpha);
    // Faded towards white, so the changes stand out.
    const v = 255 - (255 - grey) * 0.35;
    out[k] = v;
    out[k + 1] = v;
    out[k + 2] = v;
    out[k + 3] = 255;
  }
  return out;
}

/**
 * A picture's fingerprint (a difference hash): the picture shrunk to 9 × 8
 * grey cells, each bit saying whether a cell is brighter than the next. It
 * stays the same when the picture is resized or saved again with a little
 * loss, so the same picture is known again in another file.
 */
export function fingerprint(p: Pixels): string {
  const W = 9;
  const H = 8;
  const grey = new Float64Array(W * H);
  for (let gy = 0; gy < H; gy++) {
    const y0 = Math.floor((gy * p.height) / H);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * p.height) / H));
    for (let gx = 0; gx < W; gx++) {
      const x0 = Math.floor((gx * p.width) / W);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * p.width) / W));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < p.height; y++) {
        for (let x = x0; x < x1 && x < p.width; x++) {
          const k = (y * p.width + x) * 4;
          const alpha = p.data[k + 3]! / 255;
          sum += (p.data[k]! * 0.3 + p.data[k + 1]! * 0.59 + p.data[k + 2]! * 0.11) * alpha + 255 * (1 - alpha);
          n++;
        }
      }
      grey[gy * W + gx] = n ? sum / n : 255;
    }
  }
  let bits = '';
  for (let y = 0; y < H; y++) for (let x = 0; x < W - 1; x++) bits += grey[y * W + x]! > grey[y * W + x + 1]! + 1 ? '1' : '0';
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** How many bits two fingerprints differ in (0: the same picture). */
export function fingerprintDistance(x: string, y: string): number {
  let n = 0;
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    let v = parseInt(x[i]!, 16) ^ parseInt(y[i]!, 16);
    while (v) {
      n += v & 1;
      v >>= 1;
    }
  }
  return n + Math.abs(x.length - y.length) * 4;
}

/** Pixels shrunk (or grown) to `w` × `h`, each the average of the area it covers (pixels it covers in part count in part), transparent ones as white. */
export function shrinkPixels(p: Pixels, w: number, h: number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  const sx = p.width / w;
  const sy = p.height / h;
  for (let ty = 0; ty < h; ty++) {
    const y0 = ty * sy;
    const y1 = y0 + sy;
    for (let tx = 0; tx < w; tx++) {
      const x0 = tx * sx;
      const x1 = x0 + sx;
      let r = 0;
      let g = 0;
      let b = 0;
      let area = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1) && y < p.height; y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.ceil(x1) && x < p.width; x++) {
          const wt = wy * (Math.min(x + 1, x1) - Math.max(x, x0));
          const k = (y * p.width + x) * 4;
          const alpha = p.data[k + 3]! / 255;
          r += (p.data[k]! * alpha + 255 * (1 - alpha)) * wt;
          g += (p.data[k + 1]! * alpha + 255 * (1 - alpha)) * wt;
          b += (p.data[k + 2]! * alpha + 255 * (1 - alpha)) * wt;
          area += wt;
        }
      }
      data.set(area ? [r / area, g / area, b / area, 255] : [255, 255, 255, 255], (ty * w + tx) * 4);
    }
  }
  return { width: w, height: h, data };
}

/** The size a picture is compared at to know it again: small, so that resizing or saving it again changes nothing that counts. */
const LOOK = 64;

/** How a picture looks, to know it again in another document: small, its proportions, and its fingerprint. */
export interface Look {
  pixels: Pixels;
  /** Width over height. */
  aspect: number;
  print: string;
}

/** How a picture of `width` × `height` looks, from its pixels (at any size). */
export function lookOf(p: Pixels, width = p.width, height = p.height): Look {
  const pixels = shrinkPixels(p, LOOK, LOOK);
  return { pixels, aspect: width / Math.max(1, height), print: fingerprint(pixels) };
}

/** How far apart two opaque pixels look (weighted as the eye sees colour, as diffPixels measures): 0 to 510. */
function distance(a: Pixels, i: number, b: Pixels, j: number): number {
  return Math.abs(a.data[i]! - b.data[j]!) * 0.6 + Math.abs(a.data[i + 1]! - b.data[j + 1]!) * 1.2 + Math.abs(a.data[i + 2]! - b.data[j + 2]!) * 0.3;
}

/** Whether every pixel of `a` has one at its place in `b`, or next to it, that looks the same (nearer than `limit`). */
function matches(a: Pixels, b: Pixels, limit: number): boolean {
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      let best = Infinity;
      for (let dy = -1; dy <= 1 && best >= limit; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= b.height) continue;
        for (let dx = -1; dx <= 1 && best >= limit; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= b.width) continue;
          best = Math.min(best, distance(a, i, b, (yy * b.width + xx) * 4));
        }
      }
      if (best >= limit) return false;
    }
  }
  return true;
}

/**
 * Whether two pictures look the same: the same proportions and, at the same
 * small size, no pixel that differs to the eye (by the measure, and at the
 * sensitivity, the picture view uses) from those at and around its place in
 * the other. A picture resized or saved again looks the same (resizing moves
 * edges by less than a pixel at that size); one with anything drawn
 * differently, or in other colours, doesn't.
 */
export function sameLook(x: Look, y: Look, sensitivity = 0.9): boolean {
  if (Math.abs(x.aspect - y.aspect) > 0.03 * Math.max(x.aspect, y.aspect)) return false;
  // Pictures far apart by their fingerprints aren't compared pixel by pixel.
  if (fingerprintDistance(x.print, y.print) > 12) return false;
  const limit = Math.max(1, (1 - sensitivity) * 510);
  return matches(x.pixels, y.pixels, limit) && matches(y.pixels, x.pixels, limit);
}
