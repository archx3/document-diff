import { serializeIconNode, serializeJsx, serializeSvg } from '../core/svg-io';
import type { Doc } from '../core/types';

export const toComponentName = (name: string): string => {
  const base = name
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^[^A-Za-z]+/, '');
  return base ? base[0]!.toUpperCase() + base.slice(1) : 'Icon';
};

export const fileBase = (name: string): string => name.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'icon';

export function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const downloadSvg = (doc: Doc, name: string): void => download(`${fileBase(name)}.svg`, new Blob([serializeSvg(doc) + '\n'], { type: 'image/svg+xml' }));

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Without clipboard permission (or on a plain http page) fall back to the old way.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export const svgForExport = (doc: Doc): string => serializeSvg(doc);
export const jsxForExport = (doc: Doc, name: string): string => serializeJsx(doc, toComponentName(name));
export const iconNodeForExport = (doc: Doc): string => serializeIconNode(doc);

export interface PngOptions {
  size: number;
  color: string;
  background: string | null;
}

/** Renders the icon to a PNG whose longer side is `size` pixels. `currentColor` becomes `color`. */
export function renderPng(doc: Doc, o: PngOptions): Promise<Blob> {
  const scale = o.size / Math.max(doc.width, doc.height);
  const w = Math.max(1, Math.round(doc.width * scale));
  const h = Math.max(1, Math.round(doc.height * scale));
  const svg = serializeSvg(doc)
    .replace(/currentColor/g, o.color)
    .replace(/<svg\n  xmlns="([^"]+)"\n  width="[^"]*"\n  height="[^"]*"/, `<svg\n  xmlns="$1"\n  width="${w}"\n  height="${h}"`);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext('2d');
      if (!g) return reject(new Error('Canvas is not available'));
      if (o.background) {
        g.fillStyle = o.background;
        g.fillRect(0, 0, w, h);
      }
      g.drawImage(img, 0, 0, w, h);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the PNG'))), 'image/png');
    };
    img.onerror = () => reject(new Error('Could not draw the SVG'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
