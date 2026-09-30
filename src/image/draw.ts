/**
 * Pictures in the page: decoding them to pixels (image/diff.ts works on
 * those), saving pixels as a PNG, and knowing a document's pictures again in
 * another document when they look the same, though their bytes differ
 * (resized, or saved again by another program).
 */
import type { Block, Doc, InlineObject, Span } from '../core/model';
import type { Look, Pixels } from './diff';
import { lookOf, sameLook } from './diff';

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

/** The size a picture is decoded at to see how it looks (its longer side). */
const DECODE = 256;

/** How a picture looks, from its bytes, or null where the browser can't decode it here. */
async function lookOfBytes(data: Uint8Array, mime: string): Promise<Look | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  try {
    const full = await createImageBitmap(new Blob([data as BlobPart], { type: mime }));
    const { width, height } = full;
    // Shrunk by the browser as it decodes (well: every pixel counts), then to the size compared at.
    const scale = Math.min(1, DECODE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const small = scale < 1 ? await createImageBitmap(full, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }) : full;
    const look = lookOf(pixelsOf(small, w, h), width, height);
    if (small !== full) small.close();
    full.close();
    return look;
  } catch {
    return null;
  }
}

/** The pictures seen in this page (in any document), by the key each is known by, and how it looks. */
const seen: Array<{ key: string; look: Look }> = [];
/** The key each picture's bytes are known by: its own, or that of the first picture seen that looks the same. */
const knownAs = new Map<string, string>();

/** The key a picture is known by: that of a picture seen before that looks the same, or its own. */
async function keyFor(obj: InlineObject): Promise<string> {
  const hit = knownAs.get(obj.key);
  if (hit) return hit;
  const look = obj.data && obj.mime ? await lookOfBytes(obj.data, obj.mime) : null;
  if (!look) return obj.key;
  const same = knownAs.get(obj.key) ?? seen.find((s) => sameLook(s.look, look))?.key;
  if (same) {
    knownAs.set(obj.key, same);
    return same;
  }
  seen.push({ key: obj.key, look });
  knownAs.set(obj.key, obj.key);
  return obj.key;
}

/**
 * The document with each picture known again when it is in another document
 * too, though its bytes differ (resized, or saved again by another program):
 * a picture that looks the same as one seen before takes its key, so the two
 * compare as the same picture. A picture changed in any way that shows keeps
 * its own key, and is a difference. Pictures that can't be decoded keep their
 * key. Only for a document just read, before anything compares it: the keys
 * are changed in place.
 */
export async function withKnownPictures(doc: Doc): Promise<Doc> {
  const keys = new Map<InlineObject, string>();
  const visit = async (spans: readonly Span[]) => {
    for (const s of spans) if (s.obj?.kind === 'image' && !keys.has(s.obj)) keys.set(s.obj, await keyFor(s.obj));
  };
  const walk = async (blocks: readonly Block[]): Promise<void> => {
    for (const b of blocks) {
      if (b.type === 'p') await visit(b.spans);
      else if (b.type === 'table') for (const r of b.rows) for (const c of r.cells) await walk(c.blocks);
      else if (b.type === 'opaque') await walk(b.blocks);
    }
  };
  await walk(doc.blocks);
  // The same objects, keys changed in place: the document's blocks (and a Word file's links to them) stay as they are.
  for (const [obj, key] of keys) obj.key = key;
  return doc;
}
