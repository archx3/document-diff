/**
 * A picture file (PNG, JPEG, GIF, WebP, SVG, BMP) as a document of one
 * picture, so two versions of it are compared (image/diff.ts and the
 * picture comparison view) and it can be kept, shared and saved like any
 * other document.
 */
import type { Doc } from '../../core/model';
import { OBJ_CHAR, hashBytes, newId } from '../../core/model';
import { imageSize } from '../docx/writer';

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

/** The picture format of a file, from its first bytes (or, for SVG, its extension or text); null when it isn't one. */
export function imageMime(bytes: Uint8Array, ext = ''): string | null {
  const at = (i: number, s: string) => [...s].every((c, k) => bytes[i + k] === c.charCodeAt(0));
  if (bytes[0] === 0x89 && at(1, 'PNG')) return MIME.png!;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return MIME.jpeg!;
  if (at(0, 'GIF8')) return MIME.gif!;
  if (at(0, 'RIFF') && at(8, 'WEBP')) return MIME.webp!;
  if (at(0, 'BM') && ext === 'bmp') return MIME.bmp!;
  if (ext === 'svg' || /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 512)))) return MIME.svg!;
  return null;
}

/** An SVG's size from its width and height, or its viewBox. */
function svgSize(bytes: Uint8Array): { w: number; h: number } | undefined {
  const head = new TextDecoder().decode(bytes.subarray(0, 4096));
  const tag = /<svg\b[^>]*>/i.exec(head)?.[0] ?? '';
  const num = (a: string) => {
    const m = new RegExp(`\\b${a}\\s*=\\s*["']\\s*([\\d.]+)(?:px)?\\s*["']`, 'i').exec(tag);
    return m ? Number(m[1]) : undefined;
  };
  const w = num('width');
  const h = num('height');
  if (w && h) return { w, h };
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
  return vb ? { w: Number(vb[1]), h: Number(vb[2]) } : undefined;
}

export function readImage(bytes: Uint8Array, name: string, mime: string): Doc {
  const size = mime === MIME.svg ? svgSize(bytes) : imageSize(bytes);
  const src = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })) : undefined;
  const ext = Object.entries(MIME).find(([, m]) => m === mime)?.[0] ?? 'image';
  return {
    id: newId('d'),
    name,
    kind: 'image',
    formatLabel: ext === 'jpg' ? 'JPEG' : ext.toUpperCase(),
    ext: name.split('.').pop()?.toLowerCase(),
    version: 0,
    blocks: [
      {
        id: newId('p'),
        type: 'p',
        props: { role: 'p' },
        spans: [{ text: OBJ_CHAR, fmt: {}, obj: { kind: 'image', key: `img:${hashBytes(bytes)}`, label: name, src, data: bytes, mime, width: size?.w, height: size?.h } }],
      },
    ],
  };
}
