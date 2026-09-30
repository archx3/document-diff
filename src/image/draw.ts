/**
 * Pictures in the page: decoding them to pixels (image/diff.ts works on
 * those), saving pixels as a PNG, and fingerprinting a document's pictures
 * so the same picture is known again in the other document even when its
 * bytes differ (resized, or saved again by another program).
 */
import type { Block, Doc, Span } from '../core/model';
import type { Pixels } from './diff';
import { fingerprint } from './diff';

/** A picture loaded from a URL (blob: or data:). */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The picture could not be shown.'));
    img.src = src;
  });
}

/** A picture's pixels, drawn at `width` × `height`. */
export function pixelsOf(img: CanvasImageSource, width: number, height: number): Pixels {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/** Pixels as a PNG file. */
export function pngOf(p: Pixels): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = p.width;
  canvas.height = p.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be saved.'))), 'image/png'));
}

/** A picture's fingerprint from its bytes, or null where the browser can't decode it here. */
async function fingerprintOf(data: Uint8Array, mime: string): Promise<string | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  try {
    const bmp = await createImageBitmap(new Blob([data as BlobPart], { type: mime }));
    // Small is enough: the fingerprint is made from 9 × 8 cells.
    const w = Math.max(9, Math.min(64, bmp.width));
    const h = Math.max(8, Math.round((w * bmp.height) / Math.max(1, bmp.width)));
    const fp = fingerprint(pixelsOf(bmp, w, h));
    bmp.close();
    return fp;
  } catch {
    return null;
  }
}

/**
 * The document with each picture known by what it shows (its fingerprint)
 * rather than its bytes, so a picture that was only resized or saved again
 * compares as the same picture. Pictures that can't be decoded keep their key.
 * Only for a document just read, before anything compares it: the keys are
 * changed in place.
 */
export async function withFingerprints(doc: Doc): Promise<Doc> {
  const found = new Map<Uint8Array, string | null>();
  const visit = async (spans: readonly Span[]) => {
    for (const s of spans) if (s.obj?.kind === 'image' && s.obj.data && s.obj.mime && !found.has(s.obj.data)) found.set(s.obj.data, await fingerprintOf(s.obj.data, s.obj.mime));
  };
  const walk = async (blocks: readonly Block[]): Promise<void> => {
    for (const b of blocks) {
      if (b.type === 'p') await visit(b.spans);
      else if (b.type === 'table') for (const r of b.rows) for (const c of r.cells) await walk(c.blocks);
      else if (b.type === 'opaque') await walk(b.blocks);
    }
  };
  await walk(doc.blocks);
  if (![...found.values()].some(Boolean)) return doc;
  // The same objects, keys changed in place: the document's blocks (and a Word file's links to them) stay as they are.
  const rekey = (spans: readonly Span[]) => {
    for (const s of spans) {
      const fp = s.obj?.data && found.get(s.obj.data);
      if (s.obj && fp) s.obj.key = `pic:${fp}`;
    }
  };
  const apply = (blocks: readonly Block[]) => {
    for (const b of blocks) {
      if (b.type === 'p') rekey(b.spans);
      else if (b.type === 'table') for (const r of b.rows) for (const c of r.cells) apply(c.blocks);
      else if (b.type === 'opaque') apply(b.blocks);
    }
  };
  apply(doc.blocks);
  return doc;
}
